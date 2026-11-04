import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/auth-context';
import { PageHeader } from '../components/page-header';
import { Button } from '../components/ui/button';
import { api, apiUrl, ApiError } from '../lib/api';
import { roleHomeRoute } from '../lib/auth-routes';

const notificationTypes = [
  'CONTENT_PUBLISHED', 'SESSION_SCHEDULED', 'SESSION_REMINDER', 'ASSESSMENT_PUBLISHED', 'ASSESSMENT_CLOSING',
  'ASSESSMENT_RESULTS', 'ACCOUNT_PENDING', 'ACCOUNT_STATUS', 'REQUEST_STATUS', 'PAYMENT_STATUS',
  'SUBSCRIPTION_STATUS', 'CERTIFICATE_ISSUED', 'ATTENDANCE_ALERT', 'CLASS_BOOKED', 'PAYOUT_RECORDED', 'SYSTEM',
] as const;
type NotificationType = typeof notificationTypes[number];
type NotificationItem = {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  link: string | null;
  readAt: string | null;
  createdAt: string;
};
type NotificationResponse = { notifications: NotificationItem[]; pagination: { page: number; pageSize: number; total: number; totalPages: number }; unreadCount: number };

function labelForType(type: NotificationType) {
  return type.toLowerCase().replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function NotificationsPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [type, setType] = useState<NotificationType | ''>('');
  const [page, setPage] = useState(1);
  const notifications = useQuery({
    queryKey: ['notifications', filter, type, page],
    queryFn: () => api<NotificationResponse>(`/notifications?page=${page}&pageSize=25&unreadOnly=${filter === 'unread'}${type ? `&type=${type}` : ''}`),
    refetchInterval: 30_000,
  });
  useEffect(() => {
    const stream = new EventSource(`${apiUrl}/notifications/events`, { withCredentials: true });
    const refresh = () => void queryClient.invalidateQueries({ queryKey: ['notifications'] });
    stream.addEventListener('notification', refresh);
    return () => {
      stream.removeEventListener('notification', refresh);
      stream.close();
    };
  }, [queryClient]);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['notifications'] });
  const markRead = useMutation({ mutationFn: (id: string) => api(`/notifications/${id}/read`, { method: 'POST' }), onSuccess: refresh });
  const markAllRead = useMutation({ mutationFn: () => api('/notifications/read-all', { method: 'POST' }), onSuccess: refresh });
  const remove = useMutation({ mutationFn: (id: string) => api(`/notifications/${id}`, { method: 'DELETE' }), onSuccess: refresh });
  const items = notifications.data?.notifications ?? [];
  const backTo = roleHomeRoute(user?.role ?? 'STUDENT');

  return (
    <section className="portal-content notification-page">
      <PageHeader title="Notifications" backTo={backTo} breadcrumbs={['Workspace', 'Notifications']} />
      <div className="notification-toolbar">
        <div className="row-actions" role="tablist" aria-label="Notification status">
          <Button variant={filter === 'all' ? 'primary' : 'secondary'} role="tab" aria-selected={filter === 'all'} onClick={() => { setFilter('all'); setPage(1); }}>All</Button>
          <Button variant={filter === 'unread' ? 'primary' : 'secondary'} role="tab" aria-selected={filter === 'unread'} onClick={() => { setFilter('unread'); setPage(1); }}>Unread</Button>
        </div>
        <label className="field notification-type-filter"><span>Type</span><select className="input" value={type} onChange={(event) => { setType(event.target.value as NotificationType | ''); setPage(1); }}><option value="">All types</option>{notificationTypes.map((item) => <option key={item} value={item}>{labelForType(item)}</option>)}</select></label>
        <Button variant="secondary" disabled={!notifications.data?.unreadCount || markAllRead.isPending} onClick={() => markAllRead.mutate()}>Mark all read</Button>
      </div>
      {notifications.isLoading && <p className="loading">Loading notifications…</p>}
      {notifications.error && <p className="notice notice-error" role="alert">{notifications.error instanceof ApiError ? notifications.error.message : 'Could not load notifications.'}</p>}
      {notifications.data && items.length === 0 && <div className="card empty-state"><h2>No notifications</h2><p>{filter === 'unread' ? 'You have no unread notifications.' : 'New updates will appear here.'}</p></div>}
      <div className="notification-list">{items.map((item) => (
        <article className={`card notification-row ${item.readAt ? '' : 'unread'}`} key={item.id}>
          <div className="notification-row-content">
            <p className="eyebrow">{labelForType(item.type)}</p>
            <h2>{item.title}</h2>
            <p>{item.body}</p>
            <time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString()}</time>
          </div>
          <div className="row-actions">
            {item.link && <Link className="text-link" to={item.link}>Open</Link>}
            {!item.readAt && <Button variant="secondary" onClick={() => markRead.mutate(item.id)}>Mark read</Button>}
            <Button variant="ghost" onClick={() => remove.mutate(item.id)}>Delete</Button>
          </div>
        </article>
      ))}</div>
      {notifications.data && notifications.data.pagination.totalPages > 1 && <div className="row-actions notification-pagination" aria-label="Notification pages">
        <Button variant="secondary" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</Button>
        <span>Page {notifications.data.pagination.page} of {notifications.data.pagination.totalPages}</span>
        <Button variant="secondary" disabled={page >= notifications.data.pagination.totalPages} onClick={() => setPage((value) => value + 1)}>Next</Button>
      </div>}
    </section>
  );
}
