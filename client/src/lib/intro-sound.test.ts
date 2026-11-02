import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { playIntroSound } from './intro-sound';

class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  static initialState: AudioContextState = 'running';
  state = FakeAudioContext.initialState;
  currentTime = 0;
  sampleRate = 4;
  destination = {};
  sources: Array<{ start: ReturnType<typeof vi.fn> }> = [];
  close = vi.fn(async () => { this.state = 'closed'; });
  resume = vi.fn(async () => { this.state = 'running'; });
  suspend = vi.fn(async () => { this.state = 'suspended'; });

  constructor() {
    FakeAudioContext.instances.push(this);
  }

  createGain() {
    return { gain: { value: 0, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), cancelScheduledValues: vi.fn() }, connect: vi.fn() };
  }

  createBiquadFilter() {
    return { type: 'lowpass', frequency: { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() }, connect: vi.fn() };
  }

  createDelay() {
    return { delayTime: { setValueAtTime: vi.fn() }, connect: vi.fn() };
  }

  createOscillator() {
    const source = { type: 'sine', frequency: { setValueAtTime: vi.fn() }, connect: vi.fn(), start: vi.fn(), stop: vi.fn(), onended: null };
    this.sources.push(source);
    return source;
  }

  createBufferSource() {
    const source = { buffer: null, connect: vi.fn(), start: vi.fn(), stop: vi.fn(), onended: null };
    this.sources.push(source);
    return source;
  }

  createBuffer() {
    return { getChannelData: () => new Float32Array(this.sampleRate) };
  }
}

describe('playIntroSound', () => {
  beforeEach(() => {
    FakeAudioContext.instances = [];
    FakeAudioContext.initialState = 'running';
    vi.stubGlobal('AudioContext', FakeAudioContext);
    window.localStorage.clear();
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn(() => ({ matches: false })),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it.each([
    ['disabled', { enabled: false }],
    ['muted', { muted: true }],
    ['reduced motion', { reducedMotion: true }],
  ])('does not create an AudioContext when %s', (_label, options) => {
    playIntroSound(0, options);
    expect(FakeAudioContext.instances).toHaveLength(0);
  });

  it('stops cleanly and closes its AudioContext', () => {
    vi.useFakeTimers();
    const stop = playIntroSound();
    expect(FakeAudioContext.instances).toHaveLength(1);
    stop();
    vi.advanceTimersByTime(200);
    expect(FakeAudioContext.instances[0].close).toHaveBeenCalledOnce();
  });

  it('resumes only cues that are still ahead of the animation', async () => {
    FakeAudioContext.initialState = 'suspended';
    const stop = playIntroSound(0);
    const context = FakeAudioContext.instances[0];
    expect(context.sources).toHaveLength(0);

    await stop.resumeAudioContext(5000);

    expect(context.sources).toHaveLength(3);
    stop();
  });
});
