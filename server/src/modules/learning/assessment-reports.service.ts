import { AssessmentAttemptStatus, AssessmentStatus, EnrollmentStatus, Role } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { HttpError } from '../../utils/http-error.js';
import type { AssessmentReportQuery } from './assessment-reports.schemas.js';

type ReportActor = { organizationId: string; userId: string; role: Role };
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

function assertReportAccess(actor: ReportActor) {
  if (actor.role !== Role.ORG_ADMIN && actor.role !== Role.TUTOR) {
    throw new HttpError(403, 'You do not have permission to view assessment reports');
  }
}

function dateBounds(filters: AssessmentReportQuery) {
  return {
    from: filters.dateFrom ? new Date(`${filters.dateFrom}T00:00:00.000Z`) : null,
    to: filters.dateTo ? new Date(`${filters.dateTo}T23:59:59.999Z`) : null,
  };
}

function isWithinRange(value: Date, from: Date | null, to: Date | null) {
  return (!from || value >= from) && (!to || value <= to);
}

function reportStatus(attempts: Array<{ status: AssessmentAttemptStatus }>): ReportStatus {
  if (attempts.some(({ status }) => status === AssessmentAttemptStatus.IN_PROGRESS)) return 'IN_PROGRESS';
  if (attempts.some(({ status }) => status === AssessmentAttemptStatus.SUBMITTED || status === AssessmentAttemptStatus.EXPIRED)) return 'COMPLETED';
  return 'NOT_ATTEMPTED';
}

function gradeFor(percentage: number | null) {
  if (percentage === null) return '—';
  if (percentage >= 90) return 'A';
  if (percentage >= 80) return 'B';
  if (percentage >= 70) return 'C';
  if (percentage >= 60) return 'D';
  return 'F';
}

function sortValue(row: ReportRow, sortBy: AssessmentReportQuery['sortBy']): string | number {
  switch (sortBy) {
    case 'student': return row.studentName.toLocaleLowerCase();
    case 'studentId': return row.studentId.toLocaleLowerCase();
    case 'course': return row.course.toLocaleLowerCase();
    case 'assessment': return row.assessment.toLocaleLowerCase();
    case 'attempts': return row.attempts;
    case 'score': return row.bestScore ?? -1;
    case 'percentage': return row.percentage ?? -1;
    case 'grade': return row.grade;
    case 'completedOn': return row.completedOn ?? '';
  }
}

