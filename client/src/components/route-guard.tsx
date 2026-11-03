import { Navigate, Outlet, useLocation } from 'react-router-dom';
import type { Role } from '../types';
import { useAuth } from '../auth/auth-context';
import { loginRouteFor, roleHomeRoute } from '../lib/auth-routes';

export function RouteGuard({ roles }: { roles: Role[] }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  const currentPath = `${location.pathname}${location.search}`;

  if (loading) return <div className="loading">Checking your session…</div>;
  if (!user) return <Navigate to={loginRouteFor(location.pathname, location.search)} replace state={{ returnTo: currentPath }} />;
  if (!roles.includes(user.role)) return <Navigate to={roleHomeRoute(user.role)} replace state={{ toast: 'You do not have access to that page' }} />;
  if (user.mustChangePassword && location.pathname !== '/change-password') return <Navigate to="/change-password" replace />;
  if (!user.mustChangePassword && location.pathname === '/change-password') return <Navigate to={roleHomeRoute(user.role)} replace />;
  return <Outlet />;
}
