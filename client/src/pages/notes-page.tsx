import { getDocument, GlobalWorkerOptions, type PDFPageProxy } from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/auth-context';
import { Field } from '../components/field';
import { ConfirmDialog, Toast } from '../components/feedback';
import { PortalSidebar } from '../components/portal-sidebar';
import { PageHeader } from '../components/page-header';
import { Button } from '../components/ui/button';
import { api, apiBlob, ApiError, downloadBlob } from '../lib/api';

GlobalWorkerOptions.workerSrc = pdfWorker;

type Note = {
  id: string;
  title: string;
  subject: string;
  description: string;
  originalName: string | null;
  published: boolean;
  course: { id: string; title: string; code: string } | null;
  createdAt: string;
  updatedAt: string;
  author: { id: string; name: string; role: string };
};
type NoteViewerResponse = { data: { note: Pick<Note, 'id' | 'title' | 'subject' | 'description' | 'originalName'> } };
type ViewerState = { blob?: Blob; note?: NoteViewerResponse['data']['note']; error?: string; loading: boolean };

function locationPathForRole(role: string): string {
  if (role === 'ORG_ADMIN') return '/org-admin/notes';
  if (role === 'INSTRUCTOR') return '/instructor/notes';
  if (role === 'STAFF') return '/staff/notes';
  return '/student/notes';
}

function PdfPage({ page, onRenderError }: { page: PDFPageProxy; onRenderError: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    const viewport = page.getViewport({ scale: 1.25 });
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const task = page.render({ canvas, canvasContext: context, viewport });
    void task.promise.catch((error: unknown) => {
      if (error instanceof Error && error.name !== 'RenderingCancelledException') onRenderError();
    });
    return () => task.cancel();
  }, [onRenderError, page]);
  return <div className="protected-page"><canvas ref={canvasRef} /><Watermark /></div>;
}

function PdfViewer({ blob }: { blob: Blob }) {
  const [pages, setPages] = useState<PDFPageProxy[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    let loadingTask: ReturnType<typeof getDocument> | undefined;
    void (async () => {
      try {
        loadingTask = getDocument({ data: await blob.arrayBuffer() });
        const document = await loadingTask.promise;
        const loadedPages = await Promise.all(
          Array.from({ length: document.numPages }, (_, index) => document.getPage(index + 1)),
        );
        if (active) setPages(loadedPages);
      } catch {
        if (active) setError('This PDF could not be displayed.');
      }
    })();
    return () => {
      active = false;
      if (loadingTask) void loadingTask.destroy();
    };
  }, [blob]);
  const handleRenderError = useCallback(() => setError('A page in this PDF could not be rendered.'), []);
  if (error) return <p className="notice notice-error" role="alert">{error}</p>;
  if (!pages.length) return <p className="loading">Preparing document viewer…</p>;
  return <div className="pdf-pages">{pages.map((page, index) => <PdfPage key={index + 1} page={page} onRenderError={handleRenderError} />)}</div>;
}

function Watermark() {
  const { user } = useAuth();
  if (user?.role !== 'STUDENT') return null;
  const value = `${user?.name ?? 'Student'} · ${user?.studentId ?? ''}`;
  return <div className="page-watermark" aria-hidden="true">{Array.from({ length: 9 }, (_, index) => <span key={index}>{value}</span>)}</div>;
}

function ProtectedImage({ blob }: { blob: Blob }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    const objectUrl = URL.createObjectURL(blob);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [blob]);
  return <div className="protected-image">{url && <img src={url} alt="Note attachment" />}<Watermark /></div>;
}

