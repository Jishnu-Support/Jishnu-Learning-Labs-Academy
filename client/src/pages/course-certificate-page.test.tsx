import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CourseCertificatePage } from './student-portal-pages';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('CourseCertificatePage', () => {
  it('opens and closes a clearly marked sample preview without issuing a certificate', async () => {
    const requestMethods: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestMethods.push(init?.method ?? 'GET');
      if (String(input).includes('/portal/student/certificates')) {
        return { ok: true, status: 200, json: async () => ({ data: { certificates: [] } }) } as Response;
      }
      return { ok: true, arrayBuffer: async () => new Uint8Array([0, 1, 2]).buffer } as Response;
    });
    document.documentElement.style.setProperty('--brand-navy', '#14246B');
    document.documentElement.style.setProperty('--brand-magenta', '#9B1D80');
    document.documentElement.style.setProperty('--brand-lime', '#8DC63F');
    vi.stubGlobal('btoa', vi.fn(() => 'AAEC'));
    vi.stubGlobal('fetch', fetchMock);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={queryClient}>
        <CourseCertificatePage courseId="course-1" />
      </QueryClientProvider>,
    );

    await screen.findByText('Certificate status');
    fireEvent.click(screen.getByRole('button', { name: 'Preview Sample Certificate' }));

    expect(await screen.findByRole('dialog', { name: 'Sample Certificate Preview' })).toBeInTheDocument();
    expect(await screen.findByRole('img', { name: /sample course completion certificate/i })).toBeInTheDocument();
    expect(screen.getByText(/sample data only/i)).toBeInTheDocument();
    expect(requestMethods).not.toContain('POST');

    fireEvent.click(screen.getByRole('button', { name: 'Close preview' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});
