import { Request, Response } from 'express';
import { GameService } from '../services/gameService';
import { asyncHandler } from '../utils/asyncHandler';
import { sendResponse } from '../utils/response';

export const getGameState = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { sessionId } = req.params;
    const userId = (req as any).user._id;

    const gameState = await GameService.getGameState(sessionId);

    if (!gameState) {
      sendResponse(res, 404, 'Game session not found');
      return;
    }

    // Check if user is part of this game
    const userRoles = [];
    if (gameState.players.municipality.toString() === userId.toString())
      userRoles.push('municipality');
    if (gameState.players.mrf.toString() === userId.toString())
      userRoles.push('mrf');
    if (gameState.players.broker.toString() === userId.toString())
      userRoles.push('broker');

    if (userRoles.length === 0) {
      sendResponse(res, 403, 'You are not a player in this game session');
      return;
    }

    // Get user's specific role
    const userRole = await GameService.getPlayerRole(sessionId, userId);

    // Update game time before returning state
    GameService.updateGameTime(gameState);

    // Initialize missing fields for backward compatibility
    if (!gameState.activeLocks) gameState.activeLocks = {};
    if (!gameState.gameOverCountdown)
      gameState.gameOverCountdown = {
        active: false,
        startTime: null,
        reason: null,
      };
    if (typeof gameState.totalTransportTrips !== 'number')
      gameState.totalTransportTrips = 0;
    if (typeof gameState.totalLandfillTons !== 'number')
      gameState.totalLandfillTons = 0;

    // Calculate countdown time remaining if active
    let countdownTimeRemaining = null;
    if (
      gameState.gameOverCountdown.active &&
      gameState.gameOverCountdown.startTime
    ) {
      const now = Date.now();
      const elapsed = (now - gameState.gameOverCountdown.startTime) / 1000;
      countdownTimeRemaining = Math.max(
        0,
        gameState.constants.COUNTDOWN_DURATION_SECONDS - elapsed
      );
    }

    sendResponse(res, 200, 'Game state retrieved successfully', {
      gameState,
      userRole,
      userRoles,
      countdownTimeRemaining,
    });
  }
);

export const endTurn = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { sessionId } = req.params;
    const userId = (req as any).user._id;

    const gameState = await GameService.getGameState(sessionId);

    if (!gameState) {
      sendResponse(res, 404, 'Game session not found');
      return;
    }

    // Check if user is part of this game
    const userRole = await GameService.getPlayerRole(sessionId, userId);
    if (!userRole) {
      sendResponse(res, 403, 'You are not a player in this game session');
      return;
    }

    const updatedGameState = await GameService.endTurn(sessionId);

    sendResponse(res, 200, 'Turn ended successfully', {
      gameState: updatedGameState,
      userRole,
    });
  }
);

export const getUserGames = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const userId = (req as any).user._id;

    const gameSessions = await GameService.getUserGameSessions(userId);

    sendResponse(res, 200, 'User games retrieved successfully', {
      gameSessions,
    });
  }
);

export const getPlayerRole = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { sessionId } = req.params;
    const userId = (req as any).user._id;

    const role = await GameService.getPlayerRole(sessionId, userId);

    if (!role) {
      sendResponse(res, 404, 'Player role not found for this session');
      return;
    }

    sendResponse(res, 200, 'Player role retrieved successfully', { role });
  }
);

// NEW: Perform system check (called periodically by frontend or cron)
export const performSystemCheck = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { sessionId } = req.params;
    const userId = (req as any).user._id;

    // Verify user is part of this game
    const userRole = await GameService.getPlayerRole(sessionId, userId);
    if (!userRole) {
      sendResponse(res, 403, 'User is not part of this game session');
      return;
    }

    const gameState = await GameService.performSystemCheck(sessionId);

    sendResponse(res, 200, 'System check completed', { gameState });
  }
);

// NEW: Get pair details by pairId for game over page
export const getPairDetails = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { pairId } = req.params;
    const userId = (req as any).user._id;

    const pairDetails = await GameService.getPairDetails(pairId);

    if (!pairDetails) {
      sendResponse(res, 404, 'Pair details not found');
      return;
    }

    // Verify user is part of one of the teams in this pair
    const gameStateA = await GameService.getGameState(
      pairDetails.teamASessionId
    );
    const gameStateB = await GameService.getGameState(
      pairDetails.teamBSessionId
    );

    const isPlayerInPair =
      (gameStateA &&
        (gameStateA.players.municipality.toString() === userId.toString() ||
          gameStateA.players.mrf.toString() === userId.toString() ||
          gameStateA.players.broker.toString() === userId.toString())) ||
      (gameStateB &&
        (gameStateB.players.municipality.toString() === userId.toString() ||
          gameStateB.players.mrf.toString() === userId.toString() ||
          gameStateB.players.broker.toString() === userId.toString()));

    if (!isPlayerInPair) {
      sendResponse(
        res,
        403,
        'You are not authorized to view these pair details'
      );
      return;
    }

    sendResponse(res, 200, 'Pair details retrieved successfully', {
      pairDetails,
    });
  }
);
