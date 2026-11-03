import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/auth-context';
import { ConfirmDialog, Toast } from '../components/feedback';
import { PageHeader } from '../components/page-header';
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
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState(searchParams.get('search') ?? '');
  const [status, setStatus] = useState(searchParams.get('status') ?? '');
  const [page, setPage] = useState(Number(searchParams.get('page') ?? '1'));
  const [selected, setSelected] = useState<Student | null>(null);
  const [pendingAction, setPendingAction] = useState<{ student: Student; action: 'suspend' | 'reactivate' } | null>(null);
  const [toast, setToast] = useState('');
  const debouncedSearch = useDebouncedValue(search);
  useEffect(() => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (debouncedSearch) next.set('search', debouncedSearch);
      else next.delete('search');
      if (status) next.set('status', status);
      else next.delete('status');
      next.set('page', String(page));
      next.set('pageSize', '10');
      return next;
    }, { replace: true });
  }, [debouncedSearch, page, setSearchParams, status]);
  const queryString = new URLSearchParams({ page: String(page), pageSize: '10' });
  if (debouncedSearch) queryString.set('search', debouncedSearch);
  if (status) queryString.set('status', status);
  const students = useQuery({
    queryKey: ['students', debouncedSearch, status, page],
    queryFn: () => api<StudentResult>(`/students?${queryString.toString()}`),
  });
  useEffect(() => {
    const detailId = searchParams.get('detail');
    if (!detailId) {
      setSelected(null);
      return;
    }
    const match = students.data?.students.find((student) => student.studentId === detailId);
    if (match) setSelected(match);
  }, [searchParams, students.data]);
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
  const listRoute = role === 'ORG_ADMIN' ? '/org-admin/students' : role === 'INSTRUCTOR' ? '/instructor/students' : '/staff/students';
  const openStudent = (student: Student) => {
    setSelected(student);
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set('detail', student.studentId);
      return next;
    });
  };
  const closeStudent = () => {
    setSelected(null);
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete('detail');
      return next;
    }, { replace: true });
  };
  return (
    <div className="portal-layout">
      <PortalSidebar role={role} />
      <section className="portal-content">
        <p className="eyebrow">ORGANIZATION DIRECTORY</p>
        <PageHeader title="Student Details" backTo={`/${role.toLowerCase().replace('_', '-')}`} breadcrumbs={['Dashboard', 'Student Details']} />
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
                    <td className="table-actions"><Button variant="secondary" onClick={() => openStudent(student)}>Details</Button>
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
              <PageHeader title={detail.data?.user.name ?? selected.user.name} backTo={`${listRoute}?${new URLSearchParams([...searchParams].filter(([key]) => key !== 'detail')).toString()}`} breadcrumbs={['Dashboard', 'Student Details', selected.studentId]} onBack={closeStudent} />
              {detail.isLoading && <p className="loading">Loading profile…</p>}
              {detail.error && <p className="notice notice-error" role="alert">{detail.error instanceof ApiError ? detail.error.message : 'Could not load this student.'}</p>}
              {detail.data && <dl className="detail-grid">
                <dt>Email</dt><dd>{detail.data.user.email}</dd><dt>Contact</dt><dd>{detail.data.user.phone ?? '—'}</dd>
                <dt>Status</dt><dd>{detail.data.status}</dd><dt>Batch</dt><dd>{detail.data.user.batches.map((batch) => batch.name).join(', ') || '—'}</dd>
                <dt>Registered</dt><dd>{dateLabel(detail.data.createdAt)}</dd><dt>Last login</dt><dd>{dateLabel(detail.data.loginHistory.lastLoginAt)}</dd>
                <dt>Recent logins</dt><dd>{detail.data.loginHistory.recentLogins.length ? detail.data.loginHistory.recentLogins.map(({ createdAt }) => dateLabel(createdAt)).join(', ') : 'No successful logins'}</dd>
              </dl>}
              <div className="row-actions"><Button variant="secondary" onClick={closeStudent}>Close</Button></div>
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
