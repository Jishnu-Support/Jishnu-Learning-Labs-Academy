import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { PageHeader } from '../components/page-header';
import { Button } from '../components/ui/button';
import { ApiError, api } from '../lib/api';

type RegistrationStatus = {
  registrationReference: string;
  course: { code: string; title: string };
  amount: number;
  currency: string;
  paymentStatus: 'PENDING' | 'PAID' | 'REFUNDED';
  accountStatus: 'PENDING_PAYMENT' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUSPENDED';
  rejectionReason: string | null;
  organization: { name: string; contactNumber: string };
  createdAt: string;
  paidAt: string | null;
  refundedAt: string | null;
};

function statusLabel(status: RegistrationStatus['accountStatus']) {
  if (status === 'PENDING_PAYMENT') return 'Pending Payment';
  if (status === 'PENDING') return 'Pending Review';
  return status[0] + status.slice(1).toLowerCase();
}

function money(amount: number, currency: string) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount);
}

export function StudentRegistrationStatusPage() {
  const accessToken = sessionStorage.getItem('student-registration-access-token');
  const [showPaymentInstructions, setShowPaymentInstructions] = useState(false);
  const query = useQuery({
    queryKey: ['student-registration-status'],
    queryFn: () => {
      if (!accessToken) throw new Error('Registration status access is unavailable in this browser session.');
      return api<RegistrationStatus>('/auth/students/registration-status', {
        method: 'POST',
        body: JSON.stringify({ token: accessToken }),
      });
    },
    enabled: Boolean(accessToken),
    retry: false,
    refetchInterval: 15_000,
  });
  const data = query.data;
  const accountStatus = data?.accountStatus;
  const statusText = data
    ? accountStatus === 'PENDING_PAYMENT'
      ? 'Please pay the first-month registration fee. Your account will be approved automatically when an Org Admin records the payment.'
      : accountStatus === 'PENDING'
        ? 'Your account is pending review. Contact your organization for next steps.'
        : accountStatus === 'APPROVED'
          ? 'Your registration is approved. You can now sign in to the Student Portal.'
          : accountStatus === 'REJECTED'
            ? 'A Tutor rejected this registration.'
            : 'This account cannot sign in. Contact your organization.'
    : '';

  return (
    <section className="narrow-card card registration-status-page">
      <p className="eyebrow">STUDENT REGISTRATION</p>
      <PageHeader title="Registration status" backTo="/student/register" breadcrumbs={['Student', 'Registration status']} />
      {query.isLoading && <p className="loading">Loading registration status…</p>}
      {!accessToken && <p className="notice notice-error" role="alert">This registration status is available only in the browser session where you registered. Contact your organization if you need help.</p>}
      {query.error && <p className="notice notice-error" role="alert">{query.error instanceof ApiError ? query.error.message : query.error.message}</p>}
      {data && (
        <div className="registration-status-content">
          <div className={`status-pill status-${data.accountStatus === 'PENDING_PAYMENT' ? 'pending' : data.accountStatus.toLowerCase()}`}>{statusLabel(data.accountStatus)}</div>
          <p>{statusText}</p>
          <dl className="registration-status-details">
            <div><dt>Course</dt><dd>{data.course.code} — {data.course.title}</dd></div>
            <div><dt>First-month registration fee</dt><dd>{money(data.amount, data.currency)}</dd></div>
            <div><dt>Payment status</dt><dd>{data.paymentStatus}</dd></div>
            <div><dt>Registration reference</dt><dd>{data.registrationReference}</dd></div>
            <div><dt>Submitted</dt><dd>{new Date(data.createdAt).toLocaleString()}</dd></div>
            {data.paidAt && <div><dt>Payment recorded</dt><dd>{new Date(data.paidAt).toLocaleString()}</dd></div>}
            {data.refundedAt && <div><dt>Refund recorded</dt><dd>{new Date(data.refundedAt).toLocaleString()}</dd></div>}
          </dl>
          {data.rejectionReason && <p className="notice notice-error" role="status">Reason: {data.rejectionReason}</p>}
          {accountStatus === 'PENDING_PAYMENT' && (
            <div className="registration-payment-actions">
              <Button type="button" onClick={() => setShowPaymentInstructions((shown) => !shown)}>
                {showPaymentInstructions ? 'Hide payment instructions' : 'Pay Now'}
              </Button>
              {showPaymentInstructions && (
                <div className="card registration-payment-instructions">
                  <h2>Offline payment</h2>
                  <p>Contact {data.organization.name} at <a href={`tel:${data.organization.contactNumber}`}>{data.organization.contactNumber}</a> to pay this amount. Give them the registration reference above.</p>
                  <p className="muted">Your status remains Pending Payment until an Org Admin records receipt. Do not share your password or identity numbers as payment proof.</p>
                </div>
              )}
            </div>
          )}
          {accountStatus === 'APPROVED' && <Link className="button button-primary" to="/student/login">Go to Student sign in</Link>}
        </div>
      )}
    </section>
  );
}
