# Jishnu Learning Labs design system

## Brand tokens

Theme values live in `client/src/index.css` as CSS custom properties and Tailwind v4 theme tokens:

| Token | Value | Use |
|---|---|---|
| Navy | `#14246B` | Primary headings, navigation, table headers |
| Magenta | `#9B1D80` | Main actions, active states, links, focus rings |
| Lime | `#8DC63F` | Success and highlights; use as a fill or accent |
| Gray | `#6B6B6B` | Secondary text and borders |
| Page background | `#F7F7FC` | Application canvas |
| Primary text | `#1B1B2F` | Body text |

Use the shared `--brand-*` CSS variables or Tailwind tokens (`primary`, `secondary`, `accent`, `success`, and `ring`) rather than component-local color values. For contrast, never render lime text on white; use navy text over lime fills. Pending statuses use amber, while rejected and suspended statuses use red.

## Typography and components

Headings use Merriweather with Georgia/serif fallbacks. Body copy uses Inter, followed by Noto Sans Tamil and system sans-serif fallbacks. The font link uses `display=optional` so a late web-font response does not shift the layout.

Use `PageHeader` with an explicit `backTo` route for every non-login, non-dashboard page. Keep the shared shell logo, the sidebar logo, accessible focus states, and mobile layouts. Cards use white surfaces, rounded corners, and low-contrast shadows. Page-header titles have a navy-to-magenta-to-lime rule.

## Welcome intro and sound

The intro constants and copy live in `client/src/lib/brand-config.ts`. `INTRO_DURATION_MS` is the single source for the standard seven-second duration, and `INTRO_TIMELINE_MS` supplies matching visual and audio cue times. The intro is shown only once per browser session on the first root or login route, and never after authentication or on later route changes.

The intro respects `prefers-reduced-motion` with a two-second fade and no audio. Sound is synthesized locally by default. If autoplay is blocked, the intro remains usable and provides a “Tap for sound” action to resume only cues still ahead in the timeline. The mute setting is saved in `localStorage`; sound and audio resources are stopped on skip, completion, tab hiding, and unmount. An optional licensed `client/public/brand/intro-chime.mp3` can be selected in the intro config; an unavailable file falls back to synthesis.
