import { Link, Outlet, useLocation, useNavigate, useNavigationType } from 'react-router-dom';
import { useEffect } from 'react';
import { useAuth } from '../auth/auth-context';
import { recordAppLocation } from '../lib/app-navigation';
import { BrandIntroGate } from './brand-intro';
import { BrandLogo } from './brand-logo';
import { BrandWallpaper } from './brand-wallpaper';
import { Button } from './ui/button';
import { NotificationBell } from './notification-bell';
import { roleLabel } from '../types';

export function Shell() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigationType = useNavigationType();
  const navigate = useNavigate();
  const isAuthSurface = /^\/(student|tutor|org-admin|super-admin)\/(login|register)$/.test(location.pathname)
    || location.pathname === '/organizations/register';
  const isPortalSurface = /^\/(student|tutor|org-admin|super-admin)(\/|$)/.test(location.pathname)
    || ['/my-profile', '/notifications', '/change-password'].includes(location.pathname);
  useEffect(() => {
    recordAppLocation(`${location.pathname}${location.search}`, navigationType);
  }, [location.pathname, location.search, navigationType]);

  useEffect(() => {
    const loginMatch = location.pathname.match(/^\/(student|tutor|org-admin|super-admin)\/login$/);
    const roleLabel = loginMatch?.[1]?.replace('-', ' ');
    const pageTitle = roleLabel
      ? `${roleLabel.replace(/\b\w/g, (letter) => letter.toUpperCase())} Login`
      : location.pathname === '/organizations/register'
        ? 'Organization Registration'
        : location.pathname === '/change-password'
          ? 'Change Password'
          : location.pathname.startsWith('/student')
            ? 'Student Portal'
            : location.pathname.startsWith('/tutor')
              ? 'Tutor Portal'
              : location.pathname.startsWith('/org-admin')
                ? 'Organization Admin Portal'
                : location.pathname.startsWith('/super-admin')
                  ? 'Platform Admin'
                  : 'Learning Platform';
    document.title = `Jishnu Learning Labs | ${pageTitle}`;
  }, [location.pathname]);

  const signOut = async () => {
    await logout();
    const loginRoute = user?.role === 'SUPER_ADMIN' ? '/super-admin/login'
      : user?.role === 'ORG_ADMIN' ? '/org-admin/login'
        : user?.role === 'TUTOR' ? '/tutor/login' : '/student/login';
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
            {user && (user.organizationId || user.role === 'SUPER_ADMIN') && <NotificationBell />}
            {user && <span className="user-chip">{user.name} · {roleLabel(user.role)}</span>}
            {user && <Button variant="ghost" onClick={() => void signOut()}>Sign out</Button>}
          </div>
        </header>
        <main className={`page-wrap${isPortalSurface ? ' page-wrap-portal' : ''}`}><Outlet /></main>
        <footer className="footer">
          <span>Learn with clarity. Grow with confidence.</span>
          <Link to="/super-admin/login">Platform Admin</Link>
        </footer>
      </div>
    </BrandIntroGate>
  );
}
