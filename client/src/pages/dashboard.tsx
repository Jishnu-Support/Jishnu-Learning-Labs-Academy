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
    STUDENT: [
      { title: 'My courses', description: 'Browse published courses and continue your learning.', href: '/student/courses', label: 'Open courses' },
    ],
    ORG_ADMIN: [
      { title: 'Courses', description: 'Create organization courses, assign instructors, and track progress.', href: '/org-admin/courses', label: 'Manage courses' },
      { title: 'Pending registrations', description: 'Approve instructors and staff registrations for your organization.', href: '/org-admin/instructors', label: 'Review registrations' },
      { title: 'Media', description: 'Upload and manage course videos and audio.', href: '/org-admin/media', label: 'Upload media' },
    ],
    INSTRUCTOR: [
      { title: 'Courses', description: 'Manage your assigned courses and mark topics as delivered.', href: '/instructor/courses', label: 'Open courses' },
      { title: 'Pending students', description: 'Approve or reject student registrations for your organization.', href: '/instructor/approvals', label: 'Review students' },
      { title: 'Media', description: 'Upload and manage your course videos and audio.', href: '/instructor/media', label: 'Upload media' },
    ],
    STAFF: [
      { title: 'Media', description: 'Upload and manage course videos and audio.', href: '/staff/media', label: 'Upload media' },
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
