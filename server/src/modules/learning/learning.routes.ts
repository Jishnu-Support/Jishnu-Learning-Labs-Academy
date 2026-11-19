import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { Role } from '@prisma/client';
import { env } from '../../config/env.js';
import { authenticate, requireOrganization, requireRoles } from '../../middleware/authenticate.js';
import { selectActiveOrganizationForSuperAdmin } from '../../middleware/super-admin-organization.js';
import { validateBody, validateParams } from '../../middleware/validate.js';
import * as controller from './learning.controller.js';
import * as reportController from './assessment-reports.controller.js';
import {
  addAssessmentQuestionSchema, answerSchema, assessmentIdSchema, attemptIdSchema,
  assessmentQuestionIdSchema, createAssessmentSchema, createPracticeSetSchema, createQuestionSchema,
  generateAssessmentQuestionsSchema,
  practiceSessionIdSchema, practiceSetIdSchema, practiceStartSchema, questionIdSchema,
  reorderAssessmentQuestionsSchema, updateAssessmentQuestionSchema, updateAssessmentSchema,
  updatePracticeSetSchema, updateQuestionSchema,
} from './learning.schemas.js';
import { assessmentReportStudentParamsSchema } from './assessment-reports.schemas.js';

const teacherRouter = Router();
teacherRouter.use(requireRoles(Role.ORG_ADMIN, Role.TUTOR, Role.SUPER_ADMIN));
const aiGenerationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: env.NODE_ENV === 'test' ? 1000 : 10,
  keyGenerator: (req) => req.auth?.userId ?? 'unknown',
  standardHeaders: 'draft-8',
  legacyHeaders: false,
});
teacherRouter.get('/questions/template.csv', controller.questionTemplate);
teacherRouter.get('/questions', controller.listQuestions);
teacherRouter.post('/questions', validateBody(createQuestionSchema), controller.createQuestion);
teacherRouter.post('/questions/import', controller.importQuestions);
teacherRouter.patch('/questions/:questionId', validateParams(questionIdSchema), validateBody(updateQuestionSchema), controller.updateQuestion);
teacherRouter.delete('/questions/:questionId', validateParams(questionIdSchema), controller.deleteQuestion);
teacherRouter.get('/practice-sets', controller.listPracticeSets);
teacherRouter.post('/practice-sets', validateBody(createPracticeSetSchema), controller.createPracticeSet);
teacherRouter.get('/practice-sets/:setId', validateParams(practiceSetIdSchema), controller.getPracticeSet);
teacherRouter.patch('/practice-sets/:setId', validateParams(practiceSetIdSchema), validateBody(updatePracticeSetSchema), controller.updatePracticeSet);
teacherRouter.delete('/practice-sets/:setId', validateParams(practiceSetIdSchema), controller.deletePracticeSet);
teacherRouter.get('/assessments', controller.listAssessments);
teacherRouter.post('/assessments/generate-questions', aiGenerationLimiter, validateBody(generateAssessmentQuestionsSchema), controller.generateAssessmentQuestions);
teacherRouter.post('/assessments', validateBody(createAssessmentSchema), controller.createAssessment);
teacherRouter.patch('/assessments/:assessmentId/questions/reorder', validateParams(assessmentIdSchema), validateBody(reorderAssessmentQuestionsSchema), controller.reorderAssessmentQuestions);
teacherRouter.get('/assessments/:assessmentId', validateParams(assessmentIdSchema), controller.getAssessment);
teacherRouter.patch('/assessments/:assessmentId', validateParams(assessmentIdSchema), validateBody(updateAssessmentSchema), controller.updateAssessment);
teacherRouter.post('/assessments/:assessmentId/questions', validateParams(assessmentIdSchema), validateBody(addAssessmentQuestionSchema), controller.addAssessmentQuestion);
teacherRouter.patch('/assessments/:assessmentId/questions/:questionId', validateParams(assessmentQuestionIdSchema), validateBody(updateAssessmentQuestionSchema), controller.updateAssessmentQuestion);
teacherRouter.delete('/assessments/:assessmentId/questions/:questionId', validateParams(assessmentQuestionIdSchema), controller.deleteAssessmentQuestion);
teacherRouter.post('/assessments/:assessmentId/publish', validateParams(assessmentIdSchema), controller.publishAssessment);
teacherRouter.post('/assessments/:assessmentId/close', validateParams(assessmentIdSchema), controller.closeAssessment);
teacherRouter.post('/assessments/:assessmentId/reopen', validateParams(assessmentIdSchema), controller.reopenAssessment);
teacherRouter.post('/assessments/:assessmentId/duplicate', validateParams(assessmentIdSchema), controller.duplicateAssessment);
teacherRouter.get('/assessments/:assessmentId/results.csv', validateParams(assessmentIdSchema), controller.exportResults);
teacherRouter.get('/assessments/:assessmentId/results', validateParams(assessmentIdSchema), controller.listResults);
teacherRouter.post('/assessments/:assessmentId/results/release', validateParams(assessmentIdSchema), controller.releaseResults);
teacherRouter.post('/assessments/:assessmentId/results/regrade', validateParams(assessmentIdSchema), controller.regradeQuestion);

