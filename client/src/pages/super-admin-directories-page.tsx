import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { PageHeader } from '../components/page-header';
import { PortalSidebar } from '../components/portal-sidebar';
import { Button } from '../components/ui/button';
import { api, ApiError } from '../lib/api';
import type { AccountStatus } from '../types';

type Pagination = { page: number; pageSize: number; total: number; totalPages: number };
type Student = {
  studentId: string;
  status: AccountStatus;
  createdAt: string;
  user: { id: string; name: string; email?: string; phone?: string | null; batches: Array<{ id: string; name: string }> };
};
type Tutor = {
  tutorId: string;
  joiningDate: string;
  expertise: string[];
  hasResume: boolean;
  resumeOriginalName: string | null;
  user: { id: string; name: string; email: string; phone: string | null; status: AccountStatus; createdAt: string };
};
type DirectoryResponse<T> = { students?: T[]; tutors?: T[]; pagination: Pagination };

const directoryHeader = (reason: string) => ({ 'X-Access-Reason': reason.trim() });

export function SuperAdminDirectoriesPage() {
  const { organizationId = '' } = useParams();
  const [reason, setReason] = useState('');
  const [search, setSearch] = useState('');
  const [accessReason, setAccessReason] = useState('');
  const [activeSearch, setActiveSearch] = useState('');
  const canLoad = accessReason.length >= 8 && Boolean(organizationId);
  const params = new URLSearchParams({ page: '1', pageSize: '100' });
  if (activeSearch) params.set('search', activeSearch);
  const headers = directoryHeader(accessReason);
  const students = useQuery({
    queryKey: ['super-admin-directory', organizationId, 'students', activeSearch, accessReason],
    queryFn: () => api<DirectoryResponse<Student>>(
      `/super-admin/organizations/${encodeURIComponent(organizationId)}/directories/students?${params}`,
      { headers },
    ),
    enabled: canLoad,
  });
  const tutors = useQuery({
    queryKey: ['super-admin-directory', organizationId, 'tutors', activeSearch, accessReason],
    queryFn: () => api<DirectoryResponse<Tutor>>(
      `/super-admin/organizations/${encodeURIComponent(organizationId)}/directories/tutors?${params}`,
      { headers },
    ),
    enabled: canLoad,
  });

  return (
    <div className="portal-layout">
      <PortalSidebar role="SUPER_ADMIN" />
      <section className="portal-content">
        <PageHeader title="Organization Directories" backTo="/super-admin/organizations" breadcrumbs={['Super Admin', 'Organizations', 'Directories']} />
        <p className="muted">Organization ID: {organizationId}. Each directory view is recorded in the audit log. Student identification data is not displayed here.</p>
        <div className="card form-grid">
          <label className="field"><span>Access reason (8–500 characters)</span><textarea className="input textarea" value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} placeholder="Explain why this directory access is required" /></label>
          <label className="field"><span>Search by name or ID</span><input className="input" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
          <div className="row-actions"><Button disabled={reason.trim().length < 8} onClick={() => { setAccessReason(reason.trim()); setActiveSearch(search.trim()); }}>Access directories</Button></div>
        </div>
        {!canLoad && <p className="muted">Enter a reason of at least 8 characters, then select Access directories.</p>}
        {(students.error || tutors.error) && <p className="notice notice-error" role="alert">
          {[students.error, tutors.error].filter(Boolean).map((error) => error instanceof ApiError ? error.message : 'A directory could not be loaded.').join(' ')}
        </p>}
        {canLoad && (students.isLoading || tutors.isLoading) && <p className="loading" role="status">Loading organization directories…</p>}
        {students.data && <section className="card">
          <h2>Students <span className="muted">({students.data.pagination.total})</span></h2>
          {!students.data.students?.length ? <p className="empty-state">No students found.</p> : <div className="table-scroll"><table className="data-table">
            <thead><tr><th>Student</th><th>Student ID</th><th>Email</th><th>Phone</th><th>Batches</th><th>Status</th><th>Created</th></tr></thead>
            <tbody>{students.data.students.map((student) => <tr key={student.user.id}>
              <td>{student.user.name}</td><td>{student.studentId}</td><td>{student.user.email ?? '—'}</td><td>{student.user.phone ?? '—'}</td>
              <td>{student.user.batches.map((batch) => batch.name).join(', ') || '—'}</td>
              <td><span className={`status-pill status-${student.status.toLowerCase()}`}>{student.status}</span></td>
              <td>{new Date(student.createdAt).toLocaleDateString()}</td>
            </tr>)}</tbody>
          </table></div>}
        </section>}
        {tutors.data && <section className="card">
          <h2>Tutors <span className="muted">({tutors.data.pagination.total})</span></h2>
          {!tutors.data.tutors?.length ? <p className="empty-state">No tutors found.</p> : <div className="table-scroll"><table className="data-table">
            <thead><tr><th>Tutor</th><th>Tutor ID</th><th>Email</th><th>Phone</th><th>Expertise</th><th>Resume</th><th>Status</th></tr></thead>
            <tbody>{tutors.data.tutors.map((tutor) => <tr key={tutor.user.id}>
              <td>{tutor.user.name}</td><td>{tutor.tutorId}</td><td>{tutor.user.email}</td><td>{tutor.user.phone ?? '—'}</td>
              <td>{tutor.expertise.join(', ') || '—'}</td><td>{tutor.hasResume ? tutor.resumeOriginalName : '—'}</td>
              <td><span className={`status-pill status-${tutor.user.status.toLowerCase()}`}>{tutor.user.status}</span></td>
            </tr>)}</tbody>
          </table></div>}
        </section>}
      </section>
    </div>
  );
}
