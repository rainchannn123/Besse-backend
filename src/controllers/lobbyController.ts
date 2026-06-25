import { Request, Response } from 'express';
import { GameService } from '../services/gameService';
import { LobbyService } from '../services/lobbyService';
import {
  ContinueToPairingInput,
  ContinueToRoleSelectionInput,
  JoinLobbyInput,
  LeaveLobbyInput,
  SelectRoleInput,
} from '../types';
import { asyncHandler } from '../utils/asyncHandler';
import { sendResponse } from '../utils/response';

export const createLobby = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const userId = (req as any).user._id;
    const userName = (req as any).user.name;
    const gameMode = req.body.gameMode || 'waste';

    const lobby = await LobbyService.createLobby(userId, userName, gameMode);

    sendResponse(res, 200, 'Lobby created successfully', { lobby });
  }
);

export const joinLobby = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { lobbyCode }: JoinLobbyInput = req.body;
    const userId = (req as any).user._id;
    const userName = (req as any).user.name;

    const lobby = await LobbyService.joinLobby(userId, userName, lobbyCode);

    sendResponse(res, 200, 'Joined lobby successfully', { lobby });
  }
);

export const selectRole = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { sessionId, role }: SelectRoleInput = req.body;
    const userId = (req as any).user._id;

    const lobby = await LobbyService.selectRole(sessionId, userId, role);

    sendResponse(res, 200, 'Role selected successfully', { lobby });
  }
);

export const deselectRole = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { sessionId } = req.body;
    const userId = (req as any).user._id;

    const lobby = await LobbyService.deselectRole(sessionId, userId);

    sendResponse(res, 200, 'Role deselected successfully', { lobby });
  }
);

export const getLobbyState = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { sessionId } = req.params;

    const lobbyState = await LobbyService.getLobbyState(sessionId);

    sendResponse(res, 200, 'Lobby state retrieved successfully', {
      lobbyState,
    });
  }
);

export const leaveLobby = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { sessionId }: LeaveLobbyInput = req.body;
    const userId = (req as any).user._id;

    const leaveResult = await LobbyService.leaveLobby(sessionId, userId);

    sendResponse(res, 200, 'Left lobby successfully', { leaveResult });
  }
);

export const continueToRoleSelection = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { sessionId }: ContinueToRoleSelectionInput = req.body;
    const userId = (req as any).user._id;

    const lobbyState = await LobbyService.continueToRoleSelection(sessionId, userId.toString());

    sendResponse(res, 200, 'Lobby advanced to role selection', { lobbyState });
  }
);

export const continueToPairing = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { sessionId }: ContinueToPairingInput = req.body;
    const userId = (req as any).user._id;

    const lobbyState = await LobbyService.continueToPairing(sessionId, userId.toString());

    sendResponse(res, 200, 'Lobby advanced to pairing', { lobbyState });
  }
);

export const startGame = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { sessionId } = req.body;
    const userId = (req as any).user._id;

    // Verify user is in the lobby
    const lobbyState = await LobbyService.getLobbyState(sessionId);
    const userInLobby = lobbyState.players.some(
      p => p.userId === userId.toString()
    );
    if (!userInLobby) {
      sendResponse(res, 403, 'You are not in this lobby');
      return;
    }

    // Check if team is paired before starting the game
    if (!lobbyState.pairId) {
      sendResponse(res, 403, 'Team must be paired before starting the game');
      return;
    }

    const gameState = await GameService.createGameFromLobby(sessionId);

    sendResponse(res, 200, 'Game started successfully', { gameState });
  }
);

export const getAvailableLobbies = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const lobbies = await LobbyService.getAvailableLobbies();

    sendResponse(res, 200, 'Available lobbies retrieved successfully', {
      lobbies,
    });
  }
);

// Pairing endpoints
export const joinPairingQueue = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { sessionId } = req.body;
    const userId = (req as any).user._id;

    // Verify user is in lobby and lobby is ready
    const lobby = await LobbyService.getLobbyState(sessionId);
    const isInLobby = lobby.players.some(p => p.userId === userId.toString());
    if (!isInLobby) {
      sendResponse(res, 403, 'You are not part of this team/lobby');
      return;
    }

    // Only group leader can start queueing
    if (lobby.leader !== userId.toString()) {
      sendResponse(res, 403, 'Only the group leader can start queueing');
      return;
    }

    const result = await LobbyService.addToPairingQueue(sessionId);
    sendResponse(res, 200, 'Joined pairing queue', { result });
  }
);

export const getPairingQueueStatus = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { sessionId } = req.params;
    const status = await LobbyService.getQueueStatus(sessionId);
    sendResponse(res, 200, 'Pairing queue status', { status });
  }
);

export const leavePairingQueue = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { sessionId } = req.body;
    await LobbyService.removeFromPairingQueue(sessionId);
    sendResponse(res, 200, 'Left pairing queue');
  }
);

// Admin: force pairing check (optional)
export const forcePairingCheck = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const pairs = await LobbyService.checkAndCreatePairs();
    sendResponse(res, 200, 'Pairing check executed', { pairs });
  }
);

export const getPartnerMetrics = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { sessionId } = req.params;
    const userId = (req as any).user._id;

    // Verify user is part of lobby
    const lobby = await LobbyService.getLobbyState(sessionId);
    const isInLobby = lobby.players.some(p => p.userId === userId.toString());
    if (!isInLobby) {
      sendResponse(res, 403, 'You are not part of this team/lobby');
      return;
    }

    if (!lobby.partnerSessionId) {
      sendResponse(res, 400, 'This team is not yet paired');
      return;
    }

    const partnerGameState = await GameService.getGameState(
      lobby.partnerSessionId
    );
    if (!partnerGameState) {
      sendResponse(res, 404, 'Partner game state not found');
      return;
    }

    const metrics = {
      sessionId: lobby.partnerSessionId,
      pairId: lobby.pairId,
      budget: partnerGameState.budget,
      cityHealth: partnerGameState.cityHealth,
      totalCO2: partnerGameState.totalCO2,
      currentTurn: partnerGameState.currentTurn,
      gameStatus: partnerGameState.gameStatus,
    };

    sendResponse(res, 200, 'Partner metrics retrieved', { metrics });
  }
);

export const getPairResult = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { sessionId } = req.params;
    const userId = (req as any).user._id;

    const lobby = await LobbyService.getLobbyState(sessionId);
    const isInLobby = lobby.players.some(p => p.userId === userId.toString());
    if (!isInLobby) {
      sendResponse(res, 403, 'You are not part of this team/lobby');
      return;
    }

    const result = {
      pairId: lobby.pairId || null,
      partnerSessionId: lobby.partnerSessionId || null,
      teamRole: lobby.teamRole || null,
      pairStatus: lobby.pairStatus || null,
    };

    sendResponse(res, 200, 'Pair result retrieved', { result });
  }
);

export const startNewGame = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { sessionId } = req.body;
    const userId = (req as any).user._id;

    const lobby = await LobbyService.startNewGame(sessionId, userId);

    sendResponse(res, 200, 'New game started successfully', { lobby });
  }
);
