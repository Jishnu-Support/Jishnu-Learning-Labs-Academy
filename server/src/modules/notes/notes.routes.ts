import { Router } from 'express';
import multer from 'multer';
import { Role } from '@prisma/client';
import { authenticate, requireOrganization, requireRoles } from '../../middleware/authenticate.js';
import { validateBody, validateParams } from '../../middleware/validate.js';
import * as controller from './notes.controller.js';
import { createNoteSchema, noteParamSchema, updateNoteSchema } from './notes.schemas.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024, files: 1 } });
const noteEditors = [Role.ORG_ADMIN, Role.INSTRUCTOR, Role.STAFF] as const;
const noteViewers = [...noteEditors, Role.STUDENT] as const;

export const notesRouter = Router();
notesRouter.use(authenticate, requireOrganization);
notesRouter.get('/', requireRoles(...noteViewers), controller.list);
notesRouter.post('/', requireRoles(...noteEditors), upload.single('file'), validateBody(createNoteSchema), controller.create);
notesRouter.get('/:noteId/view', requireRoles(...noteViewers), validateParams(noteParamSchema), controller.view);
notesRouter.get('/:noteId/download', requireRoles(...noteEditors), validateParams(noteParamSchema), controller.download);
notesRouter.patch('/:noteId', requireRoles(...noteEditors), validateParams(noteParamSchema), validateBody(updateNoteSchema), controller.update);
notesRouter.post('/:noteId/publish', requireRoles(...noteEditors), validateParams(noteParamSchema), controller.publish);
notesRouter.post('/:noteId/unpublish', requireRoles(...noteEditors), validateParams(noteParamSchema), controller.unpublish);
notesRouter.delete('/:noteId', requireRoles(...noteEditors), validateParams(noteParamSchema), controller.remove);
