import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { list } from './students.controller.js';

export const studentsRouter = Router();
studentsRouter.get('/', authenticate, list);
