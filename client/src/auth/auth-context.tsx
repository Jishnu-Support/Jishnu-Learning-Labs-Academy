import { createContext, useContext } from 'react';
import type { Role } from '../types';

export type CurrentUser = { id: string; email: string; name: string; role: Role };
type AuthState = { user: CurrentUser | null; loading: boolean; logout: () => Promise<void> };
export const AuthContext = createContext<AuthState | null>(null);

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used within AuthProvider');
  return value;
}
