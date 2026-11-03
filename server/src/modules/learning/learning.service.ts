import {
  AssessmentAttemptStatus, AssessmentStatus, EnrollmentStatus, PracticeSessionStatus,
  Prisma, QuestionDifficulty, QuestionType, ResultReleaseMode, Role,
} from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { HttpError } from '../../utils/http-error.js';
import { questionSchema } from './learning.schemas.js';

type Actor = { organizationId: string; userId: string; role: Role };
type QuestionInput = {
  courseId?: string; topicId?: string | null; type: QuestionType; prompt: string;
  options?: unknown; correctAnswer: unknown; topic: string; difficulty: QuestionDifficulty;
  marks: number; explanation?: string | null; sourceQuestionId?: string; order?: number;
};
type AssessmentInput = {
  courseId?: string; title?: string; instructions?: string; totalMarks?: number; passMark?: number;
  durationMinutes?: number; opensAt?: string | null; closesAt?: string | null; maxAttempts?: number;
  shuffleQuestions?: boolean; shuffleOptions?: boolean; resultReleaseMode?: ResultReleaseMode;
  answerReviewAllowed?: boolean; weight?: number | null;
};
type SnapshotQuestion = {
  id: string; type: QuestionType; prompt: string; options: unknown; correctAnswer: unknown;
  explanation: string | null; marks: number; topic: string; difficulty: QuestionDifficulty;
};

function assertTeacher(actor: Actor) {
  if (actor.role !== Role.ORG_ADMIN && actor.role !== Role.INSTRUCTOR) throw new HttpError(403, 'You do not have permission to manage learning content');
}

async function managedCourse(actor: Actor, courseId: string) {
  assertTeacher(actor);
  const course = await prisma.course.findFirst({
    where: { id: courseId, organizationId: actor.organizationId, ...(actor.role === Role.INSTRUCTOR ? { instructors: { some: { instructorId: actor.userId } } } : {}) },
    select: { id: true },
  });
  if (!course) throw new HttpError(404, 'Course not found');
  return course;
}

async function audit(tx: Prisma.TransactionClient, actor: Actor, action: string, type: string, id: string, metadata: Prisma.InputJsonValue = {}) {
  await tx.auditLog.create({
    data: { organizationId: actor.organizationId, actorId: actor.userId, action, targetType: type, targetId: id, metadata },
  });
}

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function shuffled<T>(values: T[]): T[] {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}

function normalize(value: unknown): string {
  return String(value ?? '').trim().toLocaleLowerCase();
}

function acceptedList(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.map((item) => String(item));
  return [];
}

function grade(question: SnapshotQuestion, submitted: unknown): number {
  const expected = question.correctAnswer;
  if (question.type === QuestionType.MATCH) {
    if (!expected || typeof expected !== 'object' || Array.isArray(expected) || !submitted || typeof submitted !== 'object' || Array.isArray(submitted)) return 0;
    const pairs = Object.entries(expected);
    if (pairs.length === 0) return 0;
    const correct = pairs.filter(([key, value]) => normalize((submitted as Record<string, unknown>)[key]) === normalize(value)).length;
    return question.marks * correct / pairs.length;
  }
  if (question.type === QuestionType.FILL_BLANK || question.type === QuestionType.FILL_IN_BLANK) {
    const expectedBlanks = Array.isArray(expected) ? expected : [expected];
    const actualBlanks = Array.isArray(submitted) ? submitted : [submitted];
    if (!expectedBlanks.length) return 0;
    const correctBlanks = expectedBlanks.filter((accepted, index) => {
      const actual = normalize(actualBlanks[index]);
      return acceptedList(accepted).some((item) => normalize(item) === actual);
    }).length;
    return question.marks * correctBlanks / expectedBlanks.length;
  }
  if (question.type === QuestionType.MCQ_MULTIPLE) {
    const a = Array.isArray(expected) ? expected.map(normalize).sort() : [];
    const b = Array.isArray(submitted) ? submitted.map(normalize).sort() : [];
    return a.length === b.length && a.every((value, index) => value === b[index]) ? question.marks : 0;
  }
  if (question.type === QuestionType.SHORT_ANSWER) {
    return acceptedList(expected).some((value) => normalize(value) === normalize(submitted)) ? question.marks : 0;
  }
  return normalize(expected) === normalize(submitted) ? question.marks : 0;
}

function studentQuestion(question: SnapshotQuestion, answer?: unknown) {
  return {
    id: question.id, type: question.type, prompt: question.prompt, options: question.options,
    marks: question.marks, topic: question.topic, difficulty: question.difficulty,
    ...(answer !== undefined ? { answer } : {}),
  };
}

function questionData(input: QuestionInput, organizationId: string, createdById: string) {
  return {
    organizationId,
    courseId: input.courseId!,
    topicId: input.topicId ?? null,
    createdById,
    type: input.type,
    prompt: input.prompt,
    options: input.options === undefined || input.options === null ? Prisma.DbNull : json(input.options),
    correctAnswer: json(input.correctAnswer),
    topic: input.topic,
    difficulty: input.difficulty,
    marks: input.marks,
    explanation: input.explanation ?? null,
  };
}

async function validateTopic(actor: Actor, courseId: string, topicId?: string | null) {
  if (!topicId) return;
  const topic = await prisma.courseTopic.findFirst({ where: { id: topicId, organizationId: actor.organizationId, courseId }, select: { id: true } });
  if (!topic) throw new HttpError(400, 'Topic must belong to the selected course');
}

async function validateQuestionSource(actor: Actor, courseId: string, sourceQuestionId?: string) {
  if (!sourceQuestionId) return;
  const question = await prisma.practiceQuestion.findFirst({
    where: { id: sourceQuestionId, organizationId: actor.organizationId, courseId, deletedAt: null },
    select: { id: true },
  });
  if (!question) throw new HttpError(400, 'Selected bank question was not found in this course');
}

