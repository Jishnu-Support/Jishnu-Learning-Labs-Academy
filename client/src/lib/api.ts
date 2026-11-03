export const apiUrl = import.meta.env.VITE_API_URL ?? '/api';

let refreshRequest: Promise<boolean> | null = null;

async function refreshSessionOnce(): Promise<boolean> {
  if (refreshRequest) return refreshRequest;

  refreshRequest = (async () => {
    try {
      const response = await fetch(`${apiUrl}/auth/refresh`, { method: 'POST', credentials: 'include' });
      return response.ok;
    } catch {
      return false;
    } finally {
      refreshRequest = null;
    }
  })();

  return refreshRequest;
}

async function logoutDueToSessionFailure(): Promise<void> {
  try {
    await fetch(`${apiUrl}/auth/logout`, { method: 'POST', credentials: 'include' });
  } catch {
    // Ignore a logout failure; the session is already invalid.
  }
}

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
  const mayRefresh = response.status === 401 && path !== '/auth/refresh' && path !== '/auth/logout' && path !== '/auth/students/login' && path !== '/auth/instructors/login' && path !== '/auth/staff/login' && path !== '/auth/org-admin/login' && path !== '/auth/super-admin/login';
  if (mayRefresh) {
    const refreshed = await refreshSessionOnce();
    if (refreshed) {
      response = await fetch(`${apiUrl}${path}`, options);
    } else {
      await logoutDueToSessionFailure();
    }
  }
  if (response.status === 204) return undefined as T;
  const body = (await response.json().catch(() => null)) as { data?: T; error?: { message?: string } } | null;
  if (!response.ok) throw new ApiError(body?.error?.message ?? 'Request failed', response.status);
  return body?.data as T;
}

export async function apiBlob(path: string): Promise<Blob> {
  const request = () => fetch(`${apiUrl}${path}`, { credentials: 'include' });
  let response = await request();
  const mayRefresh = response.status === 401 && path !== '/auth/refresh' && path !== '/auth/logout' && path !== '/auth/students/login' && path !== '/auth/instructors/login' && path !== '/auth/staff/login' && path !== '/auth/org-admin/login' && path !== '/auth/super-admin/login';
  if (mayRefresh) {
    const refreshed = await refreshSessionOnce();
    if (refreshed) {
      response = await request();
    } else {
      await logoutDueToSessionFailure();
    }
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
    throw new ApiError(body?.error?.message ?? 'Request failed', response.status);
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
