import type { Request, RequestHandler } from 'express';
import { getOrganizationId } from '../../middleware/authenticate.js';
import { HttpError } from '../../utils/http-error.js';
import * as service from './learning.service.js';
import {
  createQuestionSchema, eventSchema, practiceStartSchema, questionListQuerySchema,
  regradeSchema,
} from './learning.schemas.js';

function actor(req: Request) {
  if (!req.auth) throw new HttpError(401, 'Authentication required');
  return { organizationId: getOrganizationId(req), userId: req.auth.userId, role: req.auth.role };
}

function param(req: Request, key: string): string {
  const value = req.params[key];
  if (typeof value !== 'string') throw new HttpError(400, `Invalid ${key}`);
  return value;
}

export const listQuestions: RequestHandler = async (req, res) => {
  res.json({ data: { questions: await service.listQuestions(actor(req), questionListQuerySchema.parse(req.query)) } });
};

export const createQuestion: RequestHandler = async (req, res) => {
  res.status(201).json({ data: { question: await service.createQuestion(actor(req), req.body) } });
};

export const updateQuestion: RequestHandler = async (req, res) => {
  res.json({ data: { question: await service.updateQuestion(actor(req), param(req, 'questionId'), req.body) } });
};

export const deleteQuestion: RequestHandler = async (req, res) => {
  await service.deleteQuestion(actor(req), param(req, 'questionId'));
  res.status(204).end();
};

export const questionTemplate: RequestHandler = (_req, res) => {
  res.type('text/csv').send('courseId,type,prompt,options,correctAnswer,topic,difficulty,marks,explanation\r\n');
};

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') { cell += '"'; index += 1; }
      else if (character === '"') quoted = false;
      else cell += character;
    } else if (character === '"' && cell.length === 0) quoted = true;
    else if (character === ',') { row.push(cell); cell = ''; }
    else if (character === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; }
    else cell += character;
  }
  if (quoted) throw new HttpError(400, 'CSV contains an unclosed quoted field');
  if (cell.length || row.length) { row.push(cell.replace(/\r$/, '')); rows.push(row); }
  return rows;
}

function parseJsonCell(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('[') || trimmed.startsWith('{') || trimmed.startsWith('"')) return JSON.parse(trimmed) as unknown;
  return trimmed;
}

export const importQuestions: RequestHandler = async (req, res) => {
  const csv = typeof req.body?.csv === 'string' ? req.body.csv : '';
  if (!csv || csv.length > 2_000_000) throw new HttpError(400, 'Provide CSV content up to 2 MB');
  const rows = parseCsv(csv);
  if (rows.length < 2) throw new HttpError(400, 'CSV must contain a header and at least one data row');
  const headers = rows[0]!.map((cell) => cell.trim());
  const required = ['courseId', 'type', 'prompt', 'correctAnswer', 'topic', 'difficulty', 'marks'];
  const missing = required.filter((header) => !headers.includes(header));
  if (missing.length) throw new HttpError(400, `CSV is missing columns: ${missing.join(', ')}`);
  const results: Array<{ row: number; status: 'imported' | 'error'; message?: string }> = [];
  for (const [index, cells] of rows.slice(1).entries()) {
    const rowNumber = index + 2;
    if (cells.every((cell) => !cell.trim())) continue;
    try {
      const record = Object.fromEntries(headers.map((header, column) => [header, cells[column] ?? '']));
      if (record.type === 'MATCH') throw new Error('MATCH questions must be entered in the form');
      const parsed = createQuestionSchema.parse({
        ...record,
        options: parseJsonCell(String(record.options ?? '')),
        correctAnswer: parseJsonCell(String(record.correctAnswer ?? '')),
        topicId: String(record.topicId ?? '').trim() || null,
        marks: Number(record.marks),
      });
      await service.createQuestion(actor(req), parsed);
      results.push({ row: rowNumber, status: 'imported' });
    } catch (error) {
      results.push({ row: rowNumber, status: 'error', message: error instanceof Error ? error.message : 'Invalid row' });
    }
  }
  res.json({ data: { results, imported: results.filter(({ status }) => status === 'imported').length, errors: results.filter(({ status }) => status === 'error').length } });
};

export const listAssessments: RequestHandler = async (req, res) => {
  res.json({ data: { assessments: await service.listAssessments(actor(req)) } });
};

export const getAssessment: RequestHandler = async (req, res) => {
  res.json({ data: { assessment: await service.getAssessment(actor(req), param(req, 'assessmentId')) } });
};

export const createAssessment: RequestHandler = async (req, res) => {
  res.status(201).json({ data: { assessment: await service.createAssessment(actor(req), req.body) } });
};

