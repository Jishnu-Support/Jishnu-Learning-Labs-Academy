import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, NavLink, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ConfirmDialog } from '../components/feedback';
import { PageHeader } from '../components/page-header';
import { PortalSidebar } from '../components/portal-sidebar';
import { StudentMediaEmbed, type StudentPlayableMedia } from '../components/student-media-embed';
import { Button } from '../components/ui/button';
import { ApiError, api, apiUrl } from '../lib/api';
import { NotesPage } from './notes-page';
import { StudentAssessmentsPage, StudentPracticePage } from './learning-pages';
import { CourseCertificatePage, ExpertSessionsPage, LibraryPage } from './student-portal-pages';
import { StudentReportsPage } from './student-reports-page';

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
  enrollments: Array<{
    id: string;
    status: 'PENDING' | 'ACTIVE' | 'COMPLETED';
    enrolledAt: string;
    completedAt: string | null;
    selectedTutorId: string | null;
    pendingTutorId: string | null;
    selectedTutor: { id: string; name: string } | null;
    pendingTutor: { id: string; name: string } | null;
  }>;
};
type EnrollmentSummary = {
  status: string;
  course: Course & {
    learnedHours: number;
    subscriptionStatus: string;
    nextSession: { id: string; title: string; startsAt: string; durationMinutes: number; status: string } | null;
  };
};
type CourseMedia = StudentPlayableMedia & {
  description: string | null;
  progressPercent: number; completed: boolean; locked?: boolean;
  course: { id: string; code: string; title: string };
  topic: { id: string; title: string } | null;
  createdAt: string;
  publishedAt: string | null;
};
type PreferredTutor = {
  id: string; name: string;
  ratingSummary: { averageRating: number | null; reviewCount: number };
};

