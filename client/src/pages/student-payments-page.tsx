import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/auth-context';
import { PageHeader } from '../components/page-header';
import { PortalSidebar } from '../components/portal-sidebar';
import { Button } from '../components/ui/button';
import { ApiError, api, apiBlob, downloadBlob } from '../lib/api';

type PaymentData = {
  paymentsEnabled: boolean;
  demoMode: boolean;
  currency: string;
  courses: Array<{
    id: string;
    code: string;
    title: string;
    tutors: Array<{ id: string; name: string; tutorProfile: { tutorId: string; bio: string } | null }>;
    plans: Array<{
      id: string;
      period: 'MONTHLY' | 'QUARTERLY' | 'YEARLY';
      price: number;
      tutor: { id: string; name: string; tutorId: string; bio: string };
    }>;
  }>;
  subscriptions: Array<{
    id: string;
    status: string;
    displayStatus: string;
    startsAt: string;
    endsAt: string;
    periodsPaid: number;
    daysLeft: number;
    course: { id: string; code: string; title: string };
    tutor: { id: string; name: string; tutorProfile: { tutorId: string } | null };
  }>;
  payments: Array<{
    id: string;
    planId: string;
    status: string;
    amount: number;
    currency: string;
    createdAt: string;
    periodStart: string;
    periodEnd: string;
    periodsCount: number;
    receiptNumber: string | null;
    receiptAvailable: boolean;
    course: { id: string; code: string; title: string };
    tutor: { id: string; name: string; tutorProfile: { tutorId: string } | null };
  }>;
};

const periods = [
  { value: 'MONTHLY', label: 'Monthly' },
  { value: 'QUARTERLY', label: 'Quarterly' },
  { value: 'YEARLY', label: 'Yearly' },
] as const;

function message(error: unknown) {
  return error instanceof ApiError ? error.message : 'Something went wrong. Please try again.';
}

function money(amount: number, currency: string) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount);
}

function periodLabel(value: string) {
  return periods.find((period) => period.value === value)?.label ?? value;
}

