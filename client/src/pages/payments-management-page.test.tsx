import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthContext, type CurrentUser } from '../auth/auth-context';
import { api } from '../lib/api';
import { PaymentsManagementPage } from './payments-management-page';

vi.mock('../lib/api', () => ({
  api: vi.fn(),
  apiBlob: vi.fn(),
  downloadBlob: vi.fn(),
  ApiError: class ApiError extends Error {
    constructor(message: string, public readonly status: number) { super(message); }
  },
}));

const user = (role: CurrentUser['role']): CurrentUser => ({
  id: 'user-1',
  organizationId: 'org-1',
  email: 'account@example.test',
  name: 'Test Account',
  role,
  organization: { name: 'Academy', code: 'academy', isPlatformOwner: false },
});

const data = {
  scope: 'TUTOR',
  demoMode: true,
  organization: {
    id: 'org-1', name: 'Academy', code: 'academy', paymentsEnabled: true, currency: 'INR',
    minimumMonthlyFee: 100, maximumMonthlyFee: 500, minimumQuarterlyFee: null, maximumQuarterlyFee: null,
    minimumYearlyFee: null, maximumYearlyFee: null, invoiceName: null, invoiceAddress: null, invoiceTaxId: null,
  },
  organizations: [],
  summary: {
    revenueThisMonth: 200, revenueAllTime: 500, activeSubscriptions: 2, expiredSubscriptions: 1,
    revenueByPeriod: { MONTHLY: 200, QUARTERLY: 300, YEARLY: 0 },
    inactiveSubscriptions: 0, failedPayments: 1, refunds: 0, pendingRenewals: 1, uniquePayingStudents: 2, newestPayments: [],
  },
  courses: [{ id: 'course-1', code: 'PY101', title: 'Python' }],
  tutors: [{ id: 'user-1', name: 'Test Account', tutorId: 'TUT-0101', acceptsNewFees: true }],
  plans: [{
    id: 'plan-1', organizationId: 'org-1', tutorId: 'user-1', courseId: 'course-1', period: 'MONTHLY' as const,
    price: 200, isActive: true, acceptsNewFees: true,
    course: { id: 'course-1', code: 'PY101', title: 'Python' },
    tutor: { id: 'user-1', name: 'Test Account', tutorId: 'TUT-0101' },
  }],
  priceHistory: [],
  byCourse: [{ course: { id: 'course-1', code: 'PY101', title: 'Python' }, amount: 500, count: 2 }],
  byTutor: [{ tutor: { id: 'user-1', name: 'Test Account', tutorId: 'TUT-0101' }, amount: 500, count: 2 }],
  payments: [{
    id: 'payment-1', organization: { id: 'org-1', name: 'Academy', code: 'academy' },
    student: { id: 'student-1', name: 'Student One', studentId: 'STU-1' },
    tutor: { id: 'user-1', name: 'Test Account', tutorId: 'TUT-0101' },
    course: { id: 'course-1', code: 'PY101', title: 'Python' },
    subscription: { id: 'subscription-1', status: 'ACTIVE', startsAt: '2026-01-01T00:00:00.000Z', endsAt: '2026-12-01T00:00:00.000Z', periodsPaid: 2 },
    amount: 200, currency: 'INR', period: 'MONTHLY' as const, status: 'PAID', periodStart: '2026-10-01T00:00:00.000Z',
    periodEnd: '2026-11-01T00:00:00.000Z', periodsCount: 1, receiptNumber: 'JLL-TEST-1', createdAt: '2026-10-01T00:00:00.000Z',
  }],
};

function renderPage(role: CurrentUser['role']) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthContext.Provider value={{ user: user(role), loading: false, logout: vi.fn() }}>
        <MemoryRouter initialEntries={['/payments']}>
          <PaymentsManagementPage />
        </MemoryRouter>
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
}

afterEach(() => vi.clearAllMocks());

describe('PaymentsManagementPage', () => {
  it('lets Tutors set a price for an assigned course and shows their earnings', async () => {
    vi.mocked(api).mockImplementation(async (path) => {
      if (path === '/payments/management') return data;
      return {};
    });

    renderPage('TUTOR');
    expect(await screen.findByRole('heading', { name: 'My Fees and Earnings' })).toBeInTheDocument();
    expect(await screen.findByText('Students paid')).toBeInTheDocument();
    fireEvent.change(screen.getAllByLabelText('Course')[0]!, { target: { value: 'course-1' } });
    fireEvent.change(screen.getByLabelText('Price'), { target: { value: '250' } });
    fireEvent.click(screen.getByRole('button', { name: /save price/i }));
    await waitFor(() => expect(vi.mocked(api).mock.calls.some(([path, init]) =>
      path === '/payments/tutor/plans' && init?.method === 'PUT' &&
      String(init.body) === JSON.stringify({ courseId: 'course-1', period: 'MONTHLY', price: 250 }),
    )).toBe(true));
  }, 15000);

  it('requires a reason before changing a subscription and submits the admin action', async () => {
    vi.mocked(api).mockImplementation(async (path) => {
      if (path === '/payments/management') return { ...data, scope: 'ORG_ADMIN' };
      return {};
    });

    renderPage('ORG_ADMIN');
    fireEvent.click(await screen.findByRole('button', { name: 'Deactivate' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Administrative review' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(vi.mocked(api).mock.calls.some(([path, init]) =>
      path === '/payments/subscriptions/subscription-1/status' && init?.method === 'PUT' &&
      String(init.body) === JSON.stringify({ status: 'INACTIVE', reason: 'Administrative review' }),
    )).toBe(true));
  }, 15000);
});
