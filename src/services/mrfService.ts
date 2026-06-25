import { v4 as uuidv4 } from 'uuid';
import { TeamData } from '../types';
import { DEFAULT_GAME_CONSTANTS } from '../constants/constants';
import { BrokerService } from './brokerService';
import { CalculationService } from './calculationService';
import { GameService } from './gameService';
import { WebSocketService } from './websocketService';
import { AdminMonitorTelemetryService } from './adminMonitorTelemetryService';

export class MRFService {
  private static readonly TRANSPORT_COSTS = {
    fast: 50,
    slow: 25,
  };

  private static readonly LANDFILL_COST_MULTIPLIER = 0.7;
  private static readonly LANDFILL_CO2_MULTIPLIER = 0.5;

    private static readonly TRANSPORT_DURATIONS = {
    fast: DEFAULT_GAME_CONSTANTS.TRANSPORT_FAST_DURATION_SECONDS * 1000,
    slow: DEFAULT_GAME_CONSTANTS.TRANSPORT_SLOW_DURATION_SECONDS * 1000,
  };


  private static transportTimers: Map<string, NodeJS.Timeout> = new Map();

  // ✅ Process waste from queue
  static async processWaste(
    sessionId: string,
    queueId: string,
    playerId: string
  ): Promise<TeamData> {
    const team = await GameService.getTeamData(sessionId);
    if (!team) {
      throw new Error('Team not found');
    }

    if (team.isEliminated || team.gameStatus !== 'active') {
      throw new Error('Team is eliminated or game is not active');
    }

    // ✅ Find queue item
    const queueIndex = team.mrfQueue.findIndex(q => q.id === queueId);
    if (queueIndex === -1) {
      throw new Error('Queue item not found');
    }

    const queue = team.mrfQueue[queueIndex];
    const batch = team.wasteBatches.find(b => b.id === queue.batchId);
    if (!batch) {
      throw new Error('Waste batch not found');
    }

    // ✅ Calculate processing output
    const { materials, refuseMass, dumpingFee, landfillCO2 } =
      CalculationService.calculateProcessingOutput(
        batch,
        DEFAULT_GAME_CONSTANTS
      );

    // ✅ Check budget for disposal cost
    if (team.budget < dumpingFee) {
      throw new Error('Insufficient budget for waste disposal');
    }

    // ✅ Apply costs and CO2
    const processingCO2 = CalculationService.calculateCO2FromProcessing(
      batch.mass,
      DEFAULT_GAME_CONSTANTS
    );

    team.budget -= dumpingFee;
    team.totalCO2 += processingCO2 + landfillCO2;
    team.totalLandfillTons += refuseMass;

    // ✅ Create or update pending auctions for processed materials
    materials.forEach(materialData => {
      // Check if a pending auction for this material type already exists
      const existingAuction = team.marketplaceListing.find(
        auction =>
          auction.status === 'pending' &&
          auction.originTeam === sessionId &&
          auction.materialType === materialData.type
      );

      if (existingAuction) {
        // Increase mass of existing auction
        existingAuction.mass = Math.round((existingAuction.mass + materialData.mass) * 10) / 10;
      } else {
        // Create new auction
        const auction = {
          auctionId: 'a-' + uuidv4().slice(0, 8),
          originTeam: sessionId,
          materialType: materialData.type,
          grade: materialData.quality,
          mass: materialData.mass,
          currentBid: 0,
          entryPrice: 0,
          highBidder: null,
          highBidderSessionId: null,
          endTime: 0,
          status: 'pending' as const,
        };
        team.marketplaceListing.push(auction);
      }
    });

    // ✅ Remove from inventory and queue
    team.wasteInventory -= batch.mass;
    team.mrfQueue.splice(queueIndex, 1);

    team.activityLog.unshift(
      `[MRF] Processed ${batch.mass.toFixed(1)} tons waste → ${materials.length} materials ` +
      `(Refuse: ${refuseMass.toFixed(1)} tons, Disposal: $${dumpingFee.toFixed(0)}, CO2: +${(processingCO2 + landfillCO2).toFixed(1)}t)`
    );

        // ✅ Update team data
    await GameService.updateTeamData(sessionId, team);

        const updatedGameState = await GameService.getGameState(sessionId);
    if (updatedGameState) {
      WebSocketService.broadcastGameStateUpdate(sessionId, updatedGameState, 'waste-processed', {
        queueId,
        batchId: batch.id,
        batchMass: batch.mass,
      });

      const roomCode = updatedGameState.roomCode;
      const gameTeam = updatedGameState.teams?.find((t: any) => t.sessionId === sessionId);
      if (roomCode && gameTeam?.teamId) {
        for (const material of materials) {
          await AdminMonitorTelemetryService.logMaterialFlowEvent({
            roomCode,
            teamId: gameTeam.teamId,
            sessionId,
            citySlot: gameTeam.citySlot || 0,
            flowClass: 'material',
            source: 'mrf.processed_waste',
            destination: 'mrf.pending_auction',
            materialType: material.type,
            amount: material.mass,
            metadata: {
              action: 'mrf.process-waste',
              batchId: batch.id,
              queueId,
            },
          });
        }

        if (refuseMass > 0) {
          await AdminMonitorTelemetryService.logWasteBatchToDestination({
            roomCode,
            teamId: gameTeam.teamId,
            sessionId,
            citySlot: gameTeam.citySlot || 0,
            source: 'mrf.processed_waste',
            destination: 'landfill',
            mass: refuseMass,
            composition: batch.composition as any,
            metadata: {
              action: 'mrf.process-waste.refuse',
              batchId: batch.id,
              queueId,
            },
          });
        }
      }
    }


    // ✅ Broadcast player action
    WebSocketService.broadcastPlayerAction(
      sessionId,
      playerId,
      'MRF',
      `processed ${batch.mass.toFixed(1)}t waste → ${materials.length} materials (Refuse: ${refuseMass.toFixed(1)}t, CO₂: +${(processingCO2 + landfillCO2).toFixed(1)}t)`
    );

        return team;
  }

