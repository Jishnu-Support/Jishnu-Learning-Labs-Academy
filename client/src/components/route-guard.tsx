import { Navigate, Outlet, useLocation } from 'react-router-dom';
import type { Role } from '../types';
import { useAuth } from '../auth/auth-context';

export function RouteGuard({ roles }: { roles: Role[] }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div className="loading">Checking your session…</div>;
  if (!user) return <Navigate to="/student/login" replace />;
  if (!roles.includes(user.role)) return <Navigate to="/unauthorized" replace />;
  if (user.mustChangePassword && location.pathname !== '/change-password') return <Navigate to="/change-password" replace />;
  if (!user.mustChangePassword && location.pathname === '/change-password') return <Navigate to={`/${user.role.toLowerCase().replace('_', '-')}`} replace />;
  return <Outlet />;
}
