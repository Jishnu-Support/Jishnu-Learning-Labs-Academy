import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/auth-context';
import { Field } from '../components/field';
import { PageHeader } from '../components/page-header';
import { PortalSidebar } from '../components/portal-sidebar';
import { Button } from '../components/ui/button';
import { ApiError, api } from '../lib/api';
import type { Role } from '../types';

type Status = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
type Instructor = { id: string; name: string };
type Course = {
  id: string;
  code: string;
  title: string;
  description: string | null;
  category: string;
  plannedHours: number;
  startDate: string;
  endDate: string;
  status: Status;
  minimumAttendancePercent: number;
  requiresAssessmentPass: boolean;
  instructors: Array<{ instructor: Instructor }>;
  topics: Array<{ id: string; plannedHours: number }>;
  _count: { enrollments: number; notes: number };
  updatedAt: string;
};
type CourseForm = {
  code: string;
  title: string;
  description: string;
  category: string;
  plannedHours: string;
  startDate: string;
  endDate: string;
  minimumAttendancePercent: string;
  requiresAssessmentPass: boolean;
  instructorIds: string[];
};
const noInstructors: Instructor[] = [];

function routeForRole(role: Role) {
  return role === 'ORG_ADMIN' ? '/org-admin/courses' : '/instructor/courses';
}

function safeReturnTo(value: string | null, base: string) {
  if (value && !value.startsWith('//') && (value === base || value.startsWith(`${base}?`))) return value;
  return base;
}

function roleDashboard(role: Role) {
  return role === 'ORG_ADMIN' ? '/org-admin' : '/instructor';
}

function emptyForm(instructors: Instructor[], role: Role, userId?: string): CourseForm {
  return {
    code: '',
    title: '',
    description: '',
    category: '',
    plannedHours: '',
    startDate: '',
    endDate: '',
    minimumAttendancePercent: '75',
    requiresAssessmentPass: true,
    instructorIds: role === 'INSTRUCTOR' && userId ? [userId] : instructors.slice(0, 1).map(({ id }) => id),
  };
}

export function CoursesPage() {
  const { user } = useAuth();
  const role = user?.role === 'ORG_ADMIN' ? 'ORG_ADMIN' : 'INSTRUCTOR';
  const base = routeForRole(role);
  const [searchParams, setSearchParams] = useSearchParams();
  const search = searchParams.get('search') ?? '';
  const status = searchParams.get('status') ?? '';
  const page = Math.max(1, Number(searchParams.get('page') ?? 1) || 1);
  const query = useQuery({
    queryKey: ['courses', role, search, status],
    queryFn: () => api<{ courses: Course[] }>(`/courses?${new URLSearchParams({ ...(search ? { search } : {}), ...(status ? { status } : {}) })}`),
  });
  const courses = query.data?.courses ?? [];
  const pageSize = 8;
  const pageCount = Math.max(1, Math.ceil(courses.length / pageSize));
  const visibleCourses = courses.slice((page - 1) * pageSize, page * pageSize);
  const updateQuery = (key: string, value: string) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (value) next.set(key, value);
      else next.delete(key);
      if (key !== 'page') next.delete('page');
      return next;
    }, { replace: true });
  };

  return (
    <div className="portal-layout">
      <PortalSidebar role={role} />
      <section className="portal-content">
        <PageHeader title="Courses" backTo={roleDashboard(role)} breadcrumbs={['Dashboard', 'Courses']} />
        <p className="muted">Build course outlines, assign instructors, and track topic delivery.</p>
        <div className="directory-filters">
          <label className="field search-field"><span>Search courses</span><input className="input" value={search} onChange={(event) => updateQuery('search', event.target.value)} /></label>
          <label className="field"><span>Status</span><select className="input" value={status} onChange={(event) => updateQuery('status', event.target.value)}><option value="">All statuses</option><option value="DRAFT">Draft</option><option value="PUBLISHED">Published</option><option value="ARCHIVED">Archived</option></select></label>
          <Link className="button button-primary" to={`${base}/new?returnTo=${encodeURIComponent(`${base}${window.location.search}`)}`}>Create course</Link>
        </div>
        {query.isLoading && <p className="loading">Loading courses…</p>}
        {query.error && <p className="notice notice-error" role="alert">{query.error instanceof ApiError ? query.error.message : 'Courses could not be loaded.'}</p>}
        {query.data && courses.length === 0 && <div className="card empty-state"><h2>No courses found</h2><p>{search || status ? 'Adjust your search or filters.' : 'Create a course to get started.'}</p></div>}
        <div className="course-list">
          {visibleCourses.map((course) => (
            <article className="card course-card" key={course.id}>
              <div className="course-meta"><span className={`status-pill status-${course.status.toLowerCase()}`}>{course.status}</span><span>{course.code}</span></div>
              <h3>{course.title}</h3>
              <p className="muted course-description">{course.category} · {course.plannedHours} planned hours</p>
              <p className="course-description">{course.description || 'No description yet.'}</p>
              <p className="muted course-description">Instructors: {course.instructors.map(({ instructor }) => instructor.name).join(', ') || 'None'} · {course._count.enrollments} enrollments · {course._count.notes} notes</p>
              <div className="course-actions">
                <Link className="button button-secondary" to={`${base}/${course.id}?returnTo=${encodeURIComponent(`${base}${window.location.search}`)}`}>Manage course</Link>
                {course.status !== 'ARCHIVED' && <Link className="button button-ghost" to={`${base}/${course.id}/edit?returnTo=${encodeURIComponent(`${base}${window.location.search}`)}`}>Edit</Link>}
              </div>
            </article>
          ))}
        </div>
        {courses.length > pageSize && <nav className="pagination" aria-label="Course pages">
          <Button variant="secondary" disabled={page <= 1} onClick={() => updateQuery('page', String(page - 1))}>Previous</Button>
          <span>Page {page} of {pageCount}</span>
          <Button variant="secondary" disabled={page >= pageCount} onClick={() => updateQuery('page', String(page + 1))}>Next</Button>
        </nav>}
      </section>
    </div>
  );
}

