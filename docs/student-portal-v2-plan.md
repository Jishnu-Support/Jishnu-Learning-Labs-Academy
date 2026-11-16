# Student Portal V2 Specification

Follow `AGENTS.md` strictly. Keep the same-origin `/api` setup, organization scoping on every query, backend permission checks, Zod validation, `AuditLog` entries, `PageHeader` with a Back button, the Jishnu theme and wallpaper, the responsive layout rules in `docs/design-system.md`, the notification system, `canAccessContent` and the payment paywall. Use "Tutor" (never "Staff") in all user-facing text. Do not reset the database and do not delete data. Never run `prisma migrate reset`; if Prisma wants a reset, stop and ask me. Remind me to back up the database before applying any new migration.

## Workflow

1. Save this whole specification as `docs/student-portal-v2-plan.md` and commit it first.
2. Do not rebuild existing pages: move and reuse the existing components.
3. Show one plan covering schema, migrations, routes, pages, files, and new packages; wait for "go ahead" before implementation.
4. Build one checkpoint at a time (SV-1, SV-2). After each checkpoint, run lint, type-check, tests, commit, and provide manual test steps. Then stop and wait for "start SV-2".

## Global Rules

- Every button works; there are no "Page not found" destinations.
- Seed demo data idempotently and never delete data.
- Every page fits all screen sizes without overlapping elements.
- Validate in a browser using the already approved isolated Playwright setup. Install Edge/Chrome only under `.tsupgrader/runtime-validation`; do not download Chromium without asking.

## SV-1: Student Navigation, My Course, Study Materials, Font Colours

### Student navigation

- Use a flat, uncluttered sidebar containing Dashboard, My Course, Library, My Attendance, My Certificates, Track My Knowledge, Pay My Fee, and My Profile, plus the request module only if it already exists.
- Remove Videos & Audios, Experts Session, Notes, Practice Q/A, My Assessment, and the old My Courses entry from the sidebar.
- Redirect old URLs to My Course, opening the matching tab when the course is known.
- Update every notification deep link, dashboard widget, and breadcrumb to the new locations.

### My Course

- `/student/courses` shows only courses the signed-in student is enrolled in with ACTIVE enrollments.
- Show course cards with title, the student's Tutor, progress, learned hours, subscription status from Pay My Fee, and next session.
- Provide an empty state with an Explore courses button that opens the existing Browse Courses and Enroll flow as a page reachable from here, not from the sidebar.
- Keep dropping a course available.

### Course details

- `/student/courses/:courseId` has a header showing the course title, the student's Tutor with rating, a Change tutor button, progress, subscription status, and a Pay My Fee shortcut.
- Organize course detail in tabs, each limited to the selected course:
  - **Overview:** summary, syllabus topics with hours and covered status, learning outcomes.
  - **Videos & Audios:** existing media list and player, including YouTube items.
  - **Books:** course-linked library items of kind BOOK or DOCUMENT, opened in the existing view-only watermarked reader.
  - **Experts Session:** Live now, Upcoming, and Past for this course, with Join and the device check.
  - **Study Materials:** see the saved-only and browse requirements below.
  - **Practice Q/A:** this course's practice sets and random practice.
  - **Assessments:** levels and assessments for this course, results, and Collect certificate button.
- Deep-link each tab in the URL (for example `/student/courses/12/media`).
- Preserve `canAccessContent` and the payment paywall rules exactly as they are inside course tabs.

### Study Materials

- Rename "Notes" to "Study Materials" in every portal's UI text, route labels, and docs. Tutor wording: "Publish Study Materials"; Org Admin wording: the same. The database model may remain named as-is.
- The student's Study Materials tab defaults to showing only items saved with "Save to My List".
- Add a clearly labelled "Browse all materials of this course" button or tab so students can find and save materials.
- Add `STUDY_MATERIALS_SAVED_ONLY`, default `true`, so the Org Admin can open all materials.
- Keep the view-only watermarked viewer with no download.

### Theme text contrast

- Find every place where black or very dark text sits on navy or blue backgrounds, including sidebar items, headings, active items, tooltips, dropdown and bell menus, table headers, toasts, tabs, form fields and placeholders inside blue panels, login brand panels, badges, disabled states, and icons.
- Fix contrast with design tokens, not component-local hacks.
- Add `--text-on-navy` (white), `--text-on-navy-muted` (a light lavender such as `#DDE1F5`), and a light-accent link colour on navy.
- Normal text must meet WCAG AA contrast (4.5:1; large text 3:1).
- Add the tokens and rule to `docs/design-system.md` and `AGENTS.md`.
- Add an automated contrast check to browser validation (axe-core inside the same isolated Playwright folder); ask before installing axe-core.
- Validate all four portals.

