import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Save } from 'lucide-react';
import { useAuth } from '../auth/auth-context';
import { PageHeader } from '../components/page-header';
import { PortalSidebar } from '../components/portal-sidebar';
import { Button } from '../components/ui/button';
import { api, apiBlob, downloadBlob } from '../lib/api';
import type { Role } from '../types';

type PaymentRecord = {
  id: string;
  organization: { id: string; name: string; code: string | null } | null;
  student: { id: string; name: string; studentId: string };
  tutor: { id: string; name: string; tutorId: string };
  course: { id: string; code: string; title: string };
  subscription: { id: string; status: string; startsAt: string; endsAt: string; periodsPaid: number } | null;
  amount: number;
  currency: string;
  period: 'MONTHLY' | 'QUARTERLY' | 'YEARLY';
  status: string;
  periodStart: string;
  periodEnd: string;
  periodsCount: number;
  receiptNumber: string | null;
  createdAt: string;
};

type RegistrationPaymentRecord = {
  id: string;
  organizationId: string;
  applicantRole: 'STUDENT' | 'TUTOR';
  organization: { id: string; name: string; code: string | null };
  amount: number;
  currency: string;
  status: 'PENDING' | 'PAID' | 'REFUNDED';
  paymentMethod: 'UPI' | 'CREDIT_CARD' | 'DEBIT_CARD' | 'NET_BANKING' | null;
  transactionReference: string | null;
  receiptOriginalName: string | null;
  reportedPaid: boolean;
  createdAt: string;
  paidAt: string | null;
  refundedAt: string | null;
  refundReason: string | null;
  course: { id: string; code: string; title: string };
  applicant: { id: string; name: string; status: string; role: 'STUDENT' | 'TUTOR'; applicantId: string };
};

type Plan = {
  id: string;
  organizationId: string;
  tutorId: string;
  courseId: string;
  period: 'MONTHLY' | 'QUARTERLY' | 'YEARLY';
  price: number;
  isActive: boolean;
  acceptsNewFees: boolean;
  course: { id: string; code: string; title: string };
  tutor: { id: string; name: string; tutorId: string };
};

type ManagementData = {
  scope: Role;
  demoMode: boolean;
  organization: null | {
    id: string;
    name: string;
    code: string | null;
    paymentsEnabled: boolean;
    currency: string;
    minimumMonthlyFee: number | null;
    maximumMonthlyFee: number | null;
    minimumQuarterlyFee: number | null;
    maximumQuarterlyFee: number | null;
    minimumYearlyFee: number | null;
    maximumYearlyFee: number | null;
    invoiceName: string | null;
    invoiceAddress: string | null;
    invoiceTaxId: string | null;
  };
  organizations: Array<{
    id: string;
    name: string;
    code: string | null;
    paymentsEnabled: boolean;
    currency: string;
    totals: { revenue: number; payments: number; activeSubscriptions: number };
  }>;
  summary: {
    revenueThisMonth: number;
    revenueAllTime: number;
    revenueByPeriod: { MONTHLY: number; QUARTERLY: number; YEARLY: number };
    activeSubscriptions: number;
    expiredSubscriptions: number;
    inactiveSubscriptions: number;
    failedPayments: number;
    refunds: number;
    pendingRenewals: number;
    uniquePayingStudents: number;
    newestPayments: string[];
  };
  courses: Array<{ id: string; code: string; title: string }>;
  tutors: Array<{ id: string; name: string; tutorId: string; acceptsNewFees: boolean }>;
  plans: Plan[];
  priceHistory: Array<{
    id: string;
    period: Plan['period'];
    previousPrice: number | null;
    newPrice: number;
    reason: string | null;
    createdAt: string;
    course: { title: string; code: string };
    tutor: { name: string; tutorId: string };
    changedBy: string;
  }>;
  byCourse: Array<{ course: { id: string; title: string; code: string }; amount: number; count: number }>;
  byTutor: Array<{ tutor: { id: string; name: string; tutorId: string }; amount: number; count: number }>;
  payments: PaymentRecord[];
};

type Filters = { organizationId: string; tutorId: string; courseId: string; status: string; from: string; to: string };
type SettingsForm = {
  paymentsEnabled: boolean;
  currency: string;
  minimumMonthlyFee: string;
  maximumMonthlyFee: string;
  minimumQuarterlyFee: string;
  maximumQuarterlyFee: string;
  minimumYearlyFee: string;
  maximumYearlyFee: string;
  invoiceName: string;
  invoiceAddress: string;
  invoiceTaxId: string;
};

