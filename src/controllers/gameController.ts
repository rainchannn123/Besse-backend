import { Request, Response } from 'express';
import { GameService } from '../services/gameService';
import { asyncHandler } from '../utils/asyncHandler';
import { sendResponse } from '../utils/response';
import { DEFAULT_GAME_CONSTANTS } from '../constants/constants';

export const getGameState = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { sessionId } = req.params;
    const userId = (req as any).user._id;

    const gameState = await GameService.getGameState(sessionId);

    if (!gameState) {
      sendResponse(res, 404, 'Game session not found');
      return;
    }

    const team = gameState.teams.find((t) => t.sessionId === sessionId);
    if (!team) {
      sendResponse(res, 404, 'Team not found in game');
      return;
    }

    const isInTeam =
      team.players.municipality === userId.toString() ||
      team.players.mrf === userId.toString() ||
      team.players.broker === userId.toString();

    if (!isInTeam) {
      sendResponse(res, 403, 'You are not a player in this game session');
      return;
    }

    const userRole =
      team.players.municipality === userId.toString()
        ? 'municipality'
        : team.players.mrf === userId.toString()
          ? 'mrf'
          : 'broker';

    await GameService.checkTeamTimer(sessionId);
    await GameService.checkElimination(sessionId);

    const refreshedGameState = await GameService.getGameState(sessionId);
    if (!refreshedGameState) {
      sendResponse(res, 404, 'Team data not found');
      return;
    }

    const updatedTeam = refreshedGameState.teams.find((t) => t.sessionId === sessionId);
    if (!updatedTeam) {
      sendResponse(res, 404, 'Team data not found');
      return;
    }

    const allTeams = refreshedGameState.teams.map((t) => ({
      teamId: t.teamId,
      teamName: t.teamName,
      citySlot: t.citySlot,
      totalScore: t.totalProjectScore || 0,
      status: t.gameStatus,
      budget: t.budget,
      health: t.cityHealth,
      co2: t.totalCO2,
      isEliminated: t.isEliminated,
    }));

    const rankings = [...allTeams].sort((a, b) => b.totalScore - a.totalScore);

    sendResponse(res, 200, 'Game state retrieved successfully', {
      gameState: refreshedGameState,
      userRole,
      team: updatedTeam,
      rankings,
      allTeams,
      teamCount: refreshedGameState.teams.length,
    });
  }
);


export const endTurn = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { sessionId } = req.params;
    const userId = (req as any).user._id;

    const team = await GameService.getTeamData(sessionId);
    if (!team) {
      sendResponse(res, 404, 'Team not found');
      return;
    }

    // Check if user is part of this team
    const isInTeam = 
      team.players.municipality === userId.toString() ||
      team.players.mrf === userId.toString() ||
      team.players.broker === userId.toString();

    if (!isInTeam) {
      sendResponse(res, 403, 'You are not a player in this game session');
      return;
    }

    // ✅ Check if team is eliminated
    if (team.isEliminated) {
      sendResponse(res, 403, 'Team has been eliminated');
      return;
    }

    // ✅ Check if team timer expired - use global constants
    const now = Date.now();
    const elapsedMinutes = (now - team.teamStartTime) / (1000 * 60);
    const teamDurationMinutes = DEFAULT_GAME_CONSTANTS.TEAM_GAME_DURATION_MINUTES || 15;
    
    if (elapsedMinutes >= teamDurationMinutes) {
      team.gameStatus = 'completed';
            team.totalProjectScore = team.cityProjects
        .filter((p) => p.completed)
        .reduce((sum, p) => sum + Number(p.score ?? p.scoreBonus ?? 0), 0);

      await GameService.updateTeamData(sessionId, team);
      
      sendResponse(res, 200, 'Team timer expired. Game completed.', { team });
      return;
    }

    // ✅ End turn logic - use global constants for operating cost
    const operatingCost = DEFAULT_GAME_CONSTANTS.OPERATING_COST || 500;
    team.budget -= operatingCost;

    // Spawn new waste
    GameService.spawnWaste(team);

    // Recalculate health
    const completedProjects = team.cityProjects.filter(p => p.completed).length;
    const healthChange = completedProjects * 5 - (team.wasteInventory > 100 ? 2 : 0);
    team.cityHealth = Math.max(0, Math.min(100, team.cityHealth + healthChange));

    team.activityLog.unshift(`[Turn ended] Operating cost: -$${operatingCost}`);

    await GameService.updateTeamData(sessionId, team);

    sendResponse(res, 200, 'Turn ended successfully', { team });
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

    await GameService.performSystemCheck(sessionId);

    const team = await GameService.getTeamData(sessionId);
    
    sendResponse(res, 200, 'System check completed', { team });
  }
);

export const getTeamRankings = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { sessionId } = req.params;
    const userId = (req as any).user._id;

    const gameState = await GameService.getGameState(sessionId);
    if (!gameState) {
      sendResponse(res, 404, 'Game session not found');
      return;
    }

    // Verify user is part of this game
    const team = gameState.teams.find(t => 
      t.players.municipality === userId.toString() ||
      t.players.mrf === userId.toString() ||
      t.players.broker === userId.toString()
    );

    if (!team) {
      sendResponse(res, 403, 'User is not part of this game session');
      return;
    }

    const rankings = GameService.getTeamRankings(gameState);

    sendResponse(res, 200, 'Team rankings retrieved successfully', {
      rankings,
      myTeam: team,
      totalTeams: gameState.teams.length,
    });
  }
);

// ✅ NEW: Get all teams in the room
export const getAllTeams = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { sessionId } = req.params;
    const userId = (req as any).user._id;

    const gameState = await GameService.getGameState(sessionId);
    if (!gameState) {
      sendResponse(res, 404, 'Game session not found');
      return;
    }

    // Verify user is part of this game
    const team = gameState.teams.find(t => 
      t.players.municipality === userId.toString() ||
      t.players.mrf === userId.toString() ||
      t.players.broker === userId.toString()
    );

    if (!team) {
      sendResponse(res, 403, 'User is not part of this game session');
      return;
    }

    const allTeams = gameState.teams.map(t => ({
      teamId: t.teamId,
      teamName: t.teamName,
      citySlot: t.citySlot,
      budget: t.budget,
      cityHealth: t.cityHealth,
      totalCO2: t.totalCO2,
      totalProjectScore: t.totalProjectScore,
      gameStatus: t.gameStatus,
      isEliminated: t.isEliminated,
      eliminationReason: t.eliminationReason,
      players: t.playerNames,
    }));

    sendResponse(res, 200, 'All teams retrieved successfully', {
      teams: allTeams,
      totalTeams: gameState.teams.length,
    });
  }
);