import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { useAuth } from '../auth/auth-context';
import { Field } from '../components/field';
import { ConfirmDialog, Toast } from '../components/feedback';
import { PortalSidebar } from '../components/portal-sidebar';
import { PageHeader } from '../components/page-header';
import { Button } from '../components/ui/button';
import { api, ApiError } from '../lib/api';
import type { AccountStatus } from '../types';

type Tutor = {
  tutorId: string;
  joiningDate: string;
  bio: string | null;
  expertise: string[];
  hasPhoto: boolean;
  createdAt: string;
  user: { id: string; name: string; email: string; phone: string | null; status: AccountStatus; createdAt: string };
};
type TutorResult = { tutors: Tutor[]; pagination: { page: number; pageSize: number; total: number; totalPages: number } };

const tutorFormSchema = z.object({
  tutorId: z.string().trim().regex(/^TUT-[A-Z0-9-]+$/i, 'Use a Tutor ID starting with TUT-').max(40),
  name: z.string().trim().min(2, 'Enter a name').max(120),
  phone: z.string().trim().min(7, 'Enter a valid contact number'),
  email: z.string().trim().email('Enter a valid email address'),
  joiningDate: z.string().date(),
  expertise: z.string().max(800),
  bio: z.string().max(2000),
  temporaryPassword: z.string().min(8, 'Use at least 8 characters').max(128),
});
const editFormSchema = tutorFormSchema.omit({ temporaryPassword: true });

function today() {
  return new Date().toISOString().slice(0, 10);
}

function useDebouncedValue(value: string) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [value]);
  return debounced;
}

function dateLabel(date: string) {
  return new Date(date).toLocaleDateString();
}

function generatedPassword() {
  return window.crypto.randomUUID().replaceAll('-', '');
}

