import { Router, type RequestHandler } from 'express';
import { Role } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { authenticate, requireRoles } from '../../middleware/authenticate.js';
import { selectActiveOrganizationForSuperAdmin } from '../../middleware/super-admin-organization.js';
import { validateParams } from '../../middleware/validate.js';
import { HttpError } from '../../utils/http-error.js';
import * as studentsController from '../students/students.controller.js';
import { studentParamSchema } from '../students/students.schemas.js';
import * as tutorsController from '../tutors/tutor.controller.js';
import { tutorParamSchema } from '../tutors/tutor.schemas.js';

const auditDirectoryAccess: RequestHandler = async (req, _res, next) => {
  const reason = req.get('x-access-reason')?.trim() ?? '';
  if (reason.length < 8 || reason.length > 500) {
    return next(new HttpError(400, 'Provide a directory access reason of 8 to 500 characters'));
  }
  try {
    await prisma.auditLog.create({
      data: {
        organizationId: req.auth!.organizationId,
        actorId: req.auth!.userId,
        action: 'SUPER_ADMIN_DIRECTORY_ACCESSED',
        targetType: req.path.includes('/students') ? 'StudentDirectory' : 'TutorDirectory',
        targetId: req.auth!.organizationId!,
        metadata: { reason },
      },
    });
    return next();
  } catch (error) {
    return next(error);
  }
};

export const superAdminDirectoriesRouter = Router({ mergeParams: true });
superAdminDirectoriesRouter.use(
  authenticate,
  requireRoles(Role.SUPER_ADMIN),
  selectActiveOrganizationForSuperAdmin,
  auditDirectoryAccess,
);
superAdminDirectoriesRouter.get('/students', studentsController.list);
superAdminDirectoriesRouter.get('/students/:studentId', validateParams(studentParamSchema), studentsController.get);
superAdminDirectoriesRouter.get('/students/:studentId/photo', validateParams(studentParamSchema), studentsController.studentPhoto);
superAdminDirectoriesRouter.get('/tutors', tutorsController.list);
superAdminDirectoriesRouter.get('/tutors/:userId', validateParams(tutorParamSchema), tutorsController.get);
superAdminDirectoriesRouter.get('/tutors/:userId/photo', validateParams(tutorParamSchema), tutorsController.photo);
superAdminDirectoriesRouter.get('/tutors/:userId/resume', validateParams(tutorParamSchema), tutorsController.resume);