export async function listQuestions(actor: Actor, filters: { courseId?: string; topicId?: string; difficulty?: QuestionDifficulty; type?: QuestionType; search?: string }) {
  assertTeacher(actor);
  if (filters.courseId) await managedCourse(actor, filters.courseId);
  return prisma.practiceQuestion.findMany({
    where: {
      organizationId: actor.organizationId, deletedAt: null,
      ...(filters.courseId ? { courseId: filters.courseId } : {}),
      ...(filters.topicId ? { topicId: filters.topicId } : {}),
      ...(filters.difficulty ? { difficulty: filters.difficulty } : {}),
      ...(filters.type ? { type: filters.type } : {}),
      ...(filters.search ? { prompt: { contains: filters.search, mode: 'insensitive' } } : {}),
      ...(actor.role === Role.INSTRUCTOR ? { course: { instructors: { some: { instructorId: actor.userId } } } } : {}),
    },
    include: { course: { select: { id: true, code: true, title: true } }, courseTopic: { select: { id: true, title: true } } },
    orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
  });
}

export async function createQuestion(actor: Actor, input: QuestionInput) {
  assertTeacher(actor);
  await managedCourse(actor, input.courseId!);
  await validateTopic(actor, input.courseId!, input.topicId);
  const question = await prisma.$transaction(async (tx) => {
    const saved = await tx.practiceQuestion.create({ data: questionData(input, actor.organizationId, actor.userId) });
    await audit(tx, actor, 'PRACTICE_QUESTION_CREATED', 'PracticeQuestion', saved.id, { courseId: input.courseId!, type: input.type });
    return saved;
  });
  return question;
}

export async function updateQuestion(actor: Actor, questionId: string, input: Partial<QuestionInput>) {
  assertTeacher(actor);
  const current = await prisma.practiceQuestion.findFirst({
    where: { id: questionId, organizationId: actor.organizationId, deletedAt: null,
      ...(actor.role === Role.INSTRUCTOR ? { course: { instructors: { some: { instructorId: actor.userId } } } } : {}) },
  });
  if (!current) throw new HttpError(404, 'Question not found');
  const courseId = input.courseId ?? current.courseId;
  await managedCourse(actor, courseId);
  const validated = questionSchema.parse({ ...current, ...input, courseId });
  await validateTopic(actor, courseId, validated.topicId);
  return prisma.$transaction(async (tx) => {
    const updated = await tx.practiceQuestion.update({
      where: { id: current.id },
      data: {
        courseId: validated.courseId,
        topicId: validated.topicId ?? null,
        type: validated.type,
        prompt: validated.prompt,
        options: validated.options == null ? Prisma.DbNull : json(validated.options),
        correctAnswer: json(validated.correctAnswer),
        topic: validated.topic,
        difficulty: validated.difficulty,
        marks: validated.marks,
        explanation: validated.explanation ?? null,
      },
    });
    await audit(tx, actor, 'PRACTICE_QUESTION_UPDATED', 'PracticeQuestion', updated.id);
    return updated;
  });
}

export async function deleteQuestion(actor: Actor, questionId: string) {
  assertTeacher(actor);
  const question = await prisma.practiceQuestion.findFirst({
    where: { id: questionId, organizationId: actor.organizationId, deletedAt: null,
      ...(actor.role === Role.INSTRUCTOR ? { course: { instructors: { some: { instructorId: actor.userId } } } } : {}) },
    select: { id: true },
  });
  if (!question) throw new HttpError(404, 'Question not found');
  await prisma.$transaction(async (tx) => {
    await tx.practiceQuestion.update({ where: { id: question.id }, data: { deletedAt: new Date() } });
    await audit(tx, actor, 'PRACTICE_QUESTION_DELETED', 'PracticeQuestion', question.id);
  });
}

function assessmentData(input: AssessmentInput) {
  return {
    ...(input.title !== undefined ? { title: input.title } : {}),
    ...(input.instructions !== undefined ? { instructions: input.instructions } : {}),
    ...(input.totalMarks !== undefined ? { totalMarks: input.totalMarks } : {}),
    ...(input.passMark !== undefined ? { passMark: input.passMark } : {}),
    ...(input.durationMinutes !== undefined ? { durationMinutes: input.durationMinutes } : {}),
    ...(input.opensAt !== undefined ? { opensAt: input.opensAt ? new Date(input.opensAt) : null } : {}),
    ...(input.closesAt !== undefined ? { closesAt: input.closesAt ? new Date(input.closesAt) : null } : {}),
    ...(input.maxAttempts !== undefined ? { maxAttempts: input.maxAttempts } : {}),
    ...(input.shuffleQuestions !== undefined ? { shuffleQuestions: input.shuffleQuestions } : {}),
    ...(input.shuffleOptions !== undefined ? { shuffleOptions: input.shuffleOptions } : {}),
    ...(input.resultReleaseMode !== undefined ? { resultReleaseMode: input.resultReleaseMode } : {}),
    ...(input.answerReviewAllowed !== undefined ? { answerReviewAllowed: input.answerReviewAllowed } : {}),
    ...(input.weight !== undefined ? { weight: input.weight } : {}),
  };
}

function questionSnapshot(row: {
  id: string; type: QuestionType; prompt: string; options: Prisma.JsonValue | null; correctAnswer: Prisma.JsonValue;
  explanation: string | null; marks: number; topic: string; difficulty: QuestionDifficulty;
}): SnapshotQuestion {
  return { id: row.id, type: row.type, prompt: row.prompt, options: row.options, correctAnswer: row.correctAnswer, explanation: row.explanation, marks: row.marks, topic: row.topic, difficulty: row.difficulty };
}

async function managedAssessment(actor: Actor, assessmentId: string) {
  assertTeacher(actor);
  const assessment = await prisma.assessment.findFirst({
    where: { id: assessmentId, organizationId: actor.organizationId,
      ...(actor.role === Role.INSTRUCTOR ? { course: { instructors: { some: { instructorId: actor.userId } } } } : {}) },
    include: { questions: { orderBy: { order: 'asc' } }, course: { select: { id: true, code: true, title: true } } },
  });
  if (!assessment) throw new HttpError(404, 'Assessment not found');
  return assessment;
}

export async function listAssessments(actor: Actor) {
  assertTeacher(actor);
  return prisma.assessment.findMany({
    where: { organizationId: actor.organizationId, ...(actor.role === Role.INSTRUCTOR ? { course: { instructors: { some: { instructorId: actor.userId } } } } : {}) },
    include: { course: { select: { id: true, code: true, title: true } }, _count: { select: { questions: true, attempts: true } } },
    orderBy: { createdAt: 'desc' },
  });
}

