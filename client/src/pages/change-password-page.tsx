import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { useAuth } from '../auth/auth-context';
import { Field } from '../components/field';
import { PageHeader } from '../components/page-header';
import { Button } from '../components/ui/button';
import { api, ApiError } from '../lib/api';

const schema = z.object({
  currentPassword: z.string().min(1, 'Enter your temporary password'),
  newPassword: z.string().min(8, 'Use at least 8 characters').max(128),
  confirmPassword: z.string().min(1, 'Confirm your new password'),
}).refine((value) => value.newPassword === value.confirmPassword, {
  path: ['confirmPassword'],
  message: 'Passwords do not match',
});

export function ChangePasswordPage() {
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema) });
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { user } = useAuth();
  const mutation = useMutation({
    mutationFn: ({ currentPassword, newPassword }: z.infer<typeof schema>) =>
      api('/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['me'] });
      navigate(user ? `/${user.role.toLowerCase().replace('_', '-')}` : '/student/login', { replace: true });
    },
  });
  return (
    <section className="narrow-card card">
      <p className="eyebrow">ACCOUNT SECURITY</p>
      <PageHeader title="Change your temporary password" backTo={user ? `/${user.role.toLowerCase().replace('_', '-')}` : '/student/login'} hasUnsavedChanges={form.formState.isDirty} />
      <p className="muted">Choose a new password before continuing to your workspace.</p>
      <form className="form-stack" onSubmit={form.handleSubmit((values) => mutation.mutate(values))}>
        <Field label="Temporary password" type="password" autoComplete="current-password" {...form.register('currentPassword')} error={form.formState.errors.currentPassword?.message} />
        <Field label="New password" type="password" autoComplete="new-password" {...form.register('newPassword')} error={form.formState.errors.newPassword?.message} />
        <Field label="Confirm new password" type="password" autoComplete="new-password" {...form.register('confirmPassword')} error={form.formState.errors.confirmPassword?.message} />
        {mutation.error && <p className="notice notice-error" role="alert">{mutation.error instanceof ApiError ? mutation.error.message : 'Password could not be changed.'}</p>}
        <Button type="submit" disabled={mutation.isPending}>{mutation.isPending ? 'Saving…' : 'Save new password'}</Button>
      </form>
    </section>
  );
}
