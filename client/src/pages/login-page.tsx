import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { Field } from '../components/field';
import { Button } from '../components/ui/button';
import { api, ApiError } from '../lib/api';
import type { Role } from '../types';

const loginSchema = z.object({ studentId: z.string().optional(), email: z.string().optional(), password: z.string().min(1, 'Enter your password') });
type Props = { portal: 'student' | 'instructor' | 'staff' };

const portalDetails = {
  student: { title: 'Your learning starts here.', subtitle: 'Sign in with your Student ID.', endpoint: '/auth/students/login', role: 'STUDENT' as Role },
  instructor: { title: 'Guide the next generation.', subtitle: 'Sign in to manage your students.', endpoint: '/auth/instructors/login', role: 'INSTRUCTOR' as Role },
  staff: { title: 'Welcome back to the academy.', subtitle: 'Staff and Super Admin sign in here.', endpoint: '/auth/staff/login', role: 'STAFF' as Role },
};

export function LoginPage({ portal }: Props) {
  const details = portalDetails[portal];
  const form = useForm<z.infer<typeof loginSchema>>({
    resolver: zodResolver(loginSchema.superRefine((values, context) => {
      if (portal === 'student' && !values.studentId?.trim()) context.addIssue({ code: 'custom', path: ['studentId'], message: 'Enter your Student ID' });
      if (portal !== 'student' && (!values.email || !z.email().safeParse(values.email).success)) context.addIssue({ code: 'custom', path: ['email'], message: 'Enter a valid email' });
    })),
    defaultValues: { password: '' },
  });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (values: Record<string, string>) => api<{ user: { role: Role } }>(details.endpoint, { method: 'POST', body: JSON.stringify(values) }),
    onSuccess: async (data) => {
      await queryClient.invalidateQueries({ queryKey: ['me'] });
      navigate(data.user.role === 'INSTRUCTOR' ? '/instructor' : data.user.role === 'STUDENT' ? '/student' : '/staff');
    },
  });
  const submit = form.handleSubmit((values) => {
    const payload: Record<string, string> = { password: values.password };
    if (portal === 'student' && values.studentId) payload.studentId = values.studentId;
    if (portal !== 'student' && values.email) payload.email = values.email;
    mutation.mutate(payload);
  });
  const isStudent = portal === 'student';
  return (
    <section className="auth-layout">
      <div className="auth-story"><p className="eyebrow">JISHNU LEARNING LABS ACADEMY</p><h1>{details.title}</h1><p>{details.subtitle}</p><div className="story-rule" /><p className="story-note">A focused place to learn, practice, and move forward.</p></div>
      <form className="card auth-card" onSubmit={submit}>
        <div><p className="eyebrow">{portal.toUpperCase()} PORTAL</p><h2>Sign in</h2></div>
        {isStudent ? <Field label="Student ID" autoComplete="username" {...form.register('studentId')} error={form.formState.errors.studentId?.message} /> : <Field label="Email address" type="email" autoComplete="username" {...form.register('email')} error={form.formState.errors.email?.message} />}
        <Field label="Password" type="password" autoComplete="current-password" {...form.register('password')} error={form.formState.errors.password?.message} />
        {mutation.error && <p className="notice notice-error" role="alert">{mutation.error instanceof ApiError ? mutation.error.message : 'Unable to sign in. Please try again.'}</p>}
        <Button type="submit" disabled={mutation.isPending}>{mutation.isPending ? 'Signing in…' : 'Sign in'}</Button>
        {isStudent && <p className="form-foot">New to the academy? <Link to="/student/register">Create a student account</Link></p>}
        <div className="portal-links"><Link to="/instructor/login">Instructor</Link><Link to="/staff/login">Staff</Link></div>
      </form>
    </section>
  );
}
