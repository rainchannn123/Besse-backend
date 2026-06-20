import mongoose from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import { DEFAULT_GAME_CONSTANTS } from '../constants/constants';
import GameSession, { IGameSession } from '../models/GameSession';
import Lobby from '../models/Lobby';
import PairScore from '../models/PairScore';
import MatchmakingRoom from '../models/MatchmakingRoom';
import User from '../models/User';
import { 
  CityProject, 
  GameConstants, 
  GameState, 
  WasteBatch,
  TeamData,
  TeamStatus,
  GameStatus
} from '../types';
import { logger } from '../utils/logger';
import { BrokerService } from './brokerService';
import { CalculationService } from './calculationService';
import { LobbyService } from './lobbyService';
import { WebSocketService } from './websocketService';

export class GameService {
  public static constants: GameConstants = DEFAULT_GAME_CONSTANTS;

  // ============================================
  // MULTI-TEAM GAME CREATION
  // ============================================

  static async createGameFromLobby(sessionId: string): Promise<GameState> {
    try {
      logger.info(`[GameService] Creating multi-team game for session: ${sessionId}`);

      const existingGame = await GameSession.findOne({ sessionId });
      if (existingGame) {
        logger.warn(`[GameService] Game already exists for session ${sessionId}, returning existing`);
        return existingGame.gameState;
      }

      // ✅ Get lobby data directly
      const lobby = await Lobby.findOne({ sessionId });
      if (!lobby) {
        throw new Error(`Lobby not found for session: ${sessionId}`);
      }

      // ✅ Get roles from lobby players
      const lobbyPlayers = lobby.players || [];
      const municipalityPlayer = lobbyPlayers.find((p: any) => p.selectedRole === 'municipality');
      const mrfPlayer = lobbyPlayers.find((p: any) => p.selectedRole === 'mrf');
      const brokerPlayer = lobbyPlayers.find((p: any) => p.selectedRole === 'broker');

      if (!municipalityPlayer || !mrfPlayer || !brokerPlayer) {
        logger.error(`[GameService] Missing roles for session ${sessionId}:`, {
          municipality: !!municipalityPlayer,
          mrf: !!mrfPlayer,
          broker: !!brokerPlayer,
          lobbyPlayers: lobbyPlayers.map((p: any) => ({ name: p.name, role: p.selectedRole }))
        });
        throw new Error('Missing role assignments');
      }

      const user = await User.findOne({ currentSession: sessionId });
      if (!user) {
        throw new Error('User not found');
      }

      const matchmakingRoom = await MatchmakingRoom.findOne({
        'teams.sessionId': sessionId,
      });

      if (!matchmakingRoom) {
        throw new Error('Team not in a matchmaking room');
      }

      const teamData = matchmakingRoom.teams.find(t => t.sessionId === sessionId);
      if (!teamData) {
        throw new Error('Team not found in room');
      }

      const now = Date.now();

      const team: TeamData = {
        teamId: teamData.teamId,
        sessionId: sessionId,
        citySlot: teamData.citySlot || 1,
        teamName: teamData.players.find(p => p.isLeader)?.name || `City ${teamData.citySlot}`,
        players: {
          municipality: municipalityPlayer.userId.toString(),
          mrf: mrfPlayer.userId.toString(),
          broker: brokerPlayer.userId.toString(),
        },
        playerNames: {
          municipality: municipalityPlayer.name,
          mrf: mrfPlayer.name,
          broker: brokerPlayer.name,
        },
        budget: this.constants.STARTING_BUDGET,
        cityHealth: this.constants.STARTING_HEALTH,
        totalCO2: 0,
        wasteInventory: 0,
        totalTransportTrips: 0,
        totalLandfillTons: 0,
        teamStartTime: now,
        minutesElapsed: 0,
        gameStatus: 'active',
        cityProjects: this.generateInitialProjects(),
        municipalInventory: {
          paper: 0,
          plastic: 0,
          metal: 0,
          glass: 0,
          wood: 0,
        },
        wasteBatches: [],
        mrfQueue: [],
        materialInventory: [],
        transactions: [],
        activityLog: [
          `[System] Team ${teamData.citySlot} game started!`,
          `[System] 15 minute timer started`,
          `[Players] Municipality: ${municipalityPlayer.name}`,
          `[Players] MRF: ${mrfPlayer.name}`,
          `[Players] Broker: ${brokerPlayer.name}`,
        ],
        activeLocks: {},
        gameOverCountdown: {
          active: false,
          startTime: null,
          reason: null,
        },
        surrenderVotes: [],
        marketplaceListing: [],
        externalStock: {
          paper: Math.floor(Math.random() * 56) + 10,
          plastic: Math.floor(Math.random() * 56) + 10,
          metal: Math.floor(Math.random() * 56) + 10,
          glass: Math.floor(Math.random() * 56) + 10,
          wood: Math.floor(Math.random() * 56) + 10,
        },
        activeBids: {},
        activeTransports: [],
        totalProjectScore: 0,
        isEliminated: false,
        eliminationReason: null,
      };

      this.spawnWaste(team);

      const allTeams: TeamData[] = [];
      for (const t of matchmakingRoom.teams) {
        if (t.sessionId === sessionId) {
          allTeams.push(team);
        } else {
          // ✅ Get roles for other teams from their lobbies
          const otherLobby = await Lobby.findOne({ sessionId: t.sessionId });
          const otherLobbyPlayers = otherLobby?.players || [];
          const otherMuni = otherLobbyPlayers.find((p: any) => p.selectedRole === 'municipality');
          const otherMrf = otherLobbyPlayers.find((p: any) => p.selectedRole === 'mrf');
          const otherBroker = otherLobbyPlayers.find((p: any) => p.selectedRole === 'broker');

          allTeams.push({
            teamId: t.teamId,
            sessionId: t.sessionId,
            citySlot: t.citySlot,
            teamName: t.players.find(p => p.isLeader)?.name || `City ${t.citySlot}`,
            players: {
              municipality: otherMuni?.userId?.toString() || '',
              mrf: otherMrf?.userId?.toString() || '',
              broker: otherBroker?.userId?.toString() || '',
            },
            playerNames: {
              municipality: otherMuni?.name || '',
              mrf: otherMrf?.name || '',
              broker: otherBroker?.name || '',
            },
            budget: this.constants.STARTING_BUDGET,
            cityHealth: this.constants.STARTING_HEALTH,
            totalCO2: 0,
            wasteInventory: 0,
            totalTransportTrips: 0,
            totalLandfillTons: 0,
            teamStartTime: now,
            minutesElapsed: 0,
            gameStatus: 'active',
            cityProjects: this.generateInitialProjects(),
            municipalInventory: {
              paper: 0,
              plastic: 0,
              metal: 0,
              glass: 0,
              wood: 0,
            },
            wasteBatches: [],
            mrfQueue: [],
            materialInventory: [],
            transactions: [],
            activityLog: [`[System] Team ${t.citySlot} waiting for players`],
            activeLocks: {},
            gameOverCountdown: {
              active: false,
              startTime: null,
              reason: null,
            },
            surrenderVotes: [],
            marketplaceListing: [],
            externalStock: {
              paper: Math.floor(Math.random() * 56) + 10,
              plastic: Math.floor(Math.random() * 56) + 10,
              metal: Math.floor(Math.random() * 56) + 10,
              glass: Math.floor(Math.random() * 56) + 10,
              wood: Math.floor(Math.random() * 56) + 10,
            },
            activeBids: {},
            activeTransports: [],
            totalProjectScore: 0,
            isEliminated: false,
            eliminationReason: null,
          });
        }
      }

      // ✅ Update lobby status to active
      lobby.status = 'active';
      lobby.stage = 'in-game';
      await lobby.save();

      const gameState: GameState = {
        sessionId: sessionId,
        roomCode: matchmakingRoom.roomCode,
        roomTeams: matchmakingRoom.teams.map(t => ({
          teamId: t.teamId,
          citySlot: t.citySlot,
          sessionId: t.sessionId,
        })),
        citySlot: teamData.citySlot,
        teams: allTeams,
        constants: this.constants,
        gameStartTime: now,
        gameStatus: 'active',
      };

      await GameSession.create({
        sessionId: sessionId,
        gameState,
        players: {
          municipality: municipalityPlayer.userId,
          mrf: mrfPlayer.userId,
          broker: brokerPlayer.userId,
        },
        playerNames: {
          municipality: municipalityPlayer.name,
          mrf: mrfPlayer.name,
          broker: brokerPlayer.name,
        },
      });

      // ✅ Broadcast to all teams in the room
      for (const t of matchmakingRoom.teams) {
        WebSocketService.emitToGameRoom(t.sessionId, 'game-started', {
          sessionId: t.sessionId,
          gameSessionId: sessionId,
          teamRole: `City ${t.citySlot}`,
          gameState: gameState,
        });
      }

      logger.info(`[GameService] ✅ Multi-team game created for room: ${matchmakingRoom.roomCode}`);
      return gameState;
    } catch (error) {
      logger.error(`[GameService] ❌ Failed to create game:`, error);
      throw error;
    }
  }

