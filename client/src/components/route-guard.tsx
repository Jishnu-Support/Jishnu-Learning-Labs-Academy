import { Navigate, Outlet } from 'react-router-dom';
import type { Role } from '../types';
import { useAuth } from '../auth/auth-context';

export function RouteGuard({ roles }: { roles: Role[] }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="loading">Checking your session…</div>;
  if (!user) return <Navigate to="/student/login" replace />;
  if (!roles.includes(user.role)) return <Navigate to="/unauthorized" replace />;
  return <Outlet />;
}
