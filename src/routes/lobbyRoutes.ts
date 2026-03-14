import { Router } from 'express';
import {
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
import { joinLobbySchema, selectRoleSchema } from '../types';
import { validate } from '../utils/validation';

const router = Router();

router.use(protect);

/**
 * @swagger
 * /api/lobby/available:
 *   get:
 *     summary: Get list of available lobbies that players can join
 *     tags: [Lobby]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Available lobbies retrieved successfully
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
 *                   example: Available lobbies retrieved successfully
 *                 data:
 *                   type: object
 *                   properties:
 *                     lobbies:
 *                       type: array
 *                       items:
 *                         type: object
 *                         description: List of available lobbies
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
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
 *     responses:
 *       200:
 *         description: Lobby created successfully
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
 *                   example: Lobby created successfully
 *                 data:
 *                   type: object
 *                   properties:
 *                     lobby:
 *                       type: object
 *                       description: Lobby information
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
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
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - lobbyCode
 *             properties:
 *               lobbyCode:
 *                 type: string
 *                 minLength: 6
 *                 maxLength: 6
 *                 example: 'ABC123'
 *     responses:
 *       200:
 *         description: Joined lobby successfully
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
 *                   example: Joined lobby successfully
 *                 data:
 *                   type: object
 *                   properties:
 *                     lobby:
 *                       type: object
 *                       description: Lobby information
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         description: Lobby not found
 *         $ref: '#/components/responses/NotFound'
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
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - sessionId
 *               - role
 *             properties:
 *               sessionId:
 *                 type: string
 *                 example: 'ABC123'
 *               role:
 *                 type: string
 *                 enum: ['municipality', 'mrf', 'broker']
 *                 example: 'municipality'
 *     responses:
 *       200:
 *         description: Role selected successfully
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
 *                   example: Role selected successfully
 *                 data:
 *                   type: object
 *                   properties:
 *                     lobby:
 *                       type: object
 *                       description: Updated lobby information
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       409:
 *         description: Role already taken
 *         $ref: '#/components/responses/Conflict'
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
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - sessionId
 *             properties:
 *               sessionId:
 *                 type: string
 *                 example: 'ABC123'
 *     responses:
 *       200:
 *         description: Role deselected successfully
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
 *                   example: Role deselected successfully
 *                 data:
 *                   type: object
 *                   properties:
 *                     lobby:
 *                       type: object
 *                       description: Updated lobby information
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
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
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema:
 *           type: string
 *         example: ABC123
 *         description: The lobby session ID
 *     responses:
 *       200:
 *         description: Lobby state retrieved successfully
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
 *                   example: Lobby state retrieved successfully
 *                 data:
 *                   type: object
 *                   properties:
 *                     lobbyState:
 *                       type: object
 *                       description: Current lobby state information
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         description: Lobby not found
 *         $ref: '#/components/responses/NotFound'
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
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - sessionId
 *             properties:
 *               sessionId:
 *                 type: string
 *                 example: 'ABC123'
 *     responses:
 *       200:
 *         description: Left lobby successfully
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
 *                   example: Left lobby successfully
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
router.post('/leave', leaveLobby);

/**
 * @swagger
 * /api/lobby/start-game:
 *   post:
 *     summary: Start game when all 3 roles are assigned
 *     tags: [Lobby]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - sessionId
 *             properties:
 *               sessionId:
 *                 type: string
 *                 example: 'ABC123'
 *     responses:
 *       200:
 *         description: Game started successfully
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
 *                   example: Game started successfully
 *                 data:
 *                   type: object
 *                   properties:
 *                     gameState:
 *                       $ref: '#/components/schemas/GameSession'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: Not all roles assigned or insufficient permissions
 *         $ref: '#/components/responses/Forbidden'
 */
router.post('/start-game', startGame);

/**
 * @swagger
 * /api/lobby/pairing/join:
 *   post:
 *     summary: Join the pairing queue after role selection is complete
 *     description: Adds the team to the global pairing queue. Teams are automatically paired when 2+ teams are waiting.
 *     tags: [Lobby, Pairing]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - sessionId
 *             properties:
 *               sessionId:
 *                 type: string
 *                 example: 'ABC123'
 *                 description: The lobby session ID
 *     responses:
 *       200:
 *         description: Successfully joined pairing queue
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
 *                   example: Joined pairing queue
 *                 data:
 *                   type: object
 *                   properties:
 *                     result:
 *                       type: object
 *                       description: Pairing queue result
 *       403:
 *         description: User is not part of this team/lobby
 *         $ref: '#/components/responses/Forbidden'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
router.post('/pairing/join', joinPairingQueue);

/**
 * @swagger
 * /api/lobby/pairing/status/{sessionId}:
 *   get:
 *     summary: Get current pairing queue status for a team
 *     description: Returns the current status of the team's position in the pairing queue.
 *     tags: [Lobby, Pairing]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema:
 *           type: string
 *         example: ABC123
 *         description: The lobby session ID
 *     responses:
 *       200:
 *         description: Pairing queue status retrieved successfully
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
 *                   example: Pairing queue status
 *                 data:
 *                   type: object
 *                   properties:
 *                     status:
 *                       type: object
 *                       properties:
 *                         position:
 *                           type: integer
 *                           description: Position in queue
 *                           example: 1
 *                         estimatedWaitTime:
 *                           type: integer
 *                           description: Estimated wait time in seconds
 *                           example: 30
 *                         isPaired:
 *                           type: boolean
 *                           description: Whether team has been paired
 *                           example: false
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
router.get('/pairing/status/:sessionId', getPairingQueueStatus);

/**
 * @swagger
 * /api/lobby/pairing/leave:
 *   post:
 *     summary: Leave the pairing queue
 *     description: Removes the team from the pairing queue if they haven't been paired yet.
 *     tags: [Lobby, Pairing]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - sessionId
 *             properties:
 *               sessionId:
 *                 type: string
 *                 example: 'ABC123'
 *                 description: The lobby session ID
 *     responses:
 *       200:
 *         description: Successfully left pairing queue
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
 *                   example: Left pairing queue
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
router.post('/pairing/leave', leavePairingQueue);

/**
 * @swagger
 * /api/lobby/pairing/force:
 *   post:
 *     summary: Force pairing check (Admin endpoint)
 *     description: Manually triggers the pairing algorithm to create pairs from waiting teams. Used for testing or admin purposes.
 *     tags: [Lobby, Pairing, Admin]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Pairing check executed successfully
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
 *                   example: Pairing check executed
 *                 data:
 *                   type: object
 *                   properties:
 *                     pairs:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           pairId:
 *                             type: string
 *                             example: pair-ABC123
 *                           teamA:
 *                             type: string
 *                             example: session-123
 *                           teamB:
 *                             type: string
 *                             example: session-456
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
router.post('/pairing/force', forcePairingCheck);

/**
 * @swagger
 * /api/lobby/pairing/partner/{sessionId}:
 *   get:
 *     summary: Get partner team's game metrics
 *     description: Retrieves the current game state metrics of the paired partner team.
 *     tags: [Lobby, Pairing, Game]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema:
 *           type: string
 *         example: ABC123
 *         description: The lobby session ID
 *     responses:
 *       200:
 *         description: Partner metrics retrieved successfully
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
 *                   example: Partner metrics retrieved
 *                 data:
 *                   type: object
 *                   properties:
 *                     metrics:
 *                       type: object
 *                       properties:
 *                         sessionId:
 *                           type: string
 *                           example: DEF456
 *                         pairId:
 *                           type: string
 *                           example: pair-ABC123
 *                         budget:
 *                           type: number
 *                           example: 8500.50
 *                         cityHealth:
 *                           type: number
 *                           example: 95.5
 *                         totalCO2:
 *                           type: number
 *                           example: 142.8
 *                         currentTurn:
 *                           type: integer
 *                           example: 3
 *                         gameStatus:
 *                           type: string
 *                           enum: [active, won, lost]
 *                           example: active
 *       400:
 *         description: Team is not yet paired
 *         $ref: '#/components/responses/BadRequest'
 *       403:
 *         description: User is not part of this team/lobby
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         description: Partner game state not found
 *         $ref: '#/components/responses/NotFound'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
router.get('/pairing/partner/:sessionId', getPartnerMetrics);

/**
 * @swagger
 * /api/lobby/pairing/result/{sessionId}:
 *   get:
 *     summary: Get pairing result for a team
 *     description: Returns the current pairing status and information for the team.
 *     tags: [Lobby, Pairing]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema:
 *           type: string
 *         example: ABC123
 *         description: The lobby session ID
 *     responses:
 *       200:
 *         description: Pair result retrieved successfully
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
 *                   example: Pair result retrieved
 *                 data:
 *                   type: object
 *                   properties:
 *                     result:
 *                       type: object
 *                       properties:
 *                         pairId:
 *                           type: string
 *                           nullable: true
 *                           example: pair-ABC123
 *                         partnerSessionId:
 *                           type: string
 *                           nullable: true
 *                           example: DEF456
 *                         teamRole:
 *                           type: string
 *                           nullable: true
 *                           enum: ["Team A", "Team B"]
 *                           example: "Team A"
 *                         pairStatus:
 *                           type: string
 *                           nullable: true
 *                           enum: ["Active", "Team A Eliminated", "Team B Eliminated", "Pair Completed"]
 *                           example: "Active"
 *       403:
 *         description: User is not part of this team/lobby
 *         $ref: '#/components/responses/Forbidden'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
router.get('/pairing/result/:sessionId', getPairResult);

/**
 * @swagger
 * /api/lobby/start-new-game:
 *   post:
 *     summary: Start a new game after completion (team owner only)
 *     description: Creates a new lobby with the same team members, ready for role selection and manual pairing
 *     tags: [Lobby]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - sessionId
 *             properties:
 *               sessionId:
 *                 type: string
 *                 example: 'ABC123'
 *     responses:
 *       200:
 *         description: New game started successfully
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
 *                   example: New game started successfully
 *                 data:
 *                   type: object
 *                   properties:
 *                     lobby:
 *                       type: object
 *                       description: The newly created lobby information
 *       403:
 *         description: Only team owner can start new game
 *         $ref: '#/components/responses/Forbidden'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
router.post('/start-new-game', startNewGame);

export default router;
