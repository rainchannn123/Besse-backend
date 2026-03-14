import { v4 as uuidv4 } from 'uuid';
import { GameState } from '../types';
import { CalculationService } from './calculationService';
import { GameService } from './gameService';
import { WebSocketService } from './websocketService';

export class MRFService {
  // UPDATED: Process waste with locking mechanism as per manual section 4
  static async processWaste(
    sessionId: string,
    queueId: string,
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

    // Step A: Check if queue is locked
    if (!GameService.acquireLock(gameState, queueId, playerId, 'queue')) {
      throw new Error(
        'Another player is working on this. Try a different batch.'
      );
    }

    try {
      const queue = gameState.mrfQueue.find(q => q.id === queueId);
      if (!queue) {
        GameService.releaseLock(gameState, queueId);
        throw new Error('Queue item not found');
      }

      const batch = gameState.wasteBatches.find(b => b.id === queue.batchId);
      if (!batch) {
        GameService.releaseLock(gameState, queueId);
        throw new Error('Waste batch not found');
      }

      // Calculate processing output as per manual section 4
      const { materials, refuseMass, dumpingFee, landfillCO2 } =
        CalculationService.calculateProcessingOutput(
          batch,
          gameState.constants
        );

      // Check budget for disposal cost
      if (gameState.budget < dumpingFee) {
        GameService.releaseLock(gameState, queueId);
        throw new Error('Insufficient budget for waste disposal');
      }

      // Add CO2 from processing as per manual
      const processingCO2 = CalculationService.calculateCO2FromProcessing(
        batch.mass,
        gameState.constants
      );

      // Apply costs and CO2 as per manual
      gameState.budget -= dumpingFee;
      gameState.totalCO2 += processingCO2 + landfillCO2;
      gameState.totalLandfillTons += refuseMass;

      // Note: Health penalty is only applied if waste remains unprocessed after 5 minutes (handled in system check)

      // Create or update pending auctions for processed materials
      // UPDATED: Check if same material type already exists in pending auction, if yes increase mass, else create new
      materials.forEach(materialData => {
        // Check if a pending auction for this material type already exists for this team
        const existingAuction = gameState.marketplaceListing.find(
          auction =>
            auction.status === 'pending' &&
            auction.originTeam === sessionId &&
            auction.materialType === materialData.type
        );

        if (existingAuction) {
          // Material already exists in pending auction - just increase the mass
          existingAuction.mass += materialData.mass;
        } else {
          // Material not found in pending auctions - create new auction
          const auction = {
            auctionId: 'a-' + uuidv4().slice(0, 8),
            originTeam: sessionId,
            materialType: materialData.type,
            grade: materialData.quality, // Default grade B
            mass: materialData.mass,
            currentBid: 0, // Will be set by MRF
            entryPrice: 0, // Will be set by MRF
            highBidder: null,
            endTime: 0, // Will be set when listed
            status: 'pending' as const, // Pending MRF assignment
          };
          gameState.marketplaceListing.push(auction);
        }
      });

      // Remove from inventory and queue
      gameState.wasteInventory -= batch.mass;
      gameState.mrfQueue = gameState.mrfQueue.filter(q => q.id !== queueId);

      gameState.activityLog.unshift(
        `[MRF] Processed ${batch.mass.toFixed(1)} tons waste → ${materials.length} materials ` +
          `(Refuse: ${refuseMass.toFixed(1)} tons, Disposal: $${dumpingFee.toFixed(0)}, CO2: +${(
            processingCO2 + landfillCO2
          ).toFixed(1)}t)`
      );

      // Recalculate all core metrics after action (as per manual section 2.2)
      GameService.recalculateCoreMetrics(gameState);

      // Release lock
      GameService.releaseLock(gameState, queueId);

      await GameService.updateGameState(sessionId, gameState);

      // Broadcast real-time update to all players
      WebSocketService.broadcastGameStateUpdate(
        sessionId,
        gameState,
        'waste-processed',
        {
          queueId: queueId,
          batchId: batch.id,
          batchMass: batch.mass,
          materialsCreated: materials.length,
          refuseMass: parseFloat(refuseMass.toFixed(1)),
          dumpingFee: parseFloat(dumpingFee.toFixed(2)),
          totalCO2Added: parseFloat((processingCO2 + landfillCO2).toFixed(1)),
        }
      );

      // Also emit full game state payload for clients
      try {
        GameService.emitFullGameState(sessionId, gameState, 'waste-processed', {
          queueId: queueId,
          batchId: batch.id,
          batchMass: batch.mass,
          materialsCreated: materials.length,
          refuseMass: parseFloat(refuseMass.toFixed(1)),
          dumpingFee: parseFloat(dumpingFee.toFixed(2)),
          totalCO2Added: parseFloat((processingCO2 + landfillCO2).toFixed(1)),
        });
      } catch (err) {
        // ignore
      }

      return gameState;
    } catch (error) {
      // Ensure lock is released on error
      GameService.releaseLock(gameState, queueId);
      throw error;
    }
  }