export function CourseFormPage() {
  const { user } = useAuth();
  const role = user?.role === 'ORG_ADMIN' ? 'ORG_ADMIN' : 'INSTRUCTOR';
  const base = routeForRole(role);
  const navigate = useNavigate();
  const params = useParams();
  const [searchParams] = useSearchParams();
  const courseId = params.courseId;
  const returnTo = safeReturnTo(searchParams.get('returnTo'), base);
  const instructorQuery = useQuery({ queryKey: ['course-instructors'], queryFn: () => api<{ instructors: Instructor[] }>('/courses/instructors') });
  const courseQuery = useQuery({
    queryKey: ['course', courseId],
    queryFn: () => api<{ course: Course }>(`/courses/${courseId}`),
    enabled: Boolean(courseId),
  });
  const instructors = instructorQuery.data?.instructors ?? noInstructors;
  const [form, setForm] = useState<CourseForm>(() => emptyForm([], role, user?.id));
  const [baseline, setBaseline] = useState('');
  const [error, setError] = useState('');
  const queryClient = useQueryClient();
  useEffect(() => {
    if (courseQuery.data) {
      const course = courseQuery.data.course;
      const values: CourseForm = {
        code: course.code,
        title: course.title,
        description: course.description ?? '',
        category: course.category,
        plannedHours: String(course.plannedHours),
        startDate: course.startDate.slice(0, 10),
        endDate: course.endDate.slice(0, 10),
        minimumAttendancePercent: String(course.minimumAttendancePercent),
        requiresAssessmentPass: course.requiresAssessmentPass,
        instructorIds: course.instructors.map(({ instructor }) => instructor.id),
      };
      setForm(values);
      setBaseline(JSON.stringify(values));
    }
  }, [courseQuery.data]);
  useEffect(() => {
    if (!courseId && instructorQuery.data && baseline === '') {
      const values = emptyForm(instructors, role, user?.id);
      setForm(values);
      setBaseline(JSON.stringify(values));
    }
  }, [baseline, courseId, instructorQuery.data, instructors, role, user?.id]);

  const dirty = Boolean(baseline && JSON.stringify(form) !== baseline);
  const mutation = useMutation({
    mutationFn: () => {
      const payload = {
        ...form,
        plannedHours: Number(form.plannedHours),
        minimumAttendancePercent: Number(form.minimumAttendancePercent),
        description: form.description || null,
      };
      return api<{ course: Course }>(courseId ? `/courses/${courseId}` : '/courses', {
        method: courseId ? 'PATCH' : 'POST',
        body: JSON.stringify(payload),
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['courses'] });
      navigate(returnTo, { replace: true });
    },
    onError: (cause) => setError(cause instanceof ApiError ? cause.message : 'Course could not be saved.'),
  });
  const update = <K extends keyof CourseForm>(key: K, value: CourseForm[K]) => setForm((current) => ({ ...current, [key]: value }));
  const selectedCourse = courseQuery.data?.course;
  const pageTitle = courseId ? 'Edit course' : 'Create course';
  const backTo = returnTo || base;
  const invalidDateOrder = Boolean(form.startDate && form.endDate && form.endDate < form.startDate);
  const instructorChecks = instructors.map((instructor) => (
    <label key={instructor.id} className="course-instructor-option">
      <input type="checkbox" checked={form.instructorIds.includes(instructor.id)} disabled={role === 'INSTRUCTOR'}
        onChange={(event) => update('instructorIds', event.target.checked
          ? [...form.instructorIds, instructor.id]
          : form.instructorIds.filter((id) => id !== instructor.id))} />
      <span>{instructor.name}</span>
    </label>
  ));

  return (
    <div className="portal-layout">
      <PortalSidebar role={role} />
      <section className="portal-content">
        <PageHeader title={pageTitle} backTo={backTo} breadcrumbs={['Courses', selectedCourse?.title ?? pageTitle]} hasUnsavedChanges={dirty} />
        {courseQuery.isLoading && <p className="loading">Loading course…</p>}
        {(courseQuery.error || instructorQuery.error) && <p className="notice notice-error" role="alert">Course form data could not be loaded.</p>}
        {(instructorQuery.data || !courseId) && <form className="card course-editor course-form" onSubmit={(event) => { event.preventDefault(); setError(''); mutation.mutate(); }}>
          <div className="form-grid">
            <Field label="Course code" value={form.code} onChange={(event) => update('code', event.target.value.toUpperCase())} required maxLength={24} />
            <Field label="Course title" value={form.title} onChange={(event) => update('title', event.target.value)} required maxLength={160} />
            <Field label="Category" value={form.category} onChange={(event) => update('category', event.target.value)} required maxLength={100} />
            <Field label="Planned hours" type="number" min={1} value={form.plannedHours} onChange={(event) => update('plannedHours', event.target.value)} required />
            <Field label="Start date" type="date" value={form.startDate} onChange={(event) => update('startDate', event.target.value)} required />
            <Field label="End date" type="date" value={form.endDate} onChange={(event) => update('endDate', event.target.value)} required />
            <Field label="Minimum attendance (%)" type="number" min={0} max={100} value={form.minimumAttendancePercent} onChange={(event) => update('minimumAttendancePercent', event.target.value)} required />
          </div>
          <label className="field"><span>Description</span><textarea className="input textarea" value={form.description} onChange={(event) => update('description', event.target.value)} maxLength={5000} /></label>
          <label className="course-instructor-option"><input type="checkbox" checked={form.requiresAssessmentPass} onChange={(event) => update('requiresAssessmentPass', event.target.checked)} /><span>Require passing the course assessment for completion</span></label>
          <fieldset className="course-instructor-list"><legend>Assigned instructors</legend>{instructors.length ? instructorChecks : <p className="muted">No approved instructors are available.</p>}</fieldset>
          {invalidDateOrder && <p className="notice notice-error" role="alert">End date must be on or after the start date.</p>}
          {error && <p className="notice notice-error" role="alert">{error}</p>}
          <div className="row-actions">
            <Button type="submit" disabled={mutation.isPending || !form.instructorIds.length || invalidDateOrder}>{mutation.isPending ? 'Saving…' : courseId ? 'Save changes' : 'Create course'}</Button>
            <Button type="button" variant="secondary" onClick={() => {
              if (!dirty || window.confirm('Discard changes? You have unsaved changes.')) navigate(backTo);
            }} disabled={mutation.isPending}>Cancel</Button>
          </div>
        </form>}
      </section>
    </div>
  );
}
