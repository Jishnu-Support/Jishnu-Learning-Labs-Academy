import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../auth/auth-context';
import {
  INTRO_CONFIG,
  INTRO_DURATION_MS,
  INTRO_FADE_DURATION_MS,
  INTRO_REDUCED_MOTION_DURATION_MS,
  INTRO_SOUND_PREFERENCE_KEY,
  INTRO_TIMELINE_MS,
} from '../lib/brand-config';
import { playIntroSound, type IntroSoundStop } from '../lib/intro-sound';
import { BrandLogo } from './brand-logo';
import { Button } from './ui/button';

const SESSION_KEY = 'jll-welcome-intro-shown';
const LOGIN_PATH = /^\/(student|instructor|staff|org-admin|super-admin)\/login$/;

function getReducedMotionPreference() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

function getMutedPreference() {
  try {
    return window.localStorage.getItem(INTRO_SOUND_PREFERENCE_KEY) === 'muted';
  } catch {
    return false;
  }
}

function setMutedPreference(muted: boolean) {
  try {
    window.localStorage.setItem(INTRO_SOUND_PREFERENCE_KEY, muted ? 'muted' : 'unmuted');
  } catch {
    return;
  }
}

function getIntroDuration(reducedMotion: boolean) {
  return reducedMotion ? INTRO_REDUCED_MOTION_DURATION_MS : INTRO_DURATION_MS;
}

function WelcomeText() {
  return (
    <p className="intro-welcome" aria-label={INTRO_CONFIG.copy.welcome}>
      {INTRO_CONFIG.copy.welcome.split(' ').map((word, index) => (
        <span key={`${word}-${index}`} aria-hidden="true" style={{ '--word-index': index } as CSSProperties}>{word}&nbsp;</span>
      ))}
    </p>
  );
}

function PoweredByText() {
  return (
    <p className="intro-powered" aria-label={INTRO_CONFIG.copy.poweredBy}>
      {Array.from(INTRO_CONFIG.copy.poweredBy).map((character, index) => (
        <span key={`${character}-${index}`} aria-hidden="true" style={{ '--letter-index': index } as CSSProperties}>{character === ' ' ? '\u00a0' : character}</span>
      ))}
    </p>
  );
}

