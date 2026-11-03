# Media and Classes Plan

## Scope

This plan covers the next two checkpoints for the Jishnu Learning Labs platform:

- MC1: Videos & Audios (student playback and staff reporting)
- MC2: Online Classes (expert sessions and student attendance)

Follow AGENTS.md strictly. Keep the same-origin /api setup, organization scoping, backend permission checks, Zod validation, AuditLog entries, PageHeader with Back, the Jishnu theme, and the responsive layout rules in docs/design-system.md. Do not reset the database or delete data.

## Student sidebar update

Student sidebar becomes (grouped):

- Dashboard
- LEARN: My Courses, Videos & Audios, Online Classes, Notes, Library
- PRACTICE: Practice Q/A, My Assessment
- PROGRESS: My Attendance, My Track, My Certificates

Show only modules that exist.

## MC1: Videos & Audios

Student page "Videos & Audios":

- Show published and READY media of the student's enrolled courses only
- Group by course and topic
- Tabs: All / Videos / Audios
- Search and course filter
- Thumbnails, durations, progress bars
- A "Continue watching" row
- A completed tick when finished

Player page (video and audio):

- Back button
- Speed control
- Resume from the last position
- Mark as completed at 90% watched
- Protection is a deterrent, not DRM; say so in the README:
  - no download endpoint or direct file URL
  - authenticated organization-checked HLS routes with short-lived refreshed tokens
  - no-store headers
  - a moving watermark with the student's name and ID
  - pause when the tab loses focus
  - right-click disabled
  - MediaView and suspicious events logged to AuditLog
- If this playback layer does not exist yet, build it now

WatchProgress should feed "Learned hours" on My Courses.

Instructors, staff and Org Admin get a "Media" view with a viewing report (who watched, percent watched).

## MC2: Online Classes

Teacher side (ORG_ADMIN and INSTRUCTOR create and edit; STAFF view):

- Schedule a class: title, description, course, date and time, duration
- Statuses: SCHEDULED / LIVE / ENDED / CANCELLED
- Edit, cancel, delete
- A "Start Class" button for the host
- Attendee list and attendance report afterwards

Student page "Online Classes":

- Tabs: Live now / Upcoming / Past for enrolled courses
- Join button enabled from 10 minutes before the start until the class ends
- Before joining: "Check your devices" screen asks for camera and microphone permission, shows a preview, and explains how to unblock them
- Live room uses a LiveClassProvider interface with an embedded Jitsi Meet iframe (`allow="camera; microphone; display-capture; fullscreen"`)
- Unguessable room name per class
- Joining only for authenticated users of the same organization who are enrolled
- Leaving the page asks for confirmation

Attendance:

- Recorded automatically (joinedAt, leftAt, minutes)
- Creates or updates the student's attendance record: PRESENT, or LATE if joined more than a set number of minutes late
- My Attendance shows it
- Instructors can adjust it manually

Past classes can show a recording linked from the media module (an instructor uploads or links a recording to the class).

Dashboard card for students: "Live now" or "Next class".

## README requirements

Document the public Jitsi limits, that HTTPS is required in production for camera and microphone (localhost works), and how to switch to LiveKit, Agora or a self-hosted Jitsi.

## Tests

Required tests include:

- join window
- enrollment and organization checks
- attendance recording and status rules
- permissions (staff and students cannot schedule)
- device-check component

## Execution workflow

Build one checkpoint at a time: MC1, then MC2.

After each checkpoint:

- run lint
- run type-check
- run tests
- commit
- provide manual test steps
- stop and wait for the next explicit instruction

## Handoff

This file is the source-of-truth specification for the remaining work. Implementation will begin only after the user says "go ahead".