  static async sendToLandfill(
    sessionId: string,
    queueId: string,
    playerId: string
  ): Promise<TeamData> {
    const team = await GameService.getTeamData(sessionId);
    if (!team) {
      throw new Error('Team not found');
    }

    if (team.isEliminated || team.gameStatus !== 'active') {
      throw new Error('Team is eliminated or game is not active');
    }

    const queueIndex = team.mrfQueue.findIndex(q => q.id === queueId);
    if (queueIndex === -1) {
      throw new Error('Queue item not found');
    }

    const queue = team.mrfQueue[queueIndex];
    const batch = team.wasteBatches.find(b => b.id === queue.batchId);
    if (!batch) {
      throw new Error('Waste batch not found');
    }

    const { dumpingFee: processingEstimatedCost } =
      CalculationService.calculateProcessingOutput(batch, DEFAULT_GAME_CONSTANTS);

    const landfillFee = Math.max(
      1,
      Math.round(processingEstimatedCost * this.LANDFILL_COST_MULTIPLIER * 100) / 100
    );

    if (team.budget < landfillFee) {
      throw new Error('Insufficient budget to send batch to landfill');
    }

    const landfillCO2 = batch.mass * DEFAULT_GAME_CONSTANTS.CO2_FACTOR_LANDFILL * this.LANDFILL_CO2_MULTIPLIER;

    team.budget -= landfillFee;
    team.totalCO2 += landfillCO2;
    team.totalLandfillTons += batch.mass;
    team.wasteInventory -= batch.mass;
    batch.status = 'FAILED';
    team.mrfQueue.splice(queueIndex, 1);

    team.activityLog.unshift(
      `[MRF] Sent ${batch.mass.toFixed(1)} tons waste directly to landfill ` +
        `(Cost: $${landfillFee.toFixed(0)}, CO2: +${landfillCO2.toFixed(1)}t)`
    );

    await GameService.updateTeamData(sessionId, team);

        const updatedGameState = await GameService.getGameState(sessionId);
    if (updatedGameState) {
      WebSocketService.broadcastGameStateUpdate(sessionId, updatedGameState, 'waste-landfilled', {
        queueId,
        batchId: batch.id,
        batchMass: batch.mass,
        landfillFee,
        landfillCO2,
      });

      const roomCode = updatedGameState.roomCode;
      const gameTeam = updatedGameState.teams?.find((t: any) => t.sessionId === sessionId);
      if (roomCode && gameTeam?.teamId) {
        await AdminMonitorTelemetryService.logWasteBatchToDestination({
          roomCode,
          teamId: gameTeam.teamId,
          sessionId,
          citySlot: gameTeam.citySlot || 0,
          source: 'mrf.queue',
          destination: 'landfill',
          mass: batch.mass,
          composition: batch.composition as any,
          metadata: {
            action: 'mrf.send-to-landfill',
            batchId: batch.id,
            queueId,
          },
        });
      }
    }


    WebSocketService.broadcastPlayerAction(
      sessionId,
      playerId,
      'MRF',
      `landfilled ${batch.mass.toFixed(1)}t waste (Cost: $${landfillFee.toFixed(0)}, CO₂: +${landfillCO2.toFixed(1)}t)`
    );

    return team;
  }

