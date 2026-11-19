import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RegisterPage } from './register-page';

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderRegistration(role: 'STUDENT' | 'TUTOR') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter><RegisterPage role={role} /></MemoryRouter>
    </QueryClientProvider>,
  );
}

function mockRegistrationApi(registerResponse = { data: { registrationAccessToken: 'registration-token' } }) {
  const registerRequest = vi.fn();
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).includes('/auth/registration-options')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            courses: [
              { id: 'course-html101', code: 'HTML101', title: 'HTML', category: 'Web Development', registrationMonthlyFee: 250 },
              { id: 'course-math101', code: 'MATH101', title: 'Mathematics', category: 'Mathematics', registrationMonthlyFee: null },
            ],
            currency: 'INR',
            identityCollectionEnabled: true,
            aadhaarEnabled: true,
          },
        }),
      };
    }
    registerRequest(input, init);
    return { ok: true, status: 201, json: async () => registerResponse };
  }));
  return registerRequest;
}

describe('registration forms', () => {
  it.each([
    ['STUDENT', 'Student ID'],
    ['TUTOR', 'Tutor ID'],
  ] as const)('shows the shared applicant fields and retains %s sign-in credentials', (role, accountIdLabel) => {
    renderRegistration(role);
    expect(screen.getByLabelText('Full name')).toBeInTheDocument();
    expect(screen.getByLabelText('Contact')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByLabelText('Mother’s Name')).toBeInTheDocument();
    expect(screen.getByLabelText('Father’s Name')).toBeInTheDocument();
    expect(screen.getByLabelText(role === 'STUDENT' ? 'Aadhaar Number' : 'Aadhaar Number (optional)')).toBeInTheDocument();
    expect(screen.getByLabelText(role === 'STUDENT' ? 'APAAR Card (ABC ID)' : 'APAAR Card (ABC ID) (optional)')).toBeInTheDocument();
    expect(screen.getByLabelText(role === 'STUDENT' ? 'Aadhaar Number' : 'Aadhaar Number (optional)')).toHaveAttribute('type', 'password');
    expect(screen.getByLabelText(accountIdLabel)).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByLabelText('Select Course')).toBeInTheDocument();
    expect(screen.getByLabelText('Select Course')).toBeEnabled();
  });

  it('requires both identifiers for students and shows inline validation errors', async () => {
    renderRegistration('STUDENT');
    fireEvent.change(screen.getByLabelText('Transaction / Reference number'), { target: { value: 'TX-DEMO-1' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /submitted payment details for verification/i }));
    fireEvent.click(screen.getByRole('checkbox', { name: /agree to the terms/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit registration' }));

    expect(await screen.findByText('Enter your 12-digit Aadhaar number')).toBeInTheDocument();
    expect(screen.getByText('Enter your 12-digit APAAR ID')).toBeInTheDocument();
  });

  it('shows inline errors for malformed Aadhaar and APAAR values', async () => {
    renderRegistration('STUDENT');
    fireEvent.change(screen.getByLabelText('Aadhaar Number'), { target: { value: '12345678901' } });
    fireEvent.change(screen.getByLabelText('APAAR Card (ABC ID)'), { target: { value: '12345abc9012' } });
    fireEvent.change(screen.getByLabelText('Transaction / Reference number'), { target: { value: 'TX-DEMO-1' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /submitted payment details for verification/i }));
    fireEvent.click(screen.getByRole('checkbox', { name: /agree to the terms/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit registration' }));

    expect(await screen.findByText('Enter a valid 12-digit Aadhaar number')).toBeInTheDocument();
    expect(screen.getByText('Enter a valid 12-digit APAAR ID')).toBeInTheDocument();
  });

  it('loads real course options and submits normalized identity and selected-course values', async () => {
    const registerRequest = mockRegistrationApi();
    renderRegistration('STUDENT');
    fireEvent.change(screen.getByLabelText('Organization Code'), { target: { value: 'jll-demo' } });
    fireEvent.change(screen.getByLabelText('Student ID'), { target: { value: 'STU-TEST-REG' } });
    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Sample Student' } });
    fireEvent.change(screen.getByLabelText('Contact'), { target: { value: '9876543210' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'sample.registration@example.test' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'SamplePass!2026' } });
    fireEvent.change(screen.getByLabelText('Mother’s Name'), { target: { value: 'Sample Mother' } });
    fireEvent.change(screen.getByLabelText('Father’s Name'), { target: { value: 'Sample Father' } });
    await screen.findByRole('option', { name: /HTML/ });
    expect(screen.getByRole('option', { name: /Mathematics/ })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Aadhaar Number'), { target: { value: '2000-0000-0009' } });
    fireEvent.change(screen.getByLabelText('APAAR Card (ABC ID)'), { target: { value: '9876 5432 1098' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /consent to encrypted storage/i }));
    fireEvent.change(screen.getByLabelText('Select Course'), { target: { value: 'course-html101' } });
    fireEvent.change(screen.getByLabelText('Transaction / Reference number'), { target: { value: 'TX-SAMPLE-REG' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /submitted payment details for verification/i }));
    fireEvent.click(screen.getByRole('checkbox', { name: /agree to the terms/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit registration' }));

    await waitFor(() => expect(registerRequest).toHaveBeenCalledOnce());
    const submittedForm = registerRequest.mock.calls[0]?.[1]?.body as FormData;
    expect(submittedForm.get('aadhaarNumber')).toBe('200000000009');
    expect(submittedForm.get('apaarId')).toBe('987654321098');
    expect(submittedForm.get('interestedCourseId')).toBe('course-html101');
  });

  it('lets applicants select published courses and explains when a course fee is missing', async () => {
    mockRegistrationApi();
    renderRegistration('TUTOR');
    fireEvent.change(screen.getByLabelText('Organization Code'), { target: { value: 'jll-demo' } });
    await screen.findByRole('option', { name: /Mathematics/ });
    fireEvent.change(screen.getByLabelText('Select Course'), { target: { value: 'course-math101' } });

    expect(screen.getByLabelText('Select Course')).toHaveValue('course-math101');
    expect(screen.getByLabelText('Course fee')).toHaveValue('Not configured');
    expect(screen.getByText(/no registration fee configured/i)).toBeInTheDocument();
  });

  it('keeps submission disabled until Terms & Conditions are accepted', () => {
    renderRegistration('STUDENT');
    const submit = screen.getByRole('button', { name: 'Submit registration' });
    expect(submit).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: /agree to the terms/i }));
    expect(submit).toBeDisabled();
    expect(screen.getByLabelText('Payment method')).toHaveValue('UPI');
    expect(screen.getByLabelText('Transaction / Reference number')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /submitted payment details for verification/i })).not.toBeChecked();
    fireEvent.change(screen.getByLabelText('Transaction / Reference number'), { target: { value: 'TX-DEMO-1' } });
    expect(submit).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: /submitted payment details for verification/i }));
    expect(submit).toBeEnabled();
  });

  it('shows a clearly marked nonfunctional UPI sample QR and avoids collecting card details', () => {
    renderRegistration('TUTOR');
    expect(screen.getByRole('img', { name: 'Sample UPI QR code demo only' })).toHaveAttribute('src', '/registration/sample-upi-qr.svg');
    fireEvent.change(screen.getByLabelText('Payment method'), { target: { value: 'CREDIT_CARD' } });
    expect(screen.getByText(/never enter a full card number, expiry, or CVV/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/card number/i)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Payment method'), { target: { value: 'NET_BANKING' } });
    expect(screen.getByText(/no bank gateway or supported-bank list is configured/i)).toBeInTheDocument();
  });

  it('shows an uploaded receipt filename and allows removing the optional receipt', () => {
    renderRegistration('STUDENT');
    const receiptInput = screen.getByLabelText('Receipt upload (optional)');
    const receipt = new File(['sample receipt'], 'receipt.pdf', { type: 'application/pdf' });

    fireEvent.change(receiptInput, { target: { files: [receipt] } });

    expect(screen.getByText('receipt.pdf')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove receipt' }));
    expect(screen.queryByText('receipt.pdf')).not.toBeInTheDocument();
  });
});
