import { createContext, useContext } from 'react';
import type { AccountStatus, Role } from '../types';

export type CurrentUser = {
  id: string;
  organizationId: string | null;
  email: string;
  name: string;
  role: Role;
  status?: AccountStatus;
  mustChangePassword?: boolean;
  studentId?: string;
  organization: { name: string; code: string | null; isPlatformOwner: boolean } | null;
};
type AuthState = { user: CurrentUser | null; loading: boolean; logout: () => Promise<void> };
export const AuthContext = createContext<AuthState | null>(null);

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used within AuthProvider');
  return value;
}
