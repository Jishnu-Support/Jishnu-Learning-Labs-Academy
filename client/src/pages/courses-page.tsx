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
  organization: { currency: string };
  code: string;
  title: string;
  description: string | null;
  thumbnailUrl: string | null;
  category: string;
  plannedHours: number;
  registrationMonthlyFee: number | string | null;
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
  thumbnailUrl: string;
  category: string;
  plannedHours: string;
  registrationMonthlyFee: string;
  startDate: string;
  endDate: string;
  minimumAttendancePercent: string;
  requiresAssessmentPass: boolean;
  instructorIds: string[];
};
const noInstructors: Instructor[] = [];

function routeForRole(role: Role) {
  return role === 'ORG_ADMIN' ? '/org-admin/courses' : '/tutor/courses';
}

function safeReturnTo(value: string | null, base: string) {
  if (value && !value.startsWith('//') && (value === base || value.startsWith(`${base}?`))) return value;
  return base;
}

function roleDashboard(role: Role) {
  return role === 'ORG_ADMIN' ? '/org-admin' : role === 'SUPER_ADMIN' ? '/super-admin/organizations' : '/tutor';
}

function emptyForm(instructors: Instructor[], role: Role, userId?: string): CourseForm {
  return {
    code: '',
    title: '',
    description: '',
    thumbnailUrl: '',
    category: '',
    plannedHours: '',
    registrationMonthlyFee: '',
    startDate: '',
    endDate: '',
    minimumAttendancePercent: '75',
    requiresAssessmentPass: true,
    instructorIds: role === 'TUTOR' && userId ? [userId] : instructors.slice(0, 1).map(({ id }) => id),
  };
}

