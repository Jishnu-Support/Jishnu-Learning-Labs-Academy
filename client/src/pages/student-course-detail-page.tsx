import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ConfirmDialog } from '../components/feedback';
import { PageHeader } from '../components/page-header';
import { PortalSidebar } from '../components/portal-sidebar';
import { Button } from '../components/ui/button';
import { ApiError, api } from '../lib/api';

type Course = {
  id: string;
  code: string;
  title: string;
  description: string | null;
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
  assessments: Array<{ id: string; title: string; instructions: string; totalMarks: number; passMark: number; durationMinutes: number }>;
};

function safeReturnTo(value: string | null) {
  const base = '/student/courses';
  return value && !value.startsWith('//') && (value === base || value.startsWith(`${base}?`)) ? value : `${base}?tab=browse`;
}

export function StudentCourseDetailPage() {
  const { courseId = '' } = useParams();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const returnTo = safeReturnTo(searchParams.get('returnTo'));
  const [confirmDrop, setConfirmDrop] = useState(false);
  const query = useQuery({
    queryKey: ['student-course', courseId],
    queryFn: () => api<{ course: Course }>(`/student/courses/${courseId}`),
    enabled: Boolean(courseId),
  });
  const mutation = useMutation({
    mutationFn: (action: 'enroll' | 'drop') => api(`/student/courses/${courseId}/${action}`, { method: 'POST' }),
    onSuccess: async () => {
      setConfirmDrop(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['student-course', courseId] }),
        queryClient.invalidateQueries({ queryKey: ['student-course-browse'] }),
        queryClient.invalidateQueries({ queryKey: ['student-courses-enrolled'] }),
      ]);
    },
  });
  const course = query.data?.course;
  const enrollment = course?.enrollments[0];
  const notesPath = (noteId: string) => `/student/notes?view=${encodeURIComponent(noteId)}`;

  return (
    <div className="portal-layout">
      <PortalSidebar role="STUDENT" />
      <section className="portal-content">
        <PageHeader title={course?.title ?? 'Course details'} backTo={returnTo} breadcrumbs={['Dashboard', 'My Courses', course?.code ?? 'Course']} />
        {query.isLoading && <p className="loading">Loading course…</p>}
        {query.error && <p className="notice notice-error" role="alert">{query.error instanceof ApiError ? query.error.message : 'Course could not be loaded.'}</p>}
        {course && <>
          <div className="card course-detail-summary">
            <div className="course-meta"><span>{course.code}</span><span>{course.category}</span></div>
            <p>{course.description || 'No description provided.'}</p>
            <div className="course-facts">
              <span><strong>Planned learning</strong>{course.plannedHours} hours</span>
              <span><strong>Start date</strong>{new Date(course.startDate).toLocaleDateString()}</span>
              <span><strong>End date</strong>{new Date(course.endDate).toLocaleDateString()}</span>
              <span><strong>Instructor{course.instructors.length === 1 ? '' : 's'}</strong>{course.instructors.map(({ instructor }) => instructor.name).join(', ')}</span>
              <span><strong>Minimum attendance</strong>{course.minimumAttendancePercent}%</span>
              <span><strong>Assessment pass required</strong>{course.requiresAssessmentPass ? 'Yes' : 'No'}</span>
            </div>
            <div className="course-actions">
              {enrollment?.status === 'ACTIVE' && <Button variant="danger" onClick={() => setConfirmDrop(true)}>Drop course</Button>}
              {enrollment?.status === 'PENDING' && <span className="status-pill status-pending">ENROLLMENT PENDING</span>}
              {!enrollment && <Button disabled={mutation.isPending} onClick={() => mutation.mutate('enroll')}>{mutation.isPending ? 'Enrolling…' : 'Enroll in course'}</Button>}
            </div>
          </div>
          <section className="card course-section">
            <div className="list-heading"><h2>Course progress</h2><strong>{course.progressPercent}%</strong></div>
            <progress className="course-progress" max={100} value={course.progressPercent}>{course.progressPercent}%</progress>
            {course.topics.length === 0 ? <p className="muted">Topics have not been added yet.</p> : <ol className="course-topics student-topics">
              {course.topics.map((topic, index) => <li key={topic.id} className={topic.covered ? 'topic-covered' : ''}>
                <span className="topic-index">{index + 1}</span>
                <div className="topic-main"><strong>{topic.title}</strong><span className="muted">{topic.plannedHours} hours</span></div>
                <span className={`status-pill ${topic.covered ? 'status-published' : 'status-draft'}`}>{topic.covered ? 'COVERED' : 'NOT COVERED'}</span>
              </li>)}
            </ol>}
          </section>
          <section className="card course-section">
            <div className="list-heading"><h2>Course notes</h2><Link className="text-link" to="/student/notes">Open notes</Link></div>
            {course.notes.length === 0 ? <p className="muted">No published notes are linked to this course yet.</p> : course.notes.map((note) => (
              <Link className="linked-course-note" key={note.id} to={notesPath(note.id)}>
                <span><strong>{note.title}</strong><small>{note.subject}</small></span><span aria-label="Published note">Open</span>
              </Link>
            ))}
          </section>
          {course.assessments.length > 0 && <section className="card course-section">
            <h2>Published assessments</h2>
            <p className="muted">Assessment attempts will be available in a later learning module.</p>
            {course.assessments.map((assessment) => <div className="linked-course-note" key={assessment.id}>
              <span><strong>{assessment.title}</strong><small>{assessment.totalMarks} marks · pass mark {assessment.passMark} · {assessment.durationMinutes} minutes</small></span>
            </div>)}
          </section>}
          {mutation.error && <p className="notice notice-error" role="alert">{mutation.error instanceof ApiError ? mutation.error.message : 'Course enrollment could not be changed.'}</p>}
        </>}
        {confirmDrop && course && <ConfirmDialog
          title="Drop this course?"
          message={`You will lose access to this course in your active list. Your progress record will remain. Are you sure you want to drop ${course.title}?`}
          confirmLabel="Drop course"
          onCancel={() => setConfirmDrop(false)}
          onConfirm={() => mutation.mutate('drop')}
        />}
      </section>
    </div>
  );
}