export function BrandIntro({ onComplete }: { onComplete: () => void }) {
  const [reducedMotion, setReducedMotion] = useState(getReducedMotionPreference);
  const [started, setStarted] = useState(!INTRO_CONFIG.requireTap);
  const [skipVisible, setSkipVisible] = useState(false);
  const [muted, setMuted] = useState(getMutedPreference);
  const [soundBlocked, setSoundBlocked] = useState(false);
  const startTime = useRef<number | null>(null);
  const sound = useRef<IntroSoundStop | null>(null);
  const completed = useRef(false);
  const soundStarted = useRef(false);
  const durationMs = getIntroDuration(reducedMotion);

  const elapsedMs = useCallback(() => (
    startTime.current === null ? 0 : Math.max(0, performance.now() - startTime.current)
  ), []);

  const stopSound = useCallback(() => {
    sound.current?.();
    sound.current = null;
    soundStarted.current = false;
  }, []);

  useEffect(() => () => stopSound(), [stopSound]);

  useEffect(() => {
    if (!reducedMotion) return;
    stopSound();
    soundStarted.current = false;
    setSoundBlocked(false);
  }, [reducedMotion, stopSound]);

  const startSound = useCallback((elapsed = elapsedMs()) => {
    stopSound();
    if (muted || reducedMotion || !INTRO_CONFIG.soundEnabled) return;
    sound.current = playIntroSound(elapsed, {}, setSoundBlocked);
    setSoundBlocked(sound.current.isBlocked());
    soundStarted.current = true;
  }, [elapsedMs, muted, reducedMotion, stopSound]);

  const finish = useCallback(() => {
    if (completed.current) return;
    completed.current = true;
    stopSound();
    onComplete();
  }, [onComplete, stopSound]);

  const start = useCallback(() => {
    if (startTime.current !== null) return;
    startTime.current = performance.now();
    setStarted(true);
    if (!reducedMotion && !muted && INTRO_CONFIG.soundEnabled) startSound(0);
  }, [muted, reducedMotion, startSound]);

  useEffect(() => {
    if (!started) return undefined;
    if (startTime.current === null) startTime.current = performance.now();
    if (!soundStarted.current && !muted && !reducedMotion && INTRO_CONFIG.soundEnabled) {
      startSound(elapsedMs());
    }
    const elapsed = elapsedMs();
    const skipTimer = window.setTimeout(() => setSkipVisible(true), Math.max(0, INTRO_TIMELINE_MS.skipAvailable - elapsed));
    const finishTimer = window.setTimeout(finish, Math.max(0, durationMs - elapsed));
    return () => {
      window.clearTimeout(skipTimer);
      window.clearTimeout(finishTimer);
    };
  }, [durationMs, elapsedMs, finish, muted, reducedMotion, startSound, started]);

  useEffect(() => {
    if (!started) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') finish();
      else if (soundBlocked && !muted && event.key !== 'Tab') void sound.current?.resumeAudioContext(elapsedMs());
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') sound.current?.suspend();
      else if (sound.current && !muted) void sound.current.resumeAudioContext(elapsedMs());
    };
    const handlePointer = () => {
      if (soundBlocked && !muted) void sound.current?.resumeAudioContext(elapsedMs());
    };
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('pointerdown', handlePointer);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('pointerdown', handlePointer);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [elapsedMs, finish, muted, soundBlocked, started]);

  useEffect(() => {
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!media) return undefined;
    const update = () => setReducedMotion(media.matches);
    media.addEventListener?.('change', update);
    return () => media.removeEventListener?.('change', update);
  }, []);

  useEffect(() => {
    document.documentElement.classList.add('intro-playing');
    return () => document.documentElement.classList.remove('intro-playing');
  }, []);

  const toggleMute = () => {
    const nextMuted = !muted;
    setMuted(nextMuted);
    setMutedPreference(nextMuted);
    if (nextMuted) {
      stopSound();
      soundStarted.current = false;
      setSoundBlocked(false);
    } else if (!reducedMotion && started) {
      startSound(elapsedMs());
    }
  };

  const cssStyle = {
    '--intro-duration': `${durationMs}ms`,
    '--intro-fade-duration': `${INTRO_FADE_DURATION_MS}ms`,
    '--intro-arcs-end': `${INTRO_TIMELINE_MS.arcsEnd}ms`,
    '--intro-logo-start': `${INTRO_TIMELINE_MS.logoStart}ms`,
    '--intro-powered-start': `${INTRO_TIMELINE_MS.poweredByStart}ms`,
    '--intro-welcome-start': `${INTRO_TIMELINE_MS.welcomeStart}ms`,
    '--intro-tagline-start': `${INTRO_TIMELINE_MS.taglineStart}ms`,
    '--intro-fade-start': `${INTRO_TIMELINE_MS.fadeStart}ms`,
  } as CSSProperties;

  return (
    <section
      className={`brand-intro${reducedMotion ? ' intro-reduced' : ''}${!started ? ' intro-pending' : ''}`}
      style={cssStyle}
      role="status"
      aria-live="polite"
      aria-label={INTRO_CONFIG.copy.welcome}
    >
      {started && (
        <>
          <div className="intro-decoration" aria-hidden="true">
            <svg viewBox="0 0 360 360" focusable="false">
              <circle className="intro-arc intro-arc-gray" cx="180" cy="180" r="152" />
              <circle className="intro-arc intro-arc-lime" cx="180" cy="180" r="130" />
            </svg>
            <div className="intro-dots">{[0, 1, 2, 3, 4].map((dot) => <span key={dot} />)}</div>
          </div>
          <div className="intro-glow" aria-hidden="true" />
          <div className="intro-content">
            <BrandLogo className="intro-logo" />
            <PoweredByText />
            <WelcomeText />
            <p className="intro-tagline">{INTRO_CONFIG.copy.tagline}</p>
          </div>
          <div className="intro-sparks" aria-hidden="true"><span /><span /><span /><span /></div>
        </>
      )}
      {!started && (
        <div className="intro-enter-panel">
          <BrandLogo className="intro-enter-logo" />
          <Button onClick={start}>Enter</Button>
        </div>
      )}
      <div className="intro-controls">
        {INTRO_CONFIG.soundEnabled && !reducedMotion && (
          <Button
            variant="secondary"
            className="intro-sound-toggle"
            aria-label={muted ? 'Unmute intro sound' : 'Mute intro sound'}
            onClick={toggleMute}
          >
            {muted ? <VolumeX size={16} aria-hidden="true" /> : <Volume2 size={16} aria-hidden="true" />}
            {muted ? 'Unmute' : 'Mute'}
          </Button>
        )}
        {soundBlocked && !muted && !reducedMotion && (
          <Button variant="secondary" className="intro-sound-toggle" onClick={() => void sound.current?.resumeAudioContext(elapsedMs())}>
            <Volume2 size={16} aria-hidden="true" /> Tap for sound
          </Button>
        )}
        {skipVisible && (
          <Button variant="secondary" className="intro-skip" onClick={finish}>Skip</Button>
        )}
      </div>
    </section>
  );
}

export function BrandIntroGate({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  const [showIntro, setShowIntro] = useState(false);
  const attempted = useRef(false);

  useEffect(() => {
    if (attempted.current || loading || user) return;
    if (location.pathname !== '/' && !LOGIN_PATH.test(location.pathname)) return;
    attempted.current = true;
    try {
      if (window.sessionStorage.getItem(SESSION_KEY) === 'shown') return;
      window.sessionStorage.setItem(SESSION_KEY, 'shown');
    } catch {
      return;
    }
    setShowIntro(true);
  }, [loading, location.pathname, user]);

  return (
    <>
      <div className="app-content" inert={showIntro} aria-hidden={showIntro}>
        {children}
      </div>
      {showIntro && <BrandIntro onComplete={() => setShowIntro(false)} />}
    </>
  );
}