### SV-1 tests

Test that:

- Only enrolled courses appear.
- Every course tab displays only its course's data.
- The saved-only Study Materials view and setting work.
- Old URLs redirect correctly.
- The paywall remains enforced inside the tabs.
- Notification deep links work.
- Browser validation passes.

## SV-2: Student Profile, Tutor Selection, Tutor Ratings

### Student profile

- Add a completeness meter and "complete your profile" banner to My Profile.
- Personal details: student name, father's name, mother's name, read-only Student ID and organization, and profile picture.
- Education: current level dropdown (school class 1–12, diploma, UG, PG, other), class or year, institution name, course or branch.
- Identity numbers: optional Aadhaar and APAAR IDs, each validated as a 12-digit number. Aadhaar validation uses the Verhoeff checksum.
- Show purpose and consent text with a consent checkbox, and store the consent time.
- Encrypt identity numbers at rest with AES-256-GCM using `PII_ENCRYPTION_KEY`. Refuse to start in production without it; a documented development key is allowed locally.
- Store only encrypted values and the last four digits. Mask display as `XXXX XXXX 1234`.
- Never return full identity numbers in list or ordinary API responses; never log them or include them in CSV exports, notifications, audit values, or errors.
- A Reveal action requires the student's password again, shows the value for 60 seconds, and writes an `AuditLog` entry recording who, whose, which field, and when—never the value.
- Org Admin sees the full profile with identity numbers masked and has the same password-protected Reveal and audit behavior.
- Tutors and Super Admin never see identity numbers or parents' names.
- Contact: validated phone number, with `+91` as the default, and read-only registered email.
- Provide validation messages, an unsaved-changes warning, and a success toast.
- Certificates keep the name as it was when issued.
- Visibility: Org Admin sees the full profile (identity numbers masked) in Student Details; Tutor sees only name, Student ID, education level, and course progress.
- Document in the README: collect Aadhaar only if legally permitted and needed; allow disabling the field with `ENABLE_AADHAAR_FIELD=false`; address the DPDP Act, parental consent for minors, and data deletion on request.

### Tutor selection

- A course can have multiple Tutors (faculty).
- In My Course, show a "Choose your tutor" step on the first visit and a Change tutor action.
- Tutor cards show photo, name, expertise, bio, average rating and count, and price per period for this course.
- Store the selection on the enrollment as `selectedTutorId`; use it for Pay My Fee.
- If a paid subscription is active, a Tutor change takes effect at the next renewal and displays a clear message. Without an active subscription, the change is immediate.
- Write an `AuditLog` entry and notify both the old and new Tutor.

### Tutor ratings

- Students may rate their selected Tutor for a course: 1–5 stars and an optional comment up to 500 characters.
- Allow one rating per student, Tutor, and course; students may edit or delete their rating.
- `ratingRequiresActivity` defaults to `true`: the student must be enrolled with that Tutor and have real activity (attended a session or watched or read course content).
- Apply rate limiting and basic profanity filtering.
- Student Tutor cards show average and count.
- Tutor portal: add My Ratings with average, count, 1–5 star distribution, trend over time, per-course ratings, and recent comments. Reviews are anonymous to the Tutor by default.
- Org Admin portal: add a rating column in Tutor Details and a Tutor Ratings page with Tutor/course/stars/date filters, full reviews with student name and ID, hide/unhide comment with reason and `AuditLog`, CSV export without personal identity numbers, and an alert when a Tutor's average is below 3 after at least 5 ratings.
- Send a Tutor notification for each new rating without student identity; notify Org Admin for 1- or 2-star ratings.
- Super Admin sees only an average rating per organization.

### SV-2 seed data and tests

- Seed complete profiles for demo students using clearly fake sample values. Identity numbers must be obviously fake, pass the checksum, and be marked as demo data.
- Seed Tutor selections and ratings with a range of star values and comments for several Tutors in both organizations.
- Test encryption and masking (full numbers never appear in lists, logs, exports, or errors); Reveal password requirement and audit; role visibility (Tutors and Super Admin never see protected fields); checksum validation; Tutor-selection rules; rating eligibility; one rating per student/Tutor/course; aggregates; hide/unhide; Tutor anonymity; organization isolation; and browser validation.

## Explicit exclusions

Do not build the request module, 1:1 sessions, or Tutor payouts in this task.
