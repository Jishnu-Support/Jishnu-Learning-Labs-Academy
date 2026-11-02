import { Link } from 'react-router-dom';
import { useAuth } from '../auth/auth-context';
import { PortalSidebar } from '../components/portal-sidebar';
import type { Role } from '../types';

const roleTitles: Record<Role, string> = {
  STUDENT: 'STUDENT',
  INSTRUCTOR: 'INSTRUCTOR',
  STAFF: 'STAFF',
  ORG_ADMIN: 'ORG ADMIN',
  SUPER_ADMIN: 'SUPER ADMIN',
};

export function Dashboard({ role }: { role: Role }) {
  const { user } = useAuth();
  const links: Partial<Record<Role, Array<{ title: string; description: string; href: string; label: string }>>> = {
    SUPER_ADMIN: [
      { title: 'Organizations', description: 'Monitor organizations and suspend or reactivate access when needed.', href: '/super-admin/organizations', label: 'Manage organizations' },
    ],
    ORG_ADMIN: [
      { title: 'Pending registrations', description: 'Approve instructors and staff registrations for your organization.', href: '/org-admin/instructors', label: 'Review registrations' },
    ],
    INSTRUCTOR: [
      { title: 'Pending students', description: 'Approve or reject student registrations for your organization.', href: '/instructor/approvals', label: 'Review students' },
    ],
  };
  const cards = links[role] ?? [];
  return (
    <div className="portal-layout">
      <PortalSidebar role={role} />
      <section className="dashboard portal-content">
        <p className="eyebrow">{roleTitles[role]} PORTAL</p>
        <h1>Good to have you here, {user?.name.split(' ')[0]}.</h1>
        <p className="muted">You are signed in to your organization’s Jishnu Learning Labs workspace.</p>
        {cards.length > 0
          ? <div className="dashboard-grid">{cards.map((card, index) => (
            <article className="card feature-card" key={card.href}>
              <span className="feature-index">{String(index + 1).padStart(2, '0')}</span>
              <h2>{card.title}</h2>
              <p>{card.description}</p>
              <Link className="text-link" to={card.href}>{card.label} →</Link>
            </article>
          ))}</div>
          : <div className="card empty-state"><h2>Your workspace is ready.</h2><p>Use the sidebar to open your organization modules.</p></div>}
      </section>
    </div>
  );
}
