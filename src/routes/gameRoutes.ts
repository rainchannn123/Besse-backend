import { Router } from 'express';
import {
  endTurn,
  getGameState,
  getPairDetails,
  getPlayerRole,
  getUserGames,
  performSystemCheck,
} from '../controllers/gameController';
import { protect } from '../middleware/auth';

const router = Router();

router.use(protect);

/**
 * @swagger
 * /api/games/user-games:
 *   get:
 *     summary: Get all game sessions the current user has participated in (past and active)
 *     tags: [Game]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User games retrieved successfully
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
 *                   example: User games retrieved successfully
 *                 data:
 *                   type: object
 *                   properties:
 *                     gameSessions:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/GameSession'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
router.get('/user-games', getUserGames);

/**
 * @swagger
 * /api/games/{sessionId}:
 *   get:
 *     summary: Get complete current state of a game session including budget, health, CO2, and all game data
 *     tags: [Game]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema:
 *           type: string
 *         example: ABC123
 *         description: The game session ID
 *     responses:
 *       200:
 *         description: Game state retrieved successfully
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
 *                   example: Game state retrieved successfully
 *                 data:
 *                   type: object
 *                   properties:
 *                     gameState:
 *                       $ref: '#/components/schemas/GameSession'
 *                     userRole:
 *                       type: string
 *                       enum: ['municipality', 'mrf', 'broker']
 *                       example: municipality
 *                     userRoles:
 *                       type: array
 *                       items:
 *                         type: string
 *                         enum: ['municipality', 'mrf', 'broker']
 *                     countdownTimeRemaining:
 *                       type: number
 *                       nullable: true
 *                       example: 120
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: User is not a player in this game session
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         description: Game session not found
 *         $ref: '#/components/responses/NotFound'
 */
router.get('/:sessionId', getGameState);

/**
 * @swagger
 * /api/games/{sessionId}/player-role:
 *   get:
 *     summary: Get the current user's assigned role (municipality/mrf/broker) in a specific game session
 *     tags: [Game]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema:
 *           type: string
 *         example: ABC123
 *         description: The game session ID
 *     responses:
 *       200:
 *         description: Player role retrieved successfully
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
 *                   example: Player role retrieved successfully
 *                 data:
 *                   type: object
 *                   properties:
 *                     role:
 *                       type: string
 *                       enum: ['municipality', 'mrf', 'broker']
 *                       example: municipality
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         description: Player role not found for this session
 *         $ref: '#/components/responses/NotFound'
 */
router.get('/:sessionId/player-role', getPlayerRole);

/**
 * @swagger
 * /api/games/{sessionId}/end-turn:
 *   post:
 *     summary: End current turn, apply health calculations, spawn new waste, and advance to next turn
 *     tags: [Game]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema:
 *           type: string
 *         example: ABC123
 *         description: The game session ID
 *     responses:
 *       200:
 *         description: Turn ended successfully
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
 *                   example: Turn ended successfully
 *                 data:
 *                   type: object
 *                   properties:
 *                     gameState:
 *                       $ref: '#/components/schemas/GameSession'
 *                     userRole:
 *                       type: string
 *                       enum: ['municipality', 'mrf', 'broker']
 *                       example: municipality
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: User is not a player in this game session
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         description: Game session not found
 *         $ref: '#/components/responses/NotFound'
 */
router.post('/:sessionId/end-turn', endTurn);

/**
 * @swagger
 * /api/games/{sessionId}/system-check:
 *   post:
 *     summary: Perform automatic system maintenance - waste generation, overdue penalties, countdown checks, win/lose evaluation
 *     tags: [Game]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema:
 *           type: string
 *         example: ABC123
 *         description: The game session ID
 *     responses:
 *       200:
 *         description: System check completed
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
 *                   example: System check completed
 *                 data:
 *                   type: object
 *                   properties:
 *                     gameState:
 *                       $ref: '#/components/schemas/GameSession'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: User is not part of this game session
 *         $ref: '#/components/responses/Forbidden'
 */
router.post('/:sessionId/system-check', performSystemCheck);

/**
 * @swagger
 * /api/games/pair/{pairId}/details:
 *   get:
 *     summary: Get detailed pair results for game over screen
 *     tags: [Game]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: pairId
 *         required: true
 *         schema:
 *           type: string
 *         example: pair-123
 *         description: The pair ID
 *     responses:
 *       200:
 *         description: Pair details retrieved successfully
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
 *                   example: Pair details retrieved successfully
 *                 data:
 *                   type: object
 *                   properties:
 *                     pairDetails:
 *                       type: object
 *                       properties:
 *                         pairId:
 *                           type: string
 *                           example: pair-123
 *                         averagePairHealth:
 *                           type: number
 *                           example: 75.5
 *                         teamAHealth:
 *                           type: number
 *                           nullable: true
 *                           example: 80.0
 *                         teamBHealth:
 *                           type: number
 *                           nullable: true
 *                           example: 71.0
 *                         teamABudget:
 *                           type: number
 *                           example: 8500.00
 *                         teamBBudget:
 *                           type: number
 *                           example: 6200.00
 *                         teamACO2:
 *                           type: number
 *                           example: 125.3
 *                         teamBCO2:
 *                           type: number
 *                           example: 98.7
 *                         status:
 *                           type: string
 *                           example: Active
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: User is not authorized to view these pair details
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         description: Pair details not found
 *         $ref: '#/components/responses/NotFound'
 */
router.get('/pair/:pairId/details', getPairDetails);

export default router;