const courseTabs = [
  { key: 'overview', label: 'Overview' },
  { key: 'materials', label: 'Study material' },
  { key: 'youtube', label: 'Youtube links' },
  { key: 'videos', label: 'Videos' },
  { key: 'audios', label: 'Audios' },
  { key: 'sessions', label: 'Expert session' },
  { key: 'practice', label: 'Practice Q/A' },
  { key: 'assessment', label: 'Assessment' },
  { key: 'reports', label: 'Evaluation reports' },
  { key: 'certificate', label: 'My certificate' },
] as const;
type CourseTab = typeof courseTabs[number]['key'];
const legacyCourseTabs: Record<string, CourseTab> = {
  media: 'videos',
  books: 'materials',
  assessments: 'assessment',
};

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
  const legacyTab = legacyCourseTabs[routeTab];
  const activeTab = isTab ? routeTab as CourseTab : legacyTab ?? 'overview';
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
    queryKey: ['student-preferred-tutor', courseId],
    queryFn: () => api<{ tutor: PreferredTutor | null }>(`/tutors/preferred?courseId=${encodeURIComponent(courseId)}`),
    enabled: Boolean(query.data?.course.enrollments.some((item) => item.status === 'ACTIVE')),
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
  const completedEnrollment = enrollment?.status === 'COMPLETED';
  const hasCourseAccess = activeEnrollment || completedEnrollment;
  const selectedTutor = preferredTutor.data?.tutor ?? null;
  const media = useQuery({
    queryKey: ['student-course-media', courseId],
    queryFn: () => api<{ items: CourseMedia[] }>(`/student/media?courseId=${encodeURIComponent(courseId)}`),
    enabled: Boolean(activeEnrollment && ['youtube', 'videos', 'audios'].includes(activeTab)),
  });
  useEffect(() => {
    if (!isTab && courseId) navigate(`/student/courses/${encodeURIComponent(courseId)}/${legacyTab ?? 'overview'}`, { replace: true });
  }, [courseId, isTab, legacyTab, navigate]);

  const mediaContent = (title: string, items: CourseMedia[]) => <section className="course-section">
    <div className="list-heading"><h2>{title}</h2></div>
    {media.isLoading && <p className="loading">Loading {title.toLowerCase()}…</p>}
    {media.isError && <p className="notice notice-error" role="alert">{errorText(media.error)}</p>}
    {media.data && items.length === 0 && <div className="card empty-state"><h2>No {title.toLowerCase()} in this course</h2><p>Published course content will appear here.</p></div>}
    <div className="course-media-grid">{items.map((item) => <article className="card course-media-card" key={item.id}>
      {item.thumbnailUrl && !item.locked
        ? <img className="library-media-thumbnail" src={`${apiUrl}${item.thumbnailUrl}`} alt={`${item.title} thumbnail`} />
        : <div className="library-content-thumbnail library-media-placeholder" aria-hidden="true">{item.type}</div>}
      <p className="eyebrow">{item.topic?.title ?? 'General lesson'} · {item.source === 'YOUTUBE' ? 'YouTube link' : item.type}</p>
      <h3>{item.title}</h3>
      <p className="muted">{item.completed ? 'Completed' : `${Math.round(item.progressPercent)}% complete`}{item.durationSeconds ? ` · ${Math.round(item.durationSeconds / 60)} min` : ''}</p>
      <time className="library-content-date" dateTime={item.publishedAt ?? item.createdAt}>Published {new Date(item.publishedAt ?? item.createdAt).toLocaleDateString()}</time>
      {item.locked ? <Link className="button" to="/student/payments">Pay My Fee</Link> : <StudentMediaEmbed media={item} />}
      {!item.locked && <Link className="button button-secondary" to={`/student/courses/${encodeURIComponent(courseId)}/media/${encodeURIComponent(item.id)}`}>{item.completed ? 'Replay in full player' : 'Open full player'}</Link>}
    </article>)}</div>
  </section>;

  const tabContent = () => {
    if (!hasCourseAccess) return <div className="card empty-state"><h2>Enroll to access course materials</h2><p>Course materials and progress are available to active enrollees.</p></div>;
    if (completedEnrollment && !['overview', 'reports', 'certificate'].includes(activeTab)) {
      return <div className="card empty-state"><h2>Course completed</h2><p>Access to this course’s materials, practice, assessments, and sessions has ended.</p><Link className="button button-secondary" to={`/student/courses/${encodeURIComponent(courseId)}/certificate`}>View certificate</Link></div>;
    }
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
          {completedEnrollment && <p className="notice notice-success">Course completed{enrollment?.completedAt ? ` on ${new Date(enrollment.completedAt).toLocaleDateString()}` : ''}.</p>}
          {activeEnrollment && summary?.course.nextSession && <section className="card course-section"><h2>Next session</h2><p><strong>{summary.course.nextSession.title}</strong></p><p>{new Date(summary.course.nextSession.startsAt).toLocaleString()} · {summary.course.nextSession.durationMinutes} minutes</p><Link className="button button-secondary" to={`/student/courses/${courseId}/sessions`}>View sessions</Link></section>}
        </div>;
      case 'youtube':
        return mediaContent('Youtube links', media.data?.items.filter((item) => item.source === 'YOUTUBE') ?? []);
      case 'videos':
        return mediaContent('Videos', media.data?.items.filter((item) => item.type === 'VIDEO' && item.source !== 'YOUTUBE') ?? []);
      case 'audios':
        return mediaContent('Audios', media.data?.items.filter((item) => item.type === 'AUDIO') ?? []);
      case 'materials':
        return <><NotesPage embeddedCourseId={courseId} /><LibraryPage embeddedCourseId={courseId} /></>;
      case 'sessions':
        return <ExpertSessionsPage embeddedCourseId={courseId} />;
      case 'practice':
        return <StudentPracticePage embeddedCourseId={courseId} />;
      case 'assessment':
        return <StudentAssessmentsPage embeddedCourseId={courseId} />;
      case 'reports':
        return <StudentReportsPage embeddedCourseId={courseId} />;
      case 'certificate':
        return <CourseCertificatePage courseId={courseId} />;
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
            <span><strong>My tutor</strong>{selectedTutor?.name ?? enrollment?.selectedTutor?.name ?? 'Choose your Tutor'}</span>
            {enrollment?.pendingTutor && <span><strong>Next renewal</strong>{enrollment.pendingTutor.name}</span>}
            {selectedTutor && <span><strong>Tutor rating</strong>{selectedTutor.ratingSummary.averageRating === null ? 'No ratings yet' : `${selectedTutor.ratingSummary.averageRating.toFixed(1)} / 5 · ${selectedTutor.ratingSummary.reviewCount} reviews`}</span>}
            <span><strong>Progress</strong>{course.progressPercent}%</span>
            <span><strong>Subscription</strong>{displaySubscription(summary?.course.subscriptionStatus)}</span>
          </div>}
          <div className="course-actions">
            {activeEnrollment && <Link className="button button-secondary" to={`/student/tutors?courseId=${encodeURIComponent(course.id)}`}>{enrollment?.selectedTutorId ? 'Change tutor' : 'Choose your tutor'}</Link>}
            {activeEnrollment && <Link className="button" to={`/student/payments?courseId=${encodeURIComponent(course.id)}`}>Pay My Fee</Link>}
            {enrollment?.status === 'COMPLETED' && <span className="status-pill status-published">COURSE COMPLETED</span>}
            {enrollment?.status === 'ACTIVE' && <Button variant="danger" onClick={() => setConfirmDrop(true)}>Drop course</Button>}
            {enrollment?.status === 'PENDING' && <span className="status-pill status-pending">ENROLLMENT PENDING</span>}
            {!enrollment && <Button disabled={mutation.isPending} onClick={() => mutation.mutate('enroll')}>{mutation.isPending ? 'Enrolling…' : 'Enroll in course'}</Button>}
          </div>
        </div>
        {hasCourseAccess && <nav className="media-tabs course-detail-tabs" role="tablist" aria-label="Course sections">
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