  // ✅ Assign grade and price to pending auction

  static async assignGrade(
    sessionId: string,
    auctionId: string,
    grade: 'A' | 'B' | 'C' | 'F',
    customPrice: number
  ): Promise<TeamData> {
    const team = await GameService.getTeamData(sessionId);
    if (!team) {
      throw new Error('Team not found');
    }

    if (team.isEliminated || team.gameStatus !== 'active') {
      throw new Error('Team is eliminated or game is not active');
    }

    // ✅ Find the auction
    const auctionIndex = team.marketplaceListing.findIndex(
      a => a.auctionId === auctionId && (a.status === 'pending' || a.status === 'active')
    );
    
    if (auctionIndex === -1) {
      throw new Error('Auction not found');
    }

    const auction = team.marketplaceListing[auctionIndex];

    if (auction.originTeam !== sessionId) {
      throw new Error('Auction not owned by this team');
    }

    if (grade === 'F') {
      // ✅ Failed material must be disposed
      const disposalCost = auction.mass * DEFAULT_GAME_CONSTANTS.DUMPING_FEE;
      const disposalCO2 = auction.mass * DEFAULT_GAME_CONSTANTS.CO2_FACTOR_LANDFILL;

      if (team.budget >= disposalCost) {
        team.budget -= disposalCost;
        team.totalCO2 += disposalCO2;
        team.totalLandfillTons += auction.mass;

        // Remove auction
        team.marketplaceListing.splice(auctionIndex, 1);

        team.activityLog.unshift(
          `[MRF] Disposed ${auction.mass.toFixed(1)} tons of Grade F ${auction.materialType} ` +
          `(Cost: $${disposalCost.toFixed(0)}, CO2: +${disposalCO2.toFixed(1)}t)`
        );
      } else {
        throw new Error('Insufficient budget for disposal of failed material');
      }
    } else {
      // ✅ Assign grade and price, then activate auction
      auction.grade = grade;
      auction.currentBid = customPrice;
      auction.entryPrice = customPrice;

      if (auction.status === 'pending') {
        // Activate the auction
        auction.status = 'active';
        auction.endTime = Date.now() + DEFAULT_GAME_CONSTANTS.AUCTION_DURATION_SECONDS * 1000;

        // Schedule auction resolution
        BrokerService.scheduleAuctionResolution(
          sessionId,
          auctionId,
          DEFAULT_GAME_CONSTANTS.AUCTION_DURATION_SECONDS * 1000
        );

        team.activityLog.unshift(
          `[MRF] Listed ${auction.mass.toFixed(1)} tons ${auction.materialType} for auction ` +
          `(Grade ${grade}, Entry price: $${auction.entryPrice.toFixed(0)})`
        );
      } else {
        team.activityLog.unshift(
          `[MRF] Updated auction ${auctionId} to Grade ${grade} ` +
          `(New entry price: $${auction.entryPrice.toFixed(0)})`
        );
      }
    }

        // ✅ Update team data
    await GameService.updateTeamData(sessionId, team);

        const updatedGameState = await GameService.getGameState(sessionId);
    if (updatedGameState) {
      WebSocketService.broadcastGameStateUpdate(sessionId, updatedGameState, 'material-graded', {
        auctionId,
        grade,
        customPrice,
      });

      if (grade === 'F') {
        const roomCode = updatedGameState.roomCode;
        const gameTeam = updatedGameState.teams?.find((t: any) => t.sessionId === sessionId);
        if (roomCode && gameTeam?.teamId) {
          await AdminMonitorTelemetryService.logMaterialFlowEvent({
            roomCode,
            teamId: gameTeam.teamId,
            sessionId,
            citySlot: gameTeam.citySlot || 0,
            flowClass: 'material',
            source: 'mrf.pending_auction',
            destination: 'landfill',
            materialType: auction.materialType,
            amount: auction.mass,
            metadata: {
              action: 'mrf.assign-grade',
              grade,
              auctionId,
            },
          });
        }
      }
    }


        // ✅ Broadcast player action
    if (grade === 'F') {
      WebSocketService.broadcastPlayerAction(
        sessionId,
        '',
        'MRF',
        `disposed ${auction.mass.toFixed(1)}t Grade F ${auction.materialType} (landfill)`
      );
    } else {
      WebSocketService.broadcastPlayerAction(
        sessionId,
        '',
        'MRF',
        `listed ${auction.mass.toFixed(1)}t ${auction.materialType} for auction (Grade ${grade}, Price: $${customPrice.toFixed(0)})`
      );
    }

    return team;
  }

