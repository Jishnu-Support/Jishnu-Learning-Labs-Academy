import { Link, Outlet, useLocation, useNavigate, useNavigationType } from 'react-router-dom';
import { useEffect } from 'react';
import { useAuth } from '../auth/auth-context';
import { recordAppLocation } from '../lib/app-navigation';
import { Button } from './ui/button';

export function Shell() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigationType = useNavigationType();
  const navigate = useNavigate();
  useEffect(() => {
    recordAppLocation(`${location.pathname}${location.search}`, navigationType);
  }, [location.pathname, location.search, navigationType]);

  const signOut = async () => {
    await logout();
    const loginRoute = user?.role === 'SUPER_ADMIN' ? '/super-admin/login'
      : user?.role === 'ORG_ADMIN' ? '/org-admin/login'
        : user?.role === 'INSTRUCTOR' ? '/instructor/login'
          : user?.role === 'STAFF' ? '/staff/login' : '/student/login';
    navigate(loginRoute, { replace: true });
  };
  return (
    <div className="app-shell">
      <header className="topbar">
        <Link className="brand" to="/">Jishnu <span>Learning Labs</span></Link>
        <div className="topbar-actions">
          {user && <span className="user-chip">{user.name} · {user.role.replace('_', ' ')}</span>}
          {user && <Button variant="ghost" onClick={() => void signOut()}>Sign out</Button>}
        </div>
      </header>
      <main className="page-wrap"><Outlet /></main>
      <footer className="footer">
        <span>Learn with clarity. Grow with confidence.</span>
        <Link to="/super-admin/login">Platform Admin</Link>
      </footer>
    </div>
  );
}
