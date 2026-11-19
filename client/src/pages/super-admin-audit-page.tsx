import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PageHeader } from '../components/page-header';
import { PortalSidebar } from '../components/portal-sidebar';
import { api, ApiError } from '../lib/api';
import type { Role } from '../types';

type Session = {
  id: string;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
  logoutAt: string | null;
  active: boolean;
  user: { id: string; name: string; email: string; role: Role };
  organization: { id: string; name: string } | null;
};
type SessionResponse = { sessions: Session[] };

function dateTime(value: string | null) {
  return value ? new Date(value).toLocaleString() : '—';
}

export function SuperAdminAuditPage() {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [search, setSearch] = useState('');
  const [role, setRole] = useState('');
  const query = useQuery({
    queryKey: ['super-admin-audit-sessions', from, to, search, role],
    queryFn: () => {
      const params = new URLSearchParams();
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      if (search.trim()) params.set('user', search.trim());
      if (role) params.set('role', role);
      return api<SessionResponse>(`/super-admin/audit/sessions${params.size ? `?${params}` : ''}`);
    },
  });

  return (
    <div className="portal-layout">
      <PortalSidebar role="SUPER_ADMIN" />
      <section className="portal-content">
        <PageHeader title="Audit & Sessions" backTo="/super-admin/dashboard" breadcrumbs={['Super Admin', 'Audit']} />
        <p className="muted">Review sign-in and session activity across the platform. This view does not expose session tokens.</p>
        <div className="card form-grid">
          <label className="field"><span>From</span><input className="input" type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
          <label className="field"><span>To</span><input className="input" type="date" value={to} min={from || undefined} onChange={(event) => setTo(event.target.value)} /></label>
          <label className="field"><span>User name or email</span><input className="input" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
          <label className="field"><span>Role</span><select className="input" value={role} onChange={(event) => setRole(event.target.value)}><option value="">All roles</option><option value="STUDENT">Student</option><option value="TUTOR">Tutor</option><option value="ORG_ADMIN">Organization Admin</option><option value="SUPER_ADMIN">Super Admin</option></select></label>
        </div>
        {query.isLoading && <p className="loading" role="status">Loading session activity…</p>}
        {query.error && <p className="notice notice-error" role="alert">{query.error instanceof ApiError ? query.error.message : 'Session activity could not be loaded.'}</p>}
        {query.data && (query.data.sessions.length === 0
          ? <div className="card empty-state"><h2>No sessions found</h2><p>Adjust the filters to search other activity.</p></div>
          : <div className="table-scroll"><table className="data-table">
            <thead><tr><th>User</th><th>Role</th><th>Organization</th><th>Signed in</th><th>Signed out</th><th>State</th><th>IP address</th><th>Browser</th></tr></thead>
            <tbody>{query.data.sessions.map((session) => <tr key={session.id}>
              <td>{session.user.name}<br /><span className="muted">{session.user.email}</span></td>
              <td>{session.user.role.replace('_', ' ')}</td>
              <td>{session.organization?.name ?? 'Platform'}</td>
              <td>{dateTime(session.createdAt)}</td>
              <td>{dateTime(session.logoutAt)}</td>
              <td><span className={`status-pill ${session.active ? 'status-approved' : 'status-rejected'}`}>{session.active ? 'Active' : 'Ended'}</span></td>
              <td>{session.ip ?? '—'}</td>
              <td>{session.userAgent ?? '—'}</td>
            </tr>)}</tbody>
          </table></div>)}
      </section>
    </div>
  );
}
