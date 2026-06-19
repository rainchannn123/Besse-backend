import { GameState } from '../types';
import { ForbiddenError, NotFoundError, ValidationError } from '../utils/AppError';
import { CalculationService } from './calculationService';
import { GameService } from './gameService';
import { WebSocketService } from './websocketService';

export class MunicipalityService {
  // UPDATED: Collect waste with locking mechanism as per manual section 3
  static async collectWaste(
    sessionId: string,
    batchId: string,
    playerId: string
  ): Promise<GameState> {
    const gameState = await GameService.getGameState(sessionId);
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

    // Step A: Check if batch is locked
    if (!GameService.acquireLock(gameState, batchId, playerId, 'batch')) {
      // Set status to FAILED as per manual
      const batch = gameState.wasteBatches.find(b => b.id === batchId);
      if (batch) {
        batch.status = 'FAILED';
        gameState.activityLog.unshift(
          `[System] Batch ${batchId} collection failed - already locked by another player`
        );
      }
      throw new Error(
        'Another player is working on this. Try a different batch.'
      );
    }

    try {
      const batch = gameState.wasteBatches.find(b => b.id === batchId);
      if (!batch) {
        GameService.releaseLock(gameState, batchId);
        console.log(
          `[ERROR] Waste batch not found. Requested batchId: ${batchId}`
        );
        console.log(
          `[DEBUG] Available batches:`,
          gameState.wasteBatches.map(b => ({ id: b.id, status: b.status }))
        );
        throw new Error(
          `Waste batch not found. Requested ID: ${batchId}, Available batches: ${gameState.wasteBatches.length}`
        );
      }

      // Set locked timestamp
      batch.lockedAt = Date.now();

      if (batch.status !== 'PENDING') {
        GameService.releaseLock(gameState, batchId);
        throw new Error('Waste batch already processed');
      }

      // Calculate costs as per manual section 3
      const transportCost = CalculationService.calculateTransportCost(
        batch,
        gameState.constants
      );
      const transportCO2 = CalculationService.calculateCO2FromTransport(
        1,
        gameState.constants
      );

      // Check capacity
      if (gameState.wasteInventory + batch.mass > gameState.maxCapacity) {
        GameService.releaseLock(gameState, batchId);
        throw new Error(
          'Inventory capacity exceeded. Process existing waste first.'
        );
      }

      // Check budget
      if (gameState.budget < transportCost) {
        GameService.releaseLock(gameState, batchId);
        throw new ValidationError(
          `Insufficient budget. Collection costs $${transportCost.toFixed(2)} but current budget is $${gameState.budget.toFixed(2)}.`
        );
      }

      // Execute collection as per manual
      gameState.budget -= transportCost;
      gameState.totalCO2 += transportCO2;
      gameState.totalTransportTrips += 1;
      gameState.wasteInventory += batch.mass;
      batch.status = 'DELIVERED';
      batch.playerId = playerId;

      // Add to MRF queue as per manual
      const now = Date.now();
      gameState.mrfQueue.push({
        id: 'q-' + Math.random().toString(36).substr(2, 9),
        batchId: batch.id,
        playerId: playerId,
        arrivalTime: now,
        delivered: false,
        lockToken: null,
      });

      gameState.activityLog.unshift(
        `[Municipality] Collected ${batch.mass.toFixed(1)} tons of ${batch.origin} waste ` +
          `(Cost: $${transportCost.toFixed(0)}, CO2: +${transportCO2.toFixed(1)}t)`
      );

      // Recalculate all core metrics after action (as per manual section 2.2)
      GameService.recalculateCoreMetrics(gameState);

      // Clear locked timestamp and release lock
      batch.lockedAt = null;
      GameService.releaseLock(gameState, batchId);

      await GameService.updateGameState(sessionId, gameState);

      // Broadcast player action for announcement board
      WebSocketService.broadcastPlayerAction(
        sessionId,
        playerId,
        'Municipality',
        `collected ${batch.mass.toFixed(1)}t ${batch.origin} waste (Cost: $${transportCost.toFixed(0)}, CO₂: +${transportCO2.toFixed(1)}t)`
      );

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

      // Also emit full game state payload for clients
      try {
        GameService.emitFullGameState(sessionId, gameState, 'waste-collected', {
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
    } catch (error) {
      // Ensure lock is released on error
      GameService.releaseLock(gameState, batchId);
      throw error;
    }
  }

  // UPDATED: Reject waste with proper health recalculation as per manual section 6.1
  static async rejectWaste(
    sessionId: string,
    batchId: string,
    playerId: string
  ): Promise<GameState> {
    const gameState = await GameService.getGameState(sessionId);
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

    // Check pair status - prevent eliminated teams from acting
    if (
      gameState.teamRole === 'Team A' &&
      gameState.pairStatus === 'team_a_eliminated'
    ) {
      throw new Error(
        'Your team has been eliminated and cannot perform actions'
      );
    }
    if (
      gameState.teamRole === 'Team B' &&
      gameState.pairStatus === 'team_b_eliminated'
    ) {
      throw new Error(
        'Your team has been eliminated and cannot perform actions'
      );
    }

    // Check pair status - prevent eliminated teams from acting
    if (
      gameState.teamRole === 'Team A' &&
      gameState.pairStatus === 'team_a_eliminated'
    ) {
      throw new Error(
        'Your team has been eliminated and cannot perform actions'
      );
    }
    if (
      gameState.teamRole === 'Team B' &&
      gameState.pairStatus === 'team_b_eliminated'
    ) {
      throw new Error(
        'Your team has been eliminated and cannot perform actions'
      );
    }

    // Verify player is municipality
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

    // Try to acquire lock
    if (!GameService.acquireLock(gameState, batchId, playerId, 'batch')) {
      throw new Error(
        'Waste batch is currently being processed by another player'
      );
    }

    try {
      // Calculate landfill CO2 emissions (waste goes directly to landfill)
      const landfillCO2 = batch.mass * gameState.constants.CO2_FACTOR_LANDFILL;
      gameState.totalCO2 += landfillCO2;

      // Update landfill tons counter
      gameState.totalLandfillTons += batch.mass;

      // Mark batch as failed (rejected)
      batch.status = 'FAILED';

      // Add activity log
      gameState.activityLog.unshift(
        `[Municipality] Rejected ${batch.mass.toFixed(1)} tons ${batch.origin} waste. CO2: +${landfillCO2.toFixed(1)} tons (landfill)`
      );

      // Recalculate all core metrics after action (as per manual section 2.2)
      GameService.recalculateCoreMetrics(gameState);

      // Save updated game state
      await GameService.updateGameState(sessionId, gameState);

      // Broadcast player action for announcement board
      WebSocketService.broadcastPlayerAction(
        sessionId,
        playerId,
        'Municipality',
        `rejected ${batch.mass.toFixed(1)}t ${batch.origin} waste (CO₂: +${landfillCO2.toFixed(1)}t landfill)`
      );

      // Broadcast real-time update to all players
      WebSocketService.broadcastGameState(
        sessionId,
        gameState,
        'waste-rejected'
      );

      // Also provide full game state payload
      try {
        GameService.emitFullGameState(
          sessionId,
          gameState,
          'waste-rejected',
          null
        );
      } catch (err) {
        // ignore
      }

      return gameState;
    } finally {
      // Always release the lock
      GameService.releaseLock(gameState, batchId);
    }
  }

 

  // NEW: Construct city project as per manual
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

    // Verify player is municipality
    if (gameState.players.municipality.toString() !== playerId.toString()) {
      throw new ForbiddenError('Only municipality player can contribute to projects');
    }

    // Find the project
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

    const materialTypeKey =
      materialType as keyof typeof project.requiredMaterials;

    if (
      !project.requiredMaterials[materialTypeKey] ||
      project.requiredMaterials[materialTypeKey]! <= 0
    ) {
      throw new ValidationError(
        `Material ${materialType} is not required for this project`
      );
    }

    // Calculate total available mass of this material type in municipality inventory
    const totalAvailable = gameState.municipalInventory[materialType as keyof typeof gameState.municipalInventory];

    if (totalAvailable < materialAmount) {
      throw new ValidationError(
        `Insufficient ${materialType} in municipality inventory. Available: ${totalAvailable.toFixed(1)} tons, Requested: ${materialAmount} tons`
      );
    }

    // Deduct materialAmount from municipality inventory
    gameState.municipalInventory[materialType as keyof typeof gameState.municipalInventory] -= materialAmount;

    // Add to project
    const addedKey = materialType as keyof typeof project.addedMaterials;
    project.addedMaterials[addedKey] =
      (project.addedMaterials[addedKey] || 0) + materialAmount;

    // Calculate progress
    const totalRequired = Object.values(project.requiredMaterials).reduce(
      (sum, val) => sum + (val || 0),
      0
    );
    const totalAdded = Object.values(project.addedMaterials).reduce(
      (sum, val) => sum + (val || 0),
      0
    );
    project.progress = Math.min((totalAdded / totalRequired) * 100, 100);

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
        `[Municipality] Contributed ${materialAmount.toFixed(1)} tons ${materialType} to ${project.name}. Progress: ${project.progress.toFixed(1)}%`
      );
    }

    // Recalculate all core metrics after action
    GameService.recalculateCoreMetrics(gameState);

    await GameService.updateGameState(sessionId, gameState);

    // Broadcast player action for announcement board
    WebSocketService.broadcastPlayerAction(
      sessionId,
      playerId,
      'Municipality',
      project.completed
        ? `completed project ${project.name}! +${project.healthBonus}% Health, +$${(project.budgetBonus ?? 0).toFixed(0)} Budget, +${project.scoreBonus ?? 0} Score`
        : `contributed ${materialAmount.toFixed(1)}t ${materialType} to ${project.name} (Progress: ${project.progress.toFixed(1)}%)`
    );

    // Broadcast
    WebSocketService.broadcastSystemMessage(
      sessionId,
      project.completed
        ? `🎉 ${project.name} completed! +${project.healthBonus}% Health, +$${(project.budgetBonus ?? 0).toFixed(0)} Budget, +${project.scoreBonus ?? 0} Score. Updated Health: ${gameState.cityHealth.toFixed(1)}%, Budget: $${gameState.budget.toFixed(0)}, Score: ${gameState.teamScore}/${gameState.maxTeamScore}`
        : `Municipality contributed ${materialAmount.toFixed(1)} tons ${materialType} to ${project.name}. Progress: ${project.progress.toFixed(1)}%`,
      'info'
    );

    // Also emit full game state payload
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
          scoreBonusApplied: project.completed ? (project.scoreBonus ?? 0) : 0,
          teamScore: gameState.teamScore,
          maxTeamScore: gameState.maxTeamScore,
        }
      );
    } catch (err) {
      // ignore
    }

    return gameState;
  }
}
