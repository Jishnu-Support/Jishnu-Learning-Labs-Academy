import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthContext, type CurrentUser } from '../auth/auth-context';
import { api } from '../lib/api';
import { StudentPaymentsPage } from './student-payments-page';

vi.mock('../lib/api', () => ({
  api: vi.fn(),
  apiBlob: vi.fn(),
  downloadBlob: vi.fn(),
  ApiError: class ApiError extends Error {
    constructor(message: string, public readonly status: number) { super(message); }
  },
}));

const student: CurrentUser = {
  id: 'student-1',
  organizationId: 'org-1',
  email: 'student@example.test',
  name: 'Fee Student',
  role: 'STUDENT',
  studentId: 'STU-1',
  organization: { name: 'Academy', code: 'academy', isPlatformOwner: false },
};

const overview = {
  paymentsEnabled: true,
  demoMode: true,
  currency: 'INR',
  courses: [{
    id: 'course-1',
    code: 'PY101',
    title: 'Python',
    tutors: [{ id: 'tutor-1', name: 'Asha Tutor', tutorProfile: { tutorId: 'TUT-0101', bio: 'Python tutor' } }],
    plans: [{
      id: 'plan-1',
      period: 'MONTHLY' as const,
      price: 125,
      tutor: { id: 'tutor-1', name: 'Asha Tutor', tutorId: 'TUT-0101', bio: 'Python tutor' },
    }],
  }],
  subscriptions: [],
  payments: [],
};

function renderPaymentsPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthContext.Provider value={{ user: student, loading: false, logout: vi.fn() }}>
        <MemoryRouter initialEntries={['/student/payments']}>
          <StudentPaymentsPage />
        </MemoryRouter>
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
}

afterEach(() => vi.clearAllMocks());

describe('StudentPaymentsPage', () => {
  it('shows the demo-only checkout warning and sends only the selected plan and PIN', async () => {
    vi.mocked(api).mockImplementation(async (path) => {
      if (path === '/payments/student') return overview;
      if (path === '/payments/student/checkout') {
        return {
          payment: { status: 'PAID', amount: 125, receiptNumber: 'JLL-TEST-1' },
          course: { title: 'Python' },
          tutor: { name: 'Asha Tutor' },
          demoMode: true,
        };
      }
      throw new Error(`Unexpected API request: ${path}`);
    });

    renderPaymentsPage();
    expect(await screen.findByRole('heading', { name: 'Pay My Fee' })).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'Pay' }));
    expect(await screen.findByText(/DEMO ONLY: never enter your real UPI PIN/i)).toBeInTheDocument();
    expect(screen.getByDisplayValue('student@demo')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Demo PIN'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Pay now' }));

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/Payment successful/));
    const checkoutRequest = vi.mocked(api).mock.calls.find(([path]) => path === '/payments/student/checkout');
    expect(checkoutRequest).toBeDefined();
    const body = JSON.parse(String(checkoutRequest?.[1]?.body)) as Record<string, unknown>;
    expect(body).toEqual({ planId: 'plan-1', periodsCount: 1, pin: '123456' });
    expect(body).not.toHaveProperty('amount');
  }, 15000);
});
