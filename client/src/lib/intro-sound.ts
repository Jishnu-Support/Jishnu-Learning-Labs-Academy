import {
  INTRO_DURATION_MS,
  INTRO_FADE_DURATION_MS,
  INTRO_SOUND_ENABLED,
  INTRO_SOUND_PREFERENCE_KEY,
  INTRO_SOUND_SOURCE,
  INTRO_TIMELINE_MS,
} from './brand-config';

type SoundOptions = {
  enabled?: boolean;
  muted?: boolean;
  reducedMotion?: boolean;
  source?: 'synth' | 'file';
};

export type IntroSoundStop = (() => void) & {
  isBlocked: () => boolean;
  resumeAudioContext: (elapsedMs?: number) => Promise<boolean>;
  suspend: () => void;
};

const NOTES = {
  e5: 659.25,
  g5: 783.99,
  c5: 523.25,
  c4: 261.63,
  e4: 329.63,
  g4: 392,
} as const;

function isMutedByPreference(): boolean {
  try {
    return window.localStorage.getItem(INTRO_SOUND_PREFERENCE_KEY) === 'muted';
  } catch {
    return false;
  }
}

function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

function createAudioContext(): AudioContext | null {
  const AudioContextConstructor = window.AudioContext;
  return AudioContextConstructor ? new AudioContextConstructor() : null;
}