export async function getAssessment(actor: Actor, assessmentId: string) {
  return managedAssessment(actor, assessmentId);
}

export async function createAssessment(actor: Actor, input: AssessmentInput & { courseId: string; title: string; totalMarks: number; passMark: number; durationMinutes: number; questions: QuestionInput[] }) {
  await managedCourse(actor, input.courseId);
  const sum = input.questions.reduce((total, question) => total + question.marks, 0);
  if (input.questions.length && sum !== input.totalMarks) throw new HttpError(400, 'Question marks must equal total marks');
  for (const question of input.questions) {
    await validateTopic(actor, input.courseId, question.topicId);
    await validateQuestionSource(actor, input.courseId, question.sourceQuestionId);
  }
  return prisma.$transaction(async (tx) => {
    const assessment = await tx.assessment.create({
      data: {
        organizationId: actor.organizationId, courseId: input.courseId, createdById: actor.userId,
        title: input.title, instructions: input.instructions ?? '', totalMarks: input.totalMarks,
        passMark: input.passMark, durationMinutes: input.durationMinutes, maxAttempts: input.maxAttempts ?? 1,
        shuffleQuestions: input.shuffleQuestions ?? false, shuffleOptions: input.shuffleOptions ?? false,
        resultReleaseMode: input.resultReleaseMode ?? ResultReleaseMode.IMMEDIATE,
        answerReviewAllowed: input.answerReviewAllowed ?? true, weight: input.weight ?? null,
        opensAt: input.opensAt ? new Date(input.opensAt) : null, closesAt: input.closesAt ? new Date(input.closesAt) : null,
      },
    });
    if (input.questions.length) {
      await tx.assessmentQuestion.createMany({
        data: input.questions.map((question, index) => ({
          organizationId: actor.organizationId, assessmentId: assessment.id, type: question.type,
          prompt: question.prompt, options: question.options == null ? Prisma.DbNull : json(question.options),
          correctAnswer: json(question.correctAnswer), marks: question.marks, explanation: question.explanation ?? null,
          topic: question.topic,
          order: question.order ?? index, topicId: question.topicId ?? null, difficulty: question.difficulty,
          sourceQuestionId: question.sourceQuestionId ?? null,
        })),
      });
    }
    await audit(tx, actor, 'ASSESSMENT_CREATED', 'Assessment', assessment.id, { courseId: input.courseId });
    return tx.assessment.findUniqueOrThrow({ where: { id: assessment.id }, include: { questions: { orderBy: { order: 'asc' } } } });
  });
}

export async function updateAssessment(actor: Actor, assessmentId: string, input: AssessmentInput) {
  const assessment = await managedAssessment(actor, assessmentId);
  if (assessment.status !== AssessmentStatus.DRAFT) throw new HttpError(409, 'Only draft assessments can be changed');
  const data = assessmentData(input);
  const totalMarks = input.totalMarks ?? assessment.totalMarks;
  if (input.passMark !== undefined && input.passMark > totalMarks) throw new HttpError(400, 'Pass mark cannot exceed total marks');
  return prisma.$transaction(async (tx) => {
    const updated = await tx.assessment.update({ where: { id: assessment.id }, data });
    await audit(tx, actor, 'ASSESSMENT_UPDATED', 'Assessment', updated.id);
    return updated;
  });
}

export async function addAssessmentQuestion(actor: Actor, assessmentId: string, input: QuestionInput) {
  const assessment = await managedAssessment(actor, assessmentId);
  if (assessment.status !== AssessmentStatus.DRAFT) throw new HttpError(409, 'Published assessments are immutable; duplicate as a draft to edit');
  await validateTopic(actor, assessment.courseId, input.topicId);
  await validateQuestionSource(actor, assessment.courseId, input.sourceQuestionId);
  const marks = assessment.questions.reduce((sum, question) => sum + question.marks, 0) + input.marks;
  if (marks > assessment.totalMarks) throw new HttpError(400, 'Question marks exceed the assessment total');
  return prisma.$transaction(async (tx) => {
    const question = await tx.assessmentQuestion.create({
      data: { organizationId: actor.organizationId, assessmentId, type: input.type, prompt: input.prompt,
        options: input.options == null ? Prisma.DbNull : json(input.options), correctAnswer: json(input.correctAnswer),
        marks: input.marks, explanation: input.explanation ?? null, topic: input.topic, order: assessment.questions.length,
        topicId: input.topicId ?? null, difficulty: input.difficulty, sourceQuestionId: input.sourceQuestionId ?? null },
    });
    await audit(tx, actor, 'ASSESSMENT_QUESTION_ADDED', 'Assessment', assessmentId, { questionId: question.id });
    return question;
  });
}

export async function updateAssessmentQuestion(actor: Actor, assessmentId: string, questionId: string, input: Partial<QuestionInput>) {
  const assessment = await managedAssessment(actor, assessmentId);
  if (assessment.status !== AssessmentStatus.DRAFT) throw new HttpError(409, 'Published assessments are immutable; duplicate as a draft to edit');
  const current = assessment.questions.find((item) => item.id === questionId);
  if (!current) throw new HttpError(404, 'Assessment question not found');
  const validated = questionSchema.parse({ ...current, ...input, courseId: assessment.courseId });
  await validateTopic(actor, assessment.courseId, validated.topicId);
  return prisma.$transaction(async (tx) => {
    const updated = await tx.assessmentQuestion.update({
      where: { id: current.id },
      data: {
        type: validated.type,
        prompt: validated.prompt,
        options: validated.options == null ? Prisma.DbNull : json(validated.options),
        correctAnswer: json(validated.correctAnswer),
        topic: validated.topic,
        topicId: validated.topicId ?? null,
        difficulty: validated.difficulty,
        marks: validated.marks,
        explanation: validated.explanation ?? null,
      },
    });
    await audit(tx, actor, 'ASSESSMENT_QUESTION_UPDATED', 'Assessment', assessmentId, { questionId });
    return updated;
  });
}

