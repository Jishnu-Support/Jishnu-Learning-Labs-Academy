import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '../components/ui/button';
import { PageHeader } from '../components/page-header';
import { api, ApiError } from '../lib/api';

type Registration = {
  tutorId: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  fatherName: string | null;
  motherName: string | null;
  interestedCourse: string | null;
  aadhaarNumber: string | null;
  apaarId: string | null;
  user: { id: string; name: string; email: string; phone: string | null };
};
type RegistrationStatus = Registration['status'];

const statusLabels: Record<RegistrationStatus, string> = {
  PENDING: 'Pending',
  APPROVED: 'Accepted',
  REJECTED: 'Rejected',
};

export function TutorApprovalsPage() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<RegistrationStatus>('PENDING');
  const [selected, setSelected] = useState<Registration | null>(null);
  const [reason, setReason] = useState('');
  const query = useQuery({
    queryKey: ['org-admin-tutor-registrations', status],
    queryFn: () => api<{ registrations: Registration[] }>(`/org-admin/tutors/registrations?status=${status}`),
  });
  const mutation = useMutation({
    mutationFn: ({ registration, action, rejectionReason }: {
      registration: Registration;
      action: 'approve' | 'reject';
      rejectionReason?: string;
    }) => api(
      `/org-admin/tutors/${encodeURIComponent(registration.user.id)}/${action}`,
      { method: 'POST', body: JSON.stringify(rejectionReason ? { reason: rejectionReason } : {}) },
    ),
    onSuccess: async () => {
      setSelected(null);
      setReason('');
      await queryClient.invalidateQueries({ queryKey: ['org-admin-tutor-registrations'] });
    },
  });
  if (query.isLoading) return <p className="loading">Loading Tutor registrations…</p>;
  if (query.error) return <p className="notice notice-error">{query.error instanceof ApiError ? query.error.message : 'Could not load registrations.'}</p>;
  const registrations = query.data?.registrations ?? [];
  return (
    <section>
      <p className="eyebrow">ORG ADMIN PORTAL</p>
      <PageHeader title="Tutor registrations" backTo="/org-admin" breadcrumbs={['Dashboard', 'Tutor Registrations']} />
      <p className="muted">Review Tutor registrations in your organization. Identification numbers are shown masked.</p>
      <label className="field registration-status-filter">
        <span>Filter by status</span>
        <select className="input" value={status} onChange={(event) => setStatus(event.target.value as RegistrationStatus)}>
          {Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      {mutation.error && <p className="notice notice-error" role="alert">{mutation.error instanceof ApiError ? mutation.error.message : 'The decision could not be saved.'}</p>}
      {registrations.length === 0
        ? <div className="card empty-state"><h2>No {statusLabels[status].toLowerCase()} registrations.</h2><p>There are no Tutor registrations in this status.</p></div>
        : <div className="approval-list">{registrations.map((registration) => (
          <article className="card approval-row" key={registration.user.id}>
            <div>
              <span className="student-id">{registration.tutorId}</span>
              <h2>{registration.user.name}</h2>
              <p className="muted">{registration.user.email} · {registration.user.phone ?? 'No contact number'}</p>
              <p className="muted">Parents: {registration.motherName ?? 'Not provided'} / {registration.fatherName ?? 'Not provided'}</p>
              {registration.interestedCourse && <p className="muted">Interested course: {registration.interestedCourse}</p>}
              {(registration.aadhaarNumber || registration.apaarId) && <p className="muted">Aadhaar: {registration.aadhaarNumber ?? 'Not provided'} · APAAR ID: {registration.apaarId ?? 'Not provided'}</p>}
              <span className={`registration-status status-${registration.status.toLowerCase()}`}>{statusLabels[registration.status]}</span>
            </div>
            {registration.status === 'PENDING' && <div className="row-actions">
              <Button disabled={mutation.isPending} onClick={() => mutation.mutate({ registration, action: 'approve' })}>Accept</Button>
              <Button variant="secondary" disabled={mutation.isPending} onClick={() => { setSelected(registration); setReason(''); }}>Reject</Button>
            </div>}
          </article>
        ))}</div>}
      {selected && (
        <div className="dialog-backdrop">
          <section className="dialog card" role="dialog" aria-modal="true" aria-labelledby="reject-registration-title">
            <p className="eyebrow">REGISTRATION DECISION</p>
            <h2 id="reject-registration-title">Reject {selected.user.name}?</h2>
            <label className="field">
              <span>Reason (optional)</span>
              <textarea className="input textarea" value={reason} maxLength={1000} onChange={(event) => setReason(event.target.value)} />
            </label>
            <div className="row-actions">
              <Button variant="secondary" onClick={() => setSelected(null)}>Cancel</Button>
              <Button variant="danger" disabled={mutation.isPending} onClick={() => mutation.mutate({ registration: selected, action: 'reject', rejectionReason: reason })}>Confirm rejection</Button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