  static async sendBackToMunicipalityWithTransport(
    sessionId: string,
    auctionId: string,
    playerId: string,
    mode: 'fast' | 'slow'
  ): Promise<TeamData> {
    const team = await GameService.getTeamData(sessionId);
    if (!team) {
      throw new Error('Team not found');
    }

    if (team.isEliminated || team.gameStatus !== 'active') {
      throw new Error('Team is eliminated or game is not active');
    }

    const auctionIndex = team.marketplaceListing.findIndex(
      (auction) =>
        auction.auctionId === auctionId &&
        auction.status === 'pending' &&
        auction.originTeam === sessionId
    );

    if (auctionIndex === -1) {
      throw new Error('Pending recycled material batch not found');
    }

    const auction = team.marketplaceListing[auctionIndex];
    const transportCost = auction.mass * this.TRANSPORT_COSTS[mode];
    const transportCO2 = CalculationService.calculateCO2FromTransport(1, DEFAULT_GAME_CONSTANTS);

    if (team.budget < transportCost) {
      throw new Error(
        `Insufficient budget. ${mode} transport costs $${transportCost.toFixed(2)} but your budget is $${team.budget.toFixed(2)}.`
      );
    }

    team.budget -= transportCost;
    team.totalCO2 += transportCO2;
    team.totalTransportTrips += 1;

    const now = Date.now();
    const pseudoWasteBatch = {
      id: `mrf-${auction.auctionId}`,
      playerId,
      turnGenerated: 0,
      generationTime: now,
      origin: 'Industrial' as const,
      mass: auction.mass,
      composition: {
        paper: 0,
        plastic: 0,
        metal: 0,
        glass: 0,
        wood: 0,
      },
      status: 'IN_TRANSIT' as const,
      collectionDeadline: now,
      lockToken: null,
      lockedAt: null,
      penalized: false,
    };

    const activeTransport = {
      id: `transport-${uuidv4().slice(0, 8)}`,
      batchId: `auction-${auction.auctionId}`,
      wasteBatch: pseudoWasteBatch,
      mode,
      startTime: now,
      endTime: now + this.TRANSPORT_DURATIONS[mode],
      cost: transportCost,
      co2Emission: transportCO2,
      status: 'in-transit' as const,
      purpose: 'mrf-to-municipality' as const,
      materialType: auction.materialType,
    };

    if (!team.activeTransports) {
      team.activeTransports = [];
    }
    team.activeTransports.push(activeTransport);

    // Reserve material so it can no longer be listed/selected for auction
    team.marketplaceListing.splice(auctionIndex, 1);

    const timerKey = `${sessionId}:${activeTransport.id}`;
    const existingTimer = this.transportTimers.get(timerKey);
    if (existingTimer) {
      clearTimeout(existingTimer);
      this.transportTimers.delete(timerKey);
    }

    const timer = setTimeout(async () => {
      this.transportTimers.delete(timerKey);
      try {
        await this.completeMrfMaterialTransports(sessionId);
      } catch {
        // Fallback path is periodic system-check
      }
    }, Math.max(0, activeTransport.endTime - now));

    this.transportTimers.set(timerKey, timer);

    team.activityLog.unshift(
      `[MRF] Started ${mode} transport: ${auction.mass.toFixed(1)} tons ${auction.materialType} back to Municipality inventory ` +
        `(Cost: $${transportCost.toFixed(0)}, CO₂: +${transportCO2.toFixed(1)}t, ETA: ${this.TRANSPORT_DURATIONS[mode] / 1000}s)`
    );

    await GameService.updateTeamData(sessionId, team);

    const updatedGameState = await GameService.getGameState(sessionId);
    if (updatedGameState) {
      WebSocketService.broadcastGameStateUpdate(sessionId, updatedGameState, 'transport-started', {
        transportId: activeTransport.id,
        mode,
        batchMass: auction.mass,
        materialType: auction.materialType,
        durationMs: this.TRANSPORT_DURATIONS[mode],
        endTime: activeTransport.endTime,
        activeCount: team.activeTransports.length,
        source: 'mrf',
        destination: 'municipality',
      });
    }

    WebSocketService.broadcastPlayerAction(
      sessionId,
      playerId,
      'MRF',
      `started ${mode} transport of ${auction.mass.toFixed(1)}t ${auction.materialType} back to Municipality ($${transportCost.toFixed(0)})`
    );

    return team;
  }

