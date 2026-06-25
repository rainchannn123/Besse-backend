import { v4 as uuidv4 } from 'uuid';
import { TeamData, ActiveTransport } from '../types';
import { DEFAULT_GAME_CONSTANTS } from '../constants/constants';
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
    fast: DEFAULT_GAME_CONSTANTS.TRANSPORT_FAST_DURATION_SECONDS * 1000,
    slow: DEFAULT_GAME_CONSTANTS.TRANSPORT_SLOW_DURATION_SECONDS * 1000,
  };


  private static transportTimers: Map<string, NodeJS.Timeout> = new Map();

  static async collectWasteWithTransport(
    sessionId: string,
    batchId: string,
    playerId: string,
    mode: 'fast' | 'slow'
  ): Promise<TeamData> {
    // ✅ Get team data
    const team = await GameService.getTeamData(sessionId);
    if (!team) {
      throw new Error('Team not found');
    }

    if (team.isEliminated || team.gameStatus !== 'active') {
      throw new Error('Team is eliminated or game is not active');
    }

    // ✅ Find batch
    const batchIndex = team.wasteBatches.findIndex(b => b.id === batchId);
    if (batchIndex === -1) {
      throw new Error(`Waste batch not found. ID: ${batchId}`);
    }

    const batch = team.wasteBatches[batchIndex];

    if (batch.status !== 'PENDING') {
      throw new Error('Waste batch already processed');
    }

    const transportCostPerTon = this.TRANSPORT_COSTS[mode];
    const transportCost = batch.mass * transportCostPerTon;
    const transportCO2 = CalculationService.calculateCO2FromTransport(1, DEFAULT_GAME_CONSTANTS);

    // if (team.wasteInventory + batch.mass > 150) {
    //   throw new Error('Inventory capacity exceeded. Process existing waste first.');
    // }

    if (team.budget < transportCost) {
      throw new ValidationError(
        `Insufficient budget. ${mode} transport costs $${transportCost.toFixed(2)} but current budget is $${team.budget.toFixed(2)}.`
      );
    }

    // ✅ Apply costs
    team.budget -= transportCost;
    team.totalCO2 += transportCO2;
    team.totalTransportTrips += 1;

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
      purpose: 'waste-to-mrf',
    };

        if (!team.activeTransports) {
      team.activeTransports = [];
    }
    team.activeTransports.push(activeTransport);

    // Schedule near-real-time completion so MRF queue updates without waiting for system-check tick
    const timerKey = `${sessionId}:${activeTransport.id}`;
    const existingTimer = this.transportTimers.get(timerKey);
    if (existingTimer) {
      clearTimeout(existingTimer);
      this.transportTimers.delete(timerKey);
    }

    const timer = setTimeout(async () => {
      this.transportTimers.delete(timerKey);
      try {
        await this.completeAllTransports(sessionId);
      } catch {
        // Fallback path is system-check; ignore timer errors
      }
    }, Math.max(0, activeTransport.endTime - now));

    this.transportTimers.set(timerKey, timer);

    team.activityLog.unshift(
      `[Municipality] Started ${mode} transport of ${batch.mass.toFixed(1)} tons ${batch.origin} waste. ` +
      `Cost: $${transportCost.toFixed(0)}, Time: ${this.TRANSPORT_DURATIONS[mode] / 1000}s, CO₂: +${transportCO2.toFixed(1)}t`
    );

        // ✅ Update team data
    await GameService.updateTeamData(sessionId, team);

    const updatedGameState = await GameService.getGameState(sessionId);
    if (updatedGameState) {
      WebSocketService.broadcastGameStateUpdate(
        sessionId,
        updatedGameState,
        'transport-started',
        {
          transportId: activeTransport.id,
          mode: mode,
          batchMass: batch.mass,
                    batchOrigin: batch.origin,
          durationMs: this.TRANSPORT_DURATIONS[mode],
          endTime: activeTransport.endTime,
          activeCount: team.activeTransports.length,
          source: 'municipality',
          destination: 'mrf',
        }
      );
    }

    WebSocketService.broadcastPlayerAction(
      sessionId,
      playerId,
      'Municipality',
      `started ${mode} transport of ${batch.mass.toFixed(1)}t ${batch.origin} waste ($${transportCost.toFixed(0)}, arrives in ${this.TRANSPORT_DURATIONS[mode] / 1000}s)`
    );

    return team;
  }

  static async completeAllTransports(sessionId: string): Promise<TeamData | null> {
    const team = await GameService.getTeamData(sessionId);
    if (!team || team.isEliminated) {
      return null;
    }

    if (!team.activeTransports || team.activeTransports.length === 0) {
      return null;
    }

        const now = Date.now();
    let hasChanges = false;
    const completedTransports: Array<{
      batchId: string;
      batchMass: number;
      mode: 'fast' | 'slow';
      activeCount: number;
      source: 'municipality';
      destination: 'mrf';
    }> = [];

    for (let i = team.activeTransports.length - 1; i >= 0; i--) {
      const transport = team.activeTransports[i];
      
      if (
        transport.status === 'in-transit' &&
        now >= transport.endTime &&
        (transport.purpose === 'waste-to-mrf' || !transport.purpose)
      ) {
        transport.status = 'completed';
        
        const batch = transport.wasteBatch;

        team.mrfQueue.push({
          id: `q-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          batchId: batch.id,
          playerId: batch.playerId,
          arrivalTime: now,
          delivered: false,
          lockToken: null,
        });

        const originalBatch = team.wasteBatches.find(b => b.id === batch.id);
        if (originalBatch) {
          originalBatch.status = 'DELIVERED';
        }

        team.wasteInventory += batch.mass;
        team.activeTransports.splice(i, 1);

        team.activityLog.unshift(
          `[System] ${transport.mode.toUpperCase()} transport completed! ${batch.mass.toFixed(1)} tons of ${batch.origin} waste delivered to MRF.`
        );

                hasChanges = true;
                completedTransports.push({
                  batchId: batch.id,
                                    batchMass: batch.mass,
                  mode: transport.mode,
                  activeCount: team.activeTransports.length,
                  source: 'municipality',
                  destination: 'mrf',
                });

                const timerKey = `${sessionId}:${transport.id}`;
                const existingTimer = this.transportTimers.get(timerKey);
                if (existingTimer) {
                  clearTimeout(existingTimer);
                  this.transportTimers.delete(timerKey);
                }
      }
    }

        if (hasChanges) {
      await GameService.updateTeamData(sessionId, team);
      const updatedGameState = await GameService.getGameState(sessionId);
      if (updatedGameState) {
        for (const completed of completedTransports) {
          WebSocketService.broadcastGameStateUpdate(
            sessionId,
            updatedGameState,
            'transport-completed',
            completed
          );
        }
      }
    }

    return team;
  }

  static async rejectWaste(
    sessionId: string,
    batchId: string,
    playerId: string
  ): Promise<TeamData> {
    const team = await GameService.getTeamData(sessionId);
    if (!team) {
      throw new Error('Team not found');
    }

    if (team.isEliminated || team.gameStatus !== 'active') {
      throw new Error('Team is eliminated or game is not active');
    }

    const batchIndex = team.wasteBatches.findIndex(b => b.id === batchId);
    if (batchIndex === -1) {
      throw new Error('Waste batch not found');
    }

    const batch = team.wasteBatches[batchIndex];

    if (batch.status !== 'PENDING') {
      throw new Error('Waste batch is not available for rejection');
    }

    const landfillCO2 = batch.mass * DEFAULT_GAME_CONSTANTS.CO2_FACTOR_LANDFILL;
    team.totalCO2 += landfillCO2;
    team.totalLandfillTons += batch.mass;
    batch.status = 'FAILED';

    team.activityLog.unshift(
      `[Municipality] Rejected ${batch.mass.toFixed(1)} tons ${batch.origin} waste. CO2: +${landfillCO2.toFixed(1)} tons (landfill)`
    );

        await GameService.updateTeamData(sessionId, team);

    const updatedGameState = await GameService.getGameState(sessionId);
    if (updatedGameState) {
      WebSocketService.broadcastGameStateUpdate(sessionId, updatedGameState, 'waste-rejected', {
        batchId: batch.id,
        batchMass: batch.mass,
      });
    }

    return team;
  }

  static async constructProject(
    sessionId: string,
    projectId: string,
    materialType: string,
    materialAmount: number,
    playerId: string
  ): Promise<TeamData> {
    const team = await GameService.getTeamData(sessionId);
    if (!team) {
      throw new NotFoundError('Team not found');
    }

    if (team.isEliminated || team.gameStatus !== 'active') {
      throw new ValidationError('Team is eliminated or game is not active');
    }

    const project = team.cityProjects.find(p => p.id === projectId);
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

    const totalAvailable = team.municipalInventory[materialType as keyof typeof team.municipalInventory] || 0;

    if (totalAvailable < materialAmount) {
      throw new ValidationError(
        `Insufficient ${materialType} in municipality inventory. Available: ${totalAvailable.toFixed(1)} tons, Requested: ${materialAmount} tons`
      );
    }

    // Calculate CO₂ emission for this material contribution
    const materialProps = DEFAULT_GAME_CONSTANTS.MATERIAL_PROPERTIES[materialType as keyof typeof DEFAULT_GAME_CONSTANTS.MATERIAL_PROPERTIES];
    const co2EmissionPerTon = materialProps.co2EmissionPerTon || 0;
    const co2Emitted = materialAmount * co2EmissionPerTon;

    // Deduct material from inventory
    team.municipalInventory[materialType as keyof typeof team.municipalInventory] -= materialAmount;

    // Add CO₂ to total
    team.totalCO2 += co2Emitted;

    // Add to project
    const addedKey = materialType as keyof typeof project.addedMaterials;
    project.addedMaterials[addedKey] = (project.addedMaterials[addedKey] || 0) + materialAmount;

    // Calculate progress
    const totalRequired = Object.values(project.requiredMaterials).reduce((sum, val) => sum + (val || 0), 0);
    const totalAdded = Object.values(project.addedMaterials).reduce((sum, val) => sum + (val || 0), 0);
    project.progress = Math.min((totalAdded / totalRequired) * 100, 100);

    team.activityLog.unshift(
      `[Municipality] Added ${materialAmount.toFixed(1)} tons ${materialType} to ${project.name}. ` +
      `CO₂: +${co2Emitted.toFixed(1)} tons (${materialProps.co2Profile} profile)`
    );

    if (project.progress >= 100) {
      project.completed = true;
      const budgetBonus = project.budgetBonus ?? 0;
      team.cityHealth += project.healthBonus;
      team.budget += budgetBonus;
      team.totalProjectScore += project.score;
      team.activityLog.unshift(
        `🎉 ${project.name} completed! +${project.healthBonus}% Health, +$${budgetBonus.toFixed(0)} Budget, +${project.score} Score`
      );
    } else {
      team.activityLog.unshift(
        `[Municipality] Project ${project.name} progress: ${project.progress.toFixed(1)}%`
      );
    }

        // Update team data
    await GameService.updateTeamData(sessionId, team);

    const updatedGameState = await GameService.getGameState(sessionId);
    if (updatedGameState) {
      WebSocketService.broadcastGameStateUpdate(
        sessionId,
        updatedGameState,
        project.completed ? 'project-completed' : 'project-constructed',
        {
          projectId,
          materialType,
          materialAmount,
          progress: project.progress,
          completed: project.completed,
        }
      );
    }

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
        ? `🎉 ${project.name} completed! +${project.healthBonus}% Health, +$${(project.budgetBonus ?? 0).toFixed(0)} Budget, +${project.scoreBonus ?? 0} Score. CO₂: +${co2Emitted.toFixed(1)}t`
        : `Added ${materialAmount.toFixed(1)} tons ${materialType} to ${project.name}. Progress: ${project.progress.toFixed(1)}%. CO₂: +${co2Emitted.toFixed(1)}t`,
      'info'
    );

    return team;
  }
}