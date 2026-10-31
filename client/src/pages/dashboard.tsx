import { Link } from 'react-router-dom';
import { useAuth } from '../auth/auth-context';

export function Dashboard({ role }: { role: 'STUDENT' | 'INSTRUCTOR' | 'STAFF' | 'SUPER_ADMIN' }) {
  const { user } = useAuth();
  const instructor = role === 'INSTRUCTOR';
  return (
    <section className="dashboard">
      <p className="eyebrow">{role.replace('_', ' ')} PORTAL</p>
      <h1>Good to have you here, {user?.name.split(' ')[0]}.</h1>
      <p className="muted">Your Jishnu Learning Labs workspace is ready.</p>
      <div className="dashboard-grid">
        <article className="card feature-card"><span className="feature-index">01</span><h2>{instructor ? 'Student approvals' : 'Your learning space'}</h2><p>{instructor ? 'Review pending registrations for your batches.' : 'Your courses and learning activity will appear here.'}</p>{instructor && <Link className="text-link" to="/instructor/approvals">Open pending approvals →</Link>}</article>
        <article className="card feature-card"><span className="feature-index">02</span><h2>{instructor ? 'Course studio' : 'Next steps'}</h2><p>{instructor ? 'Create and manage your course outlines.' : 'Phase 1 established accounts and instructor approval.'}</p>{instructor && <Link className="text-link" to="/instructor/courses">Open course studio →</Link>}</article>
      </div>
    </section>
  );
}
