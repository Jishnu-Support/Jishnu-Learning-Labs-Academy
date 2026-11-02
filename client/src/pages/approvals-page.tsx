import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '../components/ui/button';
import { api, ApiError } from '../lib/api';

type Registration = {
  studentId?: string;
  user: { id: string; name: string; email: string; phone?: string | null; createdAt?: string };
};

export function ApprovalsPage() {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Registration | null>(null);
  const [reason, setReason] = useState('');
  const students = useQuery({ queryKey: ['pending-registrations'], queryFn: () => api<{ registrations: Registration[] }>('/instructor/registrations/pending') });
  const mutation = useMutation({
    mutationFn: ({ registration, action, rejectionReason }: { registration: Registration; action: 'approve' | 'reject'; rejectionReason?: string }) =>
      api(`/instructor/registrations/${encodeURIComponent(registration.studentId ?? '')}/${action}`, { method: 'POST', body: JSON.stringify(rejectionReason ? { reason: rejectionReason } : {}) }),
    onSuccess: async () => {
      setSelected(null);
      setReason('');
      await queryClient.invalidateQueries({ queryKey: ['pending-registrations'] });
    },
  });
  if (students.isLoading) return <p className="loading">Loading student registrations…</p>;
  if (students.error) return <p className="notice notice-error">{students.error instanceof ApiError ? students.error.message : 'Could not load student registrations.'}</p>;
  const registrations = students.data?.registrations ?? [];
  return (
    <section>
      <p className="eyebrow">INSTRUCTOR PORTAL</p><h1>Pending students</h1>
      <p className="muted">Review student registrations for your organization.</p>
      {mutation.error && <p className="notice notice-error" role="alert">{mutation.error instanceof ApiError ? mutation.error.message : 'The decision could not be saved.'}</p>}
      {registrations.length === 0 ? <div className="card empty-state"><h2>All caught up.</h2><p>No students are waiting for review.</p></div> : <div className="approval-list">{registrations.map((registration) => <article className="card approval-row" key={registration.user.id}><div>{registration.studentId && <span className="student-id">{registration.studentId}</span>}<h2>{registration.user.name}</h2><p className="muted">{registration.user.email} · {registration.user.phone ?? 'No contact number'}</p></div><div className="row-actions"><Button disabled={mutation.isPending} onClick={() => mutation.mutate({ registration, action: 'approve' })}>Approve</Button><Button variant="secondary" disabled={mutation.isPending} onClick={() => { setSelected(registration); setReason(''); }}>Reject</Button></div></article>)}</div>}
      {selected && <div className="dialog-backdrop"><section className="dialog card" role="dialog" aria-modal="true" aria-labelledby="reject-title"><p className="eyebrow">REGISTRATION DECISION</p><h2 id="reject-title">Reject {selected.user.name}?</h2><label className="field"><span>Reason (required)</span><textarea className="input textarea" value={reason} maxLength={1000} onChange={(event) => setReason(event.target.value)} /></label><div className="row-actions"><Button variant="secondary" onClick={() => setSelected(null)}>Cancel</Button><Button variant="danger" disabled={mutation.isPending || !reason.trim()} onClick={() => mutation.mutate({ registration: selected, action: 'reject', rejectionReason: reason })}>Confirm rejection</Button></div></section></div>}
    </section>
  );
}
