import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, NavLink, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ConfirmDialog } from '../components/feedback';
import { PageHeader } from '../components/page-header';
import { PortalSidebar } from '../components/portal-sidebar';
import { Button } from '../components/ui/button';
import { ApiError, api } from '../lib/api';
import { NotesPage } from './notes-page';
import { StudentAssessmentsPage, StudentPracticePage } from './learning-pages';
import { ExpertSessionsPage, LibraryPage } from './student-portal-pages';

type Course = {
  id: string;
  code: string;
  title: string;
  description: string | null;
  thumbnailUrl: string | null;
  category: string;
  plannedHours: number;
  startDate: string;
  endDate: string;
  minimumAttendancePercent: number;
  requiresAssessmentPass: boolean;
  progressPercent: number;
  instructors: Array<{ instructor: { name: string } }>;
  topics: Array<{ id: string; title: string; plannedHours: number; order: number; covered: boolean; coveredAt: string | null }>;
  notes: Array<{ id: string; title: string; subject: string; description: string; originalName: string | null; updatedAt: string }>;
  enrollments: Array<{ id: string; status: 'PENDING' | 'ACTIVE'; enrolledAt: string }>;
};
type EnrollmentSummary = {
  status: string;
  course: Course & {
    learnedHours: number;
    subscriptionStatus: string;
    nextSession: { id: string; title: string; startsAt: string; durationMinutes: number; status: string } | null;
  };
};
type CourseMedia = {
  id: string; title: string; type: string; source: string; durationSeconds: number | null;
  progressPercent: number; completed: boolean; locked?: boolean;
  course: { id: string; code: string; title: string };
};
type PreferredTutor = {
  id: string; name: string;
  ratingSummary: { averageRating: number | null; reviewCount: number };
};

const courseTabs = [
  { key: 'overview', label: 'Overview' },
  { key: 'media', label: 'Videos & Audios' },
  { key: 'books', label: 'Books' },
  { key: 'sessions', label: 'Experts Session' },
  { key: 'materials', label: 'Study Materials' },
  { key: 'practice', label: 'Practice Q/A' },
  { key: 'assessments', label: 'Assessments' },
] as const;
type CourseTab = typeof courseTabs[number]['key'];

function safeReturnTo(value: string | null) {
  const allowed = ['/student/courses', '/student/course-catalog'];
  return value && !value.startsWith('//') && allowed.some((base) => value === base || value.startsWith(`${base}?`))
    ? value
    : '/student/course-catalog';
}

function errorText(error: unknown) {
  return error instanceof ApiError ? error.message : error instanceof Error ? error.message : 'The course could not be loaded.';
}

function displaySubscription(status?: string) {
  return (status ?? 'NOT_SUBSCRIBED').replaceAll('_', ' ').toLowerCase().replace(/^\w/, (letter) => letter.toUpperCase());
}

