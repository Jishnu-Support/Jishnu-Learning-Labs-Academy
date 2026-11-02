const navigationRecords = new Map<number, string>();

function currentHistoryIndex(): number {
  const index = window.history.state?.idx;
  return typeof index === 'number' ? index : 0;
}

export function recordAppLocation(path: string, navigationType: 'POP' | 'PUSH' | 'REPLACE'): void {
  const index = currentHistoryIndex();
  if (navigationType === 'REPLACE' && index > 0 && !navigationRecords.has(index - 1)) {
    navigationRecords.set(index - 1, '');
  }
  navigationRecords.set(index, path);
}

export function hasSafeAppHistory(): boolean {
  const index = currentHistoryIndex();
  const previous = navigationRecords.get(index - 1);
  if (!previous) return false;
  const pathname = previous.split(/[?#]/, 1)[0];
  return !/^\/(student|instructor|staff|org-admin|super-admin)\/login\/?$/.test(pathname);
}

export function resetAppNavigationForTests(): void {
  navigationRecords.clear();
}
