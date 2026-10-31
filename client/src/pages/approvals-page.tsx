import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '../components/ui/button';
import { api, ApiError } from '../lib/api';

type Registration = { studentId: string; status: string; user: { id: string; name: string; email: string; createdAt: string } };

export function ApprovalsPage() {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Registration | null>(null);
  const [reason, setReason] = useState('');
  const query = useQuery({ queryKey: ['pending-registrations'], queryFn: () => api<{ registrations: Registration[] }>('/instructor/registrations/pending') });
  const mutation = useMutation({
    mutationFn: ({ studentId, action, reason: decisionReason }: { studentId: string; action: 'approve' | 'reject'; reason?: string }) => api(`/instructor/registrations/${encodeURIComponent(studentId)}/${action}`, { method: 'POST', body: JSON.stringify(decisionReason ? { reason: decisionReason } : {}) }),
    onSuccess: async () => { setSelected(null); setReason(''); await queryClient.invalidateQueries({ queryKey: ['pending-registrations'] }); },
  });
  if (query.isLoading) return <p className="loading">Loading registrations…</p>;
  if (query.error) return <p className="notice notice-error">{query.error instanceof ApiError ? query.error.message : 'Could not load registrations.'}</p>;
  const registrations = query.data?.registrations ?? [];
  return (
    <section>
      <p className="eyebrow">INSTRUCTOR PORTAL</p><h1>Pending approvals</h1><p className="muted">Students in your batches and students not yet assigned to a batch.</p>
      {mutation.error && <p className="notice notice-error" role="alert">{mutation.error instanceof ApiError ? mutation.error.message : 'The decision could not be saved.'}</p>}
      {registrations.length === 0 ? <div className="card empty-state"><h2>All caught up.</h2><p>No registrations are waiting for review.</p></div> : <div className="approval-list">{registrations.map((registration) => <article className="card approval-row" key={registration.studentId}><div><span className="student-id">{registration.studentId}</span><h2>{registration.user.name}</h2><p className="muted">{registration.user.email}</p></div><div className="row-actions"><Button disabled={mutation.isPending} onClick={() => mutation.mutate({ studentId: registration.studentId, action: 'approve' })}>Approve</Button><Button variant="secondary" disabled={mutation.isPending} onClick={() => { setSelected(registration); setReason(''); }}>Reject</Button></div></article>)}</div>}
      {selected && <div className="dialog-backdrop"><section className="dialog card" role="dialog" aria-modal="true" aria-labelledby="reject-title"><p className="eyebrow">REGISTRATION DECISION</p><h2 id="reject-title">Reject {selected.user.name}?</h2><label className="field"><span>Reason (optional)</span><textarea className="input textarea" value={reason} maxLength={1000} onChange={(event) => setReason(event.target.value)} /></label><div className="row-actions"><Button variant="secondary" onClick={() => setSelected(null)}>Cancel</Button><Button variant="danger" disabled={mutation.isPending} onClick={() => mutation.mutate({ studentId: selected.studentId, action: 'reject', reason })}>Confirm rejection</Button></div></section></div>}
    </section>
  );
}