export async function deleteAssessmentQuestion(actor: Actor, assessmentId: string, questionId: string) {
  const assessment = await managedAssessment(actor, assessmentId);
  if (assessment.status !== AssessmentStatus.DRAFT) throw new HttpError(409, 'Published assessments are immutable; duplicate as a draft to edit');
  const question = assessment.questions.find((item) => item.id === questionId);
  if (!question) throw new HttpError(404, 'Assessment question not found');
  await prisma.$transaction(async (tx) => {
    await tx.assessmentQuestion.delete({ where: { id: questionId } });
    const remaining = assessment.questions.filter(({ id }) => id !== questionId);
    for (const [order, item] of remaining.entries()) {
      await tx.assessmentQuestion.update({ where: { id: item.id }, data: { order } });
    }
    await audit(tx, actor, 'ASSESSMENT_QUESTION_DELETED', 'Assessment', assessmentId, { questionId });
  });
}

export async function reorderAssessmentQuestions(actor: Actor, assessmentId: string, questionIds: string[]) {
  const assessment = await managedAssessment(actor, assessmentId);
  if (assessment.status !== AssessmentStatus.DRAFT) throw new HttpError(409, 'Published assessments are immutable; duplicate as a draft to edit');
  if (questionIds.length !== assessment.questions.length || assessment.questions.some(({ id }) => !questionIds.includes(id))) {
    throw new HttpError(400, 'Reorder must include every assessment question exactly once');
  }
  await prisma.$transaction(async (tx) => {
    for (const [index, id] of questionIds.entries()) {
      await tx.assessmentQuestion.update({ where: { id }, data: { order: assessment.questions.length + index } });
    }
    for (const [order, id] of questionIds.entries()) {
      await tx.assessmentQuestion.update({ where: { id }, data: { order } });
    }
    await audit(tx, actor, 'ASSESSMENT_QUESTIONS_REORDERED', 'Assessment', assessmentId, { questionIds });
  });
}

export async function closeAssessment(actor: Actor, assessmentId: string) {
  const assessment = await managedAssessment(actor, assessmentId);
  if (assessment.status !== AssessmentStatus.PUBLISHED) throw new HttpError(409, 'Only published assessments can be closed');
  return prisma.$transaction(async (tx) => {
    const updated = await tx.assessment.update({ where: { id: assessmentId }, data: { status: AssessmentStatus.CLOSED } });
    await audit(tx, actor, 'ASSESSMENT_CLOSED', 'Assessment', assessmentId);
    return updated;
  });
}

export async function publishAssessment(actor: Actor, assessmentId: string) {
  const assessment = await managedAssessment(actor, assessmentId);
  if (assessment.status !== AssessmentStatus.DRAFT) throw new HttpError(409, 'Only drafts can be published');
  if (!assessment.questions.length) throw new HttpError(400, 'Add at least one question before publishing');
  const total = assessment.questions.reduce((sum, question) => sum + question.marks, 0);
  if (total !== assessment.totalMarks || assessment.passMark > total) throw new HttpError(400, 'Question marks must equal total marks and include the pass mark');
  const snapshot = assessment.questions.map(questionSnapshot);
  return prisma.$transaction(async (tx) => {
    const result = await tx.assessment.update({
      where: { id: assessment.id },
      data: { status: AssessmentStatus.PUBLISHED, publishedSnapshot: json(snapshot) },
    });
    await audit(tx, actor, 'ASSESSMENT_PUBLISHED', 'Assessment', assessment.id, { totalMarks: total });
    return result;
  });
}

export async function duplicateAssessment(actor: Actor, assessmentId: string) {
  const original = await managedAssessment(actor, assessmentId);
  return createAssessment(actor, {
    courseId: original.courseId, title: `${original.title} (Copy)`, instructions: original.instructions,
    totalMarks: original.totalMarks, passMark: original.passMark, durationMinutes: original.durationMinutes,
    maxAttempts: original.maxAttempts, shuffleQuestions: original.shuffleQuestions,
    shuffleOptions: original.shuffleOptions, resultReleaseMode: original.resultReleaseMode,
    answerReviewAllowed: original.answerReviewAllowed, weight: original.weight,
    questions: original.questions.map((question) => ({
      type: question.type, prompt: question.prompt, options: question.options, correctAnswer: question.correctAnswer,
      topic: question.topic, difficulty: question.difficulty, marks: question.marks, explanation: question.explanation,
      topicId: question.topicId,
    })),
  });
}

async function assertEnrolled(actor: Actor, courseId: string) {
  if (actor.role !== Role.STUDENT) throw new HttpError(403, 'Student access required');
  const enrollment = await prisma.enrollment.findFirst({
    where: { organizationId: actor.organizationId, courseId, studentId: actor.userId, status: EnrollmentStatus.ACTIVE, course: { status: 'PUBLISHED' } },
    select: { id: true },
  });
  if (!enrollment) throw new HttpError(404, 'Course enrollment not found');
}

export async function startPractice(actor: Actor, input: { courseId: string; topicId?: string; difficulty?: QuestionDifficulty; type?: QuestionType; count: number; timeLimitSeconds?: number }) {
  await assertEnrolled(actor, input.courseId);
  const questions = await prisma.practiceQuestion.findMany({
    where: { organizationId: actor.organizationId, courseId: input.courseId, deletedAt: null,
      ...(input.topicId ? { topicId: input.topicId } : {}), ...(input.difficulty ? { difficulty: input.difficulty } : {}),
      ...(input.type ? { type: input.type } : {}) },
    select: { id: true },
  });
  if (!questions.length) throw new HttpError(404, 'No practice questions match your filters');
  const questionIds = shuffled(questions.map(({ id }) => id)).slice(0, input.count);
  const startedAt = new Date();
  const session = await prisma.practiceSession.create({
    data: {
      organizationId: actor.organizationId, studentId: actor.userId, courseId: input.courseId,
      questionIds: json(questionIds), totalQuestions: questionIds.length,
      ...(input.timeLimitSeconds ? { timeLimitSeconds: input.timeLimitSeconds, expiresAt: new Date(startedAt.getTime() + input.timeLimitSeconds * 1000) } : {}),
    },
  });
  return getPracticeSession(actor, session.id);
}

