const apiUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:4000/api';

export class ApiError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const options: RequestInit = {
    ...init,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...init.headers },
  };
  let response = await fetch(`${apiUrl}${path}`, options);
  const mayRefresh = response.status === 401 && path !== '/auth/refresh' && path !== '/auth/logout' && path !== '/auth/students/login' && path !== '/auth/instructors/login' && path !== '/auth/staff/login';
  if (mayRefresh) {
    const refreshed = await fetch(`${apiUrl}/auth/refresh`, { method: 'POST', credentials: 'include' });
    if (refreshed.ok) response = await fetch(`${apiUrl}${path}`, options);
  }
  if (response.status === 204) return undefined as T;
  const body = (await response.json()) as { data?: T; error?: { message?: string } };
  if (!response.ok) throw new ApiError(body.error?.message ?? 'Request failed', response.status);
  return body.data as T;
}
