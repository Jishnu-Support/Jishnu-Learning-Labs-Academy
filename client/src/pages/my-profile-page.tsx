import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/auth-context';
import { PageHeader } from '../components/page-header';
import { Button } from '../components/ui/button';
import { api, ApiError } from '../lib/api';
import { roleHomeRoute } from '../lib/auth-routes';

const categories = [
  ['CONTENT', 'Learning content'],
  ['SESSIONS', 'Learning sessions'],
  ['ASSESSMENTS', 'Assessments and results'],
  ['ACCOUNT', 'Account and registration updates'],
  ['REQUESTS', 'Requests'],
  ['PAYMENTS', 'Payments and refunds'],
  ['SUBSCRIPTIONS', 'Subscriptions'],
  ['CERTIFICATES', 'Certificates'],
  ['ATTENDANCE', 'Attendance'],
  ['CLASSES', 'Class bookings'],
  ['PAYOUTS', 'Tutor payouts'],
  ['SYSTEM', 'Platform updates'],
] as const;
type Preference = { category: string; enabled: boolean };

export function MyProfilePage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [preferences, setPreferences] = useState<Preference[]>([]);
  const query = useQuery({
    queryKey: ['notification-preferences'],
    queryFn: () => api<{ preferences: Preference[] }>('/notifications/preferences'),
  });
  useEffect(() => {
    if (query.data) setPreferences(query.data.preferences);
  }, [query.data]);
  const save = useMutation({
    mutationFn: () => api<{ preferences: Preference[] }>('/notifications/preferences', { method: 'PUT', body: JSON.stringify({ preferences }) }),
    onSuccess: async (result) => {
      setPreferences(result.preferences);
      await queryClient.invalidateQueries({ queryKey: ['notification-preferences'] });
    },
  });

  return (
    <section className="portal-content profile-page">
      <PageHeader title="My Profile" backTo={roleHomeRoute(user?.role ?? 'STUDENT')} breadcrumbs={['Workspace', 'My Profile']} />
      <div className="card profile-summary"><h2>{user?.name}</h2><p>{user?.email}</p><p className="muted">{user?.role === 'TUTOR' || user?.role === 'INSTRUCTOR' ? 'Tutor' : user?.role}</p></div>
      <section className="card preference-card">
        <h2>Notification preferences</h2>
        <p className="muted">Choose which in-app updates you receive. Email notifications are currently disabled.</p>
        {query.isLoading && <p className="loading">Loading preferences…</p>}
        {query.error && <p className="notice notice-error" role="alert">{query.error instanceof ApiError ? query.error.message : 'Could not load preferences.'}</p>}
        {query.data && <div className="preference-list">{categories.map(([category, label]) => {
          const preference = preferences.find((item) => item.category === category);
          return <label className="preference-row" key={category}><span>{label}</span><input type="checkbox" checked={preference?.enabled ?? true} onChange={(event) => setPreferences((current) => current.map((item) => item.category === category ? { ...item, enabled: event.target.checked } : item))} /></label>;
        })}</div>}
        {save.error && <p className="notice notice-error" role="alert">{save.error instanceof ApiError ? save.error.message : 'Could not save preferences.'}</p>}
        <Button disabled={save.isPending || query.isLoading || Boolean(query.error)} onClick={() => save.mutate()}>{save.isPending ? 'Saving…' : 'Save preferences'}</Button>
      </section>
    </section>
  );
}
