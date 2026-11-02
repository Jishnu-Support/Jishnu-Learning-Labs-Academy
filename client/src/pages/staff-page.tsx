import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { useAuth } from '../auth/auth-context';
import { Field } from '../components/field';
import { ConfirmDialog, Toast } from '../components/feedback';
import { PortalSidebar } from '../components/portal-sidebar';
import { Button } from '../components/ui/button';
import { api, ApiError } from '../lib/api';
import type { AccountStatus } from '../types';

type Staff = {
  staffId: string;
  joiningDate: string;
  createdAt: string;
  user: { id: string; name: string; email: string; phone: string | null; status: AccountStatus; createdAt: string };
};
type StaffResult = { staff: Staff[]; pagination: { page: number; pageSize: number; total: number; totalPages: number } };

const staffFormSchema = z.object({
  staffId: z.string().trim().min(1, 'Enter a Staff ID').max(40),
  name: z.string().trim().min(2, 'Enter a name').max(120),
  phone: z.string().trim().min(7, 'Enter a valid contact number'),
  email: z.string().trim().email('Enter a valid email address'),
  joiningDate: z.string().date(),
  temporaryPassword: z.string().min(8, 'Use at least 8 characters').max(128),
});
const editFormSchema = staffFormSchema.omit({ temporaryPassword: true });

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