async function buildRows(actor: ReportActor, filters: AssessmentReportQuery) {
  assertReportAccess(actor);
  const where = {
    organizationId: actor.organizationId,
    status: { in: [AssessmentStatus.PUBLISHED, AssessmentStatus.CLOSED] },
    ...(filters.courseId ? { courseId: filters.courseId } : {}),
    ...(filters.assessmentId ? { id: filters.assessmentId } : {}),
    ...(filters.level ? { questions: { some: { difficulty: filters.level } } } : {}),
    ...(actor.role === Role.TUTOR ? {
      course: { instructors: { some: { instructorId: actor.userId } } },
    } : {}),
  };
  const assessments = await prisma.assessment.findMany({
    where,
    include: {
      course: { select: { id: true, code: true, title: true } },
      questions: { select: { difficulty: true } },
      attempts: {
        include: {
          student: { select: { id: true, name: true, studentProfile: { select: { studentId: true } } } },
        },
        orderBy: { startedAt: 'desc' },
      },
    },
    orderBy: [{ course: { title: 'asc' } }, { title: 'asc' }],
  });
  if (!assessments.length) return { rows: [] as ReportRow[], assessments: [], levels: [] as string[] };

  const enrollments = await prisma.enrollment.findMany({
    where: {
      organizationId: actor.organizationId,
      courseId: { in: [...new Set(assessments.map(({ courseId }) => courseId))] },
      status: { in: [EnrollmentStatus.ACTIVE, EnrollmentStatus.COMPLETED] },
      ...(actor.role === Role.TUTOR ? {
        selectedTutorId: actor.userId,
        course: { instructors: { some: { instructorId: actor.userId } } },
      } : {}),
    },
    include: {
      student: { select: { id: true, name: true, studentProfile: { select: { studentId: true } } } },
    },
  });
  const { from, to } = dateBounds(filters);
  const enrollmentsByCourse = new Map<string, typeof enrollments>();
  for (const enrollment of enrollments) {
    const courseEnrollments = enrollmentsByCourse.get(enrollment.courseId) ?? [];
    courseEnrollments.push(enrollment);
    enrollmentsByCourse.set(enrollment.courseId, courseEnrollments);
  }
  const rows: ReportRow[] = [];
  for (const assessment of assessments) {
    const attemptsByStudent = new Map<string, typeof assessment.attempts>();
    for (const attempt of assessment.attempts) {
      if (!isWithinRange(attempt.startedAt, from, to)) continue;
      const studentAttempts = attemptsByStudent.get(attempt.studentId) ?? [];
      studentAttempts.push(attempt);
      attemptsByStudent.set(attempt.studentId, studentAttempts);
    }
    const levels = [...new Set(assessment.questions.map(({ difficulty }) => difficulty))].sort();
    for (const enrollment of enrollmentsByCourse.get(assessment.courseId) ?? []) {
      const attempts = attemptsByStudent.get(enrollment.studentId) ?? [];
      if ((from || to) && attempts.length === 0) continue;
      const completedAttempts = attempts.filter(({ status }) => status === AssessmentAttemptStatus.SUBMITTED || status === AssessmentAttemptStatus.EXPIRED)
        .filter(({ score }) => score !== null)
        .sort((left, right) => (right.percentage ?? -1) - (left.percentage ?? -1));
      const best = completedAttempts[0];
      const percentage = best?.percentage ?? (best?.score !== null && best?.score !== undefined
        ? (best.score / assessment.totalMarks) * 100
        : null);
      const status = reportStatus(attempts);
      rows.push({
        studentId: enrollment.student.studentProfile?.studentId ?? '',
        studentName: enrollment.student.name,
        courseId: assessment.courseId,
        course: `${assessment.course.code} — ${assessment.course.title}`,
        assessmentId: assessment.id,
        assessment: assessment.title,
        totalMarks: assessment.totalMarks,
        level: levels.join(', '),
        attempts: attempts.length,
        bestScore: best?.score ?? null,
        percentage,
        grade: gradeFor(percentage),
        passed: best?.passed ?? null,
        completedOn: best?.submittedAt?.toISOString() ?? (best?.status === AssessmentAttemptStatus.EXPIRED ? best.startedAt.toISOString() : null),
        status,
      });
    }
  }
  return { rows, assessments, levels: [...new Set(assessments.flatMap(({ questions }) => questions.map(({ difficulty }) => difficulty)))].sort() };
}

export async function listAssessmentReports(actor: ReportActor, filters: AssessmentReportQuery) {
  const { rows, assessments, levels } = await buildRows(actor, filters);
  const search = filters.search?.toLocaleLowerCase();
  const searchedRows = search
    ? rows.filter((row) => row.studentName.toLocaleLowerCase().includes(search) || row.studentId.toLocaleLowerCase().includes(search))
    : rows;
  const completed = searchedRows.filter((row) => row.status === 'COMPLETED');
  const percentages = completed.map(({ percentage }) => percentage).filter((value): value is number => value !== null);
  const summary = {
    enrolled: searchedRows.length,
    completed: completed.length,
    inProgress: searchedRows.filter((row) => row.status === 'IN_PROGRESS').length,
    notStarted: searchedRows.filter((row) => row.status === 'NOT_ATTEMPTED').length,
    passed: completed.filter((row) => row.passed === true).length,
    failed: completed.filter((row) => row.passed === false).length,
    average: percentages.length ? percentages.reduce((total, value) => total + value, 0) / percentages.length : 0,
    highest: percentages.length ? Math.max(...percentages) : 0,
  };
  const visibleRows = searchedRows
    .filter((row) => !filters.status || row.status === filters.status)
    .sort((left, right) => {
      const a = sortValue(left, filters.sortBy);
      const b = sortValue(right, filters.sortBy);
      const order = typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b));
      return filters.sortDirection === 'asc' ? order : -order;
    });
  const start = (filters.page - 1) * filters.pageSize;
  return {
    rows: visibleRows.slice(start, start + filters.pageSize),
    summary,
    pagination: { page: filters.page, pageSize: filters.pageSize, total: visibleRows.length, totalPages: Math.ceil(visibleRows.length / filters.pageSize) },
    filters: {
      assessments: assessments.map(({ id, title, course }) => ({ id, title, courseId: course.id })),
      levels,
    },
  };
}

