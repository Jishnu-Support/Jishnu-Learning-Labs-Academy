import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '../components/ui/button';
import { PageHeader } from '../components/page-header';
import { api, ApiError } from '../lib/api';

type Registration = {
  studentId: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  interestedCourse: string | null;
  user: { id: string; name: string; email: string; phone?: string | null; createdAt?: string };
};
type RegistrationStatus = Registration['status'];

const statusLabels: Record<RegistrationStatus, string> = {
  PENDING: 'Pending',
  APPROVED: 'Accepted',
  REJECTED: 'Rejected',
};

export function ApprovalsPage() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<RegistrationStatus>('PENDING');
  const [selected, setSelected] = useState<Registration | null>(null);
  const [reason, setReason] = useState('');
  const registrationsPath = '/tutor/registrations';
  const students = useQuery({
    queryKey: ['student-registrations', status],
    queryFn: () => api<{ registrations: Registration[] }>(`${registrationsPath}?status=${status}`),
  });
  const mutation = useMutation({
    mutationFn: ({ registration, action, rejectionReason }: { registration: Registration; action: 'approve' | 'reject'; rejectionReason?: string }) =>
      api(`${registrationsPath}/${encodeURIComponent(registration.studentId)}/${action}`, { method: 'POST', body: JSON.stringify(rejectionReason ? { reason: rejectionReason } : {}) }),
    onSuccess: async () => {
      setSelected(null);
      setReason('');
      await queryClient.invalidateQueries({ queryKey: ['student-registrations'] });
    },
  });
  if (students.isLoading) return <p className="loading">Loading student registrations…</p>;
  if (students.error) return <p className="notice notice-error">{students.error instanceof ApiError ? students.error.message : 'Could not load student registrations.'}</p>;
  const registrations = students.data?.registrations ?? [];
  return (
    <section>
      <p className="eyebrow">TUTOR PORTAL</p>
      <PageHeader title="Student registrations" backTo="/tutor" breadcrumbs={['Dashboard', 'Student Registrations']} />
      <p className="muted">Review registrations for your organization. Identification numbers and parent details are not visible in this review.</p>
      <label className="field registration-status-filter">
        <span>Filter by status</span>
        <select className="input" value={status} onChange={(event) => setStatus(event.target.value as RegistrationStatus)}>
          {Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      {mutation.error && <p className="notice notice-error" role="alert">{mutation.error instanceof ApiError ? mutation.error.message : 'The decision could not be saved.'}</p>}
      {registrations.length === 0
        ? <div className="card empty-state"><h2>No {statusLabels[status].toLowerCase()} registrations.</h2><p>There are no student registrations in this status.</p></div>
        : <div className="approval-list">{registrations.map((registration) => (
          <article className="card approval-row" key={registration.user.id}>
            <div>
              <span className="student-id">{registration.studentId}</span>
              <h2>{registration.user.name}</h2>
              <p className="muted">{registration.user.email} · {registration.user.phone ?? 'No contact number'}</p>
              {registration.interestedCourse && <p className="muted">Interested course: {registration.interestedCourse}</p>}
              <span className={`registration-status status-${registration.status.toLowerCase()}`}>{statusLabels[registration.status]}</span>
            </div>
            {registration.status === 'PENDING' && <div className="row-actions">
              <Button disabled={mutation.isPending} onClick={() => mutation.mutate({ registration, action: 'approve' })}>Accept</Button>
              <Button variant="secondary" disabled={mutation.isPending} onClick={() => { setSelected(registration); setReason(''); }}>Reject</Button>
            </div>}
          </article>
        ))}</div>}
      {selected && <div className="dialog-backdrop"><section className="dialog card" role="dialog" aria-modal="true" aria-labelledby="reject-title"><p className="eyebrow">REGISTRATION DECISION</p><h2 id="reject-title">Reject {selected.user.name}?</h2><label className="field"><span>Reason (optional)</span><textarea className="input textarea" value={reason} maxLength={1000} onChange={(event) => setReason(event.target.value)} /></label><div className="row-actions"><Button variant="secondary" onClick={() => setSelected(null)}>Cancel</Button><Button variant="danger" disabled={mutation.isPending} onClick={() => mutation.mutate({ registration: selected, action: 'reject', rejectionReason: reason })}>Confirm rejection</Button></div></section></div>}
    </section>
  );
}
