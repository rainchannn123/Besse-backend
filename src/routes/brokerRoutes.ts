import { Router } from 'express';
import {
  getActiveAuctions,
  placeBid,
  resolveExpiredAuctions,
  buyFromExternalWholesaler,
  getExternalStock,
} from '../controllers/brokerController';
import { protect } from '../middleware/auth';
import { placeBidSchema, buyFromExternalWholesalerSchema } from '../types';
import { validate } from '../utils/validation';

const router = Router();

router.use(protect);

/**
 * @swagger
 * /api/broker/auctions:
 *   get:
 *     summary: Get all active auctions from all active games
 *     tags: [Broker]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Active auctions retrieved successfully
 *       403:
 *         description: Only broker player can view auctions
 */
router.get('/auctions', getActiveAuctions);

/**
 * @swagger
 * /api/broker/place-bid:
 *   post:
 *     summary: Place a bid on an active auction
 *     tags: [Broker]
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
 *             properties:
 *               auctionId:
 *                 type: string
 *                 example: a-123
 *     responses:
 *       200:
 *         description: Bid placed successfully
 *       403:
 *         description: Only broker player can place bids
 */
router.post('/place-bid', validate(placeBidSchema), placeBid);

/**
 * @swagger
 * /api/broker/resolve-auctions/{sessionId}:
 *   post:
 *     summary: Resolve expired auctions (typically called by system, but available for broker)
 *     tags: [Broker]
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
 *         description: Expired auctions resolved successfully
 *       403:
 *         description: Only broker player can resolve auctions
 */
router.post('/resolve-auctions/:sessionId', resolveExpiredAuctions);

/**
 * @swagger
 * /api/broker/buy-external:
 *   post:
 *     summary: Buy materials from external wholesaler
 *     tags: [Broker]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - materialType
 *               - requestedAmount
 *               - sessionId
 *             properties:
 *               materialType:
 *                 type: enum
 *                 enum: [paper, plastic, metal, glass, wood]
 *                 example: paper
 *               requestedAmount:
 *                 type: number
 *                 example: 10
 *               sessionId:
 *                 type: string
 *                 example: ABC123
 *     responses:
 *       200:
 *         description: Purchase from external wholesaler successful
 *       403:
 *         description: Only broker player can buy from external wholesaler
 */
router.post(
  '/buy-external',
  validate(buyFromExternalWholesalerSchema),
  buyFromExternalWholesaler
);

/**
 * @swagger
 * /api/broker/external-stock/{sessionId}:
 *   get:
 *     summary: Get current external wholesaler stock levels
 *     tags: [Broker]
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
 *         description: External stock retrieved successfully
 *       403:
 *         description: Only broker player can view external stock
 */
router.get('/external-stock/:sessionId', getExternalStock);

export default router;
