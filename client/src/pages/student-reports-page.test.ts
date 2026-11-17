import { describe, expect, it } from 'vitest';
import { buildReportsChart, summarizeSubjects } from './student-reports-utils';

describe('student report summaries', () => {
  it('ranks subjects by actual average result percentage', () => {
    expect(summarizeSubjects([
      { date: '2026-01-01T00:00:00.000Z', subject: 'Mathematics', marks: 8, totalMarks: 10, percentage: 80 },
      { date: '2026-02-01T00:00:00.000Z', subject: 'Mathematics', marks: 9, totalMarks: 10, percentage: 90 },
      { date: '2026-02-02T00:00:00.000Z', subject: 'Science', marks: 5, totalMarks: 10, percentage: 50 },
    ])).toEqual([
      { subject: 'Mathematics', average: 85, attempts: 2 },
      { subject: 'Science', average: 50, attempts: 1 },
    ]);
  });

  it('builds chronologically ordered marks series for each subject', () => {
    expect(buildReportsChart([
      { date: '2026-02-02T00:00:00.000Z', subject: 'Science', marks: 5, totalMarks: 10, percentage: 50 },
      { date: '2026-01-01T00:00:00.000Z', subject: 'Mathematics', marks: 8, totalMarks: 10, percentage: 80 },
      { date: '2026-01-01T00:00:00.000Z', subject: 'Mathematics', marks: 10, totalMarks: 10, percentage: 100 },
    ])).toEqual([
      { chartDate: new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date('2026-01-01T00:00:00.000Z')), Mathematics: 9 },
      { chartDate: new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date('2026-02-02T00:00:00.000Z')), Science: 5 },
    ]);
  });
});
