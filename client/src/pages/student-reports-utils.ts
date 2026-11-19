export type StudentReport = {
  week?: number;
  date: string;
  subject: string;
  marks: number;
  totalMarks: number;
  percentage: number;
};

type SubjectSummary = { subject: string; average: number; attempts: number };
export type ReportsChartPoint = { chartDate: string; [subject: string]: string | number };

export function summarizeSubjects(reports: StudentReport[]): SubjectSummary[] {
  const grouped = new Map<string, { percentageTotal: number; attempts: number }>();
  for (const report of reports) {
    const summary = grouped.get(report.subject) ?? { percentageTotal: 0, attempts: 0 };
    summary.percentageTotal += report.percentage;
    summary.attempts += 1;
    grouped.set(report.subject, summary);
  }
  return Array.from(grouped, ([subject, summary]) => ({
    subject,
    average: summary.percentageTotal / summary.attempts,
    attempts: summary.attempts,
  })).sort((left, right) => right.average - left.average);
}

export function buildReportsChart(reports: StudentReport[]): ReportsChartPoint[] {
  const grouped = new Map<string, Map<string, { marks: number; count: number }>>();
  for (const report of reports) {
    const subjects = grouped.get(report.date) ?? new Map<string, { marks: number; count: number }>();
    const summary = subjects.get(report.subject) ?? { marks: 0, count: 0 };
    summary.marks += report.marks;
    summary.count += 1;
    subjects.set(report.subject, summary);
    grouped.set(report.date, subjects);
  }

  return Array.from(grouped.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, subjects]) => {
      const point: ReportsChartPoint = {
        chartDate: new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(date)),
      };
      for (const [subject, summary] of subjects) point[subject] = summary.marks / summary.count;
      return point;
    });
}

export function buildWeeklyReportsChart(reports: StudentReport[]): ReportsChartPoint[] {
  const maxWeek = reports.reduce((maximum, report) => Math.max(maximum, report.week ?? 1), 0);
  const weeklyMarks = new Map<number, Map<string, { marks: number; count: number }>>();
  for (const report of reports) {
    const week = report.week ?? 1;
    const subjects = weeklyMarks.get(week) ?? new Map<string, { marks: number; count: number }>();
    const summary = subjects.get(report.subject) ?? { marks: 0, count: 0 };
    summary.marks += report.marks;
    summary.count += 1;
    subjects.set(report.subject, summary);
    weeklyMarks.set(week, subjects);
  }
  return Array.from({ length: maxWeek }, (_, index) => {
    const week = index + 1;
    const point: ReportsChartPoint = { chartDate: `Week ${week}` };
    for (const [subject, summary] of weeklyMarks.get(week) ?? []) {
      point[subject] = summary.marks / summary.count;
    }
    return point;
  });
}
