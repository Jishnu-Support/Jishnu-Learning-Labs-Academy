import { z } from 'zod';

const questionTypes = ['MCQ_SINGLE', 'MCQ_MULTIPLE', 'TRUE_FALSE', 'MATCH', 'FILL_BLANK', 'FILL_IN_BLANK', 'SHORT_ANSWER'] as const;
const difficulties = ['BEGINNER', 'INTERMEDIATE', 'ADVANCED'] as const;

const questionObject = z.object({
  courseId: z.string().cuid(),
  topicId: z.string().cuid().nullable().optional(),
  type: z.enum(questionTypes),
  prompt: z.string().trim().min(2).max(4000),
  options: z.unknown().nullable().optional(),
  correctAnswer: z.unknown(),
  topic: z.string().trim().min(1).max(120),
  difficulty: z.enum(difficulties),
  marks: z.number().int().min(1).max(100),
  explanation: z.string().trim().max(4000).nullable().optional(),
});

function validateQuestion(
  value: { type: typeof questionTypes[number]; options?: unknown; correctAnswer: unknown },
  context: z.RefinementCtx,
) {
  const stringOptions = Array.isArray(value.options) && value.options.length >= 2 &&
    value.options.every((option) => typeof option === 'string');
  if (['MCQ_SINGLE', 'MCQ_MULTIPLE', 'TRUE_FALSE'].includes(value.type) && !stringOptions) {
    context.addIssue({ code: 'custom', message: 'Select at least two options', path: ['options'] });
  }
  if (value.type === 'MCQ_SINGLE' && stringOptions && (
    typeof value.correctAnswer !== 'string' || !(value.options as string[]).includes(value.correctAnswer)
  )) context.addIssue({ code: 'custom', message: 'Choose one of the listed options', path: ['correctAnswer'] });
  if (value.type === 'MCQ_MULTIPLE' && stringOptions && (
    !Array.isArray(value.correctAnswer) || !value.correctAnswer.length ||
    !value.correctAnswer.every((answer) => typeof answer === 'string' && (value.options as string[]).includes(answer))
  )) context.addIssue({ code: 'custom', message: 'Choose one or more listed options', path: ['correctAnswer'] });
  if (value.type === 'TRUE_FALSE' && !['True', 'False', 'true', 'false', true, false].includes(value.correctAnswer as string | boolean)) {
    context.addIssue({ code: 'custom', message: 'True/False answer must be true or false', path: ['correctAnswer'] });
  }
  if (value.type === 'MATCH') {
    const validPairs = Array.isArray(value.options) && value.options.length > 0 &&
      value.options.every((pair) => Boolean(pair) && typeof pair === 'object' &&
        'left' in pair && typeof pair.left === 'string' && 'right' in pair && typeof pair.right === 'string');
    if (!validPairs || !value.correctAnswer || typeof value.correctAnswer !== 'object' || Array.isArray(value.correctAnswer)) {
      context.addIssue({ code: 'custom', message: 'Match questions need left/right pairs and a correct-pair object', path: ['options'] });
    } else {
      const pairs = value.options as Array<{ left: string; right: string }>;
      const expected = value.correctAnswer as Record<string, unknown>;
      const left = new Set(pairs.map((pair) => pair.left));
      const right = new Set(pairs.map((pair) => pair.right));
      if (Object.keys(expected).length !== left.size || Object.keys(expected).some((key) => !left.has(key) || typeof expected[key] !== 'string' || !right.has(expected[key] as string))) {
        context.addIssue({ code: 'custom', message: 'Correct pairs must map each left item to a listed right item', path: ['correctAnswer'] });
      }
    }
  }
  if ((value.type === 'FILL_BLANK' || value.type === 'FILL_IN_BLANK' || value.type === 'SHORT_ANSWER') &&
      !(typeof value.correctAnswer === 'string' || (Array.isArray(value.correctAnswer) && value.correctAnswer.length > 0))) {
    context.addIssue({ code: 'custom', message: 'Provide accepted answer text', path: ['correctAnswer'] });
  }
}

export const questionSchema = questionObject.superRefine(validateQuestion);

