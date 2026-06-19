import { v4 as uuidv4 } from 'uuid';
import { GameState, ActiveTransport } from '../types';
import { ForbiddenError, NotFoundError, ValidationError } from '../utils/AppError';
import { CalculationService } from './calculationService';
import { GameService } from './gameService';
import { WebSocketService } from './websocketService';

export class MunicipalityService {
  private static readonly TRANSPORT_COSTS = {
    fast: 50,
    slow: 25,
  };

  private static readonly TRANSPORT_DURATIONS = {
    fast: 30 * 1000,
    slow: 60 * 1000,
  };

  static async collectWasteWithTransport(
    sessionId: string,
    batchId: string,
    playerId: string,
    mode: 'fast' | 'slow'
  ): Promise<GameState> {
    const gameState = await GameService.getGameState(sessionId);
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
    if (!gameState.activeTransports) {
      gameState.activeTransports = [];
    }

    if (gameState.gameStatus !== 'active') {
      throw new Error('Game is not active');
    }

    if (!GameService.acquireLock(gameState, batchId, playerId, 'batch')) {
      const batch = gameState.wasteBatches.find(b => b.id === batchId);
      if (batch) {
        batch.status = 'FAILED';
        gameState.activityLog.unshift(
          `[System] Batch ${batchId} collection failed - already locked by another player`
        );
      }
      throw new Error('Another player is working on this. Try a different batch.');
    }

    try {
      const batch = gameState.wasteBatches.find(b => b.id === batchId);
      if (!batch) {
        GameService.releaseLock(gameState, batchId);
        throw new Error(`Waste batch not found. ID: ${batchId}`);
      }

      batch.lockedAt = Date.now();

      if (batch.status !== 'PENDING') {
        GameService.releaseLock(gameState, batchId);
        throw new Error('Waste batch already processed');
      }

      const transportCostPerTon = this.TRANSPORT_COSTS[mode];
      const transportCost = batch.mass * transportCostPerTon;
      const transportCO2 = CalculationService.calculateCO2FromTransport(1, gameState.constants);

      if (gameState.wasteInventory + batch.mass > gameState.maxCapacity) {
        GameService.releaseLock(gameState, batchId);
        throw new Error('Inventory capacity exceeded. Process existing waste first.');
      }

      if (gameState.budget < transportCost) {
        GameService.releaseLock(gameState, batchId);
        throw new ValidationError(
          `Insufficient budget. ${mode} transport costs $${transportCost.toFixed(2)} but current budget is $${gameState.budget.toFixed(2)}.`
        );
      }

      gameState.budget -= transportCost;
      gameState.totalCO2 += transportCO2;
      gameState.totalTransportTrips += 1;

      batch.status = 'IN_TRANSIT';
      batch.playerId = playerId;

      const now = Date.now();
      const activeTransport: ActiveTransport = {
        id: `transport-${uuidv4().slice(0, 8)}`,
        batchId: batch.id,
        wasteBatch: { ...batch },
        mode: mode,
        startTime: now,
        endTime: now + this.TRANSPORT_DURATIONS[mode],
        cost: transportCost,
        co2Emission: transportCO2,
        status: 'in-transit',
      };

      gameState.activeTransports.push(activeTransport);

      gameState.activityLog.unshift(
        `[Municipality] Started ${mode} transport of ${batch.mass.toFixed(1)} tons ${batch.origin} waste. ` +
        `Cost: $${transportCost.toFixed(0)}, Time: ${this.TRANSPORT_DURATIONS[mode] / 1000}s, CO₂: +${transportCO2.toFixed(1)}t`
      );

      batch.lockedAt = null;
      GameService.releaseLock(gameState, batchId);

      await GameService.updateGameState(sessionId, gameState);

      WebSocketService.broadcastGameStateUpdate(
        sessionId,
        gameState,
        'transport-started',
        {
          transportId: activeTransport.id,
          mode: mode,
          batchMass: batch.mass,
          batchOrigin: batch.origin,
          durationMs: this.TRANSPORT_DURATIONS[mode],
          endTime: activeTransport.endTime,
          activeCount: gameState.activeTransports.length,
        }
      );

      WebSocketService.broadcastPlayerAction(
        sessionId,
        playerId,
        'Municipality',
        `started ${mode} transport of ${batch.mass.toFixed(1)}t ${batch.origin} waste ($${transportCost.toFixed(0)}, arrives in ${this.TRANSPORT_DURATIONS[mode] / 1000}s)`
      );

      try {
        await GameService.emitFullGameState(sessionId, gameState, 'transport-started', {
          transportId: activeTransport.id,
          mode: mode,
          batchMass: batch.mass,
          durationSec: this.TRANSPORT_DURATIONS[mode] / 1000,
          activeCount: gameState.activeTransports.length,
        });
      } catch (err) {}

      return gameState;
    } catch (error) {
      GameService.releaseLock(gameState, batchId);
      throw error;
    }
  }

