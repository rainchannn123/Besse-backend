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
        // Include pairing fields from lobby (will be populated if created through pairing system)
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
          paper: Math.floor(Math.random() * 56) + 10, // 10-65 tons
          plastic: Math.floor(Math.random() * 56) + 10,
          metal: Math.floor(Math.random() * 56) + 10,
          glass: Math.floor(Math.random() * 56) + 10,
          wood: Math.floor(Math.random() * 56) + 10,
        },
        activeBids: {},
        surrenderVotes: [],
      };

      // Spawn initial waste batch immediately (Day 1 - Hour 0)
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

      // Rollback lobby status and clear any pairing fields if game creation failed
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
          `[GameService] Rolled back lobby status to 'ready' and cleared pairing fields for session: ${sessionId}`
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

  // Helper method to generate initial projects as per manual
  private static generateInitialProjects(): CityProject[] {
    return [
      {
        id: 'p-1',
        name: 'Community Park',
        requiredMaterials: { paper: 10, wood: 5 },
        progress: 0,
        completed: false,
        // Editable reward values
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
        // Editable reward values
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
        // Editable reward values
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
        // Editable reward values
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
        // Editable reward values
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

  /**
   * Get game states scoped to a player's current pair (own session + partner).
   * When sessionId is provided, uses it directly to avoid picking stale sessions.
   * This prevents stale/old sessions from leaking into the current game.
   */
  static async getPairedGameStates(playerId: string, sessionId?: string): Promise<GameState[]> {
    const allActive = await this.getAllActiveGameStates();
    const pid = playerId.toString();

    let playerSession;
    if (sessionId) {
      // Directly find the session by ID — avoids picking stale sessions
      playerSession = allActive.find(gs => gs.sessionId === sessionId);
    } else {
      // Fallback: search by player ID (may hit stale sessions)
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

  // Real-time waste generation - UPDATED: Deadline is REAL-TIME 10 minutes
  static spawnWaste(gameState: GameState): void {
    const origins: ('Residential' | 'Commercial' | 'Industrial')[] = [
      'Residential',
      'Commercial',
      'Industrial',
    ];
    const now = Date.now();
    const origin = origins[Math.floor(Math.random() * origins.length)];

    // EXACT Formula: Batch_Mass = Random(10, 25) tons
    const mass = Math.round((Math.random() * 15 + 10) * 10) / 10; // Generates between 10.0 and 25.0, rounded to 1 d.p.

    // Calculate composition based on origin type
    let composition: WasteBatch['composition'];

    switch (origin) {
      case 'Residential':
        composition = {
          paper: 0.5, // 50% Paper
          plastic: 0.3, // 30% Plastic
          metal: 0, // 0% Metals
          glass: 0.2, // 20% Glass
          wood: 0, // 0% Wood - explicitly set to 0
        };
        break;

      case 'Commercial':
        composition = {
          paper: 0.4, // 40% Paper
          plastic: 0.4, // 40% Plastic
          metal: 0.2, // 20% Metals
          glass: 0, // 0% Glass
          wood: 0, // 0% Wood - explicitly set to 0
        };
        break;

      case 'Industrial':
        composition = {
          paper: 0, // 0% Paper
          plastic: 0.4, // 40% Plastic
          metal: 0.3, // 30% Metals
          glass: 0, // 0% Glass
          wood: 0.3, // 30% Wood - explicitly set to 0.3
        };
        break;

      default:
        composition = {
          paper: 0.33,
          plastic: 0.33,
          metal: 0.17,
          glass: 0.17,
          wood: 0, // explicitly set to 0
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
      collectionDeadline:
        now + gameState.constants.BATCH_COLLECTION_DEADLINE_MINUTES * 60 * 1000, // REAL-TIME 10 minutes
      lockToken: null,
      lockedAt: null,
      penalized: false,
    };

    gameState.wasteBatches.push(batch);
    gameState.lastWasteSpawnTime = now;

    // Calculate actual material masses
    const paperMass = (mass * composition.paper).toFixed(1);
    const plasticMass = (mass * composition.plastic).toFixed(1);
    const metalMass = (mass * composition.metal).toFixed(1);
    const glassMass = (mass * composition.glass).toFixed(1);
    const woodMass = (mass * (composition.wood || 0)).toFixed(1); // Handle optional wood

    gameState.activityLog.unshift(
      `[Day ${gameState.currentGameDay} - Hour ${gameState.currentGameHour}] New ${origin} waste batch generated: ${mass.toFixed(
        1
      )} tons total (Paper: ${paperMass}t, Plastic: ${plasticMass}t, Metal: ${metalMass}t, Glass: ${glassMass}t, Wood: ${woodMass}t). Deadline: ${gameState.constants.BATCH_COLLECTION_DEADLINE_MINUTES} min (real-time)`
    );

    // Emit full game state for clients so frontends get the updated state on waste spawn
    try {
      // Fire-and-forget - spawnWaste is synchronous
      // Use this.emitFullGameState and swallow promise errors
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      this.emitFullGameState(gameState.sessionId, gameState, 'waste-spawned', {
        batchId: batch.id,
        batchMass: batch.mass,
        origin,
      }).catch(() => {});
    } catch (err) {
      // ignore emit errors
    }
  }

  // UPDATED: End turn with exact calculations from manual section 6
  static async endTurn(sessionId: string): Promise<GameState> {
    const gameState = await this.getGameState(sessionId);
    if (!gameState) {
      throw new Error('Game session not found');
    }

    if (gameState.gameStatus !== 'active') {
      throw new Error('Game has already ended');
    }

    // Deduct operating cost as per manual - $500 per shift
    gameState.budget -= this.constants.OPERATING_COST;

    // Calculate health changes as per manual section 6.1
    const completedProjects = gameState.cityProjects.filter(
      project => project.completed
    ).length;
    const healthChange = CalculationService.calculateHealthChange(
      gameState.wasteBatches,
      gameState.totalCO2,
      completedProjects,
      gameState.constants
    );

    // Apply health change - ensure health doesn't go below 0 or above 100
    gameState.cityHealth = Math.max(
      0,
      Math.min(100, gameState.cityHealth + healthChange.healthChange)
    );

    // Add detailed activity log for health changes
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

    // Check win/loss conditions as per manual section 6
    const gameStatus = this.checkGameStatus(gameState);

    if (gameStatus.status !== 'active') {
      gameState.gameStatus = gameStatus.status as 'won' | 'lost';
      gameState.activityLog.unshift(`[GAME OVER] ${gameStatus.message}`);

      // Update lobby status to completed
      await Lobby.findOneAndUpdate({ sessionId }, { status: 'completed' });
    } else {
      // Continue game - increment turn and spawn new waste
      gameState.currentTurn++;

      // Spawn new waste for the next turn
      this.spawnWaste(gameState);

      // Recalculate core metrics after waste spawn
      this.recalculateCoreMetrics(gameState);

      gameState.activityLog.unshift(
        `[Turn ${gameState.currentTurn}] Started. Operating cost: -$${this.constants.OPERATING_COST}`
      );
    }

    await this.updateGameState(sessionId, gameState);

    // Broadcast turn end update to all players
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

    // Also emit a full game state payload so clients receive the same structure
    // as the REST `getGameState` response (countdown, summaries, stats)
    try {
      await this.emitFullGameState(sessionId, gameState, 'turn-ended', {
        turnNumber: gameState.currentTurn,
        dayNumber: gameState.currentGameDay,
        gameStatus: gameState.gameStatus,
      });
    } catch (err) {
      // Swallow errors here to avoid breaking game flow
    }

    return gameState;
  }

  // UPDATED: Game status check as per manual section 6 - EXACT IMPLEMENTATION
  static checkGameStatus(gameState: GameState): {
    status: string;
    message: string;
  } {
    // Note: Per manual, falling to LOSING thresholds starts a 3-minute countdown.
    // The actual transition to 'lost' is handled by the countdown expiry logic
    // in `checkCountdownConditions`. Do not force immediate loss here.
    // Game ends only at 30 minutes real-time, not based on turns.

    // Continue game
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

  // NEW: Get pair details by pairId for game over page
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

  // NEW: Get global pair rankings for admin view
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

  // NEW: Helper method to get game statistics
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

  // NEW: Method to validate game state consistency
  static validateGameState(gameState: GameState): {
    isValid: boolean;
    errors: string[];
  } {
    const errors: string[] = [];

    // Check budget consistency
    if (gameState.budget < 0) {
      errors.push('Budget cannot be negative');
    }

    // Check health bounds
    if (gameState.cityHealth < 0 || gameState.cityHealth > 100) {
      errors.push('City health must be between 0% and 100%');
    }

    // Check CO2 consistency
    if (gameState.totalCO2 < 0) {
      errors.push('Total CO2 cannot be negative');
    }

    // Check waste inventory consistency
    if (gameState.wasteInventory < 0) {
      errors.push('Waste inventory cannot be negative');
    }

    if (gameState.wasteInventory > gameState.maxCapacity) {
      errors.push('Waste inventory exceeds maximum capacity');
    }

    // Check turn consistency
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

  // NEW: Method to get turn summary
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

  /**
   * Get the real-time update payload as per global looping requirements
   */
  static getRealtimeUpdatePayload(gameState: GameState): any {
    // Waste Pending: first pending batch or null
    const pendingBatch = gameState.wasteBatches.find(
      b => b.status === 'PENDING'
    );
    const wastePending = pendingBatch
      ? {
          batch_id: pendingBatch.id,
          mass: pendingBatch.mass,
          deadline: new Date(pendingBatch.collectionDeadline)
            .toTimeString()
            .slice(0, 8), // HH:MM:SS
          status:
            pendingBatch.collectionDeadline > Date.now()
              ? 'pending'
              : 'overdue',
        }
      : null;

    // Material Available: first available material or null
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

  /**
   * Prepare and emit the full game state payload to all connected clients in the session.
   * Payload mirrors the REST `getGameState` response plus helpful computed fields.
   */
  static async emitFullGameState(
    sessionId: string,
    gameState: GameState,
    actionType?: string,
    actionDetails?: any
  ): Promise<void> {
    // Compute countdown time remaining similar to controller
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

    // Get pair data if exists
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
      // Provide mapping of assigned player role ids and names for clients
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

  // NEW: Update game time based on real-world elapsed time
  static updateGameTime(gameState: GameState): void {
    const now = Date.now();
    const elapsedMs = now - gameState.gameStartTime;
    gameState.minutesElapsed = Math.floor(elapsedMs / 60000);

    // Calculate current game day and hour
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

  // NEW: System check cycle (runs every 30 seconds)
  static async performSystemCheck(sessionId: string): Promise<GameState> {
    const gameState = await this.getGameState(sessionId);
    if (!gameState || gameState.gameStatus !== 'active') {
      throw new Error('Game session not active');
    }

    const now = Date.now();
    const previousGameDay = gameState.currentGameDay;
    this.updateGameTime(gameState);

    // Deduct operating cost when entering a new game day (as per manual: $500 / shift)
    // A "shift" is interpreted as one game day
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

    // Clean up stale locks (older than 30 seconds)
    this.cleanupStaleLocks(gameState);

    // Resolve expired auctions
    await BrokerService.resolveExpiredAuctions(sessionId);

    // Timeout safety: If batch locked for more than 10 seconds and still PENDING, remove lock
    gameState.wasteBatches.forEach(batch => {
      if (
        batch.lockedAt &&
        batch.status === 'PENDING' &&
        now - batch.lockedAt > 10000
      ) {
        this.releaseLock(gameState, batch.id);
        batch.lockedAt = null;
        gameState.activityLog.unshift(
          `[System] Lock timeout: Batch ${batch.id} lock removed after 10 seconds (safety)`
        );
      }
    });

    // Check if 2 minutes elapsed since last spawn
    const timeSinceLastSpawn = now - gameState.lastWasteSpawnTime;
    if (
      timeSinceLastSpawn >=
      this.constants.WASTE_SPAWN_INTERVAL_MINUTES * 60 * 1000
    ) {
      // Check if spawning would exceed max capacity (prevent waste from exceeding 150 tons)
      const maxPossibleBatchMass = 25; // Maximum batch size is 25 tons
      if (
        gameState.wasteInventory + maxPossibleBatchMass >
        gameState.maxCapacity
      ) {
        // Skip spawning to prevent capacity overflow
        gameState.activityLog.unshift(
          `[System] Waste spawn skipped: Would exceed max capacity of ${gameState.maxCapacity} tons (current: ${gameState.wasteInventory.toFixed(1)} tons)`
        );
        WebSocketService.broadcastSystemMessage(
          sessionId,
          `Waste spawn skipped: Capacity limit reached`,
          'warning'
        );
      } else {
        this.spawnWaste(gameState);
        // Recalculate core metrics after waste spawn
        this.recalculateCoreMetrics(gameState);
        // Broadcast waste spawn to all players
        WebSocketService.broadcastSystemMessage(
          sessionId,
          `New waste batch generated: ${gameState.wasteBatches[gameState.wasteBatches.length - 1].mass.toFixed(1)} tons`,
          'info'
        );
      }
    }

    // Check for overdue batches and apply penalties
    let penaltyApplied = false;
    gameState.wasteBatches.forEach(batch => {
      // Backward compatibility
      if (typeof batch.penalized !== 'boolean') batch.penalized = false;
      if (
        batch.status === 'PENDING' &&
        now > batch.collectionDeadline &&
        !batch.penalized
      ) {
        // Manual Section 3: Apply -2% health penalty per overdue batch
        gameState.cityHealth -= this.constants.OVERDUE_BATCH_HEALTH_PENALTY;
        gameState.activityLog.unshift(
          `[System] Overdue waste batch ${batch.id}: Health -${this.constants.OVERDUE_BATCH_HEALTH_PENALTY}% (Collection deadline passed)`
        );
        batch.penalized = true;
        penaltyApplied = true;
      }
    });

    // Check for unprocessed MRF queues after 5 minutes and apply penalty
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
          // Mark penalty as applied, but keep queue for processing
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

    // RECALCULATE HEALTH based on current waste and CO2 levels as per manual section 6.1
    // Health = (100% - Penalties) + Bonuses
    const completedProjects = gameState.cityProjects.filter(
      project => project.completed
    ).length;
    const healthChange = CalculationService.calculateHealthChange(
      gameState.wasteBatches,
      gameState.totalCO2,
      completedProjects,
      gameState.constants
    );

    // Calculate new health from current health as per manual formula: New Health = (Health - Penalties) + Bonuses
    const newHealth = Math.max(
      0,
      Math.min(100, gameState.cityHealth + healthChange.healthChange)
    );

    // Only update and log if health actually changed
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

      // Update pair score in database
      await this.updatePairScore(gameState);

      // Broadcast health update to all players
      WebSocketService.broadcastSystemMessage(
        sessionId,
        `City health updated to ${newHealth.toFixed(1)}%`,
        actualChange < 0 ? 'warning' : 'info'
      );
    }

    // Check win/lose conditions (health/budget countdown)
    await this.checkCountdownConditions(gameState, sessionId);

    // Check if we should start final countdown (3 minutes before end)
    const minutesRemaining =
      this.constants.REAL_TIME_GAME_DURATION_MINUTES - gameState.minutesElapsed;
    const countdownStartMinutes =
      this.constants.COUNTDOWN_DURATION_SECONDS / 60; // 3 minutes

    // Start final countdown at 3 minutes remaining if not already active due to health/budget
    if (
      minutesRemaining <= countdownStartMinutes &&
      minutesRemaining > 0 &&
      !gameState.gameOverCountdown.active
    ) {
      gameState.gameOverCountdown = {
        active: true,
        startTime: now - (countdownStartMinutes - minutesRemaining) * 60 * 1000, // Adjust start time based on how much time has passed
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
      // Send full game state payload immediately when countdown starts
      await this.emitFullGameState(sessionId, gameState, 'countdown-started', {
        reason: 'time',
      });
    }

    // Check if game time fully expired (only end game at exactly 30 minutes)
    if (
      gameState.minutesElapsed >= this.constants.REAL_TIME_GAME_DURATION_MINUTES
    ) {
      // Step 2: Calculate Pair Mean Health Score
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

            // Query Pair Status
            const pairStatus =
              gameState.pairStatus || partnerGameState.pairStatus;

            if (pairStatus === 'active') {
              averagePairHealth = (teamAHealth + teamBHealth) / 2;
            } else if (pairStatus === 'team_a_eliminated') {
              // Team A eliminated, only Team B
              averagePairHealth = teamBHealth;
            } else if (pairStatus === 'team_b_eliminated') {
              // Team B eliminated, only Team A
              averagePairHealth = teamAHealth;
            } else {
              // Both eliminated
              averagePairHealth = 0;
            }
          } else {
            // No partner, use own health
            averagePairHealth = gameState.cityHealth;
          }
        } catch (error) {
          logger.error('Error fetching partner for win condition:', error);
          averagePairHealth = gameState.cityHealth;
        }
      } else {
        averagePairHealth = gameState.cityHealth;
      }

      // Update pair results in database
      if (gameState.pairId) {
        try {
          // Get game statuses for both teams
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
            // Single player game
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
            { new: true, upsert: true } // upsert in case it doesn't exist, but it should
          );
          logger.info(`Updated pair score for pair ${gameState.pairId}`);
        } catch (error) {
          logger.error('Error updating pair score:', error);
        }
      }

      // Set game status based on pair health
      if (averagePairHealth >= gameState.constants.WINNING_HEALTH) {
        gameState.gameStatus = 'won';
      } else {
        gameState.gameStatus = 'lost';
      }
      gameState.pairStatus = 'completed';

      // Update lobby status to completed
      await Lobby.findOneAndUpdate({ sessionId }, { status: 'completed' });

      // Ensure game status is updated based on pair status
      this.updateGameStatusFromPairStatus(gameState);

      gameState.activityLog.unshift(
        `[GAME COMPLETE] Pair average health: ${averagePairHealth.toFixed(1)}%`
      );

      // Broadcast game complete with results
      WebSocketService.broadcastSystemMessage(
        sessionId,
        `Game Complete! Your Pair's Final Score: ${averagePairHealth.toFixed(1)}%`,
        'info'
      );

      // Emit game complete event with detailed results
      WebSocketService.emitToGameRoom(sessionId, 'game-complete', {
        pairAverageHealth: averagePairHealth,
        teamAHealth,
        teamBHealth,
        teamABudget: parseFloat(teamABudget.toFixed(0)),
        teamBBudget: parseFloat(teamBBudget.toFixed(0)),
        teamACO2: parseFloat(teamACO2.toFixed(1)),
        teamBCO2: parseFloat(teamBCO2.toFixed(1)),
      });

      // Also emit to partner if exists
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

      // Trigger full state payload to indicate game over
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
      } catch (err) {
        // Swallow errors to avoid breaking game flow
      }
    }

    // Fetch and broadcast partner team status every 30 seconds
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

        WebSocketService.broadcastSystemMessage(
          sessionId,
          partnerMessage,
          'info'
        );
      } catch (error) {
        logger.error('Error fetching partner team status:', error);
        // Silently fail to avoid disrupting system check
      }
    }

    gameState.lastAutoSaveTime = now;
    await this.updateGameState(sessionId, gameState);

    // Broadcast system check updates to all players
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

    // Also send full game state payload for clients
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
    } catch (err) {
      // ignore
    }

    return gameState;
  }

  // NEW: Update game status based on pair status
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

  // NEW: Check and manage countdown conditions
  static async checkCountdownConditions(
    gameState: GameState,
    sessionId?: string
  ): Promise<void> {
    // Initialize gameOverCountdown if missing (for backward compatibility)
    if (!gameState.gameOverCountdown) {
      gameState.gameOverCountdown = {
        active: false,
        startTime: null,
        reason: null,
      };
    }

    const now = Date.now();

    // Check if countdown should start
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
        // Send full game state payload immediately when countdown starts
        if (sessionId) {
          await this.emitFullGameState(
            sessionId,
            gameState,
            'countdown-started',
            {
              reason: 'health',
            }
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
        // Send full game state payload immediately when countdown starts
        if (sessionId) {
          await this.emitFullGameState(
            sessionId,
            gameState,
            'countdown-started',
            {
              reason: 'budget',
            }
          );
        }
      }
    }

    // Check if countdown should be cancelled (recovery) or if it expired
    if (gameState.gameOverCountdown.active) {
      const timeRemaining =
        this.constants.COUNTDOWN_DURATION_SECONDS -
        (now - gameState.gameOverCountdown.startTime!) / 1000;

      // Only end game on countdown expiration if reason is health or budget, NOT time
      // Time countdown is just informational and game ends at full duration
      if (timeRemaining <= 0 && gameState.gameOverCountdown.reason !== 'time') {
        gameState.gameStatus = 'lost';
        gameState.activityLog.unshift(
          '[GAME OVER] Countdown expired. City has fallen.'
        );

        // Update pair status
        if (gameState.teamRole === 'Team A') {
          gameState.pairStatus = 'team_a_eliminated';
        } else if (gameState.teamRole === 'Team B') {
          gameState.pairStatus = 'team_b_eliminated';
        }

        // Update game status based on pair status
        this.updateGameStatusFromPairStatus(gameState);

        // Update pair score in database
        await this.updatePairScore(gameState);

        // Mark lobby as completed so players can leave after game over
        if (sessionId) {
          await Lobby.findOneAndUpdate({ sessionId }, { status: 'completed' });
        }

        // Emit partner-eliminated event when team is eliminated due to countdown
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

        // Save updated metrics and send full game state to frontend immediately
        if (sessionId) {
          await this.updateGameState(sessionId, gameState);
          await this.emitFullGameState(
            sessionId,
            gameState,
            'countdown-expired',
            {
              reason: gameState.gameOverCountdown.reason,
            }
          );
        }

        return;
      }

      // Check recovery conditions (only for health/budget, not time)
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
        gameState.activityLog.unshift(
          '[RECOVERY] Crisis averted! Health restored.'
        );
        WebSocketService.broadcastSystemMessage(
          sessionId!,
          'Crisis averted! Health restored.',
          'info'
        );
        // Send full game state payload immediately after recovery
        await this.emitFullGameState(
          sessionId!,
          gameState,
          'countdown-cancelled',
          {
            reason: recoveryReason,
          }
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
        // Send full game state payload immediately after recovery
        await this.emitFullGameState(
          sessionId!,
          gameState,
          'countdown-cancelled',
          {
            reason: recoveryReason,
          }
        );
      }
      // Note: Time countdown cannot be cancelled, it just counts down to game end
    }
  }

  // NEW: Acquire lock for processing
  static acquireLock(
    gameState: GameState,
    resourceId: string,
    playerId: string,
    type: 'batch' | 'queue' | 'material'
  ): boolean {
    // Initialize activeLocks if missing (for backward compatibility)
    if (!gameState.activeLocks) {
      gameState.activeLocks = {};
    }

    const now = Date.now();
    const existingLock = gameState.activeLocks[resourceId];

    // Check if lock exists and is still valid (< 30 seconds old)
    if (existingLock && now - existingLock.timestamp < 30000) {
      return false; // Lock already held
    }

    // Acquire lock
    gameState.activeLocks[resourceId] = {
      playerId,
      timestamp: now,
      type,
    };
    return true;
  }

  // NEW: Release lock
  static releaseLock(gameState: GameState, resourceId: string): void {
    // Initialize activeLocks if missing (for backward compatibility)
    if (!gameState.activeLocks) {
      gameState.activeLocks = {};
    }

    delete gameState.activeLocks[resourceId];
  }

  // NEW: Clean up stale locks (older than 30 seconds)
  static cleanupStaleLocks(gameState: GameState): void {
    // Initialize activeLocks if missing (for backward compatibility)
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

  // NEW: Update pair score in database during game
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

          // Update pair status based on both teams
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
            averagePairHealth = teamBHealth; // Only Team B
          } else if (
            gameState.pairStatus === 'team_b_eliminated' ||
            partnerGameState.pairStatus === 'team_b_eliminated'
          ) {
            pairStatus = 'team_b_eliminated';
            averagePairHealth = teamAHealth; // Only Team A
          } else {
            pairStatus = 'completed';
            averagePairHealth = 0; // Both eliminated
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

  // NEW: Recalculate all core metrics after any action (as per manual section 2.2)
  static recalculateCoreMetrics(gameState: GameState): void {
    // Update waste inventory (total pending waste that needs management)
    gameState.wasteInventory = gameState.wasteBatches
      .filter(batch => batch.status === 'PENDING')
      .reduce((total, batch) => total + batch.mass, 0);

    // Recalculate total CO2 as per manual section 2.2: Total CO2e = (Truck Trips * 1.6) + (Landfill Tons * 2.5)
    gameState.totalCO2 = CalculationService.calculateTotalCO2(
      gameState.totalTransportTrips || 0,
      gameState.totalLandfillTons || 0,
      gameState.constants
    );

    // Recalculate health based on current state
    const completedProjects = gameState.cityProjects.filter(
      project => project.completed
    ).length;
    const healthChange = CalculationService.calculateHealthChange(
      gameState.wasteBatches,
      gameState.totalCO2,
      completedProjects,
      gameState.constants
    );

    // Calculate new health from current health
    const newHealth = Math.max(
      0,
      Math.min(100, gameState.cityHealth + healthChange.healthChange)
    );

    // Update health if changed
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

    // Update game time
    this.updateGameTime(gameState);

    // Update game status based on pair status
    this.updateGameStatusFromPairStatus(gameState);
  }

  // NEW: Collect waste batch (Municipality action)
  static async collectWaste(
    sessionId: string,
    batchId: string,
    playerId: string
  ): Promise<GameState> {
    const gameState = await this.getGameState(sessionId);
    if (!gameState) {
      throw new Error('Game session not found');
    }

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

    if (gameState.gameStatus !== 'active') {
      throw new Error('Game is not active');
    }

    // Verify player is municipality
    if (gameState.players.municipality !== playerId.toString()) {
      throw new Error('Only municipality player can collect waste');
    }

    // Find the waste batch
    const batch = gameState.wasteBatches.find(b => b.id === batchId);
    if (!batch) {
      throw new Error('Waste batch not found');
    }

    if (batch.status !== 'PENDING') {
      throw new Error('Waste batch is not available for collection');
    }

    // Try to acquire lock
    if (!this.acquireLock(gameState, batchId, playerId, 'batch')) {
      throw new Error(
        'Another player is working on this. Try a different batch.'
      );
    }

    // Set locked timestamp
    batch.lockedAt = Date.now();

    try {
      // Calculate transport cost
      const transportCost = CalculationService.calculateTransportCost(
        batch,
        gameState.constants
      );

      // Check if municipality has enough budget
      if (gameState.budget < transportCost) {
        throw new Error('Insufficient budget for waste collection');
      }

      // Deduct transport cost from budget
      gameState.budget -= transportCost;

      // Calculate CO2 emissions from transport
      const transportCO2 = CalculationService.calculateCO2FromTransport(
        1,
        gameState.constants
      );
      gameState.totalCO2 += transportCO2;

      // Update transport trips counter
      gameState.totalTransportTrips += 1;

      // Update waste inventory (waste is now in transit to MRF)
      // Note: wasteInventory tracks total waste that needs management
      // When collected, it's still in inventory until processed

      // Update batch status to DELIVERED
      batch.status = 'DELIVERED';

      // Add to MRF queue
      gameState.mrfQueue.push({
        id: `q-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        batchId: batch.id,
        playerId: playerId,
        arrivalTime: Date.now(),
        delivered: false,
        lockToken: null,
      });

      // Add activity log
      gameState.activityLog.unshift(
        `[Municipality] Collected ${batch.mass.toFixed(1)} tons ${batch.origin} waste. Cost: $${transportCost.toFixed(2)}, CO2: ${transportCO2.toFixed(1)} tons`
      );

      // Recalculate all core metrics after action (as per manual section 2.2)
      this.recalculateCoreMetrics(gameState);

      // Check countdown conditions after metrics update
      await this.checkCountdownConditions(gameState, sessionId);

      // Save updated game state
      await this.updateGameState(sessionId, gameState);

      // Broadcast real-time update to all players
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

      // Broadcast full game state payload to clients
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
      } catch (err) {
        // ignore
      }

      return gameState;
    } finally {
      // Always release the lock and clear locked timestamp
      batch.lockedAt = null;
      this.releaseLock(gameState, batchId);
    }
  }
}
