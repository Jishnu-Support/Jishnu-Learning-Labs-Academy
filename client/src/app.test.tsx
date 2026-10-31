import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { App } from './app';
import { AuthProvider } from './auth/auth-provider';

describe('Phase 1 portal shell', () => {
  it('shows the student sign-in screen and registration link', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><AuthProvider><BrowserRouter><App /></BrowserRouter></AuthProvider></QueryClientProvider>);
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /create a student account/i })).toHaveAttribute('href', '/student/register');
  });
});
