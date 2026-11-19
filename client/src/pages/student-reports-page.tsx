import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api, ApiError } from '../lib/api';
import { buildWeeklyReportsChart, summarizeSubjects, type StudentReport } from './student-reports-utils';

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value));
}

export function StudentReportsPage({ embeddedCourseId }: { embeddedCourseId: string }) {
  const reports = useQuery({
    queryKey: ['student-reports', embeddedCourseId],
    queryFn: () => api<{ studentReports: StudentReport[] }>(`/portal/student/reports?courseId=${encodeURIComponent(embeddedCourseId)}`),
    refetchInterval: 24 * 60 * 60 * 1000,
    refetchOnWindowFocus: true,
  });
  const releasedReports = reports.data?.studentReports ?? EMPTY_REPORTS;
  const isSampleReport = Boolean(reports.data) && releasedReports.length === 0;
  const studentReports = isSampleReport ? SAMPLE_REPORTS : releasedReports;
  const chartData = useMemo(() => buildWeeklyReportsChart(studentReports), [studentReports]);
  const reportSubjects = useMemo(() => [...new Set(studentReports.map((report) => report.subject))], [studentReports]);
  const subjects = useMemo(() => summarizeSubjects(studentReports), [studentReports]);

  return <section className="course-section student-reports-page">
      <h2>Evaluation reports</h2>
      <p className="muted">Your released assessment marks by course week, from Week 1 through your latest result.</p>
      {reports.isError && <p className="notice notice-error" role="alert">{reports.error instanceof ApiError ? reports.error.message : 'Your reports could not be loaded.'}</p>}
      {reports.isLoading && <p className="loading">Loading your assessment results…</p>}
      {isSampleReport && <p className="notice notice-info" role="status">Sample report preview — no released marks are available for this course yet.</p>}
      {studentReports.length > 0 && <>
        <section className="card report-chart-card">
          <div className="report-card-heading"><div><h3>{isSampleReport ? 'Sample student growth' : 'Marks by week'}</h3><p className="muted">Week 1 – Week {chartData.length}</p></div><span className="report-refresh-note">{isSampleReport ? 'Sample data only' : 'Refreshes daily'}</span></div>
          <div className="student-report-chart" role="img" aria-label="Line chart of your assessment marks from week one through the latest result">
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
            <span>{report.week ? `Week ${report.week} · ` : ''}{formatDate(report.date)}</span><strong>{report.subject}</strong><span>{report.marks} / {report.totalMarks} marks</span>
          </article>)}</div>
        </section>
      </>}
    </section>;
}

const EMPTY_REPORTS: StudentReport[] = [];
const SAMPLE_REPORTS: StudentReport[] = [
  { week: 1, date: '2026-10-05T00:00:00.000Z', subject: 'HTML', marks: 58, totalMarks: 100, percentage: 58 },
  { week: 2, date: '2026-10-12T00:00:00.000Z', subject: 'HTML', marks: 66, totalMarks: 100, percentage: 66 },
  { week: 3, date: '2026-10-19T00:00:00.000Z', subject: 'HTML', marks: 72, totalMarks: 100, percentage: 72 },
  { week: 4, date: '2026-10-26T00:00:00.000Z', subject: 'HTML', marks: 78, totalMarks: 100, percentage: 78 },
  { week: 5, date: '2026-11-02T00:00:00.000Z', subject: 'HTML', marks: 82, totalMarks: 100, percentage: 82 },
  { week: 6, date: '2026-11-09T00:00:00.000Z', subject: 'HTML', marks: 88, totalMarks: 100, percentage: 88 },
  { week: 1, date: '2026-10-05T00:00:00.000Z', subject: 'CSS', marks: 52, totalMarks: 100, percentage: 52 },
  { week: 2, date: '2026-10-12T00:00:00.000Z', subject: 'CSS', marks: 61, totalMarks: 100, percentage: 61 },
  { week: 3, date: '2026-10-19T00:00:00.000Z', subject: 'CSS', marks: 68, totalMarks: 100, percentage: 68 },
  { week: 4, date: '2026-10-26T00:00:00.000Z', subject: 'CSS', marks: 75, totalMarks: 100, percentage: 75 },
  { week: 5, date: '2026-11-02T00:00:00.000Z', subject: 'CSS', marks: 80, totalMarks: 100, percentage: 80 },
  { week: 6, date: '2026-11-09T00:00:00.000Z', subject: 'CSS', marks: 86, totalMarks: 100, percentage: 86 },
];