export async function getPracticeSession(actor: Actor, sessionId: string) {
  let session = await prisma.practiceSession.findFirst({
    where: { id: sessionId, organizationId: actor.organizationId, studentId: actor.userId },
    include: { answers: true },
  });
  if (!session) throw new HttpError(404, 'Practice session not found');
  if (session.status === PracticeSessionStatus.IN_PROGRESS && session.expiresAt && session.expiresAt <= new Date()) {
    await prisma.practiceSession.update({ where: { id: session.id }, data: { status: PracticeSessionStatus.COMPLETED, completedAt: new Date() } });
    session = { ...session, status: PracticeSessionStatus.COMPLETED, completedAt: new Date() };
  }
  const questionIds = session.questionIds as string[];
  const nextId = session.status === PracticeSessionStatus.IN_PROGRESS ? questionIds.find((id) => !session.answers.some((answer) => answer.questionId === id)) : undefined;
  const row = nextId ? await prisma.practiceQuestion.findFirst({ where: { id: nextId, organizationId: actor.organizationId, deletedAt: null } }) : null;
  const practiceQuestions = await prisma.practiceQuestion.findMany({
    where: { id: { in: questionIds }, organizationId: actor.organizationId },
    select: { id: true, topic: true, marks: true },
  });
  const topicScores = new Map<string, { earned: number; possible: number; answered: number }>();
  for (const practiceQuestion of practiceQuestions) {
    const answer = session.answers.find(({ questionId }) => questionId === practiceQuestion.id);
    if (!answer) continue;
    const bucket = topicScores.get(practiceQuestion.topic) ?? { earned: 0, possible: 0, answered: 0 };
    bucket.earned += answer.score;
    bucket.possible += practiceQuestion.marks;
    bucket.answered += 1;
    topicScores.set(practiceQuestion.topic, bucket);
  }
  const maxScore = practiceQuestions.reduce((total, item) => total + item.marks, 0);
  return {
    session,
    remainingSeconds: session.expiresAt ? Math.max(0, Math.ceil((session.expiresAt.getTime() - Date.now()) / 1000)) : null,
    question: row ? studentQuestion(questionSnapshot(row)) : null,
    summary: {
      score: session.score,
      maxScore,
      accuracyPercent: session.answeredCount ? Math.round((session.score / Math.max(1, practiceQuestions.filter((item) => session.answers.some((answer) => answer.questionId === item.id)).reduce((sum, item) => sum + item.marks, 0))) * 100) : 0,
      weakTopics: [...topicScores.entries()].filter(([, value]) => value.possible > 0 && value.earned / value.possible < 0.6).map(([topic]) => topic),
    },
  };
}

export async function answerPractice(actor: Actor, sessionId: string, questionId: string, answer: unknown) {
  const session = await prisma.practiceSession.findFirst({ where: { id: sessionId, organizationId: actor.organizationId, studentId: actor.userId } });
  if (!session || session.status !== PracticeSessionStatus.IN_PROGRESS) throw new HttpError(404, 'Active practice session not found');
  if (session.expiresAt && session.expiresAt <= new Date()) {
    await prisma.practiceSession.update({ where: { id: session.id }, data: { status: PracticeSessionStatus.COMPLETED, completedAt: new Date() } });
    throw new HttpError(409, 'Practice time has expired');
  }
  if (!(session.questionIds as string[]).includes(questionId)) throw new HttpError(400, 'Question is not part of this practice session');
  const row = await prisma.practiceQuestion.findFirst({ where: { id: questionId, organizationId: actor.organizationId, courseId: session.courseId } });
  if (!row) throw new HttpError(404, 'Practice question not found');
  const score = grade(questionSnapshot(row), answer);
  const isCorrect = score === row.marks;
  await prisma.$transaction(async (tx) => {
    await tx.practiceSessionAnswer.upsert({
      where: { organizationId_sessionId_questionId: { organizationId: actor.organizationId, sessionId, questionId } },
      create: { organizationId: actor.organizationId, sessionId, questionId, answer: json(answer), isCorrect, score },
      update: { answer: json(answer), isCorrect, score, answeredAt: new Date() },
    });
    const answeredCount = await tx.practiceSessionAnswer.count({ where: { organizationId: actor.organizationId, sessionId } });
    const totalScore = await tx.practiceSessionAnswer.aggregate({ where: { organizationId: actor.organizationId, sessionId }, _sum: { score: true } });
    await tx.practiceSession.update({
      where: { id: session.id },
      data: { answeredCount, score: totalScore._sum.score ?? 0, ...(answeredCount >= session.totalQuestions ? { status: PracticeSessionStatus.COMPLETED, completedAt: new Date() } : {}) },
    });
  });
  return { isCorrect, score, correctAnswer: row.correctAnswer, explanation: row.explanation, next: await getPracticeSession(actor, sessionId) };
}

export async function practiceHistory(actor: Actor) {
  return prisma.practiceSession.findMany({
    where: { organizationId: actor.organizationId, studentId: actor.userId },
    include: { course: { select: { title: true, code: true } } },
    orderBy: { createdAt: 'desc' }, take: 100,
  });
}

export async function studentAssessments(actor: Actor) {
  if (actor.role !== Role.STUDENT) throw new HttpError(403, 'Student access required');
  const now = new Date();
  const enrollments = await prisma.enrollment.findMany({
    where: { organizationId: actor.organizationId, studentId: actor.userId, status: EnrollmentStatus.ACTIVE, course: { status: 'PUBLISHED' } },
    select: { courseId: true },
  });
  return prisma.assessment.findMany({
    where: { organizationId: actor.organizationId, courseId: { in: enrollments.map(({ courseId }) => courseId) }, status: { in: [AssessmentStatus.PUBLISHED, AssessmentStatus.CLOSED] } },
    select: {
      id: true, title: true, status: true, instructions: true, totalMarks: true, passMark: true, durationMinutes: true, opensAt: true, closesAt: true, maxAttempts: true,
      resultReleaseMode: true, resultsReleasedAt: true,
      course: { select: { title: true, code: true } },
      attempts: { where: { organizationId: actor.organizationId, studentId: actor.userId }, select: { id: true, status: true, submittedAt: true, score: true }, orderBy: { startedAt: 'desc' } },
    },
    orderBy: [{ opensAt: 'asc' }, { createdAt: 'desc' }],
  }).then((items) => items.map((item) => ({
    ...item,
    attempts: item.attempts.map((attempt) => ({
      ...attempt,
      score: item.resultReleaseMode === ResultReleaseMode.IMMEDIATE || item.resultsReleasedAt ? attempt.score : null,
    })),
    availability: item.status === AssessmentStatus.CLOSED || (item.closesAt && item.closesAt <= now) ? 'CLOSED' : item.opensAt && item.opensAt > now ? 'UPCOMING' : 'OPEN',
  })));
}

