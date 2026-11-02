export const INTRO_DURATION_MS = 7000;
export const INTRO_REDUCED_MOTION_DURATION_MS = 2000;
export const INTRO_FADE_DURATION_MS = 800;

export const INTRO_TIMELINE_MS = {
  skipAvailable: 1000,
  arcsEnd: 1200,
  logoStart: 1200,
  poweredByStart: 2800,
  welcomeStart: 4000,
  taglineStart: 5200,
  fadeStart: INTRO_DURATION_MS - INTRO_FADE_DURATION_MS,
} as const;

export const INTRO_COPY = {
  poweredBy: 'POWERED BY JISHNU LEARNING LABS',
  welcome: 'Welcome to Jishnu Learning Labs',
  tagline: 'Empowering Minds',
} as const;

export const INTRO_SOUND_ENABLED = true;
export const INTRO_SOUND_SOURCE: 'synth' | 'file' = 'synth';
export const INTRO_REQUIRE_TAP = false;
export const INTRO_SOUND_PREFERENCE_KEY = 'jll-intro-sound';

export const INTRO_CONFIG = {
  copy: INTRO_COPY,
  timeline: INTRO_TIMELINE_MS,
  durationMs: INTRO_DURATION_MS,
  reducedMotionDurationMs: INTRO_REDUCED_MOTION_DURATION_MS,
  soundEnabled: INTRO_SOUND_ENABLED,
  soundSource: INTRO_SOUND_SOURCE,
  requireTap: INTRO_REQUIRE_TAP,
} as const;
