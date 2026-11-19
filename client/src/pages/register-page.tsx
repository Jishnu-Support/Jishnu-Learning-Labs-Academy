import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
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
  reportedPaid: z.boolean().refine((value) => value, 'Confirm that you submitted payment details for verification'),
  piiConsent: z.boolean(),
  termsAccepted: z.boolean().refine((value) => value, 'Accept the Terms & Conditions to continue'),
  password: z.string().min(8, 'Use at least 8 characters').max(128),
});

type FormValues = z.infer<typeof schema>;
type Props = { role: Extract<Role, 'STUDENT' | 'TUTOR'> };
type RegistrationOptions = {
  courses: Array<{ id: string; code: string; title: string; category: string; registrationMonthlyFee: number | null }>;
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
  const isStudentRegistration = role === 'STUDENT';
  const backTo = isStudentRegistration ? details.login : '/organizations/register';
  const goBack = isStudentRegistration ? () => navigate(details.login, { replace: true }) : undefined;
  const [submitted, setSubmitted] = useState(false);
  const [termsOpen, setTermsOpen] = useState(false);
  const form = useForm<FormValues>({
    resolver: zodResolver(schema.superRefine((values, context) => {
      if (role === 'STUDENT' && !values.studentId?.trim()) {
        context.addIssue({ code: 'custom', path: ['studentId'], message: 'Enter your Student ID' });
      }
      if (role === 'TUTOR' && !values.tutorId?.trim()) {
        context.addIssue({ code: 'custom', path: ['tutorId'], message: 'Enter your Tutor ID' });
      }
      if (role === 'STUDENT' && !values.aadhaarNumber) {
        context.addIssue({ code: 'custom', path: ['aadhaarNumber'], message: 'Enter your 12-digit Aadhaar number' });
      }
      if (role === 'STUDENT' && !values.apaarId) {
        context.addIssue({ code: 'custom', path: ['apaarId'], message: 'Enter your 12-digit APAAR ID' });
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
  const [receiptPreviewUrl, setReceiptPreviewUrl] = useState<string | null>(null);
  const [receiptError, setReceiptError] = useState('');
  const receiptInputRef = useRef<HTMLInputElement>(null);
  const [resume, setResume] = useState<File | null>(null);
  const [resumeError, setResumeError] = useState('');
  const resumeInputRef = useRef<HTMLInputElement>(null);
  const organizationCode = form.watch('organizationCode').trim();
  const selectedCourseId = form.watch('interestedCourseId');
  const paymentMethod = form.watch('paymentMethod');
  const options = useQuery({
    queryKey: ['registration-options', organizationCode, role],
    queryFn: () => api<RegistrationOptions>(`/auth/registration-options?organizationCode=${encodeURIComponent(organizationCode)}&role=${role}`),
    enabled: organizationCode.length > 0,
    retry: false,
  });
  const selectedCourse = options.data?.courses.find(({ id }) => id === selectedCourseId);
  const selectedCourseHasRegistrationFee = Boolean(
    selectedCourse && selectedCourse.registrationMonthlyFee !== null && selectedCourse.registrationMonthlyFee > 0,
  );
  const identityUnavailable = Boolean(options.data
    && (!options.data.identityCollectionEnabled || (isStudentRegistration && !options.data.aadhaarEnabled)));
  const previousCourseId = useRef('');
  useEffect(() => {
    form.setValue('interestedCourseId', '');
    form.setValue('paymentMethod', 'UPI');
    form.setValue('transactionReference', '');
    form.setValue('reportedPaid', false);
    setReceipt(null);
    setReceiptPreviewUrl(null);
    setReceiptError('');
    if (receiptInputRef.current) receiptInputRef.current.value = '';
  }, [organizationCode, form]);
  useEffect(() => {
    if (previousCourseId.current !== selectedCourseId) {
      form.setValue('paymentMethod', 'UPI');
      form.setValue('transactionReference', '');
      form.setValue('reportedPaid', false);
      setReceipt(null);
      setReceiptPreviewUrl(null);
      setReceiptError('');
      if (receiptInputRef.current) receiptInputRef.current.value = '';
    }
    previousCourseId.current = selectedCourseId;
  }, [selectedCourseId, form]);
  useEffect(() => () => {
    if (receiptPreviewUrl) URL.revokeObjectURL(receiptPreviewUrl);
  }, [receiptPreviewUrl]);

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
      if (resume) body.append('resume', resume);
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
      <section className={`narrow-card card${isStudentRegistration ? ' registration-card-student' : ''}`}>
        <p className="eyebrow">REGISTRATION RECEIVED</p>
        <PageHeader title="Registration received" backTo={backTo} onBack={goBack} breadcrumbs={['Register', 'Confirmation']} />
        <p className="muted">{role === 'STUDENT'
          ? 'Your registration was received. Payment remains pending until an administrator verifies it; only then can your account be approved.'
          : 'Your payment is pending verification. After confirmation, an Org Admin will review your Tutor registration.'}</p>
        <Link className="text-link" to={details.login}>Return to {details.title.toLowerCase()} sign in</Link>
      </section>
    );
  }
  return (
    <section className={`narrow-card card${isStudentRegistration ? ' registration-card-student' : ''}`}>
      <p className="eyebrow">{details.title.toUpperCase()} PORTAL</p>
      <PageHeader title="Create your account" backTo={backTo} onBack={goBack} breadcrumbs={[details.title, 'Register']} hasUnsavedChanges={form.formState.isDirty} />
      <p className="muted">{role === 'STUDENT'
        ? 'Registration uses manual payment verification. Submitting this form does not process a payment or approve your account.'
        : 'Payment verification comes first; an Org Admin must still approve your Tutor registration before you can sign in.'}</p>
      <form className={`form-stack registration-form${isStudentRegistration ? ' registration-form-student' : ''}`} aria-busy={mutation.isPending} onSubmit={form.handleSubmit((values) => {
        if (receiptError || resumeError) return;
        mutation.mutate(values);
      })} noValidate>
        <div className="registration-applicant-grid">
          <Field label="Organization Code" autoComplete="organization" {...form.register('organizationCode')} error={form.formState.errors.organizationCode?.message} />
          {role === 'STUDENT'
            ? <Field label="Student ID" autoComplete="username" {...form.register('studentId')} error={form.formState.errors.studentId?.message} />
            : <Field label="Tutor ID" autoComplete="username" {...form.register('tutorId')} error={form.formState.errors.tutorId?.message} />}
          <Field label="Full name" autoComplete="name" {...form.register('name')} error={form.formState.errors.name?.message} />
          <Field label="Contact" type="tel" inputMode="numeric" maxLength={10} placeholder="10-digit mobile number" autoComplete="tel-national" {...form.register('phone')} error={form.formState.errors.phone?.message} />
          <Field label="Email" type="email" autoComplete="email" {...form.register('email')} error={form.formState.errors.email?.message} />
          <Field label="Password" type="password" autoComplete="new-password" {...form.register('password')} error={form.formState.errors.password?.message} />
          <Field label="Mother’s Name" autoComplete="off" {...form.register('motherName')} error={form.formState.errors.motherName?.message} />
          <Field label="Father’s Name" autoComplete="off" {...form.register('fatherName')} error={form.formState.errors.fatherName?.message} />
        </div>
        <section className="registration-id-section" aria-labelledby="registration-id-title">
          <h2 id="registration-id-title">{isStudentRegistration ? 'Identity details' : 'Optional identity details'}</h2>
          <div className="registration-identity-grid">
            <Field
              label={`Aadhaar Number${role === 'STUDENT' ? '' : ' (optional)'}`}
              type="password"
              inputMode="numeric"
              maxLength={14}
              autoComplete="off"
              disabled={Boolean(options.data && !options.data.aadhaarEnabled)}
              {...form.register('aadhaarNumber')}
              onChange={(event) => form.setValue('aadhaarNumber', event.currentTarget.value.replace(/[\s-]/g, '').slice(0, 12), {
                shouldDirty: true,
                shouldValidate: form.formState.isSubmitted,
              })}
              error={form.formState.errors.aadhaarNumber?.message}
            />
            <Field
              label={`APAAR Card (ABC ID)${role === 'STUDENT' ? '' : ' (optional)'}`}
              inputMode="numeric"
              maxLength={14}
              autoComplete="off"
              disabled={Boolean(options.data && !options.data.identityCollectionEnabled)}
              {...form.register('apaarId')}
              onChange={(event) => form.setValue('apaarId', event.currentTarget.value.replace(/[\s-]/g, '').slice(0, 12), {
                shouldDirty: true,
                shouldValidate: form.formState.isSubmitted,
              })}
              error={form.formState.errors.apaarId?.message}
            />
          </div>
          {!organizationCode
            ? <p className="muted">Enter your organization code to check whether identity-number collection is enabled.</p>
            : options.isLoading
              ? <p className="muted">Checking identity-number settings…</p>
              : identityUnavailable
                ? <p className="muted">Identity-number collection is disabled for this deployment, so registration cannot be completed. Contact your organization.</p>
                : <p className="muted">{role === 'STUDENT' ? 'Both IDs are required for student registration.' : 'Both IDs are optional.'} Aadhaar and APAAR data are encrypted and shown masked; Tutors cannot view student IDs.</p>}
          {options.data?.identityCollectionEnabled && (
            <label className="field registration-consent">
              <span className="registration-checkbox">
                <input type="checkbox" {...form.register('piiConsent')} />
                I consent to encrypted storage of any government ID I provide.
              </span>
              {form.formState.errors.piiConsent?.message && <small className="field-error">{form.formState.errors.piiConsent.message}</small>}
            </label>
          )}
        </section>
        <div className="field registration-course-field">
          <label htmlFor="interested-course">Select Course</label>
          <select id="interested-course" className="input" {...form.register('interestedCourseId')}>
            <option value="">{!organizationCode
              ? 'Enter organization code to load courses'
              : options.isLoading
                ? 'Loading published courses…'
                : options.data && options.data.courses.length === 0
                  ? 'No published courses available'
                  : 'Select a course'}</option>
            {options.data?.courses.map((course) => (
              <option key={course.id} value={course.id}>
                {course.category} — {course.title} ({course.code}){course.registrationMonthlyFee !== null && course.registrationMonthlyFee > 0
                  ? ` · ${new Intl.NumberFormat(undefined, { style: 'currency', currency: options.data.currency }).format(course.registrationMonthlyFee)}`
                  : ' · Registration fee not configured'}
              </option>
            ))}
          </select>
          {form.formState.errors.interestedCourseId?.message && <small className="field-error">{form.formState.errors.interestedCourseId.message}</small>}
          {!organizationCode && <small className="muted">Enter your organization code to load its published courses.</small>}
          {options.isLoading && <small className="muted">Loading courses…</small>}
          {options.data && options.data.courses.length === 0 && <small className="muted">No published courses are currently available for this organization.</small>}
          {options.error && <small className="field-error">{options.error instanceof ApiError ? options.error.message : 'Could not load courses for this organization.'}</small>}
          {selectedCourse && !selectedCourseHasRegistrationFee && <small className="field-error">This course has no registration fee configured. Contact your organization before submitting.</small>}
        </div>
        <section className="registration-payment-section" aria-labelledby="registration-payment-title">
          <h2 id="registration-payment-title">Payment</h2>
          <p className="muted">Manual demo flow only. No payment is processed by this form; submitted payment details remain pending until an administrator verifies them.</p>
          <div className="registration-payment-grid">
          <label className="field">Course fee
            <input
              className="input"
              readOnly
              value={!selectedCourse
                ? ''
                : selectedCourse.registrationMonthlyFee !== null && selectedCourse.registrationMonthlyFee > 0
                  ? new Intl.NumberFormat(undefined, { style: 'currency', currency: options.data?.currency ?? 'INR' }).format(selectedCourse.registrationMonthlyFee)
                  : 'Not configured'}
              placeholder="Select a course to view its fee"
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
          {paymentMethod === 'UPI'
            ? <figure className="registration-sample-qr registration-payment-full">
              <img src="/registration/sample-upi-qr.svg" alt="Sample UPI QR code demo only" />
              <figcaption>Sample QR - demo only. It does not accept, process, or verify payments.</figcaption>
            </figure>
            : paymentMethod === 'NET_BANKING'
              ? <div className="notice notice-info registration-payment-full">
                <strong>Net Banking · manual demo only</strong>
                <p>No bank gateway or supported-bank list is configured for registration. Use your bank’s secure app or website outside this form; do not enter bank credentials here. Submit the transfer reference for administrator verification.</p>
              </div>
              : <div className="notice notice-info registration-payment-full">
                <strong>{paymentMethod === 'CREDIT_CARD' ? 'Credit Card' : 'Debit Card'} · manual demo only</strong>
                <p>No card gateway is configured for registration, and this form does not process card payments. Never enter a full card number, expiry, or CVV here. Submit an externally obtained transaction reference for administrator verification.</p>
              </div>}
          <Field label="Transaction / Reference number" autoComplete="off" maxLength={120} {...form.register('transactionReference')} error={form.formState.errors.transactionReference?.message} />
          <label className="field">Receipt upload (optional)
            <input
              ref={receiptInputRef}
              className="input"
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0] ?? null;
                if (!file) return;
                const allowed = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'].includes(file.type)
                  && /\.(pdf|png|jpe?g|webp)$/i.test(file.name)
                  && file.size <= 5 * 1024 * 1024;
                if (!allowed) {
                  setReceiptError('Choose a PDF, PNG, JPG, or WEBP receipt up to 5 MB.');
                  setReceipt(null);
                  setReceiptPreviewUrl(null);
                  event.currentTarget.value = '';
                  return;
                }
                setReceiptError('');
                setReceipt(file);
                setReceiptPreviewUrl(file.type.startsWith('image/') ? URL.createObjectURL(file) : null);
              }}
            />
            {receiptError && <small className="field-error">{receiptError}</small>}
            {receipt && <span className="registration-receipt-name">{receipt.name}</span>}
            {receiptPreviewUrl && <img className="registration-receipt-preview" src={receiptPreviewUrl} alt="Selected receipt preview" />}
            {receipt && <Button type="button" variant="secondary" onClick={() => {
              setReceipt(null);
              setReceiptPreviewUrl(null);
              setReceiptError('');
              if (receiptInputRef.current) receiptInputRef.current.value = '';
            }}>Remove receipt</Button>}
          </label>
          <label className="field registration-consent registration-payment-full">
            <span className="registration-checkbox">
              <input type="checkbox" {...form.register('reportedPaid')} />
              {role === 'STUDENT'
                ? 'I submitted payment details for verification. This records my claim only; it does not confirm payment.'
                : 'I submitted payment details for verification. The payment remains pending until an administrator confirms it.'}
            </span>
            {form.formState.errors.reportedPaid?.message && <small className="field-error">{form.formState.errors.reportedPaid.message}</small>}
          </label>
          </div>
        </section>
        {role === 'TUTOR' && <section className="registration-id-section" aria-labelledby="registration-resume-title">
          <h2 id="registration-resume-title">Resume</h2>
          <label className="field">Upload Resume (optional)
            <input
              ref={resumeInputRef}
              className="input"
              type="file"
              accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0] ?? null;
                if (!file) return;
                const extension = file.name.split('.').pop()?.toLowerCase();
                const expectedTypes: Record<string, string> = {
                  pdf: 'application/pdf',
                  doc: 'application/msword',
                  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                };
                if (!extension || file.type !== expectedTypes[extension] || file.size > 5 * 1024 * 1024) {
                  setResumeError('Choose a PDF, DOC, or DOCX resume up to 5 MB.');
                  setResume(null);
                  event.currentTarget.value = '';
                  return;
                }
                setResumeError('');
                setResume(file);
              }}
            />
            {resumeError && <small className="field-error">{resumeError}</small>}
            {resume && <span className="registration-receipt-name">{resume.name}</span>}
            {resume && <Button type="button" variant="secondary" onClick={() => {
              setResume(null);
              setResumeError('');
              if (resumeInputRef.current) resumeInputRef.current.value = '';
            }}>Remove resume</Button>}
          </label>
        </section>}
        <details id="registration-terms" className="registration-terms" open={termsOpen} onToggle={(event) => setTermsOpen(event.currentTarget.open)}>
          <summary>Terms &amp; Conditions</summary>
          <div className="registration-terms-content">
            <h3>Registration and review</h3>
            <p>Submit accurate information. Your application is shared with authorized reviewers for your organization and role. A Student registration remains pending until an administrator confirms the reported payment; a Tutor registration also requires the existing Org Admin review.</p>
            <h3>Payment information</h3>
            <p>This registration page uses manual/demo payment reporting. The sample UPI QR does not accept payments, and card or Net Banking details are not collected or processed here. A checkbox, reference number, or receipt does not prove payment; an administrator must verify it.</p>
            <h3>Privacy and account security</h3>
            <p>            Student Aadhaar and APAAR IDs are required when identity collection is enabled; Tutor IDs are optional. Both require your consent, are encrypted, and are displayed masked. Keep your password private; do not enter card numbers, CVV, bank passwords, or payment PINs on this page.</p>
          </div>
        </details>
        <label className="field registration-consent">
          <span className="registration-checkbox">
            <input type="checkbox" {...form.register('termsAccepted')} />
            I agree to the <a href="#registration-terms" onClick={() => setTermsOpen(true)}>Terms &amp; Conditions</a>.
          </span>
          {form.formState.errors.termsAccepted?.message && <small className="field-error">{form.formState.errors.termsAccepted.message}</small>}
        </label>
        {mutation.error && <p className="notice notice-error" role="alert">{mutation.error instanceof ApiError ? mutation.error.message : 'Registration failed. Please try again.'}</p>}
        <Button type="submit" disabled={mutation.isPending || identityUnavailable || (Boolean(selectedCourse) && !selectedCourseHasRegistrationFee) || !form.watch('termsAccepted') || !form.watch('reportedPaid') || !form.watch('transactionReference').trim() || Boolean(receiptError)}>{mutation.isPending ? 'Submitting…' : 'Submit registration'}</Button>
      </form>
      <p className="form-foot">Already registered? <Link to={details.login}>Sign in</Link></p>
    </section>
  );
}
