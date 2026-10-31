import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '../components/ui/button';
import { Field } from '../components/field';
import { ApiError, api } from '../lib/api';

const courseSchema = z.object({ title: z.string().trim().min(3, 'Use at least 3 characters').max(160), description: z.string().max(5000).optional() });
type CourseForm = z.infer<typeof courseSchema>;
type Course = { id: string; title: string; description: string | null; status: 'DRAFT' | 'PUBLISHED'; updatedAt: string };

export function CoursesPage() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Course | null>(null);
  const form = useForm<CourseForm>({ resolver: zodResolver(courseSchema), defaultValues: { title: '', description: '' } });
  const query = useQuery({ queryKey: ['instructor-courses'], queryFn: () => api<{ courses: Course[] }>('/instructor/courses') });
  const save = useMutation({
    mutationFn: (values: CourseForm) => editing
      ? api(`/instructor/courses/${editing.id}`, { method: 'PATCH', body: JSON.stringify(values) })
      : api('/instructor/courses', { method: 'POST', body: JSON.stringify(values) }),
    onSuccess: async () => { setEditing(null); form.reset({ title: '', description: '' }); await queryClient.invalidateQueries({ queryKey: ['instructor-courses'] }); },
  });
  const action = useMutation({
    mutationFn: ({ courseId, method, actionName }: { courseId: string; method: 'POST' | 'DELETE'; actionName: 'publish' | 'unpublish' | 'delete' }) => api(`/instructor/courses/${courseId}${actionName === 'delete' ? '' : `/${actionName}`}`, { method, body: method === 'POST' ? JSON.stringify({}) : undefined }),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ['instructor-courses'] }); },
  });
  const courses = query.data?.courses ?? [];
  return (
    <section>
      <p className="eyebrow">INSTRUCTOR PORTAL</p><h1>Course studio</h1><p className="muted">Shape a course outline. Learning materials and lessons arrive in a later phase.</p>
      {(save.error || action.error || query.error) && <p className="notice notice-error" role="alert">{[save.error, action.error, query.error].find(Boolean) instanceof ApiError ? ([save.error, action.error, query.error].find(Boolean) as ApiError).message : 'Something went wrong. Please try again.'}</p>}
      <div className="course-layout">
        <form className="card course-editor" onSubmit={form.handleSubmit((values) => save.mutate(values))}>
          <div><p className="eyebrow">{editing ? 'EDIT DRAFT' : 'NEW COURSE'}</p><h2>{editing ? 'Refine your course' : 'Start with an idea'}</h2></div>
          <Field label="Course title" maxLength={160} {...form.register('title')} error={form.formState.errors.title?.message} />
          <label className="field"><span>Description (optional)</span><textarea className="input textarea" maxLength={5000} {...form.register('description')} /></label>
          <div className="row-actions"><Button type="submit" disabled={save.isPending}>{save.isPending ? 'Saving…' : editing ? 'Save changes' : 'Create draft'}</Button>{editing && <Button type="button" variant="secondary" onClick={() => { setEditing(null); form.reset({ title: '', description: '' }); }}>Cancel</Button>}</div>
        </form>
        <div className="course-list">
          <div className="list-heading"><h2>Your courses</h2><span>{courses.length}</span></div>
          {query.isLoading ? <p className="loading">Loading courses…</p> : courses.length === 0 ? <div className="card empty-state"><h2>No courses yet.</h2><p>Create a draft to begin.</p></div> : courses.map((course) => <article className="card course-card" key={course.id}>
            <div className="course-meta"><span className={`status-pill status-${course.status.toLowerCase()}`}>{course.status}</span><span className="muted">Updated {new Date(course.updatedAt).toLocaleDateString()}</span></div>
            <h3>{course.title}</h3><p className="muted course-description">{course.description || 'No description yet.'}</p>
            <div className="course-actions">{course.status === 'DRAFT' && <Button variant="ghost" onClick={() => { setEditing(course); form.reset({ title: course.title, description: course.description ?? '' }); }}>Edit</Button>}<Button variant="secondary" disabled={action.isPending} onClick={() => action.mutate({ courseId: course.id, method: 'POST', actionName: course.status === 'DRAFT' ? 'publish' : 'unpublish' })}>{course.status === 'DRAFT' ? 'Publish' : 'Unpublish'}</Button>{course.status === 'DRAFT' && <Button variant="danger" disabled={action.isPending} onClick={() => action.mutate({ courseId: course.id, method: 'DELETE', actionName: 'delete' })}>Delete</Button>}</div>
          </article>)}
        </div>
      </div>
    </section>
  );
}