export function NotesPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const role = user?.role ?? 'STUDENT';
  const isStudent = role === 'STUDENT';
  const canCreate = ['ORG_ADMIN', 'INSTRUCTOR', 'STAFF'].includes(role);
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState(searchParams.get('search') ?? '');
  const [subject, setSubject] = useState(searchParams.get('subject') ?? '');
  const courseId = searchParams.get('courseId') ?? '';
  const [editing, setEditing] = useState<Note | null>(null);
  const [viewing, setViewing] = useState<Note | null>(null);
  const [viewState, setViewState] = useState<ViewerState>({ loading: false });
  const [pendingDelete, setPendingDelete] = useState<Note | null>(null);
  const [toast, setToast] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [draft, setDraft] = useState({ title: '', subject: '', description: '', courseId: '' });
  const [attachment, setAttachment] = useState<File | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [editBaseline, setEditBaseline] = useState<{ title: string; subject: string; description: string; courseId: string } | null>(null);
  const courseOptions = useQuery({
    queryKey: ['courses', role],
    queryFn: () => api<{ courses: Array<{ id: string; title: string; code: string }> }>('/courses'),
    enabled: role === 'ORG_ADMIN' || role === 'INSTRUCTOR',
  });
  useEffect(() => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (search.trim()) next.set('search', search.trim());
      else next.delete('search');
      if (subject) next.set('subject', subject);
      else next.delete('subject');
      return next;
    }, { replace: true });
  }, [search, setSearchParams, subject]);
  const queryString = new URLSearchParams();
  if (search.trim()) queryString.set('search', search.trim());
  if (subject) queryString.set('subject', subject);
  if (courseId) queryString.set('courseId', courseId);
  const notes = useQuery({
    queryKey: ['notes', search.trim(), subject, courseId, role],
    queryFn: () => api<{ notes: Note[] }>(`/notes?${queryString.toString()}`),
  });
  useEffect(() => {
    const noteId = searchParams.get('view');
    setViewing(notes.data?.notes.find((note) => note.id === noteId) ?? null);
  }, [notes.data, searchParams]);
  const invalidateNotes = () => queryClient.invalidateQueries({ queryKey: ['notes'] });
  const createMutation = useMutation({
    mutationFn: async () => {
      const body = new FormData();
      body.append('title', draft.title);
      body.append('subject', draft.subject);
      body.append('description', draft.description);
      if (draft.courseId) body.append('courseId', draft.courseId);
      if (attachment) body.append('file', attachment);
      return api<{ note: Note }>('/notes', { method: 'POST', body });
    },
    onSuccess: async () => {
      setDraft({ title: '', subject: '', description: '', courseId: '' });
      setAttachment(null);
      setToast('Note saved as a draft.');
      setErrorMessage('');
      await invalidateNotes();
    },
    onError: (error) => setErrorMessage(error instanceof ApiError ? error.message : 'Note could not be saved.'),
  });
  const updateMutation = useMutation({
    mutationFn: () => api<{ note: Note }>(`/notes/${editing!.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ ...draft, courseId: draft.courseId || null }),
    }),
    onSuccess: async () => {
      setEditing(null);
      setDraft({ title: '', subject: '', description: '', courseId: '' });
      setEditBaseline(null);
      setSearchParams((current) => {
        const next = new URLSearchParams(current);
        next.delete('edit');
        return next;
      }, { replace: true });
      setToast('Note updated.');
      setErrorMessage('');
      await invalidateNotes();
    },
    onError: (error) => setErrorMessage(error instanceof ApiError ? error.message : 'Note could not be updated.'),
  });
  const publishMutation = useMutation({
    mutationFn: ({ note, publish }: { note: Note; publish: boolean }) =>
      api(`/notes/${note.id}/${publish ? 'publish' : 'unpublish'}`, { method: 'POST' }),
    onSuccess: async (_data, variables) => {
      setToast(variables.publish ? 'Note published.' : 'Note unpublished.');
      setErrorMessage('');
      await invalidateNotes();
    },
    onError: (error) => setErrorMessage(error instanceof ApiError ? error.message : 'Note status could not be changed.'),
  });
  const deleteMutation = useMutation({
    mutationFn: (note: Note) => api(`/notes/${note.id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      setPendingDelete(null);
      setToast('Note deleted.');
      setErrorMessage('');
      await invalidateNotes();
    },
    onError: (error) => setErrorMessage(error instanceof ApiError ? error.message : 'Note could not be deleted.'),
  });
  const downloadMutation = useMutation({
    mutationFn: async (note: Note) => downloadBlob(await apiBlob(`/notes/${note.id}/download`), note.originalName ?? 'note'),
    onError: (error) => setErrorMessage(error instanceof ApiError ? error.message : 'File could not be downloaded.'),
  });

  useEffect(() => {
    if (!viewing) {
      setViewState({ loading: false });
      return;
    }
    let active = true;
    setViewState({ loading: true });
    void apiBlob(`/notes/${viewing.id}/view`).then(async (blob) => {
      if (!active) return;
      if (blob.type.includes('application/json')) {
        const response = await blob.text();
        const data = JSON.parse(response) as NoteViewerResponse;
        setViewState({ loading: false, note: data.data.note });
      } else {
        setViewState({ loading: false, blob });
      }
    }).catch((error: unknown) => {
      if (!active) return;
      setViewState({ loading: false, error: error instanceof ApiError ? error.message : 'This note could not be opened.' });
    });
    return () => { active = false; };
  }, [viewing]);

  useEffect(() => {
    if (!viewing || !isStudent) return;
    const preventRestrictedShortcuts = (event: KeyboardEvent) => {
      if (event.ctrlKey && ['p', 's'].includes(event.key.toLowerCase())) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener('keydown', preventRestrictedShortcuts, true);
    return () => window.removeEventListener('keydown', preventRestrictedShortcuts, true);
  }, [viewing, isStudent]);

  const notesList = notes.data?.notes ?? [];
  const subjects = [...new Set(notesList.map((note) => note.subject))].sort();
  const canManage = (note: Note) => role === 'ORG_ADMIN' || note.author.id === user?.id;
  const isSaving = createMutation.isPending || updateMutation.isPending;
  const currentDashboard = role === 'ORG_ADMIN' ? '/org-admin' : role === 'INSTRUCTOR' ? '/instructor' : role === 'STAFF' ? '/staff' : '/student';
  const listQuery = new URLSearchParams();
  for (const key of ['search', 'subject', 'courseId']) {
    const value = searchParams.get(key);
    if (value) listQuery.set(key, value);
  }
  const noteListRoute = `${locationPathForRole(role)}${listQuery.size ? `?${listQuery.toString()}` : ''}`;
  const isEditDirty = Boolean(editing && editBaseline && (
    draft.title !== editBaseline.title || draft.subject !== editBaseline.subject || draft.description !== editBaseline.description
    || draft.courseId !== editBaseline.courseId
  ));
  const cancelEdit = () => {
    setEditing(null);
    setDraft({ title: '', subject: '', description: '', courseId: '' });
    setEditBaseline(null);
    setConfirmDiscard(false);
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete('edit');
      return next;
    }, { replace: true });
  };
  const requestCancelEdit = () => {
    if (isEditDirty) setConfirmDiscard(true);
    else cancelEdit();
  };

  return (
    <div className="portal-layout">
      <PortalSidebar role={role} />
      <section className="portal-content">
        <p className="eyebrow">{isStudent ? 'STUDENT LIBRARY' : 'ORGANIZATION WORKSPACE'}</p>
        <PageHeader title={canCreate ? 'Publish Notes' : 'Notes'} backTo={currentDashboard} breadcrumbs={['Dashboard', canCreate ? 'Publish Notes' : 'Notes']} hasUnsavedChanges={!editing && (Boolean(draft.title || draft.subject || draft.description || draft.courseId) || Boolean(attachment))} />
        <p className="muted">{isStudent ? 'View published learning notes from your organization.' : 'Create, publish, and manage organization learning notes.'}</p>
        {canCreate && <form className="card module-form" onSubmit={(event) => {
          event.preventDefault();
          if (editing) updateMutation.mutate();
          else createMutation.mutate();
        }}>
          {editing
            ? <PageHeader title="Edit note" backTo={noteListRoute} breadcrumbs={['Publish Notes', editing.title, 'Edit']} hasUnsavedChanges={isEditDirty} />
            : <h2>Add Note</h2>}
          <div className="form-grid">
            <Field label="Title" value={draft.title} onChange={(event) => setDraft((value) => ({ ...value, title: event.target.value }))} required maxLength={160} />
            <Field label="Subject / category" value={draft.subject} onChange={(event) => setDraft((value) => ({ ...value, subject: event.target.value }))} required maxLength={100} />
          </div>
          <label className="field"><span>Description</span><textarea className="input textarea" value={draft.description} onChange={(event) => setDraft((value) => ({ ...value, description: event.target.value }))} required maxLength={10000} /></label>
          {(role === 'ORG_ADMIN' || role === 'INSTRUCTOR') && <label className="field"><span>Optional course</span><select className="input" value={draft.courseId} onChange={(event) => setDraft((value) => ({ ...value, courseId: event.target.value }))}><option value="">Not linked to a course</option>{(courseOptions.data?.courses ?? []).map((course) => <option key={course.id} value={course.id}>{course.code} · {course.title}</option>)}</select></label>}
          {!editing && <label className="field"><span>Optional attachment (PDF, PNG, JPG, WEBP · maximum 20 MB)</span><input className="input file-input" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp" onChange={(event) => setAttachment(event.target.files?.[0] ?? null)} /></label>}
          {editing && <p className="muted">To replace an attachment, create a new note with the updated file.</p>}
          {errorMessage && <p className="notice notice-error" role="alert">{errorMessage}</p>}
          <div className="row-actions"><Button type="submit" disabled={isSaving}>{isSaving ? 'Saving…' : editing ? 'Save changes' : 'Save as draft'}</Button>{editing && <Button type="button" variant="secondary" onClick={requestCancelEdit}>Cancel edit</Button>}</div>
        </form>}
        {confirmDiscard && <ConfirmDialog title="Discard changes?" message="You have unsaved changes. Leave this form and discard them?" confirmLabel="Discard changes" onCancel={() => setConfirmDiscard(false)} onConfirm={cancelEdit} />}
        {!canCreate && errorMessage && <p className="notice notice-error" role="alert">{errorMessage}</p>}
        <div className="directory-filters notes-filters">
          <label className="field search-field"><span>Search title or category</span><input className="input" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
          <label className="field"><span>Category</span><select className="input" value={subject} onChange={(event) => setSubject(event.target.value)}><option value="">All categories</option>{subjects.map((value) => <option key={value}>{value}</option>)}</select></label>
        </div>
        {notes.isLoading && <p className="loading">Loading notes…</p>}
        {notes.error && <p className="notice notice-error" role="alert">{notes.error instanceof ApiError ? notes.error.message : 'Could not load notes.'}</p>}
        {notes.data && notesList.length === 0 && <div className="card empty-state"><h2>No notes found</h2><p>{search || subject ? 'Try another search or category.' : 'Published notes will appear here.'}</p></div>}
        {notesList.length > 0 && <div className="notes-grid">{notesList.map((note) => (
          <article className="card note-card" key={note.id}>
            <div className="course-meta"><span className={`status-pill ${note.published ? 'status-published' : 'status-draft'}`}>{note.published ? 'PUBLISHED' : 'DRAFT'}</span><span>{note.subject}</span></div>
            <h2>{note.title}</h2><p className="course-description">{note.description}</p>
            {note.course && <p className="note-author">Course: {note.course.code} · {note.course.title}</p>}
            <p className="note-author">By {note.author.name}{note.originalName ? ` · ${note.originalName}` : ''}</p>
            <div className="course-actions">
              <Button variant="secondary" onClick={() => { setErrorMessage(''); setSearchParams((current) => { const next = new URLSearchParams(current); next.set('view', note.id); return next; }); }}>View</Button>
              {!isStudent && note.originalName && <Button variant="secondary" disabled={downloadMutation.isPending} onClick={() => downloadMutation.mutate(note)}>Download</Button>}
              {!isStudent && canManage(note) && <>
                <Button variant="secondary" onClick={() => {
                  const values = { title: note.title, subject: note.subject, description: note.description, courseId: note.course?.id ?? '' };
                  setEditing(note);
                  setDraft(values);
                  setEditBaseline(values);
                  setErrorMessage('');
                  setSearchParams((current) => { const next = new URLSearchParams(current); next.set('edit', note.id); return next; });
                }}>Edit</Button>
                <Button variant="secondary" disabled={publishMutation.isPending} onClick={() => publishMutation.mutate({ note, publish: !note.published })}>{note.published ? 'Unpublish' : 'Publish'}</Button>
                <Button variant="danger" onClick={() => setPendingDelete(note)}>Delete</Button>
              </>}
            </div>
          </article>
        ))}</div>}
        {viewing && <div className="viewer-backdrop" onContextMenu={isStudent ? (event) => event.preventDefault() : undefined} onDragStart={isStudent ? (event) => event.preventDefault() : undefined} onSelect={(event) => { if (isStudent) event.preventDefault(); }}>
          <section className={`note-viewer card ${isStudent ? 'student-viewer' : ''}`} role="dialog" aria-modal="true" aria-labelledby="note-view-title">
            <div className="viewer-header"><PageHeader title={viewState.note?.title ?? viewing.title} backTo={noteListRoute} breadcrumbs={[canCreate ? 'Publish Notes' : 'Notes', viewing.title]} onBack={() => setSearchParams((current) => { const next = new URLSearchParams(current); next.delete('view'); return next; }, { replace: true })} /><Button variant="secondary" onClick={() => setSearchParams((current) => { const next = new URLSearchParams(current); next.delete('view'); return next; }, { replace: true })}>Close</Button></div>
            {viewState.loading && <p className="loading">Opening note…</p>}
            {viewState.error && <p className="notice notice-error" role="alert">{viewState.error}</p>}
            {viewState.note && <div className="protected-text"><p>{viewState.note.description}</p>{isStudent && <Watermark />}</div>}
            {viewState.blob?.type === 'application/pdf' && <PdfViewer blob={viewState.blob} />}
            {viewState.blob?.type.startsWith('image/') && <ProtectedImage blob={viewState.blob} />}
            {viewState.blob && !viewState.blob.type.startsWith('image/') && viewState.blob.type !== 'application/pdf' && <p className="notice notice-error">This file type cannot be shown in the viewer.</p>}
            {isStudent && <p className="viewer-disclaimer">Watermark and viewer controls are deterrents only. Browsers cannot fully prevent screenshots or saving content.</p>}
          </section>
        </div>}
        {pendingDelete && <ConfirmDialog
          title={`Delete “${pendingDelete.title}”?`}
          message="The note will be removed from the portal. This is a soft delete and the stored file is retained."
          confirmLabel="Delete note"
          busy={deleteMutation.isPending}
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => deleteMutation.mutate(pendingDelete)}
        />}
        {toast && <Toast message={toast} onDismiss={() => setToast('')} />}
      </section>
    </div>
  );
}
