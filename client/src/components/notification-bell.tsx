import { useEffect, useState } from 'react';
import { Bell } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiUrl } from '../lib/api';

type NotificationItem = {
  id: string;
  title: string;
  body: string;
  link: string | null;
  readAt: string | null;
  createdAt: string;
};
type NotificationResponse = { notifications: NotificationItem[]; unreadCount: number };

export function NotificationBell() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const notifications = useQuery({
    queryKey: ['notifications', 'latest'],
    queryFn: () => api<NotificationResponse>('/notifications?page=1&pageSize=5'),
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
  const markRead = useMutation({
    mutationFn: (id: string) => api(`/notifications/${id}/read`, { method: 'POST' }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  return (
    <div className="notification-bell">
      <button
        type="button"
        className="notification-bell-trigger"
        aria-label={`Notifications${notifications.data?.unreadCount ? `, ${notifications.data.unreadCount} unread` : ''}`}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Bell size={20} aria-hidden="true" />
        {Boolean(notifications.data?.unreadCount) && <span className="notification-count">{notifications.data!.unreadCount > 99 ? '99+' : notifications.data!.unreadCount}</span>}
      </button>
      {open && <section className="notification-popover card" aria-label="Recent notifications">
        <div className="notification-popover-heading"><h2>Notifications</h2><Link to="/notifications" onClick={() => setOpen(false)}>View all</Link></div>
        {notifications.isLoading && <p className="loading">Loading notifications…</p>}
        {notifications.error && <p className="notice notice-error" role="alert">Notifications are temporarily unavailable.</p>}
        {!notifications.isLoading && !notifications.error && notifications.data?.notifications.length === 0 && <p className="empty-state">You’re all caught up.</p>}
        {notifications.data?.notifications.map((item) => (
          <article className={`notification-item ${item.readAt ? '' : 'unread'}`} key={item.id}>
            <div>
              <h3>{item.title}</h3>
              <p>{item.body}</p>
              <time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString()}</time>
            </div>
            <div className="notification-item-actions">
              {item.link && <Link to={item.link} onClick={() => { if (!item.readAt) markRead.mutate(item.id); setOpen(false); }}>Open</Link>}
              {!item.readAt && <button type="button" onClick={() => markRead.mutate(item.id)}>Mark read</button>}
            </div>
          </article>
        ))}
      </section>}
    </div>
  );
}
