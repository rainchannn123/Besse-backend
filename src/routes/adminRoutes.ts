import { Router } from 'express';
import {
  forceExit,
  getActivityLogs,
  getActivityLogStats,
  loginAdmin,
  monitoringOverview,
  playerHistory,
} from '../controllers/adminController';
import { protectAdmin } from '../middleware/adminAuth';
import { validate } from '../utils/validation';
import { z } from 'zod';

const router = Router();

// ✅ Define schemas inline
const adminLoginSchema = z.object({
  body: z.object({
    username: z.string().min(1, 'Username is required'),
    password: z.string().min(1, 'Password is required'),
  }),
});

const adminForceExitSchema = z.object({
  params: z.object({
    userId: z.string().min(1, 'User ID is required'),
  }),
  body: z.object({
    reason: z.string().max(200).optional(),
  }).optional(),
});

router.post('/auth/login', validate(adminLoginSchema), loginAdmin);
router.get('/monitor/overview', protectAdmin, monitoringOverview);
router.patch(
  '/players/:userId/force-exit',
  protectAdmin,
  validate(adminForceExitSchema),
  forceExit
);
router.get('/players/:userId/history', protectAdmin, playerHistory);

// ✅ Activity log endpoints
router.get('/activity-logs', protectAdmin, getActivityLogs);
router.get('/activity-logs/stats', protectAdmin, getActivityLogStats);

export default router;