import Hls from 'hls.js';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ChangeEvent, type DragEvent, type ReactNode } from 'react';
import { useAuth } from '../auth/auth-context';
import { ConfirmDialog, Toast } from '../components/feedback';
import { Field } from '../components/field';
import { PageHeader } from '../components/page-header';
import { PortalSidebar } from '../components/portal-sidebar';
import { Button } from '../components/ui/button';
import { api, apiUrl, ApiError } from '../lib/api';

type MediaType = 'VIDEO' | 'AUDIO';
type MediaStatus = 'UPLOADING' | 'PROCESSING' | 'READY' | 'FAILED';
type Media = {
  id: string;
  title: string;
  description: string | null;
  type: MediaType;
  status: MediaStatus;
  visibility: 'DRAFT' | 'PUBLISHED';
  durationSeconds: number | null;
  sizeBytes: number;
  courseId: string;
  topicId: string | null;
  streamKey: string | null;
  course: { id: string; title: string; code: string };
  topic: { id: string; title: string } | null;
  uploadedBy: { id: string; name: string; role: string };
  job: { status: string; attempts: number; progressPercent: number; error: string | null } | null;
};
type Course = { id: string; title: string; code: string; topics: Array<{ id: string; title: string; order: number }> };
type MediaListResponse = {
  media: Media[];
  storage: { usedBytes: number; quotaBytes: number; quotaGigabytes: number } | null;
};
type UploadDraft = { title: string; description: string; courseId: string; topicId: string; type: MediaType };
type PendingUpload = { id: string; file: File; progress: number };

const initialDraft: UploadDraft = { title: '', description: '', courseId: '', topicId: '', type: 'VIDEO' };

function ControlField({ label, children }: { label: string; children: ReactNode }) {
  return <label className="field"><span>{label}</span>{children}</label>;
}

function dashboardPath(role: string) {
  if (role === 'ORG_ADMIN') return '/org-admin';
  if (role === 'INSTRUCTOR') return '/instructor';
  return '/staff';
}

function mediaPath(role: string) {
  return `${dashboardPath(role)}/media`;
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

function errorText(error: unknown) {
  return error instanceof ApiError ? error.message : error instanceof Error ? error.message : 'Media request failed.';
}

function extensionFor(file: File) {
  return file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
}

function sendFile(
  mediaId: string,
  file: File,
  onProgress: (progress: number) => void,
  onRequest: (xhr: XMLHttpRequest) => void,
): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const xhr = new XMLHttpRequest();
    onRequest(xhr);
    xhr.open('PUT', `${apiUrl}/media/${encodeURIComponent(mediaId)}/file`);
    xhr.withCredentials = true;
    xhr.setRequestHeader('X-Media-Extension', extensionFor(file));
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status === 202) {
        onProgress(100);
        resolvePromise();
        return;
      }
      let message = 'Upload could not be completed.';
      try {
        message = JSON.parse(xhr.responseText).error?.message ?? message;
      } catch {
        message = 'Upload could not be completed.';
      }
      reject(new ApiError(message, xhr.status));
    };
    xhr.onerror = () => reject(new Error('Network error while uploading. Retry when the connection is available.'));
    xhr.onabort = () => reject(new DOMException('Upload cancelled', 'AbortError'));
    xhr.send(file);
  });
}

function MediaPreview({ media }: { media: Media }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const source = `${apiUrl}/media/${encodeURIComponent(media.id)}/stream/${media.type === 'VIDEO' ? 'master.m3u8' : 'audio.m4a'}`;

  useEffect(() => {
    const video = videoRef.current;
    if (media.type !== 'VIDEO' || !video) return;
    let hls: Hls | undefined;
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = source;
    } else if (Hls.isSupported()) {
      hls = new Hls({ xhrSetup: (xhr) => { xhr.withCredentials = true; } });
      hls.loadSource(source);
      hls.attachMedia(video);
    }
    return () => {
      hls?.destroy();
      video.removeAttribute('src');
      video.load();
    };
  }, [media.type, source]);

  if (media.type === 'AUDIO') {
    return <audio controls preload="metadata" src={source}>Your browser cannot preview this audio.</audio>;
  }
  return <video ref={videoRef} controls preload="metadata" poster={`${apiUrl}/media/${encodeURIComponent(media.id)}/stream/thumbnail.jpg`} />;
}