function StaffDirectory({ allowManage }: { allowManage: boolean }) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Staff | null>(null);
  const [editing, setEditing] = useState<Staff | null>(null);
  const [pendingAction, setPendingAction] = useState<{ staff: Staff; action: 'suspend' | 'reactivate' } | null>(null);
  const [toast, setToast] = useState('');
  const searchValue = useDebouncedValue(search);
  const queryString = new URLSearchParams({ page: String(page), pageSize: '10' });
  if (searchValue) queryString.set('search', searchValue);
  if (status) queryString.set('status', status);
  const staff = useQuery({
    queryKey: ['staff', searchValue, status, page],
    queryFn: () => api<StaffResult>(`/staff?${queryString.toString()}`),
  });
  const detail = useQuery({
    queryKey: ['staff-detail', selected?.user.id],
    queryFn: () => api<{ staff: Staff }>(`/staff/${selected!.user.id}`),
    enabled: Boolean(selected),
  });
  const statusMutation = useMutation({
    mutationFn: ({ staff: selectedStaff, action }: { staff: Staff; action: 'suspend' | 'reactivate' }) =>
      api(`/staff/${selectedStaff.user.id}/${action}`, { method: 'POST' }),
    onSuccess: async (_data, variables) => {
      setPendingAction(null);
      setToast(variables.action === 'suspend' ? 'Staff account suspended.' : 'Staff account reactivated.');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['staff'] }),
        queryClient.invalidateQueries({ queryKey: ['staff-detail', variables.staff.user.id] }),
      ]);
    },
  });
  const editMutation = useMutation({
    mutationFn: ({ member, values }: { member: Staff; values: z.infer<typeof editFormSchema> }) =>
      api<{ staff: Staff }>(`/staff/${member.user.id}`, { method: 'PATCH', body: JSON.stringify(values) }),
    onSuccess: async () => {
      setEditing(null);
      setToast('Staff details updated.');
      await Promise.all([queryClient.invalidateQueries({ queryKey: ['staff'] }), queryClient.invalidateQueries({ queryKey: ['staff-detail'] })]);
    },
  });

  return (
    <>
      <div className="directory-filters">
        <label className="field search-field"><span>Search by Staff ID or name</span><input className="input" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} /></label>
        <label className="field"><span>Status</span><select className="input" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}><option value="">All statuses</option><option>PENDING</option><option>APPROVED</option><option>REJECTED</option><option>SUSPENDED</option></select></label>
      </div>
      {staff.isLoading && <p className="loading">Loading staff…</p>}
      {staff.error && <p className="notice notice-error" role="alert">{staff.error instanceof ApiError ? staff.error.message : 'Could not load staff records.'}</p>}
      {statusMutation.error && <p className="notice notice-error" role="alert">{statusMutation.error instanceof ApiError ? statusMutation.error.message : 'Staff status could not be changed.'}</p>}
      {editMutation.error && <p className="notice notice-error" role="alert">{editMutation.error instanceof ApiError ? editMutation.error.message : 'Staff details could not be saved.'}</p>}
      {staff.data && staff.data.staff.length === 0 && <div className="card empty-state"><h2>No staff found</h2><p>Try changing the search or status filter.</p></div>}
      {staff.data && staff.data.staff.length > 0 && <>
        <div className="table-scroll card">
          <table className="data-table">
            <thead><tr><th>Staff ID</th><th>Name</th><th>Email</th><th>Contact</th><th>Status</th><th>Joining Date</th><th>Actions</th></tr></thead>
            <tbody>{staff.data.staff.map((member) => <tr key={member.user.id}>
              <td>{member.staffId}</td><td>{member.user.name}</td><td>{member.user.email}</td><td>{member.user.phone ?? '—'}</td>
              <td><span className={`status-pill status-${member.user.status.toLowerCase()}`}>{member.user.status}</span></td><td>{dateLabel(member.joiningDate)}</td>
              <td className="table-actions">
                <Button variant="secondary" onClick={() => setSelected(member)}>Details</Button>
                {allowManage && <Button variant="secondary" onClick={() => setEditing(member)}>Edit</Button>}
                {allowManage && member.user.status === 'APPROVED' && <Button variant="danger" onClick={() => setPendingAction({ staff: member, action: 'suspend' })}>Suspend</Button>}
                {allowManage && member.user.status === 'SUSPENDED' && <Button onClick={() => setPendingAction({ staff: member, action: 'reactivate' })}>Reactivate</Button>}
              </td>
            </tr>)}</tbody>
          </table>
        </div>
        <div className="pagination">
          <span>{staff.data.pagination.total} staff · Page {staff.data.pagination.page} of {Math.max(staff.data.pagination.totalPages, 1)}</span>
          <div className="row-actions">
            <Button variant="secondary" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</Button>
            <Button variant="secondary" disabled={page >= staff.data.pagination.totalPages} onClick={() => setPage((value) => value + 1)}>Next</Button>
          </div>
        </div>
      </>}
      {selected && <div className="dialog-backdrop"><section className="dialog card detail-dialog" role="dialog" aria-modal="true" aria-labelledby="staff-detail-title">
        <p className="eyebrow">STAFF PROFILE · {detail.data?.staff.staffId ?? selected.staffId}</p><h2 id="staff-detail-title">{detail.data?.staff.user.name ?? selected.user.name}</h2>
        {detail.isLoading && <p className="loading">Loading profile…</p>}
        {detail.error && <p className="notice notice-error" role="alert">{detail.error instanceof ApiError ? detail.error.message : 'Could not load this staff member.'}</p>}
        {detail.data && <dl className="detail-grid">
          <dt>Email</dt><dd>{detail.data.staff.user.email}</dd><dt>Contact</dt><dd>{detail.data.staff.user.phone ?? '—'}</dd>
          <dt>Status</dt><dd>{detail.data.staff.user.status}</dd><dt>Staff ID</dt><dd>{detail.data.staff.staffId}</dd>
          <dt>Joining date</dt><dd>{dateLabel(detail.data.staff.joiningDate)}</dd>
        </dl>}
        <div className="row-actions"><Button variant="secondary" onClick={() => setSelected(null)}>Close</Button></div>
      </section></div>}
      {editing && <StaffEditDialog
        member={editing}
        busy={editMutation.isPending}
        onCancel={() => setEditing(null)}
        onSave={(values) => editMutation.mutate({ member: editing, values })}
      />}
      {pendingAction && <ConfirmDialog
        title={`${pendingAction.action === 'suspend' ? 'Suspend' : 'Reactivate'} ${pendingAction.staff.user.name}?`}
        message={pendingAction.action === 'suspend' ? 'This staff member will be signed out and cannot log in until reactivated.' : 'This staff member will be able to sign in again.'}
        confirmLabel={pendingAction.action === 'suspend' ? 'Suspend staff' : 'Reactivate staff'}
        busy={statusMutation.isPending}
        onCancel={() => setPendingAction(null)}
        onConfirm={() => statusMutation.mutate(pendingAction)}
      />}
      {toast && <Toast message={toast} onDismiss={() => setToast('')} />}
    </>
  );
}

function StaffEditDialog({
  member,
  busy,
  onCancel,
  onSave,
}: {
  member: Staff;
  busy: boolean;
  onCancel: () => void;
  onSave: (values: z.infer<typeof editFormSchema>) => void;
}) {
  const form = useForm<z.infer<typeof editFormSchema>>({
    resolver: zodResolver(editFormSchema),
    defaultValues: {
      staffId: member.staffId,
      name: member.user.name,
      phone: member.user.phone ?? '',
      email: member.user.email,
      joiningDate: member.joiningDate.slice(0, 10),
    },
  });
  return <div className="dialog-backdrop"><section className="dialog card" role="dialog" aria-modal="true" aria-labelledby="edit-staff-title">
    <p className="eyebrow">UPDATE STAFF RECORD</p><h2 id="edit-staff-title">Edit {member.user.name}</h2>
    <form className="form-stack" onSubmit={form.handleSubmit(onSave)}>
      <Field label="Staff ID" {...form.register('staffId')} error={form.formState.errors.staffId?.message} />
      <Field label="Full name" {...form.register('name')} error={form.formState.errors.name?.message} />
      <Field label="Contact number" type="tel" {...form.register('phone')} error={form.formState.errors.phone?.message} />
      <Field label="Email address" type="email" {...form.register('email')} error={form.formState.errors.email?.message} />
      <Field label="Joining date" type="date" {...form.register('joiningDate')} error={form.formState.errors.joiningDate?.message} />
      <div className="row-actions"><Button type="button" variant="secondary" disabled={busy} onClick={onCancel}>Cancel</Button><Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</Button></div>
    </form>
  </section></div>;
}

