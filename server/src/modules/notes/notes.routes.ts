import { Router } from 'express';
import multer from 'multer';
import { Role } from '@prisma/client';
import { authenticate, requireOrganization, requireRoles } from '../../middleware/authenticate.js';
import { validateBody, validateParams } from '../../middleware/validate.js';
import { selectActiveOrganizationForSuperAdmin } from '../../middleware/super-admin-organization.js';
import * as controller from './notes.controller.js';
import { createNoteSchema, noteParamSchema, updateNoteSchema } from './notes.schemas.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024, files: 1 } });
const noteEditors = [Role.ORG_ADMIN, Role.TUTOR] as const;
const noteViewers = [...noteEditors, Role.STUDENT] as const;

export const notesRouter = Router();
notesRouter.use(authenticate, requireOrganization);
notesRouter.get('/', requireRoles(...noteViewers), controller.list);
notesRouter.put('/:noteId/saved', requireRoles(Role.STUDENT), validateParams(noteParamSchema), controller.save);
notesRouter.delete('/:noteId/saved', requireRoles(Role.STUDENT), validateParams(noteParamSchema), controller.unsave);
notesRouter.post('/', requireRoles(...noteEditors), upload.single('file'), validateBody(createNoteSchema), controller.create);
notesRouter.get('/:noteId/view', requireRoles(...noteViewers), validateParams(noteParamSchema), controller.view);
notesRouter.get('/:noteId/download', requireRoles(...noteEditors), validateParams(noteParamSchema), controller.download);
notesRouter.patch('/:noteId', requireRoles(...noteEditors), validateParams(noteParamSchema), validateBody(updateNoteSchema), controller.update);
notesRouter.post('/:noteId/publish', requireRoles(...noteEditors), validateParams(noteParamSchema), controller.publish);
notesRouter.post('/:noteId/unpublish', requireRoles(...noteEditors), validateParams(noteParamSchema), controller.unpublish);
notesRouter.delete('/:noteId', requireRoles(...noteEditors), validateParams(noteParamSchema), controller.remove);

export const superAdminNotesRouter = Router({ mergeParams: true });
superAdminNotesRouter.use(authenticate, requireRoles(Role.SUPER_ADMIN), selectActiveOrganizationForSuperAdmin);
superAdminNotesRouter.get('/', controller.list);
superAdminNotesRouter.post('/', upload.single('file'), validateBody(createNoteSchema), controller.create);
superAdminNotesRouter.get('/:noteId/view', validateParams(noteParamSchema), controller.view);
superAdminNotesRouter.get('/:noteId/download', validateParams(noteParamSchema), controller.download);
superAdminNotesRouter.patch('/:noteId', validateParams(noteParamSchema), validateBody(updateNoteSchema), controller.update);
superAdminNotesRouter.post('/:noteId/publish', validateParams(noteParamSchema), controller.publish);
superAdminNotesRouter.post('/:noteId/unpublish', validateParams(noteParamSchema), controller.unpublish);
superAdminNotesRouter.delete('/:noteId', validateParams(noteParamSchema), controller.remove);
