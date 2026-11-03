import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { AuthContext, type CurrentUser } from '../auth/auth-context';
import { RouteGuard } from './route-guard';

function makeUser(role: CurrentUser['role']): CurrentUser {
  return {
    id: 'user-1',
    organizationId: role === 'SUPER_ADMIN' ? null : 'org-1',
    email: 'user@example.test',
    name: 'Test User',
    role,
    organization: role === 'SUPER_ADMIN' ? null : { name: 'Demo Academy', code: 'demo', isPlatformOwner: true },
  };
}

function LocationStateReader() {
  const location = useLocation();
  const state = location.state as { toast?: string } | undefined;
  return <output data-testid="location">{`${location.pathname}${location.search}`}::{state?.toast ?? ''}</output>;
}

describe('RouteGuard', () => {
  it('redirects signed-out users to the matching login page with a return target', () => {
    render(
      <AuthContext.Provider value={{ user: null, loading: false, logout: vi.fn() }}>
        <MemoryRouter initialEntries={['/org-admin/students']}>
          <Routes>
            <Route element={<RouteGuard roles={['ORG_ADMIN']} />}>
              <Route path="/org-admin/students" element={<div>Secret page</div>} />
            </Route>
            <Route path="/org-admin/login" element={<LocationStateReader />} />
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider>,
    );

    expect(screen.getByTestId('location')).toHaveTextContent('/org-admin/login?returnTo=%2Forg-admin%2Fstudents');
  });

  it('redirects wrong-role users to their dashboard with a toast', () => {
    render(
      <AuthContext.Provider value={{ user: makeUser('STUDENT'), loading: false, logout: vi.fn() }}>
        <MemoryRouter initialEntries={['/org-admin/students']}>
          <Routes>
            <Route element={<RouteGuard roles={['ORG_ADMIN']} />}>
              <Route path="/org-admin/students" element={<div>Secret page</div>} />
            </Route>
            <Route path="/student" element={<LocationStateReader />} />
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider>,
    );

    expect(screen.getByTestId('location')).toHaveTextContent('/student::You do not have access to that page');
  });
});
