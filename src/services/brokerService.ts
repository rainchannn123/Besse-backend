import { Auction, GameState, TeamData } from '../types';
import { DEFAULT_GAME_CONSTANTS } from '../constants/constants';
import { GameService } from './gameService';
import { WebSocketService } from './websocketService';
import { logger } from '../utils/logger';

type AuctionResolutionResult = {
  finalStatus: 'sold' | 'pending';
  finalPrice: number;
  winnerSessionId: string | null;
  sellerPayout: number;
  serviceFee: number;
  returnedToMRF: boolean;
};

export class BrokerService {
  private static auctionTimers: Map<string, NodeJS.Timeout> = new Map();
  private static readonly SELLER_PAYOUT_RATE = 0.9;


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

                const resolution = await this.resolveAuction(gameState, team, auction, sessionId);

        await GameService.updateTeamData(sessionId, team);

        await GameService.updateGameState(sessionId, gameState);

                const actionDetails = {
          auctionId,
          materialType: auction.materialType,
          mass: auction.mass,
          winner: auction.highBidder,
          winnerSessionId: resolution.winnerSessionId,
          finalPrice: resolution.finalPrice,
          finalStatus: resolution.finalStatus,
          sellerPayout: resolution.sellerPayout,
          serviceFee: resolution.serviceFee,
          returnedToMRF: resolution.returnedToMRF,
        };


        // Broadcast to all teams in the room
        this.broadcastToRoom(gameState, 'auction-resolved', actionDetails);

                // Also push authoritative game-state updates to each team session
        for (const roomTeam of gameState.teams) {
          const teamGameState = await GameService.getGameState(roomTeam.sessionId);
          if (teamGameState) {
            WebSocketService.emitToGameRoom(roomTeam.sessionId, 'game-state-updated', {
              gameState: teamGameState,
              actionType: 'auction-resolved',
              actionDetails,
            });
          }
        }

        if (gameState.roomCode) {
          WebSocketService.emitAdminTelemetryUpdate(gameState.roomCode, {
            actionType: 'auction-resolved',
            source: 'broker',
            sessionId,
            auctionId,
          });
        }

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
    const sessionRole: Record<string, string> = {};

    for (const t of gameState.teams) {
      sessionRole[t.sessionId] = `City ${t.citySlot}`;
    }