export async function getAssessmentReportStudent(actor: ReportActor, studentId: string, assessmentId: string) {
  assertReportAccess(actor);
  const assessment = await prisma.assessment.findFirst({
    where: {
      id: assessmentId,
      organizationId: actor.organizationId,
      status: { in: [AssessmentStatus.PUBLISHED, AssessmentStatus.CLOSED] },
      ...(actor.role === Role.TUTOR ? {
        course: { instructors: { some: { instructorId: actor.userId } } },
      } : {}),
    },
    include: { course: { select: { id: true, code: true, title: true } } },
  });
  if (!assessment) throw new HttpError(404, 'Assessment report not found');
  const enrollment = await prisma.enrollment.findFirst({
    where: {
      organizationId: actor.organizationId,
      courseId: assessment.courseId,
      student: { studentProfile: { studentId } },
      status: { in: [EnrollmentStatus.ACTIVE, EnrollmentStatus.COMPLETED] },
      ...(actor.role === Role.TUTOR ? {
        selectedTutorId: actor.userId,
        course: { instructors: { some: { instructorId: actor.userId } } },
      } : {}),
    },
    select: { student: { select: { id: true, name: true, studentProfile: { select: { studentId: true } } } } },
  });
  if (!enrollment) throw new HttpError(404, 'Student is not enrolled in this course');
  const attempts = await prisma.assessmentAttempt.findMany({
    where: { organizationId: actor.organizationId, assessmentId, studentId: enrollment.student.id },
    select: {
      id: true,
      status: true,
      startedAt: true,
      submittedAt: true,
      score: true,
      percentage: true,
      passed: true,
      flagged: true,
      _count: { select: { events: true } },
    },
    orderBy: { startedAt: 'desc' },
  });
  return {
    student: enrollment.student,
    course: assessment.course,
    assessment: { id: assessment.id, title: assessment.title, totalMarks: assessment.totalMarks, passMark: assessment.passMark },
    attempts,
  };
}

export async function exportAssessmentReports(actor: ReportActor, filters: AssessmentReportQuery) {
  const { rows } = await buildRows(actor, filters);
  const search = filters.search?.toLocaleLowerCase();
  const visibleRows = rows
    .filter((row) => !filters.status || row.status === filters.status)
    .filter((row) => !search || row.studentName.toLocaleLowerCase().includes(search) || row.studentId.toLocaleLowerCase().includes(search));
  const header = ['Student name', 'Student ID', 'Course', 'Assessment', 'Attempts', 'Best score', 'Percentage', 'Grade', 'Pass or fail', 'Completed on', 'Status'];
  const escape = (value: string | number | null) => {
    const safeValue = String(value ?? '');
    const formulaSafeValue = /^[=+\-@]/.test(safeValue) ? `'${safeValue}` : safeValue;
    return `"${formulaSafeValue.replaceAll('"', '""')}"`;
  };
  return [header, ...visibleRows.map((row) => [
    row.studentName, row.studentId, row.course, row.assessment, row.attempts, row.bestScore,
    row.percentage === null ? null : row.percentage.toFixed(1), row.grade,
    row.passed === null ? '' : row.passed ? 'Pass' : 'Fail', row.completedOn, row.status,
  ])].map((line) => line.map(escape).join(',')).join('\r\n');
}
