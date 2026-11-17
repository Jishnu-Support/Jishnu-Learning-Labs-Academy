import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { PageHeader } from '../components/page-header';
import { PortalSidebar } from '../components/portal-sidebar';
import { api, ApiError } from '../lib/api';
import { buildReportsChart, summarizeSubjects, type StudentReport } from './student-reports-utils';

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value));
}

export function StudentReportsPage() {
  const reports = useQuery({
    queryKey: ['student-reports'],
    queryFn: () => api<{ studentReports: StudentReport[] }>('/portal/student/reports'),
    refetchInterval: 24 * 60 * 60 * 1000,
    refetchOnWindowFocus: true,
  });
  const studentReports = reports.data?.studentReports ?? EMPTY_REPORTS;
  const chartData = useMemo(() => buildReportsChart(studentReports), [studentReports]);
  const reportSubjects = useMemo(() => [...new Set(studentReports.map((report) => report.subject))], [studentReports]);
  const subjects = useMemo(() => summarizeSubjects(studentReports), [studentReports]);
  const today = formatDate(new Date().toISOString());
  const firstResultDate = studentReports.length ? formatDate(studentReports[0]!.date) : today;

  return <div className="portal-layout">
    <PortalSidebar role="STUDENT" />
    <section className="portal-content student-reports-page">
      <PageHeader title="My Reports" backTo="/student/courses" breadcrumbs={['My Course', 'My Reports']} />
      <p className="muted">Your released assessment marks and progress from your first result through today.</p>
      {reports.isError && <p className="notice notice-error" role="alert">{reports.error instanceof ApiError ? reports.error.message : 'Your reports could not be loaded.'}</p>}
      {reports.isLoading && <p className="loading">Loading your assessment results…</p>}
      {reports.data && studentReports.length === 0 && <div className="card empty-state"><h2>No released marks yet</h2><p>Released assessment results will appear here as you complete assessments.</p></div>}
      {studentReports.length > 0 && <>
        <section className="card report-chart-card">
          <div className="report-card-heading"><div><h2>Marks over time</h2><p className="muted">{firstResultDate} – {today}</p></div><span className="report-refresh-note">Refreshes daily</span></div>
          <div className="student-report-chart" role="img" aria-label="Line chart of your assessment marks over time">
            <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={240}>
              <LineChart data={chartData} margin={{ top: 16, right: 12, bottom: 8, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
                <XAxis dataKey="chartDate" minTickGap={22} tick={{ fill: 'var(--text-secondary)', fontSize: 12 }} />
                <YAxis allowDecimals={false} width={44} tick={{ fill: 'var(--text-secondary)', fontSize: 12 }} />
                <Tooltip formatter={(value) => [`${Number(value)} marks`, 'Score']} labelFormatter={(label) => String(label)} />
                <Legend />
                {reportSubjects.map((subject, index) => <Line
                  key={subject}
                  type="monotone"
                  dataKey={subject}
                  name={subject}
                  connectNulls
                  stroke={['var(--brand-magenta)', 'var(--brand-navy)', 'var(--status-amber)', 'var(--status-red)'][index % 4]}
                  strokeWidth={3}
                  dot={{ r: 4 }}
                  activeDot={{ r: 6 }}
                />)}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>
        <section className="stats-grid subject-summary-grid" aria-label="Subject performance">
          <article className="card stat-card"><p className="eyebrow">Strongest subject</p><h2>{subjects[0]?.subject ?? '—'}</h2><p>{subjects[0] ? `${subjects[0].average.toFixed(1)}% average · ${subjects[0].attempts} result${subjects[0].attempts === 1 ? '' : 's'}` : 'No results yet'}</p></article>
          <article className="card stat-card"><p className="eyebrow">Weakest subject</p><h2>{subjects[subjects.length - 1]?.subject ?? '—'}</h2><p>{subjects.at(-1) ? `${subjects.at(-1)!.average.toFixed(1)}% average · ${subjects.at(-1)!.attempts} result${subjects.at(-1)!.attempts === 1 ? '' : 's'}` : 'No results yet'}</p></article>
        </section>
        <section className="card student-report-list">
          <h2>Assessment results</h2>
          <div className="student-report-rows">{studentReports.map((report, index) => <article className="student-report-row" key={`${report.date}-${report.subject}-${index}`}>
            <span>{formatDate(report.date)}</span><strong>{report.subject}</strong><span>{report.marks} / {report.totalMarks} marks</span>
          </article>)}</div>
        </section>
      </>}
    </section>
  </div>;
}

const EMPTY_REPORTS: StudentReport[] = [];
