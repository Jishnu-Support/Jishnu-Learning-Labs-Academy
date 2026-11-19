import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/auth-context';
import { Field } from '../components/field';
import { PageHeader } from '../components/page-header';
import { PortalSidebar } from '../components/portal-sidebar';
import { Button } from '../components/ui/button';
import { ApiError, api } from '../lib/api';
import type { Role } from '../types';
import { NotesPage } from './notes-page';
import { MediaPage } from './media-page';
import { PracticeQuestionBankPage, TeacherAssessmentsPage } from './learning-pages';
import { ExpertSessionsPage } from './student-portal-pages';

type Topic = { id: string; title: string; plannedHours: number; order: number; covered: boolean; coveredAt: string | null };
type Course = {
  id: string;
  code: string;
  title: string;
  description: string | null;
  category: string;
  plannedHours: number;
  startDate: string;
  endDate: string;
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  minimumAttendancePercent: number;
  requiresAssessmentPass: boolean;
  instructors: Array<{ instructor: { id: string; name: string } }>;
  topics: Topic[];
  notes: Array<{ id: string; title: string; subject: string; published: boolean; updatedAt: string }>;
  _count: { enrollments: number; notes: number };
};
type Enrollment = {
  id: string;
  status: 'PENDING' | 'ACTIVE' | 'COMPLETED' | 'DROPPED';
  enrolledAt: string;
  student: { name: string; studentProfile: { studentId: string } | null };
};
type CourseAssessmentReport = {
  rows: Array<{
    studentId: string; studentName: string; assessmentId: string; assessment: string;
    attempts: number; bestScore: number | null; totalMarks: number; percentage: number | null;
    status: 'COMPLETED' | 'IN_PROGRESS' | 'NOT_ATTEMPTED'; passed: boolean | null;
  }>;
  pagination: { total: number; totalPages: number };
};

const tutorCourseTabs = [
  { key: 'overview', label: 'Overview' },
  { key: 'materials', label: 'Publish Study Material' },
  { key: 'youtube', label: 'YouTube Links' },
  { key: 'video', label: 'Video' },
  { key: 'audio', label: 'Audio' },
  { key: 'sessions', label: 'Expert Session' },
  { key: 'practice', label: 'Practice Q/A' },
  { key: 'assessment', label: 'Assessment' },
] as const;

function courseListPath(role: Role, organizationId?: string) {
  return role === 'ORG_ADMIN' ? '/org-admin/courses' : role === 'SUPER_ADMIN'
    ? `/super-admin/organizations/${encodeURIComponent(organizationId ?? '')}/courses`
    : '/tutor/courses';
}

function safeReturnTo(value: string | null, base: string) {
  return value && !value.startsWith('//') && (value === base || value.startsWith(`${base}?`)) ? value : base;
}

function notesPath(role: Role, organizationId?: string) {
  return role === 'ORG_ADMIN' ? '/org-admin/materials' : role === 'SUPER_ADMIN'
    ? `/super-admin/organizations/${encodeURIComponent(organizationId ?? '')}/materials`
    : '/tutor/materials';
}