export function CoursesPage() {
  const { user } = useAuth();
  const role: Role = user?.role === 'SUPER_ADMIN' ? 'SUPER_ADMIN' : user?.role === 'ORG_ADMIN' ? 'ORG_ADMIN' : 'TUTOR';
  const { organizationId } = useParams();
  const base = role === 'SUPER_ADMIN'
    ? `/super-admin/organizations/${encodeURIComponent(organizationId ?? '')}/courses`
    : routeForRole(role);
  const apiBase = role === 'SUPER_ADMIN' ? base : '/courses';
  const [searchParams, setSearchParams] = useSearchParams();
  const search = searchParams.get('search') ?? '';
  const status = searchParams.get('status') ?? '';
  const page = Math.max(1, Number(searchParams.get('page') ?? 1) || 1);
  const query = useQuery({
    queryKey: ['courses', role, search, status],
    queryFn: () => api<{ courses: Course[] }>(`${apiBase}?${new URLSearchParams({ ...(search ? { search } : {}), ...(status ? { status } : {}) })}`),
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
        <p className="muted">Build course outlines, assign faculty, and track topic delivery.</p>
        <div className="directory-filters">
          <label className="field search-field"><span>Search courses</span><input className="input" value={search} onChange={(event) => updateQuery('search', event.target.value)} /></label>
          <label className="field"><span>Status</span><select className="input" value={status} onChange={(event) => updateQuery('status', event.target.value)}><option value="">All statuses</option><option value="DRAFT">Draft</option><option value="PUBLISHED">Published</option><option value="ARCHIVED">Archived</option></select></label>
          {(role === 'ORG_ADMIN' || role === 'SUPER_ADMIN') && <Link className="button button-primary" to={`${base}/new?returnTo=${encodeURIComponent(`${base}${window.location.search}`)}`}>Create course</Link>}
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
              {(role === 'ORG_ADMIN' || role === 'SUPER_ADMIN') && <p className="muted course-description">First-month registration fee: {course.registrationMonthlyFee === null ? 'Not set' : new Intl.NumberFormat(undefined, { style: 'currency', currency: course.organization.currency }).format(Number(course.registrationMonthlyFee))}</p>}
              <p className="course-description">{course.description || 'No description yet.'}</p>
              <p className="muted course-description">Faculty: {course.instructors.map(({ instructor }) => instructor.name).join(', ') || 'None'} · {course._count.enrollments} enrollments · {course._count.notes} notes</p>
              <div className="course-actions">
                <Link className="button button-secondary" to={`${base}/${course.id}?returnTo=${encodeURIComponent(`${base}${window.location.search}`)}`}>Manage course</Link>
                {course.status !== 'ARCHIVED' && (role === 'ORG_ADMIN' || role === 'SUPER_ADMIN') && <Link className="button button-ghost" to={`${base}/${course.id}/edit?returnTo=${encodeURIComponent(`${base}${window.location.search}`)}`}>Edit</Link>}
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
  const role: Role = user?.role === 'SUPER_ADMIN' ? 'SUPER_ADMIN' : user?.role === 'ORG_ADMIN' ? 'ORG_ADMIN' : 'TUTOR';
  const navigate = useNavigate();
  const params = useParams();
  const [searchParams] = useSearchParams();
  const organizationId = params.organizationId;
  const apiBase = role === 'SUPER_ADMIN'
    ? `/super-admin/organizations/${encodeURIComponent(organizationId ?? '')}/courses`
    : '/courses';
  const base = role === 'SUPER_ADMIN'
    ? `/super-admin/organizations/${encodeURIComponent(organizationId ?? '')}/courses`
    : routeForRole(role);
  const courseId = params.courseId;
  const returnTo = safeReturnTo(searchParams.get('returnTo'), base);
  const instructorQuery = useQuery({ queryKey: ['course-faculty', role, organizationId], queryFn: () => api<{ instructors: Instructor[] }>(`${apiBase}/faculty`) });
  const courseQuery = useQuery({
    queryKey: ['course', courseId, role, organizationId],
    queryFn: () => api<{ course: Course }>(`${apiBase}/${courseId}`),
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
        thumbnailUrl: course.thumbnailUrl ?? '',
        category: course.category,
        plannedHours: String(course.plannedHours),
        registrationMonthlyFee: course.registrationMonthlyFee === null ? '' : String(course.registrationMonthlyFee),
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
        thumbnailUrl: form.thumbnailUrl || null,
        ...(role === 'ORG_ADMIN' || role === 'SUPER_ADMIN'
          ? { registrationMonthlyFee: form.registrationMonthlyFee.trim() ? Number(form.registrationMonthlyFee) : null }
          : {}),
      };
      return api<{ course: Course }>(courseId ? `${apiBase}/${courseId}` : apiBase, {
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
      <input type="checkbox" checked={form.instructorIds.includes(instructor.id)} disabled={role === 'TUTOR'}
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
            {(role === 'ORG_ADMIN' || role === 'SUPER_ADMIN') && <Field label="First-month registration fee (organization currency)" type="number" min={0.01} step="0.01" value={form.registrationMonthlyFee} onChange={(event) => update('registrationMonthlyFee', event.target.value)} />}
          </div>
          {(role === 'ORG_ADMIN' || role === 'SUPER_ADMIN') && <p className="muted">This fee is collected for the registration period only. Future renewals continue through Pay My Fee using the selected Tutor’s plan.</p>}
          <label className="field"><span>Description</span><textarea className="input textarea" value={form.description} onChange={(event) => update('description', event.target.value)} maxLength={5000} /></label>
          <Field label="Course thumbnail URL (HTTPS)" type="url" value={form.thumbnailUrl} onChange={(event) => update('thumbnailUrl', event.target.value)} maxLength={2000} />
          <label className="course-instructor-option"><input type="checkbox" checked={form.requiresAssessmentPass} onChange={(event) => update('requiresAssessmentPass', event.target.checked)} /><span>Require passing the course assessment for completion</span></label>
          <fieldset className="course-instructor-list"><legend>Course faculty</legend>{instructors.length ? instructorChecks : <p className="muted">No approved Tutors are available.</p>}</fieldset>
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
