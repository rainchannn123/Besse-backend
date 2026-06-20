import { Router } from 'express';
import {
  collectWaste,
  collectWasteWithTransport,
  constructProject,
  getCityProjects,
  getMunicipalityInventory,
  getWasteBatches,
  rejectWaste,
} from '../controllers/municipalityController';
import { protect } from '../middleware/auth';
import { validate } from '../utils/validation';
import { z } from 'zod';

const router = Router();

router.use(protect);

// ✅ Define schemas inline
const collectWasteSchema = z.object({
  body: z.object({
    batchId: z.string().min(1, 'Batch ID is required'),
  }),
  params: z.object({
    sessionId: z.string().min(1, 'Session ID is required'),
  }),
});

const collectWasteTransportSchema = z.object({
  body: z.object({
    batchId: z.string().min(1, 'Batch ID is required'),
    mode: z.enum(['fast', 'slow']),
  }),
  params: z.object({
    sessionId: z.string().min(1, 'Session ID is required'),
  }),
});

const constructProjectSchema = z.object({
  body: z.object({
    projectId: z.string().min(1, 'Project ID is required'),
    materialType: z.enum(['paper', 'plastic', 'metal', 'glass', 'wood']),
    materialAmount: z.number().positive('Material amount must be positive'),
  }),
  params: z.object({
    sessionId: z.string().min(1, 'Session ID is required'),
  }),
});

/**
 * @swagger
 * /api/municipality/collect-waste/{sessionId}:
 *   post:
 *     summary: Collect waste batch and transport to MRF
 *     tags: [Municipality]
 *     security:
 *       - bearerAuth: []
 */
router.post(
  '/collect-waste/:sessionId',
  validate(collectWasteSchema),
  collectWaste
);

/**
 * @swagger
 * /api/municipality/collect-waste-transport/{sessionId}:
 *   post:
 *     summary: Collect waste with fast/slow transport mode
 *     tags: [Municipality]
 *     security:
 *       - bearerAuth: []
 */
router.post(
  '/collect-waste-transport/:sessionId',
  validate(collectWasteTransportSchema),
  collectWasteWithTransport
);

/**
 * @swagger
 * /api/municipality/waste-batches/{sessionId}:
 *   get:
 *     summary: Get all pending waste batches available for collection
 *     tags: [Municipality]
 *     security:
 *       - bearerAuth: []
 */
router.get('/waste-batches/:sessionId', getWasteBatches);

/**
 * @swagger
 * /api/municipality/city-projects/{sessionId}:
 *   get:
 *     summary: Get city projects and municipality material inventory
 *     tags: [Municipality]
 *     security:
 *       - bearerAuth: []
 */
router.get('/city-projects/:sessionId', getCityProjects);

/**
 * @swagger
 * /api/municipality/construct-project/{sessionId}:
 *   post:
 *     summary: Construct a city project using municipality materials
 *     tags: [Municipality]
 *     security:
 *       - bearerAuth: []
 */
router.post(
  '/construct-project/:sessionId',
  validate(constructProjectSchema),
  constructProject
);

/**
 * @swagger
 * /api/municipality/inventory/{sessionId}:
 *   get:
 *     summary: Get municipality material inventory
 *     tags: [Municipality]
 *     security:
 *       - bearerAuth: []
 */
router.get('/inventory/:sessionId', getMunicipalityInventory);

export default router;