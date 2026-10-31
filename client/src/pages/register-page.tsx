import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router-dom';
import { z } from 'zod';
import { Field } from '../components/field';
import { Button } from '../components/ui/button';
import { api, ApiError } from '../lib/api';

const schema = z.object({ studentId: z.string().trim().min(1, 'Enter your Student ID'), name: z.string().trim().min(2, 'Enter your name'), email: z.email('Enter a valid email'), password: z.string().min(8, 'Use at least 8 characters') });
type FormValues = z.infer<typeof schema>;

export function RegisterPage() {
  const [submitted, setSubmitted] = useState(false);
  const form = useForm<FormValues>({ resolver: zodResolver(schema) });
  const mutation = useMutation({ mutationFn: (values: FormValues) => api('/auth/students/register', { method: 'POST', body: JSON.stringify(values) }), onSuccess: () => setSubmitted(true) });
  if (submitted) return <section className="narrow-card card"><p className="eyebrow">REGISTRATION RECEIVED</p><h1>One step at a time.</h1><p className="muted">Your account is pending instructor approval. You’ll be able to sign in after it is approved.</p><Link className="text-link" to="/student/login">Return to student sign in</Link></section>;
  return (
    <section className="narrow-card card">
      <p className="eyebrow">STUDENT PORTAL</p><h1>Create your account</h1><p className="muted">An instructor must approve your registration before you can sign in.</p>
      <form className="form-stack" onSubmit={form.handleSubmit((values) => mutation.mutate(values))}>
        <Field label="Student ID" autoComplete="username" {...form.register('studentId')} error={form.formState.errors.studentId?.message} />
        <Field label="Full name" autoComplete="name" {...form.register('name')} error={form.formState.errors.name?.message} />
        <Field label="Email address" type="email" autoComplete="email" {...form.register('email')} error={form.formState.errors.email?.message} />
        <Field label="Password" type="password" autoComplete="new-password" {...form.register('password')} error={form.formState.errors.password?.message} />
        {mutation.error && <p className="notice notice-error" role="alert">{mutation.error instanceof ApiError ? mutation.error.message : 'Registration failed. Please try again.'}</p>}
        <Button type="submit" disabled={mutation.isPending}>{mutation.isPending ? 'Submitting…' : 'Submit registration'}</Button>
      </form>
      <p className="form-foot">Already registered? <Link to="/student/login">Sign in</Link></p>
    </section>
  );
}
