import { Router } from 'express';
import {
  assignGrade,
  getMRFInventory,
  getPendingAuctions,
  getQueue,
  processWaste,
} from '../controllers/mrfController';
import { protect } from '../middleware/auth';
import { assignGradeSchema, processWasteSchema } from '../types';
import { validate } from '../utils/validation';

const router = Router();

router.use(protect);

/**
 * @swagger
 * /api/mrf/process-waste:
 *   post:
 *     summary: Process waste from queue into materials (materials are combined by type and quality)
 *     description: Processes waste batches into materials. Materials of the same type and quality are automatically combined into existing inventory entries rather than creating separate listings.
 *     tags: [MRF]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - queueId
 *               - sessionId
 *             properties:
 *               queueId:
 *                 type: string
 *                 example: queue123
 *               sessionId:
 *                 type: string
 *                 example: ABC123
 *     responses:
 *       200:
 *         description: Waste processed successfully - materials combined with existing inventory
 *       403:
 *         description: Only MRF player can process waste
 */
router.post('/process-waste', validate(processWasteSchema), processWaste);

/**
 * @swagger
 * /api/mrf/assign-grade:
 *   post:
 *     summary: Assign quality grade and entry price to auction
 *     description: Assigns quality grade and sets entry price for pending auctions (activates them) or updates active auctions.
 *     tags: [MRF]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - auctionId
 *               - grade
 *               - sessionId
 *             properties:
 *               auctionId:
 *                 type: string
 *                 example: a-12345678
 *               grade:
 *                 type: string
 *                 enum: ['A', 'B', 'C', 'F']
 *                 example: A
 *               sessionId:
 *                 type: string
 *                 example: ABC123
 *               customPrice:
 *                 type: number
 *                 description: Manual entry price for the auction
 *                 example: 500
 *     responses:
 *       200:
 *         description: Grade and price assigned successfully - auction activated or updated
 *       403:
 *         description: Only MRF player can assign grades
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
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema:
 *           type: string
 *         example: ABC123
 *     responses:
 *       200:
 *         description: MRF queue retrieved successfully
 *       403:
 *         description: Only MRF player can view queue
 */
router.get('/queue/:sessionId', getQueue);

/**
 * @swagger
 * /api/mrf/inventory/{sessionId}:
 *   get:
 *     summary: Get MRF's material inventory (materials aggregated by type and quality)
 *     description: Returns MRF's material inventory. Materials are aggregated by type (paper, plastic, metal, glass, wood) and quality, showing total mass and count for each material type. Contamination rates are no longer displayed.
 *     tags: [MRF]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema:
 *           type: string
 *         example: ABC123
 *     responses:
 *       200:
 *         description: MRF inventory retrieved successfully - shows aggregated materials by type and quality
 *       403:
 *         description: Only MRF player can view MRF inventory
 */
router.get('/inventory/:sessionId', getMRFInventory);

/**
 * @swagger
 * /api/mrf/pending-auctions/{sessionId}:
 *   get:
 *     summary: Get pending auctions for MRF to assign grades and prices
 *     description: Returns pending auctions created from processed waste that need grade assignment and pricing before becoming active.
 *     tags: [MRF]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema:
 *           type: string
 *         example: ABC123
 *     responses:
 *       200:
 *         description: Pending auctions retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Pending auctions retrieved successfully"
 *                 data:
 *                   type: object
 *                   properties:
 *                     pendingAuctions:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           auctionId:
 *                             type: string
 *                             example: "a-12345678"
 *                           materialType:
 *                             type: string
 *                             enum: [paper, plastic, metal, glass, wood]
 *                           grade:
 *                             type: string
 *                             example: "B"
 *                           mass:
 *                             type: number
 *                             example: 5.27
 *                           currentBid:
 *                             type: number
 *                             example: 0
 *       403:
 *         description: Only MRF player can view pending auctions
 */
router.get('/pending-auctions/:sessionId', getPendingAuctions);

export default router;
