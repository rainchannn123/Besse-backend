import { Router } from 'express';
import {
  endTurn,
  getGameState,
  getPlayerRole,
  getUserGames,
  performSystemCheck,
  getTeamRankings,
  getAllTeams,
} from '../controllers/gameController';
import { protect } from '../middleware/auth';

const router = Router();

router.use(protect);

/**
 * @swagger
 * /api/games/user-games:
 *   get:
 *     summary: Get all game sessions the current user has participated in
 *     tags: [Game]
 *     security:
 *       - bearerAuth: []
 */
router.get('/user-games', getUserGames);

/**
 * @swagger
 * /api/games/{sessionId}:
 *   get:
 *     summary: Get complete current state of a game session including all teams
 *     tags: [Game]
 *     security:
 *       - bearerAuth: []
 */
router.get('/:sessionId', getGameState);

/**
 * @swagger
 * /api/games/{sessionId}/player-role:
 *   get:
 *     summary: Get the current user's assigned role in a specific game session
 *     tags: [Game]
 *     security:
 *       - bearerAuth: []
 */
router.get('/:sessionId/player-role', getPlayerRole);

/**
 * @swagger
 * /api/games/{sessionId}/end-turn:
 *   post:
 *     summary: End current turn, apply health calculations, spawn new waste
 *     tags: [Game]
 *     security:
 *       - bearerAuth: []
 */
router.post('/:sessionId/end-turn', endTurn);

/**
 * @swagger
 * /api/games/{sessionId}/system-check:
 *   post:
 *     summary: Perform automatic system maintenance
 *     tags: [Game]
 *     security:
 *       - bearerAuth: []
 */
router.post('/:sessionId/system-check', performSystemCheck);

/**
 * @swagger
 * /api/games/{sessionId}/rankings:
 *   get:
 *     summary: Get team rankings for the game session
 *     tags: [Game]
 *     security:
 *       - bearerAuth: []
 */
router.get('/:sessionId/rankings', getTeamRankings);

/**
 * @swagger
 * /api/games/{sessionId}/teams:
 *   get:
 *     summary: Get all teams in the game session
 *     tags: [Game]
 *     security:
 *       - bearerAuth: []
 */
router.get('/:sessionId/teams', getAllTeams);

export default router;