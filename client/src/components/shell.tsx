import { Link, Outlet, useLocation, useNavigate, useNavigationType } from 'react-router-dom';
import { useEffect } from 'react';
import { useAuth } from '../auth/auth-context';
import { recordAppLocation } from '../lib/app-navigation';
import { BrandIntroGate } from './brand-intro';
import { BrandLogo } from './brand-logo';
import { BrandWallpaper } from './brand-wallpaper';
import { Button } from './ui/button';

export function Shell() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigationType = useNavigationType();
  const navigate = useNavigate();
  const isAuthSurface = /^\/(student|instructor|staff|org-admin|super-admin)\/(login|register)$/.test(location.pathname)
    || location.pathname === '/organizations/register';
  useEffect(() => {
    recordAppLocation(`${location.pathname}${location.search}`, navigationType);
  }, [location.pathname, location.search, navigationType]);

  useEffect(() => {
    const loginMatch = location.pathname.match(/^\/(student|instructor|staff|org-admin|super-admin)\/login$/);
    const roleLabel = loginMatch?.[1]?.replace('-', ' ');
    const pageTitle = roleLabel
      ? `${roleLabel.replace(/\b\w/g, (letter) => letter.toUpperCase())} Login`
      : location.pathname === '/organizations/register'
        ? 'Organization Registration'
        : location.pathname === '/change-password'
          ? 'Change Password'
          : location.pathname.startsWith('/student')
            ? 'Student Portal'
            : location.pathname.startsWith('/instructor')
              ? 'Instructor Portal'
              : location.pathname.startsWith('/org-admin')
                ? 'Organization Admin Portal'
                : location.pathname.startsWith('/staff')
                  ? 'Staff Portal'
                  : location.pathname.startsWith('/super-admin')
                    ? 'Platform Admin'
                    : 'Learning Platform';
    document.title = `Jishnu Learning Labs | ${pageTitle}`;
  }, [location.pathname]);

  const signOut = async () => {
    await logout();
    const loginRoute = user?.role === 'SUPER_ADMIN' ? '/super-admin/login'
      : user?.role === 'ORG_ADMIN' ? '/org-admin/login'
        : user?.role === 'INSTRUCTOR' ? '/instructor/login'
          : user?.role === 'STAFF' ? '/staff/login' : '/student/login';
    navigate(loginRoute, { replace: true });
  };
  return (
    <BrandIntroGate>
      <div className="app-shell">
        <BrandWallpaper variant={isAuthSurface ? 'auth' : 'app'} />
        <header className="topbar">
          <Link className="brand" to="/" aria-label="Jishnu Learning Labs home">
            <BrandLogo className="topbar-logo" />
          </Link>
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
    </BrandIntroGate>
  );
}
