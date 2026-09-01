import { Router } from 'express';
import {
  getActiveAuctions,
  placeBid,
  resolveExpiredAuctions,
  buyFromExternalWholesaler,
  getExternalStock,
} from '../controllers/brokerController';
import { protect } from '../middleware/auth';
import { validate } from '../utils/validation';
import { z } from 'zod';

const router = Router();

router.use(protect);

// ✅ Define schemas inline
const placeBidSchema = z.object({
  body: z.object({
    auctionId: z.string().min(1, 'Auction ID is required'),
    sessionId: z.string().min(1, 'Session ID is required').optional(),
  }),
});

const buyFromExternalWholesalerSchema = z.object({
  body: z.object({
    materialType: z.enum(['paper', 'plastic', 'metal', 'glass', 'wood']),
    requestedAmount: z.number().positive('Amount must be positive'),
    sessionId: z.string().min(1, 'Session ID is required'),
  }),
});

/**
 * @swagger
 * /api/broker/auctions:
 *   get:
 *     summary: Get all active auctions from all active games
 *     tags: [Broker]
 *     security:
 *       - bearerAuth: []
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
 */
router.post(
  '/place-bid',
  validate(placeBidSchema),
  placeBid
);

/**
 * @swagger
 * /api/broker/resolve-auctions/{sessionId}:
 *   post:
 *     summary: Resolve expired auctions
 *     tags: [Broker]
 *     security:
 *       - bearerAuth: []
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
 */
router.get('/external-stock/:sessionId', getExternalStock);

export default router;