export const questionIdSchema = z.object({ questionId: z.string().cuid() });
export const assessmentIdSchema = z.object({ assessmentId: z.string().cuid() });
export const assessmentQuestionIdSchema = z.object({ assessmentId: z.string().cuid(), questionId: z.string().cuid() });
export const attemptIdSchema = z.object({ attemptId: z.string().cuid() });
export const practiceSessionIdSchema = z.object({ sessionId: z.string().cuid() });

export const questionListQuerySchema = z.object({
  courseId: z.string().cuid().optional(),
  topicId: z.string().cuid().optional(),
  difficulty: z.enum(difficulties).optional(),
  type: z.enum(questionTypes).optional(),
  search: z.string().trim().max(120).optional(),
});

export const createQuestionSchema = questionSchema;
export const updateQuestionSchema = questionObject.partial().omit({ courseId: true }).refine(
  (value) => Object.keys(value).length > 0,
  'Provide at least one field to update',
);

const assessmentQuestionObject = questionObject.omit({ courseId: true }).extend({
  sourceQuestionId: z.string().cuid().optional(),
  order: z.number().int().min(0).optional(),
});
const assessmentQuestionSchema = assessmentQuestionObject.superRefine(validateQuestion);

const assessmentFields = {
  courseId: z.string().cuid(),
  title: z.string().trim().min(2).max(200),
  instructions: z.string().trim().max(5000).default(''),
  totalMarks: z.number().int().min(1).max(10000),
  passMark: z.number().int().min(0).max(10000),
  durationMinutes: z.number().int().min(1).max(1440),
  opensAt: z.iso.datetime().nullable().optional(),
  closesAt: z.iso.datetime().nullable().optional(),
  maxAttempts: z.number().int().min(1).max(20).default(1),
  shuffleQuestions: z.boolean().default(false),
  shuffleOptions: z.boolean().default(false),
  resultReleaseMode: z.enum(['IMMEDIATE', 'MANUAL']).default('IMMEDIATE'),
  answerReviewAllowed: z.boolean().default(true),
  weight: z.number().positive().nullable().optional(),
  questions: z.array(assessmentQuestionSchema).max(200).default([]),
};

export const createAssessmentSchema = z.object(assessmentFields).superRefine((value, context) => {
  if (value.passMark > value.totalMarks) context.addIssue({ code: 'custom', message: 'Pass mark cannot exceed total marks', path: ['passMark'] });
  if (value.opensAt && value.closesAt && value.closesAt <= value.opensAt) context.addIssue({ code: 'custom', message: 'Closing time must be after opening time', path: ['closesAt'] });
});

export const updateAssessmentSchema = z.object(assessmentFields).partial().omit({ courseId: true, questions: true }).refine(
  (value) => Object.keys(value).length > 0,
  'Provide at least one field to update',
);

export const addAssessmentQuestionSchema = assessmentQuestionSchema;
export const updateAssessmentQuestionSchema = assessmentQuestionObject.partial().omit({ sourceQuestionId: true, order: true }).refine(
  (value) => Object.keys(value).length > 0,
  'Provide at least one field to update',
);
export const reorderAssessmentQuestionsSchema = z.object({
  questionIds: z.array(z.string().cuid()).min(1).max(200),
}).refine((value) => new Set(value.questionIds).size === value.questionIds.length, 'Question IDs must be unique');
export const regradeSchema = z.object({ questionId: z.string().cuid(), correctAnswer: z.unknown() });
export const answerSchema = z.object({ questionId: z.string().cuid(), answer: z.unknown() });
export const practiceStartSchema = z.object({
  courseId: z.string().cuid(),
  topicId: z.string().cuid().optional(),
  difficulty: z.enum(difficulties).optional(),
  type: z.enum(questionTypes).optional(),
  count: z.number().int().min(1).max(50).default(10),
  timeLimitSeconds: z.number().int().min(60).max(7200).optional(),
});
export const eventSchema = z.object({
  eventType: z.enum(['TAB_SWITCH', 'COPY', 'PASTE', 'CONTEXT_MENU']),
  details: z.record(z.string(), z.string().max(100)).optional(),
});
