import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { api } from '../lib/api';
import { AuthContext, type CurrentUser } from './auth-context';

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ['me'],
    queryFn: () => api<{ user: CurrentUser }>('/auth/me').then((data) => data.user),
    retry: false,
  });
  const logout = async () => {
    try {
      await api('/auth/logout', { method: 'POST' });
    } finally {
      await queryClient.setQueryData(['me'], null);
    }
  };
  return <AuthContext.Provider value={{ user: query.data ?? null, loading: query.isLoading, logout }}>{children}</AuthContext.Provider>;
}
