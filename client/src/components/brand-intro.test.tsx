import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext, type CurrentUser } from '../auth/auth-context';
import type { IntroMode } from '../lib/brand-config';
import { INTRO_LOGIN_SUCCESS_EVENT } from '../lib/brand-config';
import { playIntroSound } from '../lib/intro-sound';
import { BrandIntroGate } from './brand-intro';

class FakeParam {
  value = 0;
  setValueAtTime = vi.fn();
  linearRampToValueAtTime = vi.fn();
  cancelScheduledValues = vi.fn();
}

class FakeSource {
  onended: (() => void) | null = null;
  frequency = new FakeParam();
  connect = vi.fn();
  start = vi.fn();
  stop = vi.fn();
  type: OscillatorType = 'sine';
  buffer: AudioBuffer | null = null;
}

class FakeAudioContext {
  static initialState: AudioContextState = 'running';
  static instances: FakeAudioContext[] = [];
  state: AudioContextState = FakeAudioContext.initialState;
  currentTime = 0;
  sampleRate = 4;
  destination = {};
  sources: FakeSource[] = [];
  close = vi.fn(async () => { this.state = 'closed'; });
  resume = vi.fn(async () => { this.state = 'running'; });
  suspend = vi.fn(async () => { this.state = 'suspended'; });

  constructor() {
    FakeAudioContext.instances.push(this);
  }

  createGain() {
    return { gain: new FakeParam(), connect: vi.fn() };
  }

  createBiquadFilter() {
    return { type: 'lowpass', frequency: new FakeParam(), connect: vi.fn() };
  }

  createDelay() {
    return { delayTime: new FakeParam(), connect: vi.fn() };
  }

  createOscillator() {
    const source = new FakeSource();
    this.sources.push(source);
    return source;
  }

  createBufferSource() {
    const source = new FakeSource();
    this.sources.push(source);
    return source;
  }

  createBuffer() {
    return { getChannelData: () => new Float32Array(this.sampleRate) };
  }
}

function NavigationHarness() {
  const navigate = useNavigate();
  return (
    <>
      <main>Portal content</main>
      <button type="button" onClick={() => navigate('/courses?search=math')}>Open another page</button>
    </>
  );
}

