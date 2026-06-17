import { v4 as uuidv4 } from 'uuid';
import { DEFAULT_GAME_CONSTANTS } from '../constants/constants';
import GameSession, { IGameSession } from '../models/GameSession';
import Lobby from '../models/Lobby';
import PairScore from '../models/PairScore';
import { CityProject, GameConstants, GameState, WasteBatch } from '../types';
import { logger } from '../utils/logger';
import { BrokerService } from './brokerService';
import { CalculationService } from './calculationService';
import { LobbyService } from './lobbyService';
import { WebSocketService } from './websocketService';

export class GameService {
  // UPDATED: Exact constants from the manual with correct values and units
  private static constants: GameConstants = DEFAULT_GAME_CONSTANTS;

  // Updated method to complete all transports (multiple concurrent transports)
  static async checkAndCompleteTransports(sessionId: string): Promise<void> {
    const gameState = await this.getGameState(sessionId);
    if (!gameState || gameState.gameStatus !== 'active') {
      return;
    }

    const { MunicipalityService } = await import('./municipalityService');
    await MunicipalityService.completeAllTransports(sessionId);
  }

  static async createGameFromLobby(sessionId: string): Promise<GameState> {
    try {
      logger.info(`[GameService] Creating game for session: ${sessionId}`);

      // Check if game already exists for this session
      const existingGame = await GameSession.findOne({ sessionId });
      if (existingGame) {
        logger.warn(
          `[GameService] Game already exists for session ${sessionId}, returning existing game state`
        );
        // Override constants so existing sessions pick up latest values
        existingGame.gameState.constants = this.constants;
        return existingGame.gameState;
      }

      const lobby = await LobbyService.startGame(sessionId);
      logger.info(
        `[GameService] Lobby status updated to 'active' for session: ${sessionId}`
      );

      // Get player assignments
      const municipalityPlayer = lobby.players.find(
        p => p.selectedRole === 'municipality'
      );
      const mrfPlayer = lobby.players.find(p => p.selectedRole === 'mrf');
      const brokerPlayer = lobby.players.find(p => p.selectedRole === 'broker');

      if (!municipalityPlayer || !mrfPlayer || !brokerPlayer) {
        logger.error(
          `[GameService] Missing role assignments for session ${sessionId}`
        );
        throw new Error('Missing role assignments');
      }

      logger.info(
        `[GameService] Players assigned - Municipality: ${municipalityPlayer.name}, MRF: ${mrfPlayer.name}, Broker: ${brokerPlayer.name}`
      );

      const now = Date.now();
      const gameState: GameState = {
        sessionId: sessionId,
        currentTurn: 1,
        budget: this.constants.STARTING_BUDGET,
        cityHealth: this.constants.STARTING_HEALTH,
        totalCO2: 0,
        wasteInventory: 0,
        maxCapacity: 150,
        constants: this.constants,
        wasteBatches: [],
        mrfQueue: [],
        materialInventory: [],
        transactions: [],
        cityProjects: this.generateInitialProjects(),
        activityLog: [
          `[System] Game session started! Real-time duration: ${this.constants.REAL_TIME_GAME_DURATION_MINUTES} minutes (${this.constants.GAME_DURATION_DAYS} game days)`,
          `[System] Waste generation: Every 2 minutes (10-25 tons per batch)`,
          `[System] Collection deadline: ${this.constants.BATCH_COLLECTION_DEADLINE_MINUTES} minutes`,
          `[Players] Municipality: ${municipalityPlayer.name}`,
          `[Players] MRF: ${mrfPlayer.name}`,
          `[Players] Broker: ${brokerPlayer.name}`,
          `[Starting] Budget: $${this.constants.STARTING_BUDGET.toLocaleString()}`,
          `[Starting] Health: ${this.constants.STARTING_HEALTH}%`,
        ],
        gameStatus: 'active',
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
        gameStartTime: now,
        lastWasteSpawnTime: now,
        lastAutoSaveTime: now,
        minutesElapsed: 0,
        currentGameDay: 1,
        currentGameHour: 0,
        activeLocks: {},
        gameOverCountdown: {
          active: false,
          startTime: null,
          reason: null,
        },
        // Include pairing fields from lobby
        pairId: lobby.pairId,
        partnerSessionId: lobby.partnerSessionId,
        teamRole: lobby.teamRole,
        pairStatus: lobby.pairStatus,
        totalTransportTrips: 0,
        totalLandfillTons: 0,
        municipalInventory: {
          paper: 0,
          plastic: 0,
          metal: 0,
          glass: 0,
          wood: 0,
        },
        marketplaceListing: [],
        externalStock: {
          paper: Math.floor(Math.random() * 56) + 10,
          plastic: Math.floor(Math.random() * 56) + 10,
          metal: Math.floor(Math.random() * 56) + 10,
          glass: Math.floor(Math.random() * 56) + 10,
          wood: Math.floor(Math.random() * 56) + 10,
        },
        activeBids: {},
        surrenderVotes: [],
        activeTransports: [], // NEW: Array of active transports for multiple concurrent transports
      };

      // Spawn initial waste batch immediately
      this.spawnWaste(gameState);

      // Recalculate core metrics after initial waste spawn
      this.recalculateCoreMetrics(gameState);

      logger.info(
        `[GameService] Saving game session to database for session: ${sessionId}`
      );

      // Save to database
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

      logger.info(
        `[GameService] ✅ Game created successfully for session: ${sessionId}`
      );
      WebSocketService.broadcastFullGameState(
        sessionId,
        {
          playerRoles: {
            municipality: municipalityPlayer.userId,
            mrf: mrfPlayer.userId,
            broker: brokerPlayer.userId,
          },
          gameState,
        },
        'game-started'
      );
      return gameState;
    } catch (error) {
      logger.error(
        `[GameService] ❌ Failed to create game for session ${sessionId}:`,
        error
      );

      // Rollback lobby status
      try {
        await Lobby.findOneAndUpdate(
          { sessionId },
          {
            status: 'ready',
            stage: 'pairing',
            pairId: null,
            partnerSessionId: null,
            teamRole: null,
            pairStatus: null,
          }
        );
        logger.info(
          `[GameService] Rolled back lobby status to 'ready' for session: ${sessionId}`
        );
      } catch (rollbackError) {
        logger.error(
          `[GameService] Failed to rollback lobby status for session ${sessionId}:`,
          rollbackError
        );
      }

      throw error;
    }
  }

