import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, MemoryRouter } from 'react-router-dom';
import { App } from './app';
import { AuthProvider } from './auth/auth-provider';
import { AuthContext, type CurrentUser } from './auth/auth-context';

vi.mock('./components/brand-intro', () => ({
  BrandIntroGate: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

function userForRole(role: CurrentUser['role']): CurrentUser {
  return {
    id: 'test-user',
    organizationId: 'test-organization',
    email: 'test@example.test',
    name: 'Test User',
    role,
    organization: { name: 'Test Academy', code: 'test', isPlatformOwner: false },
  };
}

describe('Phase 1 portal shell', () => {
  it('shows the student sign-in screen and registration link', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><AuthProvider><BrowserRouter><App /></BrowserRouter></AuthProvider></QueryClientProvider>);
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByLabelText('Organization Code')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /register as student/i })).toHaveAttribute('href', '/student/register');
  });

  it('redirects legacy instructor registration to the shared Staff Portal registration', async () => {
    window.history.pushState({}, '', '/instructor/register');
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><AuthProvider><BrowserRouter><App /></BrowserRouter></AuthProvider></QueryClientProvider>);
    expect(await screen.findByRole('heading', { name: 'Create your account' })).toBeInTheDocument();
    expect(screen.getByText('STAFF PORTAL')).toBeInTheDocument();
    expect(screen.getByText(/organization admin must approve/i)).toBeInTheDocument();
    expect(screen.getByLabelText('Organization Code')).toBeInTheDocument();
    expect(screen.getByLabelText('Full name')).toBeInTheDocument();
    expect(screen.queryByLabelText('Student ID')).not.toBeInTheDocument();
  });

  it('uses one Staff Portal login while retaining instructor registration', async () => {
    window.history.pushState({}, '', '/staff/login');
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><AuthProvider><BrowserRouter><App /></BrowserRouter></AuthProvider></QueryClientProvider>);
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Register as an instructor' })).toHaveAttribute('href', '/staff/register/instructor');
    expect(screen.queryByRole('link', { name: /^Instructor$/ })).not.toBeInTheDocument();
  });

  it('keeps instructor-only tools unavailable to Staff in the shared portal', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <AuthContext.Provider value={{ user: userForRole('STAFF'), loading: false, logout: vi.fn() }}>
          <MemoryRouter initialEntries={['/staff/courses']}>
            <App />
          </MemoryRouter>
        </AuthContext.Provider>
      </QueryClientProvider>,
    );

    expect(await screen.findByText('You do not have access to that page')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Courses' })).not.toBeInTheDocument();
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