function TutorDirectory({ allowManage }: { allowManage: boolean }) {
  const queryClient = useQueryClient();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState(searchParams.get('search') ?? '');
  const [status, setStatus] = useState(searchParams.get('status') ?? '');
  const [page, setPage] = useState(Number(searchParams.get('page') ?? '1'));
  const [selected, setSelected] = useState<Tutor | null>(null);
  const [editing, setEditing] = useState<Tutor | null>(null);
  const [pendingAction, setPendingAction] = useState<{ tutor: Tutor; action: 'suspend' | 'reactivate' } | null>(null);
  const [toast, setToast] = useState('');
  const searchValue = useDebouncedValue(search);
  useEffect(() => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (searchValue) next.set('search', searchValue);
      else next.delete('search');
      if (status) next.set('status', status);
      else next.delete('status');
      next.set('page', String(page));
      next.set('pageSize', '10');
      return next;
    }, { replace: true });
  }, [page, searchValue, setSearchParams, status]);
  const queryString = new URLSearchParams({ page: String(page), pageSize: '10' });
  if (searchValue) queryString.set('search', searchValue);
  if (status) queryString.set('status', status);
  const tutor = useQuery({
    queryKey: ['tutors', searchValue, status, page],
    queryFn: () => api<TutorResult>(`/tutors?${queryString.toString()}`),
  });
  const detail = useQuery({
    queryKey: ['tutor-detail', selected?.user.id],
    queryFn: () => api<{ tutor: Tutor }>(`/tutors/${selected!.user.id}`),
    enabled: Boolean(selected),
  });
  const statusMutation = useMutation({
    mutationFn: ({ tutor: selectedTutor, action }: { tutor: Tutor; action: 'suspend' | 'reactivate' }) =>
      api(`/tutors/${selectedTutor.user.id}/${action}`, { method: 'POST' }),
    onSuccess: async (_data, variables) => {
      setPendingAction(null);
      setToast(variables.action === 'suspend' ? 'Tutor account suspended.' : 'Tutor account reactivated.');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['tutors'] }),
        queryClient.invalidateQueries({ queryKey: ['tutor-detail', variables.tutor.user.id] }),
      ]);
    },
  });
  const editMutation = useMutation({
    mutationFn: ({ member, values }: { member: Tutor; values: z.infer<typeof editFormSchema> }) =>
      api<{ tutor: Tutor }>(`/tutors/${member.user.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ ...values, expertise: values.expertise.split(',').map((item) => item.trim()).filter(Boolean) }),
      }),
    onSuccess: async () => {
      closeOverlay('edit');
      setToast('Tutor details updated.');
      await Promise.all([queryClient.invalidateQueries({ queryKey: ['tutors'] }), queryClient.invalidateQueries({ queryKey: ['tutor-detail'] })]);
    },
  });
  useEffect(() => {
    const detailId = searchParams.get('detail');
    const editId = searchParams.get('edit');
    setSelected(tutor.data?.tutors.find((member) => member.user.id === detailId) ?? null);
    setEditing(tutor.data?.tutors.find((member) => member.user.id === editId) ?? null);
  }, [searchParams, tutor.data]);

  const openOverlay = (key: 'detail' | 'edit', member: Tutor) => {
    if (key === 'detail') setSelected(member);
    else setEditing(member);
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set(key, member.user.id);
      return next;
    });
  };
  const closeOverlay = (key: 'detail' | 'edit') => {
    if (key === 'detail') setSelected(null);
    else setEditing(null);
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete(key);
      return next;
    }, { replace: true });
  };
  const listRoute = `${location.pathname}?${new URLSearchParams([...searchParams].filter(([key]) => key !== 'detail' && key !== 'edit')).toString()}`;

  return (
    <>
      <div className="directory-filters">
        <label className="field search-field"><span>Search by Tutor ID or name</span><input className="input" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} /></label>
        <label className="field"><span>Status</span><select className="input" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}><option value="">All statuses</option><option>PENDING</option><option>APPROVED</option><option>REJECTED</option><option>SUSPENDED</option></select></label>
      </div>
      {tutor.isLoading && <p className="loading">Loading Tutors…</p>}
      {tutor.error && <p className="notice notice-error" role="alert">{tutor.error instanceof ApiError ? tutor.error.message : 'Could not load Tutor records.'}</p>}
      {statusMutation.error && <p className="notice notice-error" role="alert">{statusMutation.error instanceof ApiError ? statusMutation.error.message : 'Tutor status could not be changed.'}</p>}
      {editMutation.error && <p className="notice notice-error" role="alert">{editMutation.error instanceof ApiError ? editMutation.error.message : 'Tutor details could not be saved.'}</p>}
      {tutor.data && tutor.data.tutors.length === 0 && <div className="card empty-state"><h2>No Tutors found</h2><p>Try changing the search or status filter.</p></div>}
      {tutor.data && tutor.data.tutors.length > 0 && <>
        <div className="table-scroll card">
          <table className="data-table">
            <thead><tr><th>Tutor ID</th><th>Name</th><th>Email</th><th>Contact</th><th>Status</th><th>Joining Date</th><th>Actions</th></tr></thead>
            <tbody>{tutor.data.tutors.map((member) => <tr key={member.user.id}>
              <td>{member.tutorId}</td><td>{member.user.name}</td><td>{member.user.email}</td><td>{member.user.phone ?? '—'}</td>
              <td><span className={`status-pill status-${member.user.status.toLowerCase()}`}>{member.user.status}</span></td><td>{dateLabel(member.joiningDate)}</td>
              <td className="table-actions">
                <Button variant="secondary" onClick={() => openOverlay('detail', member)}>Details</Button>
                {allowManage && <Button variant="secondary" onClick={() => openOverlay('edit', member)}>Edit</Button>}
                {allowManage && member.user.status === 'APPROVED' && <Button variant="danger" onClick={() => setPendingAction({ tutor: member, action: 'suspend' })}>Suspend</Button>}
                {allowManage && member.user.status === 'SUSPENDED' && <Button onClick={() => setPendingAction({ tutor: member, action: 'reactivate' })}>Reactivate</Button>}
              </td>
            </tr>)}</tbody>
          </table>
        </div>
        <div className="pagination">
          <span>{tutor.data.pagination.total} Tutors · Page {tutor.data.pagination.page} of {Math.max(tutor.data.pagination.totalPages, 1)}</span>
          <div className="row-actions">
            <Button variant="secondary" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</Button>
            <Button variant="secondary" disabled={page >= tutor.data.pagination.totalPages} onClick={() => setPage((value) => value + 1)}>Next</Button>
          </div>
        </div>
      </>}
      {selected &&       <div className="dialog-backdrop"><section className="dialog card detail-dialog" role="dialog" aria-modal="true" aria-labelledby="tutor-detail-title">
        <PageHeader title={detail.data?.tutor.user.name ?? selected.user.name} backTo={listRoute} breadcrumbs={['Tutor Details', detail.data?.tutor.tutorId ?? selected.tutorId]} />
        {detail.isLoading && <p className="loading">Loading profile…</p>}
        {detail.error && <p className="notice notice-error" role="alert">{detail.error instanceof ApiError ? detail.error.message : 'Could not load this Tutor.'}</p>}
        {detail.data && <dl className="detail-grid">
          <dt>Email</dt><dd>{detail.data.tutor.user.email}</dd><dt>Contact</dt><dd>{detail.data.tutor.user.phone ?? '—'}</dd>
          <dt>Status</dt><dd>{detail.data.tutor.user.status}</dd><dt>Tutor ID</dt><dd>{detail.data.tutor.tutorId}</dd>
          <dt>Joining date</dt><dd>{dateLabel(detail.data.tutor.joiningDate)}</dd>
          <dt>Expertise</dt><dd>{detail.data.tutor.expertise.join(', ') || '—'}</dd>
          <dt>Bio</dt><dd>{detail.data.tutor.bio || '—'}</dd>
        </dl>}
        {detail.data?.tutor.hasPhoto && <img className="tutor-profile-photo" src={`/api/tutors/${detail.data.tutor.user.id}/photo`} alt={`${detail.data.tutor.user.name} profile`} />}
        <div className="row-actions"><Button variant="secondary" onClick={() => closeOverlay('detail')}>Close</Button></div>
      </section></div>}
      {editing && <TutorEditDialog
        member={editing}
        busy={editMutation.isPending}
        onCancel={() => closeOverlay('edit')}
        onSave={(values) => editMutation.mutate({ member: editing, values })}
      />}
      {pendingAction && <ConfirmDialog
        title={`${pendingAction.action === 'suspend' ? 'Suspend' : 'Reactivate'} ${pendingAction.tutor.user.name}?`}
        message={pendingAction.action === 'suspend' ? 'This Tutor will be signed out and cannot log in until reactivated.' : 'This Tutor will be able to sign in again.'}
        confirmLabel={pendingAction.action === 'suspend' ? 'Suspend Tutor' : 'Reactivate Tutor'}
        busy={statusMutation.isPending}
        onCancel={() => setPendingAction(null)}
        onConfirm={() => statusMutation.mutate(pendingAction)}
      />}
      {toast && <Toast message={toast} onDismiss={() => setToast('')} />}
    </>
  );
}

function TutorEditDialog({
  member,
  busy,
  onCancel,
  onSave,
}: {
  member: Tutor;
  busy: boolean;
  onCancel: () => void;
  onSave: (values: z.infer<typeof editFormSchema>) => void;
}) {
  const form = useForm<z.infer<typeof editFormSchema>>({
    resolver: zodResolver(editFormSchema),
    defaultValues: {
      tutorId: member.tutorId,
      name: member.user.name,
      phone: member.user.phone ?? '',
      email: member.user.email,
      joiningDate: member.joiningDate.slice(0, 10),
      expertise: member.expertise.join(', '),
      bio: member.bio ?? '',
    },
  });
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const requestCancel = () => {
    if (form.formState.isDirty) setConfirmDiscard(true);
    else onCancel();
  };
  return <div className="dialog-backdrop"><section className="dialog card" role="dialog" aria-modal="true" aria-labelledby="edit-tutor-title">
    <PageHeader title={`Edit ${member.user.name}`} backTo="." breadcrumbs={['Tutor Details', member.tutorId, 'Edit']} hasUnsavedChanges={form.formState.isDirty} />
    <form className="form-stack" onSubmit={form.handleSubmit(onSave)}>
      <Field label="Tutor ID" {...form.register('tutorId')} error={form.formState.errors.tutorId?.message} />
      <Field label="Full name" {...form.register('name')} error={form.formState.errors.name?.message} />
      <Field label="Contact number" type="tel" {...form.register('phone')} error={form.formState.errors.phone?.message} />
      <Field label="Email address" type="email" {...form.register('email')} error={form.formState.errors.email?.message} />
      <Field label="Joining date" type="date" {...form.register('joiningDate')} error={form.formState.errors.joiningDate?.message} />
      <Field label="Expertise or subjects (comma-separated)" {...form.register('expertise')} error={form.formState.errors.expertise?.message} />
      <label className="field"><span>Short bio</span><textarea className="input textarea" {...form.register('bio')} /></label>
      <div className="row-actions"><Button type="button" variant="secondary" disabled={busy} onClick={requestCancel}>Cancel</Button><Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</Button></div>
    </form>
    {confirmDiscard && <ConfirmDialog title="Discard changes?" message="You have unsaved changes. Leave this form and discard them?" confirmLabel="Discard changes" onCancel={() => setConfirmDiscard(false)} onConfirm={onCancel} />}
  </section></div>;
}

export function TutorManagementPage() {
  const queryClient = useQueryClient();
  const [temporaryPassword, setTemporaryPassword] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoError, setPhotoError] = useState('');
  const [toast, setToast] = useState('');
  const form = useForm<z.infer<typeof tutorFormSchema>>({
    resolver: zodResolver(tutorFormSchema),
    defaultValues: { tutorId: 'TUT-', name: '', phone: '', email: '', joiningDate: today(), expertise: '', bio: '', temporaryPassword: '' },
  });
  const mutation = useMutation({
    mutationFn: (values: z.infer<typeof tutorFormSchema>) => api<{ tutor: Tutor; temporaryPassword: string }>('/tutors', {
      method: 'POST',
      body: JSON.stringify({ ...values, expertise: values.expertise.split(',').map((item) => item.trim()).filter(Boolean) }),
    }),
    onSuccess: async (result) => {
      setTemporaryPassword(result.temporaryPassword);
      setPhotoError('');
      form.reset({ tutorId: 'TUT-', name: '', phone: '', email: '', joiningDate: today(), expertise: '', bio: '', temporaryPassword: '' });
      setToast('Tutor account created. Save the temporary password now.');
      await queryClient.invalidateQueries({ queryKey: ['tutors'] });
      if (photo) {
        const formData = new FormData();
        formData.set('photo', photo);
        try {
          await api(`/tutors/${result.tutor.user.id}/photo`, { method: 'PUT', body: formData });
          setPhoto(null);
        } catch (error) {
          setPhotoError(error instanceof ApiError ? error.message : 'Tutor photo could not be uploaded.');
        } finally {
          setPhoto(null);
        }
      }
    },
  });
  return (
    <div className="portal-layout">
      <PortalSidebar role="ORG_ADMIN" />
      <section className="portal-content">
        <p className="eyebrow">ORGANIZATION ADMIN</p><PageHeader title="Create Tutor" backTo="/org-admin" breadcrumbs={['Dashboard', 'Create Tutor']} hasUnsavedChanges={form.formState.isDirty} />
        <p className="muted">Create an approved Tutor account. The Tutor must change this temporary password at first sign-in.</p>
        <form className="card module-form" onSubmit={form.handleSubmit((values) => mutation.mutate(values))}>
          <div className="form-grid">
            <Field label="Tutor ID" {...form.register('tutorId')} error={form.formState.errors.tutorId?.message} />
            <Field label="Full name" {...form.register('name')} error={form.formState.errors.name?.message} />
            <Field label="Contact number" type="tel" {...form.register('phone')} error={form.formState.errors.phone?.message} />
            <Field label="Email address" type="email" {...form.register('email')} error={form.formState.errors.email?.message} />
            <Field label="Joining date" type="date" {...form.register('joiningDate')} error={form.formState.errors.joiningDate?.message} />
            <Field label="Expertise or subjects (comma-separated)" {...form.register('expertise')} error={form.formState.errors.expertise?.message} />
            <label className="field"><span>Short bio</span><textarea className="input textarea" {...form.register('bio')} /></label>
            <label className="field"><span>Profile photo (PNG, JPG, WEBP; up to 5 MB)</span><input className="input" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => setPhoto(event.target.files?.[0] ?? null)} /></label>
            <label className="field"><span>Temporary password</span><div className="inline-input"><input className="input" type="text" autoComplete="new-password" {...form.register('temporaryPassword')} /><Button type="button" variant="secondary" onClick={() => form.setValue('temporaryPassword', generatedPassword(), { shouldValidate: true })}>Generate</Button></div>{form.formState.errors.temporaryPassword && <small className="field-error">{form.formState.errors.temporaryPassword.message}</small>}</label>
          </div>
          {mutation.error && <p className="notice notice-error" role="alert">{mutation.error instanceof ApiError ? mutation.error.message : 'Tutor account could not be created.'}</p>}
          {photoError && <p className="notice notice-error" role="alert">{photoError}</p>}
          <Button type="submit" disabled={mutation.isPending}>{mutation.isPending ? 'Creating…' : 'Create Tutor account'}</Button>
          {temporaryPassword && <div className="credential-notice" role="alert"><strong>Temporary password — shown once</strong><code>{temporaryPassword}</code><span>Copy and share this securely. It will not be shown again after leaving this page.</span><Button type="button" variant="secondary" onClick={() => setTemporaryPassword('')}>I have saved it</Button></div>}
        </form>
        <div className="module-section"><h2>Tutor accounts</h2><TutorDirectory allowManage /></div>
        {toast && <Toast message={toast} onDismiss={() => setToast('')} />}
      </section>
    </div>
  );
}

export function TutorDetailsPage() {
  const { user } = useAuth();
  const allowManage = user?.role === 'ORG_ADMIN';
  const dashboardPath = user?.role === 'ORG_ADMIN' ? '/org-admin' : '/tutor';
  return <div className="portal-layout">
    <PortalSidebar role={user?.role ?? 'INSTRUCTOR'} />
    <section className="portal-content">
      <p className="eyebrow">ORGANIZATION DIRECTORY</p><PageHeader title="Tutor Details" backTo={dashboardPath} breadcrumbs={['Dashboard', 'Tutor Details']} />
      <p className="muted">Search Tutor ID or name, and review organization Tutor records.</p>
      <TutorDirectory allowManage={allowManage} />
    </section>
  </div>;
}
