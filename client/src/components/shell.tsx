import { Link, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/auth-context';
import { Button } from './ui/button';

export function Shell() {
  const { user, logout } = useAuth();
  return (
    <div className="app-shell">
      <header className="topbar">
        <Link className="brand" to="/">Jishnu <span>Learning Labs</span></Link>
        <div className="topbar-actions">
          {user && <span className="user-chip">{user.name} · {user.role.replace('_', ' ')}</span>}
          {user && <Button variant="ghost" onClick={() => void logout()}>Sign out</Button>}
        </div>
      </header>
      <main className="page-wrap"><Outlet /></main>
      <footer className="footer">Learn with clarity. Grow with confidence.</footer>
    </div>
  );
}
