import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext } from '../auth/auth-context';
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

function renderGate(path = '/student/login') {
  return render(
    <AuthContext.Provider value={{ user: null, loading: false, logout: vi.fn() }}>
      <MemoryRouter initialEntries={[path]}>
        <BrandIntroGate><main>Portal content</main></BrandIntroGate>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
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

  it('shows on the first public visit and not again during the same session', () => {
    const firstVisit = renderGate();
    expect(screen.getByRole('status', { name: 'Welcome to Jishnu Learning Labs' })).toBeInTheDocument();
    firstVisit.unmount();

    renderGate('/instructor/login');
    expect(screen.queryByRole('status', { name: 'Welcome to Jishnu Learning Labs' })).not.toBeInTheDocument();
  });

  it('does not show after an authenticated visit', () => {
    window.sessionStorage.clear();
    render(
      <AuthContext.Provider value={{
        user: { id: 'user-1', organizationId: 'org-1', email: 'user@example.test', name: 'Test User', role: 'STUDENT' },
        loading: false,
        logout: vi.fn(),
      }}>
        <MemoryRouter initialEntries={['/student/login']}>
          <BrandIntroGate><main>Portal content</main></BrandIntroGate>
        </MemoryRouter>
      </AuthContext.Provider>,
    );
    expect(screen.queryByRole('status', { name: 'Welcome to Jishnu Learning Labs' })).not.toBeInTheDocument();
  });

  it('allows the user to skip after the intro controls appear', () => {
    vi.useFakeTimers();
    renderGate();
    act(() => vi.advanceTimersByTime(1000));
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    expect(screen.queryByRole('status', { name: 'Welcome to Jishnu Learning Labs' })).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(200));
    expect(FakeAudioContext.instances[0]?.close).toHaveBeenCalledOnce();
  });

  it('uses the reduced-motion presentation without creating audio', () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
    });
    const { container } = renderGate();
    expect(container.querySelector('.brand-intro')).toHaveClass('intro-reduced');
    expect(FakeAudioContext.instances).toHaveLength(0);
  });

  it('offers sound recovery when autoplay is blocked and only schedules upcoming cues', async () => {
    vi.useFakeTimers();
    FakeAudioContext.initialState = 'suspended';
    const currentTime = vi.spyOn(performance, 'now').mockReturnValue(0);
    renderGate();
    expect(screen.getByRole('button', { name: 'Tap for sound' })).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(5000));
    currentTime.mockReturnValue(5000);
    fireEvent.click(screen.getByRole('button', { name: 'Tap for sound' }));
    await act(async () => Promise.resolve());

    const context = FakeAudioContext.instances[0];
    expect(context.resume).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: 'Tap for sound' })).not.toBeInTheDocument();
  });

  it('persists mute preference and closes audio when the intro unmounts', () => {
    vi.useFakeTimers();
    const view = renderGate();
    fireEvent.click(screen.getByRole('button', { name: 'Mute intro sound' }));
    expect(window.localStorage.getItem('jll-intro-sound')).toBe('muted');
    fireEvent.click(screen.getByRole('button', { name: 'Unmute intro sound' }));
    view.unmount();
    act(() => vi.advanceTimersByTime(200));
    expect(FakeAudioContext.instances).toHaveLength(2);
    expect(FakeAudioContext.instances.every((context) => context.close.mock.calls.length === 1)).toBe(true);
  });
});
