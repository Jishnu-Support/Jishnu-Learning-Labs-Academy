import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useAuth } from '../auth/auth-context';
import { PageHeader } from '../components/page-header';
import { Button } from '../components/ui/button';
import { api, apiBlob, downloadBlob, ApiError } from '../lib/api';

type ReportStatus = 'COMPLETED' | 'IN_PROGRESS' | 'NOT_ATTEMPTED';
type ReportRow = {
  studentId: string;
  studentName: string;
  courseId: string;
  course: string;
  assessmentId: string;
  assessment: string;
  totalMarks: number;
  level: string;
  attempts: number;
  bestScore: number | null;
  percentage: number | null;
  grade: string;
  passed: boolean | null;
  completedOn: string | null;
  status: ReportStatus;
};
type ReportData = {
  rows: ReportRow[];
  summary: { enrolled: number; completed: number; inProgress: number; notStarted: number; passed: number; failed: number; average: number; highest: number };
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
  filters: { assessments: Array<{ id: string; title: string; courseId: string }>; levels: string[] };
};
type ReportCourse = { id: string; code: string; title: string };
type StudentHistory = {
  student: { name: string; studentProfile: { studentId: string } | null };
  course: { code: string; title: string };
  assessment: { title: string; totalMarks: number; passMark: number };
  attempts: Array<{ id: string; status: string; startedAt: string; submittedAt: string | null; score: number | null; percentage: number | null; passed: boolean | null; flagged: boolean; _count: { events: number } }>;
};

const reportTabs: Array<{ label: string; value: ReportStatus }> = [
  { label: 'Completed', value: 'COMPLETED' },
  { label: 'In progress', value: 'IN_PROGRESS' },
  { label: 'Not attempted', value: 'NOT_ATTEMPTED' },
];

function dashboardPath(role?: string) {
  return role === 'ORG_ADMIN' ? '/org-admin' : '/tutor';
}

function formatError(error: unknown) {
  return error instanceof ApiError ? error.message : error instanceof Error ? error.message : 'The request could not be completed.';
}