  // ============================================
  // GENERATE INITIAL PROJECTS
  // ============================================

  private static generateInitialProjects(): CityProject[] {
    return [
      {
        id: 'p-1',
        name: 'Community Park',
        requiredMaterials: { paper: 10, wood: 5 },
        progress: 0,
        completed: false,
        healthBonus: 4,
        budgetBonus: 800,
        deadline: 10,
        score: 10,
      },
      {
        id: 'p-2',
        name: 'Recycling Center',
        requiredMaterials: { metal: 8, plastic: 6 },
        progress: 0,
        completed: false,
        healthBonus: 9,
        budgetBonus: 650,
        deadline: 15,
        score: 20,
      },
      {
        id: 'p-3',
        name: 'Green Plaza',
        requiredMaterials: { glass: 12, paper: 8, wood: 4 },
        progress: 0,
        completed: false,
        healthBonus: 13,
        budgetBonus: 900,
        deadline: 12,
        score: 25,
      },
      {
        id: 'p-4',
        name: 'Transit Hub',
        requiredMaterials: { metal: 15, plastic: 10 },
        progress: 0,
        completed: false,
        healthBonus: 10,
        budgetBonus: 1800,
        deadline: 20,
        score: 35,
      },
      {
        id: 'p-5',
        name: 'Waste-to-Energy Plant',
        requiredMaterials: { metal: 10, glass: 8, plastic: 6 },
        progress: 0,
        completed: false,
        healthBonus: 15,
        budgetBonus: 1500,
        deadline: 25,
        score: 40,
      },
    ];
  }