export function StaffManagementPage() {
  const queryClient = useQueryClient();
  const [temporaryPassword, setTemporaryPassword] = useState('');
  const [toast, setToast] = useState('');
  const form = useForm<z.infer<typeof staffFormSchema>>({
    resolver: zodResolver(staffFormSchema),
    defaultValues: { staffId: '', name: '', phone: '', email: '', joiningDate: today(), temporaryPassword: '' },
  });
  const mutation = useMutation({
    mutationFn: (values: z.infer<typeof staffFormSchema>) => api<{ staff: Staff; temporaryPassword: string }>('/staff', { method: 'POST', body: JSON.stringify(values) }),
    onSuccess: async (result) => {
      setTemporaryPassword(result.temporaryPassword);
      form.reset({ staffId: '', name: '', phone: '', email: '', joiningDate: today(), temporaryPassword: '' });
      setToast('Staff account created. Save the temporary password now.');
      await queryClient.invalidateQueries({ queryKey: ['staff'] });
    },
  });
  return (
    <div className="portal-layout">
      <PortalSidebar role="ORG_ADMIN" />
      <section className="portal-content">
        <p className="eyebrow">ORGANIZATION ADMIN</p><h1 className="page-title">Create Staff</h1>
        <p className="muted">Create an approved staff account. The staff member must change this temporary password at first sign-in.</p>
        <form className="card module-form" onSubmit={form.handleSubmit((values) => mutation.mutate(values))}>
          <div className="form-grid">
            <Field label="Staff ID" {...form.register('staffId')} error={form.formState.errors.staffId?.message} />
            <Field label="Full name" {...form.register('name')} error={form.formState.errors.name?.message} />
            <Field label="Contact number" type="tel" {...form.register('phone')} error={form.formState.errors.phone?.message} />
            <Field label="Email address" type="email" {...form.register('email')} error={form.formState.errors.email?.message} />
            <Field label="Joining date" type="date" {...form.register('joiningDate')} error={form.formState.errors.joiningDate?.message} />
            <label className="field"><span>Temporary password</span><div className="inline-input"><input className="input" type="text" autoComplete="new-password" {...form.register('temporaryPassword')} /><Button type="button" variant="secondary" onClick={() => form.setValue('temporaryPassword', generatedPassword(), { shouldValidate: true })}>Generate</Button></div>{form.formState.errors.temporaryPassword && <small className="field-error">{form.formState.errors.temporaryPassword.message}</small>}</label>
          </div>
          {mutation.error && <p className="notice notice-error" role="alert">{mutation.error instanceof ApiError ? mutation.error.message : 'Staff account could not be created.'}</p>}
          <Button type="submit" disabled={mutation.isPending}>{mutation.isPending ? 'Creating…' : 'Create staff account'}</Button>
          {temporaryPassword && <div className="credential-notice" role="alert"><strong>Temporary password — shown once</strong><code>{temporaryPassword}</code><span>Copy and share this securely. It will not be shown again after leaving this page.</span><Button type="button" variant="secondary" onClick={() => setTemporaryPassword('')}>I have saved it</Button></div>}
        </form>
        <div className="module-section"><h2>Staff accounts</h2><StaffDirectory allowManage /></div>
        {toast && <Toast message={toast} onDismiss={() => setToast('')} />}
      </section>
    </div>
  );
}

export function StaffDetailsPage() {
  const { user } = useAuth();
  const allowManage = user?.role === 'ORG_ADMIN';
  return <div className="portal-layout">
    <PortalSidebar role={user?.role ?? 'INSTRUCTOR'} />
    <section className="portal-content">
      <p className="eyebrow">ORGANIZATION DIRECTORY</p><h1 className="page-title">Staff Details</h1>
      <p className="muted">Search staff ID or name, and review organization staff records.</p>
      <StaffDirectory allowManage={allowManage} />
    </section>
  </div>;
}