  static async completeMrfMaterialTransports(sessionId: string): Promise<TeamData | null> {
    const team = await GameService.getTeamData(sessionId);
    if (!team || team.isEliminated || !team.activeTransports?.length) {
      return null;
    }

    const now = Date.now();
    let hasChanges = false;
    const completedTransports: Array<{
      batchId: string;
      batchMass: number;
      mode: 'fast' | 'slow';
      activeCount: number;
      source: 'mrf';
      destination: 'municipality';
      materialType: string;
    }> = [];

    for (let i = team.activeTransports.length - 1; i >= 0; i--) {
      const transport = team.activeTransports[i];

      if (
        transport.status === 'in-transit' &&
        transport.purpose === 'mrf-to-municipality' &&
        now >= transport.endTime &&
        transport.materialType
      ) {
        const materialType = transport.materialType;
        const mass = transport.wasteBatch.mass;

        team.municipalInventory[materialType] += mass;
        team.activeTransports.splice(i, 1);

        team.activityLog.unshift(
          `[System] ${transport.mode.toUpperCase()} transport completed! ${mass.toFixed(1)} tons ${materialType} delivered to Municipality inventory.`
        );

        hasChanges = true;
        completedTransports.push({
          batchId: transport.batchId,
          batchMass: mass,
          mode: transport.mode,
          activeCount: team.activeTransports.length,
          source: 'mrf',
          destination: 'municipality',
          materialType,
        });

        const timerKey = `${sessionId}:${transport.id}`;
        const existingTimer = this.transportTimers.get(timerKey);
        if (existingTimer) {
          clearTimeout(existingTimer);
          this.transportTimers.delete(timerKey);
        }
      }
    }

    if (!hasChanges) {
      return team;
    }

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

        WebSocketService.broadcastPlayerAction(
          sessionId,
          '',
          'System',
          `${completed.batchMass.toFixed(1)}t ${completed.materialType} arrived at Municipality inventory`
        );
      }
    }

    return team;
  }
}