# UI Polish Plan

Follow `AGENTS.md` strictly. Keep the same-origin `/api` setup, organization scoping, backend permission checks, and the Jishnu theme. Do not reset the database or delete data. Do not change business rules.

Build in two checkpoints, UI-A then UI-B. After each: lint, type-check, tests, commit, manual test steps, then STOP and wait for "start UI-B".

## Problems observed

From a screenshot of the student Practice Q/A page at 1920x1080:

- Content sits in a narrow centred box with large empty margins; the sidebar floats and is not full height or sticky.
- Card contents have no inner padding (labels and headings touch the card border); section headings ("Start practice", "Practice history") are unstyled.
- The "Start practice" button looks disabled with no explanation; the Back button and the title are not aligned; the decorative dots overlap the header area; empty cards have no empty state.

## Checkpoint UI-A: Layout, responsive fit, functional buttons

### 1. App shell for all roles and authentication pages

Applies to Student, Instructor, Staff, Org Admin, Super Admin, and the login and register pages.

- Sticky header; sticky full-height sidebar (260px on wide screens, a collapsible icon rail between 1024 and 1279px, a drawer with a hamburger button below 1024px).
- Content area is fluid with padding `clamp(16px, 2.5vw, 40px)`; only form-heavy pages have a max width, while tables and dashboards use the full width.
- Footer pinned to the bottom (`min-height: 100dvh`); sidebar scrolls inside itself and groups items under section labels.
- Fit every screen: 360x640, 390x844, 768x1024, 1024x768, 1280x720, 1366x768, 1536x864, 1920x1080, 2560x1440, landscape phone 844x390, and browser zoom 125% and 150%. No horizontal page scroll, cut-off content, or overlapping elements.

### 2. Design consistency

- A reusable Card (header, body, footer) with padding p-4 on mobile and p-6 on desktop; styled section headings with an optional description; a spacing scale.
- Form fields with labels above, 44px height, two columns from 768px and one column on mobile, helper and error text.
- Button variants (primary, secondary, ghost, destructive) with hover, focus, loading and disabled states. A disabled button always shows a tooltip or helper text with the reason (for example "Select a course first").
- PageHeader: the Back button, breadcrumb and title in one aligned row; decorative dots stay behind the content and never overlap it.
- Tables scroll horizontally inside their own container with a sticky header, and key tables become card lists on mobile.
- Proper empty, loading and error states with an icon and a clear message (for example "No practice sessions yet. Start your first practice above.")

### 3. Button and link audit

- List every button, link, tab, menu item, icon button and form action across all roles in `docs/ui-audit.md` (page, control, expected action, status).
- Make every control do its real job (route, API call, dialog), with loading, success and error feedback (toasts), validation, and confirmation dialogs for destructive actions.
- Controls for features that are not built yet must be hidden, not left as dead buttons. Never leave a button without a handler.

### 4. Automated UI checks

- Ask before installing `@playwright/test` and its browser.
- Add `npm run test:ui:` for each role, log in with the seeded development accounts, visit every sidebar item at the viewports above, click the safe (non-destructive) primary buttons, and fail on console errors, failed API requests (4xx or 5xx that are not expected), or horizontal scroll.
- Save screenshots to a git-ignored folder.
- Add the layout rules to `AGENTS.md` and `docs/design-system.md`.

## Checkpoint UI-B: Upload Media (Draft, Cancel, verified upload)

Verify the Upload Media feature end to end first (a small mp4 and an mp3, through the UI and the API, with the processing worker), fix every bug found, and report what was broken. Then:

- Form actions: [Cancel] [Save as Draft] [Upload & Publish].
- Save as Draft: saves the details; if a file is chosen it uploads and processes, and the item stays a DRAFT. With no file, it saves a draft with status AWAITING_FILE (add the enum value with a forward-only migration) that can be resumed from My Uploads with an "Upload file" action.
- Upload & Publish: validates every required field and the file, uploads, and publishes automatically when processing reaches READY (a `publishOnReady` flag); if processing fails the item stays unpublished with the error and a Retry button.
- Cancel: if an upload is running, show "Stop the upload and discard it?" and, when confirmed, abort the request (`AbortController`), and the server deletes the partial file and record. If the form has unsaved changes show "Discard changes?"; otherwise go back to the list with its filters preserved. Add a "Cancel" action on rows with status UPLOADING or PROCESSING (mark the job cancelled and clean temporary files).
- Show the chosen file name, size and type, a Remove/Replace file button, client-side type and size validation with clear messages, a progress bar with percentage, and a `beforeunload` warning while uploading.
- My Uploads: filter by Draft, Published and Failed; Edit, Delete, Publish and Unpublish for drafts.
- Tests: draft with and without a file, publish on ready, cancel during upload cleans up files, permissions and organization isolation unchanged.