export function CourseDetailPage() {
  const { user } = useAuth();
  const role: Role = user?.role === 'SUPER_ADMIN' ? 'SUPER_ADMIN' : user?.role === 'ORG_ADMIN' ? 'ORG_ADMIN' : 'TUTOR';
  const { courseId = '', organizationId } = useParams();
  const base = courseListPath(role, organizationId);
  const organizationApiPrefix = role === 'SUPER_ADMIN'
    ? `/super-admin/organizations/${encodeURIComponent(organizationId ?? '')}`
    : '';
  const apiBase = role === 'SUPER_ADMIN' ? `${organizationApiPrefix}/courses` : '/courses';
  const managerBase = `${organizationApiPrefix}/portal/manage`;
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const returnTo = safeReturnTo(searchParams.get('returnTo'), base);
  const studentSearch = searchParams.get('studentSearch') ?? '';
  const [topicTitle, setTopicTitle] = useState('');
  const [topicHours, setTopicHours] = useState('');
  const [error, setError] = useState('');
  const [showAssessmentChoices, setShowAssessmentChoices] = useState(false);
  const courseQuery = useQuery({
    queryKey: ['course', organizationApiPrefix, courseId],
    queryFn: () => api<{ course: Course }>(`${apiBase}/${courseId}`),
    enabled: Boolean(courseId),
  });
  const enrollmentQuery = useQuery({
    queryKey: ['course-enrollments', organizationApiPrefix, courseId, studentSearch],
    queryFn: () => api<{ enrollments: Enrollment[] }>(`${apiBase}/${courseId}/enrollments?${new URLSearchParams(studentSearch ? { search: studentSearch } : {})}`),
    enabled: Boolean(courseId),
  });
  const assessmentReports = useQuery({
    queryKey: ['learning', 'course-assessment-reports', organizationApiPrefix, courseId],
    queryFn: () => api<CourseAssessmentReport>(`/learning/reports?${new URLSearchParams({ courseId, page: '1', pageSize: '100' })}`),
    enabled: role === 'TUTOR' && Boolean(courseId),
  });
  const expertSessions = useQuery({
    queryKey: ['expert-sessions', 'course-overview', organizationApiPrefix, courseId],
    queryFn: () => api<{ sessions: Array<{ id: string; title: string; startsAt: string; durationMinutes: number; status: string }> }>(
      `${managerBase}/sessions?${new URLSearchParams({ courseId })}`,
    ),
    enabled: (role === 'TUTOR' || role === 'SUPER_ADMIN') && Boolean(courseId),
  });
  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['course', organizationApiPrefix, courseId] }),
      queryClient.invalidateQueries({ queryKey: ['courses'] }),
      queryClient.invalidateQueries({ queryKey: ['course-enrollments', organizationApiPrefix, courseId] }),
    ]);
  };
  const topicMutation = useMutation({
    mutationFn: () => api(`${apiBase}/${courseId}/topics`, {
      method: 'POST',
      body: JSON.stringify({ title: topicTitle, plannedHours: Number(topicHours) }),
    }),
    onSuccess: async () => { setTopicTitle(''); setTopicHours(''); setError(''); await invalidate(); },
    onError: (cause) => setError(cause instanceof ApiError ? cause.message : 'Topic could not be added.'),
  });
  const reorderMutation = useMutation({
    mutationFn: (topicIds: string[]) => api(`${apiBase}/${courseId}/topics/reorder`, { method: 'PATCH', body: JSON.stringify({ topicIds }) }),
    onSuccess: invalidate,
    onError: (cause) => setError(cause instanceof ApiError ? cause.message : 'Topic order could not be changed.'),
  });
  const coverMutation = useMutation({
    mutationFn: ({ topic, covered }: { topic: Topic; covered: boolean }) => api(`${apiBase}/${courseId}/topics/${topic.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ covered }),
    }),
    onSuccess: invalidate,
    onError: (cause) => setError(cause instanceof ApiError ? cause.message : 'Topic progress could not be updated.'),
  });
  const statusMutation = useMutation({
    mutationFn: (action: 'publish' | 'archive') => api(`${apiBase}/${courseId}/${action}`, { method: 'POST' }),
    onSuccess: async (_result, action) => {
      await invalidate();
      if (action === 'archive') navigate(returnTo, { replace: true });
    },
    onError: (cause) => setError(cause instanceof ApiError ? cause.message : 'Course status could not be changed.'),
  });
  const approvalMutation = useMutation({
    mutationFn: (enrollmentId: string) => api(`${apiBase}/${courseId}/enrollments/${enrollmentId}/approve`, { method: 'POST' }),
    onSuccess: invalidate,
    onError: (cause) => setError(cause instanceof ApiError ? cause.message : 'Enrollment could not be approved.'),
  });
  const course = courseQuery.data?.course;
  const topics = course?.topics ?? [];
  const coveredCount = topics.filter((topic) => topic.covered).length;
  const progress = topics.length ? Math.round((coveredCount / topics.length) * 100) : 0;
  const roleNotes = course ? `${notesPath(role, organizationId)}?courseId=${encodeURIComponent(course.id)}` : notesPath(role, organizationId);
  const assessmentGroups = new Map<string, CourseAssessmentReport['rows']>();
  for (const row of assessmentReports.data?.rows ?? []) {
    const group = assessmentGroups.get(row.assessmentId) ?? [];
    group.push(row);
    assessmentGroups.set(row.assessmentId, group);
  }

  const moveTopic = (index: number, direction: -1 | 1) => {
    const next = [...topics];
    const destination = index + direction;
    if (destination < 0 || destination >= next.length) return;
    [next[index], next[destination]] = [next[destination], next[index]];
    reorderMutation.mutate(next.map(({ id }) => id));
  };

  if (role === 'TUTOR' || role === 'SUPER_ADMIN') {
    const requestedTab = searchParams.get('tab') ?? 'overview';
    const activeTab = tutorCourseTabs.some(({ key }) => key === requestedTab) ? requestedTab : 'overview';
    const selectTab = (tab: string) => setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set('tab', tab);
      return next;
    }, { replace: true });

    return (
      <div className="portal-layout">
        <PortalSidebar role={role} />
        <section className="portal-content">
          <PageHeader title={course?.title ?? (role === 'TUTOR' ? 'My Course' : 'Manage Course')} backTo={returnTo} breadcrumbs={[role === 'TUTOR' ? 'My Courses' : 'Courses', course?.code ?? 'Course']} />
          {courseQuery.isLoading && <p className="loading">Loading course…</p>}
          {courseQuery.error && <p className="notice notice-error" role="alert">{courseQuery.error instanceof ApiError ? courseQuery.error.message : 'Course could not be loaded.'}</p>}
          {course && <>
            <div className="card course-detail-summary">
              <div className="course-meta"><span className={`status-pill status-${course.status.toLowerCase()}`}>{course.status}</span><span>{course.code}</span></div>
              <p>{course.description || 'No description provided.'}</p>
            </div>
            <nav className="media-tabs tutor-course-tabs" role="tablist" aria-label="Course management sections">
              {tutorCourseTabs.map(({ key, label }) => <button
                key={key}
                type="button"
                role="tab"
                aria-selected={activeTab === key}
                className={`tab-button${activeTab === key ? ' active' : ''}`}
                onClick={() => selectTab(key)}
              >{label}</button>)}
            </nav>
            {activeTab === 'overview' && <section className="course-overview-content">
              <article className="card course-section">
                <h2>Course overview</h2>
                <p>{course.description || 'No description provided.'}</p>
                <div className="course-facts">
                  <span><strong>Duration</strong>{new Date(course.startDate).toLocaleDateString()} – {new Date(course.endDate).toLocaleDateString()}</span>
                  <span><strong>Planned learning</strong>{course.plannedHours} hours</span>
                  <span><strong>Number of sessions</strong>{expertSessions.data?.sessions.length ?? (expertSessions.isLoading ? 'Loading…' : 0)}</span>
                </div>
              </article>
              <article className="card course-section">
                <h2>Session timings</h2>
                {expertSessions.isLoading && <p className="loading">Loading session schedule…</p>}
                {expertSessions.isError && <p className="notice notice-error" role="alert">Session schedule could not be loaded.</p>}
                {expertSessions.data?.sessions.length === 0 && <p className="muted">No Expert Sessions are scheduled for this course yet.</p>}
                {expertSessions.data?.sessions.map((session) => <p key={session.id}>
                  <strong>{session.title}</strong> · {new Date(session.startsAt).toLocaleString()} · {session.durationMinutes} minutes · {session.status}
                </p>)}
              </article>
              <section className="card course-section">
                <div className="list-heading"><h2>Topic progress</h2><strong>{progress}% covered</strong></div>
                <progress className="course-progress" max={100} value={progress}>{progress}%</progress>
                {topics.length === 0 ? <p className="muted">Add course topics before publishing.</p> : <ol className="course-topics">
                  {topics.map((topic, index) => <li key={topic.id} className={topic.covered ? 'topic-covered' : ''}>
                    <span className="topic-index">{index + 1}</span>
                    <div className="topic-main"><strong>{topic.title}</strong><span className="muted">{topic.plannedHours} hours · {topic.covered ? 'Covered' : 'Not covered'}</span></div>
                    <div className="topic-actions">
                      {course.status !== 'ARCHIVED' && <Button variant="ghost" aria-label={`Move ${topic.title} up`} disabled={index === 0 || reorderMutation.isPending} onClick={() => moveTopic(index, -1)}>↑</Button>}
                      {course.status !== 'ARCHIVED' && <Button variant="ghost" aria-label={`Move ${topic.title} down`} disabled={index === topics.length - 1 || reorderMutation.isPending} onClick={() => moveTopic(index, 1)}>↓</Button>}
                      {course.status !== 'ARCHIVED' && <Button variant="secondary" disabled={coverMutation.isPending} onClick={() => coverMutation.mutate({ topic, covered: !topic.covered })}>{topic.covered ? 'Mark not covered' : 'Mark covered'}</Button>}
                    </div>
                  </li>)}
                </ol>}
                {course.status !== 'ARCHIVED' && <form className="course-topic-form" onSubmit={(event) => { event.preventDefault(); setError(''); topicMutation.mutate(); }}>
                  <Field label="Topic title" value={topicTitle} onChange={(event) => setTopicTitle(event.target.value)} required maxLength={160} />
                  <Field label="Planned hours" type="number" value={topicHours} onChange={(event) => setTopicHours(event.target.value)} required min={1} max={1000} />
                  <Button type="submit" disabled={topicMutation.isPending}>{topicMutation.isPending ? 'Adding…' : 'Add topic'}</Button>
                </form>}
              </section>
            </section>}
            {activeTab === 'materials' && <NotesPage embeddedCourseId={course.id} apiPrefix={organizationApiPrefix} />}
            {activeTab === 'youtube' && <MediaPage embeddedCourseId={course.id} embeddedSource="YOUTUBE" apiPrefix={organizationApiPrefix} />}
            {activeTab === 'video' && <MediaPage embeddedCourseId={course.id} embeddedType="VIDEO" apiPrefix={organizationApiPrefix} />}
            {activeTab === 'audio' && <MediaPage embeddedCourseId={course.id} embeddedType="AUDIO" apiPrefix={organizationApiPrefix} />}
            {activeTab === 'sessions' && <ExpertSessionsPage embeddedCourseId={course.id} apiPrefix={organizationApiPrefix} />}
            {activeTab === 'practice' && <PracticeQuestionBankPage embeddedCourseId={course.id} apiPrefix={role === 'SUPER_ADMIN' ? organizationApiPrefix : ''} />}
            {activeTab === 'assessment' && <TeacherAssessmentsPage embeddedCourseId={course.id} apiPrefix={role === 'SUPER_ADMIN' ? organizationApiPrefix : ''} />}
            {error && <p className="notice notice-error" role="alert">{error}</p>}
          </>}
        </section>
      </div>
    );
  }

  return (
    <div className="portal-layout">
      <PortalSidebar role={role} />
      <section className="portal-content">
        <PageHeader title={course?.title ?? 'Course details'} backTo={returnTo} breadcrumbs={['Dashboard', 'Courses', course?.code ?? 'Details']} />
        {courseQuery.isLoading && <p className="loading">Loading course…</p>}
        {courseQuery.error && <p className="notice notice-error" role="alert">{courseQuery.error instanceof ApiError ? courseQuery.error.message : 'Course could not be loaded.'}</p>}
        {course && <>
          <div className="card course-detail-summary">
            <div className="course-meta"><span className={`status-pill status-${course.status.toLowerCase()}`}>{course.status}</span><span>{course.code}</span></div>
            <p>{course.description || 'No description provided.'}</p>
            <div className="course-facts">
              <span><strong>Category</strong>{course.category}</span>
              <span><strong>Planned learning</strong>{course.plannedHours} hours</span>
              <span><strong>Dates</strong>{new Date(course.startDate).toLocaleDateString()} – {new Date(course.endDate).toLocaleDateString()}</span>
              <span><strong>Minimum attendance</strong>{course.minimumAttendancePercent}%</span>
              <span><strong>Assessment pass required</strong>{course.requiresAssessmentPass ? 'Yes' : 'No'}</span>
              <span><strong>Faculty</strong>{course.instructors.map(({ instructor }) => instructor.name).join(', ')}</span>
            </div>
            <div className="course-actions">
              {course.status !== 'ARCHIVED' && <Link className="button button-secondary" to={`${base}/${course.id}/edit?returnTo=${encodeURIComponent(returnTo)}`}>Edit course</Link>}
              {user?.role === 'TUTOR' && <Link className="button button-secondary" to={roleNotes}>Publish Study Materials</Link>}
              {course.status === 'DRAFT' && <Button disabled={statusMutation.isPending || topics.length === 0} onClick={() => statusMutation.mutate('publish')}>Publish</Button>}
              {course.status !== 'ARCHIVED' && <Button variant="danger" disabled={statusMutation.isPending} onClick={() => {
                if (window.confirm(`Archive ${course.title}? Students will no longer be able to browse or enroll in it.`)) statusMutation.mutate('archive');
              }}>Archive</Button>}
            </div>
          </div>

          <section className="card course-section">
            <div className="list-heading"><h2>Topic progress</h2><strong>{progress}% covered</strong></div>
            <progress className="course-progress" max={100} value={progress}>{progress}%</progress>
            {topics.length === 0 ? <p className="muted">Add course topics before publishing.</p> : <ol className="course-topics">
              {topics.map((topic, index) => <li key={topic.id} className={topic.covered ? 'topic-covered' : ''}>
                <span className="topic-index">{index + 1}</span>
                <div className="topic-main"><strong>{topic.title}</strong><span className="muted">{topic.plannedHours} hours · {topic.covered ? 'Covered' : 'Not covered'}</span></div>
                <div className="topic-actions">
                  {course.status !== 'ARCHIVED' && <Button variant="ghost" aria-label={`Move ${topic.title} up`} disabled={index === 0 || reorderMutation.isPending} onClick={() => moveTopic(index, -1)}>↑</Button>}
                  {course.status !== 'ARCHIVED' && <Button variant="ghost" aria-label={`Move ${topic.title} down`} disabled={index === topics.length - 1 || reorderMutation.isPending} onClick={() => moveTopic(index, 1)}>↓</Button>}
                  {course.status !== 'ARCHIVED' && <Button variant="secondary" disabled={coverMutation.isPending} onClick={() => coverMutation.mutate({ topic, covered: !topic.covered })}>{topic.covered ? 'Mark not covered' : 'Mark covered'}</Button>}
                </div>
              </li>)}
            </ol>}
            {course.status !== 'ARCHIVED' && <form className="course-topic-form" onSubmit={(event) => { event.preventDefault(); setError(''); topicMutation.mutate(); }}>
              <Field label="Topic title" value={topicTitle} onChange={(event) => setTopicTitle(event.target.value)} required maxLength={160} />
              <Field label="Planned hours" type="number" value={topicHours} onChange={(event) => setTopicHours(event.target.value)} required min={1} max={1000} />
              <Button type="submit" disabled={topicMutation.isPending}>{topicMutation.isPending ? 'Adding…' : 'Add topic'}</Button>
            </form>}
          </section>

          <section className="card course-section">
            <div className="list-heading"><h2>Enrolled students</h2><span>{course._count.enrollments} total</span></div>
            <label className="field search-field"><span>Search student ID or name</span><input className="input" value={studentSearch} onChange={(event) => setSearchParams((current) => {
              const next = new URLSearchParams(current);
              if (event.target.value) next.set('studentSearch', event.target.value);
              else next.delete('studentSearch');
              return next;
            }, { replace: true })} /></label>
            {enrollmentQuery.isLoading && <p className="loading">Loading enrolled students…</p>}
            {enrollmentQuery.error && <p className="notice notice-error" role="alert">Student enrollments could not be loaded.</p>}
            {enrollmentQuery.data?.enrollments.length === 0 && <p className="muted">No matching enrollments.</p>}
            {enrollmentQuery.data?.enrollments.map((enrollment) => <div className="enrollment-row" key={enrollment.id}>
              <div><strong>{enrollment.student.studentProfile?.studentId ?? 'Student'}</strong><span>{enrollment.student.name}</span></div>
              <span className={`status-pill status-${enrollment.status.toLowerCase()}`}>{enrollment.status}</span>
              {enrollment.status === 'PENDING' && <Button disabled={approvalMutation.isPending} onClick={() => approvalMutation.mutate(enrollment.id)}>Approve</Button>}
            </div>)}
          </section>

          <section className="card course-section">
            <div className="list-heading"><h2>Study Materials</h2><Link className="text-link" to={roleNotes}>Manage Study Materials</Link></div>
            {course.notes.length === 0 ? <p className="muted">No Study Materials are linked to this course.</p> : course.notes.map((note) => (
              <Link className="linked-course-note" key={note.id} to={`${notesPath(role)}?view=${encodeURIComponent(note.id)}`}>
                <span><strong>{note.title}</strong><small>{note.subject}</small></span>
                <span className={`status-pill ${note.published ? 'status-published' : 'status-draft'}`}>{note.published ? 'PUBLISHED' : 'DRAFT'}</span>
              </Link>
            ))}
          </section>
          {user?.role === 'TUTOR' && <section className="card course-section">
            <div className="list-heading"><div><h2>Assessment Reports</h2><p className="muted">Participation and progress for assessments in this course.</p></div>
              <Button onClick={() => setShowAssessmentChoices((current) => !current)}>{showAssessmentChoices ? 'Close options' : 'Generate New Assessment'}</Button>
            </div>
            {showAssessmentChoices && <div className="assessment-generation-options" role="group" aria-label="Assessment creation method">
              <p>How would you like to create the assessment?</p>
              <div className="button-row">
                <Link className="button" to={`/tutor/courses/${encodeURIComponent(course.id)}/assessments/new?mode=manual`}>Create My Own</Link>
                <Link className="button button-secondary" to={`/tutor/courses/${encodeURIComponent(course.id)}/assessments/new?mode=ai`}>Generate by AI</Link>
              </div>
            </div>}
            {assessmentReports.isPending && <p className="loading" role="status">Loading assessment progress…</p>}
            {assessmentReports.isError && <p className="notice notice-error" role="alert">{assessmentReports.error instanceof ApiError ? assessmentReports.error.message : 'Assessment reports could not be loaded.'}</p>}
            {assessmentReports.data && assessmentGroups.size === 0 && <p className="muted">Published assessments will appear here with student progress.</p>}
            {[...assessmentGroups.entries()].map(([assessmentId, rows]) => {
              const completed = rows.filter(({ status }) => status === 'COMPLETED');
              const inProgress = rows.filter(({ status }) => status === 'IN_PROGRESS');
              const attempted = completed.length + inProgress.length;
              return <article className="card course-assessment-report" key={assessmentId}>
                <div className="list-heading"><h3>{rows[0]?.assessment}</h3><span>{attempted} of {rows.length} students started</span></div>
                <p className="muted">{completed.length} completed · {inProgress.length} in progress · {rows.length - attempted} not started</p>
                <div className="table-scroll"><table className="data-table"><thead><tr><th>Student</th><th>Attempts</th><th>Best score</th><th>Progress</th></tr></thead><tbody>
                  {rows.map((row) => <tr key={`${assessmentId}:${row.studentId}`}><td>{row.studentName} · {row.studentId || 'No Student ID'}</td><td>{row.attempts}</td><td>{row.bestScore === null ? '—' : `${row.bestScore} / ${row.totalMarks}`}</td><td>{row.status === 'COMPLETED' ? `${row.percentage?.toFixed(1) ?? '0.0'}% · ${row.passed ? 'Pass' : 'Fail'}` : row.status === 'IN_PROGRESS' ? 'In progress' : 'Not started'}</td></tr>)}
                </tbody></table></div>
              </article>;
            })}
            {assessmentReports.data && assessmentReports.data.pagination.totalPages > 1 && <p className="muted">Showing the first 100 student results. Use the full Assessment Reports page to browse additional records.</p>}
          </section>}
          {error && <p className="notice notice-error" role="alert">{error}</p>}
        </>}
      </section>
    </div>
  );
}