const periods: Plan['period'][] = ['MONTHLY', 'QUARTERLY', 'YEARLY'];
const initialFilters: Filters = { organizationId: '', tutorId: '', courseId: '', status: '', from: '', to: '' };
const formatDate = (value: string) => new Date(value).toLocaleDateString();
const formatMoney = (value: number, currency = 'INR') => new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(value);
const periodLabel = (value: string) => value[0] + value.slice(1).toLowerCase();
const emptySettings: SettingsForm = {
  paymentsEnabled: false, currency: 'INR',
  minimumMonthlyFee: '', maximumMonthlyFee: '', minimumQuarterlyFee: '', maximumQuarterlyFee: '',
  minimumYearlyFee: '', maximumYearlyFee: '', invoiceName: '', invoiceAddress: '', invoiceTaxId: '',
};

function dashboardPath(role: Role) {
  return role === 'SUPER_ADMIN' ? '/super-admin/dashboard' : role === 'ORG_ADMIN' ? '/org-admin' : '/tutor';
}

function filterQuery(filters: Filters) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) if (value) query.set(key, value);
  return query.toString();
}

function settingsFromData(data: ManagementData['organization']): SettingsForm {
  if (!data) return emptySettings;
  return {
    paymentsEnabled: data.paymentsEnabled,
    currency: data.currency,
    minimumMonthlyFee: data.minimumMonthlyFee?.toString() ?? '',
    maximumMonthlyFee: data.maximumMonthlyFee?.toString() ?? '',
    minimumQuarterlyFee: data.minimumQuarterlyFee?.toString() ?? '',
    maximumQuarterlyFee: data.maximumQuarterlyFee?.toString() ?? '',
    minimumYearlyFee: data.minimumYearlyFee?.toString() ?? '',
    maximumYearlyFee: data.maximumYearlyFee?.toString() ?? '',
    invoiceName: data.invoiceName ?? '',
    invoiceAddress: data.invoiceAddress ?? '',
    invoiceTaxId: data.invoiceTaxId ?? '',
  };
}

function numberOrNull(value: string) {
  return value.trim() ? Number(value) : null;
}

