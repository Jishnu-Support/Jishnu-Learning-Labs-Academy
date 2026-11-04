import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router-dom';
import { z } from 'zod';
import { Field } from '../components/field';
import { PageHeader } from '../components/page-header';
import { Button } from '../components/ui/button';
import { api, ApiError } from '../lib/api';
import type { Role } from '../types';

const schema = z.object({
  organizationCode: z.string().trim().min(1, 'Enter your organization code'),
  studentId: z.string().trim().optional(),
  tutorId: z.string().trim().optional(),
  name: z.string().trim().min(2, 'Enter your name'),
  email: z.string().trim().email('Enter a valid email address'),
  phone: z.string().trim().min(7, 'Enter a valid contact number'),
  password: z.string().min(8, 'Use at least 8 characters'),
});
type FormValues = z.infer<typeof schema>;
type Props = { role: Extract<Role, 'STUDENT' | 'TUTOR'> };

const roleDetails = {
  STUDENT: { title: 'Student', endpoint: '/auth/students/register', login: '/student/login', approvalActor: 'A Tutor', approval: 'Tutor' },
  TUTOR: { title: 'Tutor', endpoint: '/auth/tutors/register', login: '/tutor/login', approvalActor: 'An Org Admin', approval: 'Org Admin' },
} as const;

export function RegisterPage({ role }: Props) {
  const details = roleDetails[role];
  const [submitted, setSubmitted] = useState(false);
  const form = useForm<FormValues>({
    resolver: zodResolver(schema.superRefine((values, context) => {
      if (role === 'STUDENT' && !values.studentId?.trim()) context.addIssue({ code: 'custom', path: ['studentId'], message: 'Enter your Student ID' });
      if (role === 'TUTOR' && !values.tutorId?.trim()) context.addIssue({ code: 'custom', path: ['tutorId'], message: 'Enter your Tutor ID' });
    })),
    defaultValues: { organizationCode: '', studentId: '', tutorId: '', name: '', email: '', phone: '', password: '' },
  });
  const mutation = useMutation({
    mutationFn: (values: FormValues) => {
      const body = {
        organizationCode: values.organizationCode,
        name: values.name,
        email: values.email,
        phone: values.phone,
        password: values.password,
        ...(role === 'STUDENT' ? { studentId: values.studentId } : {}),
        ...(role === 'TUTOR' ? { tutorId: values.tutorId } : {}),
      };
      return api(details.endpoint, { method: 'POST', body: JSON.stringify(body) });
    },
    onSuccess: () => setSubmitted(true),
  });
  if (submitted) {
    return (
      <section className="narrow-card card">
        <p className="eyebrow">REGISTRATION RECEIVED</p>
        <PageHeader title="Registration received" backTo="/organizations/register" breadcrumbs={['Register', 'Confirmation']} />
        <p className="muted">Your account is pending {details.approval} approval. You’ll be able to sign in after it is approved.</p>
        <Link className="text-link" to={details.login}>Return to {details.title.toLowerCase()} sign in</Link>
      </section>
    );
  }
  return (
    <section className="narrow-card card">
      <p className="eyebrow">{details.title.toUpperCase()} PORTAL</p>
      <PageHeader title="Create your account" backTo="/organizations/register" breadcrumbs={[details.title, 'Register']} hasUnsavedChanges={form.formState.isDirty} />
      <p className="muted">{details.approvalActor} must approve your registration before you can sign in.</p>
      <form className="form-stack" onSubmit={form.handleSubmit((values) => mutation.mutate(values))}>
        <Field label="Organization Code" autoComplete="organization" {...form.register('organizationCode')} error={form.formState.errors.organizationCode?.message} />
        {role === 'STUDENT' && <Field label="Student ID" autoComplete="username" {...form.register('studentId')} error={form.formState.errors.studentId?.message} />}
        {role === 'TUTOR' && <Field label="Tutor ID" autoComplete="username" {...form.register('tutorId')} error={form.formState.errors.tutorId?.message} />}
        <Field label="Full name" autoComplete="name" {...form.register('name')} error={form.formState.errors.name?.message} />
        <Field label="Email address" type="email" autoComplete="email" {...form.register('email')} error={form.formState.errors.email?.message} />
        <Field label="Contact number" type="tel" autoComplete="tel" {...form.register('phone')} error={form.formState.errors.phone?.message} />
        <Field label="Password" type="password" autoComplete="new-password" {...form.register('password')} error={form.formState.errors.password?.message} />
        {mutation.error && <p className="notice notice-error" role="alert">{mutation.error instanceof ApiError ? mutation.error.message : 'Registration failed. Please try again.'}</p>}
        <Button type="submit" disabled={mutation.isPending}>{mutation.isPending ? 'Submitting…' : 'Submit registration'}</Button>
      </form>
      <p className="form-foot">Already registered? <Link to={details.login}>Sign in</Link></p>
    </section>
  );
}
