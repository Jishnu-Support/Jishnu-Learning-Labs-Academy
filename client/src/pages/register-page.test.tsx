import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { RegisterPage } from './register-page';

function renderRegistration(role: 'STUDENT' | 'TUTOR') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter><RegisterPage role={role} /></MemoryRouter>
    </QueryClientProvider>,
  );
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
    expect(screen.getByLabelText('Aadhaar Number (optional)')).toBeInTheDocument();
    expect(screen.getByLabelText('APAAR ID (optional)')).toBeInTheDocument();
    expect(screen.getByLabelText(accountIdLabel)).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByLabelText('Interested Course')).toBeInTheDocument();
  });

  it('keeps submission disabled until Terms & Conditions are accepted', () => {
    renderRegistration('STUDENT');
    const submit = screen.getByRole('button', { name: 'Submit registration' });
    expect(submit).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: /agree to the terms/i }));
    expect(submit).toBeEnabled();
  });
});
