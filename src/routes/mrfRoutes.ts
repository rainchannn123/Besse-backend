import { Router } from 'express';
import {
  assignGrade,
  getMRFInventory,
  getPendingAuctions,
  getQueue,
  processWaste,
} from '../controllers/mrfController';
import { protect } from '../middleware/auth';
import { validate } from '../utils/validation';
import { z } from 'zod';

const router = Router();

router.use(protect);

// ✅ Define schemas inline
const processWasteSchema = z.object({
  body: z.object({
    queueId: z.string().min(1, 'Queue ID is required'),
    sessionId: z.string().min(1, 'Session ID is required'),
  }),
});

const assignGradeSchema = z.object({
  body: z.object({
    auctionId: z.string().min(1, 'Auction ID is required'),
    grade: z.enum(['A', 'B', 'C', 'F']),
    sessionId: z.string().min(1, 'Session ID is required'),
    customPrice: z.number(),
  }),
});

/**
 * @swagger
 * /api/mrf/process-waste:
 *   post:
 *     summary: Process waste from queue into materials
 *     tags: [MRF]
 *     security:
 *       - bearerAuth: []
 */
router.post('/process-waste', validate(processWasteSchema), processWaste);

/**
 * @swagger
 * /api/mrf/assign-grade:
 *   post:
 *     summary: Assign quality grade and entry price to auction
 *     tags: [MRF]
 *     security:
 *       - bearerAuth: []
 */
router.post('/assign-grade', validate(assignGradeSchema), assignGrade);

/**
 * @swagger
 * /api/mrf/queue/{sessionId}:
 *   get:
 *     summary: Get MRF processing queue
 *     tags: [MRF]
 *     security:
 *       - bearerAuth: []
 */
router.get('/queue/:sessionId', getQueue);

/**
 * @swagger
 * /api/mrf/inventory/{sessionId}:
 *   get:
 *     summary: Get MRF's material inventory
 *     tags: [MRF]
 *     security:
 *       - bearerAuth: []
 */
router.get('/inventory/:sessionId', getMRFInventory);

/**
 * @swagger
 * /api/mrf/pending-auctions/{sessionId}:
 *   get:
 *     summary: Get pending auctions for MRF to assign grades and prices
 *     tags: [MRF]
 *     security:
 *       - bearerAuth: []
 */
router.get('/pending-auctions/:sessionId', getPendingAuctions);

export default router;