  // Helper method to generate initial projects
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
      },
    ];
  }

  static async getGameState(sessionId: string): Promise<GameState | null> {
    const session = await GameSession.findOne({ sessionId });
    return session?.gameState || null;
  }

  static async getAllActiveGameStates(): Promise<GameState[]> {
    const sessions = await GameSession.find({
      'gameState.gameStatus': 'active',
    });
    return sessions.map(session => session.gameState);
  }

  static async getPairedGameStates(playerId: string, sessionId?: string): Promise<GameState[]> {
    const allActive = await this.getAllActiveGameStates();
    const pid = playerId.toString();

    let playerSession;
    if (sessionId) {
      playerSession = allActive.find(gs => gs.sessionId === sessionId);
    } else {
      playerSession = allActive.find(
        gs =>
          gs.players.municipality?.toString() === pid ||
          gs.players.mrf?.toString() === pid ||
          gs.players.broker?.toString() === pid
      );
    }
    if (!playerSession) return [];

    const sessionIds = [playerSession.sessionId];
    if (playerSession.partnerSessionId) {
      sessionIds.push(playerSession.partnerSessionId);
    }

    return allActive.filter(gs => sessionIds.includes(gs.sessionId));
  }

  static async updateGameState(
    sessionId: string,
    gameState: GameState
  ): Promise<void> {
    await GameSession.findOneAndUpdate(
      { sessionId },
      { gameState },
      { new: true }
    );
  }

  static spawnWaste(gameState: GameState): void {
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
      turnGenerated: gameState.currentTurn,
      generationTime: now,
      origin: origin,
      mass: parseFloat(mass.toFixed(1)),
      composition: composition,
      status: 'PENDING',
      collectionDeadline: now + gameState.constants.BATCH_COLLECTION_DEADLINE_MINUTES * 60 * 1000,
      lockToken: null,
      lockedAt: null,
      penalized: false,
    };

    gameState.wasteBatches.push(batch);
    gameState.lastWasteSpawnTime = now;

    try {
      this.emitFullGameState(gameState.sessionId, gameState, 'waste-spawned', {
        batchId: batch.id,
        batchMass: batch.mass,
        origin,
      }).catch(() => {});
    } catch (err) {}
  }

  static async endTurn(sessionId: string): Promise<GameState> {
    const gameState = await this.getGameState(sessionId);
    if (!gameState) {
      throw new Error('Game session not found');
    }

    if (gameState.gameStatus !== 'active') {
      throw new Error('Game has already ended');
    }

    gameState.budget -= this.constants.OPERATING_COST;

    const completedProjects = gameState.cityProjects.filter(
      project => project.completed
    ).length;
    const healthChange = CalculationService.calculateHealthChange(
      gameState.wasteBatches,
      gameState.totalCO2,
      completedProjects,
      gameState.constants
    );

    gameState.cityHealth = Math.max(
      0,
      Math.min(100, gameState.cityHealth + healthChange.healthChange)
    );

    if (healthChange.healthChange !== 0) {
      let healthChangeMessage = `[System] Health: ${
        healthChange.healthChange > 0 ? '+' : ''
      }${healthChange.healthChange.toFixed(1)}%`;

      if (healthChange.wastePenalty > 0) {
        healthChangeMessage += ` (Waste penalty: -${
          healthChange.wastePenalty
        }% from ${healthChange.uncollectedWaste.toFixed(1)} tons uncollected)`;
      }
      if (healthChange.co2Penalty > 0) {
        healthChangeMessage += ` (CO2 penalty: -${
          healthChange.co2Penalty
        }% from ${gameState.totalCO2.toFixed(1)} tons CO2)`;
      }
      if (healthChange.projectBonus > 0) {
        healthChangeMessage += ` (Project bonus: +${healthChange.projectBonus}% from ${completedProjects} completed projects)`;
      }

      gameState.activityLog.unshift(healthChangeMessage);
    }

    const gameStatus = this.checkGameStatus(gameState);

    if (gameStatus.status !== 'active') {
      gameState.gameStatus = gameStatus.status as 'won' | 'lost';
      gameState.activityLog.unshift(`[GAME OVER] ${gameStatus.message}`);
      await Lobby.findOneAndUpdate({ sessionId }, { status: 'completed' });
    } else {
      gameState.currentTurn++;
      this.spawnWaste(gameState);
      this.recalculateCoreMetrics(gameState);
      gameState.activityLog.unshift(
        `[Turn ${gameState.currentTurn}] Started. Operating cost: -$${this.constants.OPERATING_COST}`
      );
    }

    await this.updateGameState(sessionId, gameState);

    WebSocketService.broadcastGameStateUpdate(
      sessionId,
      gameState,
      'turn-ended',
      {
        turnNumber: gameState.currentTurn,
        dayNumber: gameState.currentGameDay,
        gameStatus: gameState.gameStatus,
      }
    );

    try {
      await this.emitFullGameState(sessionId, gameState, 'turn-ended', {
        turnNumber: gameState.currentTurn,
        dayNumber: gameState.currentGameDay,
        gameStatus: gameState.gameStatus,
      });
    } catch (err) {}

    return gameState;
  }

  static checkGameStatus(gameState: GameState): {
    status: string;
    message: string;
  } {
    return {
      status: 'active',
      message: `Game in progress. Turn ${gameState.currentTurn}.`,
    };
  }

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

  static async getPlayerRole(
    sessionId: string,
    userId: string
  ): Promise<string | null> {
    const session = await GameSession.findOne({ sessionId });
    if (!session) return null;
    if (session.players.municipality.toString() === userId.toString())
      return 'municipality';
    if (session.players.mrf.toString() === userId.toString()) return 'mrf';
    if (session.players.broker.toString() === userId.toString())
      return 'broker';
    return null;
  }

  static async getPairDetails(pairId: string): Promise<any | null> {
    const pairScore = await PairScore.findOne({ pairId }).lean();
    if (!pairScore) return null;

    let status: string;
    if (pairScore.pairStatus === 'completed') {
      status = 'Active';
    } else if (pairScore.pairStatus === 'team_a_eliminated') {
      status = 'Team A Eliminated';
    } else if (pairScore.pairStatus === 'team_b_eliminated') {
      status = 'Team B Eliminated';
    } else {
      status = pairScore.pairStatus;
    }

    return {
      pairId: pairScore.pairId,
      averagePairHealth: pairScore.averagePairHealth,
      teamAHealth: pairScore.teamAHealth,
      teamBHealth: pairScore.teamBHealth,
      teamABudget: pairScore.teamABudget,
      teamBBudget: pairScore.teamBBudget,
      teamACO2: pairScore.teamACO2,
      teamBCO2: pairScore.teamBCO2,
      teamAGameStatus: pairScore.teamAGameStatus,
      teamBGameStatus: pairScore.teamBGameStatus,
      teamAPairStatus: pairScore.teamAPairStatus,
      teamBPairStatus: pairScore.teamBPairStatus,
      teamASessionId: pairScore.teamASessionId,
      teamBSessionId: pairScore.teamBSessionId,
      status,
      gameEndTimestamp: pairScore.gameEndTimestamp,
    };
  }

  static async getGlobalPairRankings(): Promise<
    {
      rank: number;
      pairId: string;
      averagePairHealth: number;
      teamAHealth: number | null;
      teamBHealth: number | null;
      teamASessionId: string;
      teamBSessionId: string;
      status: string;
      gameEndTimestamp: Date | undefined;
    }[]
  > {
    const rankings = await PairScore.find({})
      .sort({ averagePairHealth: -1, gameEndTimestamp: -1 })
      .lean();

    return rankings.map((pair, index) => {
      let status: string;
      if (pair.pairStatus === 'completed') {
        status = 'Active';
      } else if (pair.pairStatus === 'team_a_eliminated') {
        status = 'Team A Eliminated';
      } else if (pair.pairStatus === 'team_b_eliminated') {
        status = 'Team B Eliminated';
      } else {
        status = pair.pairStatus;
      }

      return {
        rank: index + 1,
        pairId: pair.pairId,
        averagePairHealth: pair.averagePairHealth,
        teamAHealth: pair.teamAHealth,
        teamBHealth: pair.teamBHealth,
        teamASessionId: pair.teamASessionId,
        teamBSessionId: pair.teamBSessionId,
        status,
        gameEndTimestamp: pair.gameEndTimestamp,
      };
    });
  }

  static getGameStatistics(gameState: GameState): {
    totalWaste: number;
    pendingWaste: number;
    completedProjects: number;
    totalTransactions: number;
    averageCO2PerTurn: number;
  } {
    const totalWaste = gameState.wasteBatches.reduce(
      (sum, batch) => sum + batch.mass,
      0
    );
    const pendingWaste = gameState.wasteBatches
      .filter(batch => batch.status === 'PENDING')
      .reduce((sum, batch) => sum + batch.mass, 0);
    const completedProjects = gameState.cityProjects.filter(
      project => project.completed
    ).length;
    const totalTransactions = gameState.transactions.length;
    const averageCO2PerTurn =
      gameState.currentTurn > 1
        ? gameState.totalCO2 / (gameState.currentTurn - 1)
        : 0;

    return {
      totalWaste,
      pendingWaste,
      completedProjects,
      totalTransactions,
      averageCO2PerTurn,
    };
  }

  static validateGameState(gameState: GameState): {
    isValid: boolean;
    errors: string[];
  } {
    const errors: string[] = [];

    if (gameState.budget < 0) {
      errors.push('Budget cannot be negative');
    }
    if (gameState.cityHealth < 0 || gameState.cityHealth > 100) {
      errors.push('City health must be between 0% and 100%');
    }
    if (gameState.totalCO2 < 0) {
      errors.push('Total CO2 cannot be negative');
    }
    if (gameState.wasteInventory < 0) {
      errors.push('Waste inventory cannot be negative');
    }
    if (gameState.wasteInventory > gameState.maxCapacity) {
      errors.push('Waste inventory exceeds maximum capacity');
    }
    if (
      gameState.currentTurn < 1 ||
      gameState.currentTurn > this.constants.GAME_DURATION_DAYS + 1
    ) {
      errors.push('Current turn is out of valid range');
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  static getTurnSummary(gameState: GameState): {
    turn: number;
    budget: number;
    health: number;
    co2: number;
    wasteInventory: number;
    pendingBatches: number;
    completedProjects: number;
    status: string;
  } {
    const pendingBatches = gameState.wasteBatches.filter(
      batch => batch.status === 'PENDING'
    ).length;
    const completedProjects = gameState.cityProjects.filter(
      project => project.completed
    ).length;

    return {
      turn: gameState.currentTurn,
      budget: gameState.budget,
      health: gameState.cityHealth,
      co2: gameState.totalCO2,
      wasteInventory: gameState.wasteInventory,
      pendingBatches,
      completedProjects,
      status: gameState.gameStatus,
    };
  }

  static getRealtimeUpdatePayload(gameState: GameState): any {
    const pendingBatch = gameState.wasteBatches.find(
      b => b.status === 'PENDING'
    );
    const wastePending = pendingBatch
      ? {
          batch_id: pendingBatch.id,
          mass: pendingBatch.mass,
          deadline: new Date(pendingBatch.collectionDeadline)
            .toTimeString()
            .slice(0, 8),
          status:
            pendingBatch.collectionDeadline > Date.now()
              ? 'pending'
              : 'overdue',
        }
      : null;

    const availableMaterial = gameState.materialInventory.find(m => !m.listed);
    const materialAvailable = availableMaterial
      ? {
          item_id: availableMaterial.id,
          type: availableMaterial.type,
          grade: availableMaterial.quality,
          mass: availableMaterial.mass,
        }
      : null;

    return {
      sessionId: gameState.sessionId,
      currentBudget: parseFloat(gameState.budget.toFixed(2)),
      totalCO2: parseFloat(gameState.totalCO2.toFixed(1)),
      wastePending,
      materialAvailable,
    };
  }

  static async emitFullGameState(
    sessionId: string,
    gameState: GameState,
    actionType?: string,
    actionDetails?: any
  ): Promise<void> {
    let countdownTimeRemaining: number | null = null;
    if (
      gameState.gameOverCountdown &&
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

    let pairData = null;
    if (gameState.pairId && gameState.partnerSessionId) {
      try {
        const partnerGameState = await this.getGameState(
          gameState.partnerSessionId
        );
        pairData = {
          pairId: gameState.pairId,
          partnerSessionId: gameState.partnerSessionId,
          teamRole: gameState.teamRole,
          pairStatus: gameState.pairStatus,
          partnerHealth: partnerGameState ? partnerGameState.cityHealth : null,
          partnerBudget: partnerGameState ? partnerGameState.budget : null,
          partnerCO2: partnerGameState ? partnerGameState.totalCO2 : null,
          partnerGameStatus: partnerGameState
            ? partnerGameState.gameStatus
            : null,
        };
      } catch (error) {
        logger.error('Error fetching partner data for gamestate:', error);
        pairData = {
          pairId: gameState.pairId,
          partnerSessionId: gameState.partnerSessionId,
          teamRole: gameState.teamRole,
          pairStatus: gameState.pairStatus,
          partnerHealth: null,
          partnerBudget: null,
          partnerCO2: null,
          partnerGameStatus: null,
        };
      }
    }

    const payload = {
      gameState,
      playerRoles: gameState.players,
      playerNames: gameState.playerNames,
      countdownTimeRemaining,
      turnSummary: this.getTurnSummary(gameState),
      statistics: this.getGameStatistics(gameState),
      realtimeUpdate: this.getRealtimeUpdatePayload(gameState),
      pairData,
      actionType: actionType || null,
      actionDetails: actionDetails || null,
    };

    WebSocketService.broadcastFullGameState(sessionId, payload);
  }

  static updateGameTime(gameState: GameState): void {
    const now = Date.now();
    const elapsedMs = now - gameState.gameStartTime;
    gameState.minutesElapsed = Math.floor(elapsedMs / 60000);

    const gameDaysElapsed =
      (gameState.minutesElapsed /
        this.constants.REAL_TIME_GAME_DURATION_MINUTES) *
      this.constants.GAME_DURATION_DAYS;
    gameState.currentGameDay = Math.min(
      this.constants.GAME_DURATION_DAYS,
      Math.floor(gameDaysElapsed) + 1
    );
    const totalGameHours = gameDaysElapsed * 24;
    gameState.currentGameHour = Math.floor(totalGameHours % 24);
  }

  static async performSystemCheck(sessionId: string): Promise<GameState> {
    const gameState = await this.getGameState(sessionId);
    if (!gameState || gameState.gameStatus !== 'active') {
      throw new Error('Game session not active');
    }

    const now = Date.now();
    const previousGameDay = gameState.currentGameDay;
    this.updateGameTime(gameState);

    // NEW: Check and complete all active transports
    await this.checkAndCompleteTransports(sessionId);

    if (gameState.currentGameDay > previousGameDay) {
      gameState.budget -= this.constants.OPERATING_COST;
      gameState.activityLog.unshift(
        `[Day ${gameState.currentGameDay}] Operating cost: -$${this.constants.OPERATING_COST}`
      );
      WebSocketService.broadcastSystemMessage(
        sessionId,
        `Day ${gameState.currentGameDay} operating cost: -$${this.constants.OPERATING_COST}`,
        'info'
      );
    }

    this.cleanupStaleLocks(gameState);
    await this.updateGameState(sessionId, gameState);
    await BrokerService.resolveExpiredAuctions(sessionId);

    const freshState = await this.getGameState(sessionId);
    if (freshState) {
      gameState.marketplaceListing = freshState.marketplaceListing;
      gameState.activeBids = freshState.activeBids || {};
    }

    gameState.wasteBatches.forEach(batch => {
      if (
        batch.lockedAt &&
        batch.status === 'PENDING' &&
        now - batch.lockedAt > 10000
      ) {
        this.releaseLock(gameState, batch.id);
        batch.lockedAt = null;
        gameState.activityLog.unshift(
          `[System] Lock timeout: Batch ${batch.id} lock removed after 10 seconds`
        );
      }
    });

    const timeSinceLastSpawn = now - gameState.lastWasteSpawnTime;
    if (
      timeSinceLastSpawn >=
      this.constants.WASTE_SPAWN_INTERVAL_MINUTES * 60 * 1000
    ) {
      const maxPossibleBatchMass = 25;
      if (
        gameState.wasteInventory + maxPossibleBatchMass >
        gameState.maxCapacity
      ) {
        gameState.activityLog.unshift(
          `[System] Waste spawn skipped: Capacity limit reached`
        );
        WebSocketService.broadcastSystemMessage(
          sessionId,
          `Waste spawn skipped: Capacity limit reached`,
          'warning'
        );
      } else {
        this.spawnWaste(gameState);
        this.recalculateCoreMetrics(gameState);
        WebSocketService.broadcastSystemMessage(
          sessionId,
          `New waste batch generated`,
          'info'
        );
      }
    }

    let penaltyApplied = false;
    gameState.wasteBatches.forEach(batch => {
      if (typeof batch.penalized !== 'boolean') batch.penalized = false;
      if (
        batch.status === 'PENDING' &&
        now > batch.collectionDeadline &&
        !batch.penalized
      ) {
        gameState.cityHealth -= this.constants.OVERDUE_BATCH_HEALTH_PENALTY;
        gameState.activityLog.unshift(
          `[System] Overdue waste batch ${batch.id}: Health -${this.constants.OVERDUE_BATCH_HEALTH_PENALTY}%`
        );
        batch.penalized = true;
        penaltyApplied = true;
      }
    });

    gameState.mrfQueue.forEach(queue => {
      if (now - queue.arrivalTime > 5 * 60 * 1000 && !queue.penaltyApplied) {
        const batch = gameState.wasteBatches.find(b => b.id === queue.batchId);
        if (batch) {
          const { refuseMass } = CalculationService.calculateProcessingOutput(
            batch,
            gameState.constants
          );
          const penalty =
            refuseMass * gameState.constants.REFUSE_HEALTH_PENALTY_PER_TON;
          gameState.cityHealth -= penalty;
          gameState.activityLog.unshift(
            `[MRF] Unprocessed waste penalty for queue ${queue.id}: Health -${penalty.toFixed(1)}%`
          );
          queue.penaltyApplied = true;
          penaltyApplied = true;
        }
      }
    });

    if (penaltyApplied) {
      WebSocketService.broadcastSystemMessage(
        sessionId,
        `Health penalty applied for overdue waste`,
        'warning'
      );
    }

    const completedProjects = gameState.cityProjects.filter(
      project => project.completed
    ).length;
    const healthChange = CalculationService.calculateHealthChange(
      gameState.wasteBatches,
      gameState.totalCO2,
      completedProjects,
      gameState.constants
    );

    const newHealth = Math.max(
      0,
      Math.min(100, gameState.cityHealth + healthChange.healthChange)
    );

    if (Math.abs(gameState.cityHealth - newHealth) > 0.01) {
      const actualChange = newHealth - gameState.cityHealth;
      gameState.cityHealth = newHealth;

      let healthMessage = `[System] Health updated: ${actualChange > 0 ? '+' : ''}${actualChange.toFixed(1)}% (now ${newHealth.toFixed(1)}%)`;
      if (healthChange.wastePenalty > 0) {
        healthMessage += ` | Waste penalty: -${healthChange.wastePenalty.toFixed(1)}% (${healthChange.uncollectedWaste.toFixed(1)}t uncollected)`;
      }
      if (healthChange.co2Penalty > 0) {
        healthMessage += ` | CO2 penalty: -${healthChange.co2Penalty.toFixed(1)}% (${gameState.totalCO2.toFixed(1)}t total)`;
      }
      if (healthChange.projectBonus > 0) {
        healthMessage += ` | Project bonus: +${healthChange.projectBonus.toFixed(1)}% (${completedProjects} projects)`;
      }

      gameState.activityLog.unshift(healthMessage);
      await this.updatePairScore(gameState);
      WebSocketService.broadcastSystemMessage(
        sessionId,
        `City health updated to ${newHealth.toFixed(1)}%`,
        actualChange < 0 ? 'warning' : 'info'
      );
    }

    await this.checkCountdownConditions(gameState, sessionId);

    const minutesRemaining =
      this.constants.REAL_TIME_GAME_DURATION_MINUTES - gameState.minutesElapsed;
    const countdownStartMinutes =
      this.constants.COUNTDOWN_DURATION_SECONDS / 60;

    if (
      minutesRemaining <= countdownStartMinutes &&
      minutesRemaining > 0 &&
      !gameState.gameOverCountdown.active
    ) {
      gameState.gameOverCountdown = {
        active: true,
        startTime: now - (countdownStartMinutes - minutesRemaining) * 60 * 1000,
        reason: 'time',
      };
      gameState.activityLog.unshift(
        `[WARNING] Final countdown! Game ends in ${Math.ceil(minutesRemaining)} minutes!`
      );
      WebSocketService.broadcastSystemMessage(
        sessionId,
        `Final countdown: ${Math.ceil(minutesRemaining)} minutes remaining!`,
        'warning'
      );
      await this.emitFullGameState(sessionId, gameState, 'countdown-started', {
        reason: 'time',
      });
    }

    if (
      gameState.minutesElapsed >= this.constants.REAL_TIME_GAME_DURATION_MINUTES
    ) {
      let averagePairHealth = 0;
      let teamAHealth = 0;
      let teamBHealth = 0;
      let teamABudget = 0;
      let teamBBudget = 0;
      let teamACO2 = 0;
      let teamBCO2 = 0;

      if (gameState.teamRole === 'Team A') {
        teamAHealth = gameState.cityHealth;
        teamABudget = gameState.budget;
        teamACO2 = gameState.totalCO2;
      } else if (gameState.teamRole === 'Team B') {
        teamBHealth = gameState.cityHealth;
        teamBBudget = gameState.budget;
        teamBCO2 = gameState.totalCO2;
      }

      if (gameState.partnerSessionId) {
        try {
          const partnerGameState = await this.getGameState(
            gameState.partnerSessionId
          );
          if (partnerGameState) {
            if (partnerGameState.teamRole === 'Team A') {
              teamAHealth = partnerGameState.cityHealth;
              teamABudget = partnerGameState.budget;
              teamACO2 = partnerGameState.totalCO2;
            } else if (partnerGameState.teamRole === 'Team B') {
              teamBHealth = partnerGameState.cityHealth;
              teamBBudget = partnerGameState.budget;
              teamBCO2 = partnerGameState.totalCO2;
            }

            const pairStatus =
              gameState.pairStatus || partnerGameState.pairStatus;

            if (pairStatus === 'active') {
              averagePairHealth = (teamAHealth + teamBHealth) / 2;
            } else if (pairStatus === 'team_a_eliminated') {
              averagePairHealth = teamBHealth;
            } else if (pairStatus === 'team_b_eliminated') {
              averagePairHealth = teamAHealth;
            } else {
              averagePairHealth = 0;
            }
          } else {
            averagePairHealth = gameState.cityHealth;
          }
        } catch (error) {
          logger.error('Error fetching partner for win condition:', error);
          averagePairHealth = gameState.cityHealth;
        }
      } else {
        averagePairHealth = gameState.cityHealth;
      }

      if (gameState.pairId) {
        try {
          let teamAGameStatus = 'complete';
          let teamBGameStatus = 'complete';
          let teamAPairStatus = 'active';
          let teamBPairStatus = 'active';

          if (gameState.partnerSessionId) {
            const partnerGameState = await this.getGameState(
              gameState.partnerSessionId
            );
            if (partnerGameState) {
              if (gameState.teamRole === 'Team A') {
                teamAGameStatus = gameState.gameStatus;
                teamBGameStatus = partnerGameState.gameStatus;
                teamAPairStatus =
                  gameState.pairStatus === 'team_a_eliminated'
                    ? 'eliminated'
                    : 'active';
                teamBPairStatus =
                  gameState.pairStatus === 'team_b_eliminated'
                    ? 'eliminated'
                    : 'active';
              } else {
                teamAGameStatus = partnerGameState.gameStatus;
                teamBGameStatus = gameState.gameStatus;
                teamAPairStatus =
                  gameState.pairStatus === 'team_a_eliminated'
                    ? 'eliminated'
                    : 'active';
                teamBPairStatus =
                  gameState.pairStatus === 'team_b_eliminated'
                    ? 'eliminated'
                    : 'active';
              }
            }
          } else {
            teamAGameStatus = gameState.gameStatus;
            teamBGameStatus = gameState.gameStatus;
            teamAPairStatus = 'active';
            teamBPairStatus = 'active';
          }

          await PairScore.findOneAndUpdate(
            { pairId: gameState.pairId },
            {
              averagePairHealth: parseFloat(averagePairHealth.toFixed(1)),
              teamAHealth: parseFloat(teamAHealth.toFixed(1)),
              teamBHealth: parseFloat(teamBHealth.toFixed(1)),
              teamABudget: parseFloat(teamABudget.toFixed(0)),
              teamBBudget: parseFloat(teamBBudget.toFixed(0)),
              teamACO2: parseFloat(teamACO2.toFixed(1)),
              teamBCO2: parseFloat(teamBCO2.toFixed(1)),
              teamAGameStatus,
              teamBGameStatus,
              teamAPairStatus,
              teamBPairStatus,
              gameEndTimestamp: new Date(now),
              pairStatus: gameState.pairStatus || 'completed',
            },
            { new: true, upsert: true }
          );
          logger.info(`Updated pair score for pair ${gameState.pairId}`);
        } catch (error) {
          logger.error('Error updating pair score:', error);
        }
      }

      if (averagePairHealth >= gameState.constants.WINNING_HEALTH) {
        gameState.gameStatus = 'won';
      } else {
        gameState.gameStatus = 'lost';
      }
      gameState.pairStatus = 'completed';

      await Lobby.findOneAndUpdate({ sessionId }, { status: 'completed' });
      this.updateGameStatusFromPairStatus(gameState);

      gameState.activityLog.unshift(
        `[GAME COMPLETE] Pair average health: ${averagePairHealth.toFixed(1)}%`
      );

      WebSocketService.broadcastSystemMessage(
        sessionId,
        `Game Complete! Your Pair's Final Score: ${averagePairHealth.toFixed(1)}%`,
        'info'
      );

      WebSocketService.emitToGameRoom(sessionId, 'game-complete', {
        pairAverageHealth: averagePairHealth,
        teamAHealth,
        teamBHealth,
        teamABudget: parseFloat(teamABudget.toFixed(0)),
        teamBBudget: parseFloat(teamBBudget.toFixed(0)),
        teamACO2: parseFloat(teamACO2.toFixed(1)),
        teamBCO2: parseFloat(teamBCO2.toFixed(1)),
      });

      if (gameState.partnerSessionId) {
        WebSocketService.emitToGameRoom(
          gameState.partnerSessionId as string,
          'game-complete',
          {
            pairAverageHealth: averagePairHealth,
            teamAHealth,
            teamBHealth,
            teamABudget: parseFloat(teamABudget.toFixed(0)),
            teamBBudget: parseFloat(teamBBudget.toFixed(0)),
            teamACO2: parseFloat(teamACO2.toFixed(1)),
            teamBCO2: parseFloat(teamBCO2.toFixed(1)),
          }
        );
      }

      try {
        await this.emitFullGameState(sessionId, gameState, 'game-over', {});
        if (gameState.partnerSessionId) {
          const partnerGameState = await this.getGameState(
            gameState.partnerSessionId
          );
          if (partnerGameState) {
            await this.emitFullGameState(
              gameState.partnerSessionId,
              partnerGameState,
              'game-over',
              {}
            );
          }
        }
      } catch (err) {}
    }

    if (gameState.partnerSessionId) {
      try {
        const partnerGameState = await this.getGameState(
          gameState.partnerSessionId
        );
        let partnerMessage: string;

        if (!partnerGameState || partnerGameState.gameStatus !== 'active') {
          partnerMessage = `Team ${gameState.partnerSessionId} Eliminated`;
        } else {
          partnerMessage = `Partner Team Status: Health: ${partnerGameState.cityHealth.toFixed(1)}% | Budget: $${partnerGameState.budget.toFixed(0)} | CO2: ${partnerGameState.totalCO2.toFixed(1)} tons`;
        }

        WebSocketService.broadcastSystemMessage(sessionId, partnerMessage, 'info');
      } catch (error) {
        logger.error('Error fetching partner team status:', error);
      }
    }

    gameState.lastAutoSaveTime = now;
    await this.updateGameState(sessionId, gameState);

    WebSocketService.broadcastGameStateUpdate(
      sessionId,
      gameState,
      'system-check-update',
      {
        cityHealth: gameState.cityHealth,
        totalCO2: gameState.totalCO2,
        wasteInventory: gameState.wasteInventory,
        activeSessions: gameState.wasteBatches.length,
      }
    );

    try {
      await this.emitFullGameState(
        sessionId,
        gameState,
        'system-check-update',
        {
          cityHealth: gameState.cityHealth,
          totalCO2: gameState.totalCO2,
          wasteInventory: gameState.wasteInventory,
        }
      );
    } catch (err) {}

    return gameState;
  }

  static updateGameStatusFromPairStatus(gameState: GameState): void {
    if (gameState.pairStatus === 'completed') {
      gameState.gameStatus = 'complete';
    } else if (
      (gameState.teamRole === 'Team A' &&
        gameState.pairStatus === 'team_a_eliminated') ||
      (gameState.teamRole === 'Team B' &&
        gameState.pairStatus === 'team_b_eliminated')
    ) {
      gameState.gameStatus = 'lost';
    }
  }

  static async checkCountdownConditions(
    gameState: GameState,
    sessionId?: string
  ): Promise<void> {
    if (!gameState.gameOverCountdown) {
      gameState.gameOverCountdown = {
        active: false,
        startTime: null,
        reason: null,
      };
    }

    const now = Date.now();

    if (!gameState.gameOverCountdown.active) {
      if (gameState.cityHealth <= 0) {
        gameState.gameOverCountdown = {
          active: true,
          startTime: now,
          reason: 'health',
        };
        gameState.activityLog.unshift(
          '[WARNING] City health at 0%! Game Over in 3 minutes!'
        );
        if (sessionId) {
          await this.emitFullGameState(
            sessionId,
            gameState,
            'countdown-started',
            { reason: 'health' }
          );
        }
      } else if (gameState.budget <= 0) {
        gameState.gameOverCountdown = {
          active: true,
          startTime: now,
          reason: 'budget',
        };
        gameState.activityLog.unshift(
          '[WARNING] Budget depleted! Game Over in 3 minutes!'
        );
        if (sessionId) {
          await this.emitFullGameState(
            sessionId,
            gameState,
            'countdown-started',
            { reason: 'budget' }
          );
        }
      }
    }

    if (gameState.gameOverCountdown.active) {
      const timeRemaining =
        this.constants.COUNTDOWN_DURATION_SECONDS -
        (now - gameState.gameOverCountdown.startTime!) / 1000;

      if (timeRemaining <= 0 && gameState.gameOverCountdown.reason !== 'time') {
        gameState.gameStatus = 'lost';
        gameState.activityLog.unshift(
          '[GAME OVER] Countdown expired. City has fallen.'
        );

        if (gameState.teamRole === 'Team A') {
          gameState.pairStatus = 'team_a_eliminated';
        } else if (gameState.teamRole === 'Team B') {
          gameState.pairStatus = 'team_b_eliminated';
        }

        this.updateGameStatusFromPairStatus(gameState);
        await this.updatePairScore(gameState);

        if (sessionId) {
          await Lobby.findOneAndUpdate({ sessionId }, { status: 'completed' });
        }

        if (gameState.partnerSessionId) {
          WebSocketService.emitToGameRoom(
            gameState.partnerSessionId as string,
            'partner-eliminated',
            {
              partnerSessionId: sessionId,
              reason:
                gameState.gameOverCountdown.reason === 'health'
                  ? 'health_depleted'
                  : 'budget_depleted',
            }
          );
        }

        if (sessionId) {
          await this.updateGameState(sessionId, gameState);
          await this.emitFullGameState(
            sessionId,
            gameState,
            'countdown-expired',
            { reason: gameState.gameOverCountdown.reason }
          );
        }

        return;
      }

      if (
        gameState.gameOverCountdown.reason === 'health' &&
        gameState.cityHealth >
          this.constants.COUNTDOWN_RECOVERY_HEALTH_THRESHOLD
      ) {
        const recoveryReason = gameState.gameOverCountdown.reason;
        gameState.gameOverCountdown = {
          active: false,
          startTime: null,
          reason: null,
        };
        gameState.activityLog.unshift('[RECOVERY] Crisis averted! Health restored.');
        WebSocketService.broadcastSystemMessage(
          sessionId!,
          'Crisis averted! Health restored.',
          'info'
        );
        await this.emitFullGameState(
          sessionId!,
          gameState,
          'countdown-cancelled',
          { reason: recoveryReason }
        );
      } else if (
        gameState.gameOverCountdown.reason === 'budget' &&
        gameState.budget > this.constants.COUNTDOWN_RECOVERY_BUDGET_THRESHOLD
      ) {
        const recoveryReason = gameState.gameOverCountdown.reason;
        gameState.gameOverCountdown = {
          active: false,
          startTime: null,
          reason: null,
        };
        gameState.activityLog.unshift('[RECOVERY] Financial crisis resolved!');
        WebSocketService.broadcastSystemMessage(
          sessionId!,
          'Financial crisis resolved!',
          'info'
        );
        await this.emitFullGameState(
          sessionId!,
          gameState,
          'countdown-cancelled',
          { reason: recoveryReason }
        );
      }
    }
  }

  static acquireLock(
    gameState: GameState,
    resourceId: string,
    playerId: string,
    type: 'batch' | 'queue' | 'material'
  ): boolean {
    if (!gameState.activeLocks) {
      gameState.activeLocks = {};
    }

    const now = Date.now();
    const existingLock = gameState.activeLocks[resourceId];

    if (existingLock && now - existingLock.timestamp < 30000) {
      return false;
    }

    gameState.activeLocks[resourceId] = {
      playerId,
      timestamp: now,
      type,
    };
    return true;
  }

  static releaseLock(gameState: GameState, resourceId: string): void {
    if (!gameState.activeLocks) {
      gameState.activeLocks = {};
    }
    delete gameState.activeLocks[resourceId];
  }

  static cleanupStaleLocks(gameState: GameState): void {
    if (!gameState.activeLocks) {
      gameState.activeLocks = {};
    }

    const now = Date.now();
    Object.keys(gameState.activeLocks).forEach(resourceId => {
      if (now - gameState.activeLocks[resourceId].timestamp > 30000) {
        delete gameState.activeLocks[resourceId];
      }
    });
  }

  private static async updatePairScore(gameState: GameState): Promise<void> {
    if (!gameState.pairId) return;

    try {
      let teamAHealth = 0;
      let teamBHealth = 0;
      let teamABudget = 0;
      let teamBBudget = 0;
      let teamACO2 = 0;
      let teamBCO2 = 0;
      let averagePairHealth = 0;
      let pairStatus = gameState.pairStatus || 'active';

      if (gameState.teamRole === 'Team A') {
        teamAHealth = gameState.cityHealth;
        teamABudget = gameState.budget;
        teamACO2 = gameState.totalCO2;
      } else if (gameState.teamRole === 'Team B') {
        teamBHealth = gameState.cityHealth;
        teamBBudget = gameState.budget;
        teamBCO2 = gameState.totalCO2;
      }

      if (gameState.partnerSessionId) {
        const partnerGameState = await this.getGameState(
          gameState.partnerSessionId
        );
        if (partnerGameState) {
          if (partnerGameState.teamRole === 'Team A') {
            teamAHealth = partnerGameState.cityHealth;
            teamABudget = partnerGameState.budget;
            teamACO2 = partnerGameState.totalCO2;
          } else if (partnerGameState.teamRole === 'Team B') {
            teamBHealth = partnerGameState.cityHealth;
            teamBBudget = partnerGameState.budget;
            teamBCO2 = partnerGameState.totalCO2;
          }

          if (
            gameState.pairStatus === 'active' &&
            partnerGameState.pairStatus === 'active'
          ) {
            pairStatus = 'active';
            averagePairHealth = (teamAHealth + teamBHealth) / 2;
          } else if (
            gameState.pairStatus === 'team_a_eliminated' ||
            partnerGameState.pairStatus === 'team_a_eliminated'
          ) {
            pairStatus = 'team_a_eliminated';
            averagePairHealth = teamBHealth;
          } else if (
            gameState.pairStatus === 'team_b_eliminated' ||
            partnerGameState.pairStatus === 'team_b_eliminated'
          ) {
            pairStatus = 'team_b_eliminated';
            averagePairHealth = teamAHealth;
          } else {
            pairStatus = 'completed';
            averagePairHealth = 0;
          }
        } else {
          averagePairHealth = gameState.cityHealth;
        }
      } else {
        averagePairHealth = gameState.cityHealth;
      }

      await PairScore.findOneAndUpdate(
        { pairId: gameState.pairId },
        {
          averagePairHealth: parseFloat(averagePairHealth.toFixed(1)),
          teamAHealth: parseFloat(teamAHealth.toFixed(1)),
          teamBHealth: parseFloat(teamBHealth.toFixed(1)),
          teamABudget: parseFloat(teamABudget.toFixed(0)),
          teamBBudget: parseFloat(teamBBudget.toFixed(0)),
          teamACO2: parseFloat(teamACO2.toFixed(1)),
          teamBCO2: parseFloat(teamBCO2.toFixed(1)),
          pairStatus,
        },
        { new: true }
      );
    } catch (error) {
      logger.error('Error updating pair score:', error);
    }
  }

  static recalculateCoreMetrics(gameState: GameState): void {
    // Update waste inventory
    gameState.wasteInventory = gameState.wasteBatches
      .filter(batch => batch.status === 'PENDING')
      .reduce((total, batch) => total + batch.mass, 0);

    // Recalculate total CO2 from transport and landfill
    const transportCO2 = CalculationService.calculateTotalCO2(
      gameState.totalTransportTrips || 0,
      gameState.totalLandfillTons || 0,
      gameState.constants
    );

    // Add CO2 from project contributions (materials used in projects)
    let projectCO2 = 0;
    const materialProps = gameState.constants.MATERIAL_PROPERTIES;
    
    gameState.cityProjects.forEach(project => {
      if (project.addedMaterials) {
        Object.entries(project.addedMaterials).forEach(([materialType, amount]) => {
          const props = materialProps[materialType as keyof typeof materialProps];
          if (props && amount) {
            projectCO2 += amount * (props.co2EmissionPerTon || 0);
          }
        });
      }
    });

    gameState.totalCO2 = transportCO2 + projectCO2;

    // Recalculate health
    const completedProjects = gameState.cityProjects.filter(
      project => project.completed
    ).length;
    const healthChange = CalculationService.calculateHealthChange(
      gameState.wasteBatches,
      gameState.totalCO2,
      completedProjects,
      gameState.constants
    );

    const newHealth = Math.max(
      0,
      Math.min(100, gameState.cityHealth + healthChange.healthChange)
    );

    if (Math.abs(gameState.cityHealth - newHealth) > 0.01) {
      const healthDiff = newHealth - gameState.cityHealth;
      gameState.cityHealth = newHealth;

      let healthMessage = `[System] Health recalculated: ${healthDiff > 0 ? '+' : ''}${healthDiff.toFixed(1)}% (now ${newHealth.toFixed(1)}%)`;
      if (healthChange.wastePenalty > 0) {
        healthMessage += ` | Waste: -${healthChange.wastePenalty.toFixed(1)}% (${healthChange.uncollectedWaste.toFixed(1)}t)`;
      }
      if (healthChange.co2Penalty > 0) {
        healthMessage += ` | CO2: -${healthChange.co2Penalty.toFixed(1)}% (${gameState.totalCO2.toFixed(1)}t)`;
      }
      if (healthChange.projectBonus > 0) {
        healthMessage += ` | Projects: +${healthChange.projectBonus.toFixed(1)}% (${completedProjects})`;
      }

      gameState.activityLog.unshift(healthMessage);
    }

    this.updateGameTime(gameState);
    this.updateGameStatusFromPairStatus(gameState);
  }

  static async collectWaste(
    sessionId: string,
    batchId: string,
    playerId: string
  ): Promise<GameState> {
    const gameState = await this.getGameState(sessionId);
    if (!gameState) {
      throw new Error('Game session not found');
    }

    if (!gameState.activeLocks) gameState.activeLocks = {};
    if (!gameState.gameOverCountdown) {
      gameState.gameOverCountdown = {
        active: false,
        startTime: null,
        reason: null,
      };
    }
    if (typeof gameState.totalTransportTrips !== 'number') {
      gameState.totalTransportTrips = 0;
    }
    if (typeof gameState.totalLandfillTons !== 'number') {
      gameState.totalLandfillTons = 0;
    }

    if (gameState.gameStatus !== 'active') {
      throw new Error('Game is not active');
    }

    if (gameState.players.municipality !== playerId.toString()) {
      throw new Error('Only municipality player can collect waste');
    }

    const batch = gameState.wasteBatches.find(b => b.id === batchId);
    if (!batch) {
      throw new Error('Waste batch not found');
    }

    if (batch.status !== 'PENDING') {
      throw new Error('Waste batch is not available for collection');
    }

    if (!this.acquireLock(gameState, batchId, playerId, 'batch')) {
      throw new Error('Another player is working on this. Try a different batch.');
    }

    batch.lockedAt = Date.now();

    try {
      const transportCost = CalculationService.calculateTransportCost(
        batch,
        gameState.constants
      );

      if (gameState.budget < transportCost) {
        throw new Error('Insufficient budget for waste collection');
      }

      gameState.budget -= transportCost;

      const transportCO2 = CalculationService.calculateCO2FromTransport(
        1,
        gameState.constants
      );
      gameState.totalCO2 += transportCO2;
      gameState.totalTransportTrips += 1;
      batch.status = 'DELIVERED';

      gameState.mrfQueue.push({
        id: `q-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        batchId: batch.id,
        playerId: playerId,
        arrivalTime: Date.now(),
        delivered: false,
        lockToken: null,
      });

      gameState.activityLog.unshift(
        `[Municipality] Collected ${batch.mass.toFixed(1)} tons ${batch.origin} waste. Cost: $${transportCost.toFixed(2)}, CO2: ${transportCO2.toFixed(1)} tons`
      );

      this.recalculateCoreMetrics(gameState);
      await this.checkCountdownConditions(gameState, sessionId);
      await this.updateGameState(sessionId, gameState);

      WebSocketService.broadcastGameStateUpdate(
        sessionId,
        gameState,
        'waste-collected',
        {
          batchId: batch.id,
          batchMass: batch.mass,
          batchOrigin: batch.origin,
          transportCost: parseFloat(transportCost.toFixed(2)),
          transportCO2: parseFloat(transportCO2.toFixed(1)),
          newBudget: parseFloat(gameState.budget.toFixed(2)),
          newTotalCO2: parseFloat(gameState.totalCO2.toFixed(1)),
        }
      );

      try {
        await this.emitFullGameState(sessionId, gameState, 'waste-collected', {
          batchId: batch.id,
          batchMass: batch.mass,
          batchOrigin: batch.origin,
          transportCost: parseFloat(transportCost.toFixed(2)),
          transportCO2: parseFloat(transportCO2.toFixed(1)),
          newBudget: parseFloat(gameState.budget.toFixed(2)),
          newTotalCO2: parseFloat(gameState.totalCO2.toFixed(1)),
        });
      } catch (err) {}

      return gameState;
    } finally {
      batch.lockedAt = null;
      this.releaseLock(gameState, batchId);
    }
  }
}