export function MediaPage() {
  const { user } = useAuth();
  const role = user?.role ?? 'STAFF';
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(initialDraft);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [pendingUpload, setPendingUpload] = useState<PendingUpload | null>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const [failedUploadId, setFailedUploadId] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [toast, setToast] = useState('');
  const [search, setSearch] = useState('');
  const [courseFilter, setCourseFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [editing, setEditing] = useState<Media | null>(null);
  const [editDraft, setEditDraft] = useState({ title: '', description: '', courseId: '', topicId: '' });
  const [pendingDelete, setPendingDelete] = useState<Media | null>(null);
  const [preview, setPreview] = useState<Media | null>(null);

  const courses = useQuery({
    queryKey: ['media-courses', role],
    queryFn: () => api<{ courses: Course[] }>('/media/courses'),
  });
  const query = new URLSearchParams();
  if (search.trim()) query.set('search', search.trim());
  if (courseFilter) query.set('courseId', courseFilter);
  if (typeFilter) query.set('type', typeFilter);
  if (statusFilter) query.set('status', statusFilter);
  const list = useQuery({
    queryKey: ['media', role, search, courseFilter, typeFilter, statusFilter],
    queryFn: () => api<MediaListResponse>(`/media?${query.toString()}`),
    refetchInterval: (result) => result.state.data?.media.some((item) => item.status === 'PROCESSING' || item.status === 'UPLOADING') ? 2000 : false,
  });
  const configuredLimits = useQuery({
    queryKey: ['media-limits'],
    queryFn: () => api<{ limits: { maxVideoBytes: number; maxAudioBytes: number } }>('/media/limits'),
  });
  const storageUsage = useQuery({
    queryKey: ['media-storage', role],
    queryFn: () => api<{ storage: { usedBytes: number; quotaBytes: number; maxVideoBytes: number; maxAudioBytes: number } }>('/media/storage'),
    enabled: role === 'ORG_ADMIN',
  });

  const updateMutation = useMutation({
    mutationFn: (input: { id: string; data: typeof editDraft }) => api<{ media: Media }>(`/media/${input.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ ...input.data, topicId: input.data.topicId || null }),
    }),
    onSuccess: async () => {
      setEditing(null);
      setToast('Media details updated.');
      await queryClient.invalidateQueries({ queryKey: ['media'] });
    },
    onError: (error) => setErrorMessage(errorText(error)),
  });
  const visibilityMutation = useMutation({
    mutationFn: ({ id, publish }: { id: string; publish: boolean }) => api<{ media: Media }>(`/media/${id}/${publish ? 'publish' : 'unpublish'}`, { method: 'POST' }),
    onSuccess: async (_result, variables) => {
      setToast(variables.publish ? 'Media published to the course.' : 'Media unpublished.');
      await queryClient.invalidateQueries({ queryKey: ['media'] });
    },
    onError: (error) => setErrorMessage(errorText(error)),
  });
  const deleteMutation = useMutation({
    mutationFn: (id: string) => api<void>(`/media/${id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      setPendingDelete(null);
      setToast('Media deleted.');
      await queryClient.invalidateQueries({ queryKey: ['media'] });
      await queryClient.invalidateQueries({ queryKey: ['media-storage'] });
    },
    onError: (error) => setErrorMessage(errorText(error)),
  });
  const retryMutation = useMutation({
    mutationFn: (id: string) => api(`/media/${id}/retry`, { method: 'POST' }),
    onSuccess: async () => {
      setToast('Processing has been queued again.');
      await queryClient.invalidateQueries({ queryKey: ['media'] });
    },
    onError: (error) => setErrorMessage(errorText(error)),
  });

  const refreshMedia = async () => {
    await queryClient.invalidateQueries({ queryKey: ['media'] });
    await queryClient.invalidateQueries({ queryKey: ['media-storage'] });
  };

  const transmit = async (id: string, file: File) => {
    setErrorMessage('');
    setFailedUploadId(null);
    setPendingUpload({ id, file, progress: 0 });
    try {
      await sendFile(id, file, (progress) => setPendingUpload((current) => current?.id === id ? { ...current, progress } : current), (xhr) => {
        xhrRef.current = xhr;
      });
      xhrRef.current = null;
      setPendingUpload(null);
      setFailedUploadId(null);
      setSelectedFile(null);
      setDraft(initialDraft);
      setToast('Upload complete. Media is processing.');
      await refreshMedia();
    } catch (error) {
      xhrRef.current = null;
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setFailedUploadId(id);
      setErrorMessage(errorText(error));
    }
  };

  const startUpload = async () => {
    if (!selectedFile) {
      setErrorMessage('Choose a video or audio file to upload.');
      return;
    }
    if (!draft.title.trim() || !draft.courseId) {
      setErrorMessage('Enter a title and select a course.');
      return;
    }
    const maximumBytes = draft.type === 'VIDEO'
      ? configuredLimits.data?.limits.maxVideoBytes
      : configuredLimits.data?.limits.maxAudioBytes;
    if (maximumBytes !== undefined && selectedFile.size > maximumBytes) {
      setErrorMessage(`This file exceeds the configured ${draft.type.toLowerCase()} size limit.`);
      return;
    }
    try {
      const created = await api<{ media: Media }>('/media', {
        method: 'POST',
        body: JSON.stringify({
          title: draft.title,
          description: draft.description,
          courseId: draft.courseId,
          topicId: draft.topicId || null,
          type: draft.type,
          sizeBytes: selectedFile.size,
          extension: extensionFor(selectedFile),
          mimeType: selectedFile.type,
          fileName: selectedFile.name,
        }),
      });
      await transmit(created.media.id, selectedFile);
    } catch (error) {
      setErrorMessage(errorText(error));
    }
  };

  const cancelUpload = async () => {
    const upload = pendingUpload;
    xhrRef.current?.abort();
    xhrRef.current = null;
    if (!upload) return;
    try {
      await api<void>(`/media/${upload.id}/cancel`, { method: 'POST' });
      setPendingUpload(null);
      setSelectedFile(null);
      setToast('Upload cancelled.');
      await refreshMedia();
    } catch (error) {
      setErrorMessage(errorText(error));
    }
  };

  const chooseFile = (file: File | undefined) => {
    if (!file) return;
    setSelectedFile(file);
    setErrorMessage('');
  };

  const retryUpload = async (event: ChangeEvent<HTMLInputElement>, media: Media) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size !== media.sizeBytes) {
      setErrorMessage('Select the same file with its original size to retry this upload.');
      event.target.value = '';
      return;
    }
    await transmit(media.id, file);
    event.target.value = '';
  };

  const beginEdit = (media: Media) => {
    setEditing(media);
    setEditDraft({
      title: media.title,
      description: media.description ?? '',
      courseId: media.courseId,
      topicId: media.topicId ?? '',
    });
  };

  const editTopics = courses.data?.courses.find((course) => course.id === editDraft.courseId)?.topics ?? [];
  const selectedCourseTopics = courses.data?.courses.find((course) => course.id === draft.courseId)?.topics ?? [];
  const adminStorage = storageUsage.data?.storage;
  const uploadLimit = draft.type === 'VIDEO' ? configuredLimits.data?.limits.maxVideoBytes : configuredLimits.data?.limits.maxAudioBytes;
  const isUploading = Boolean(pendingUpload);
  const uploadMutationInFlight = updateMutation.isPending || visibilityMutation.isPending || deleteMutation.isPending || retryMutation.isPending;

  const dropFile = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setDragging(false);
    chooseFile(event.dataTransfer.files[0]);
  };

  return (
    <div className="portal-layout">
      <PortalSidebar role={role} />
      <section className="portal-content media-page">
        <PageHeader title="Upload Media" backTo={dashboardPath(role)} breadcrumbs={['Workspace', 'Media']} hasUnsavedChanges={!isUploading && (draft.title.length > 0 || Boolean(selectedFile))} />
        <p className="muted">Upload video and audio resources for your organization’s courses. Your uploads will be available to manage here.</p>

        {role === 'ORG_ADMIN' && adminStorage && (
          <section className="card media-storage" aria-label="Organization storage usage">
            <div className="media-storage-heading"><strong>Organization storage</strong><span>{formatBytes(adminStorage.usedBytes)} / {formatBytes(adminStorage.quotaBytes)}</span></div>
            <progress max={adminStorage.quotaBytes} value={Math.min(adminStorage.usedBytes, adminStorage.quotaBytes)} />
          </section>
        )}

        <section className="card media-upload-card">
          <h2>Upload a video or audio file</h2>
          <div className="media-form-grid">
            <Field label="Title" value={draft.title} maxLength={160} onChange={(event) => setDraft({ ...draft, title: event.target.value })} />
            <ControlField label="Media type"><select className="input" value={draft.type} disabled={isUploading} onChange={(event) => { setDraft({ ...draft, type: event.target.value as MediaType }); setSelectedFile(null); }}><option value="VIDEO">Video</option><option value="AUDIO">Audio</option></select></ControlField>
            <ControlField label="Course"><select className="input" value={draft.courseId} onChange={(event) => setDraft({ ...draft, courseId: event.target.value, topicId: '' })}><option value="">Select a course</option>{courses.data?.courses.map((course) => <option key={course.id} value={course.id}>{course.code} — {course.title}</option>)}</select></ControlField>
            <ControlField label="Topic (optional)"><select className="input" value={draft.topicId} disabled={!draft.courseId} onChange={(event) => setDraft({ ...draft, topicId: event.target.value })}><option value="">No topic</option>{selectedCourseTopics.map((topic) => <option key={topic.id} value={topic.id}>{topic.title}</option>)}</select></ControlField>
            <label className="field media-description-field">Description<textarea className="input textarea" value={draft.description} maxLength={4000} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label>
          </div>
          <label
            className={`media-dropzone${dragging ? ' is-dragging' : ''}`}
            onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={dropFile}
          >
            <input
              aria-label="Choose a media file"
              type="file"
              accept={draft.type === 'VIDEO' ? '.mp4,.mov,.webm,.mkv,video/mp4,video/quicktime,video/webm,video/x-matroska' : '.mp3,.m4a,.aac,.wav,.ogg,audio/mpeg,audio/mp4,audio/aac,audio/wav,audio/ogg'}
              disabled={isUploading}
              onChange={(event) => chooseFile(event.target.files?.[0])}
            />
            <strong>{selectedFile ? selectedFile.name : 'Drop a file here or browse'}</strong>
            <span>{selectedFile ? `${formatBytes(selectedFile.size)} · ${selectedFile.type || 'unknown MIME type'}` : draft.type === 'VIDEO' ? `MP4, MOV, WebM or MKV · max ${configuredLimits.data ? formatBytes(configuredLimits.data.limits.maxVideoBytes) : '…'}` : `MP3, M4A, AAC, WAV or OGG · max ${configuredLimits.data ? formatBytes(configuredLimits.data.limits.maxAudioBytes) : '…'}`}</span>
          </label>
          {selectedFile && uploadLimit !== undefined && selectedFile.size > uploadLimit && <p className="notice notice-error">This file is above the configured upload limit.</p>}
          {isUploading && (
            <div className="media-progress" aria-live="polite">
              <div><span>{(pendingUpload?.progress ?? 0) < 100 ? 'Uploading' : 'Waiting for processing queue'}</span><span>{pendingUpload?.progress ?? 0}%</span></div>
              <progress max={100} value={pendingUpload?.progress ?? 0} />
              <Button type="button" variant="secondary" onClick={() => void cancelUpload()}>Cancel upload</Button>
            </div>
          )}
          {errorMessage && <p className="notice notice-error" role="alert">{errorMessage}</p>}
          <div className="row-actions media-form-actions">
            {!isUploading && <Button type="button" disabled={!selectedFile || courses.isLoading} onClick={() => void startUpload()}>Upload media</Button>}
            {pendingUpload && failedUploadId === pendingUpload.id && <Button type="button" variant="secondary" onClick={() => void transmit(pendingUpload.id, pendingUpload.file)}>Retry upload</Button>}
          </div>
        </section>

        <section className="media-list-section">
          <div className="list-heading media-list-heading"><div><h2>My Uploads</h2><span>{role === 'ORG_ADMIN' ? 'All organization media' : 'Media uploaded by you'}</span></div><span>{list.data?.media.length ?? 0} items</span></div>
          <div className="media-filters">
            <Field label="Search title" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search media" />
            <ControlField label="Course"><select className="input" value={courseFilter} onChange={(event) => setCourseFilter(event.target.value)}><option value="">All courses</option>{courses.data?.courses.map((course) => <option key={course.id} value={course.id}>{course.code} — {course.title}</option>)}</select></ControlField>
            <ControlField label="Type"><select className="input" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}><option value="">All types</option><option value="VIDEO">Video</option><option value="AUDIO">Audio</option></select></ControlField>
            <ControlField label="Status"><select className="input" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="">All statuses</option>{(['UPLOADING', 'PROCESSING', 'READY', 'FAILED'] as const).map((status) => <option key={status} value={status}>{status}</option>)}</select></ControlField>
          </div>
          {list.isLoading && <p className="loading">Loading media…</p>}
          {list.isError && <p className="notice notice-error" role="alert">{errorText(list.error)}</p>}
          {list.data?.media.length === 0 && <div className="card empty-state"><h3>No media found</h3><p>Uploads will appear here with their processing status.</p></div>}
          <div className="media-list">
            {list.data?.media.map((media) => (
              <article className="card media-card" key={media.id}>
                <div className="media-card-main">
                  <div className="media-card-title"><span className={`status-pill status-${media.status.toLowerCase()}`}>{media.status === 'PROCESSING' ? `PROCESSING · ${media.job?.progressPercent ?? 0}%` : media.status}</span><span className={`status-pill ${media.visibility === 'PUBLISHED' ? 'status-published' : 'status-draft'}`}>{media.visibility}</span></div>
                  <h3>{media.title}</h3>
                  <p className="muted">{media.course.code} — {media.course.title}{media.topic ? ` · ${media.topic.title}` : ''}</p>
                  <p className="media-card-description">{media.description || 'No description'} · {media.type.toLowerCase()} · {formatBytes(media.sizeBytes)}{media.durationSeconds ? ` · ${Math.floor(media.durationSeconds / 60)}:${String(media.durationSeconds % 60).padStart(2, '0')}` : ''}</p>
                  {role === 'ORG_ADMIN' && <p className="media-uploader">Uploaded by {media.uploadedBy.name}</p>}
                  {media.status === 'PROCESSING' && <progress max={100} value={media.job?.progressPercent ?? 0} aria-label={`Processing ${media.title}`} />}
                  {media.status === 'FAILED' && <p className="notice notice-error">{media.job?.error ?? 'Processing failed.'}</p>}
                </div>
                <div className="media-card-actions">
                  {media.status === 'UPLOADING' && (
                    <>
                      <label className="button button-secondary media-retry-file">Retry upload<input type="file" onChange={(event) => void retryUpload(event, media)} /></label>
                      <Button type="button" variant="secondary" onClick={() => void api(`/media/${media.id}/cancel`, { method: 'POST' }).then(refreshMedia).catch((error: unknown) => setErrorMessage(errorText(error)))}>Cancel</Button>
                    </>
                  )}
                  {media.status === 'FAILED' && <Button type="button" variant="secondary" disabled={uploadMutationInFlight} onClick={() => retryMutation.mutate(media.id)}>Retry processing</Button>}
                  {media.status === 'READY' && <Button type="button" variant="secondary" onClick={() => setPreview(media)}>Preview</Button>}
                  {media.status !== 'UPLOADING' && <Button type="button" variant="secondary" disabled={uploadMutationInFlight} onClick={() => beginEdit(media)}>Edit</Button>}
                  {media.status === 'READY' && <Button type="button" disabled={uploadMutationInFlight} onClick={() => visibilityMutation.mutate({ id: media.id, publish: media.visibility !== 'PUBLISHED' })}>{media.visibility === 'PUBLISHED' ? 'Unpublish' : 'Publish'}</Button>}
                  <Button type="button" variant="danger" disabled={uploadMutationInFlight} onClick={() => setPendingDelete(media)}>Delete</Button>
                </div>
                {editing?.id === media.id && (
                  <form className="media-edit-form" onSubmit={(event) => { event.preventDefault(); updateMutation.mutate({ id: media.id, data: editDraft }); }}>
                    <Field label="Title"><input className="input" value={editDraft.title} onChange={(event) => setEditDraft({ ...editDraft, title: event.target.value })} /></Field>
                    <ControlField label="Description"><textarea className="input textarea" value={editDraft.description} onChange={(event) => setEditDraft({ ...editDraft, description: event.target.value })} /></ControlField>
                    <ControlField label="Course"><select className="input" value={editDraft.courseId} onChange={(event) => setEditDraft({ ...editDraft, courseId: event.target.value, topicId: '' })}>{courses.data?.courses.map((course) => <option key={course.id} value={course.id}>{course.code} — {course.title}</option>)}</select></ControlField>
                    <ControlField label="Topic"><select className="input" value={editDraft.topicId} onChange={(event) => setEditDraft({ ...editDraft, topicId: event.target.value })}><option value="">No topic</option>{editTopics.map((topic) => <option key={topic.id} value={topic.id}>{topic.title}</option>)}</select></ControlField>
                    <div className="row-actions"><Button type="submit" disabled={updateMutation.isPending}>Save</Button><Button type="button" variant="secondary" onClick={() => setEditing(null)}>Cancel</Button></div>
                  </form>
                )}
              </article>
            ))}
          </div>
        </section>
      </section>
      {pendingDelete && <ConfirmDialog title="Delete this media?" message="This media will be removed from the upload list and can no longer be published." confirmLabel="Delete media" busy={deleteMutation.isPending} onCancel={() => setPendingDelete(null)} onConfirm={() => deleteMutation.mutate(pendingDelete.id)} />}
      {preview && <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setPreview(null); }}><section className="dialog card media-preview-dialog" role="dialog" aria-modal="true" aria-labelledby="media-preview-title"><PageHeader title={preview.title} backTo={mediaPath(role)} breadcrumbs={['Media', 'Preview']} onBack={() => setPreview(null)} /><MediaPreview media={preview} /><Button type="button" variant="secondary" onClick={() => setPreview(null)}>Close preview</Button></section></div>}
      {toast && <Toast message={toast} onDismiss={() => setToast('')} />}
    </div>
  );
}
