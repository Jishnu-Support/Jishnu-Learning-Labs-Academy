import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/auth-context';
import { PageHeader } from '../components/page-header';
import { PortalSidebar } from '../components/portal-sidebar';
import { Button } from '../components/ui/button';
import { ApiError, api } from '../lib/api';

type CourseCard = {
  id: string;
  code: string;
  title: string;
  description: string | null;
  thumbnailUrl: string | null;
  progressPercent: number;
  category: string;
  plannedHours: number;
  instructors: Array<{ instructor: { name: string } }>;
  _count: { topics: number };
  enrollments: Array<{ id: string; status: string }>;
};
type Enrollment = {
  id: string;
  status: string;
  enrolledAt: string;
  selectedTutor: { id: string; name: string; expertise: string[]; hasPhoto: boolean } | null;
  pendingTutor: { id: string; name: string } | null;
  course: CourseCard & {
    topics: Array<{ covered: boolean }>;
    learnedHours: number;
    subscriptionStatus: string;
    nextSession: { id: string; title: string; startsAt: string; durationMinutes: number } | null;
  };
};

function studentCourseRoute(searchParams: URLSearchParams) {
  return `/student/courses${searchParams.size ? `?${searchParams.toString()}` : ''}`;
}

function StudentCourseListPage({ catalogOnly }: { catalogOnly: boolean }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = catalogOnly ? 'browse' : 'enrolled';
  const search = searchParams.get('search') ?? '';
  const browse = useQuery({
    queryKey: ['student-course-browse', search],
    queryFn: () => api<{ courses: CourseCard[] }>(`/student/courses/browse?${new URLSearchParams(search ? { search } : {})}`),
    enabled: catalogOnly,
  });
  const enrolled = useQuery({
    queryKey: ['student-courses-enrolled'],
    queryFn: () => api<{ enrollments: Enrollment[] }>('/student/courses/enrolled'),
    enabled: !catalogOnly,
  });
  const enrollMutation = useMutation({
    mutationFn: (courseId: string) => api(`/student/courses/${courseId}/enroll`, { method: 'POST' }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['student-course-browse'] }),
        queryClient.invalidateQueries({ queryKey: ['student-courses-enrolled'] }),
      ]);
    },
  });
  const courses = browse.data?.courses ?? [];
  const enrollments = enrolled.data?.enrollments ?? [];
  const pageSize = 8;
  const page = Math.max(1, Number(searchParams.get('page') ?? 1) || 1);
  const pageCount = Math.max(1, Math.ceil(courses.length / pageSize));

  const updateQuery = (key: string, value: string) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (value) next.set(key, value);
      else next.delete(key);
      if (key !== 'page') next.delete('page');
      return next;
    }, { replace: true });
  };
  const returnTo = catalogOnly ? '/student/course-catalog' : studentCourseRoute(searchParams);

  return (
    <div className="portal-layout">
      <PortalSidebar role="STUDENT" />
      <section className="portal-content">
        <PageHeader title={catalogOnly ? 'Explore Courses' : 'My Course'} backTo="/student" breadcrumbs={['Dashboard', catalogOnly ? 'Explore Courses' : 'My Course']} />
        <p className="muted">{catalogOnly ? 'Explore published courses from your organization.' : 'Continue with courses you are actively enrolled in.'}</p>
        {catalogOnly && <p><Link className="text-link" to="/student/courses">Back to My Course</Link></p>}
        {!catalogOnly && <nav className="media-tabs student-course-page-tabs" role="tablist" aria-label="My Course sections">
          <Link className="tab-button active" role="tab" aria-selected="true" to="/student/courses">My Course</Link>
          <Link className="tab-button" role="tab" aria-selected="false" to="/student/courses/reports">My Reports</Link>
        </nav>}
        {tab === 'browse' && <>
          <label className="field search-field course-search"><span>Search courses</span><input className="input" value={search} onChange={(event) => updateQuery('search', event.target.value)} /></label>
          {browse.isLoading && <p className="loading">Loading published courses…</p>}
          {browse.error && <p className="notice notice-error" role="alert">{browse.error instanceof ApiError ? browse.error.message : 'Courses could not be loaded.'}</p>}
          {browse.data && courses.length === 0 && <div className="card empty-state"><h2>No published courses found</h2><p>{search ? 'Try another search.' : 'Published courses from your organization will appear here.'}</p></div>}
          <div className="student-course-grid">{courses.slice((page - 1) * pageSize, page * pageSize).map((course) => {
            const enrollment = course.enrollments.find((item) => item.status !== 'DROPPED');
            return <article className="card course-card" key={course.id}>
              {course.thumbnailUrl ? <img className="course-card-thumbnail" src={course.thumbnailUrl} alt={`${course.title} course thumbnail`} referrerPolicy="no-referrer" /> : <div className="course-card-thumbnail course-card-thumbnail-placeholder" aria-label={`${course.title} course thumbnail`}><span>{course.category}</span></div>}
              <div className="course-meta"><span>{course.code}</span><span>{course.category}</span></div>
              <h2>{course.title}</h2>
              <p>{course.description || 'No description provided.'}</p>
              <p className="muted">{course.plannedHours} hours · {course._count.topics} topics</p>
              <p className="muted">Faculty: {course.instructors.map(({ instructor }) => instructor.name).join(', ')}</p>
              <div className="course-actions">
                <Link className="button button-secondary" to={`/student/courses/${course.id}?returnTo=${encodeURIComponent(returnTo)}`}>Course details</Link>
                {enrollment
                  ? <span className={`status-pill status-${enrollment.status.toLowerCase()}`}>{enrollment.status}</span>
                  : <Button disabled={enrollMutation.isPending} onClick={() => enrollMutation.mutate(course.id)}>{enrollMutation.isPending ? 'Enrolling…' : 'Enroll'}</Button>}
              </div>
            </article>;
          })}</div>
          {courses.length > pageSize && <nav className="pagination" aria-label="Course pages">
            <Button variant="secondary" disabled={page <= 1} onClick={() => updateQuery('page', String(page - 1))}>Previous</Button>
            <span>Page {page} of {pageCount}</span>
            <Button variant="secondary" disabled={page >= pageCount} onClick={() => updateQuery('page', String(page + 1))}>Next</Button>
          </nav>}
          {enrollMutation.error && <p className="notice notice-error" role="alert">{enrollMutation.error instanceof ApiError ? enrollMutation.error.message : 'Enrollment could not be completed.'}</p>}
        </>}
        {tab === 'enrolled' && <>
          {enrolled.isLoading && <p className="loading">Loading enrolled courses…</p>}
          {enrolled.error && <p className="notice notice-error" role="alert">Your courses could not be loaded.</p>}
          {enrolled.data && enrollments.length === 0 && <div className="card empty-state"><h2>No active courses yet</h2><p>Explore published courses to find one to join.</p><Link className="button" to="/student/course-catalog">Explore courses</Link></div>}
          <div className="student-course-grid">{enrollments.map(({ id, status, course, selectedTutor, pendingTutor }) => {
            const progress = course.progressPercent;
            return <article className="card course-card" key={id}>
              {course.thumbnailUrl ? <img className="course-card-thumbnail" src={course.thumbnailUrl} alt={`${course.title} course thumbnail`} referrerPolicy="no-referrer" /> : <div className="course-card-thumbnail course-card-thumbnail-placeholder" aria-label={`${course.title} course thumbnail`}><span>{course.category}</span></div>}
              <div className="course-meta"><span>{course.code}</span><span className={`status-pill status-${status.toLowerCase()}`}>{status}</span></div>
              <h2>{course.title}</h2>
              <p>{course.description || 'No description provided.'}</p>
              <p className="muted">My tutor: {selectedTutor?.name ?? 'Choose your Tutor'}</p>
              {pendingTutor && <p className="notice notice-info">Tutor change to {pendingTutor.name} takes effect at the next renewal.</p>}
              <p className="muted">{course.learnedHours} of {course.plannedHours} hours learned · {progress}% course progress</p>
              <p className="muted">Subscription: {course.subscriptionStatus.replaceAll('_', ' ')}</p>
              {course.nextSession && <p className="muted">Next session: {course.nextSession.title} · {new Date(course.nextSession.startsAt).toLocaleString()}</p>}
              <div className="course-actions">
                {!pendingTutor && <Link className="button button-secondary" to={`/student/tutors?courseId=${encodeURIComponent(course.id)}`}>{selectedTutor ? 'Change tutor' : 'Choose your tutor'}</Link>}
                <Link className="button button-secondary" to={`/student/courses/${course.id}/overview?returnTo=${encodeURIComponent(returnTo)}`}>Continue course</Link>
              </div>
            </article>;
          })}</div>
        </>}
        <p className="muted course-greeting">Welcome{user?.name ? `, ${user.name.split(' ')[0]}` : ''}.</p>
      </section>
    </div>
  );
}

export function StudentCoursesPage() {
  return <StudentCourseListPage catalogOnly={false} />;
}

export function StudentCourseCatalogPage() {
  return <StudentCourseListPage catalogOnly />;
}
