import { Navigate, Outlet, useLocation } from 'react-router-dom';
import type { Role } from '../types';
import { useAuth } from '../auth/auth-context';

export function RouteGuard({ roles }: { roles: Role[] }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div className="loading">Checking your session…</div>;
  if (!user) return <Navigate to={loginRouteFor(location.pathname)} replace />;
  if (!roles.includes(user.role)) return <Navigate to="/unauthorized" replace />;
  if (user.mustChangePassword && location.pathname !== '/change-password') return <Navigate to="/change-password" replace />;
  if (!user.mustChangePassword && location.pathname === '/change-password') return <Navigate to={`/${user.role.toLowerCase().replace('_', '-')}`} replace />;
  return <Outlet />;
}

function loginRouteFor(pathname: string): string {
  if (pathname.startsWith('/super-admin')) return '/super-admin/login';
  if (pathname.startsWith('/org-admin')) return '/org-admin/login';
  if (pathname.startsWith('/instructor')) return '/instructor/login';
  if (pathname.startsWith('/staff')) return '/staff/login';
  return '/student/login';
}
