import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from './api';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('api errors', () => {
  it('explains when a request is rate limited', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Too many requests, please try again later.', {
      status: 429,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    })));

    const error = await api('/auth/students/login', { method: 'POST' }).then(
      () => null,
      (cause: unknown) => cause,
    );
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toHaveProperty('message', 'Too many requests. Please try again later.');
    expect(error).toHaveProperty('status', 429);
  });
});
