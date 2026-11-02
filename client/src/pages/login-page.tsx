import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { Field } from '../components/field';
import { Button } from '../components/ui/button';
import { api, ApiError } from '../lib/api';
import type { Role } from '../types';

const loginSchema = z.object({
  organizationCode: z.string().optional(),
  identifier: z.string().optional(),
  password: z.string().min(1, 'Enter your password'),
});
type Portal = 'student' | 'instructor' | 'staff' | 'org-admin' | 'super-admin';
type Props = { portal: Portal };

const portalDetails: Record<Portal, {
  title: string;
  subtitle: string;
  endpoint: string;
  role: Role;
  identifierLabel: string;
  registration?: string;
}> = {
  student: {
    title: 'Your learning starts here.',
    subtitle: 'Sign in with your Student ID and organization code.',
    endpoint: '/auth/students/login',
    role: 'STUDENT',
    identifierLabel: 'Student ID',
    registration: '/student/register',
  },
  instructor: {
    title: 'Guide the next generation.',
    subtitle: 'Sign in with your organization code and email.',
    endpoint: '/auth/instructors/login',
    role: 'INSTRUCTOR',
    identifierLabel: 'Email address',
    registration: '/instructor/register',
  },
  staff: {
    title: 'Welcome to your organization.',
    subtitle: 'Sign in with your organization code and Staff ID or email.',
    endpoint: '/auth/staff/login',
    role: 'STAFF',
    identifierLabel: 'Staff ID or email',
    registration: '/staff/register',
  },
  'org-admin': {
    title: 'Manage your organization.',
    subtitle: 'Sign in with your organization code and email.',
    endpoint: '/auth/org-admin/login',
    role: 'ORG_ADMIN',
    identifierLabel: 'Email address',
  },
  'super-admin': {
    title: 'Platform administration.',
    subtitle: 'Sign in with your Super Admin email.',
    endpoint: '/auth/super-admin/login',
    role: 'SUPER_ADMIN',
    identifierLabel: 'Email address',
  },
};

function routeForRole(role: Role): string {
  if (role === 'SUPER_ADMIN') return '/super-admin/dashboard';
  if (role === 'ORG_ADMIN') return '/org-admin';
  return `/${role.toLowerCase()}`;
}

export function LoginPage({ portal }: Props) {
  const details = portalDetails[portal];
  const form = useForm<z.infer<typeof loginSchema>>({
    resolver: zodResolver(loginSchema.superRefine((values, context) => {
      if (portal !== 'super-admin' && !values.organizationCode?.trim()) {
        context.addIssue({ code: 'custom', path: ['organizationCode'], message: 'Enter your organization code' });
      }
      if (!values.identifier?.trim()) {
        context.addIssue({ code: 'custom', path: ['identifier'], message: `Enter your ${details.identifierLabel.toLowerCase()}` });
      } else if (['instructor', 'org-admin', 'super-admin'].includes(portal) && !z.string().email().safeParse(values.identifier).success) {
        context.addIssue({ code: 'custom', path: ['identifier'], message: 'Enter a valid email address' });
      }
    })),
    defaultValues: { organizationCode: '', identifier: '', password: '' },
  });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (values: z.infer<typeof loginSchema>) => {
      const body: Record<string, string> = { password: values.password };
      if (portal !== 'super-admin' && values.organizationCode) body.organizationCode = values.organizationCode;
      if (portal === 'student' && values.identifier) body.studentId = values.identifier;
      else if (portal === 'staff' && values.identifier) body.identifier = values.identifier;
      else if (values.identifier) body.email = values.identifier;
      return api<{ user: { role: Role; mustChangePassword: boolean } }>(details.endpoint, { method: 'POST', body: JSON.stringify(body) });
    },
    onSuccess: async (data) => {
      await queryClient.invalidateQueries({ queryKey: ['me'] });
      navigate(data.user.mustChangePassword ? '/change-password' : routeForRole(data.user.role));
    },
  });
  const submit = form.handleSubmit((values) => mutation.mutate(values));
  return (
    <section className="auth-layout">
      <div className="auth-story">
        <p className="eyebrow">JISHNU LEARNING LABS</p>
        <h1>{details.title}</h1>
        <p>{details.subtitle}</p>
        <div className="story-rule" />
        <p className="story-note">A focused place to learn, practice, and move forward.</p>
      </div>
      <form className="card auth-card" onSubmit={submit}>
        <div><p className="eyebrow">{portal.toUpperCase().replace('-', ' ')} PORTAL</p><h2>Sign in</h2></div>
        {portal !== 'super-admin' && (
          <Field label="Organization Code" autoComplete="organization" {...form.register('organizationCode')} error={form.formState.errors.organizationCode?.message} />
        )}
        <Field
          label={details.identifierLabel}
          type={['instructor', 'org-admin', 'super-admin'].includes(portal) ? 'email' : 'text'}
          autoComplete="username"
          {...form.register('identifier')}
          error={form.formState.errors.identifier?.message}
        />
        <Field label="Password" type="password" autoComplete="current-password" {...form.register('password')} error={form.formState.errors.password?.message} />
        {mutation.error && <p className="notice notice-error" role="alert">{mutation.error instanceof ApiError ? mutation.error.message : 'Unable to sign in. Please try again.'}</p>}
        <Button type="submit" disabled={mutation.isPending}>{mutation.isPending ? 'Signing in…' : 'Sign in'}</Button>
        {details.registration && <p className="form-foot">New to the organization? <Link to={details.registration}>Register as {portal}</Link></p>}
        <p className="form-foot"><Link to="/organizations/register">Register an organization</Link></p>
        <div className="portal-links">
          <Link to="/student/login">Student</Link>
          <Link to="/instructor/login">Instructor</Link>
          <Link to="/staff/login">Staff</Link>
          <Link to="/org-admin/login">Org Admin</Link>
          <Link to="/super-admin/login">Super Admin</Link>
        </div>
      </form>
    </section>
  );
}
