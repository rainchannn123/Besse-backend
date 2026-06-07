import { Router } from 'express';
import {
  forceExit,
  loginAdmin,
  monitoringOverview,
  playerHistory,
} from '../controllers/adminController';
import { protectAdmin } from '../middleware/adminAuth';
import { adminForceExitSchema, adminLoginSchema } from '../types';
import { validate } from '../utils/validation';

const router = Router();

router.post('/auth/login', validate(adminLoginSchema), loginAdmin);
router.get('/monitor/overview', protectAdmin, monitoringOverview);
router.patch(
  '/players/:userId/force-exit',
  protectAdmin,
  validate(adminForceExitSchema),
  forceExit
);

router.get('/players/:userId/history', protectAdmin, playerHistory);

export default router;
