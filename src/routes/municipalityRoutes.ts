import { Router } from 'express';
import {
  collectWaste,
  constructProject,
  getCityProjects,
  getMunicipalityInventory,
  getWasteBatches,
  rejectWaste,
} from '../controllers/municipalityController';
import { protect } from '../middleware/auth';
import { collectWasteSchema, constructProjectSchema } from '../types';
import { validate } from '../utils/validation';

const router = Router();

router.use(protect);

/**
 * @swagger
 * /api/municipality/collect-waste/{sessionId}:
 *   post:
 *     summary: Collect waste batch and transport to MRF
 *     tags: [Municipality]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema:
 *           type: string
 *         example: ABC123
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - batchId
 *             properties:
 *               batchId:
 *                 type: string
 *                 example: batch123
 *     responses:
 *       200:
 *         description: Waste collected successfully
 *       403:
 *         description: Only municipality player can collect waste
 *       404:
 *         description: Game session not found
 */
router.post(
  '/collect-waste/:sessionId',
  validate(collectWasteSchema),
  collectWaste
);


/**
 * @swagger
 * /api/municipality/waste-batches/{sessionId}:
 *   get:
 *     summary: Get all pending waste batches available for collection
 *     tags: [Municipality]
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
 *         description: Waste batches retrieved successfully
 *       403:
 *         description: Only municipality player can view waste batches
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
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema:
 *           type: string
 *         example: ABC123
 *     responses:
 *       200:
 *         description: City projects retrieved successfully
 *       403:
 *         description: Only municipality player can view city projects
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
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema:
 *           type: string
 *         example: ABC123
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - projectId
 *               - materialType
 *               - materialAmount
 *             properties:
 *               projectId:
 *                 type: string
 *                 example: p-1
 *               materialType:
 *                 type: string
 *                 enum: [paper, plastic, metal, glass, wood]
 *                 example: paper
 *               materialAmount:
 *                 type: number
 *                 example: 10
 *     responses:
 *       200:
 *         description: Material contributed to project successfully
 *       403:
 *         description: Only municipality player can construct projects
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
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema:
 *           type: string
 *         example: ABC123
 *     responses:
 *       200:
 *         description: Municipality inventory retrieved successfully
 *       403:
 *         description: Only municipality player can view inventory
 *       404:
 *         description: Game session not found
 */
router.get('/inventory/:sessionId', getMunicipalityInventory);

export default router;
