import { Router } from 'express';
import {
  continueToPairing,
  continueToRoleSelection,
  createLobby,
  deselectRole,
  forcePairingCheck,
  getAvailableLobbies,
  getLobbyState,
  getPairingQueueStatus,
  getPairResult,
  getPartnerMetrics,
  joinLobby,
  joinPairingQueue,
  leaveLobby,
  leavePairingQueue,
  selectRole,
  startGame,
  startNewGame,
} from '../controllers/lobbyController';
import { protect } from '../middleware/auth';
import { validate } from '../utils/validation';
import { z } from 'zod';

const router = Router();

router.use(protect);

// ✅ Define all schemas inline
const joinLobbySchema = z.object({
  body: z.object({
    lobbyCode: z.string().regex(/^[A-Z0-9]{6}$/, 'Lobby code must be exactly 6 alphanumeric characters'),
  }),
});

const selectRoleSchema = z.object({
  body: z.object({
    sessionId: z.string().min(1, 'Session ID is required'),
    role: z.enum(['municipality', 'mrf', 'broker']),
  }),
});

const leaveLobbySchema = z.object({
  body: z.object({
    sessionId: z.string().min(1, 'Session ID is required'),
  }),
});

const continueToRoleSelectionSchema = z.object({
  body: z.object({
    sessionId: z.string().min(1, 'Session ID is required'),
  }),
});

const continueToPairingSchema = z.object({
  body: z.object({
    sessionId: z.string().min(1, 'Session ID is required'),
  }),
});

/**
 * @swagger
 * /api/lobby/available:
 *   get:
 *     summary: Get list of available lobbies that players can join
 *     tags: [Lobby]
 *     security:
 *       - bearerAuth: []
 */
router.get('/available', getAvailableLobbies);

/**
 * @swagger
 * /api/lobby/create:
 *   post:
 *     summary: Create a new lobby and become the leader
 *     tags: [Lobby]
 *     security:
 *       - bearerAuth: []
 */
router.post('/create', createLobby);

/**
 * @swagger
 * /api/lobby/join:
 *   post:
 *     summary: Join existing lobby using 6-character code
 *     tags: [Lobby]
 *     security:
 *       - bearerAuth: []
 */
router.post('/join', validate(joinLobbySchema), joinLobby);

/**
 * @swagger
 * /api/lobby/select-role:
 *   post:
 *     summary: Select a role in the lobby (first-come, first-served)
 *     tags: [Lobby]
 *     security:
 *       - bearerAuth: []
 */
router.post('/select-role', validate(selectRoleSchema), selectRole);

/**
 * @swagger
 * /api/lobby/deselect-role:
 *   post:
 *     summary: Deselect currently chosen role
 *     tags: [Lobby]
 *     security:
 *       - bearerAuth: []
 */
router.post('/deselect-role', deselectRole);

/**
 * @swagger
 * /api/lobby/{sessionId}:
 *   get:
 *     summary: Get current state of a specific lobby
 *     tags: [Lobby]
 *     security:
 *       - bearerAuth: []
 */
router.get('/:sessionId', getLobbyState);

/**
 * @swagger
 * /api/lobby/leave:
 *   post:
 *     summary: Leave the current lobby
 *     tags: [Lobby]
 *     security:
 *       - bearerAuth: []
 */
router.post('/leave', validate(leaveLobbySchema), leaveLobby);

router.post(
  '/continue-to-role-selection',
  validate(continueToRoleSelectionSchema),
  continueToRoleSelection
);

router.post(
  '/continue-to-pairing',
  validate(continueToPairingSchema),
  continueToPairing
);

/**
 * @swagger
 * /api/lobby/start-game:
 *   post:
 *     summary: Start game when all 3 roles are assigned
 *     tags: [Lobby]
 *     security:
 *       - bearerAuth: []
 */
router.post('/start-game', startGame);

/**
 * @swagger
 * /api/lobby/pairing/join:
 *   post:
 *     summary: Join the pairing queue after role selection is complete
 *     tags: [Lobby, Pairing]
 *     security:
 *       - bearerAuth: []
 */
router.post('/pairing/join', joinPairingQueue);

/**
 * @swagger
 * /api/lobby/pairing/status/{sessionId}:
 *   get:
 *     summary: Get current pairing queue status for a team
 *     tags: [Lobby, Pairing]
 *     security:
 *       - bearerAuth: []
 */
router.get('/pairing/status/:sessionId', getPairingQueueStatus);

/**
 * @swagger
 * /api/lobby/pairing/leave:
 *   post:
 *     summary: Leave the pairing queue
 *     tags: [Lobby, Pairing]
 *     security:
 *       - bearerAuth: []
 */
router.post('/pairing/leave', leavePairingQueue);

/**
 * @swagger
 * /api/lobby/pairing/force:
 *   post:
 *     summary: Force pairing check (Admin endpoint)
 *     tags: [Lobby, Pairing, Admin]
 *     security:
 *       - bearerAuth: []
 */
router.post('/pairing/force', forcePairingCheck);

/**
 * @swagger
 * /api/lobby/pairing/partner/{sessionId}:
 *   get:
 *     summary: Get partner team's game metrics
 *     tags: [Lobby, Pairing, Game]
 *     security:
 *       - bearerAuth: []
 */
router.get('/pairing/partner/:sessionId', getPartnerMetrics);

/**
 * @swagger
 * /api/lobby/pairing/result/{sessionId}:
 *   get:
 *     summary: Get pairing result for a team
 *     tags: [Lobby, Pairing]
 *     security:
 *       - bearerAuth: []
 */
router.get('/pairing/result/:sessionId', getPairResult);

/**
 * @swagger
 * /api/lobby/start-new-game:
 *   post:
 *     summary: Start a new game after completion (team owner only)
 *     tags: [Lobby]
 *     security:
 *       - bearerAuth: []
 */
router.post('/start-new-game', startNewGame);

export default router;