export function StudentPaymentsPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [selectedPlanId, setSelectedPlanId] = useState('');
  const [periodsCount, setPeriodsCount] = useState(1);
  const [pin, setPin] = useState('');
  const [notice, setNotice] = useState('');
  const overview = useQuery({
    queryKey: ['student-payments'],
    queryFn: () => api<PaymentData>('/payments/student'),
  });
  const checkout = useMutation({
    mutationFn: () => api<{
      payment: { status: string; amount: number; receiptNumber: string | null };
      course: { title: string };
      tutor: { name: string };
      demoMode: boolean;
    }>('/payments/student/checkout', {
      method: 'POST',
      body: JSON.stringify({ planId: selectedPlanId, periodsCount, pin }),
    }),
    onSuccess: async (result) => {
      setNotice(result.payment.status === 'PAID'
        ? `Payment successful for ${result.course.title} with ${result.tutor.name}. Receipt ${result.payment.receiptNumber ?? 'is being prepared'}.`
        : 'Payment failed. Choose Retry in payment history to try again.');
      setPin('');
      await queryClient.invalidateQueries({ queryKey: ['student-payments'] });
    },
  });
  const activeSubscription = useMemo(() => overview.data?.subscriptions
    .filter((subscription) => subscription.displayStatus === 'ACTIVE' && subscription.daysLeft > 0)
    .sort((a, b) => new Date(a.endsAt).getTime() - new Date(b.endsAt).getTime())[0], [overview.data?.subscriptions]);
  const selectedPlan = overview.data?.courses.flatMap((course) => course.plans)
    .find((plan) => plan.id === selectedPlanId);

  const startPayment = (planId: string) => {
    setSelectedPlanId(planId);
    setPin('');
    setNotice('');
  };

  const downloadReceipt = async (paymentId: string, receiptNumber: string | null) => {
    try {
      downloadBlob(await apiBlob(`/payments/student/${paymentId}/receipt`), `${receiptNumber ?? paymentId}.pdf`);
    } catch (error) {
      setNotice(message(error));
    }
  };

  return (
    <div className="portal-layout">
      <PortalSidebar role={user?.role ?? 'STUDENT'} />
      <section className="portal-content">
        <PageHeader title="Pay My Fee" backTo="/student" breadcrumbs={['Account', 'Pay My Fee']} />
        {overview.isLoading && <p className="loading">Loading your fee information…</p>}
        {overview.isError && <p className="notice notice-error" role="alert">{message(overview.error)}</p>}
        {overview.data && !overview.data.paymentsEnabled && (
          <div className="card empty-state">
            <h2>Payments are not enabled</h2>
            <p>Your course content remains available. Contact your organization if you have a question about fees.</p>
          </div>
        )}
        {overview.data?.paymentsEnabled && <>
          <article className="card payment-subscription-summary">
            <p className="eyebrow">MY SUBSCRIPTION</p>
            {activeSubscription ? <>
              <h2>{activeSubscription.course.title} · Active</h2>
              <p>{new Date(activeSubscription.startsAt).toLocaleDateString()} – {new Date(activeSubscription.endsAt).toLocaleDateString()}</p>
              <p>{activeSubscription.daysLeft} day{activeSubscription.daysLeft === 1 ? '' : 's'} left · {activeSubscription.periodsPaid} period{activeSubscription.periodsPaid === 1 ? '' : 's'} paid</p>
              <p className="muted">Tutor: {activeSubscription.tutor.name} {activeSubscription.tutor.tutorProfile?.tutorId ? `(${activeSubscription.tutor.tutorProfile.tutorId})` : ''}</p>
              <Button onClick={() => {
                const plan = overview.data?.courses.find((course) => course.id === activeSubscription.course.id)?.plans
                  .find((item) => item.tutor.id === activeSubscription.tutor.id);
                if (plan) startPayment(plan.id);
                else setNotice('No active renewal plan is available for this course and Tutor.');
              }}>Renew</Button>
            </> : <>
              <h2>No active subscription</h2>
              <p className="muted">Choose a course plan below to unlock paid course content.</p>
              <Link className="button button-secondary" to="#course-plans">View course plans</Link>
            </>}
          </article>

          {selectedPlan && <form className="card payment-checkout" aria-labelledby="checkout-title" onSubmit={(event) => {
            event.preventDefault();
            checkout.mutate();
          }}>
            <PageHeader title={overview.data.demoMode ? 'Demo checkout' : 'Test checkout'} backTo="/student/payments" breadcrumbs={['Pay My Fee', 'Checkout']} onBack={() => setSelectedPlanId('')} />
            {overview.data.demoMode
              ? <div className="notice notice-warning">
                <strong>DEMO ONLY: never enter your real UPI PIN.</strong>
                <p>This sample checkout uses no real money. Sample UPI ID: student@demo. PIN 123456 succeeds; 000000 fails.</p>
              </div>
              : <div className="notice notice-warning"><strong>Razorpay test mode</strong><p>A test order can be created, but browser payment confirmation is not configured yet.</p></div>}
            <h2 id="checkout-title">{selectedPlan.tutor.name} · {selectedPlan.tutor.tutorId}</h2>
            <p>{overview.data.courses.find((course) => course.plans.some((plan) => plan.id === selectedPlan.id))?.title ?? 'Course'} · {periodLabel(selectedPlan.period)}</p>
            <p className="payment-total">{money(selectedPlan.price * periodsCount, overview.data.currency)}</p>
            <label className="field"><span>Subscription periods</span><input className="input" type="number" min={1} max={12} value={periodsCount} onChange={(event) => setPeriodsCount(Math.max(1, Math.min(12, Number(event.target.value) || 1)))} /></label>
            {overview.data.demoMode && <>
              <label className="field"><span>Sample UPI ID</span><input className="input" value="student@demo" readOnly /></label>
              <label className="field"><span>Demo PIN</span><input className="input" inputMode="numeric" autoComplete="off" maxLength={6} value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 6))} /></label>
            </>}
            <div className="button-row"><Button disabled={checkout.isPending || (overview.data.demoMode && pin.length !== 6)}>{checkout.isPending ? 'Processing…' : 'Pay now'}</Button><Button type="button" variant="secondary" onClick={() => setSelectedPlanId('')}>Cancel</Button></div>
            {checkout.isError && <p className="notice notice-error" role="alert">{message(checkout.error)}</p>}
          </form>}
          {notice && <p className="notice notice-info" role="status">{notice}</p>}

          <section id="course-plans" className="payment-course-list">
            <h2>My enrolled courses</h2>
            {!overview.data.courses.length && <div className="card empty-state"><h3>No enrolled courses</h3><p>Enroll in a course before selecting a fee plan.</p></div>}
            {overview.data.courses.map((course) => <article className="card" key={course.id}>
              <p className="eyebrow">{course.code}</p><h3>{course.title}</h3>
              {course.tutors.map((tutor) => <p className="muted" key={tutor.id}>{tutor.name} {tutor.tutorProfile?.tutorId ? `(${tutor.tutorProfile.tutorId})` : ''}{tutor.tutorProfile?.bio ? ` · ${tutor.tutorProfile.bio}` : ''}</p>)}
              {!course.plans.length && <p className="muted">No fee plans are currently available.</p>}
              <div className="stats-grid">{course.plans.map((plan) => <div className="card payment-plan" key={plan.id}>
                <p className="eyebrow">{periodLabel(plan.period)}</p><h3>{money(plan.price, overview.data!.currency)}</h3>
                <p>{plan.tutor.name} {plan.tutor.tutorId ? `(${plan.tutor.tutorId})` : ''}</p>
                {plan.tutor.bio && <p className="muted">{plan.tutor.bio}</p>}
                <Button onClick={() => startPayment(plan.id)}>Pay</Button>
              </div>)}</div>
            </article>)}
          </section>

          <section className="card payment-history">
            <h2>Payment history</h2>
            {!overview.data.payments.length && <p className="empty-state">Your payments will appear here.</p>}
            {overview.data.payments.length > 0 && <div className="table-scroll"><table><thead><tr><th>Date</th><th>Course</th><th>Tutor</th><th>Period</th><th>Amount</th><th>Status</th><th>Receipt</th></tr></thead>
              <tbody>{overview.data.payments.map((payment) => <tr key={payment.id}>
                <td>{new Date(payment.createdAt).toLocaleDateString()}</td>
                <td>{payment.course.title}</td>
                <td>{payment.tutor.name} {payment.tutor.tutorProfile?.tutorId ? `(${payment.tutor.tutorProfile.tutorId})` : ''}</td>
                <td>{new Date(payment.periodStart).toLocaleDateString()} – {new Date(payment.periodEnd).toLocaleDateString()} · {payment.periodsCount} {payment.periodsCount === 1 ? 'period' : 'periods'}</td>
                <td>{money(payment.amount, payment.currency)}</td>
                <td>{payment.status}</td>
                <td>{payment.receiptAvailable
                  ? <Button variant="secondary" onClick={() => void downloadReceipt(payment.id, payment.receiptNumber)}>Download PDF</Button>
                  : ['CREATED', 'FAILED'].includes(payment.status) && <Button variant="secondary" onClick={() => {
                    if (overview.data?.courses.flatMap((course) => course.plans).some((plan) => plan.id === payment.planId)) startPayment(payment.planId);
                    else setNotice('The original fee plan is no longer available. Contact your Tutor for a current plan.');
                  }}>Retry</Button>}</td>
              </tr>)}</tbody></table></div>}
          </section>
        </>}
      </section>
    </div>
  );
}