function createSynthController(
  offsetMs: number,
  onBlockedChange: (blocked: boolean) => void,
): IntroSoundStop {
  const context = createAudioContext();
  const master = context?.createGain();
  let closed = false;
  let stopped = false;
  let blocked = context?.state === 'suspended';
  let scheduledSources: AudioScheduledSourceNode[] = [];
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  let scheduledOffsetMs = offsetMs;

  const stop = (() => {
    if (stopped) return;
    stopped = true;
    if (closeTimer) clearTimeout(closeTimer);
    if (context && master && context.state !== 'closed') {
      const now = context.currentTime;
      master.gain.cancelScheduledValues(now);
      master.gain.setValueAtTime(master.gain.value, now);
      master.gain.linearRampToValueAtTime(0, now + 0.15);
      closeTimer = setTimeout(() => {
        if (context.state !== 'closed') {
          closed = true;
          void context.close();
        }
      }, 180);
    } else if (context && context.state !== 'closed') {
      closed = true;
      void context.close();
    }
  }) as IntroSoundStop;

  stop.isBlocked = () => blocked;
  stop.suspend = () => {
    if (!context || closed || context.state === 'closed') return;
    for (const source of scheduledSources) source.stop();
    scheduledSources = [];
    void context.suspend();
  };
  stop.resumeAudioContext = async (elapsedMs = offsetMs) => {
    if (!context || closed || stopped || context.state === 'closed') return false;
    const shouldScheduleCues = blocked || context.state !== 'running';
    try {
      await context.resume();
      if (context.state !== 'running') return false;
      blocked = false;
      onBlockedChange(false);
      if (shouldScheduleCues) scheduleCues(elapsedMs);
      return true;
    } catch {
      blocked = true;
      onBlockedChange(true);
      return false;
    }
  };

  if (!context) return stop;

  const filter = context.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(1800, context.currentTime);
  if (!master) return stop;
  master.gain.setValueAtTime(0, context.currentTime);
  filter.connect(master);
  master.connect(context.destination);
  const delay = context.createDelay(0.5);
  delay.delayTime.setValueAtTime(0.16, context.currentTime);
  const echoGain = context.createGain();
  echoGain.gain.setValueAtTime(0.08, context.currentTime);
  master.connect(delay);
  delay.connect(echoGain);
  echoGain.connect(context.destination);

  const scheduleTone = (
    frequency: number,
    startMs: number,
    durationMs: number,
    volume: number,
    waveform: OscillatorType = 'sine',
  ) => {
    if (!context || !master || startMs < scheduledOffsetMs || blocked || stopped || closed) return;
    const when = context.currentTime + Math.max(0, startMs - scheduledOffsetMs) / 1000;
    const oscillator = context.createOscillator();
    const envelope = context.createGain();
    oscillator.type = waveform;
    oscillator.frequency.setValueAtTime(frequency, when);
    envelope.gain.setValueAtTime(0, when);
    envelope.gain.linearRampToValueAtTime(volume, when + 0.04);
    envelope.gain.setValueAtTime(volume, when + Math.max(0.05, durationMs / 1000 - 0.12));
    envelope.gain.linearRampToValueAtTime(0, when + durationMs / 1000);
    oscillator.connect(envelope);
    envelope.connect(filter);
    oscillator.start(when);
    oscillator.stop(when + durationMs / 1000 + 0.01);
    scheduledSources.push(oscillator);
    oscillator.onended = () => {
      scheduledSources = scheduledSources.filter((source) => source !== oscillator);
    };
  };

  const scheduleWhoosh = (startMs: number) => {
    if (!context || !master || startMs < scheduledOffsetMs || blocked || stopped || closed) return;
    const when = context.currentTime + Math.max(0, startMs - scheduledOffsetMs) / 1000;
    const noise = context.createBufferSource();
    const buffer = context.createBuffer(1, context.sampleRate, context.sampleRate);
    const channel = buffer.getChannelData(0);
    for (let index = 0; index < channel.length; index += 1) channel[index] = Math.random() * 2 - 1;
    noise.buffer = buffer;
    const noiseFilter = context.createBiquadFilter();
    noiseFilter.type = 'lowpass';
    noiseFilter.frequency.setValueAtTime(350, when);
    noiseFilter.frequency.linearRampToValueAtTime(1400, when + 0.9);
    const envelope = context.createGain();
    envelope.gain.setValueAtTime(0, when);
    envelope.gain.linearRampToValueAtTime(0.035, when + 0.15);
    envelope.gain.linearRampToValueAtTime(0, when + 1.1);
    noise.connect(noiseFilter);
    noiseFilter.connect(envelope);
    envelope.connect(filter);
    noise.start(when);
    noise.stop(when + 1.12);
    scheduledSources.push(noise);
    noise.onended = () => {
      scheduledSources = scheduledSources.filter((source) => source !== noise);
    };
  };

  const scheduleCues = (elapsedMs: number) => {
    if (!context || !master || blocked || stopped || closed) return;
    scheduledOffsetMs = elapsedMs;
    const now = context.currentTime;
    const remaining = Math.max(0, INTRO_DURATION_MS - elapsedMs) / 1000;
    const fadeDurationSeconds = INTRO_FADE_DURATION_MS / 1000;
    master.gain.cancelScheduledValues(now);
    master.gain.setValueAtTime(0, now);
    master.gain.linearRampToValueAtTime(0.24, now + 0.15);
    master.gain.setValueAtTime(0.24, now + Math.max(0.15, remaining - fadeDurationSeconds));
    master.gain.linearRampToValueAtTime(0, now + remaining);

    scheduleWhoosh(0);
    scheduleTone(NOTES.e5, INTRO_TIMELINE_MS.logoStart, 420, 0.12);
    scheduleTone(NOTES.g5, INTRO_TIMELINE_MS.logoStart + 180, 520, 0.1);
    for (const note of [NOTES.c4, NOTES.g4, NOTES.e4]) {
      scheduleTone(note, INTRO_TIMELINE_MS.poweredByStart, 1350, 0.045);
    }
    [NOTES.c5, NOTES.e5, NOTES.g5].forEach((note, index) => {
      scheduleTone(note, INTRO_TIMELINE_MS.welcomeStart + index * 190, 450, 0.075);
    });
    [NOTES.g5, NOTES.e5, NOTES.g5].forEach((note, index) => {
      scheduleTone(note, INTRO_TIMELINE_MS.taglineStart + index * 170, 260, 0.045);
    });
  };

  if (context.state === 'running') {
    blocked = false;
    onBlockedChange(false);
    scheduleCues(offsetMs);
  } else {
    blocked = true;
    onBlockedChange(true);
  }

  return stop;
}

