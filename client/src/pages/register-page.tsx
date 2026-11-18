import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { Field } from '../components/field';
import { PageHeader } from '../components/page-header';
import { Button } from '../components/ui/button';
import { api, ApiError } from '../lib/api';
import type { Role } from '../types';

function isValidAadhaar(value: string) {
  const multiplication = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
    [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
    [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
    [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
    [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
    [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
    [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
    [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
    [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
  ];
  const permutation = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
    [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
    [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
    [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
    [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
    [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
    [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
  ];
  let checksum = 0;
  for (let index = 0; index < value.length; index += 1) {
    const digit = Number(value[value.length - 1 - index]);
    const permutedDigit = permutation[index % 8]?.[digit];
    if (permutedDigit === undefined) return false;
    const transformedDigit = multiplication[checksum]?.[permutedDigit];
    if (transformedDigit === undefined) return false;
    checksum = transformedDigit;
  }
  return checksum === 0;
}

const aadhaarSchema = z.string()
  .regex(/^[2-9]\d{11}$/, 'Enter a valid 12-digit Aadhaar number')
  .refine(isValidAadhaar, 'Aadhaar checksum is invalid');

const schema = z.object({
  organizationCode: z.string().trim().min(1, 'Enter your organization code'),
  studentId: z.string().trim().optional(),
  tutorId: z.string().trim().optional(),
  name: z.string().trim().min(2, 'Enter your full name').max(120),
  phone: z.string().trim().regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit mobile number'),
  email: z.string().trim().email('Enter a valid email address').max(254),
  fatherName: z.string().trim().min(2, 'Enter your father’s name').max(120),
  motherName: z.string().trim().min(2, 'Enter your mother’s name').max(120),
  aadhaarNumber: z.union([z.literal(''), aadhaarSchema]).optional(),
  apaarId: z.union([z.literal(''), z.string().regex(/^\d{12}$/, 'Enter a valid 12-digit APAAR ID')]).optional(),
  interestedCourseId: z.string().min(1, 'Choose an interested course'),
  paymentMethod: z.enum(['UPI', 'CREDIT_CARD', 'DEBIT_CARD', 'NET_BANKING'], { message: 'Choose a payment method' }),
  transactionReference: z.string().trim().min(1, 'Enter the transaction or reference number').max(120, 'Use 120 characters or fewer'),
  reportedPaid: z.boolean().refine((value) => value, 'Confirm that you have paid to continue'),
  piiConsent: z.boolean(),
  termsAccepted: z.boolean().refine((value) => value, 'Accept the Terms & Conditions to continue'),
  password: z.string().min(8, 'Use at least 8 characters').max(128),
});

type FormValues = z.infer<typeof schema>;
type Props = { role: Extract<Role, 'STUDENT' | 'TUTOR'> };
type RegistrationOptions = {
  courses: Array<{ id: string; title: string; category: string; registrationMonthlyFee: number | null }>;
  currency: string;
  identityCollectionEnabled: boolean;
  aadhaarEnabled: boolean;
};

const roleDetails = {
  STUDENT: { title: 'Student', endpoint: '/auth/students/register', login: '/student/login' },
  TUTOR: { title: 'Tutor', endpoint: '/auth/tutors/register', login: '/tutor/login' },
} as const;

export function RegisterPage({ role }: Props) {
  const details = roleDetails[role];
  const navigate = useNavigate();
  const [submitted, setSubmitted] = useState(false);
  const form = useForm<FormValues>({
    resolver: zodResolver(schema.superRefine((values, context) => {
      if (role === 'STUDENT' && !values.studentId?.trim()) {
        context.addIssue({ code: 'custom', path: ['studentId'], message: 'Enter your Student ID' });
      }
      if (role === 'TUTOR' && !values.tutorId?.trim()) {
        context.addIssue({ code: 'custom', path: ['tutorId'], message: 'Enter your Tutor ID' });
      }
      if ((values.aadhaarNumber || values.apaarId) && !values.piiConsent) {
        context.addIssue({ code: 'custom', path: ['piiConsent'], message: 'Consent is required before saving identification numbers' });
      }
    })),
    defaultValues: {
      organizationCode: '',
      studentId: '',
      tutorId: '',
      name: '',
      phone: '',
      email: '',
      fatherName: '',
      motherName: '',
      aadhaarNumber: '',
      apaarId: '',
      interestedCourseId: '',
      paymentMethod: 'UPI',
      transactionReference: '',
      reportedPaid: false,
      piiConsent: false,
      termsAccepted: false,
      password: '',
    },
  });
  const [receipt, setReceipt] = useState<File | null>(null);
  const [receiptError, setReceiptError] = useState('');
  const organizationCode = form.watch('organizationCode').trim();
  const options = useQuery({
    queryKey: ['registration-options', organizationCode, role],
    queryFn: () => api<RegistrationOptions>(`/auth/registration-options?organizationCode=${encodeURIComponent(organizationCode)}&role=${role}`),
    enabled: organizationCode.length > 0,
    retry: false,
  });
  useEffect(() => {
    form.setValue('interestedCourseId', '');
  }, [organizationCode, form]);

  const mutation = useMutation({
    mutationFn: async (values: FormValues) => {
      const body = new FormData();
      const fields = {
        organizationCode: values.organizationCode,
        name: values.name,
        email: values.email,
        phone: values.phone,
        password: values.password,
        fatherName: values.fatherName,
        motherName: values.motherName,
        aadhaarNumber: values.aadhaarNumber || undefined,
        apaarId: values.apaarId || undefined,
        interestedCourseId: values.interestedCourseId,
        piiConsent: values.piiConsent,
        termsAccepted: values.termsAccepted,
        paymentMethod: values.paymentMethod,
        transactionReference: values.transactionReference,
        reportedPaid: values.reportedPaid,
        ...(role === 'STUDENT' ? { studentId: values.studentId } : {}),
        ...(role === 'TUTOR' ? { tutorId: values.tutorId } : {}),
      };
      for (const [key, value] of Object.entries(fields)) {
        if (value !== undefined) body.append(key, String(value));
      }
      if (receipt) body.append('receipt', receipt);
      const result = await api<{ registrationAccessToken?: string }>(details.endpoint, { method: 'POST', body });
      if (role === 'STUDENT' && !result.registrationAccessToken) {
        throw new Error('Registration status access could not be created. Please contact your organization.');
      }
      return result;
    },
    onSuccess: (result) => {
      if (role === 'STUDENT' && result.registrationAccessToken) {
        sessionStorage.setItem('student-registration-access-token', result.registrationAccessToken);
        navigate('/student/registration-status', { replace: true });
        return;
      }
      setSubmitted(true);
    },
  });
  if (submitted) {
    return (
      <section className="narrow-card card">
        <p className="eyebrow">REGISTRATION RECEIVED</p>
        <PageHeader title="Registration received" backTo="/organizations/register" breadcrumbs={['Register', 'Confirmation']} />
        <p className="muted">{role === 'STUDENT'
          ? 'Your account is pending payment verification. It will be approved automatically when an administrator confirms payment.'
          : 'Your payment is pending verification. After confirmation, an Org Admin will review your Tutor registration.'}</p>
        <Link className="text-link" to={details.login}>Return to {details.title.toLowerCase()} sign in</Link>
      </section>
    );
  }
  return (
    <section className="narrow-card card">
      <p className="eyebrow">{details.title.toUpperCase()} PORTAL</p>
      <PageHeader title="Create your account" backTo="/organizations/register" breadcrumbs={[details.title, 'Register']} hasUnsavedChanges={form.formState.isDirty} />
      <p className="muted">{role === 'STUDENT'
        ? 'Your account is approved automatically when an administrator confirms your registration payment.'
        : 'Payment verification comes first; an Org Admin must still approve your Tutor registration before you can sign in.'}</p>
      <form className="form-stack registration-form" onSubmit={form.handleSubmit((values) => {
        if (receiptError) return;
        mutation.mutate(values);
      })} noValidate>
        <Field label="Organization Code" autoComplete="organization" {...form.register('organizationCode')} error={form.formState.errors.organizationCode?.message} />
        {role === 'STUDENT'
          ? <Field label="Student ID" autoComplete="username" {...form.register('studentId')} error={form.formState.errors.studentId?.message} />
          : <Field label="Tutor ID" autoComplete="username" {...form.register('tutorId')} error={form.formState.errors.tutorId?.message} />}
        <Field label="Full name" autoComplete="name" {...form.register('name')} error={form.formState.errors.name?.message} />
        <Field label="Contact" type="tel" inputMode="numeric" maxLength={10} placeholder="10-digit mobile number" autoComplete="tel-national" {...form.register('phone')} error={form.formState.errors.phone?.message} />
        <Field label="Email" type="email" autoComplete="email" {...form.register('email')} error={form.formState.errors.email?.message} />
        <Field label="Mother’s Name" autoComplete="off" {...form.register('motherName')} error={form.formState.errors.motherName?.message} />
        <Field label="Father’s Name" autoComplete="off" {...form.register('fatherName')} error={form.formState.errors.fatherName?.message} />
        <Field label="Password" type="password" autoComplete="new-password" {...form.register('password')} error={form.formState.errors.password?.message} />
        <Field
          label="Aadhaar Number (optional)"
          inputMode="numeric"
          maxLength={12}
          autoComplete="off"
          disabled={!options.data?.aadhaarEnabled}
          {...form.register('aadhaarNumber')}
          error={form.formState.errors.aadhaarNumber?.message}
        />
        <Field
          label="APAAR ID (optional)"
          inputMode="numeric"
          maxLength={12}
          autoComplete="off"
          disabled={!options.data?.identityCollectionEnabled}
          {...form.register('apaarId')}
          error={form.formState.errors.apaarId?.message}
        />
        {!options.data?.identityCollectionEnabled && organizationCode
          ? <p className="muted">Identity-number collection is currently disabled for this deployment.</p>
          : <p className="muted">Government IDs are optional. Provide them only when legally permitted and necessary. Stored IDs are encrypted and shown masked; Tutors cannot view student IDs.</p>}
        {options.data?.identityCollectionEnabled && (
          <label className="field registration-consent">
            <span className="registration-checkbox">
              <input type="checkbox" {...form.register('piiConsent')} />
              I consent to encrypted storage of any government ID I provide.
            </span>
            {form.formState.errors.piiConsent?.message && <small className="field-error">{form.formState.errors.piiConsent.message}</small>}
          </label>
        )}
        <label className="field">
          <span>Interested Course</span>
          <select className="input" disabled={!organizationCode || options.isLoading || !options.data?.courses.length} {...form.register('interestedCourseId')}>
            <option value="">Select a published course</option>
            {options.data?.courses.map((course) => (
              <option key={course.id} value={course.id}>
                {course.category} — {course.title}{course.registrationMonthlyFee !== null
                  ? ` · ${new Intl.NumberFormat(undefined, { style: 'currency', currency: options.data.currency }).format(course.registrationMonthlyFee)}`
                  : ''}
              </option>
            ))}
          </select>
          {form.formState.errors.interestedCourseId?.message && <small className="field-error">{form.formState.errors.interestedCourseId.message}</small>}
          {options.isLoading && <small className="muted">Loading courses…</small>}
          {options.data && options.data.courses.length === 0 && <small className="muted">{role === 'STUDENT'
            ? 'No published courses with a configured registration fee are currently available. Contact your organization.'
            : 'No courses with a configured registration fee are currently available for this organization.'}</small>}
          {options.error && <small className="field-error">{options.error instanceof ApiError ? options.error.message : 'Could not load courses for this organization.'}</small>}
        </label>
        <section className="registration-payment-section" aria-labelledby="registration-payment-title">
          <h2 id="registration-payment-title">Payment</h2>
          <label className="field">Course fee
            <input
              className="input"
              readOnly
              value={(() => {
                const course = options.data?.courses.find(({ id }) => id === form.watch('interestedCourseId'));
                return course?.registrationMonthlyFee === null || course?.registrationMonthlyFee === undefined
                  ? ''
                  : new Intl.NumberFormat(undefined, { style: 'currency', currency: options.data?.currency ?? 'INR' }).format(course.registrationMonthlyFee);
              })()}
              placeholder="Choose a course to view its fee"
            />
          </label>
          <label className="field">Payment method
            <select className="input" {...form.register('paymentMethod')}>
              <option value="UPI">UPI</option>
              <option value="CREDIT_CARD">Credit Card</option>
              <option value="DEBIT_CARD">Debit Card</option>
              <option value="NET_BANKING">Net Banking</option>
            </select>
            {form.formState.errors.paymentMethod?.message && <small className="field-error">{form.formState.errors.paymentMethod.message}</small>}
          </label>
          {form.watch('paymentMethod') === 'UPI'
            ? <figure className="registration-sample-qr">
              <img src="/registration/sample-upi-qr.svg" alt="Sample UPI QR code demo only" />
              <figcaption>Sample QR - demo only. This code does not accept payments.</figcaption>
            </figure>
            : <p className="notice notice-info">Demo only - no real payment processed. Do not enter or store card numbers.</p>}
          <Field label="Transaction / Reference number" autoComplete="off" maxLength={120} {...form.register('transactionReference')} error={form.formState.errors.transactionReference?.message} />
          <label className="field">Receipt upload (optional)
            <input
              className="input"
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp"
              onChange={(event) => {
                const file = event.target.files?.[0] ?? null;
                const allowed = file && ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'].includes(file.type)
                  && /\.(pdf|png|jpe?g|webp)$/i.test(file.name)
                  && file.size <= 5 * 1024 * 1024;
                setReceiptError(file && !allowed ? 'Choose a PDF, PNG, JPG, or WEBP receipt up to 5 MB.' : '');
                setReceipt(file && allowed ? file : null);
                if (file && !allowed) event.target.value = '';
              }}
            />
            {receiptError && <small className="field-error">{receiptError}</small>}
          </label>
          <label className="field registration-consent">
            <span className="registration-checkbox">
              <input type="checkbox" {...form.register('reportedPaid')} />
              I have paid the displayed course fee.
            </span>
            {form.formState.errors.reportedPaid?.message && <small className="field-error">{form.formState.errors.reportedPaid.message}</small>}
          </label>
        </section>
        <details id="registration-terms" className="registration-terms">
          <summary>Terms &amp; Conditions</summary>
          <p>Submitting creates a pending registration request. Your application is shared with the authorized reviewer for your role and organization. Keep your sign-in credentials private and provide only accurate information.</p>
        </details>
        <label className="field registration-consent">
          <span className="registration-checkbox">
            <input type="checkbox" {...form.register('termsAccepted')} />
            I agree to the <a href="#registration-terms">Terms &amp; Conditions</a>.
          </span>
          {form.formState.errors.termsAccepted?.message && <small className="field-error">{form.formState.errors.termsAccepted.message}</small>}
        </label>
        {mutation.error && <p className="notice notice-error" role="alert">{mutation.error instanceof ApiError ? mutation.error.message : 'Registration failed. Please try again.'}</p>}
        <Button type="submit" disabled={mutation.isPending || !form.watch('termsAccepted') || !form.watch('reportedPaid') || !form.watch('transactionReference').trim() || Boolean(receiptError)}>{mutation.isPending ? 'Submitting…' : 'Submit registration'}</Button>
      </form>
      <p className="form-foot">Already registered? <Link to={details.login}>Sign in</Link></p>
    </section>
  );
}