  // UPDATED: Assign grade and price to pending auction, then activate it
  static async assignGrade(
    sessionId: string,
    auctionId: string,
    grade: 'A' | 'B' | 'C' | 'F',
    customPrice: number
  ): Promise<GameState> {
    const gameState = await GameService.getGameState(sessionId);
    if (!gameState) {
      throw new Error('Game session not found');
    }

    if (gameState.gameStatus !== 'active') {
      throw new Error('Game is not active');
    }

    // Find the auction (can be pending or active)
    const auction = gameState.marketplaceListing.find(
      a =>
        a.auctionId === auctionId &&
        (a.status === 'pending' || a.status === 'active')
    );
    if (!auction) {
      throw new Error('Auction not found');
    }

    if (auction.originTeam !== sessionId) {
      throw new Error('Auction not owned by this team');
    }

    if (grade === 'F') {
      // Failed material must be disposed
      const disposalCost = auction.mass * gameState.constants.DUMPING_FEE;
      const disposalCO2 =
        auction.mass * gameState.constants.CO2_FACTOR_LANDFILL;

      if (gameState.budget >= disposalCost) {
        gameState.budget -= disposalCost;
        gameState.totalCO2 += disposalCO2;
        gameState.totalLandfillTons += auction.mass;

        // Remove auction
        gameState.marketplaceListing = gameState.marketplaceListing.filter(
          a => a.auctionId !== auctionId
        );

        gameState.activityLog.unshift(
          `[MRF] Disposed ${auction.mass.toFixed(1)} tons of Grade F ${auction.materialType} ` +
            `(Cost: $${disposalCost.toFixed(0)}, CO2: +${disposalCO2.toFixed(1)}t)`
        );
      } else {
        throw new Error('Insufficient budget for disposal of failed material');
      }
    } else {
      // Assign grade and price, then activate auction
      auction.grade = grade;

      // Set currentBid and entryPrice to customPrice (entry/starting price set by MRF)
      // entryPrice is immutable and won't change when bids are placed
      auction.currentBid = customPrice;
      auction.entryPrice = customPrice; // Save entry price - won't change on bids
      auction.startingPrice = customPrice; // Keep for backward compatibility

      if (auction.status === 'pending') {
        // Activate the auction
        auction.status = 'active';
        auction.endTime =
          Date.now() + gameState.constants.AUCTION_DURATION_SECONDS * 1000;

        gameState.activityLog.unshift(
          `[MRF] Listed ${auction.mass.toFixed(1)} tons ${auction.materialType} for auction ` +
            `(Grade ${grade}, Entry price: $${auction.entryPrice.toFixed(0)})`
        );
      } else {
        // Update existing active auction
        gameState.activityLog.unshift(
          `[MRF] Updated auction ${auctionId} to Grade ${grade} ` +
            `(New entry price: $${auction.entryPrice.toFixed(0)})`
        );
      }
    }

    // Recalculate all core metrics after action
    GameService.recalculateCoreMetrics(gameState);

    await GameService.updateGameState(sessionId, gameState);

    // Broadcast update
    WebSocketService.broadcastGameStateUpdate(
      sessionId,
      gameState,
      'auction-updated',
      {
        auctionId: auctionId,
        grade: grade,
      }
    );

    try {
      GameService.emitFullGameState(sessionId, gameState, 'auction-updated', {
        auctionId: auctionId,
        grade: grade,
      });
    } catch (err) {
      // ignore
    }

    return gameState;
  }
}
