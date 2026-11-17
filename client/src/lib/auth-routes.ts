import type { Role } from '../types';

export function roleHomeRoute(role: Role): string {
  if (role === 'SUPER_ADMIN') return '/super-admin/dashboard';
  if (role === 'ORG_ADMIN') return '/org-admin';
  if (role === 'TUTOR') return '/tutor';
  return '/student';
}

export function loginRouteFor(pathname: string, search = ''): string {
  const returnTo = `${pathname}${search}`;
  const base = pathname.startsWith('/super-admin') ? '/super-admin/login'
    : pathname.startsWith('/org-admin') ? '/org-admin/login'
      : pathname.startsWith('/tutor') ? '/tutor/login'
          : '/student/login';
  const params = new URLSearchParams({ returnTo });
  return `${base}?${params.toString()}`;
}