  // ============================================
  // SPAWN WASTE
  // ============================================

  static spawnWaste(team: TeamData): void {
    const origins: ('Residential' | 'Commercial' | 'Industrial')[] = [
      'Residential',
      'Commercial',
      'Industrial',
    ];
    const now = Date.now();
    const origin = origins[Math.floor(Math.random() * origins.length)];

    const mass = Math.round((Math.random() * 15 + 10) * 10) / 10;

    let composition: WasteBatch['composition'];

    switch (origin) {
      case 'Residential':
        composition = {
          paper: 0.5,
          plastic: 0.3,
          metal: 0,
          glass: 0.2,
          wood: 0,
        };
        break;
      case 'Commercial':
        composition = {
          paper: 0.4,
          plastic: 0.4,
          metal: 0.2,
          glass: 0,
          wood: 0,
        };
        break;
      case 'Industrial':
        composition = {
          paper: 0,
          plastic: 0.4,
          metal: 0.3,
          glass: 0,
          wood: 0.3,
        };
        break;
      default:
        composition = {
          paper: 0.33,
          plastic: 0.33,
          metal: 0.17,
          glass: 0.17,
          wood: 0,
        };
    }

    const batch: WasteBatch = {
      id: 'w-' + uuidv4().slice(0, 8),
      playerId: '',
      turnGenerated: 1,
      generationTime: now,
      origin: origin,
      mass: parseFloat(mass.toFixed(1)),
      composition: composition,
      status: 'PENDING',
      collectionDeadline: now + this.constants.BATCH_COLLECTION_DEADLINE_MINUTES * 60 * 1000,
      lockToken: null,
      lockedAt: null,
      penalized: false,
    };

    team.wasteBatches.push(batch);
  }

