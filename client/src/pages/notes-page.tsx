import { getDocument, GlobalWorkerOptions, type PDFPageProxy } from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth/auth-context';
import { Field } from '../components/field';
import { ConfirmDialog, Toast } from '../components/feedback';
import { PortalSidebar } from '../components/portal-sidebar';
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
  createdAt: string;
  updatedAt: string;
  author: { id: string; name: string; role: string };
};
type NoteViewerResponse = { data: { note: Pick<Note, 'id' | 'title' | 'subject' | 'description' | 'originalName'> } };
type ViewerState = { blob?: Blob; note?: NoteViewerResponse['data']['note']; error?: string; loading: boolean };

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
  const [search, setSearch] = useState('');
  const [subject, setSubject] = useState('');
  const [editing, setEditing] = useState<Note | null>(null);
  const [viewing, setViewing] = useState<Note | null>(null);
  const [viewState, setViewState] = useState<ViewerState>({ loading: false });
  const [pendingDelete, setPendingDelete] = useState<Note | null>(null);
  const [toast, setToast] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [draft, setDraft] = useState({ title: '', subject: '', description: '' });
  const [attachment, setAttachment] = useState<File | null>(null);
  const queryString = new URLSearchParams();
  if (search.trim()) queryString.set('search', search.trim());
  if (subject) queryString.set('subject', subject);
  const notes = useQuery({
    queryKey: ['notes', search.trim(), subject, role],
    queryFn: () => api<{ notes: Note[] }>(`/notes?${queryString.toString()}`),
  });
  const invalidateNotes = () => queryClient.invalidateQueries({ queryKey: ['notes'] });
  const createMutation = useMutation({
    mutationFn: async () => {
      const body = new FormData();
      body.append('title', draft.title);
      body.append('subject', draft.subject);
      body.append('description', draft.description);
      if (attachment) body.append('file', attachment);
      return api<{ note: Note }>('/notes', { method: 'POST', body });
    },
    onSuccess: async () => {
      setDraft({ title: '', subject: '', description: '' });
      setAttachment(null);
      setToast('Note saved as a draft.');
      setErrorMessage('');
      await invalidateNotes();
    },
    onError: (error) => setErrorMessage(error instanceof ApiError ? error.message : 'Note could not be saved.'),
  });
  const updateMutation = useMutation({
    mutationFn: () => api<{ note: Note }>(`/notes/${editing!.id}`, { method: 'PATCH', body: JSON.stringify(draft) }),
    onSuccess: async () => {
      setEditing(null);
      setDraft({ title: '', subject: '', description: '' });
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

  return (
    <div className="portal-layout">
      <PortalSidebar role={role} />
      <section className="portal-content">
        <p className="eyebrow">{isStudent ? 'STUDENT LIBRARY' : 'ORGANIZATION WORKSPACE'}</p>
        <h1 className="page-title">{canCreate ? 'Publish Notes' : 'Notes'}</h1>
        <p className="muted">{isStudent ? 'View published learning notes from your organization.' : 'Create, publish, and manage organization learning notes.'}</p>
        {canCreate && <form className="card module-form" onSubmit={(event) => {
          event.preventDefault();
          if (editing) updateMutation.mutate();
          else createMutation.mutate();
        }}>
          <h2>{editing ? 'Edit note' : 'Add Note'}</h2>
          <div className="form-grid">
            <Field label="Title" value={draft.title} onChange={(event) => setDraft((value) => ({ ...value, title: event.target.value }))} required maxLength={160} />
            <Field label="Subject / category" value={draft.subject} onChange={(event) => setDraft((value) => ({ ...value, subject: event.target.value }))} required maxLength={100} />
          </div>
          <label className="field"><span>Description</span><textarea className="input textarea" value={draft.description} onChange={(event) => setDraft((value) => ({ ...value, description: event.target.value }))} required maxLength={10000} /></label>
          {!editing && <label className="field"><span>Optional attachment (PDF, PNG, JPG, WEBP · maximum 20 MB)</span><input className="input file-input" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp" onChange={(event) => setAttachment(event.target.files?.[0] ?? null)} /></label>}
          {editing && <p className="muted">To replace an attachment, create a new note with the updated file.</p>}
          {errorMessage && <p className="notice notice-error" role="alert">{errorMessage}</p>}
          <div className="row-actions"><Button type="submit" disabled={isSaving}>{isSaving ? 'Saving…' : editing ? 'Save changes' : 'Save as draft'}</Button>{editing && <Button type="button" variant="secondary" onClick={() => { setEditing(null); setDraft({ title: '', subject: '', description: '' }); }}>Cancel edit</Button>}</div>
        </form>}
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
            <p className="note-author">By {note.author.name}{note.originalName ? ` · ${note.originalName}` : ''}</p>
            <div className="course-actions">
              <Button variant="secondary" onClick={() => { setViewing(note); setErrorMessage(''); }}>View</Button>
              {!isStudent && note.originalName && <Button variant="secondary" disabled={downloadMutation.isPending} onClick={() => downloadMutation.mutate(note)}>Download</Button>}
              {!isStudent && canManage(note) && <>
                <Button variant="secondary" onClick={() => { setEditing(note); setDraft({ title: note.title, subject: note.subject, description: note.description }); setErrorMessage(''); }}>Edit</Button>
                <Button variant="secondary" disabled={publishMutation.isPending} onClick={() => publishMutation.mutate({ note, publish: !note.published })}>{note.published ? 'Unpublish' : 'Publish'}</Button>
                <Button variant="danger" onClick={() => setPendingDelete(note)}>Delete</Button>
              </>}
            </div>
          </article>
        ))}</div>}
        {viewing && <div className="viewer-backdrop" onContextMenu={isStudent ? (event) => event.preventDefault() : undefined} onDragStart={isStudent ? (event) => event.preventDefault() : undefined} onSelect={(event) => { if (isStudent) event.preventDefault(); }}>
          <section className={`note-viewer card ${isStudent ? 'student-viewer' : ''}`} role="dialog" aria-modal="true" aria-labelledby="note-view-title">
            <div className="viewer-header"><div><p className="eyebrow">{viewState.note?.subject ?? viewing.subject}</p><h2 id="note-view-title">{viewState.note?.title ?? viewing.title}</h2></div><Button variant="secondary" onClick={() => setViewing(null)}>Close</Button></div>
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