export function StudentCourseDetailPage() {
  const { courseId = '', tab: routeTab = 'overview' } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const returnTo = safeReturnTo(searchParams.get('returnTo'));
  const isTab = courseTabs.some(({ key }) => key === routeTab);
  const activeTab = isTab ? routeTab as CourseTab : 'overview';
  const [confirmDrop, setConfirmDrop] = useState(false);
  const query = useQuery({
    queryKey: ['student-course', courseId],
    queryFn: () => api<{ course: Course }>(`/student/courses/${courseId}`),
    enabled: Boolean(courseId),
  });
  const enrolled = useQuery({
    queryKey: ['student-courses-enrolled'],
    queryFn: () => api<{ enrollments: EnrollmentSummary[] }>('/student/courses/enrolled'),
  });
  const preferredTutor = useQuery({
    queryKey: ['student-preferred-tutor'],
    queryFn: () => api<{ tutor: PreferredTutor | null }>('/tutors/preferred'),
  });
  const mutation = useMutation({
    mutationFn: (action: 'enroll' | 'drop') => api(`/student/courses/${courseId}/${action}`, { method: 'POST' }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['student-course', courseId] }),
        queryClient.invalidateQueries({ queryKey: ['student-course-browse'] }),
        queryClient.invalidateQueries({ queryKey: ['student-courses-enrolled'] }),
      ]);
    },
  });
  const course = query.data?.course;
  const enrollment = course?.enrollments[0];
  const summary = enrolled.data?.enrollments.find((item) => item.course.id === courseId);
  const activeEnrollment = enrollment?.status === 'ACTIVE';
  const selectedTutor = preferredTutor.data?.tutor;
  const media = useQuery({
    queryKey: ['student-course-media', courseId],
    queryFn: () => api<{ items: CourseMedia[] }>(`/student/media?courseId=${encodeURIComponent(courseId)}`),
    enabled: Boolean(activeEnrollment && activeTab === 'media'),
  });
  useEffect(() => {
    if (!isTab && courseId) navigate(`/student/courses/${encodeURIComponent(courseId)}/overview`, { replace: true });
  }, [courseId, isTab, navigate]);

  const tabContent = () => {
    if (!activeEnrollment) return <div className="card empty-state"><h2>Enroll to access course materials</h2><p>Videos, books, expert sessions, progress, and saved study materials are available to active enrollees only.</p></div>;
    switch (activeTab) {
      case 'overview':
        return <div className="course-overview-content">
          <section className="card course-section"><h2>Course summary</h2><p>{course?.description || 'No course summary is available yet.'}</p>
            <div className="course-facts">
              <span><strong>Planned learning</strong>{course?.plannedHours ?? 0} hours</span>
              <span><strong>Learned</strong>{summary?.course.learnedHours ?? 0} hours</span>
              <span><strong>Progress</strong>{course?.progressPercent ?? 0}%</span>
              <span><strong>Minimum attendance</strong>{course?.minimumAttendancePercent ?? 0}%</span>
              <span><strong>Assessment pass required</strong>{course?.requiresAssessmentPass ? 'Yes' : 'No'}</span>
            </div>
          </section>
          <section className="card course-section"><h2>Syllabus</h2>
            {course?.topics.length === 0 ? <p className="muted">Topics have not been added yet.</p> : <ol className="course-topics student-topics">
              {course?.topics.map((topic, index) => <li key={topic.id} className={topic.covered ? 'topic-covered' : ''}>
                <span className="topic-index">{index + 1}</span><div className="topic-main"><strong>{topic.title}</strong><span className="muted">{topic.plannedHours} hours</span></div>
                <span className={`status-pill ${topic.covered ? 'status-published' : 'status-draft'}`}>{topic.covered ? 'COVERED' : 'NOT COVERED'}</span>
              </li>)}
            </ol>}
          </section>
          {summary?.course.nextSession && <section className="card course-section"><h2>Next session</h2><p><strong>{summary.course.nextSession.title}</strong></p><p>{new Date(summary.course.nextSession.startsAt).toLocaleString()} · {summary.course.nextSession.durationMinutes} minutes</p><Link className="button button-secondary" to={`/student/courses/${courseId}/sessions`}>View sessions</Link></section>}
        </div>;
      case 'media':
        return <section className="course-section">
          <div className="list-heading"><h2>Videos & Audios</h2></div>
          {media.isLoading && <p className="loading">Loading videos and audios…</p>}
          {media.isError && <p className="notice notice-error" role="alert">{errorText(media.error)}</p>}
          {media.data?.items.length === 0 && <div className="card empty-state"><h2>No media in this course</h2><p>Published videos and audios linked to this course will appear here.</p></div>}
          {media.data?.items.map((item) => <article className="card linked-course-note" key={item.id}>
            <span><strong>{item.title}</strong><small>{item.source === 'YOUTUBE' ? 'YouTube' : item.type} · {item.completed ? 'Completed' : `${Math.round(item.progressPercent)}% complete`}{item.durationSeconds ? ` · ${Math.round(item.durationSeconds / 60)} min` : ''}</small></span>
            {item.locked ? <Link className="button" to="/student/payments">Pay My Fee</Link> : <Link className="button button-secondary" to={`/student/courses/${encodeURIComponent(courseId)}/media/${item.id}`}>{item.completed ? 'Replay' : 'Continue watching'}</Link>}
          </article>)}
        </section>;
      case 'books':
        return <LibraryPage embeddedCourseId={courseId} />;
      case 'sessions':
        return <ExpertSessionsPage embeddedCourseId={courseId} />;
      case 'materials':
        return <NotesPage embeddedCourseId={courseId} />;
      case 'practice':
        return <StudentPracticePage embeddedCourseId={courseId} />;
      case 'assessments':
        return <StudentAssessmentsPage embeddedCourseId={courseId} />;
      default:
        return null;
    }
  };

  return <div className="portal-layout">
    <PortalSidebar role="STUDENT" />
    <section className="portal-content">
      <PageHeader title={course?.title ?? 'Course details'} backTo={returnTo} breadcrumbs={['My Course', course?.code ?? 'Course']} />
      {query.isLoading && <p className="loading">Loading course…</p>}
      {query.error && <p className="notice notice-error" role="alert">{errorText(query.error)}</p>}
      {course && <>
        <div className="card course-detail-summary">
          {course.thumbnailUrl && <img className="course-detail-thumbnail" src={course.thumbnailUrl} alt={`${course.title} course thumbnail`} referrerPolicy="no-referrer" />}
          <div className="course-meta"><span>{course.code}</span><span>{course.category}</span></div>
          {!activeEnrollment && <p>{course.description || 'No description provided.'}</p>}
          {activeEnrollment && <div className="course-facts">
            <span><strong>My tutor</strong>{selectedTutor?.name ?? (course.instructors.map(({ instructor }) => instructor.name).join(', ') || 'Not selected')}</span>
            {selectedTutor && <span><strong>Tutor rating</strong>{selectedTutor.ratingSummary.averageRating === null ? 'No ratings yet' : `${selectedTutor.ratingSummary.averageRating.toFixed(1)} / 5 · ${selectedTutor.ratingSummary.reviewCount} reviews`}</span>}
            <span><strong>Progress</strong>{course.progressPercent}%</span>
            <span><strong>Subscription</strong>{displaySubscription(summary?.course.subscriptionStatus)}</span>
          </div>}
          <div className="course-actions">
            {activeEnrollment && <Link className="button button-secondary" to={`/student/tutors?courseId=${encodeURIComponent(course.id)}`}>Change tutor</Link>}
            {activeEnrollment && <Link className="button" to={`/student/payments?courseId=${encodeURIComponent(course.id)}`}>Pay My Fee</Link>}
            {enrollment?.status === 'ACTIVE' && <Button variant="danger" onClick={() => setConfirmDrop(true)}>Drop course</Button>}
            {enrollment?.status === 'PENDING' && <span className="status-pill status-pending">ENROLLMENT PENDING</span>}
            {!enrollment && <Button disabled={mutation.isPending} onClick={() => mutation.mutate('enroll')}>{mutation.isPending ? 'Enrolling…' : 'Enroll in course'}</Button>}
          </div>
        </div>
        {activeEnrollment && <nav className="media-tabs course-detail-tabs" role="tablist" aria-label="Course sections">
          {courseTabs.map(({ key, label }) => <NavLink key={key} role="tab" aria-selected={activeTab === key} className={({ isActive }) => `tab-button${isActive ? ' active' : ''}`} to={`/student/courses/${encodeURIComponent(courseId)}/${key}`}>{label}</NavLink>)}
        </nav>}
        {tabContent()}
        {mutation.error && <p className="notice notice-error" role="alert">{errorText(mutation.error)}</p>}
      </>}
      {confirmDrop && course && <ConfirmDialog
        title="Drop this course?"
        message={`You will lose access to this course in your active list. Your progress record will remain. Are you sure you want to drop ${course.title}?`}
        confirmLabel="Drop course"
        onCancel={() => setConfirmDrop(false)}
        onConfirm={() => mutation.mutate('drop')}
      />}
    </section>
  </div>;
}