  // ============================================
  // GET TEAM DATA
  // ============================================

  static async getTeamData(sessionId: string): Promise<TeamData | null> {
    const gameState = await this.getGameState(sessionId);
    if (!gameState) return null;
    return gameState.teams.find(t => t.sessionId === sessionId) || null;
  }

  static async getGameState(sessionId: string): Promise<GameState | null> {
    const session = await GameSession.findOne({ sessionId });
    return session?.gameState || null;
  }

  static async getAllTeamsInRoom(roomCode: string): Promise<TeamData[]> {
    const gameState = await GameSession.findOne({ 'gameState.roomCode': roomCode });
    return gameState?.gameState?.teams || [];
  }

  static async updateTeamData(sessionId: string, teamData: TeamData): Promise<void> {
    const gameState = await this.getGameState(sessionId);
    if (!gameState) return;

    const index = gameState.teams.findIndex(t => t.sessionId === sessionId);
    if (index === -1) return;

    gameState.teams[index] = teamData;
    await this.updateGameState(sessionId, gameState);
  }

  static async updateGameState(sessionId: string, gameState: GameState): Promise<void> {
    await GameSession.findOneAndUpdate(
      { sessionId },
      { gameState },
      { new: true }
    );
  }

  // ============================================
  // CHECK TEAM TIMER
  // ============================================

  static async checkTeamTimer(sessionId: string): Promise<void> {
    const team = await this.getTeamData(sessionId);
    if (!team || team.isEliminated || team.gameStatus !== 'active') return;

    const now = Date.now();
    const elapsedMinutes = (now - team.teamStartTime) / (1000 * 60);
    team.minutesElapsed = elapsedMinutes;

    if (elapsedMinutes >= this.constants.TEAM_GAME_DURATION_MINUTES) {
      team.gameStatus = 'completed';
      team.totalProjectScore = team.cityProjects
        .filter(p => p.completed)
        .reduce((sum, p) => sum + p.score, 0);
      
      await this.updateTeamData(sessionId, team);
      await this.checkAllTeamsComplete(sessionId);
    }
  }

  static async checkAllTeamsComplete(sessionId: string): Promise<void> {
    const gameState = await this.getGameState(sessionId);
    if (!gameState) return;

    const allCompleted = gameState.teams.every(t => 
      t.gameStatus === 'completed' || t.isEliminated
    );

    if (allCompleted) {
      gameState.gameStatus = 'completed';
      await this.updateGameState(sessionId, gameState);
      
      const rankings = this.getTeamRankings(gameState);
      for (const team of gameState.teams) {
        WebSocketService.emitToGameRoom(team.sessionId, 'game-complete', {
          rankings: rankings,
          sessionId: team.sessionId,
        });
      }
    }
  }

  // ============================================
  // CHECK ELIMINATION
  // ============================================

