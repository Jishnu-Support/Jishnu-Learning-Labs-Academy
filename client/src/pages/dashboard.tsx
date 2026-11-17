import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/auth-context';
import { PortalSidebar } from '../components/portal-sidebar';
import { Toast } from '../components/feedback';
import { DailyWisdomCards } from '../components/daily-wisdom-cards';
import type { Role } from '../types';

const roleTitles: Record<Role, string> = {
  STUDENT: 'STUDENT',
  TUTOR: 'TUTOR',
  ORG_ADMIN: 'ORG ADMIN',
  SUPER_ADMIN: 'SUPER ADMIN',
};

export function Dashboard({ role }: { role: Role }) {
  const { user } = useAuth();
  const location = useLocation();
  const toastMessage = typeof location.state === 'object' && location.state && 'toast' in location.state
    ? String((location.state as { toast?: string }).toast)
    : '';
  const links: Partial<Record<Role, Array<{ title: string; description: string; href: string; label: string }>>> = {
    SUPER_ADMIN: [
      { title: 'Payments', description: 'Review organization-wide fee activity and payment settings.', href: '/super-admin/payments', label: 'Manage payments' },
      { title: 'Organizations', description: 'Monitor organizations and suspend or reactivate access when needed.', href: '/super-admin/organizations', label: 'Manage organizations' },
    ],
    STUDENT: [
      { title: 'My Course', description: 'Continue learning in your active courses and open course materials.', href: '/student/courses', label: 'Open My Course' },
      { title: 'Library', description: 'Browse your available learning books and resources.', href: '/student/library', label: 'Open Library' },
    ],
    ORG_ADMIN: [
      { title: 'Payments', description: 'Review organization fee payments, subscriptions, refunds, and settings.', href: '/org-admin/payments', label: 'Manage payments' },
      { title: 'Courses', description: 'Create organization courses, assign Tutors, and track progress.', href: '/org-admin/courses', label: 'Manage courses' },
      { title: 'Pending Tutors', description: 'Review Tutor registrations for your organization.', href: '/org-admin/tutors/pending', label: 'Review registrations' },
      { title: 'Media', description: 'Upload and manage course videos and audio.', href: '/org-admin/media', label: 'Upload media' },
    ],
    TUTOR: [
      { title: 'My Course', description: 'Manage your assigned courses, study materials, assessments, and progress.', href: '/tutor/courses', label: 'Open My Course' },
      { title: 'Expert Sessions', description: 'Schedule or host sessions for your assigned courses.', href: '/tutor/sessions', label: 'Open Expert Sessions' },
    ],
  };
  const cards = links[role] ?? [];
  return (
    <div className="portal-layout">
      <PortalSidebar role={role} />
      <section className="dashboard portal-content">
        {toastMessage && <Toast message={toastMessage} onDismiss={() => {}} />}
        <p className="eyebrow">{roleTitles[role]} PORTAL</p>
        <h1>Good to have you here, {user?.name.split(' ')[0]}.</h1>
        <p className="muted">You are signed in to your organization’s Jishnu Learning Labs workspace.</p>
        <DailyWisdomCards />
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
