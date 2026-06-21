import { Auction, GameState, TeamData } from '../types';
import { GameService } from './gameService';
import GameSession from '../models/GameSession';
import MatchmakingRoom from '../models/MatchmakingRoom';
import { WebSocketService } from './websocketService';
import { logger } from '../utils/logger';

export class BrokerService {
  private static auctionTimers: Map<string, NodeJS.Timeout> = new Map();

  // ============================================
  // SCHEDULE AUCTION RESOLUTION
  // ============================================

  static scheduleAuctionResolution(
    sessionId: string,
    auctionId: string,
    delayMs: number
  ): void {
    const existing = this.auctionTimers.get(auctionId);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(async () => {
      this.auctionTimers.delete(auctionId);
      try {
        const gameState = await GameService.getGameState(sessionId);
        if (!gameState || gameState.gameStatus !== 'active') return;

        // Find the auction in the team's marketplace
        const team = gameState.teams.find(t => t.sessionId === sessionId);
        if (!team) return;

        const auction = team.marketplaceListing.find(
          a => a.auctionId === auctionId && a.status === 'active'
        );
        if (!auction) return;

        await this.resolveAuction(gameState, team, auction, sessionId);

        // Update auction status
        const idx = team.marketplaceListing.findIndex(a => a.auctionId === auctionId);
        if (idx !== -1) {
          team.marketplaceListing[idx].status = 'sold';
        }

        await GameService.updateTeamData(sessionId, team);
        await GameService.updateGameState(sessionId, gameState);

        // Broadcast to all teams in the room
        this.broadcastToRoom(gameState.roomCode!, 'auction-resolved', {
          auctionId,
          materialType: auction.materialType,
          mass: auction.mass,
          winner: auction.highBidder,
          finalPrice: auction.currentBid,
        });

        logger.info(`[BrokerService] Auction ${auctionId} resolved immediately`);
      } catch (err) {
        logger.error(`[BrokerService] Failed to resolve auction ${auctionId}:`, err);
      }
    }, delayMs);

    this.auctionTimers.set(auctionId, timer);
  }

  // ============================================
  // GET ACTIVE AUCTIONS FROM ROOM
  // ============================================

  static async getRoomAuctions(sessionId: string): Promise<any[]> {
    const gameState = await GameService.getGameState(sessionId);
    if (!gameState) return [];

    const allAuctions: any[] = [];

    for (const team of gameState.teams) {
      const auctions = team.marketplaceListing.filter(
        auction => auction.status === 'active' || auction.status === 'sold'
      );

      for (const auction of auctions) {
        allAuctions.push({
          ...auction,
          sellerTeam: team.teamName,
          sellerCitySlot: team.citySlot,
          sellerSessionId: team.sessionId,
        });
      }
    }

    return allAuctions.sort((a, b) => {
      if (a.status === 'active' && b.status !== 'active') return -1;
      if (a.status !== 'active' && b.status === 'active') return 1;
      return a.endTime - b.endTime;
    });
  }

  // ============================================
  // PLACE BID (Multi-Team)
  // ============================================