    for (const team of gameState.teams) {
      const auctions = team.marketplaceListing.filter(
        auction => auction.status === 'active' || auction.status === 'sold'
      );

      for (const auction of auctions) {
        const highBidderTeamRole = auction.highBidderSessionId
          ? sessionRole[auction.highBidderSessionId] || null
          : null;

        const winnerTeamRole =
          auction.status === 'sold' && auction.highBidder ? highBidderTeamRole : null;

        allAuctions.push({
          ...auction,
          sellerTeam: team.teamName,
          sellerCitySlot: team.citySlot,
          sellerSessionId: team.sessionId,
          sellerTeamRole: sessionRole[team.sessionId] || team.teamName,
          highBidderTeamRole,
          winnerTeamRole,
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
    const entryPrice = auction.entryPrice ?? auction.currentBid;
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
    this.broadcastToRoom(gameState, 'bid-placed', {
      auctionId,
      materialType: auction.materialType,
      newBid: parseFloat(newBidAmount.toFixed(2)),
      bidderTeam: team.teamName,
      bidderCity: team.citySlot,
      sellerCity: auctionTeam.citySlot,
      timeRemaining,
    });

    const updatedGameState = await GameService.getGameState(sessionId);
    if (updatedGameState) {
      WebSocketService.broadcastGameStateUpdate(sessionId, updatedGameState, 'bid-placed', {
        auctionId,
        newBid: parseFloat(newBidAmount.toFixed(2)),
      });
    }

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
  ): Promise<AuctionResolutionResult> {
    const finalPrice = auction.currentBid;

    if (!auction.highBidder || !auction.highBidderSessionId) {
      auction.status = 'pending';
      auction.endTime = 0;
      auction.highBidder = null;
      auction.highBidderSessionId = null;
      auction.currentBid = auction.entryPrice ?? auction.currentBid;

      team.activityLog.unshift(
        `[Broker] No bids for ${auction.mass.toFixed(1)}t ${auction.materialType}. Material returned to MRF Materials Ready.`
      );

      return {
        finalStatus: 'pending',
        finalPrice,
        winnerSessionId: null,
        sellerPayout: 0,
        serviceFee: 0,
        returnedToMRF: true,
      };
    }

    const buyerSessionId = auction.highBidderSessionId;
    const buyerTeam = gameState.teams.find((t) => t.sessionId === buyerSessionId);

    if (!buyerTeam || buyerTeam.isEliminated || buyerTeam.gameStatus !== 'active') {
      auction.status = 'pending';
      auction.endTime = 0;
      auction.highBidder = null;
      auction.highBidderSessionId = null;
      auction.currentBid = auction.entryPrice ?? auction.currentBid;

      team.activityLog.unshift(
        `[Broker] Winning bidder unavailable for ${auction.mass.toFixed(1)}t ${auction.materialType}. Material returned to MRF Materials Ready.`
      );

      return {
        finalStatus: 'pending',
        finalPrice,
        winnerSessionId: null,
        sellerPayout: 0,
        serviceFee: 0,
        returnedToMRF: true,
      };
    }

    // Winning team pays full bid. Seller receives 90%; 10% is marketplace service fee.
    const sellerPayout = parseFloat((finalPrice * this.SELLER_PAYOUT_RATE).toFixed(2));
    const serviceFee = parseFloat((finalPrice - sellerPayout).toFixed(2));

    buyerTeam.municipalInventory[auction.materialType] += auction.mass;
    buyerTeam.budget -= finalPrice;

    if (buyerTeam.activeBids && auction.highBidder) {
      buyerTeam.activeBids[auction.highBidder] = Math.max(
        0,
        (buyerTeam.activeBids[auction.highBidder] || 1) - 1
      );
    }

    buyerTeam.activityLog.unshift(
      `[Broker] Acquired ${auction.mass.toFixed(1)}t ${auction.materialType} from City ${team.citySlot} for $${finalPrice.toFixed(0)}`
    );

    team.budget += sellerPayout;
    team.activityLog.unshift(
      `[Broker] Sold ${auction.mass.toFixed(1)}t ${auction.materialType} to City ${buyerTeam.citySlot} for $${finalPrice.toFixed(0)} (Payout: $${sellerPayout.toFixed(0)}, Fee: $${serviceFee.toFixed(0)})`
    );

    const txId = `tx-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    team.transactions.push({
      id: txId,
      turn: 1,
      buyer: `City ${buyerTeam.citySlot}`,
      seller: `City ${team.citySlot}`,
      itemType: auction.materialType,
      itemId: auction.auctionId,
      mass: auction.mass,
      price: finalPrice,
      transactionType: 'external_sale',
      revenue: sellerPayout,
    });

    buyerTeam.transactions.push({
      id: `${txId}-b`,
      turn: 1,
      buyer: `City ${buyerTeam.citySlot}`,
      seller: `City ${team.citySlot}`,
      itemType: auction.materialType,
      itemId: auction.auctionId,
      mass: auction.mass,
      price: finalPrice,
      transactionType: 'external_sale',
      revenue: -finalPrice,
    });

    auction.status = 'sold';

    await GameService.updateTeamData(buyerTeam.sessionId, buyerTeam);

    return {
      finalStatus: 'sold',
      finalPrice,
      winnerSessionId: buyerSessionId,
      sellerPayout,
      serviceFee,
      returnedToMRF: false,
    };
  }


  // ============================================
  // BUY FROM EXTERNAL WHOLESALER
  // ============================================

    static async buyFromExternalWholesaler(
    sessionId: string,
    materialType: 'paper' | 'plastic' | 'metal' | 'glass' | 'wood',
    requestedAmount: number,
    _playerId: string
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

    const updatedGameState = await GameService.getGameState(sessionId);
    if (updatedGameState) {
      WebSocketService.broadcastGameStateUpdate(sessionId, updatedGameState, 'external-purchase', {
        materialType,
        requestedAmount,
        cost,
      });
    }

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

        const resolutionResults: Array<{ auction: Auction; resolution: AuctionResolutionResult }> = [];

    for (const auction of expiredAuctions) {
      const resolution = await this.resolveAuction(gameState, team, auction, sessionId);
      resolutionResults.push({ auction, resolution });
    }


        if (expiredAuctions.length > 0) {
      await GameService.updateTeamData(sessionId, team);
      await GameService.updateGameState(sessionId, gameState);

            for (const { auction, resolution } of resolutionResults) {
        const actionDetails = {
          auctionId: auction.auctionId,
          materialType: auction.materialType,
          mass: auction.mass,
          winner: auction.highBidder,
          winnerSessionId: resolution.winnerSessionId,
          finalPrice: resolution.finalPrice,
          finalStatus: resolution.finalStatus,
          sellerPayout: resolution.sellerPayout,
          serviceFee: resolution.serviceFee,
          returnedToMRF: resolution.returnedToMRF,
        };


        this.broadcastToRoom(gameState, 'auction-resolved', actionDetails);

                for (const roomTeam of gameState.teams) {
          const teamGameState = await GameService.getGameState(roomTeam.sessionId);
          if (teamGameState) {
            WebSocketService.emitToGameRoom(roomTeam.sessionId, 'game-state-updated', {
              gameState: teamGameState,
              actionType: 'auction-resolved',
              actionDetails,
            });
          }
        }

        if (gameState.roomCode) {
          WebSocketService.emitAdminTelemetryUpdate(gameState.roomCode, {
            actionType: 'auction-resolved',
            source: 'broker',
            sessionId,
            auctionId: auction.auctionId,
          });
        }
      }

    }

    return team;
  }

  // ============================================
  // HELPER METHODS
  // ============================================

    private static constants() {
    return DEFAULT_GAME_CONSTANTS;
  }

  private static broadcastToRoom(gameState: GameState, event: string, data: any) {
    for (const team of gameState.teams) {
      WebSocketService.emitToGameRoom(team.sessionId, event, {
        ...data,
        roomCode: gameState.roomCode,
      });
    }
  }

  // ============================================
  // LEGACY METHODS (Kept for compatibility)
  // ============================================

    static async getActiveAuctionsFromStates(_gameStates: GameState[]): Promise<any[]> {
    // Legacy - will be phased out
    return [];
  }
}