function renderGate({
  path = '/student/login',
  mode = 'every-load',
  user = null,
}: {
  path?: string;
  mode?: IntroMode;
  user?: CurrentUser | null;
} = {}) {
  return render(
    <AuthContext.Provider value={{ user, loading: false, logout: vi.fn() }}>
      <MemoryRouter initialEntries={[path]}>
        <BrandIntroGate mode={mode}><NavigationHarness /></BrandIntroGate>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

function makeUser(role: CurrentUser['role'], isPlatformOwner: boolean, name = 'Example Academy'): CurrentUser {
  return {
    id: 'user-1',
    organizationId: role === 'SUPER_ADMIN' ? null : 'org-1',
    email: 'user@example.test',
    name: 'Test User',
    role,
    organization: role === 'SUPER_ADMIN' ? null : { name, code: 'example-academy', isPlatformOwner },
  };
}

describe('BrandIntro', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    window.localStorage.clear();
    FakeAudioContext.instances = [];
    FakeAudioContext.initialState = 'running';
    vi.stubGlobal('AudioContext', FakeAudioContext);
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('plays on every full app load, including when a prior session marker exists', () => {
    window.sessionStorage.setItem('jll-welcome-intro-shown', 'shown');
    const firstLoad = renderGate();
    expect(screen.getByRole('status', { name: 'Welcome to Jishnu Learning Labs' })).toBeInTheDocument();
    firstLoad.unmount();

    renderGate({ path: '/student/dashboard' });
    expect(screen.getByRole('status', { name: 'Welcome to Jishnu Learning Labs' })).toBeInTheDocument();
  });

  it('shows the owner variant for a platform-owner organization and Super Admin', () => {
    const ownerView = renderGate({ user: makeUser('STUDENT', true) });
    expect(screen.getByRole('status', { name: 'Welcome to Jishnu Learning Labs' })).toBeInTheDocument();
    ownerView.unmount();

    renderGate({ user: makeUser('SUPER_ADMIN', false) });
    expect(screen.getByRole('status', { name: 'Welcome to Jishnu Learning Labs' })).toBeInTheDocument();
  });

  it('shows the partner variant for a non-owner organization user', () => {
    renderGate({ user: makeUser('STUDENT', false) });
    expect(screen.getByRole('status', { name: 'Powered by Jishnu Learning Labs' })).toBeInTheDocument();
  });

  it('uses the remembered organization code when the user organization is unknown', async () => {
    window.localStorage.setItem('jll-last-org-code', 'northstar-academy');
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: { variant: 'PARTNER' } }),
    })));
    renderGate();
    expect(await screen.findByRole('status', { name: 'Powered by Jishnu Learning Labs' })).toBeInTheDocument();
  });

  it('defaults to the owner variant when no organization information is available', () => {
    renderGate();
    expect(screen.getByRole('status', { name: 'Welcome to Jishnu Learning Labs' })).toBeInTheDocument();
  });

  it('does not replay on route changes, but runs after login in after-login-only mode', () => {
    vi.useFakeTimers();
    renderGate({ mode: 'after-login-only' });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    act(() => window.dispatchEvent(new Event(INTRO_LOGIN_SUCCESS_EVENT)));
    expect(screen.getByRole('status', { name: 'Welcome to Jishnu Learning Labs' })).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(7000));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open another page' }));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('honors once-per-session mode on load and after login', () => {
    const firstVisit = renderGate({ mode: 'once-per-session' });
    expect(screen.getByRole('status')).toBeInTheDocument();
    firstVisit.unmount();

    renderGate({ mode: 'once-per-session' });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    act(() => window.dispatchEvent(new Event(INTRO_LOGIN_SUCCESS_EVENT)));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('plays after login in after-login-only mode', () => {
    renderGate({ mode: 'after-login-only' });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    act(() => window.dispatchEvent(new Event(INTRO_LOGIN_SUCCESS_EVENT)));
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('allows the user to skip and closes the audio context', () => {
    vi.useFakeTimers();
    renderGate();
    act(() => vi.advanceTimersByTime(1000));
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(200));
    expect(FakeAudioContext.instances[0]?.close).toHaveBeenCalledOnce();
  });

  it('uses reduced motion without creating audio', () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
    });
    const { container } = renderGate();
    expect(container.querySelector('.brand-intro')).toHaveClass('intro-reduced');
    expect(FakeAudioContext.instances).toHaveLength(0);
  });

  it('does not create an audio context when sound is disabled or muted', () => {
    playIntroSound(0, { enabled: false });
    window.localStorage.setItem('jll-intro-sound', 'muted');
    playIntroSound();
    expect(FakeAudioContext.instances).toHaveLength(0);
  });

  it('does not replay the intro during an in-app route change', () => {
    vi.useFakeTimers();
    renderGate();
    act(() => vi.advanceTimersByTime(7000));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open another page' }));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('offers sound recovery when autoplay is blocked', async () => {
    FakeAudioContext.initialState = 'suspended';
    renderGate();
    expect(screen.getByRole('button', { name: 'Tap for sound' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Tap for sound' }));
    await waitFor(() => expect(FakeAudioContext.instances[0]?.resume).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: 'Tap for sound' })).not.toBeInTheDocument();
  });

  it('persists mute preference and closes audio when unmounted', () => {
    vi.useFakeTimers();
    const view = renderGate();
    fireEvent.click(screen.getByRole('button', { name: 'Mute intro sound' }));
    expect(window.localStorage.getItem('jll-intro-sound')).toBe('muted');
    fireEvent.click(screen.getByRole('button', { name: 'Unmute intro sound' }));
    view.unmount();
    act(() => vi.advanceTimersByTime(200));
    expect(FakeAudioContext.instances.every((context) => context.close.mock.calls.length === 1)).toBe(true);
  });
});