  static async placeBid(
    sessionId: string,
    auctionId: string,
    playerId: string
  ): Promise<TeamData> {
    const team = await GameService.getTeamData(sessionId);
    if (!team) throw new Error('Team not found');
    if (team.isEliminated || team.gameStatus !== 'active') {
      throw new Error('Team is eliminated or game is over');
    }

    const gameState = await GameService.getGameState(sessionId);
    if (!gameState) throw new Error('Game state not found');

    const now = Date.now();

    if (!team.activeBids) team.activeBids = {};
    const playerActiveBids = team.activeBids[playerId] || 0;

    // ✅ Find auction in ANY team in the room
    let auction: Auction | null = null;
    let auctionTeam: TeamData | null = null;
    let auctionTeamSessionId: string | null = null;

    for (const t of gameState.teams) {
      const found = t.marketplaceListing.find(
        a => a.auctionId === auctionId && a.status === 'active' && a.endTime > now
      );
      if (found) {
        auction = found;
        auctionTeam = t;
        auctionTeamSessionId = t.sessionId;
        break;
      }
    }

    if (!auction || !auctionTeam || !auctionTeamSessionId) {
      throw new Error('Auction not found or not active');
    }

    // ✅ Check if auction is from own team
    if (auctionTeamSessionId === sessionId) {
      throw new Error('You cannot bid on your own auction');
    }

    // Calculate new bid
    const entryPrice = auction.entryPrice;
    const bidIncrement = entryPrice * this.constants().AUCTION_BID_INCREMENT_RATE;
    const newBidAmount = auction.currentBid + bidIncrement;

    // Budget check
    if (team.budget < newBidAmount) {
      throw new Error(
        `Insufficient budget. Need $${newBidAmount.toFixed(0)} but have $${team.budget.toFixed(0)}`
      );
    }

    // Update auction
    const previousHighBidder = auction.highBidder;
    const previousHighBidderSessionId = auction.highBidderSessionId;
    auction.currentBid = newBidAmount;
    auction.highBidder = playerId;
    auction.highBidderSessionId = sessionId;

    // Decrement previous bidder's active bids
    if (previousHighBidder && previousHighBidder !== playerId && previousHighBidderSessionId) {
      const prevTeam = gameState.teams.find(t => t.sessionId === previousHighBidderSessionId);
      if (prevTeam && prevTeam.activeBids) {
        prevTeam.activeBids[previousHighBidder] = (prevTeam.activeBids[previousHighBidder] || 1) - 1;
        await GameService.updateTeamData(previousHighBidderSessionId, prevTeam);
      }
    }

    // Increment current player's active bids
    team.activeBids[playerId] = playerActiveBids + 1;

    team.activityLog.unshift(
      `[Broker] Placed bid of $${newBidAmount.toFixed(0)} on ${auction.mass.toFixed(1)}t ${auction.materialType} from City ${auctionTeam.citySlot}`
    );

    // Update auction team's listing
    const auctionIdx = auctionTeam.marketplaceListing.findIndex(a => a.auctionId === auctionId);
    if (auctionIdx !== -1) {
      auctionTeam.marketplaceListing[auctionIdx] = auction;
    }

    // Save both teams
    await GameService.updateTeamData(sessionId, team);
    await GameService.updateTeamData(auctionTeamSessionId, auctionTeam);
    await GameService.updateGameState(sessionId, gameState);

    // ✅ Broadcast to ALL teams in the room
    const timeRemaining = Math.max(0, Math.floor((auction.endTime - Date.now()) / 1000));
    this.broadcastToRoom(gameState.roomCode!, 'bid-placed', {
      auctionId,
      materialType: auction.materialType,
      newBid: parseFloat(newBidAmount.toFixed(2)),
      bidderTeam: team.teamName,
      bidderCity: team.citySlot,
      sellerCity: auctionTeam.citySlot,
      timeRemaining,
    });

    return team;
  }

  // ============================================
  // RESOLVE AUCTION
  // ============================================

  private static async resolveAuction(
    gameState: GameState,
    team: TeamData,
    auction: Auction,
    sessionId: string
  ): Promise<void> {
    if (!auction.highBidder) {
      // No bids - liquidation
      const liquidationPrice = auction.currentBid * 0.5;
      team.budget += liquidationPrice;
      team.activityLog.unshift(
        `[Broker] ⚠️ No bids for ${auction.mass.toFixed(1)}t ${auction.materialType}. Liquidated for $${liquidationPrice.toFixed(0)}`
      );
      return;
    }

    // ✅ Check if it's a self-win or external sale
    const isSelfWin = auction.highBidderSessionId === auction.originTeam;

    if (isSelfWin) {
      // Internal transfer (same team)
      team.municipalInventory[auction.materialType] += auction.mass;
      team.activityLog.unshift(
        `[Broker] ✅ Secured ${auction.mass.toFixed(1)}t ${auction.materialType} internally at $${auction.currentBid.toFixed(0)}`
      );
    } else {
      // External sale - find the buyer's team
      const buyerSessionId = auction.highBidderSessionId;
      const buyerTeam = gameState.teams.find(t => t.sessionId === buyerSessionId);

      if (buyerTeam && !buyerTeam.isEliminated) {
        // Transfer material to buyer
        buyerTeam.municipalInventory[auction.materialType] += auction.mass;
        buyerTeam.budget -= auction.currentBid;
        buyerTeam.activityLog.unshift(
          `[Broker] ✅ Acquired ${auction.mass.toFixed(1)}t ${auction.materialType} from City ${team.citySlot} for $${auction.currentBid.toFixed(0)}`
        );

        // Seller receives payment
        team.budget += auction.currentBid;
        team.activityLog.unshift(
          `[Broker] ✅ Sold ${auction.mass.toFixed(1)}t ${auction.materialType} to City ${buyerTeam.citySlot} for $${auction.currentBid.toFixed(0)}`
        );

        // // Winning team must pay the final bid from its budget
        // gameState.budget -= auction.currentBid;

        // Record transaction for seller
        team.transactions.push({
          id: `tx-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          turn: 1,
          buyer: `City ${buyerTeam.citySlot}`,
          seller: `City ${team.citySlot}`,
          itemType: auction.materialType,
          itemId: auction.auctionId,
          mass: auction.mass,
          price: auction.currentBid,
          transactionType: 'external_sale',
          revenue: auction.currentBid,
        });

        // Record transaction for buyer
        buyerTeam.transactions.push({
          id: `tx-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          turn: 1,
          buyer: `City ${buyerTeam.citySlot}`,
          seller: `City ${team.citySlot}`,
          itemType: auction.materialType,
          itemId: auction.auctionId,
          mass: auction.mass,
          price: auction.currentBid,
          transactionType: 'external_sale',
          revenue: -auction.currentBid,
        });

        await GameService.updateTeamData(buyerTeam.sessionId, buyerTeam);
      } else {
        // Buyer team not found or eliminated - liquidation
        const liquidationPrice = auction.currentBid * 0.5;
        team.budget += liquidationPrice;
        team.activityLog.unshift(
          `[Broker] ⚠️ Buyer team eliminated. Liquidated ${auction.mass.toFixed(1)}t ${auction.materialType} for $${liquidationPrice.toFixed(0)}`
        );
      }
    }

    // Mark auction as sold
    auction.status = 'sold';
  }