function attemptSnapshot(assessment: { publishedSnapshot: Prisma.JsonValue | null; shuffleQuestions: boolean; shuffleOptions: boolean }) {
  if (!Array.isArray(assessment.publishedSnapshot)) throw new HttpError(409, 'Published assessment snapshot is unavailable');
  const questions = assessment.publishedSnapshot as unknown as SnapshotQuestion[];
  const ordered = assessment.shuffleQuestions ? shuffled(questions) : questions;
  return ordered.map((question) => ({
    ...question,
    options: assessment.shuffleOptions && Array.isArray(question.options) ? shuffled(question.options) : question.options,
  }));
}

async function submitAttempt(organizationId: string, attemptId: string, status: AssessmentAttemptStatus = AssessmentAttemptStatus.SUBMITTED) {
  const attempt = await prisma.assessmentAttempt.findFirst({
    where: { id: attemptId, organizationId, status: AssessmentAttemptStatus.IN_PROGRESS },
    include: { answers: true, assessment: { select: { totalMarks: true, passMark: true } } },
  });
  if (!attempt) return prisma.assessmentAttempt.findFirst({ where: { id: attemptId, organizationId } });
  const questions = attempt.snapshot as unknown as SnapshotQuestion[];
  let score = 0;
  const answerScores: Array<{ id: string; score: number }> = [];
  for (const question of questions) {
    const answer = attempt.answers.find((item) => item.questionId === question.id);
    const result = answer ? grade(question, answer.answer) : 0;
    score += result;
    if (answer) answerScores.push({ id: answer.id, score: result });
  }
  const percentage = attempt.assessment.totalMarks === 0 ? 0 : (score / attempt.assessment.totalMarks) * 100;
  return prisma.$transaction(async (tx) => {
    for (const item of answerScores) await tx.assessmentAttemptAnswer.update({ where: { id: item.id }, data: { score: item.score } });
    return tx.assessmentAttempt.update({
      where: { id: attempt.id },
      data: { status, activeKey: null, submittedAt: new Date(), score, percentage, passed: score >= attempt.assessment.passMark },
    });
  });
}

async function expireIfNeeded(attempt: { id: string; expiresAt: Date; organizationId: string; status: AssessmentAttemptStatus }) {
  if (attempt.status === AssessmentAttemptStatus.IN_PROGRESS && attempt.expiresAt <= new Date()) {
    await submitAttempt(attempt.organizationId, attempt.id, AssessmentAttemptStatus.EXPIRED);
  }
}

async function safeAttempt(attemptId: string, organizationId: string, studentId: string) {
  const attempt = await prisma.assessmentAttempt.findFirst({
    where: { id: attemptId, organizationId, studentId },
    include: { answers: true, assessment: { select: { id: true, title: true, totalMarks: true, passMark: true, resultReleaseMode: true, answerReviewAllowed: true, resultsReleasedAt: true } } },
  });
  if (!attempt) throw new HttpError(404, 'Assessment attempt not found');
  await expireIfNeeded(attempt);
  const fresh = await prisma.assessmentAttempt.findFirstOrThrow({
    where: { id: attemptId, organizationId, studentId },
    include: { answers: true, assessment: { select: { id: true, title: true, totalMarks: true, passMark: true, resultReleaseMode: true, answerReviewAllowed: true, resultsReleasedAt: true } } },
  });
  const released = fresh.assessment.resultReleaseMode === ResultReleaseMode.IMMEDIATE || Boolean(fresh.assessment.resultsReleasedAt);
  const review = fresh.status !== AssessmentAttemptStatus.IN_PROGRESS && released && fresh.assessment.answerReviewAllowed;
  const questions = fresh.snapshot as unknown as SnapshotQuestion[];
  const answerMap = new Map(fresh.answers.map((answer) => [answer.questionId, answer.answer]));
  const history = await prisma.assessmentAttempt.findMany({
    where: { organizationId, assessmentId: fresh.assessmentId, studentId },
    select: { id: true, status: true, startedAt: true, submittedAt: true, score: true, percentage: true, passed: true },
    orderBy: { startedAt: 'desc' },
  });
  const historyReleased = fresh.assessment.resultReleaseMode === ResultReleaseMode.IMMEDIATE || Boolean(fresh.assessment.resultsReleasedAt);
  return {
    id: fresh.id, status: fresh.status, startedAt: fresh.startedAt, expiresAt: fresh.expiresAt, submittedAt: fresh.submittedAt,
    timeTakenSeconds: fresh.submittedAt ? Math.max(0, Math.floor((fresh.submittedAt.getTime() - fresh.startedAt.getTime()) / 1000)) : null,
    remainingSeconds: Math.max(0, Math.floor((fresh.expiresAt.getTime() - Date.now()) / 1000)),
    history: history.map((item) => ({
      ...item,
      score: historyReleased ? item.score : null,
      percentage: historyReleased ? item.percentage : null,
      passed: historyReleased ? item.passed : null,
    })),
    assessment: fresh.assessment,
    score: released ? fresh.score : null, percentage: released ? fresh.percentage : null, passed: released ? fresh.passed : null,
    questions: questions.map((question) => review
      ? { ...question, answer: answerMap.get(question.id) ?? null }
      : studentQuestion(question, answerMap.get(question.id))),
  };
}

