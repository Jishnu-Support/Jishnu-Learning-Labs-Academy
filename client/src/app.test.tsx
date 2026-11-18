import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { App, LegacyStudentLearningRedirect } from './app';
import { AuthProvider } from './auth/auth-provider';

vi.mock('./components/brand-intro', () => ({
  BrandIntroGate: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

function LocationResult() {
  const location = useLocation();
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>;
}

describe('Phase 1 portal shell', () => {
  it('shows the student sign-in screen and registration link', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><AuthProvider><BrowserRouter><App /></BrowserRouter></AuthProvider></QueryClientProvider>);
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByLabelText('Organization Code')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /register as student/i })).toHaveAttribute('href', '/student/register');
  });

  it('shows Tutor registration without an Instructor compatibility route', async () => {
    window.history.pushState({}, '', '/tutor/register');
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><AuthProvider><BrowserRouter><App /></BrowserRouter></AuthProvider></QueryClientProvider>);
    expect(await screen.findByRole('heading', { name: 'Create your account' })).toBeInTheDocument();
    expect(screen.getByText(/an org admin must still approve/i)).toBeInTheDocument();
    expect(screen.getByLabelText('Organization Code')).toBeInTheDocument();
    expect(screen.getByLabelText('Full name')).toBeInTheDocument();
    expect(screen.getByLabelText('Tutor ID')).toBeInTheDocument();
    expect(screen.queryByLabelText('Student ID')).not.toBeInTheDocument();
  });

  it('shows the public organization registration portal', async () => {
    window.history.pushState({}, '', '/organizations/register');
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><AuthProvider><BrowserRouter><App /></BrowserRouter></AuthProvider></QueryClientProvider>);
    expect(await screen.findByRole('heading', { name: 'Register your organization' })).toBeInTheDocument();
    expect(screen.getByLabelText('Organization head name')).toBeInTheDocument();
    expect(screen.getByLabelText('Password for the Org Admin account')).toBeInTheDocument();
  });

  it('shows Super Admin login without an organization code', async () => {
    window.history.pushState({}, '', '/super-admin/login');
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><AuthProvider><BrowserRouter><App /></BrowserRouter></AuthProvider></QueryClientProvider>);
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByLabelText('Email address')).toBeInTheDocument();
    expect(screen.queryByLabelText('Organization Code')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Platform Admin' })).toHaveAttribute('href', '/super-admin/login');
  });

  it('redirects legacy learning URLs to the selected course tab when the course is known', async () => {
    render(<MemoryRouter initialEntries={['/student/notes?courseId=course-1']}><Routes>
      <Route path="/student/notes" element={<LegacyStudentLearningRedirect tab="materials" />} />
      <Route path="*" element={<LocationResult />} />
    </Routes></MemoryRouter>);
    expect(await screen.findByTestId('location')).toHaveTextContent('/student/courses/course-1/materials');
  });

  it('shows and fills local Org Admin demo credentials when enabled', async () => {
    window.history.pushState({}, '', '/org-admin/login');
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><AuthProvider><BrowserRouter><App /></BrowserRouter></AuthProvider></QueryClientProvider>);

    expect(await screen.findByRole('region', { name: 'Development demo credentials' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Fill demo credentials' }));

    expect(screen.getByLabelText('Organization Code')).toHaveValue('jll-demo');
    expect(screen.getByLabelText('Email address')).toHaveValue('orgadmin@jll-demo.local');
    expect(screen.getByLabelText('Password')).toHaveValue('Demo@123');
  });
});
