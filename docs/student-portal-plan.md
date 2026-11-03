Follow AGENTS.md strictly. Keep the same-origin /api setup, organization scoping on every query, backend permission checks, Zod validation, AuditLog entries, the PageHeader back-button rule and the Jishnu theme. Do not reset the database and do not delete any data. If Prisma asks for a reset, stop and ask me.

STEP 1: Save this whole specification as docs/student-portal-plan.md in the repository (the earlier plans were lost between sessions). Do not look for older plans; use only this text. Then show me ONE combined plan (schema, routes, pages, files, new packages) and wait for my "go ahead". After that build ONE checkpoint at a time (SP1, SP2, SP3). After each checkpoint run lint, type-check and tests, commit, give me exact commands and a step-by-step manual test, then STOP and wait for me to say "start SP2" or "start SP3".

CONTEXT
The student portal currently has only Dashboard, My Courses and Notes. Courses, enrollment, notes and the 12 demo courses (SAP, English, Tamil, Maths, Social, Science, Python, C++, Java, JavaScript, HTML, CSS) exist. Assessments, practice questions, attendance and certificates do NOT exist yet, so the teacher-side tools to create them are part of this work. Live classes (Expert Session) are NOT part of this task.

STUDENT PORTAL SIDEBAR (in this order): Dashboard, My Courses, Notes, My Assessment, Practice Q/A, My Attendance, My Track, My Certificates, Library. Responsive, themed, every page with PageHeader and Back button. Students can only see data of their own organization and their own enrollments, and can never see correct answers before they are allowed to.

QUESTION TYPES (used by both Practice and Assessment)
MCQ single answer, MCQ multiple answers, TRUE_FALSE, MATCH (left items and right items with the correct pairs), FILL_BLANK (a sentence with one or more blanks and a list of accepted answers per blank, case-insensitive and trimmed), SHORT_ANSWER (accepted answers list). Each question has courseId, optional topic, difficulty, marks, explanation. Document the grading rules, including partial credit for MATCH (marks per correct pair) and for multi-blank FILL_BLANK (marks per blank), in the README.

=====================================================
CHECKPOINT SP1: PRACTICE Q/A AND MY ASSESSMENT
=====================================================
Teacher side (ORG_ADMIN and INSTRUCTOR; instructors only for their own courses; staff and students get 403)
- "Practice Q/A" page with an "Add Practice Q/A" button: a form that supports every question type with validation and a preview; a question bank list with search and filters (course, topic, difficulty, type), edit and soft delete; CSV bulk import with a downloadable template and a row-by-row error report (CSV supports all types except MATCH, which is entered in the form)
- "Assessments" page with an "Add Assessment" button: title, course, instructions, total marks, pass mark, duration in minutes, open and close dates, maximum attempts, shuffle options, result release mode (IMMEDIATE or MANUAL) and whether the answer review is allowed. Add questions inside the assessment (new questions or picked from the bank), reorder, edit, delete, with a running marks total. Status DRAFT / PUBLISHED / CLOSED; publish needs at least one question and valid marks; a published assessment cannot have its questions or marks changed (offer "Duplicate as new draft"). Snapshot the questions at publish time so later edits never change past attempts. Preview as a student without saving an attempt
- A results page per assessment: score per student, average, pass rate, highest and lowest, per-question difficulty analysis, flagged attempts, "Release results" for MANUAL mode, regrade a question (with AuditLog), and CSV export

Student side
- Practice Q/A: choose an enrolled course, topic, difficulty and number of questions; questions come one at a time, in random order, with an optional timer; instant feedback with the correct answer and explanation after each answer; unlimited attempts; a summary with score and weak topics; saved practice history; practice never counts toward grades. The server must not send correct answers before the student answers
- My Assessment: tabs Upcoming / Open / Completed for enrolled courses only. Starting an attempt creates a server-side timer (never trust the client clock), answers autosave, the attempt resumes after a refresh or a dropped connection, questions and options are shuffled per student, one active attempt at a time, max attempts and open/close dates are enforced, auto-submit on expiry (background job and on the next request). Server-side grading for every type. Correct answers are never sent during the attempt. Leaving the attempt page (the Back button or the browser back) shows a confirmation; tab switches and copy/paste attempts are logged as flagged events for the instructor (they do not auto-fail)
- Result page: score, percentage, pass or fail, grade, time taken, attempt history, and a per-question review with correct answers and explanations only when the assessment allows it and the results are released

