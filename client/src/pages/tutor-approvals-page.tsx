import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '../components/ui/button';
import { PageHeader } from '../components/page-header';
import { api, ApiError } from '../lib/api';

type Registration = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
};
export function TutorApprovalsPage() {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Registration | null>(null);
  const [reason, setReason] = useState('');
  const tutors = useQuery({
    queryKey: ['org-admin-pending-tutors'],
    queryFn: async () => {
      const data = await api<{ registrations: Array<{ user: { id: string; name: string; email: string; phone: string | null } }> }>('/org-admin/tutors/pending');
      return data.registrations.map(({ user }) => ({
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
      }));
    },
  });
  const mutation = useMutation({
    mutationFn: ({ registration, action, rejectionReason }: {
      registration: Registration;
      action: 'approve' | 'reject';
      rejectionReason?: string;
    }) => api(
      `/org-admin/tutors/${encodeURIComponent(registration.id)}/${action}`,
      { method: 'POST', body: JSON.stringify(rejectionReason ? { reason: rejectionReason } : {}) },
    ),
    onSuccess: async () => {
      setSelected(null);
      setReason('');
      await queryClient.invalidateQueries({ queryKey: ['org-admin-pending-tutors'] });
    },
  });
  const query = tutors;
  if (query.isLoading) return <p className="loading">Loading registrations…</p>;
  if (query.error) return <p className="notice notice-error">{query.error instanceof ApiError ? query.error.message : 'Could not load registrations.'}</p>;
  const registrations = query.data ?? [];
  return (
    <section>
      <p className="eyebrow">ORG ADMIN PORTAL</p>
      <PageHeader title="Pending registrations" backTo="/org-admin" breadcrumbs={['Dashboard', 'Pending Registrations']} />
      <p className="muted">Approve or reject Tutor registrations in your organization.</p>
      {mutation.error && <p className="notice notice-error" role="alert">{mutation.error instanceof ApiError ? mutation.error.message : 'The decision could not be saved.'}</p>}
      {registrations.length === 0
        ? <div className="card empty-state"><h2>All caught up.</h2><p>No Tutors are waiting for review.</p></div>
        : <div className="approval-list">{registrations.map((registration) => (
          <article className="card approval-row" key={registration.id}>
            <div><h2>{registration.name}</h2><p className="muted">{registration.email} · {registration.phone ?? 'No contact number'}</p></div>
            <div className="row-actions">
              <Button disabled={mutation.isPending} onClick={() => mutation.mutate({ registration, action: 'approve' })}>Approve</Button>
              <Button variant="secondary" disabled={mutation.isPending} onClick={() => { setSelected(registration); setReason(''); }}>Reject</Button>
            </div>
          </article>
        ))}</div>}
      {selected && (
        <div className="dialog-backdrop">
          <section className="dialog card" role="dialog" aria-modal="true" aria-labelledby="reject-registration-title">
            <p className="eyebrow">REGISTRATION DECISION</p>
            <h2 id="reject-registration-title">Reject {selected.name}?</h2>
            <label className="field">
              <span>Reason (required)</span>
              <textarea className="input textarea" value={reason} maxLength={1000} onChange={(event) => setReason(event.target.value)} />
            </label>
            <div className="row-actions">
              <Button variant="secondary" onClick={() => setSelected(null)}>Cancel</Button>
              <Button variant="danger" disabled={mutation.isPending || !reason.trim()} onClick={() => mutation.mutate({ registration: selected, action: 'reject', rejectionReason: reason })}>Confirm rejection</Button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