const studentRouter = Router();
studentRouter.use(requireRoles(Role.STUDENT));
const submissionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: env.NODE_ENV === 'test' ? 1000 : 120,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
});
studentRouter.get('/assessments', controller.studentAssessments);
studentRouter.post('/assessments/:assessmentId/attempts', submissionLimiter, validateParams(assessmentIdSchema), controller.startAttempt);
studentRouter.get('/attempts/:attemptId', validateParams(attemptIdSchema), controller.getAttempt);
studentRouter.put('/attempts/:attemptId/answers', submissionLimiter, validateParams(attemptIdSchema), validateBody(answerSchema), controller.saveAttemptAnswer);
studentRouter.post('/attempts/:attemptId/submit', submissionLimiter, validateParams(attemptIdSchema), controller.submitAttempt);
studentRouter.post('/attempts/:attemptId/events', validateParams(attemptIdSchema), controller.attemptEvent);
studentRouter.get('/attempts/:attemptId/result', validateParams(attemptIdSchema), controller.studentResult);
studentRouter.post('/practice/start', submissionLimiter, validateBody(practiceStartSchema), controller.startPractice);
studentRouter.get('/practice/history', controller.practiceHistory);
studentRouter.get('/practice-sets', controller.studentPracticeSets);
studentRouter.post('/practice-sets/:setId/start', validateParams(practiceSetIdSchema), controller.startPracticeSet);
studentRouter.get('/practice-sessions/:sessionId', validateParams(practiceSessionIdSchema), controller.getPracticeSession);
studentRouter.post('/practice-sessions/:sessionId/answers', submissionLimiter, validateParams(practiceSessionIdSchema), validateBody(answerSchema), controller.answerPractice);

const reportsRouter = Router();
reportsRouter.use(requireRoles(Role.ORG_ADMIN, Role.TUTOR));
reportsRouter.get('/', reportController.listReports);
reportsRouter.get('/export.csv', reportController.exportReports);
reportsRouter.get('/students/:studentId', validateParams(assessmentReportStudentParamsSchema), reportController.studentHistory);

export const learningRouter = Router();
learningRouter.use(authenticate, requireOrganization);
learningRouter.use('/teacher', teacherRouter);
learningRouter.use('/student', studentRouter);
learningRouter.use('/reports', reportsRouter);

export const superAdminLearningRouter = Router({ mergeParams: true });
superAdminLearningRouter.use(
  authenticate,
  requireRoles(Role.SUPER_ADMIN),
  selectActiveOrganizationForSuperAdmin,
);
superAdminLearningRouter.use('/teacher', teacherRouter);
