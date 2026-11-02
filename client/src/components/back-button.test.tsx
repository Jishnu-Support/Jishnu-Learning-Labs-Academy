import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BackButton } from './back-button';
import { PageHeader } from './page-header';
import { recordAppLocation, resetAppNavigationForTests } from '../lib/app-navigation';

function CurrentLocation() {
  const location = useLocation();
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>;
}

describe('BackButton', () => {
  beforeEach(() => {
    resetAppNavigationForTests();
    window.history.replaceState({ idx: 0 }, '', '/');
  });

  it('returns to the explicit parent when the page was opened directly', () => {
    render(
      <MemoryRouter initialEntries={['/details']}>
        <Routes>
          <Route path="/details" element={<><BackButton backTo="/directory" /><CurrentLocation /></>} />
          <Route path="/directory" element={<CurrentLocation />} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/directory');
  });

  it('returns to the previous in-app page when history exists', () => {
    recordAppLocation('/directory', 'POP');
    window.history.replaceState({ idx: 1 }, '', '/details');
    render(
      <MemoryRouter initialEntries={['/directory', '/details']} initialIndex={1}>
        <Routes>
          <Route path="*" element={<><BackButton backTo="/fallback" /><CurrentLocation /></>} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/directory');
  });

  it('preserves list filters and pagination when returning from a detail page', () => {
    const list = '/org-admin/staff?search=STF-1001&status=APPROVED&page=3';
    recordAppLocation(list, 'POP');
    window.history.replaceState({ idx: 1 }, '', `${list}&detail=staff-1`);
    render(
      <MemoryRouter initialEntries={[list, `${list}&detail=staff-1`]} initialIndex={1}>
        <Routes>
          <Route path="*" element={<><BackButton backTo="/org-admin/staff" /><CurrentLocation /></>} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByTestId('location')).toHaveTextContent(list);
  });

  it('asks before discarding unsaved changes and confirms navigation', () => {
    render(
      <MemoryRouter initialEntries={['/form']}>
        <Routes>
          <Route path="/form" element={<><PageHeader title="Edit staff" backTo="/staff" hasUnsavedChanges /><CurrentLocation /></>} />
          <Route path="/staff" element={<CurrentLocation />} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Discard changes?');
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/staff');
  });

  it('confirms before allowing browser Back to leave a dirty form', () => {
    const confirm = vi.fn(() => false);
    vi.stubGlobal('confirm', confirm);
    const go = vi.spyOn(window.history, 'go').mockImplementation(() => undefined);
    render(
      <MemoryRouter initialEntries={['/form']}>
        <PageHeader title="Edit staff" backTo="/staff" hasUnsavedChanges />
      </MemoryRouter>,
    );
    fireEvent(window, new PopStateEvent('popstate'));
    expect(confirm).toHaveBeenCalledWith('Discard changes? You have unsaved changes.');
    expect(go).toHaveBeenCalledWith(1);
    go.mockRestore();
    vi.unstubAllGlobals();
  });
});
