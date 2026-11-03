# Fix Routing, Intro Wallpaper, and Intro Alignment

## Scope

This plan covers three checkpoints for the routing/login flow and the intro visual polish:

- FIX-1: Modules redirect to the sign-in page
- FIX-2: Intro animation alignment
- FIX-3: Brand wallpaper on the intro and every page

Follow AGENTS.md strictly. Keep the same-origin /api setup, organization scoping, backend permission checks, Zod validation, AuditLog entries, PageHeader with Back, the Jishnu theme and the responsive layout rules in docs/design-system.md. Do not reset the database or delete data.

## CHECKPOINT FIX-1: MODULES REDIRECT TO THE SIGN-IN PAGE

Problem: when I open some modules while logged in, the app sends me to the sign-in page and the module never opens.

1. Reproduce: for each role (Student, Instructor, Staff, Org Admin, Super Admin) log in as the seeded accounts, open EVERY sidebar item and every route directly, and record which ones end at a login page. Check the network log for the 401/403/404/500 that triggers it. Tell me the root cause per case in plain language.
2. Likely causes to check: wrong route guard (a role mismatch redirects to login instead of showing "no access"); a global API handler that logs the user out on any 401; token refresh race conditions (parallel requests each trying to refresh); the one-active-session rule revoking the session; sidebar links with no matching route and a catch-all that redirects to login; cookies or paths lost on direct navigation or page refresh.
3. Fix:
   - Not logged in: go to the correct login page and keep a "return to" URL so after login the user lands on the module they wanted.
   - Logged in but the wrong role: go to the user's own dashboard with a toast "You do not have access to that page" (never to login).
   - Unknown route: a proper 404 page with a Back button (never login).
   - API client: on 401, try ONE refresh (single-flight, so parallel requests share it) and retry once; log out only if the refresh fails. Never log out on 403, 404 or 500, and show an error state instead.
   - If a session was revoked because the account logged in elsewhere, show "You were signed out because this account was used on another device" on the login page.
   - Do not show sidebar items for pages that do not exist.
4. Tests: a Playwright (ask me before installing it) or integration test that logs in as each role and opens every route; fail if a logged-in user ever ends at a login page except after logout or revocation.

## CHECKPOINT FIX-2: INTRO ANIMATION ALIGNMENT

Current problems (from a screenshot at 1920x1080): the logo image shows its white box on the gradient; the "Welcome to Jishnu Learning Labs" headline overlaps the logo; the decorative ring is not concentric with the content; the dots overlap the headline; "Mute" and "Tap for sound" are shown together.

1. Rebuild the stage: one square stage of min(86vmin, 640px) centred with CSS grid. The decorative ring SVG fills the stage. The content column is centred inside with width about 76% and a vertical flow: logo, spacing of about 5%, headline, spacing, tagline line. Nothing may overlap. The ring and the content share the same centre, and the content fits inside the ring.
2. The logo: render it with mix-blend-mode: multiply on the light background so its white box disappears (and note that a transparent PNG or SVG logo would be better); keep it crisp at every size.
3. Position the dots along the ring edge, outside the content box, behind the text. Headline font-size clamp(1.5rem, 4.2vmin, 2.6rem), text-wrap: balance, centred, with a safe max-width. Keep both variants (Welcome to / Powered by) and all timings.
4. Controls: show ONE sound control at a time ("Tap for sound" only when autoplay is blocked, otherwise "Mute" or "Unmute"); Skip stays in the corner without overlapping content.
5. Verify at 360x640, 390x844, 768x1024, 1280x720, 1366x768, 1920x1080, 2560x1440 and landscape 844x390, zoom 125% and 150%. Add an automated test that measures getBoundingClientRect of the logo, headline, tagline and dots and fails if any of them overlap or leave the viewport.

## CHECKPOINT FIX-3: BRAND WALLPAPER ON THE INTRO AND EVERY PAGE

1. Create an ORIGINAL SVG education doodle wallpaper in the Jishnu brand colours. Do NOT use or embed any external image. Tile of about 480x480, hand-drawn line style (stroke about 1.5px, round caps), about 14 icons spread evenly with some rotation: graduation cap, open book, pencil, ruler, calculator, lightbulb, atom, globe, laptop, </> and { } symbols, bar chart, headphones or play button, microphone, certificate ribbon, magnifier, clock; plus dashed curved connectors, small stars and dots. Strokes in navy, with some icons in magenta and lime and the connectors in gray, on a transparent background so it works over the soft lavender page background. Save as client/public/brand/wallpaper.svg (small file size).
2. A <BrandWallpaper variant="intro" | "auth" | "app"> component using a fixed, pointer-events none layer behind the content (not background-attachment: fixed, which is bad on mobile), with opacity tokens: intro about 0.14, login and register about 0.10, all other pages about 0.04 to 0.05. Cards, tables, forms, dialogs and the sidebar keep solid backgrounds so text stays readable and contrast stays at WCAG AA. Add a soft gradient fade so the pattern never fights with page titles.
3. Intro: the wallpaper fades in and drifts slowly (a few pixels) during the 7 seconds, GPU-friendly (transform and opacity only). Disable the drift for prefers-reduced-motion. No performance regression (report the bundle size and check that the intro stays smooth).
4. Apply it to the intro, login and register pages, the organization registration page, and every role's pages, via the app shell.
5. Add the wallpaper tokens and rules to docs/design-system.md and AGENTS.md. Tests: the component renders each variant, does not block clicks, and the overlap test from FIX-2 still passes.

## Execution workflow

Build one checkpoint at a time: FIX-1, then FIX-2, then FIX-3.

After each checkpoint:

- run lint
- run type-check
- run tests
- commit
- provide manual test steps
- stop and wait for the next explicit instruction

## Handoff

This file is the source-of-truth specification for the remaining work. Implementation will begin only after the user says "go ahead".