export async function startAttempt(actor: Actor, assessmentId: string) {
  if (actor.role !== Role.STUDENT) throw new HttpError(403, 'Student access required');
  const assessment = await prisma.assessment.findFirst({
    where: { id: assessmentId, organizationId: actor.organizationId, status: AssessmentStatus.PUBLISHED,
      course: { enrollments: { some: { studentId: actor.userId, organizationId: actor.organizationId, status: EnrollmentStatus.ACTIVE } } } },
  });
  if (!assessment) throw new HttpError(404, 'Assessment not found for an active enrollment');
  const now = new Date();
  if (assessment.opensAt && assessment.opensAt > now) throw new HttpError(409, 'Assessment has not opened yet');
  if (assessment.closesAt && assessment.closesAt <= now) throw new HttpError(409, 'Assessment is closed');
  const active = await prisma.assessmentAttempt.findFirst({
    where: { organizationId: actor.organizationId, studentId: actor.userId, status: AssessmentAttemptStatus.IN_PROGRESS },
  });
  if (active) {
    await expireIfNeeded(active);
    const updated = await prisma.assessmentAttempt.findFirst({ where: { id: active.id, status: AssessmentAttemptStatus.IN_PROGRESS } });
    if (updated) {
      if (updated.assessmentId !== assessmentId) throw new HttpError(409, 'Submit your active assessment before starting another');
      return safeAttempt(updated.id, actor.organizationId, actor.userId);
    }
  }
  const count = await prisma.assessmentAttempt.count({
    where: { organizationId: actor.organizationId, assessmentId, studentId: actor.userId, status: { in: [AssessmentAttemptStatus.SUBMITTED, AssessmentAttemptStatus.EXPIRED] } },
  });
  if (count >= assessment.maxAttempts) throw new HttpError(409, 'Maximum attempts reached');
  const durationEnds = new Date(now.getTime() + assessment.durationMinutes * 60_000);
  const expiresAt = assessment.closesAt && assessment.closesAt < durationEnds ? assessment.closesAt : durationEnds;
  try {
    const attempt = await prisma.assessmentAttempt.create({
      data: { organizationId: actor.organizationId, assessmentId, studentId: actor.userId, activeKey: 'ACTIVE', expiresAt, snapshot: json(attemptSnapshot(assessment)) },
    });
    return safeAttempt(attempt.id, actor.organizationId, actor.userId);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const current = await prisma.assessmentAttempt.findFirst({
        where: { organizationId: actor.organizationId, studentId: actor.userId, status: AssessmentAttemptStatus.IN_PROGRESS },
      });
      if (current?.assessmentId === assessmentId) return safeAttempt(current.id, actor.organizationId, actor.userId);
      if (current) throw new HttpError(409, 'Submit your active assessment before starting another');
      throw new HttpError(409, 'An assessment attempt is already active');
    }
    throw error;
  }
}

export async function getAttempt(actor: Actor, attemptId: string) {
  if (actor.role !== Role.STUDENT) throw new HttpError(403, 'Student access required');
  return safeAttempt(attemptId, actor.organizationId, actor.userId);
}

export async function saveAttemptAnswer(actor: Actor, attemptId: string, questionId: string, answer: unknown) {
  if (actor.role !== Role.STUDENT) throw new HttpError(403, 'Student access required');
  const attempt = await prisma.assessmentAttempt.findFirst({
    where: { id: attemptId, organizationId: actor.organizationId, studentId: actor.userId, status: AssessmentAttemptStatus.IN_PROGRESS },
  });
  if (!attempt) throw new HttpError(404, 'Active attempt not found');
  await expireIfNeeded(attempt);
  if (attempt.expiresAt <= new Date()) throw new HttpError(409, 'Assessment time has expired');
  if (!(attempt.snapshot as unknown as SnapshotQuestion[]).some((question) => question.id === questionId)) throw new HttpError(400, 'Question is not part of this attempt');
  await prisma.assessmentAttemptAnswer.upsert({
    where: { organizationId_attemptId_questionId: { organizationId: actor.organizationId, attemptId, questionId } },
    create: { organizationId: actor.organizationId, attemptId, questionId, answer: json(answer) },
    update: { answer: json(answer), answeredAt: new Date() },
  });
  return safeAttempt(attemptId, actor.organizationId, actor.userId);
}

export async function submitStudentAttempt(actor: Actor, attemptId: string) {
  if (actor.role !== Role.STUDENT) throw new HttpError(403, 'Student access required');
  const attempt = await prisma.assessmentAttempt.findFirst({ where: { id: attemptId, organizationId: actor.organizationId, studentId: actor.userId } });
  if (!attempt) throw new HttpError(404, 'Assessment attempt not found');
  if (attempt.status === AssessmentAttemptStatus.IN_PROGRESS) {
    await expireIfNeeded(attempt);
    const current = await prisma.assessmentAttempt.findFirst({ where: { id: attemptId, organizationId: actor.organizationId } });
    if (current?.status === AssessmentAttemptStatus.IN_PROGRESS) await submitAttempt(actor.organizationId, attemptId);
  }
  return safeAttempt(attemptId, actor.organizationId, actor.userId);
}

export async function logAttemptEvent(actor: Actor, attemptId: string, eventType: string, details?: Record<string, string>) {
  if (actor.role !== Role.STUDENT) throw new HttpError(403, 'Student access required');
  const attempt = await prisma.assessmentAttempt.findFirst({ where: { id: attemptId, organizationId: actor.organizationId, studentId: actor.userId, status: AssessmentAttemptStatus.IN_PROGRESS }, select: { id: true } });
  if (!attempt) throw new HttpError(404, 'Active attempt not found');
  await prisma.$transaction(async (tx) => {
    await tx.assessmentAttemptEvent.create({ data: { organizationId: actor.organizationId, attemptId, eventType, details: details ? json(details) : Prisma.DbNull } });
    await tx.assessmentAttempt.update({ where: { id: attemptId }, data: { flagged: true } });
  });
}

