export const apiUrl = import.meta.env.VITE_API_URL ?? '/api';

export class ApiError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (!(init.body instanceof FormData) && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const options: RequestInit = {
    ...init,
    credentials: 'include',
    headers,
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

export async function apiBlob(path: string): Promise<Blob> {
  const request = () => fetch(`${apiUrl}${path}`, { credentials: 'include' });
  let response = await request();
  if (response.status === 401) {
    const refreshed = await fetch(`${apiUrl}/auth/refresh`, { method: 'POST', credentials: 'include' });
    if (refreshed.ok) response = await request();
  }
  if (!response.ok) {
    const body = await response.json() as { error?: { message?: string } };
    throw new ApiError(body.error?.message ?? 'Request failed', response.status);
  }
  return response.blob();
}

export async function downloadBlob(blob: Blob, filename: string): Promise<void> {
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}
