import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../auth/auth-context';
import {
  INTRO_CONFIG,
  INTRO_DURATION_MS,
  INTRO_FADE_DURATION_MS,
  INTRO_LOGIN_SUCCESS_EVENT,
  INTRO_MODE,
  INTRO_REDUCED_MOTION_DURATION_MS,
  INTRO_SOUND_PREFERENCE_KEY,
  INTRO_TIMELINE_MS,
  LAST_ORGANIZATION_CODE_KEY,
  SHOW_PARTNER_ORG_NAME,
  type IntroMode,
} from '../lib/brand-config';
import { api } from '../lib/api';
import { playIntroSound, type IntroSoundStop } from '../lib/intro-sound';
import { Button } from './ui/button';

const SESSION_KEY = 'jll-welcome-intro-shown';
type BrandVariant = 'OWNER' | 'PARTNER';
type BrandDetails = { variant: BrandVariant; organizationName?: string | null };

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

function setPreference(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    return;
  }
}

function getLastOrganizationCode() {
  try {
    return window.localStorage.getItem(LAST_ORGANIZATION_CODE_KEY);
  } catch {
    return null;
  }
}

function hasShownThisSession() {
  try {
    return window.sessionStorage.getItem(SESSION_KEY) === 'shown';
  } catch {
    return false;
  }
}

function markShownThisSession() {
  try {
    window.sessionStorage.setItem(SESSION_KEY, 'shown');
  } catch {
    return;
  }
}

function brandForUser(user: ReturnType<typeof useAuth>['user']): BrandDetails {
  if (!user || user.role === 'SUPER_ADMIN' || !user.organization || user.organization.isPlatformOwner) {
    return { variant: 'OWNER' };
  }
  return {
    variant: 'PARTNER',
    ...(SHOW_PARTNER_ORG_NAME ? { organizationName: user.organization.name } : {}),
  };
}

function useBrandDetails(user: ReturnType<typeof useAuth>['user'], search: string) {
  const [fetchedBrand, setFetchedBrand] = useState<BrandDetails>({ variant: 'OWNER' });
  const userBrand = useMemo(() => brandForUser(user), [user]);
  const queryOrgCode = new URLSearchParams(search).get('org')?.trim();
  const organizationCode = queryOrgCode || (user ? null : getLastOrganizationCode());

  useEffect(() => {
    if (user || !organizationCode) {
      setFetchedBrand(userBrand);
      return;
    }

    let active = true;
    setFetchedBrand({ variant: 'OWNER' });
    void api<BrandDetails>(`/public/brand?orgCode=${encodeURIComponent(organizationCode)}`)
      .then((result) => {
        if (active) setFetchedBrand(result);
      })
      .catch(() => {
        if (active) setFetchedBrand({ variant: 'OWNER' });
      });
    return () => {
      active = false;
    };
  }, [organizationCode, user, userBrand]);

  return user ? userBrand : organizationCode ? fetchedBrand : { variant: 'OWNER' as const };
}

function getIntroDuration(reducedMotion: boolean) {
  return reducedMotion ? INTRO_REDUCED_MOTION_DURATION_MS : INTRO_DURATION_MS;
}

function WelcomeText({ text }: { text: string }) {
  return (
    <p className="intro-welcome" aria-label={text}>
      {text.split(/\s+/).map((word, index) => (
        <span key={`${word}-${index}`} aria-hidden="true" style={{ '--word-index': index } as CSSProperties}>{word}&nbsp;</span>
      ))}
    </p>
  );
}

function WelcomeOrganization({ name }: { name: string }) {
  const text = INTRO_CONFIG.copy.partnerOrganizationWelcome.replace('{organizationName}', name);
  return (
    <p className="intro-organization" aria-label={text}>
      {text}
    </p>
  );
}

export function BrandIntro({
  onComplete,
  brand,
}: {
  onComplete: () => void;
  brand: BrandDetails;
}) {
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
    setPreference(INTRO_SOUND_PREFERENCE_KEY, nextMuted ? 'muted' : 'unmuted');
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
  const welcomeText = brand.variant === 'OWNER'
    ? INTRO_CONFIG.copy.ownerWelcome
    : INTRO_CONFIG.copy.partnerPoweredBy;

  return (
    <section
      className={`brand-intro${reducedMotion ? ' intro-reduced' : ''}${!started ? ' intro-pending' : ''}`}
      style={cssStyle}
      role="status"
      aria-live="polite"
      aria-label={welcomeText}
    >
      {started && (
        <>
          <div className="intro-stage">
            <div className="intro-decoration" aria-hidden="true">
              <svg viewBox="0 0 360 360" focusable="false">
                <circle className="intro-arc intro-arc-gray" cx="180" cy="180" r="164" />
                <circle className="intro-arc intro-arc-lime" cx="180" cy="180" r="146" />
              </svg>
              <div className="intro-dots">{[0, 1, 2, 3, 4].map((dot) => <span key={dot} />)}</div>
            </div>
            <div className="intro-content">
              <img className="intro-logo-mark" src="/brand/jishnu-logo.png" alt="Jishnu Learning Labs — Empowering Minds" />
              {brand.variant === 'PARTNER' && SHOW_PARTNER_ORG_NAME && brand.organizationName && (
                <WelcomeOrganization name={brand.organizationName} />
              )}
              <WelcomeText text={welcomeText} />
              <p className="intro-tagline">{INTRO_CONFIG.copy.tagline}</p>
            </div>
          </div>
        </>
      )}
      {!started && (
        <div className="intro-enter-panel">
          <img className="intro-enter-logo" src="/brand/jishnu-logo.png" alt="Jishnu Learning Labs — Empowering Minds" />
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

export function BrandIntroGate({ children, mode = INTRO_MODE }: { children: ReactNode; mode?: IntroMode }) {
  const { user } = useAuth();
  const location = useLocation();
  const [showIntro, setShowIntro] = useState(false);
  const [introKey, setIntroKey] = useState(0);
  const brand = useBrandDetails(user, location.search);

  useEffect(() => {
    if (mode === 'after-login-only') return;
    if (mode === 'once-per-session' && hasShownThisSession()) return;
    if (mode === 'once-per-session') markShownThisSession();
    setIntroKey((key) => key + 1);
    setShowIntro(true);
  }, [mode]);

  useEffect(() => {
    const handleLogin = () => {
      if (mode === 'once-per-session' && hasShownThisSession()) return;
      if (mode === 'once-per-session') markShownThisSession();
      setIntroKey((key) => key + 1);
      setShowIntro(true);
    };
    window.addEventListener(INTRO_LOGIN_SUCCESS_EVENT, handleLogin);
    return () => window.removeEventListener(INTRO_LOGIN_SUCCESS_EVENT, handleLogin);
  }, [mode, user]);

  return (
    <>
      <div className="app-content" inert={showIntro} aria-hidden={showIntro}>
        {children}
      </div>
      {showIntro && <BrandIntro key={introKey} brand={brand} onComplete={() => setShowIntro(false)} />}
    </>
  );
}