export async function listResults(actor: Actor, assessmentId: string) {
  const assessment = await managedAssessment(actor, assessmentId);
  const attempts = await prisma.assessmentAttempt.findMany({
    where: { organizationId: actor.organizationId, assessmentId },
    include: { student: { select: { id: true, name: true, studentProfile: { select: { studentId: true } } }, }, answers: true, events: true },
    orderBy: { submittedAt: 'desc' },
  });
  const submitted = attempts.filter((attempt) => attempt.status !== AssessmentAttemptStatus.IN_PROGRESS);
  const scores = submitted.map((attempt) => attempt.score ?? 0);
  const analysis = assessment.questions.map((question) => {
    const values = submitted.map((attempt) => {
      const snapshot = attempt.snapshot as unknown as SnapshotQuestion[];
      const q = snapshot.find(({ id }) => id === question.id);
      const answer = attempt.answers.find(({ questionId }) => questionId === question.id);
      return q && answer ? grade(q, answer.answer) / q.marks * 100 : 0;
    });
    return { questionId: question.id, prompt: question.prompt, difficulty: question.difficulty, averagePercent: values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0 };
  });
  return {
    assessment: { id: assessment.id, title: assessment.title, totalMarks: assessment.totalMarks, passMark: assessment.passMark, resultReleaseMode: assessment.resultReleaseMode, resultsReleasedAt: assessment.resultsReleasedAt },
    summary: { attempts: submitted.length, average: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0, passRate: scores.length ? submitted.filter((item) => item.passed).length / scores.length * 100 : 0, highest: scores.length ? Math.max(...scores) : 0, lowest: scores.length ? Math.min(...scores) : 0 },
    attempts: attempts.map((row) => ({
      id: row.id, organizationId: row.organizationId, assessmentId: row.assessmentId, studentId: row.studentId,
      status: row.status, startedAt: row.startedAt, expiresAt: row.expiresAt, submittedAt: row.submittedAt,
      score: row.score, percentage: row.percentage, passed: row.passed, flagged: row.flagged,
      createdAt: row.createdAt, updatedAt: row.updatedAt, student: row.student, flaggedEvents: row.events,
      answerScores: row.answers.map(({ questionId, score }) => ({ questionId, score })),
    })),
    questionAnalysis: analysis,
  };
}

export async function releaseResults(actor: Actor, assessmentId: string) {
  const assessment = await managedAssessment(actor, assessmentId);
  if (assessment.resultReleaseMode !== ResultReleaseMode.MANUAL) throw new HttpError(409, 'Results release is only needed for MANUAL mode');
  return prisma.$transaction(async (tx) => {
    const updated = await tx.assessment.update({ where: { id: assessment.id }, data: { resultsReleasedAt: new Date() } });
    await audit(tx, actor, 'ASSESSMENT_RESULTS_RELEASED', 'Assessment', assessment.id);
    return updated;
  });
}

export async function regradeQuestion(actor: Actor, assessmentId: string, questionId: string, correctAnswer: unknown) {
  const assessment = await managedAssessment(actor, assessmentId);
  if (assessment.status === AssessmentStatus.DRAFT) throw new HttpError(409, 'Regrade is available after publication');
  const target = assessment.questions.find(({ id }) => id === questionId);
  if (!target) throw new HttpError(404, 'Assessment question not found');
  const updatedQuestions = assessment.questions.map((question) => question.id === questionId
    ? { ...questionSnapshot(question), correctAnswer }
    : questionSnapshot(question));
  const attempts = await prisma.assessmentAttempt.findMany({
    where: { organizationId: actor.organizationId, assessmentId },
    include: { answers: true },
  });
  return prisma.$transaction(async (tx) => {
    await tx.assessmentQuestion.update({ where: { id: questionId }, data: { correctAnswer: json(correctAnswer) } });
    await tx.assessment.update({ where: { id: assessmentId }, data: { publishedSnapshot: json(updatedQuestions) } });
    for (const attempt of attempts) {
      const snapshot = attempt.snapshot as unknown as SnapshotQuestion[];
      const revised = snapshot.map((question) => question.id === questionId ? { ...question, correctAnswer } : question);
      let score = 0;
      for (const question of revised) {
        const answer = attempt.answers.find(({ questionId: id }) => id === question.id);
        const itemScore = answer ? grade(question, answer.answer) : 0;
        score += itemScore;
        if (answer) await tx.assessmentAttemptAnswer.update({ where: { id: answer.id }, data: { score: itemScore } });
      }
      if (attempt.status !== AssessmentAttemptStatus.IN_PROGRESS) {
        await tx.assessmentAttempt.update({
          where: { id: attempt.id },
          data: { snapshot: json(revised), score, percentage: score / assessment.totalMarks * 100, passed: score >= assessment.passMark },
        });
      }
    }
    await audit(tx, actor, 'ASSESSMENT_QUESTION_REGRADED', 'Assessment', assessmentId, { questionId });
    return { updatedAttempts: attempts.length };
  });
}

export async function exportResults(actor: Actor, assessmentId: string) {
  const results = await listResults(actor, assessmentId);
  const quote = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`;
  const lines = [
    ['studentId', 'studentName', 'score', 'passed', 'submittedAt', 'flagged'].map(quote).join(','),
    ...results.attempts.map((attempt) => [
      attempt.student.studentProfile?.studentId ?? '', attempt.student.name, attempt.score ?? '',
      attempt.passed ?? '', attempt.submittedAt?.toISOString() ?? '', attempt.flagged,
    ].map(quote).join(',')),
  ];
  return lines.join('\r\n');
}

export async function studentResult(actor: Actor, attemptId: string) {
  if (actor.role !== Role.STUDENT) throw new HttpError(403, 'Student access required');
  const result = await safeAttempt(attemptId, actor.organizationId, actor.userId);
  if (result.status === AssessmentAttemptStatus.IN_PROGRESS) throw new HttpError(409, 'Assessment is not submitted');
  if (result.score === null) throw new HttpError(403, 'Results have not been released');
  return result;
}

export async function expireOverdueAttempts() {
  const attempts = await prisma.assessmentAttempt.findMany({
    where: { status: AssessmentAttemptStatus.IN_PROGRESS, expiresAt: { lte: new Date() } },
    select: { id: true, organizationId: true },
    take: 100,
    orderBy: { expiresAt: 'asc' },
  });
  for (const attempt of attempts) await submitAttempt(attempt.organizationId, attempt.id, AssessmentAttemptStatus.EXPIRED);
  return attempts.length;
}