function formatDate(value: string | null) {
  if (!value) return '—';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function sortableHeader(label: string, value: string, sortBy: string, direction: 'asc' | 'desc', onSort: (key: string) => void) {
  const marker = sortBy === value ? (direction === 'asc' ? ' ↑' : ' ↓') : '';
  return <button type="button" className="report-sort" aria-label={`Sort by ${label}`} onClick={() => onSort(value)}>{label}{marker}</button>;
}

export function AssessmentReportsPage() {
  const { user } = useAuth();
  const role = user?.role ?? 'TUTOR';
  const [courseId, setCourseId] = useState('');
  const [assessmentId, setAssessmentId] = useState('');
  const [level, setLevel] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [status, setStatus] = useState<ReportStatus>('COMPLETED');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState('student');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [selected, setSelected] = useState<ReportRow | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');

  const courses = useQuery({ queryKey: ['courses', 'assessment-reports'], queryFn: () => api<{ courses: ReportCourse[] }>('/courses') });
  const queryString = useMemo(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: '25', sortBy, sortDirection, status });
    if (courseId) params.set('courseId', courseId);
    if (assessmentId) params.set('assessmentId', assessmentId);
    if (level) params.set('level', level);
    if (dateFrom) params.set('dateFrom', dateFrom);
    if (dateTo) params.set('dateTo', dateTo);
    if (search.trim()) params.set('search', search.trim());
    return params.toString();
  }, [assessmentId, courseId, dateFrom, dateTo, level, page, search, sortBy, sortDirection, status]);
  const reports = useQuery({
    queryKey: ['learning', 'assessment-reports', queryString],
    queryFn: () => api<ReportData>(`/learning/reports?${queryString}`),
  });
  const history = useQuery({
    queryKey: ['learning', 'assessment-report-student', selected?.assessmentId, selected?.studentId],
    queryFn: () => {
      const params = new URLSearchParams({ assessmentId: selected!.assessmentId });
      return api<StudentHistory>(`/learning/reports/students/${encodeURIComponent(selected!.studentId)}?${params}`);
    },
    enabled: Boolean(selected),
  });
  const report = reports.data;
  const assessments = report?.filters.assessments.filter((item) => !courseId || item.courseId === courseId) ?? [];
  const summary = report?.summary;

  function changeFilter(change: () => void) {
    change();
    setPage(1);
  }

  function changeSort(key: string) {
    if (sortBy === key) setSortDirection((current) => current === 'asc' ? 'desc' : 'asc');
    else {
      setSortBy(key);
      setSortDirection('asc');
    }
    setPage(1);
  }

  async function exportCsv() {
    setExporting(true);
    setExportError('');
    try {
      const params = new URLSearchParams(queryString);
      params.delete('page');
      params.delete('pageSize');
      const blob = await apiBlob(`/learning/reports/export.csv?${params}`);
      await downloadBlob(blob, 'assessment-reports.csv');
    } catch (error) {
      setExportError(formatError(error));
    } finally {
      setExporting(false);
    }
  }

  return (
    <section className="portal-content assessment-reports">
      <div className="report-print-header"><h1>Assessment Reports</h1><p>Jishnu Learning Labs</p></div>
      <div className="report-screen-header">
        <PageHeader title="Assessment Reports" backTo={dashboardPath(role)} breadcrumbs={['Learning', 'Assessment Reports']} />
        <p className="muted">Review assessment participation and outcomes for your organization.</p>
      </div>

      <section className="report-summary" aria-label="Assessment report summary">
        {[
          ['Enrolled', summary?.enrolled ?? 0],
          ['Completed', summary?.completed ?? 0],
          ['In progress', summary?.inProgress ?? 0],
          ['Not started', summary?.notStarted ?? 0],
          ['Passed', summary?.passed ?? 0],
          ['Failed', summary?.failed ?? 0],
          ['Average', `${(summary?.average ?? 0).toFixed(1)}%`],
          ['Highest', `${(summary?.highest ?? 0).toFixed(1)}%`],
        ].map(([label, value]) => <article className="card report-summary-card" key={label}><span>{label}</span><strong>{value}</strong></article>)}
      </section>

      <section className="card report-filter-card" aria-label="Report filters">
        <div className="report-filters">
          <label className="field"><span>Course</span><select className="input" value={courseId} onChange={(event) => changeFilter(() => { setCourseId(event.target.value); setAssessmentId(''); })}><option value="">All courses</option>{(courses.data?.courses ?? []).map((course) => <option key={course.id} value={course.id}>{course.code} — {course.title}</option>)}</select></label>
          <label className="field"><span>Assessment</span><select className="input" value={assessmentId} onChange={(event) => changeFilter(() => setAssessmentId(event.target.value))}><option value="">All assessments</option>{assessments.map((assessment) => <option key={assessment.id} value={assessment.id}>{assessment.title}</option>)}</select></label>
          <label className="field"><span>Level</span><select className="input" value={level} onChange={(event) => changeFilter(() => setLevel(event.target.value))}><option value="">All levels</option>{(report?.filters.levels ?? []).map((item) => <option key={item} value={item}>{item.replace('_', ' ')}</option>)}</select></label>
          <label className="field"><span>From</span><input className="input" type="date" value={dateFrom} max={dateTo || undefined} onChange={(event) => changeFilter(() => setDateFrom(event.target.value))} /></label>
          <label className="field"><span>To</span><input className="input" type="date" value={dateTo} min={dateFrom || undefined} onChange={(event) => changeFilter(() => setDateTo(event.target.value))} /></label>
          <label className="field report-search"><span>Search student</span><input className="input" type="search" placeholder="Name or Student ID" value={search} onChange={(event) => changeFilter(() => setSearch(event.target.value))} /></label>
        </div>
        <div className="report-actions">
          <span className="muted">Dates filter attempts by start date. Average and highest use best-attempt percentages. Grades: A ≥ 90, B ≥ 80, C ≥ 70, D ≥ 60, otherwise F.</span>
          <div className="row-actions">
            <Button type="button" variant="secondary" disabled={exporting || reports.isPending} onClick={() => void exportCsv()}>{exporting ? 'Exporting…' : 'Export CSV'}</Button>
            <Button type="button" variant="secondary" onClick={() => window.print()}>Print view</Button>
          </div>
        </div>
        {exportError && <p className="notice notice-error" role="alert">{exportError}</p>}
      </section>

      <div className="report-tabs" role="tablist" aria-label="Assessment report status">
        {reportTabs.map((tab) => <button key={tab.value} type="button" role="tab" aria-selected={status === tab.value} className={status === tab.value ? 'active' : ''} onClick={() => changeFilter(() => setStatus(tab.value))}>{tab.label}</button>)}
      </div>

      {courses.isError && <p className="notice notice-error" role="alert">{formatError(courses.error)}</p>}
      {reports.isPending && <p className="loading" role="status">Loading assessment reports…</p>}
      {reports.isError && <p className="notice notice-error" role="alert">{formatError(reports.error)}</p>}
      {report && (
        <>
          <div className="table-scroll report-table-scroll">
            <table className="data-table">
              <thead><tr>
                <th>{sortableHeader('Student name', 'student', sortBy, sortDirection, changeSort)}</th>
                <th>{sortableHeader('Student ID', 'studentId', sortBy, sortDirection, changeSort)}</th>
                <th>{sortableHeader('Course', 'course', sortBy, sortDirection, changeSort)}</th>
                <th>{sortableHeader('Assessment', 'assessment', sortBy, sortDirection, changeSort)}</th>
                <th>{sortableHeader('Attempts', 'attempts', sortBy, sortDirection, changeSort)}</th>
                <th>{sortableHeader('Best score', 'score', sortBy, sortDirection, changeSort)}</th>
                <th>{sortableHeader('Percentage', 'percentage', sortBy, sortDirection, changeSort)}</th>
                <th>{sortableHeader('Grade', 'grade', sortBy, sortDirection, changeSort)}</th>
                <th>Pass or fail</th><th>{sortableHeader('Completed on', 'completedOn', sortBy, sortDirection, changeSort)}</th><th>Status</th><th className="report-actions-column">Action</th>
              </tr></thead>
              <tbody>
                {report.rows.map((row) => <tr key={`${row.assessmentId}:${row.studentId}`}>
                  <td>{row.studentName}</td><td>{row.studentId || '—'}</td><td>{row.course}</td><td>{row.assessment}</td>
                  <td>{row.attempts}</td><td>{row.bestScore === null ? '—' : `${row.bestScore.toFixed(1)} / ${row.totalMarks}`}</td>
                  <td>{row.percentage === null ? '—' : `${row.percentage.toFixed(1)}%`}</td><td>{row.grade}</td>
                  <td>{row.passed === null ? '—' : row.passed ? 'Pass' : 'Fail'}</td><td>{formatDate(row.completedOn)}</td>
                  <td>{row.status === 'NOT_ATTEMPTED' ? 'Not attempted' : row.status === 'IN_PROGRESS' ? 'In progress' : 'Completed'}</td>
                  <td className="report-actions-column"><Button type="button" variant="secondary" onClick={() => setSelected(row)}>View</Button></td>
                </tr>)}
                {!report.rows.length && <tr><td colSpan={12} className="report-empty">{reports.isFetching ? 'Updating reports…' : 'No students match these filters.'}</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="pagination">
            <span>{report.pagination.total ? `Showing ${(report.pagination.page - 1) * report.pagination.pageSize + 1}–${Math.min(report.pagination.page * report.pagination.pageSize, report.pagination.total)} of ${report.pagination.total}` : 'No results'}</span>
            <div className="row-actions"><Button type="button" variant="secondary" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>Previous</Button><span>Page {report.pagination.page} of {Math.max(report.pagination.totalPages, 1)}</span><Button type="button" variant="secondary" disabled={page >= report.pagination.totalPages} onClick={() => setPage((current) => current + 1)}>Next</Button></div>
          </div>
        </>
      )}

      {selected && (
        <div className="viewer-backdrop report-drawer-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(null); }}>
          <section className="card report-drawer" role="dialog" aria-modal="true" aria-labelledby="report-history-title">
            <div className="report-drawer-heading"><div><p className="eyebrow">STUDENT ATTEMPT HISTORY</p><h2 id="report-history-title">{history.data?.student.name ?? selected.studentName}</h2><p className="muted">{history.data?.student.studentProfile?.studentId ?? selected.studentId} · {history.data?.assessment.title ?? selected.assessment}</p></div><Button type="button" variant="secondary" onClick={() => setSelected(null)}>Close</Button></div>
            {history.isPending && <p className="loading" role="status">Loading attempt history…</p>}
            {history.isError && <p className="notice notice-error" role="alert">{formatError(history.error)}</p>}
            {history.data && <>
              <p className="muted">{history.data.course.code} — {history.data.course.title} · Pass mark {history.data.assessment.passMark} / {history.data.assessment.totalMarks}</p>
              {!history.data.attempts.length ? <p className="empty-state card">No attempts recorded.</p> : <div className="table-scroll"><table className="data-table"><thead><tr><th>Attempt</th><th>Status</th><th>Started</th><th>Submitted</th><th>Score</th><th>Result</th><th>Events</th></tr></thead><tbody>
                {history.data.attempts.map((attempt, index) => <tr key={attempt.id}><td>{history.data!.attempts.length - index}</td><td>{attempt.status.replace('_', ' ')}</td><td>{formatDate(attempt.startedAt)}</td><td>{formatDate(attempt.submittedAt)}</td><td>{attempt.score === null ? '—' : `${attempt.score.toFixed(1)} / ${history.data!.assessment.totalMarks}`}</td><td>{attempt.percentage === null ? '—' : `${attempt.percentage.toFixed(1)}% · ${attempt.passed ? 'Pass' : 'Fail'}`}</td><td>{attempt._count.events}{attempt.flagged ? ' · Flagged' : ''}</td></tr>)}
              </tbody></table></div>}
            </>}
          </section>
        </div>
      )}
    </section>
  );
}