=====================================================
CHECKPOINT SP2: MY ATTENDANCE AND LIBRARY
=====================================================
Attendance
- Teacher side (ORG_ADMIN, INSTRUCTOR and STAFF): create a class entry for a course (date, title, optional duration) and mark each enrolled student PRESENT / LATE / ABSENT, with "mark all present", edit within a configurable time window, and an AuditLog entry for changes. Do not depend on live classes; leave a nullable liveSessionId field so live-class attendance can be linked later
- My Attendance (student): overall attendance percentage and per-course percentage (attended divided by total classes, LATE counts as a configurable fraction), a list with date, course, class, status, filters by course and date range, a monthly calendar view, and a warning banner when a course is below its minimum attendance percentage

Library
- "Library" page for all roles: browse published notes and documents of the organization (the existing Notes data, with categories and an optional book/document type), search and filter by course and category
- Students can use "Save to My List" and "Remove" on every item (also in the viewer and on the Notes page). A "Saved" tab lists their saved items with search. A SavedItem table, unique per student and item, only for items of their own organization. The view-only rules stay: the watermarked viewer, no download, no direct file URL

=====================================================
CHECKPOINT SP3: MY TRACK AND MY CERTIFICATES
=====================================================
Grades and performance
- Per-organization grade scale with defaults: A+ 90 and above, A 80, B 70, C 60, D 50, F below 50; the Org Admin can edit it in settings. Course grade is the weighted average of the student's best (or latest, as a setting) assessment percentages, with equal weights unless an assessment has a weight
- My Track (student): overall grade and average, course-wise grades, assessment-wise scores with a trend chart, practice accuracy by topic with strengths and weak topics, attendance percentage per course, learned hours if watch progress data exists (otherwise hide it), and plain-language suggestions based on weak topics. Show only the student's own data

Certificates
- When an enrollment meets the course's completion rules (minimum attendance, assessment passed, all topics covered if the course requires it), mark the enrollment COMPLETED and issue a certificate automatically (CertificateRecord with a unique certificate ID, issue date and grade). Also provide an Org Admin or Instructor "Issue certificate" action for a student who meets the rules, and "Revoke" and "Re-issue" with an AuditLog entry
- Generate a PDF (use pdf-lib or pdfkit and the qrcode package; tell me before installing) with the Jishnu branding, the organization's name, the head of the organization as signatory, the student's name and ID, the course, hours, grade, date, the certificate ID and a QR code that links to a public verification page (same-origin, for example /verify/CERTIFICATE_ID) showing only the student's name, the course, the date and whether it is valid or revoked
- My Certificates (student): list of earned certificates with View and Download buttons (certificates may be downloaded, unlike notes), and a message explaining what is still needed for courses in progress

SEED (idempotent, never deletes data)
For the approved demo students in jll-demo: sample practice questions of every type for all 12 courses with subject-relevant content (for example match HTML tags to their purpose, fill in a missing keyword in a Python, C++ or Java snippet, true/false on CSS facts, MCQs on SAP modules and JavaScript scope, grammar fill-ups for English and Tamil, simple Maths problems, basic Social and Science facts); one published assessment per course; a few completed attempts with different scores; attendance records over the last 30 days with a mix of statuses; saved library items; and one completed course with an issued certificate so every page shows data

TESTS (Vitest + Supertest, plus component tests)
Correct answers never leaked before answering or submitting; grading per type including MATCH and FILL_BLANK and partial credit; timer expiry and auto-submit; attempt limits; open/close dates; MANUAL result release; regrade updates scores and writes an AuditLog entry; enrollment and organization isolation; students cannot see other students' attempts, attendance, certificates or tracking data; attendance percentage math; save and remove library items; grade calculation; certificate issued only when the rules are met; revoked certificate fails verification; staff and students get 403 on teacher-only routes

Remember: build ONE checkpoint at a time and STOP after each. Do not build live classes, payments or reports.