function createFileController(offsetMs: number, onBlockedChange: (blocked: boolean) => void): IntroSoundStop {
  const audio = new Audio('/brand/intro-chime.mp3');
  let stopped = false;
  let blocked = false;
  let synthFallback: IntroSoundStop | null = null;
  let fadeStartTimer: ReturnType<typeof setTimeout> | undefined;
  let fadeOutTimer: ReturnType<typeof setTimeout> | undefined;
  let rampTimer: ReturnType<typeof setInterval> | undefined;

  const fadeTo = (target: number, durationMs: number, onFinish?: () => void) => {
    if (rampTimer) clearInterval(rampTimer);
    const startVolume = audio.volume;
    const steps = Math.max(1, Math.ceil(durationMs / 25));
    let step = 0;
    rampTimer = setInterval(() => {
      step += 1;
      audio.volume = startVolume + (target - startVolume) * Math.min(1, step / steps);
      if (step === steps) {
        if (rampTimer) clearInterval(rampTimer);
        rampTimer = undefined;
        onFinish?.();
      }
    }, 25);
  };

  const stop = (() => {
    synthFallback?.();
    if (stopped) return;
    stopped = true;
    if (fadeStartTimer) clearTimeout(fadeStartTimer);
    if (fadeOutTimer) clearTimeout(fadeOutTimer);
    fadeTo(0, 150, () => {
        audio.pause();
        audio.removeAttribute('src');
        audio.load();
    });
  }) as IntroSoundStop;
  stop.isBlocked = () => synthFallback?.isBlocked() ?? blocked;
  stop.suspend = () => {
    if (synthFallback) synthFallback.suspend();
    else audio.pause();
  };
  stop.resumeAudioContext = async (elapsedMs = offsetMs) => {
    if (synthFallback) return synthFallback.resumeAudioContext(elapsedMs);
    if (stopped) return false;
    audio.currentTime = Math.min(elapsedMs / 1000, audio.duration || elapsedMs / 1000);
    try {
      await audio.play();
      blocked = false;
      onBlockedChange(false);
      fadeTo(0.24, 150);
      if (!fadeOutTimer) {
        fadeOutTimer = setTimeout(
          () => fadeTo(0, INTRO_FADE_DURATION_MS),
          Math.max(0, INTRO_DURATION_MS - elapsedMs - INTRO_FADE_DURATION_MS),
        );
      }
      return true;
    } catch {
      blocked = true;
      onBlockedChange(true);
      return false;
    }
  };

  audio.volume = 0;
  audio.currentTime = offsetMs / 1000;
  audio.addEventListener('error', () => {
    if (stopped) return;
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    synthFallback = createSynthController(offsetMs, onBlockedChange);
    blocked = synthFallback.isBlocked();
    onBlockedChange(blocked);
  }, { once: true });
  audio.addEventListener('ended', stop, { once: true });
  audio.addEventListener('canplaythrough', () => {
    if (stopped) return;
    fadeStartTimer = setTimeout(() => {
      void stop.resumeAudioContext(offsetMs);
    }, 150);
  }, { once: true });
  audio.load();
  blocked = true;
  onBlockedChange(true);
  return stop;
}

export function playIntroSound(
  offsetMs = 0,
  options: SoundOptions = {},
  onBlockedChange: (blocked: boolean) => void = () => undefined,
): IntroSoundStop {
  const enabled = options.enabled ?? INTRO_SOUND_ENABLED;
  const muted = options.muted ?? isMutedByPreference();
  const reducedMotion = options.reducedMotion ?? prefersReducedMotion();
  if (!enabled || muted || reducedMotion) {
    const stop = (() => undefined) as IntroSoundStop;
    stop.isBlocked = () => false;
    stop.resumeAudioContext = async () => false;
    stop.suspend = () => undefined;
    return stop;
  }

  const source = options.source ?? INTRO_SOUND_SOURCE;
  if (source === 'file') return createFileController(offsetMs, onBlockedChange);
  return createSynthController(offsetMs, onBlockedChange);
}
