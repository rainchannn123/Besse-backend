import { v4 as uuidv4 } from 'uuid';
import { TeamData } from '../types';
import { DEFAULT_GAME_CONSTANTS } from '../constants/constants';
import { BrokerService } from './brokerService';
import { CalculationService } from './calculationService';
import { GameService } from './gameService';
import { WebSocketService } from './websocketService';

export class MRFService {
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

    // ✅ Broadcast player action
    WebSocketService.broadcastPlayerAction(
      sessionId,
      playerId,
      'MRF',
      `processed ${batch.mass.toFixed(1)}t waste → ${materials.length} materials (Refuse: ${refuseMass.toFixed(1)}t, CO₂: +${(processingCO2 + landfillCO2).toFixed(1)}t)`
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
}