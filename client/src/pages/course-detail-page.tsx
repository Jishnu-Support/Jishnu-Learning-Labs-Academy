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

function courseListPath(role: Role) {
  return role === 'ORG_ADMIN' ? '/org-admin/courses' : '/instructor/courses';
}

function safeReturnTo(value: string | null, base: string) {
  return value && !value.startsWith('//') && (value === base || value.startsWith(`${base}?`)) ? value : base;
}

function notesPath(role: Role) {
  return role === 'ORG_ADMIN' ? '/org-admin/notes' : '/instructor/notes';
}

export function CourseDetailPage() {
  const { user } = useAuth();
  const role = user?.role === 'ORG_ADMIN' ? 'ORG_ADMIN' : 'INSTRUCTOR';
  const base = courseListPath(role);
  const { courseId = '' } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const returnTo = safeReturnTo(searchParams.get('returnTo'), base);
  const studentSearch = searchParams.get('studentSearch') ?? '';
  const [topicTitle, setTopicTitle] = useState('');
  const [topicHours, setTopicHours] = useState('');
  const [error, setError] = useState('');
  const courseQuery = useQuery({
    queryKey: ['course', courseId],
    queryFn: () => api<{ course: Course }>(`/courses/${courseId}`),
    enabled: Boolean(courseId),
  });
  const enrollmentQuery = useQuery({
    queryKey: ['course-enrollments', courseId, studentSearch],
    queryFn: () => api<{ enrollments: Enrollment[] }>(`/courses/${courseId}/enrollments?${new URLSearchParams(studentSearch ? { search: studentSearch } : {})}`),
    enabled: Boolean(courseId),
  });
  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['course', courseId] }),
      queryClient.invalidateQueries({ queryKey: ['courses'] }),
      queryClient.invalidateQueries({ queryKey: ['course-enrollments', courseId] }),
    ]);
  };
  const topicMutation = useMutation({
    mutationFn: () => api(`/courses/${courseId}/topics`, {
      method: 'POST',
      body: JSON.stringify({ title: topicTitle, plannedHours: Number(topicHours) }),
    }),
    onSuccess: async () => { setTopicTitle(''); setTopicHours(''); setError(''); await invalidate(); },
    onError: (cause) => setError(cause instanceof ApiError ? cause.message : 'Topic could not be added.'),
  });
  const reorderMutation = useMutation({
    mutationFn: (topicIds: string[]) => api(`/courses/${courseId}/topics/reorder`, { method: 'PATCH', body: JSON.stringify({ topicIds }) }),
    onSuccess: invalidate,
    onError: (cause) => setError(cause instanceof ApiError ? cause.message : 'Topic order could not be changed.'),
  });
  const coverMutation = useMutation({
    mutationFn: ({ topic, covered }: { topic: Topic; covered: boolean }) => api(`/courses/${courseId}/topics/${topic.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ covered }),
    }),
    onSuccess: invalidate,
    onError: (cause) => setError(cause instanceof ApiError ? cause.message : 'Topic progress could not be updated.'),
  });
  const statusMutation = useMutation({
    mutationFn: (action: 'publish' | 'archive') => api(`/courses/${courseId}/${action}`, { method: 'POST' }),
    onSuccess: async (_result, action) => {
      await invalidate();
      if (action === 'archive') navigate(returnTo, { replace: true });
    },
    onError: (cause) => setError(cause instanceof ApiError ? cause.message : 'Course status could not be changed.'),
  });
  const approvalMutation = useMutation({
    mutationFn: (enrollmentId: string) => api(`/courses/${courseId}/enrollments/${enrollmentId}/approve`, { method: 'POST' }),
    onSuccess: invalidate,
    onError: (cause) => setError(cause instanceof ApiError ? cause.message : 'Enrollment could not be approved.'),
  });
  const course = courseQuery.data?.course;
  const topics = course?.topics ?? [];
  const coveredCount = topics.filter((topic) => topic.covered).length;
  const progress = topics.length ? Math.round((coveredCount / topics.length) * 100) : 0;
  const roleNotes = course ? `${notesPath(role)}?courseId=${encodeURIComponent(course.id)}` : notesPath(role);

  const moveTopic = (index: number, direction: -1 | 1) => {
    const next = [...topics];
    const destination = index + direction;
    if (destination < 0 || destination >= next.length) return;
    [next[index], next[destination]] = [next[destination], next[index]];
    reorderMutation.mutate(next.map(({ id }) => id));
  };

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
              <span><strong>Instructors</strong>{course.instructors.map(({ instructor }) => instructor.name).join(', ')}</span>
            </div>
            <div className="course-actions">
              {course.status !== 'ARCHIVED' && <Link className="button button-secondary" to={`${base}/${course.id}/edit?returnTo=${encodeURIComponent(returnTo)}`}>Edit course</Link>}
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
            <div className="list-heading"><h2>Linked notes</h2><Link className="text-link" to={roleNotes}>Open notes</Link></div>
            {course.notes.length === 0 ? <p className="muted">No notes are linked to this course.</p> : course.notes.map((note) => (
              <Link className="linked-course-note" key={note.id} to={`${notesPath(role)}?view=${encodeURIComponent(note.id)}`}>
                <span><strong>{note.title}</strong><small>{note.subject}</small></span>
                <span className={`status-pill ${note.published ? 'status-published' : 'status-draft'}`}>{note.published ? 'PUBLISHED' : 'DRAFT'}</span>
              </Link>
            ))}
          </section>
          {error && <p className="notice notice-error" role="alert">{error}</p>}
        </>}
      </section>
    </div>
  );
}