  // ============================================
  // BUY FROM EXTERNAL WHOLESALER
  // ============================================

  static async buyFromExternalWholesaler(
    sessionId: string,
    materialType: 'paper' | 'plastic' | 'metal' | 'glass' | 'wood',
    requestedAmount: number,
    playerId: string
  ): Promise<TeamData> {
    const team = await GameService.getTeamData(sessionId);
    if (!team) throw new Error('Team not found');
    if (team.isEliminated || team.gameStatus !== 'active') {
      throw new Error('Team is eliminated or game is over');
    }

    const availableStock = team.externalStock[materialType];
    if (requestedAmount > availableStock) {
      throw new Error(`Only ${availableStock.toFixed(1)} tons available. Reduce quantity.`);
    }

    const basePrice = this.constants().MATERIAL_PROPERTIES[materialType].basePrice;
    const cost = basePrice * this.constants().MARKUP_CONSTANT * requestedAmount;

    if (team.budget < cost) {
      throw new Error(`Insufficient budget. Need $${cost.toFixed(0)} but have $${team.budget.toFixed(0)}`);
    }

    // Execute purchase
    team.budget -= cost;
    team.municipalInventory[materialType] += requestedAmount;
    team.externalStock[materialType] -= requestedAmount;

    team.activityLog.unshift(
      `[Broker] Purchased ${requestedAmount.toFixed(1)}t ${materialType} from External Wholesaler for $${cost.toFixed(0)}`
    );

    // Restock if empty
    if (team.externalStock[materialType] === 0) {
      const newStock = Math.floor(Math.random() * 51) + 30;
      team.externalStock[materialType] = newStock;
    }

    await GameService.updateTeamData(sessionId, team);
    return team;
  }

  // ============================================
  // GET EXTERNAL STOCK
  // ============================================

  static async getExternalStock(sessionId: string): Promise<any[]> {
    const team = await GameService.getTeamData(sessionId);
    if (!team) throw new Error('Team not found');

    const materialTypes: Array<'paper' | 'plastic' | 'metal' | 'glass' | 'wood'> = [
      'paper', 'plastic', 'metal', 'glass', 'wood'
    ];

    return materialTypes.map(materialType => {
      const basePrice = this.constants().MATERIAL_PROPERTIES[materialType].basePrice;
      return {
        materialType,
        availableAmount: team.externalStock[materialType] || 0,
        pricePerUnit: basePrice * this.constants().MARKUP_CONSTANT,
        lastUpdated: new Date().toISOString(),
      };
    });
  }

  // ============================================
  // RESOLVE EXPIRED AUCTIONS
  // ============================================

  static async resolveExpiredAuctions(sessionId: string): Promise<TeamData> {
    const team = await GameService.getTeamData(sessionId);
    if (!team) throw new Error('Team not found');

    const gameState = await GameService.getGameState(sessionId);
    if (!gameState) throw new Error('Game state not found');

    const now = Date.now();
    const expiredAuctions = team.marketplaceListing.filter(
      auction => auction.status === 'active' && auction.endTime <= now
    );

    for (const auction of expiredAuctions) {
      await this.resolveAuction(gameState, team, auction, sessionId);
      auction.status = 'sold';
    }

    if (expiredAuctions.length > 0) {
      await GameService.updateTeamData(sessionId, team);
      await GameService.updateGameState(sessionId, gameState);
    }

    return team;
  }

  // ============================================
  // HELPER METHODS
  // ============================================

  private static constants() {
    return require('../constants/constants').DEFAULT_GAME_CONSTANTS;
  }

  private static broadcastToRoom(roomCode: string, event: string, data: any) {
    WebSocketService.broadcastToAll(event, {
      ...data,
      roomCode,
      timestamp: Date.now(),
    });
  }

  // ============================================
  // LEGACY METHODS (Kept for compatibility)
  // ============================================

  static async getActiveAuctionsFromStates(gameStates: GameState[]): Promise<any[]> {
    // Legacy - will be phased out
    return [];
  }
}