  static async completeAllTransports(sessionId: string): Promise<GameState | null> {
    const gameState = await GameService.getGameState(sessionId);
    if (!gameState || gameState.gameStatus !== 'active') {
      return null;
    }

    if (!gameState.activeTransports || gameState.activeTransports.length === 0) {
      return null;
    }

    const now = Date.now();
    let hasChanges = false;

    for (let i = gameState.activeTransports.length - 1; i >= 0; i--) {
      const transport = gameState.activeTransports[i];
      
      if (transport.status === 'in-transit' && now >= transport.endTime) {
        transport.status = 'completed';
        
        const batch = transport.wasteBatch;

        gameState.mrfQueue.push({
          id: `q-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          batchId: batch.id,
          playerId: batch.playerId,
          arrivalTime: now,
          delivered: false,
          lockToken: null,
        });

        const originalBatch = gameState.wasteBatches.find(b => b.id === batch.id);
        if (originalBatch) {
          originalBatch.status = 'DELIVERED';
        }

        gameState.wasteInventory += batch.mass;
        gameState.activeTransports.splice(i, 1);

        gameState.activityLog.unshift(
          `[System] ${transport.mode.toUpperCase()} transport completed! ${batch.mass.toFixed(1)} tons of ${batch.origin} waste delivered to MRF.`
        );

        hasChanges = true;

        WebSocketService.broadcastGameStateUpdate(
          sessionId,
          gameState,
          'transport-completed',
          {
            batchId: batch.id,
            batchMass: batch.mass,
            mode: transport.mode,
            activeCount: gameState.activeTransports.length,
          }
        );

        try {
          await GameService.emitFullGameState(sessionId, gameState, 'transport-completed', {
            batchId: batch.id,
            batchMass: batch.mass,
            mode: transport.mode,
            activeCount: gameState.activeTransports.length,
          });
        } catch (err) {}
      }
    }

    if (hasChanges) {
      await GameService.updateGameState(sessionId, gameState);
    }

    return gameState;
  }

  static async completeTransport(sessionId: string): Promise<GameState | null> {
    return this.completeAllTransports(sessionId);
  }

  static async collectWaste(
    sessionId: string,
    batchId: string,
    playerId: string
  ): Promise<GameState> {
    return this.collectWasteWithTransport(sessionId, batchId, playerId, 'slow');
  }

  static async rejectWaste(
    sessionId: string,
    batchId: string,
    playerId: string
  ): Promise<GameState> {
    const gameState = await GameService.getGameState(sessionId);
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

    if (
      (gameState.teamRole === 'Team A' && gameState.pairStatus === 'team_a_eliminated') ||
      (gameState.teamRole === 'Team B' && gameState.pairStatus === 'team_b_eliminated')
    ) {
      throw new Error('Your team has been eliminated and cannot perform actions');
    }

    if (gameState.players.municipality !== playerId) {
      throw new Error('Only municipality player can reject waste');
    }

    const batch = gameState.wasteBatches.find(b => b.id === batchId);
    if (!batch) {
      throw new Error('Waste batch not found');
    }

    if (batch.status !== 'PENDING') {
      throw new Error('Waste batch is not available for rejection');
    }

    if (!GameService.acquireLock(gameState, batchId, playerId, 'batch')) {
      throw new Error('Waste batch is currently being processed by another player');
    }

    try {
      const landfillCO2 = batch.mass * gameState.constants.CO2_FACTOR_LANDFILL;
      gameState.totalCO2 += landfillCO2;
      gameState.totalLandfillTons += batch.mass;
      batch.status = 'FAILED';

      gameState.activityLog.unshift(
        `[Municipality] Rejected ${batch.mass.toFixed(1)} tons ${batch.origin} waste. CO2: +${landfillCO2.toFixed(1)} tons (landfill)`
      );

      GameService.recalculateCoreMetrics(gameState);
      await GameService.updateGameState(sessionId, gameState);

      WebSocketService.broadcastGameState(sessionId, gameState, 'waste-rejected');

      try {
        GameService.emitFullGameState(sessionId, gameState, 'waste-rejected', null);
      } catch (err) {}

      return gameState;
    } finally {
      GameService.releaseLock(gameState, batchId);
    }
  }

  static async constructProject(
    sessionId: string,
    projectId: string,
    materialType: string,
    materialAmount: number,
    playerId: string
  ): Promise<GameState> {
    const gameState = await GameService.getGameState(sessionId);
    if (!gameState) {
      throw new NotFoundError('Game session not found');
    }

    if (gameState.gameStatus !== 'active') {
      throw new ValidationError('Game is not active');
    }

    if (gameState.players.municipality.toString() !== playerId.toString()) {
      throw new ForbiddenError('Only municipality player can contribute to projects');
    }

    const project = gameState.cityProjects.find(p => p.id === projectId);
    if (!project) {
      throw new NotFoundError('Project not found');
    }

    if (project.completed) {
      throw new ValidationError('Project is already completed');
    }

    if (!project.addedMaterials) {
      project.addedMaterials = {};
    }

    const materialTypeKey = materialType as keyof typeof project.requiredMaterials;

    if (!project.requiredMaterials[materialTypeKey] || project.requiredMaterials[materialTypeKey]! <= 0) {
      throw new ValidationError(`Material ${materialType} is not required for this project`);
    }

    const totalAvailable = gameState.municipalInventory[materialType as keyof typeof gameState.municipalInventory];

    if (totalAvailable < materialAmount) {
      throw new ValidationError(
        `Insufficient ${materialType} in municipality inventory. Available: ${totalAvailable.toFixed(1)} tons, Requested: ${materialAmount} tons`
      );
    }

    // Calculate CO₂ emission for this material contribution
    const materialProps = gameState.constants.MATERIAL_PROPERTIES[materialType as keyof typeof gameState.constants.MATERIAL_PROPERTIES];
    const co2EmissionPerTon = materialProps.co2EmissionPerTon || 0;
    const co2Emitted = materialAmount * co2EmissionPerTon;

    // Deduct material from inventory
    gameState.municipalInventory[materialType as keyof typeof gameState.municipalInventory] -= materialAmount;

    // Add CO₂ to total
    gameState.totalCO2 += co2Emitted;

    // Add to project
    const addedKey = materialType as keyof typeof project.addedMaterials;
    project.addedMaterials[addedKey] = (project.addedMaterials[addedKey] || 0) + materialAmount;

    // Calculate progress
    const totalRequired = Object.values(project.requiredMaterials).reduce((sum, val) => sum + (val || 0), 0);
    const totalAdded = Object.values(project.addedMaterials).reduce((sum, val) => sum + (val || 0), 0);
    project.progress = Math.min((totalAdded / totalRequired) * 100, 100);

    // Log the CO₂ addition
    gameState.activityLog.unshift(
      `[Municipality] Added ${materialAmount.toFixed(1)} tons ${materialType} to ${project.name}. ` +
      `CO₂: +${co2Emitted.toFixed(1)} tons (${materialProps.co2Profile} profile)`
    );

    if (project.progress >= 100) {
      project.completed = true;
      const budgetBonus = project.budgetBonus ?? 0;
      const scoreBonus = project.scoreBonus ?? 0;
      gameState.cityHealth += project.healthBonus;
      gameState.budget += budgetBonus;
      gameState.teamScore = (gameState.teamScore || 0) + scoreBonus;
      gameState.activityLog.unshift(
        `🎉 ${project.name} completed! +${project.healthBonus}% Health, +$${budgetBonus.toFixed(0)} Budget, +${scoreBonus} Score`
      );
    } else {
      gameState.activityLog.unshift(
        `[Municipality] Project ${project.name} progress: ${project.progress.toFixed(1)}%`
      );
    }

    // Recalculate core metrics
    GameService.recalculateCoreMetrics(gameState);
    await GameService.updateGameState(sessionId, gameState);

    // Broadcast updates
    WebSocketService.broadcastPlayerAction(
      sessionId,
      playerId,
      'Municipality',
      project.completed
        ? `completed project ${project.name}! +${project.healthBonus}% Health, +$${(project.budgetBonus ?? 0).toFixed(0)} Budget, CO₂: +${co2Emitted.toFixed(1)}t, +${project.scoreBonus ?? 0} Score`
        : `added ${materialAmount.toFixed(1)}t ${materialType} to ${project.name} (Progress: ${project.progress.toFixed(1)}%, CO₂: +${co2Emitted.toFixed(1)}t)`
    );

    WebSocketService.broadcastSystemMessage(
      sessionId,
      project.completed
        ? `🎉 ${project.name} completed! +${project.healthBonus}% Health, +$${(project.budgetBonus ?? 0).toFixed(0)} Budget, +${project.scoreBonus ?? 0} Score. CO₂: +${co2Emitted.toFixed(1)}t, Score: ${gameState.teamScore}/${gameState.maxTeamScore}`
        : `Added ${materialAmount.toFixed(1)} tons ${materialType} to ${project.name}. Progress: ${project.progress.toFixed(1)}%. CO₂: +${co2Emitted.toFixed(1)}t`,
      'info'
    );

    try {
      GameService.emitFullGameState(
        sessionId,
        gameState,
        project.completed ? 'project-completed' : 'project-contributed',
        {
          projectId,
          materialType,
          materialAmount,
          progress: project.progress,
          completed: project.completed,
          healthBonusApplied: project.completed ? project.healthBonus : 0,
          budgetBonusApplied: project.completed ? (project.budgetBonus ?? 0) : 0,
          co2Emitted: co2Emitted,
          scoreBonusApplied: project.completed ? (project.scoreBonus ?? 0) : 0,
          teamScore: gameState.teamScore,
          maxTeamScore: gameState.maxTeamScore,
        }
      );
    } catch (err) {}

    return gameState;
  }
}