export function PaymentsManagementPage() {
  const { user } = useAuth();
  const role = user?.role ?? 'STUDENT';
  const queryClient = useQueryClient();
  const isTutor = role === 'TUTOR';
  const isOrgAdmin = role === 'ORG_ADMIN';
  const isSuperAdmin = role === 'SUPER_ADMIN';
  const [filters, setFilters] = useState(initialFilters);
  const [settings, setSettings] = useState(emptySettings);
  const [courseId, setCourseId] = useState('');
  const [period, setPeriod] = useState<Plan['period']>('MONTHLY');
  const [price, setPrice] = useState('');
  const [pendingAction, setPendingAction] = useState<{ kind: 'subscription' | 'refund'; payment: PaymentRecord; nextStatus?: 'ACTIVE' | 'INACTIVE' } | null>(null);
  const [reason, setReason] = useState('');
  const [registrationStatus, setRegistrationStatus] = useState('');
  const [registrationOrganization, setRegistrationOrganization] = useState('');
  const [registrationFrom, setRegistrationFrom] = useState('');
  const [registrationTo, setRegistrationTo] = useState('');
  const [pendingRegistrationRefund, setPendingRegistrationRefund] = useState<RegistrationPaymentRecord | null>(null);
  const [registrationRefundReason, setRegistrationRefundReason] = useState('');
  const [notice, setNotice] = useState('');
  const queryString = useMemo(() => filterQuery(filters), [filters]);
  const query = useQuery({
    queryKey: ['payment-management', role, queryString],
    queryFn: () => api<ManagementData>(`/payments/management${queryString ? `?${queryString}` : ''}`),
    enabled: isTutor || isOrgAdmin || isSuperAdmin,
  });
  const registrationQueryString = useMemo(() => {
    const params = new URLSearchParams();
    if (registrationStatus) params.set('status', registrationStatus);
    if (registrationOrganization) params.set('organizationId', registrationOrganization);
    if (registrationFrom) params.set('from', registrationFrom);
    if (registrationTo) params.set('to', registrationTo);
    return params.toString();
  }, [registrationFrom, registrationOrganization, registrationStatus, registrationTo]);
  const registrationPaymentsQuery = useQuery({
    queryKey: ['registration-payments', registrationQueryString],
    queryFn: () => api<{ payments: RegistrationPaymentRecord[] }>(`/payments/registration${registrationQueryString ? `?${registrationQueryString}` : ''}`),
    enabled: isOrgAdmin || isSuperAdmin,
  });
  const data = query.data;
  const currency = data?.organization?.currency ?? data?.organizations[0]?.currency ?? 'INR';

  useEffect(() => {
    if (data?.organization) setSettings(settingsFromData(data.organization));
  }, [data?.organization]);

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['payment-management'] }),
      queryClient.invalidateQueries({ queryKey: ['registration-payments'] }),
    ]);
  };
  const mutation = useMutation({
    mutationFn: async ({ path, method, body }: { path: string; method: 'PUT'; body: unknown }) =>
      api(path, { method, body: JSON.stringify(body) }),
    onSuccess: async () => { setNotice('Payment settings updated.'); await refresh(); },
    onError: (error) => setNotice(error instanceof Error ? error.message : 'Unable to update payment information.'),
  });
  const registrationPaymentMutation = useMutation({
    mutationFn: ({ paymentId, action, refundReason }: { paymentId: string; action: 'confirm' | 'refund'; refundReason?: string }) =>
      api(`/payments/registration/${paymentId}/${action}`, {
        method: 'PUT',
        ...(action === 'refund' ? { body: JSON.stringify({ reason: refundReason }) } : {}),
      }),
    onSuccess: async (_result, variables) => {
      setNotice(variables.action === 'confirm' ? 'Offline registration payment recorded.' : 'Offline registration refund recorded.');
      setPendingRegistrationRefund(null);
      setRegistrationRefundReason('');
      await refresh();
    },
    onError: (error) => setNotice(error instanceof Error ? error.message : 'Unable to update the registration payment.'),
  });

  const submitPrice = (event: FormEvent) => {
    event.preventDefault();
    if (!courseId || !price) return;
    mutation.mutate({ path: '/payments/tutor/plans', method: 'PUT', body: { courseId, period, price: Number(price) } });
  };

  const submitSettings = (event: FormEvent) => {
    event.preventDefault();
    mutation.mutate({
      path: '/payments/organization/settings',
      method: 'PUT',
      body: {
        paymentsEnabled: settings.paymentsEnabled,
        currency: settings.currency.toUpperCase(),
        minimumMonthlyFee: numberOrNull(settings.minimumMonthlyFee),
        maximumMonthlyFee: numberOrNull(settings.maximumMonthlyFee),
        minimumQuarterlyFee: numberOrNull(settings.minimumQuarterlyFee),
        maximumQuarterlyFee: numberOrNull(settings.maximumQuarterlyFee),
        minimumYearlyFee: numberOrNull(settings.minimumYearlyFee),
        maximumYearlyFee: numberOrNull(settings.maximumYearlyFee),
        invoiceName: settings.invoiceName || null,
        invoiceAddress: settings.invoiceAddress || null,
        invoiceTaxId: settings.invoiceTaxId || null,
      },
    });
  };

  const exportCsv = async () => {
    try {
      await downloadBlob(await apiBlob(`/payments/management/export.csv${queryString ? `?${queryString}` : ''}`), 'course-payments.csv');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Unable to export payments.');
    }
  };

  const downloadRegistrationReceipt = async (paymentId: string, filename: string) => {
    try {
      await downloadBlob(await apiBlob(`/payments/registration/${paymentId}/receipt`), filename);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Unable to open the registration receipt.');
    }
  };

  const submitAction = (event: FormEvent) => {
    event.preventDefault();
    if (!pendingAction || reason.trim().length < 3) return;
    const request = pendingAction.kind === 'refund'
      ? { path: `/payments/organization/payments/${pendingAction.payment.id}/refund`, method: 'PUT' as const, body: { reason } }
      : { path: `/payments/subscriptions/${pendingAction.payment.subscription?.id}/status`, method: 'PUT' as const, body: { status: pendingAction.nextStatus, reason } };
    mutation.mutate(request, { onSuccess: async () => { setPendingAction(null); setReason(''); await refresh(); } });
  };

  if (!user || (!isTutor && !isOrgAdmin && !isSuperAdmin)) {
    return <p className="notice notice-error">You do not have permission to view payment management.</p>;
  }

  const title = isTutor ? 'My Fees and Earnings' : 'Payments';
  return (
    <div className="portal-layout">
      <PortalSidebar role={role} />
      <section className="portal-content payments-management">
        <PageHeader title={title} backTo={dashboardPath(role)} breadcrumbs={['Payments', title]} />
        {data?.demoMode && <p className="notice notice-warning payment-demo-banner"><strong>DEMO MODE: no real money</strong> — payment activity shown here is for development only.</p>}
        {notice && <p className="notice notice-info" role="status">{notice}</p>}
        {query.isLoading && <p className="loading">Loading payment information…</p>}
        {query.isError && <p className="notice notice-error" role="alert">{query.error instanceof Error ? query.error.message : 'Unable to load payment information.'}</p>}
        {data && <>
          <section className="payment-summary-grid" aria-label="Payment summaries">
            {(isTutor
              ? [
                ['Students paid', data.summary.uniquePayingStudents],
                ['Active subscriptions', data.summary.activeSubscriptions],
                ['Expired subscriptions', data.summary.expiredSubscriptions],
                ['Pending renewals', data.summary.pendingRenewals],
                ['Collected this month', formatMoney(data.summary.revenueThisMonth, currency)],
                ['Collected all time', formatMoney(data.summary.revenueAllTime, currency)],
              ]
              : [
                ['Revenue this month', formatMoney(data.summary.revenueThisMonth, currency)],
                ['Revenue all time', formatMoney(data.summary.revenueAllTime, currency)],
                ['Monthly plan revenue', formatMoney(data.summary.revenueByPeriod.MONTHLY, currency)],
                ['Quarterly plan revenue', formatMoney(data.summary.revenueByPeriod.QUARTERLY, currency)],
                ['Yearly plan revenue', formatMoney(data.summary.revenueByPeriod.YEARLY, currency)],
                ['Active subscriptions', data.summary.activeSubscriptions],
                ['Inactive subscriptions', data.summary.inactiveSubscriptions],
                ['Failed payments', data.summary.failedPayments],
                ['Refunds', data.summary.refunds],
                ...(isSuperAdmin ? [['Newest payment', data.payments[0] ? formatDate(data.payments[0].createdAt) : '—']] : []),
              ]).map(([label, value]) => <article className="card payment-summary-card" key={label}><span>{label}</span><strong>{value}</strong></article>)}
          </section>

          {isTutor && <section className="card payment-module-section">
            <h2>Course fees</h2>
            <p className="muted">Set your price for each assigned course and billing period. A change applies to new payments; existing subscriptions keep their paid dates and amounts.</p>
            {data.courses.length === 0
              ? <p className="empty-state">No assigned courses are available for fee pricing.</p>
              : <form className="payment-price-form" onSubmit={submitPrice}>
                <label className="field">Course<select className="input" value={courseId} onChange={(event) => setCourseId(event.target.value)} required>
                  <option value="">Choose course</option>{data.courses.map((course) => <option key={course.id} value={course.id}>{course.code} — {course.title}</option>)}
                </select></label>
                <label className="field">Period<select className="input" value={period} onChange={(event) => setPeriod(event.target.value as Plan['period'])}>
                  {periods.map((value) => <option value={value} key={value}>{periodLabel(value)}</option>)}
                </select></label>
                <label className="field">Price<input className="input" type="number" min="0.01" step="0.01" value={price} onChange={(event) => setPrice(event.target.value)} required /></label>
                <Button disabled={mutation.isPending}><Save size={16} aria-hidden="true" /> Save price</Button>
              </form>}
            <div className="payment-course-breakdown">
              {data.byCourse.map(({ course, amount, count }) => <article className="card payment-course-summary" key={course.id}>
                <h3>{course.code} — {course.title}</h3><span>{count} paid payments</span><strong>{formatMoney(amount, currency)}</strong>
                <p>{data.summary.activeSubscriptions} active · {data.summary.pendingRenewals} renewal(s) due soon</p>
              </article>)}
            </div>
          </section>}

          {(isOrgAdmin || isSuperAdmin) && <section className="card payment-module-section">
            <div className="payment-section-heading"><div><h2>{isSuperAdmin ? 'Organizations' : 'Tutor fee acceptance'}</h2><p className="muted">{isSuperAdmin ? 'Enable or pause course fee payments for each organization.' : 'Pause new fee payments for a Tutor without changing existing subscriptions.'}</p></div></div>
            {isSuperAdmin
              ? <div className="table-scroll"><table className="data-table"><thead><tr><th>Organization</th><th>Code</th><th>Revenue</th><th>Payments</th><th>Active subscriptions</th><th>Payments</th></tr></thead><tbody>
                {data.organizations.map((organization) => <tr key={organization.id}><td>{organization.name}</td><td>{organization.code}</td><td>{formatMoney(organization.totals.revenue, organization.currency)}</td><td>{organization.totals.payments}</td><td>{organization.totals.activeSubscriptions}</td><td><button className={`button ${organization.paymentsEnabled ? 'button-danger' : 'button-primary'}`} type="button" onClick={() => mutation.mutate({ path: `/payments/platform/organizations/${organization.id}/payments`, method: 'PUT', body: { paymentsEnabled: !organization.paymentsEnabled } })}>{organization.paymentsEnabled ? 'Turn off' : 'Turn on'}</button></td></tr>)}
              </tbody></table></div>
              : <div className="payment-tutor-switches">{data.tutors.map((tutor) => <label key={tutor.id} className="checkbox-field card">
                <input type="checkbox" checked={tutor.acceptsNewFees} onChange={(event) => mutation.mutate({ path: `/payments/organization/tutors/${tutor.id}/fee-acceptance`, method: 'PUT', body: { acceptsNewFees: event.target.checked } })} />
                <span><strong>{tutor.name}</strong> · {tutor.tutorId}<small>{tutor.acceptsNewFees ? 'Accepting new course fee payments' : 'Not accepting new course fee payments'}</small></span>
              </label>)}</div>}
          </section>}

          {(isOrgAdmin || isSuperAdmin) && data.organization && <form className="card payment-module-section payment-settings-form" onSubmit={submitSettings}>
            <h2>Payment settings</h2>
            <label className="checkbox-field"><input type="checkbox" checked={settings.paymentsEnabled} onChange={(event) => setSettings({ ...settings, paymentsEnabled: event.target.checked })} /><span>Enable course fee payments for this organization</span></label>
            <div className="payment-settings-grid">
              <label className="field">Currency<input className="input" value={settings.currency} maxLength={3} onChange={(event) => setSettings({ ...settings, currency: event.target.value })} required /></label>
              {(['Monthly', 'Quarterly', 'Yearly'] as const).map((label) => <div className="payment-bound-fields" key={label}>
                <strong>{label} bounds</strong>
                <label className="field">Minimum<input className="input" type="number" min="0" step="0.01" value={settings[`minimum${label}Fee`]} onChange={(event) => setSettings({ ...settings, [`minimum${label}Fee`]: event.target.value })} /></label>
                <label className="field">Maximum<input className="input" type="number" min="0.01" step="0.01" value={settings[`maximum${label}Fee`]} onChange={(event) => setSettings({ ...settings, [`maximum${label}Fee`]: event.target.value })} /></label>
              </div>)}
              <label className="field">Invoice name<input className="input" value={settings.invoiceName} onChange={(event) => setSettings({ ...settings, invoiceName: event.target.value })} /></label>
              <label className="field">Invoice tax ID<input className="input" value={settings.invoiceTaxId} onChange={(event) => setSettings({ ...settings, invoiceTaxId: event.target.value })} /></label>
              <label className="field payment-invoice-address">Invoice address<textarea className="input" value={settings.invoiceAddress} onChange={(event) => setSettings({ ...settings, invoiceAddress: event.target.value })} /></label>
            </div>
            <Button disabled={mutation.isPending}>Save payment settings</Button>
          </form>}

          {isTutor && data.priceHistory.length > 0 && <section className="card payment-module-section">
            <h2>Price history</h2><div className="table-scroll"><table className="data-table"><thead><tr><th>Course</th><th>Period</th><th>Previous price</th><th>New price</th><th>Changed by</th><th>Date</th></tr></thead><tbody>
              {data.priceHistory.map((item) => <tr key={item.id}><td>{item.course.code} — {item.course.title}</td><td>{periodLabel(item.period)}</td><td>{item.previousPrice === null ? '—' : formatMoney(item.previousPrice, currency)}</td><td>{formatMoney(item.newPrice, currency)}</td><td>{item.changedBy}</td><td>{formatDate(item.createdAt)}</td></tr>)}
            </tbody></table></div>
          </section>}

          {isOrgAdmin && data.plans.length > 0 && <section className="card payment-module-section">
            <h2>Tutor prices and overrides</h2><div className="table-scroll"><table className="data-table"><thead><tr><th>Tutor</th><th>Course</th><th>Period</th><th>Current price</th><th>Override price</th><th>Action</th></tr></thead><tbody>
              {data.plans.map((plan) => <PlanPriceRow key={plan.id} plan={plan} currency={currency} pending={mutation.isPending} onSave={(newPrice, overrideReason) => mutation.mutate({ path: `/payments/organization/plans/${plan.id}/price`, method: 'PUT', body: { price: newPrice, reason: overrideReason } })} />)}
            </tbody></table></div>
          </section>}

          {data.byTutor.length > 0 && <section className="card payment-module-section">
            <h2>Revenue by Tutor</h2><div className="table-scroll"><table className="data-table"><thead><tr><th>Tutor</th><th>Tutor ID</th><th>Paid payments</th><th>Collected</th></tr></thead><tbody>
              {data.byTutor.map((item) => <tr key={item.tutor.id}><td>{item.tutor.name}</td><td>{item.tutor.tutorId}</td><td>{item.count}</td><td>{formatMoney(item.amount, currency)}</td></tr>)}
            </tbody></table></div>
          </section>}

          <section className="card payment-module-section">
            <div className="payment-section-heading"><div><h2>{isTutor ? 'Students who paid' : 'Course payments'}</h2><p className="muted">Review payment status, course period, and subscription access.</p></div><Button variant="secondary" type="button" onClick={() => void exportCsv()}><Download size={16} aria-hidden="true" /> Export CSV</Button></div>
            <div className="payment-filters">
              {isSuperAdmin && <label className="field">Organization<select className="input" value={filters.organizationId} onChange={(event) => setFilters({ ...filters, organizationId: event.target.value })}><option value="">All organizations</option>{data.organizations.map((item) => <option key={item.id} value={item.id}>{item.name} ({item.code})</option>)}</select></label>}
              {!isTutor && <label className="field">Tutor<select className="input" value={filters.tutorId} onChange={(event) => setFilters({ ...filters, tutorId: event.target.value })}><option value="">All Tutors</option>{data.tutors.map((item) => <option key={item.id} value={item.id}>{item.name} ({item.tutorId})</option>)}</select></label>}
              <label className="field">Course<select className="input" value={filters.courseId} onChange={(event) => setFilters({ ...filters, courseId: event.target.value })}><option value="">All courses</option>{data.courses.map((item) => <option key={item.id} value={item.id}>{item.code} — {item.title}</option>)}</select></label>
              {!isTutor && <label className="field">Status<select className="input" value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}><option value="">All statuses</option>{['PAID', 'FAILED', 'REFUNDED', 'CREATED'].map((status) => <option key={status}>{status}</option>)}</select></label>}
              <label className="field">From<input className="input" type="date" value={filters.from} onChange={(event) => setFilters({ ...filters, from: event.target.value })} /></label>
              <label className="field">To<input className="input" type="date" value={filters.to} onChange={(event) => setFilters({ ...filters, to: event.target.value })} /></label>
              <Button type="button" variant="secondary" onClick={() => setFilters(initialFilters)}>Clear filters</Button>
            </div>
            <div className="table-scroll"><table className="data-table payment-records-table"><thead><tr>
              {isSuperAdmin && <th>Organization</th>}<th>Payment ID</th><th>Student</th><th>Student ID</th><th>Tutor</th><th>Tutor ID</th><th>Course</th><th>Period</th><th>Periods</th><th>Amount</th><th>Status</th><th>Subscription</th><th>Paid on</th><th>Actions</th>
            </tr></thead><tbody>
              {data.payments.map((payment) => <tr key={payment.id}>
                {isSuperAdmin && <td>{payment.organization?.name} ({payment.organization?.code})</td>}
                <td>{payment.id}</td>
                <td>{payment.student.name}</td><td>{payment.student.studentId}</td><td>{payment.tutor.name}</td><td>{payment.tutor.tutorId}</td>
                <td>{payment.course.code} — {payment.course.title}</td><td>{periodLabel(payment.period)}: {formatDate(payment.periodStart)} – {formatDate(payment.periodEnd)}</td><td>{payment.periodsCount}</td>
                <td>{formatMoney(payment.amount, payment.currency)}</td><td><span className={`payment-status payment-status-${payment.status.toLowerCase()}`}>{payment.status}</span></td>
                <td>{payment.subscription ? `${payment.subscription.status} · ${formatDate(payment.subscription.endsAt)}` : '—'}</td><td>{formatDate(payment.createdAt)}</td>
                <td><div className="payment-row-actions">
                  {payment.subscription && !isTutor && <Button type="button" variant="secondary" onClick={() => { setReason(''); setPendingAction({ kind: 'subscription', payment, nextStatus: payment.subscription?.status === 'INACTIVE' ? 'ACTIVE' : 'INACTIVE' }); }}>{payment.subscription.status === 'INACTIVE' ? 'Activate' : 'Deactivate'}</Button>}
                  {isOrgAdmin && payment.status === 'PAID' && <Button type="button" variant="danger" onClick={() => { setReason(''); setPendingAction({ kind: 'refund', payment }); }}>Refund</Button>}
                </div></td>
              </tr>)}
              {data.payments.length === 0 && <tr><td colSpan={isSuperAdmin ? 14 : 13} className="report-empty">No payments match these filters.</td></tr>}
            </tbody></table></div>
          </section>

          {(isOrgAdmin || isSuperAdmin) && <section id="registration-payments" className="card payment-module-section">
            <div className="payment-section-heading">
              <div><h2>Registration payments</h2><p className="muted">Confirming a Student payment activates the account immediately. A Tutor payment confirmation sends the application to Org Admin for manual approval. Refunds remain available for rejected paid registrations.</p></div>
            </div>
            <div className="payment-filters">
              {isSuperAdmin && <label className="field">Organization<select className="input" value={registrationOrganization} onChange={(event) => setRegistrationOrganization(event.target.value)}>
                <option value="">All organizations</option>{data?.organizations.map((item) => <option key={item.id} value={item.id}>{item.name} ({item.code})</option>)}
              </select></label>}
              <label className="field">Payment status<select className="input" value={registrationStatus} onChange={(event) => setRegistrationStatus(event.target.value)}>
                <option value="">All statuses</option><option value="PENDING">Pending</option><option value="PAID">Paid</option><option value="REFUNDED">Refunded</option>
              </select></label>
              <label className="field">Submitted from<input className="input" type="date" value={registrationFrom} onChange={(event) => setRegistrationFrom(event.target.value)} /></label>
              <label className="field">Submitted to<input className="input" type="date" value={registrationTo} onChange={(event) => setRegistrationTo(event.target.value)} /></label>
              <Button type="button" variant="secondary" onClick={() => { setRegistrationStatus(''); setRegistrationOrganization(''); setRegistrationFrom(''); setRegistrationTo(''); }}>Clear filters</Button>
            </div>
            {registrationPaymentsQuery.isLoading && <p className="loading">Loading registration payments…</p>}
            {registrationPaymentsQuery.error && <p className="notice notice-error" role="alert">{registrationPaymentsQuery.error instanceof Error ? registrationPaymentsQuery.error.message : 'Registration payments could not be loaded.'}</p>}
            {registrationPaymentsQuery.data && <div className="table-scroll"><table className="data-table">
              <thead><tr>{isSuperAdmin && <th>Organization</th>}<th>Applicant</th><th>Role</th><th>Applicant ID</th><th>Course</th><th>Amount</th><th>Method</th><th>Transaction reference</th><th>Receipt</th><th>Applicant payment claim</th><th>Payment status</th><th>Account status</th><th>Submitted</th><th>Payment recorded</th><th>Refund reason</th><th>Actions</th></tr></thead>
              <tbody>
                {registrationPaymentsQuery.data.payments.map((payment) => (
                  <tr key={payment.id}>
                    {isSuperAdmin && <td>{payment.organization.name} ({payment.organization.code})</td>}
                    <td>{payment.applicant.name}</td><td>{payment.applicantRole}</td><td>{payment.applicant.applicantId}</td>
                    <td>{payment.course.code} — {payment.course.title}</td>
                    <td>{formatMoney(payment.amount, payment.currency)}</td>
                    <td>{payment.paymentMethod?.replaceAll('_', ' ') ?? 'Legacy record'}</td>
                    <td>{payment.transactionReference ?? '—'}</td>
                    <td>{payment.receiptOriginalName
                      ? <Button type="button" variant="secondary" onClick={() => void downloadRegistrationReceipt(payment.id, payment.receiptOriginalName ?? 'registration-receipt')}>View receipt</Button>
                      : '—'}</td>
                    <td>{payment.reportedPaid ? 'Paid (applicant reported)' : 'Not Paid (applicant reported)'}</td>
                    <td><span className={`payment-status payment-status-${payment.status.toLowerCase()}`}>{payment.status === 'PENDING' ? 'Pending Verification' : payment.status}</span></td>
                    <td>{payment.applicant.status === 'PENDING_PAYMENT' ? 'Pending Payment' : payment.applicant.status === 'PENDING' ? 'Pending Review' : payment.applicant.status}</td>
                    <td>{formatDate(payment.createdAt)}</td><td>{payment.paidAt ? formatDate(payment.paidAt) : payment.refundedAt ? formatDate(payment.refundedAt) : '—'}</td>
                    <td>{payment.refundReason ?? '—'}</td>
                    <td><div className="payment-row-actions">
                      {payment.status === 'PENDING' && payment.applicant.status === 'PENDING_PAYMENT' && (payment.reportedPaid || payment.paymentMethod === null) && <Button type="button" disabled={registrationPaymentMutation.isPending} onClick={() => {
                        if (window.confirm(`Confirm receipt of ${formatMoney(payment.amount, payment.currency)} for ${payment.applicant.name}?`)) {
                          registrationPaymentMutation.mutate({ paymentId: payment.id, action: 'confirm' });
                        }
                      }}>Confirm Payment</Button>}
                      {isOrgAdmin && payment.status === 'PAID' && payment.applicant.status === 'REJECTED' && <Button type="button" variant="secondary" onClick={() => {
                        setRegistrationRefundReason('');
                        setPendingRegistrationRefund(payment);
                      }}>Record offline refund</Button>}
                    </div></td>
                  </tr>
                ))}
                {registrationPaymentsQuery.data.payments.length === 0 && <tr><td colSpan={isSuperAdmin ? 16 : 15} className="report-empty">No registrations match these filters.</td></tr>}
              </tbody>
            </table></div>}
          </section>}

          {pendingAction && <div className="dialog-backdrop" role="presentation"><form className="dialog payment-reason-dialog" role="dialog" aria-modal="true" aria-labelledby="payment-action-title" onSubmit={submitAction}>
            <h2 id="payment-action-title">{pendingAction.kind === 'refund' ? 'Refund payment' : pendingAction.nextStatus === 'INACTIVE' ? 'Deactivate subscription' : 'Reactivate subscription'}</h2>
            <p>{pendingAction.payment.student.name} · {pendingAction.payment.course.title}</p>
            <label className="field">Reason<textarea className="input" value={reason} onChange={(event) => setReason(event.target.value)} minLength={3} maxLength={500} required /></label>
            <div className="button-row"><Button type="submit" disabled={mutation.isPending || reason.trim().length < 3}>Confirm</Button><Button type="button" variant="secondary" onClick={() => setPendingAction(null)}>Cancel</Button></div>
          </form></div>}
          {pendingRegistrationRefund && <div className="dialog-backdrop" role="presentation"><form className="dialog payment-reason-dialog" role="dialog" aria-modal="true" aria-labelledby="registration-refund-title" onSubmit={(event) => {
            event.preventDefault();
            if (registrationRefundReason.trim().length < 3) return;
            registrationPaymentMutation.mutate({
              paymentId: pendingRegistrationRefund.id,
              action: 'refund',
              refundReason: registrationRefundReason.trim(),
            });
          }}>
            <h2 id="registration-refund-title">Record offline refund</h2>
            <p>{pendingRegistrationRefund.applicant.name} · {pendingRegistrationRefund.course.title} · {formatMoney(pendingRegistrationRefund.amount, pendingRegistrationRefund.currency)}</p>
            <label className="field">Reason<textarea className="input" value={registrationRefundReason} onChange={(event) => setRegistrationRefundReason(event.target.value)} minLength={3} maxLength={500} required /></label>
            <div className="button-row"><Button type="submit" disabled={registrationPaymentMutation.isPending || registrationRefundReason.trim().length < 3}>Record refund</Button><Button type="button" variant="secondary" onClick={() => setPendingRegistrationRefund(null)}>Cancel</Button></div>
          </form></div>}
        </>}
      </section>
    </div>
  );
}

function PlanPriceRow({ plan, currency, pending, onSave }: {
  plan: Plan;
  currency: string;
  pending: boolean;
  onSave: (price: number, reason: string) => void;
}) {
  const [value, setValue] = useState(String(plan.price));
  const [reason, setReason] = useState('');
  return <tr>
    <td>{plan.tutor.name} ({plan.tutor.tutorId}){!plan.acceptsNewFees && <small className="payment-plan-note">Not accepting new fees</small>}</td>
    <td>{plan.course.code} — {plan.course.title}</td><td>{periodLabel(plan.period)}</td><td>{formatMoney(plan.price, currency)}</td>
    <td><input aria-label={`Override price for ${plan.course.title} ${plan.period}`} className="input payment-override-price" type="number" min="0.01" step="0.01" value={value} onChange={(event) => setValue(event.target.value)} /></td>
    <td><div className="payment-row-actions"><input className="input payment-override-reason" aria-label={`Override reason for ${plan.course.title} ${plan.period}`} placeholder="Reason" value={reason} onChange={(event) => setReason(event.target.value)} /><Button type="button" disabled={pending || !reason.trim() || Number(value) <= 0} onClick={() => onSave(Number(value), reason)}>Override</Button></div></td>
  </tr>;
}
