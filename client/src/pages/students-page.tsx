import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useAuth } from '../auth/auth-context';
import { ConfirmDialog, Toast } from '../components/feedback';
import { PortalSidebar } from '../components/portal-sidebar';
import { Button } from '../components/ui/button';
import { api, ApiError } from '../lib/api';
import type { AccountStatus } from '../types';

type Student = {
  studentId: string;
  status: AccountStatus;
  createdAt: string;
  user: {
    id: string;
    name: string;
    email: string;
    phone: string | null;
    batches: Array<{ id: string; name: string }>;
  };
};
type StudentDetails = Student & {
  user: Student['user'] & { createdAt: string };
  loginHistory: { lastLoginAt: string | null; recentLogins: Array<{ createdAt: string }> };
};
type StudentResult = { students: Student[]; pagination: { page: number; pageSize: number; total: number; totalPages: number } };

function useDebouncedValue(value: string) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [value]);
  return debounced;
}

function dateLabel(date: string | null | undefined) {
  return date ? new Date(date).toLocaleDateString() : '—';
}

export function StudentsPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Student | null>(null);
  const [pendingAction, setPendingAction] = useState<{ student: Student; action: 'suspend' | 'reactivate' } | null>(null);
  const [toast, setToast] = useState('');
  const debouncedSearch = useDebouncedValue(search);
  const queryString = new URLSearchParams({ page: String(page), pageSize: '10' });
  if (debouncedSearch) queryString.set('search', debouncedSearch);
  if (status) queryString.set('status', status);
  const students = useQuery({
    queryKey: ['students', debouncedSearch, status, page],
    queryFn: () => api<StudentResult>(`/students?${queryString.toString()}`),
  });
  const detail = useQuery({
    queryKey: ['student', selected?.studentId],
    queryFn: () => api<{ student: StudentDetails }>(`/students/${encodeURIComponent(selected!.studentId)}`).then((data) => data.student),
    enabled: Boolean(selected),
  });
  const statusMutation = useMutation({
    mutationFn: ({ student, action }: { student: Student; action: 'suspend' | 'reactivate' }) =>
      api(`/students/${encodeURIComponent(student.studentId)}/${action}`, { method: 'POST' }),
    onSuccess: async (_data, variables) => {
      setPendingAction(null);
      setToast(variables.action === 'suspend' ? 'Student suspended.' : 'Student reactivated.');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['students'] }),
        queryClient.invalidateQueries({ queryKey: ['student', variables.student.studentId] }),
      ]);
    },
  });

  const canManage = user?.role === 'ORG_ADMIN' || user?.role === 'INSTRUCTOR';
  const role = user?.role ?? 'STAFF';
  const result = students.data;
  return (
    <div className="portal-layout">
      <PortalSidebar role={role} />
      <section className="portal-content">
        <p className="eyebrow">ORGANIZATION DIRECTORY</p>
        <h1 className="page-title">Student Details</h1>
        <p className="muted">Search and review student records for your organization.</p>
        <div className="directory-filters">
          <label className="field search-field"><span>Search by student ID or name</span><input className="input" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} /></label>
          <label className="field"><span>Status</span><select className="input" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}><option value="">All statuses</option><option>PENDING</option><option>APPROVED</option><option>REJECTED</option><option>SUSPENDED</option></select></label>
        </div>
        {students.isLoading && <p className="loading">Loading students…</p>}
        {students.error && <p className="notice notice-error" role="alert">{students.error instanceof ApiError ? students.error.message : 'Could not load student records.'}</p>}
        {statusMutation.error && <p className="notice notice-error" role="alert">{statusMutation.error instanceof ApiError ? statusMutation.error.message : 'Student status could not be changed.'}</p>}
        {result && result.students.length === 0 && <div className="card empty-state"><h2>No students found</h2><p>Try changing the search or status filter.</p></div>}
        {result && result.students.length > 0 && (
          <>
            <div className="table-scroll card">
              <table className="data-table">
                <thead><tr><th>Student ID</th><th>Name</th><th>Email</th><th>Contact</th><th>Batch</th><th>Status</th><th>Registered</th><th>Actions</th></tr></thead>
                <tbody>{result.students.map((student) => (
                  <tr key={student.user.id}>
                    <td>{student.studentId}</td><td>{student.user.name}</td><td>{student.user.email}</td><td>{student.user.phone ?? '—'}</td>
                    <td>{student.user.batches.map((batch) => batch.name).join(', ') || '—'}</td><td><span className={`status-pill status-${student.status.toLowerCase()}`}>{student.status}</span></td>
                    <td>{dateLabel(student.createdAt)}</td>
                    <td className="table-actions"><Button variant="secondary" onClick={() => setSelected(student)}>Details</Button>
                      {canManage && student.status === 'APPROVED' && <Button variant="danger" onClick={() => setPendingAction({ student, action: 'suspend' })}>Suspend</Button>}
                      {canManage && student.status === 'SUSPENDED' && <Button onClick={() => setPendingAction({ student, action: 'reactivate' })}>Reactivate</Button>}
                    </td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            <div className="pagination">
              <span>{result.pagination.total} students · Page {result.pagination.page} of {Math.max(result.pagination.totalPages, 1)}</span>
              <div className="row-actions">
                <Button variant="secondary" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</Button>
                <Button variant="secondary" disabled={page >= result.pagination.totalPages} onClick={() => setPage((value) => value + 1)}>Next</Button>
              </div>
            </div>
          </>
        )}
        {selected && (
          <div className="dialog-backdrop">
            <section className="dialog card detail-dialog" role="dialog" aria-modal="true" aria-labelledby="student-detail-title">
              <p className="eyebrow">STUDENT PROFILE · {selected.studentId}</p>
              <h2 id="student-detail-title">{detail.data?.user.name ?? selected.user.name}</h2>
              {detail.isLoading && <p className="loading">Loading profile…</p>}
              {detail.error && <p className="notice notice-error" role="alert">{detail.error instanceof ApiError ? detail.error.message : 'Could not load this student.'}</p>}
              {detail.data && <dl className="detail-grid">
                <dt>Email</dt><dd>{detail.data.user.email}</dd><dt>Contact</dt><dd>{detail.data.user.phone ?? '—'}</dd>
                <dt>Status</dt><dd>{detail.data.status}</dd><dt>Batch</dt><dd>{detail.data.user.batches.map((batch) => batch.name).join(', ') || '—'}</dd>
                <dt>Registered</dt><dd>{dateLabel(detail.data.createdAt)}</dd><dt>Last login</dt><dd>{dateLabel(detail.data.loginHistory.lastLoginAt)}</dd>
                <dt>Recent logins</dt><dd>{detail.data.loginHistory.recentLogins.length ? detail.data.loginHistory.recentLogins.map(({ createdAt }) => dateLabel(createdAt)).join(', ') : 'No successful logins'}</dd>
              </dl>}
              <div className="row-actions"><Button variant="secondary" onClick={() => setSelected(null)}>Close</Button></div>
            </section>
          </div>
        )}
        {pendingAction && <ConfirmDialog
          title={pendingAction.action === 'suspend' ? `Suspend ${pendingAction.student.user.name}?` : `Reactivate ${pendingAction.student.user.name}?`}
          message={pendingAction.action === 'suspend' ? 'This student will be signed out and will not be able to log in until reactivated.' : 'This student will be able to sign in again.'}
          confirmLabel={pendingAction.action === 'suspend' ? 'Suspend student' : 'Reactivate student'}
          busy={statusMutation.isPending}
          onCancel={() => setPendingAction(null)}
          onConfirm={() => statusMutation.mutate(pendingAction)}
        />}
        {toast && <Toast message={toast} onDismiss={() => setToast('')} />}
      </section>
    </div>
  );
}
