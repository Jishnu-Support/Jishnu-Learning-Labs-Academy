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

### Layout and responsiveness

- The app shell must keep a sticky top bar and a sticky sidebar on wide screens; the sidebar becomes a drawer below 1024px and a collapsible rail between 1024px and 1279px.
- The main content region uses `clamp(16px, 2.5vw, 40px)` padding and stays fluid to the viewport; only form-heavy layouts use a max-width container, while tables and dashboards use the full width.
- Forms use one column on mobile and two columns from 768px up; controls stay at least 44px tall with label-first layouts and inline validation/help text.
- All pages must keep a single, predictable rhythm: card padding `p-4` on mobile and `p-6` on desktop, consistent section headings, and a clear empty/loading/error state instead of blank panels.
- No page may have horizontal scroll at the listed breakpoints or at 125%/150% browser zoom; overflow is handled inside table containers and the sidebar itself.

## Welcome intro and sound

The intro constants and copy live in `client/src/lib/brand-config.ts`. `INTRO_DURATION_MS` is the single source for the standard seven-second duration, and `INTRO_TIMELINE_MS` supplies matching visual and audio cue times. `INTRO_MODE` defaults to `every-load`: the intro plays on every full page load (including refreshes while signed in) and after successful login, but not during in-app route changes, API calls, or tab refocus. `once-per-session` and `after-login-only` are also available.

The OWNER variant says “Welcome to Jishnu Learning Labs”; it is used for Super Admin, the platform-owner organization, unknown organization codes, and as the fallback. Other organizations use the PARTNER variant, “Powered by Jishnu Learning Labs”. Set `SHOW_PARTNER_ORG_NAME=true` in the server environment and `VITE_SHOW_PARTNER_ORG_NAME=true` in the client environment to also show “Welcome to {organization name}”. The public brand endpoint returns only the selected variant and, when enabled, the partner name. Variant precedence is the authenticated user's organization, `?org=code`, the last successful tenant login saved as `jll-last-org-code`, then OWNER.

The seeded `jll-demo` organization is the platform owner. A Super Admin can change this in **Super Admin → Organizations → Set as platform owner**; the confirmation updates the old and new owner in one transaction and records audit entries. The unique database index enforces that no more than one organization owns the platform branding.

The intro respects `prefers-reduced-motion` with a two-second fade and no audio. Sound is synthesized locally by default. If autoplay is blocked, the intro remains usable and provides a “Tap for sound” action to resume only cues still ahead in the timeline. The mute setting is saved in `localStorage`; sound and audio resources are stopped on skip, completion, tab hiding, and unmount. An optional licensed `client/public/brand/intro-chime.mp3` can be selected in the intro config; an unavailable file falls back to synthesis.