  static async checkElimination(sessionId: string): Promise<void> {
    const team = await this.getTeamData(sessionId);
    if (!team || team.isEliminated || team.gameStatus !== 'active') return;

    let shouldEliminate = false;
    let reason: 'health' | 'budget' | null = null;

    if (team.cityHealth <= 0) {
      shouldEliminate = true;
      reason = 'health';
    }

    if (team.budget < 0) {
      const hasAssets = team.materialInventory.length > 0 || 
                        team.marketplaceListing.length > 0 ||
                        team.wasteInventory > 0;
      
      if (!hasAssets) {
        shouldEliminate = true;
        reason = 'budget';
      }
    }

    if (shouldEliminate) {
      team.isEliminated = true;
      team.gameStatus = 'eliminated';
      team.eliminationReason = reason;
      team.totalProjectScore = team.cityProjects
        .filter(p => p.completed)
        .reduce((sum, p) => sum + p.score, 0);

      await this.updateTeamData(sessionId, team);
      await this.checkAllTeamsComplete(sessionId);
    }
  }

  // ============================================
  // TEAM RANKINGS
  // ============================================

  static getTeamRankings(gameState: GameState): Array<{
    teamId: string;
    teamName: string;
    citySlot: number;
    totalScore: number;
    status: TeamStatus;
    budget: number;
    health: number;
    co2: number;
  }> {
    const rankings = gameState.teams.map(team => ({
      teamId: team.teamId,
      teamName: team.teamName,
      citySlot: team.citySlot,
      totalScore: team.totalProjectScore,
      status: team.gameStatus,
      budget: team.budget,
      health: team.cityHealth,
      co2: team.totalCO2,
    }));

    return rankings.sort((a, b) => b.totalScore - a.totalScore);
  }

  // ============================================
  // GET PLAYER ROLE
  // ============================================

  static async getPlayerRole(sessionId: string, userId: string): Promise<string | null> {
    const team = await this.getTeamData(sessionId);
    if (!team) return null;
    
    if (team.players.municipality === userId) return 'municipality';
    if (team.players.mrf === userId) return 'mrf';
    if (team.players.broker === userId) return 'broker';
    return null;
  }

  // ============================================
  // GET USER GAME SESSIONS
  // ============================================

  static async getUserGameSessions(userId: string): Promise<IGameSession[]> {
    return await GameSession.find({
      $or: [
        { 'players.municipality': userId },
        { 'players.mrf': userId },
        { 'players.broker': userId },
      ],
    })
      .populate('players.municipality', 'name')
      .populate('players.mrf', 'name')
      .populate('players.broker', 'name')
      .sort({ createdAt: -1 });
  }

  // ============================================
  // PERFORM SYSTEM CHECK
  // ============================================

  static async performSystemCheck(sessionId: string): Promise<void> {
    await this.checkTeamTimer(sessionId);
    await this.checkElimination(sessionId);
  }

  // ============================================
  // COLLECT WASTE (Legacy compatibility)
  // ============================================

  static async collectWaste(
    sessionId: string,
    batchId: string,
    playerId: string
  ): Promise<any> {
    const team = await this.getTeamData(sessionId);
    if (!team) throw new Error('Team not found');
    if (team.isEliminated) throw new Error('Team is eliminated');

    const batch = team.wasteBatches.find(b => b.id === batchId);
    if (!batch) throw new Error('Waste batch not found');
    if (batch.status !== 'PENDING') throw new Error('Batch already collected');

    const transportCost = CalculationService.calculateTransportCost(batch, this.constants);
    if (team.budget < transportCost) {
      throw new Error('Insufficient budget for transport');
    }

    team.budget -= transportCost;
    const transportCO2 = CalculationService.calculateCO2FromTransport(1, this.constants);
    team.totalCO2 += transportCO2;
    team.totalTransportTrips += 1;
    batch.status = 'DELIVERED';

    team.mrfQueue.push({
      id: `q-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      batchId: batch.id,
      playerId: playerId,
      arrivalTime: Date.now(),
      delivered: false,
      lockToken: null,
    });

    await this.updateTeamData(sessionId, team);
    return team;
  }
}