import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { Field } from '../components/field';
import { PageHeader } from '../components/page-header';
import { Button } from '../components/ui/button';
import { api, ApiError } from '../lib/api';

const schema = z.object({
  organizationName: z.string().trim().min(2, 'Enter the organization name'),
  organizationHeadName: z.string().trim().min(2, 'Enter the organization head name'),
  contactNumber: z.string().trim().min(7, 'Enter a valid contact number'),
  email: z.string().trim().email('Enter a valid email address'),
  address: z.string().trim().min(2, 'Enter the organization address'),
  city: z.string().trim().min(2, 'Enter the city'),
  state: z.string().trim().min(2, 'Enter the state or region'),
  country: z.string().trim().min(2, 'Enter the country'),
  registrationNumber: z.string().trim().optional(),
  website: z.string().trim().url('Enter a valid website URL').or(z.literal('')),
  password: z.string().min(8, 'Use at least 8 characters'),
});
type FormValues = z.infer<typeof schema>;

export function OrganizationRegistrationPage() {
  const [registration, setRegistration] = useState<{ code: string | null; status: string } | null>(null);
  const [copyMessage, setCopyMessage] = useState('');
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      organizationName: '', organizationHeadName: '', contactNumber: '', email: '', address: '',
      city: '', state: '', country: '', registrationNumber: '', website: '', password: '',
    },
  });
  const mutation = useMutation({
    mutationFn: (values: FormValues) => api<{ organization: { code: string | null; status: string } }>('/organizations/register', { method: 'POST', body: JSON.stringify(values) }),
    onSuccess: (data) => setRegistration(data.organization),
  });
  const navigate = useNavigate();
  if (registration) {
    const copyCode = async () => {
      if (!registration.code) return;
      try {
        await navigator.clipboard.writeText(registration.code);
        setCopyMessage('Organization code copied.');
      } catch {
        setCopyMessage('Copy was unavailable. Select and copy the code above.');
      }
    };
    return (
      <section className="narrow-card card">
        <p className="eyebrow">REGISTRATION RECEIVED</p>
        {registration.status === 'PENDING' ? (
          <>
            <PageHeader title="Waiting for approval" backTo="/student/register" breadcrumbs={['Organization', 'Registration']} />
            <p className="muted">Your organization is pending Super Admin approval. The Org Admin account will be available after approval.</p>
            <Link className="text-link" to="/super-admin/login">Platform Admin sign in</Link>
          </>
        ) : (
          <>
            <PageHeader title="Your organization is active" backTo="/student/register" breadcrumbs={['Organization', 'Registration']} />
            <p className="muted">Save this organization code. You need it each time you sign in to the Org Admin portal.</p>
            <p className="organization-code" aria-label="Organization code">{registration.code}</p>
            {copyMessage && <p className="notice" role="status">{copyMessage}</p>}
            <div className="row-actions">
              <Button variant="secondary" onClick={() => void copyCode()}>Copy code</Button>
              <Button onClick={() => navigate('/org-admin/login')}>Go to login</Button>
            </div>
          </>
        )}
      </section>
    );
  }
  return (
    <section className="narrow-card card">
      <p className="eyebrow">JISHNU LEARNING LABS</p>
      <PageHeader title="Register your organization" backTo="/student/register" breadcrumbs={['Organization', 'Register']} hasUnsavedChanges={form.formState.isDirty} />
      <p className="muted">Register your organization and create its Org Admin account.</p>
      <form className="form-stack" onSubmit={form.handleSubmit((values) => mutation.mutate(values))}>
        <Field label="Organization name" autoComplete="organization" {...form.register('organizationName')} error={form.formState.errors.organizationName?.message} />
        <Field label="Organization head name" autoComplete="name" {...form.register('organizationHeadName')} error={form.formState.errors.organizationHeadName?.message} />
        <Field label="Contact number" type="tel" autoComplete="tel" {...form.register('contactNumber')} error={form.formState.errors.contactNumber?.message} />
        <Field label="Email address" type="email" autoComplete="email" {...form.register('email')} error={form.formState.errors.email?.message} />
        <Field label="Address" autoComplete="street-address" {...form.register('address')} error={form.formState.errors.address?.message} />
        <Field label="City" autoComplete="address-level2" {...form.register('city')} error={form.formState.errors.city?.message} />
        <Field label="State / region" autoComplete="address-level1" {...form.register('state')} error={form.formState.errors.state?.message} />
        <Field label="Country" autoComplete="country-name" {...form.register('country')} error={form.formState.errors.country?.message} />
        <Field label="Registration number (optional)" {...form.register('registrationNumber')} error={form.formState.errors.registrationNumber?.message} />
        <Field label="Website (optional)" type="url" autoComplete="url" {...form.register('website')} error={form.formState.errors.website?.message} />
        <Field label="Password for the Org Admin account" type="password" autoComplete="new-password" {...form.register('password')} error={form.formState.errors.password?.message} />
        {mutation.error && <p className="notice notice-error" role="alert">{mutation.error instanceof ApiError ? mutation.error.message : 'Organization registration failed. Please try again.'}</p>}
        <Button type="submit" disabled={mutation.isPending}>{mutation.isPending ? 'Registering…' : 'Register organization'}</Button>
      </form>
      <p className="form-foot">Already registered? <Link to="/org-admin/login">Org Admin sign in</Link></p>
    </section>
  );
}
