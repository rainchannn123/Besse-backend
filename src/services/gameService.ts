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
  private static readonly MATERIAL_COST_WEIGHTS = {
    paper: 18,
    plastic: 28,
    metal: 42,
    glass: 24,
    wood: 20,
  } as const;

  private static calculateMaxTeamScore(projects: CityProject[] = []): number {
    return projects.reduce(
      (sum, project) => sum + Number(project.score ?? project.scoreBonus ?? 0),
      0
    );
  }

  private static calculateCompletedProjectScore(projects: CityProject[] = []): number {
    return projects
      .filter((project) => project.completed)
      .reduce((sum, project) => sum + Number(project.score ?? project.scoreBonus ?? 0), 0);
  }

  private static normalizeTeamScoreFields(team: TeamData): TeamData {
    const maxTeamScore = this.calculateMaxTeamScore(team.cityProjects || []);
    const totalProjectScore = this.calculateCompletedProjectScore(team.cityProjects || []);

    team.maxTeamScore = maxTeamScore;
    team.totalProjectScore = totalProjectScore;

    return team;
  }


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
        maxTeamScore: 0,
        totalCO2: 0,
        wasteInventory: 0,
        totalTransportTrips: 0,
        totalLandfillTons: 0,
                teamStartTime: now,
        minutesElapsed: 0,
        lastWasteSpawnTime: now,
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
            lastWasteSpawnTime: now,
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
            maxTeamScore: 0
          });
        }
      }

            // Ensure every team starts with at least one waste batch
            for (const t of allTeams) {
        if (!t.wasteBatches || t.wasteBatches.length === 0) {
          this.spawnWaste(t);
        }
        t.lastWasteSpawnTime = now;
        t.wasteInventory = (t.wasteBatches || [])
          .filter((b) => b.status === 'PENDING')
          .reduce((sum, b) => sum + b.mass, 0);
        this.normalizeTeamScoreFields(t);
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
    const projects: CityProject[] = [
      {
        id: 'p-1',
        name: 'Neighborhood Pocket Park Upgrade',
        description: 'Install recycled benches and planters in a small neighborhood pocket park.',
        requiredMaterials: { wood: 3, paper: 2 },
        progress: 0,
        completed: false,
        healthBonus: 2,
        budgetBonus: 700,
        scoreBonus: 0,
        difficultyScore: 0,
        estimatedExternalCost: 0,
        deadline: 8,
        score: 0,
      },
      {
        id: 'p-2',
        name: 'Eco Bus Stop Shelter Upgrade',
        description: 'Add lightweight recycled canopy shades and seat panels to bus stops.',
        requiredMaterials: { plastic: 5, metal: 2, wood: 1 },
        progress: 0,
        completed: false,
        healthBonus: 3,
        budgetBonus: 820,
        scoreBonus: 0,
        difficultyScore: 0,
        estimatedExternalCost: 0,
        deadline: 9,
        score: 0,
      },
      {
        id: 'p-3',
        name: 'Community Compost Kiosk Network',
        description: 'Deploy small compost information kiosks across residential zones.',
        requiredMaterials: { wood: 6, glass: 3, paper: 4 },
        progress: 0,
        completed: false,
        healthBonus: 4,
        budgetBonus: 1050,
        scoreBonus: 0,
        difficultyScore: 0,
        estimatedExternalCost: 0,
        deadline: 12,
        score: 25,
      },
      {
        id: 'p-4',
        name: 'School Recycling Corner Program',
        description: 'Create dedicated sorting points in schools to reduce mixed waste streams.',
        requiredMaterials: { paper: 8, plastic: 6, metal: 3 },
        progress: 0,
        completed: false,
        healthBonus: 5,
        budgetBonus: 1280,
        scoreBonus: 0,
        difficultyScore: 0,
        estimatedExternalCost: 0,
        deadline: 13,
        score: 0,
      },
      {
        id: 'p-5',
        name: 'Green Civic Plaza Development',
        description: 'Build a central eco-plaza with reclaimed materials and modular seating.',
        requiredMaterials: { glass: 9, wood: 7, paper: 5, metal: 3 },
        progress: 0,
        completed: false,
        healthBonus: 7,
        budgetBonus: 1700,
        scoreBonus: 0,
        difficultyScore: 0,
        estimatedExternalCost: 0,
        deadline: 16,
        score: 0,
      },
      {
        id: 'p-6',
        name: 'Riverfront Cleanup & Sorting Pier',
        description: 'Install interception docks and sort stations near waterways.',
        requiredMaterials: { wood: 9, metal: 8, plastic: 5, glass: 4 },
        progress: 0,
        completed: false,
        healthBonus: 8,
        budgetBonus: 1950,
        scoreBonus: 0,
        difficultyScore: 0,
        estimatedExternalCost: 0,
        deadline: 17,
        score: 0,
      },
      {
        id: 'p-7',
        name: 'Sustainable Transit Hub Retrofit',
        description: 'Retrofit transit stations with durable recycled structures and safety barriers.',
        requiredMaterials: { metal: 14, plastic: 9, glass: 6 },
        progress: 0,
        completed: false,
        healthBonus: 9,
        budgetBonus: 2310,
        scoreBonus: 0,
        difficultyScore: 0,
        estimatedExternalCost: 0,
        deadline: 19,
        score: 0,
      },
      {
        id: 'p-8',
        name: 'Smart Waste Bin Network',
        description: 'Deploy sensor-enabled bins and route beacons for optimized collection.',
        requiredMaterials: { plastic: 14, metal: 10, glass: 6, paper: 3 },
        progress: 0,
        completed: false,
        healthBonus: 10,
        budgetBonus: 2750,
        scoreBonus: 0,
        difficultyScore: 0,
        estimatedExternalCost: 0,
        deadline: 18,
        score: 0,
      },
      {
        id: 'p-9',
        name: 'Solar-Powered Street Canopy System',
        description: 'Build solar-ready canopy lanes with reinforced recycled supports.',
        requiredMaterials: { glass: 13, metal: 16, plastic: 6, wood: 4 },
        progress: 0,
        completed: false,
        healthBonus: 12,
        budgetBonus: 3900,
        scoreBonus: 0,
        difficultyScore: 0,
        estimatedExternalCost: 0,
        deadline: 20,
        score: 35,
      },
      {
        id: 'p-10',
        name: 'Urban Materials Innovation Center',
        description: 'Open an urban lab for advanced reuse prototyping and pilot processing.',
        requiredMaterials: { paper: 10, plastic: 12, glass: 10, metal: 14, wood: 6 },
        progress: 0,
        completed: false,
        healthBonus: 14,
        budgetBonus: 4230,
        scoreBonus: 0,
        difficultyScore: 0,
        estimatedExternalCost: 0,
        deadline: 22,
        score: 0,
      },
      {
        id: 'p-11',
        name: 'Resilient Eco-School Retrofit',
        description: 'Upgrade schools with resilient recycled structures and low-emission finishes.',
        requiredMaterials: { wood: 15, glass: 8, paper: 9, metal: 5 },
        progress: 0,
        completed: false,
        healthBonus: 11,
        budgetBonus: 4400,
        scoreBonus: 0,
        difficultyScore: 0,
        estimatedExternalCost: 0,
        deadline: 21,
        score: 0,
      },
      {
        id: 'p-12',
        name: 'Industrial Reuse & Recovery Depot',
        description: 'Set up a heavy-duty depot for industrial-scale material recirculation.',
        requiredMaterials: { metal: 20, wood: 10, plastic: 9, glass: 6 },
        progress: 0,
        completed: false,
        healthBonus: 16,
        budgetBonus: 6400,
        scoreBonus: 0,
        difficultyScore: 0,
        estimatedExternalCost: 0,
        deadline: 24,
        score: 0,
      },
      {
        id: 'p-13',
        name: 'Community Repair & Reuse Hub',
        description: 'Launch repair-first hubs with tool walls, collection bays, and sorting lines.',
        requiredMaterials: { metal: 12, paper: 10, plastic: 12, wood: 8, glass: 5 },
        progress: 0,
        completed: false,
        healthBonus: 13,
        budgetBonus: 6850,
        scoreBonus: 0,
        difficultyScore: 0,
        estimatedExternalCost: 0,
        deadline: 23,
        score: 0,
      },
      {
        id: 'p-14',
        name: 'Eco Market & Circular Trade Hall',
        description: 'Construct a flagship circular economy market with high-capacity infrastructure.',
        requiredMaterials: { glass: 16, wood: 14, paper: 11, plastic: 10, metal: 18 },
        progress: 0,
        completed: false,
        healthBonus: 18,
        budgetBonus: 8800,
        scoreBonus: 0,
        difficultyScore: 0,
        estimatedExternalCost: 0,
        deadline: 25,
        score: 0,
      }
    ];

    return projects.map(project => {
      const totalQuantity = Object.values(project.requiredMaterials).reduce(
        (sum, value) => sum + (value || 0),
        0
      );
      const estimatedExternalCost = Object.entries(project.requiredMaterials).reduce(
        (sum, [material, qty]) => {
          const weight = this.MATERIAL_COST_WEIGHTS[material as keyof typeof this.MATERIAL_COST_WEIGHTS] || 0;
          return sum + (qty || 0) * weight;
        },
        0
      );

      const difficultyScore = Math.round(totalQuantity + estimatedExternalCost / 180);
      const scoreBonus = Math.max(8, Math.round(difficultyScore * 1.35));

      return {
        ...project,
        estimatedExternalCost,
        difficultyScore,
        scoreBonus,
        score: scoreBonus,
      };
    });
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

    const teamIndex = gameState.teams.findIndex((t) => t.sessionId === sessionId);
    if (teamIndex === -1) return null;

    const team = gameState.teams[teamIndex];
    const prevMax = team.maxTeamScore;
    const prevTotal = team.totalProjectScore;

    this.normalizeTeamScoreFields(team);

    if (prevMax !== team.maxTeamScore || prevTotal !== team.totalProjectScore) {
      gameState.teams[teamIndex] = team;
      await this.updateGameState(sessionId, gameState);
    }

    return team;
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

    this.normalizeTeamScoreFields(teamData);
    gameState.teams[index] = teamData;
    await this.updateGameState(sessionId, gameState);
  }


    static async updateGameState(sessionId: string, gameState: GameState): Promise<void> {
    const relatedSessionIds = new Set<string>([sessionId]);

    // In matchmaking/multi-team mode, each team has its own GameSession document.
    // Keep all copies in sync by writing the same authoritative gameState to all room sessions.
    if (Array.isArray(gameState.roomTeams)) {
      for (const rt of gameState.roomTeams) {
        if (rt?.sessionId) relatedSessionIds.add(rt.sessionId);
      }
    }

    await GameSession.updateMany(
      { sessionId: { $in: Array.from(relatedSessionIds) } },
      { gameState }
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
      team.totalProjectScore = this.calculateCompletedProjectScore(team.cityProjects);

      await this.updateTeamData(sessionId, team);
      await this.checkAllTeamsComplete(sessionId);
    }

  }

    static async checkAllTeamsComplete(sessionId: string): Promise<void> {
    const gameState = await this.getGameState(sessionId);
    if (!gameState) return;

    gameState.teams = gameState.teams.map((team) => this.normalizeTeamScoreFields(team));

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

      if (gameState.roomCode) {
        WebSocketService.emitAdminTelemetryUpdate(gameState.roomCode, {
          actionType: 'game-complete',
          source: 'game-service',
          sessionId,
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
            team.totalProjectScore = this.calculateCompletedProjectScore(team.cityProjects);


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
            totalScore: team.totalProjectScore ?? this.calculateCompletedProjectScore(team.cityProjects),

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

    static async getPlayerRole(sessionId: string, userId: any): Promise<string | null> {
    const team = await this.getTeamData(sessionId);
    if (!team) return null;

    const normalizedUserId = userId?.toString?.() ?? String(userId);

    if (team.players.municipality === normalizedUserId) return 'municipality';
    if (team.players.mrf === normalizedUserId) return 'mrf';
    if (team.players.broker === normalizedUserId) return 'broker';
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
    const team = await this.getTeamData(sessionId);
    if (!team) return;

                // Process in-flight transports first (fast/slow delivery)

    try {
      const { MunicipalityService } = await import('./municipalityService');
      await MunicipalityService.completeAllTransports(sessionId);

      const { MRFService } = await import('./mrfService');
      await MRFService.completeMrfMaterialTransports(sessionId);
    } catch (error) {
      logger.error(`[GameService] Transport completion check failed for ${sessionId}`, error);
    }

    const refreshedTeam = (await this.getTeamData(sessionId)) || team;
    if (refreshedTeam.isEliminated || refreshedTeam.gameStatus !== 'active') {
      return;
    }

    const now = Date.now();
    const elapsedMinutes = (now - refreshedTeam.teamStartTime) / (1000 * 60);
    refreshedTeam.minutesElapsed = elapsedMinutes;

    // Periodic waste spawn
    const lastSpawn = refreshedTeam.lastWasteSpawnTime || refreshedTeam.teamStartTime || now;
    const spawnIntervalMs = Math.max(1/60, this.constants.WASTE_SPAWN_INTERVAL_MINUTES) * 60 * 1000;
    if (now - lastSpawn >= spawnIntervalMs) {
      this.spawnWaste(refreshedTeam);
      refreshedTeam.lastWasteSpawnTime = now;
      refreshedTeam.activityLog.unshift(
        `[System] New waste batch generated for City ${refreshedTeam.citySlot}`
      );
    }

    // Overdue pending-batch penalties
    let penaltyCount = 0;
    for (const batch of refreshedTeam.wasteBatches) {
      if (typeof batch.penalized !== 'boolean') batch.penalized = false;
      if (batch.status === 'PENDING' && !batch.penalized && now > batch.collectionDeadline) {
        refreshedTeam.cityHealth = Math.max(
          0,
          refreshedTeam.cityHealth - this.constants.OVERDUE_BATCH_HEALTH_PENALTY
        );
        batch.penalized = true;
        penaltyCount += 1;
      }
    }

    if (penaltyCount > 0) {
      refreshedTeam.activityLog.unshift(
        `[System] ${penaltyCount} overdue waste batch(es). Health -${
          penaltyCount * this.constants.OVERDUE_BATCH_HEALTH_PENALTY
        }%`
      );
    }

    // Recalculate core team metrics
    refreshedTeam.wasteInventory = refreshedTeam.wasteBatches
      .filter((b) => b.status === 'PENDING')
      .reduce((sum, b) => sum + b.mass, 0);

    // Team timer completion
        if (elapsedMinutes >= this.constants.TEAM_GAME_DURATION_MINUTES) {
      refreshedTeam.gameStatus = 'completed';
      refreshedTeam.totalProjectScore = this.calculateCompletedProjectScore(refreshedTeam.cityProjects);
    }


    // Elimination checks
    if (refreshedTeam.cityHealth <= 0) {
      refreshedTeam.isEliminated = true;
      refreshedTeam.gameStatus = 'eliminated';
      refreshedTeam.eliminationReason = 'health';
    }

    if (refreshedTeam.budget < 0 && !refreshedTeam.isEliminated) {
      const hasAssets =
        refreshedTeam.materialInventory.length > 0 ||
        refreshedTeam.marketplaceListing.length > 0 ||
        refreshedTeam.wasteInventory > 0;

      if (!hasAssets) {
        refreshedTeam.isEliminated = true;
        refreshedTeam.gameStatus = 'eliminated';
        refreshedTeam.eliminationReason = 'budget';
      }
    }

    await this.updateTeamData(sessionId, refreshedTeam);
    await this.checkAllTeamsComplete(sessionId);

        const updatedGameState = await this.getGameState(sessionId);
    if (updatedGameState) {
      WebSocketService.emitToGameRoom(sessionId, 'system-check-update', {
        gameState: updatedGameState,
      });

      if (updatedGameState.roomCode) {
        WebSocketService.emitAdminTelemetryUpdate(updatedGameState.roomCode, {
          actionType: 'system-check-update',
          source: 'system-check',
          sessionId,
        });
      }
    }

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