export const updateAssessment: RequestHandler = async (req, res) => {
  res.json({ data: { assessment: await service.updateAssessment(actor(req), param(req, 'assessmentId'), req.body) } });
};

export const addAssessmentQuestion: RequestHandler = async (req, res) => {
  res.status(201).json({ data: { question: await service.addAssessmentQuestion(actor(req), param(req, 'assessmentId'), req.body) } });
};

export const updateAssessmentQuestion: RequestHandler = async (req, res) => {
  res.json({ data: { question: await service.updateAssessmentQuestion(actor(req), param(req, 'assessmentId'), param(req, 'questionId'), req.body) } });
};

export const deleteAssessmentQuestion: RequestHandler = async (req, res) => {
  await service.deleteAssessmentQuestion(actor(req), param(req, 'assessmentId'), param(req, 'questionId'));
  res.status(204).end();
};

export const reorderAssessmentQuestions: RequestHandler = async (req, res) => {
  await service.reorderAssessmentQuestions(actor(req), param(req, 'assessmentId'), req.body.questionIds);
  res.status(204).end();
};

export const closeAssessment: RequestHandler = async (req, res) => {
  res.json({ data: { assessment: await service.closeAssessment(actor(req), param(req, 'assessmentId')) } });
};

export const publishAssessment: RequestHandler = async (req, res) => {
  res.json({ data: { assessment: await service.publishAssessment(actor(req), param(req, 'assessmentId')) } });
};

export const duplicateAssessment: RequestHandler = async (req, res) => {
  res.status(201).json({ data: { assessment: await service.duplicateAssessment(actor(req), param(req, 'assessmentId')) } });
};

export const listResults: RequestHandler = async (req, res) => {
  res.json({ data: await service.listResults(actor(req), param(req, 'assessmentId')) });
};

export const releaseResults: RequestHandler = async (req, res) => {
  res.json({ data: { assessment: await service.releaseResults(actor(req), param(req, 'assessmentId')) } });
};

export const regradeQuestion: RequestHandler = async (req, res) => {
  const input = regradeSchema.parse(req.body);
  res.json({ data: await service.regradeQuestion(actor(req), param(req, 'assessmentId'), input.questionId, input.correctAnswer) });
};

export const exportResults: RequestHandler = async (req, res) => {
  const csv = await service.exportResults(actor(req), param(req, 'assessmentId'));
  res.type('text/csv').attachment(`assessment-${param(req, 'assessmentId')}-results.csv`).send(csv);
};

export const studentAssessments: RequestHandler = async (req, res) => {
  res.json({ data: { assessments: await service.studentAssessments(actor(req)) } });
};

export const startAttempt: RequestHandler = async (req, res) => {
  res.status(201).json({ data: { attempt: await service.startAttempt(actor(req), param(req, 'assessmentId')) } });
};

export const getAttempt: RequestHandler = async (req, res) => {
  res.json({ data: { attempt: await service.getAttempt(actor(req), param(req, 'attemptId')) } });
};

export const saveAttemptAnswer: RequestHandler = async (req, res) => {
  res.json({ data: { attempt: await service.saveAttemptAnswer(actor(req), param(req, 'attemptId'), req.body.questionId, req.body.answer) } });
};

export const submitAttempt: RequestHandler = async (req, res) => {
  res.json({ data: { attempt: await service.submitStudentAttempt(actor(req), param(req, 'attemptId')) } });
};

export const attemptEvent: RequestHandler = async (req, res) => {
  const event = eventSchema.parse(req.body);
  await service.logAttemptEvent(actor(req), param(req, 'attemptId'), event.eventType, event.details);
  res.status(204).end();
};

export const studentResult: RequestHandler = async (req, res) => {
  res.json({ data: { result: await service.studentResult(actor(req), param(req, 'attemptId')) } });
};

export const startPractice: RequestHandler = async (req, res) => {
  const input = practiceStartSchema.parse(req.body);
  res.status(201).json({ data: { ...await service.startPractice(actor(req), input) } });
};

export const getPracticeSession: RequestHandler = async (req, res) => {
  res.json({ data: await service.getPracticeSession(actor(req), param(req, 'sessionId')) });
};

export const answerPractice: RequestHandler = async (req, res) => {
  res.json({ data: await service.answerPractice(actor(req), param(req, 'sessionId'), req.body.questionId, req.body.answer) });
};

export const practiceHistory: RequestHandler = async (req, res) => {
  res.json({ data: { sessions: await service.practiceHistory(actor(req)) } });
};
