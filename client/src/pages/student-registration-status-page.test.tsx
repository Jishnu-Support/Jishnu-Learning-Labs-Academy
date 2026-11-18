import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StudentRegistrationStatusPage } from './student-registration-status-page';

const registrationStatus = {
  registrationReference: 'registration-reference',
  course: { code: 'SAMPLE-101', title: 'Sample Course' },
  amount: 250,
  currency: 'INR',
  paymentStatus: 'PENDING',
  accountStatus: 'PENDING_PAYMENT',
  rejectionReason: null,
  organization: { name: 'Sample Academy', contactNumber: '+911234567890' },
  createdAt: '2026-01-10T00:00:00.000Z',
  paidAt: null,
  refundedAt: null,
} as const;

afterEach(() => {
  sessionStorage.clear();
  vi.unstubAllGlobals();
});

describe('student registration status page', () => {
  it('shows the monthly fee and opens offline Pay Now instructions', async () => {
    sessionStorage.setItem('student-registration-access-token', 'a'.repeat(64));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({ data: registrationStatus }),
    }));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter><StudentRegistrationStatusPage /></MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByText('Pending Payment')).toBeInTheDocument();
    expect(screen.getByText('₹250.00')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Pay Now' }));
    expect(await screen.findByText(/Contact Sample Academy/)).toBeInTheDocument();
    expect(screen.getByText(/approved automatically when an Org Admin records the payment/)).toBeInTheDocument();
  });
});
