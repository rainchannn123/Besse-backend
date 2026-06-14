import { Auction, GameState } from '../types';
import { GameService } from './gameService';
import GameSession from '../models/GameSession';
import { WebSocketService } from './websocketService';
import { logger } from '../utils/logger';

export class BrokerService {
  // Track scheduled auction timers so they can be cleared if needed
  private static auctionTimers: Map<string, NodeJS.Timeout> = new Map();

  // Helper: Find session containing a specific player
  private static async findPlayerSession(
    playerId: string
  ): Promise<GameState | null> {
    const pid = playerId.toString();
    const allGameStates = await GameService.getAllActiveGameStates();
    return (
      allGameStates.find(
        gs =>
          gs.players.municipality?.toString() === pid ||
          gs.players.mrf?.toString() === pid ||
          gs.players.broker?.toString() === pid
      ) || null
    );
  }

  /**
   * Schedule an auction to be resolved immediately when its timer expires.
   * This is called when an auction is activated, so resolution happens in
   * real-time rather than waiting for the 30-second system check.
   */
  static scheduleAuctionResolution(
    sessionId: string,
    auctionId: string,
    delayMs: number
  ): void {
    // Clear any existing timer for this auction (in case of re-activation)
    const existing = this.auctionTimers.get(auctionId);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(async () => {
      this.auctionTimers.delete(auctionId);
      try {
        // Re-read game state fresh from DB
        const gameState = await GameService.getGameState(sessionId);
        if (!gameState || gameState.gameStatus !== 'active') return;

        const auction = gameState.marketplaceListing.find(
          a => a.auctionId === auctionId && a.status === 'active'
        );
        if (!auction) return; // Already resolved by system check

        // Resolve this single auction
        await this.resolveAuction(gameState, auction, sessionId);

        // Set status to sold
        const idx = gameState.marketplaceListing.findIndex(
          a => a.auctionId === auctionId
        );
        if (idx !== -1) {
          gameState.marketplaceListing[idx].status = 'sold';
        }

        await GameService.updateGameState(sessionId, gameState);

        // Broadcast to the auction's session
        WebSocketService.broadcastSystemMessage(
          sessionId,
          `Auction for ${auction.mass.toFixed(1)}t ${auction.materialType} has been resolved`,
          'info'
        );

        await GameService.emitFullGameState(
          sessionId,
          gameState,
          'auctions-resolved',
          { auctionId, resolvedCount: 1 }
        );

        // Also broadcast to partner session so both brokers see the update
        if (gameState.partnerSessionId) {
          const partnerState = await GameService.getGameState(
            gameState.partnerSessionId
          );
          if (partnerState) {
            await GameService.emitFullGameState(
              gameState.partnerSessionId,
              partnerState,
              'auctions-resolved',
              { auctionId, resolvedCount: 1 }
            );
          }
        }

        logger.info(
          `[BrokerService] Auction ${auctionId} resolved immediately on expiry`
        );
      } catch (err) {
        logger.error(
          `[BrokerService] Failed to resolve auction ${auctionId} on schedule:`,
          err
        );
      }
    }, delayMs);

    this.auctionTimers.set(auctionId, timer);
  }
  // Get all auctions from paired game states, enriched with team role labels
  static getActiveAuctionsFromStates(gameStates: GameState[]): any[] {
    const allAuctions: any[] = [];

    // Build a lookup: sessionId → teamRole
    const sessionTeamRole: Record<string, string> = {};
    for (const gs of gameStates) {
      if (gs.sessionId && gs.teamRole) {
        sessionTeamRole[gs.sessionId] = gs.teamRole;
      }
    }

    for (const gameState of gameStates) {
      // Include active and sold auctions (not pending)
      const auctions = gameState.marketplaceListing.filter(
        auction => auction.status === 'active' || auction.status === 'sold'
      );
      for (const auction of auctions) {
        const sellerTeamRole = sessionTeamRole[auction.originTeam] || 'Unknown';

        let highBidderTeamRole: string | null = null;
        if (auction.highBidderSessionId) {
          highBidderTeamRole = sessionTeamRole[auction.highBidderSessionId] || null;
        }

        // Winner is the high bidder once auction is sold
        let winnerTeamRole: string | null = null;
        if (auction.status === 'sold' && auction.highBidder) {
          winnerTeamRole = highBidderTeamRole;
        }

        allAuctions.push({
          ...auction,
          sellerTeamRole,
          highBidderTeamRole,
          winnerTeamRole,
        });
      }
    }

    // Sort: active first (by end time asc), then sold
    return allAuctions.sort((a, b) => {
      if (a.status === 'active' && b.status !== 'active') return -1;
      if (a.status !== 'active' && b.status === 'active') return 1;
      return a.endTime - b.endTime;
    });
  }

  // NEW: Place bid on auction
  static async placeBid(
    sessionId: string,
    auctionId: string,
    playerId: string
  ): Promise<GameState> {
    const gameState = await GameService.getGameState(sessionId);
    if (!gameState) {
      throw new Error('Game session not found');
    }

    const now = Date.now(); // Get current timestamp for expiration checks

    if (gameState.gameStatus !== 'active') {
      throw new Error('Game is not active');
    }

    // Initialize activeBids if missing
    if (!gameState.activeBids) gameState.activeBids = {};

    const playerActiveBids = gameState.activeBids[playerId] || 0;

    // Find auction only within the player's paired sessions
    const pairedStates = await GameService.getPairedGameStates(playerId, sessionId);
    let auction: Auction | null = null;
    let auctionSession: GameState | null = null;

    for (const gs of pairedStates) {
      const found = gs.marketplaceListing.find(
        a =>
          a.auctionId === auctionId && a.status === 'active' && a.endTime > now
      );
      if (found) {
        auction = found;
        auctionSession = gs;
        break;
      }
    }

    if (!auction || !auctionSession) {
      throw new Error('Auction not found or not active');
    }

    // Verify auction has not expired (double-check)
    if (auction.endTime <= now) {
      throw new Error('Auction has expired. Bid cannot be placed.');
    }

    // Calculate new bid amount using entry price (immutable, set by MRF)
    const entryPrice = auction.entryPrice;
    const bidIncrement =
      entryPrice * gameState.constants.AUCTION_BID_INCREMENT_RATE;
    const newBidAmount = auction.currentBid + bidIncrement;

    // Check 2: Budget validation
    if (gameState.budget < newBidAmount) {
      throw new Error(
        `Insufficient budget. Need $${newBidAmount.toFixed(0)} but only have $${gameState.budget.toFixed(0)}.`
      );
    }

    // Update auction in the auction's session
    const previousHighBidder = auction.highBidder;
    const previousHighBidderSessionId = auction.highBidderSessionId;
    auction.currentBid = newBidAmount;
    auction.highBidder = playerId.toString();
    auction.highBidderSessionId = sessionId; // Store the bidder's sessionId for self-win detection

    // Handle active bids: decrement previous high bidder if different
    if (previousHighBidder && previousHighBidder !== playerId && previousHighBidderSessionId) {
      await GameSession.findOneAndUpdate(
        {
          sessionId: previousHighBidderSessionId,
          [`gameState.activeBids.${previousHighBidder}`]: { $gt: 0 },
        },
        { $inc: { [`gameState.activeBids.${previousHighBidder}`]: -1 } }
      );
    }

    // Increment player's active bid counter in bidder's session
    gameState.activeBids[playerId] = playerActiveBids + 1;

    gameState.activityLog.unshift(
      `[Broker] Placed bid of $${newBidAmount.toFixed(0)} on ${auction.mass.toFixed(1)}t ${auction.materialType} (Grade ${auction.grade})`
    );

    const timeRemaining = Math.max(
      0,
      Math.floor((auction.endTime - Date.now()) / 1000)
    );

    // Broadcast to all brokers in bidder's session
    WebSocketService.broadcastSystemMessage(
      sessionId,
      `New high bid: $${newBidAmount.toFixed(0)} by Team ${gameState.teamRole || 'Unknown'} on ${auction.materialType}. Time remaining: ${timeRemaining}s`,
      'info'
    );

    // Also broadcast to the auction's session if different
    if (auctionSession.sessionId !== sessionId) {
      WebSocketService.broadcastSystemMessage(
        auctionSession.sessionId,
        `New high bid: $${newBidAmount.toFixed(0)} by Team ${gameState.teamRole || 'Unknown'} on ${auction.materialType}. Time remaining: ${timeRemaining}s`,
        'info'
      );
    }

    await GameService.updateGameState(sessionId, gameState);
    await GameService.updateGameState(auctionSession.sessionId, auctionSession);

    // Broadcast player action for announcement board
    WebSocketService.broadcastPlayerAction(
      sessionId,
      playerId,
      'Broker',
      `placed bid of $${newBidAmount.toFixed(0)} on ${auction.mass.toFixed(1)}t ${auction.materialType} (Grade ${auction.grade})`
    );

    // Broadcast a concise bid update to clients and emit full game state
    WebSocketService.broadcastGameStateUpdate(
      sessionId,
      gameState,
      'bid-placed',
      {
        auctionId: auctionId,
        newBid: parseFloat(newBidAmount.toFixed(2)),
        timeRemaining,
      }
    );

    try {
      await GameService.emitFullGameState(sessionId, gameState, 'bid-placed', {
        auctionId,
        newBid: parseFloat(newBidAmount.toFixed(2)),
        timeRemaining,
      });

      // Also emit full game state for auction owner session so they see the update
      if (auctionSession && auctionSession.sessionId !== sessionId) {
        await GameService.emitFullGameState(
          auctionSession.sessionId,
          auctionSession,
          'bid-placed',
          {
            auctionId,
            newBid: parseFloat(newBidAmount.toFixed(2)),
            timeRemaining,
          }
        );
      }
    } catch (err) {
      // ignore emit errors to avoid breaking normal flow
    }

    return gameState;
  }

  // Resolve expired auctions within the player's paired sessions
  static async resolveExpiredAuctions(sessionId: string): Promise<GameState> {
    const gameState = await GameService.getGameState(sessionId);
    if (!gameState) throw new Error('Game session not found');

    // Build the list of paired session IDs
    const pairedSessionIds = [sessionId];
    if (gameState.partnerSessionId) {
      pairedSessionIds.push(gameState.partnerSessionId);
    }

    const now = Date.now();

    for (const sid of pairedSessionIds) {
      // Read fresh from DB each iteration so atomic updates from resolving
      // the previous session's auctions (e.g. buyer inventory $inc) are
      // reflected and won't be overwritten by a stale in-memory copy.
      const currentState = await GameService.getGameState(sid);
      if (!currentState || currentState.gameStatus !== 'active') continue;

      const expiredAuctions = currentState.marketplaceListing.filter(
        auction => auction.status === 'active' && auction.endTime <= now
      );

      for (const auction of expiredAuctions) {
        await this.resolveAuction(currentState, auction, sid);

        // Ensure auction status is persisted to 'sold'
        const auctionIndex = currentState.marketplaceListing.findIndex(
          a => a.auctionId === auction.auctionId
        );
        if (auctionIndex !== -1) {
          currentState.marketplaceListing[auctionIndex].status = 'sold';
        }

        // Broadcast auction resolved event
        WebSocketService.broadcastSystemMessage(
          sid,
          `Auction for ${auction.mass.toFixed(1)}t ${auction.materialType} has been resolved`,
          'info'
        );
      }

      if (expiredAuctions.length > 0) {
        // IMPORTANT: Persist all changes including inventory updates
        await GameService.updateGameState(sid, currentState);

        // Also emit full game state after auction resolutions
        try {
          await GameService.emitFullGameState(
            sid,
            currentState,
            'auctions-resolved',
            { resolvedCount: expiredAuctions.length }
          );
        } catch (err) {
          // Silently fail to avoid breaking system check
        }
      }
    }

    // Return the original session's state
    return (await GameService.getGameState(sessionId)) as GameState;
  }

  // Helper: Resolve single auction
  private static async resolveAuction(
    gameState: GameState,
    auction: Auction,
    sessionId: string
  ): Promise<void> {
    // For auctions created from processing, there is no corresponding material in inventory
    // Use auction data directly

    if (auction.highBidder) {
      // Someone won the auction
      // Check if it's a self-win: did the bidder's sessionId match the origin team's sessionId?
      const isSelfWin = auction.highBidderSessionId === auction.originTeam;

      if (isSelfWin) {
        // Outcome A: Self win (MRF's own team won the auction)
        gameState.activityLog.unshift(
          `[Broker] ✅ Successfully secured ${auction.mass.toFixed(1)}t ${auction.materialType} internally at $${auction.currentBid.toFixed(0)}`
        );
        gameState.activityLog.unshift(
          `[Broker] Your materials are now in Municipality Inventory`
        );

        // Winning team must pay the final bid from its budget
        gameState.budget -= auction.currentBid;

        // Record transaction
        gameState.transactions.push({
          id: `tx-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          turn: gameState.currentTurn,
          buyer: 'MUNI',
          seller: 'MRF',
          itemType: auction.materialType,
          itemId: auction.auctionId,
          mass: auction.mass,
          price: auction.currentBid,
          transactionType: 'internal_transfer',
          revenue: 0, // Net zero
        });

        // Internal auction payment: deduct winning bid from team budget
        // Transfer material to municipal inventory
        gameState.municipalInventory[auction.materialType] += auction.mass;

        // Mark auction as sold in the marketplace listing
        const auctionIndex = gameState.marketplaceListing.findIndex(
          a => a.auctionId === auction.auctionId
        );
        if (auctionIndex !== -1) {
          gameState.marketplaceListing[auctionIndex].status = 'sold';
        }

        // Explicitly save gameState with updated inventory for self-win
        await GameService.updateGameState(sessionId, gameState);
      } else {
        // Outcome B: External sale — competitor team won
        // Use atomic MongoDB operations ($inc/$push) for the buyer's session
        // so concurrent system-check saves or resolveExpiredAuctions iterations
        // cannot overwrite the inventory/budget change.
        const buyerSessionId = auction.highBidderSessionId;
        if (buyerSessionId) {
          const buyerLogMessage = `[Broker] ✅ Acquired ${auction.mass.toFixed(1)}t ${auction.materialType} for $${auction.currentBid.toFixed(0)}. Materials in inventory.`;
          const buyerTransaction = {
            id: `tx-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            turn: gameState.currentTurn,
            buyer: 'MUNI',
            seller: 'MRF',
            itemType: auction.materialType,
            itemId: auction.auctionId,
            mass: auction.mass,
            price: auction.currentBid,
            transactionType: 'external_sale',
            revenue: -auction.currentBid, // Cost to buyer
          };

          // Atomic update — survives concurrent full-document saves
          await GameSession.findOneAndUpdate(
            { sessionId: buyerSessionId },
            {
              $inc: {
                [`gameState.municipalInventory.${auction.materialType}`]: auction.mass,
                'gameState.budget': -auction.currentBid,
              },
              $push: {
                'gameState.activityLog': {
                  $each: [buyerLogMessage],
                  $position: 0,
                },
                'gameState.transactions': buyerTransaction,
              },
            }
          );

          // Notify buyer team
          WebSocketService.broadcastSystemMessage(
            buyerSessionId,
            `✅ Acquired ${auction.mass.toFixed(1)}t ${auction.materialType} for $${auction.currentBid.toFixed(0)}. Materials in inventory.`,
            'info'
          );

          // Read fresh buyer state for seller log and broadcasting
          const updatedBuyerState = await GameService.getGameState(buyerSessionId);
          const buyerTeamRole = updatedBuyerState?.teamRole || 'Unknown';

          gameState.activityLog.unshift(
            `[Broker] ✅ Sold ${auction.mass.toFixed(1)}t ${auction.materialType} to Team ${buyerTeamRole} for $${auction.currentBid.toFixed(0)}`
          );

          // Record transaction for seller
          gameState.transactions.push({
            id: `tx-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            turn: gameState.currentTurn,
            buyer: 'MUNI',
            seller: 'MRF',
            itemType: auction.materialType,
            itemId: auction.auctionId,
            mass: auction.mass,
            price: auction.currentBid,
            transactionType: 'external_sale',
            revenue: auction.currentBid, // Revenue to seller
          });

          // Seller receives payment
          gameState.budget += auction.currentBid;

          // Emit updated state to buyer so frontend sees the inventory change
          if (updatedBuyerState) {
            try {
              await GameService.emitFullGameState(
                buyerSessionId,
                updatedBuyerState,
                'auction-won',
                { auctionId: auction.auctionId }
              );
            } catch (err) {
              // ignore emit errors
            }
          }
        } else {
          // Buyer session not found — credit the seller like a liquidation
          logger.warn(`[BrokerService] Buyer session not found for highBidder ${auction.highBidder}, treating as liquidation`);
          const liquidationPrice = auction.entryPrice * 0.5;
          gameState.budget += liquidationPrice;
          gameState.activityLog.unshift(
            `[Broker] ⚠️ Winning bidder session not found for ${auction.mass.toFixed(1)}t ${auction.materialType}. Sold to system scrappers for $${liquidationPrice.toFixed(0)}`
          );

          // Record fallback liquidation transaction
          gameState.transactions.push({
            id: `tx-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            turn: gameState.currentTurn,
            buyer: 'External Market',
            seller: 'MRF',
            itemType: auction.materialType,
            itemId: auction.auctionId,
            mass: auction.mass,
            price: liquidationPrice,
            transactionType: 'external_sale',
            revenue: liquidationPrice,
          });
        }

        // Mark auction as sold in the marketplace listing
        const auctionIndexSeller = gameState.marketplaceListing.findIndex(
          a => a.auctionId === auction.auctionId
        );
        if (auctionIndexSeller !== -1) {
          gameState.marketplaceListing[auctionIndexSeller].status = 'sold';
        }

        // Explicitly save seller's gameState with updated budget and transactions
        await GameService.updateGameState(sessionId, gameState);
      }
    } else {
      // Outcome C: Liquidation - as per manual, 50% of starting price
      // Starting Price is the currentBid set by MRF when activating the auction
      const liquidationPrice = auction.currentBid * 0.5;

      gameState.budget += liquidationPrice;

      gameState.activityLog.unshift(
        `[Broker] ⚠️ No bids received for ${auction.mass.toFixed(1)}t ${auction.materialType}`
      );
      gameState.activityLog.unshift(
        `[Broker] Sold to system scrappers for $${liquidationPrice.toFixed(0)} (50% of starting price)`
      );

      // Record liquidation transaction
      gameState.transactions.push({
        id: `tx-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        turn: gameState.currentTurn,
        buyer: 'External Market',
        seller: 'MRF',
        itemType: auction.materialType,
        itemId: auction.auctionId,
        mass: auction.mass,
        price: liquidationPrice,
        transactionType: 'external_sale',
        revenue: liquidationPrice,
      });
    }

    // Free bid slot for the bidder using atomic decrement
    if (auction.highBidder && auction.highBidderSessionId) {
      await GameSession.findOneAndUpdate(
        {
          sessionId: auction.highBidderSessionId,
          [`gameState.activeBids.${auction.highBidder}`]: { $gt: 0 },
        },
        { $inc: { [`gameState.activeBids.${auction.highBidder}`]: -1 } }
      );
    }

    // Mark auction as sold
    auction.status = 'sold';
    await GameService.emitFullGameState(
      gameState.sessionId,
      gameState,
      'auctions-resolved',
      { auctionId: auction.auctionId }
    );
  }

  // NEW: Buy from external wholesaler
  static async buyFromExternalWholesaler(
    sessionId: string,
    materialType: 'paper' | 'plastic' | 'metal' | 'glass' | 'wood',
    requestedAmount: number,
    playerId: string
  ): Promise<GameState> {
    const gameState = await GameService.getGameState(sessionId);
    if (!gameState) {
      throw new Error('Game session not found');
    }

    if (gameState.gameStatus !== 'active') {
      throw new Error('Game is not active');
    }

    // Check available stock
    const availableStock = gameState.externalStock[materialType];
    if (requestedAmount > availableStock) {
      throw new Error(
        `Only ${availableStock.toFixed(1)} tons available. Reduce quantity or wait for restock.`
      );
    }

    // Calculate cost
    const basePrice =
      gameState.constants.MATERIAL_PROPERTIES[materialType].basePrice;
    const cost =
      basePrice * gameState.constants.MARKUP_CONSTANT * requestedAmount;

    // Check budget
    if (gameState.budget < cost) {
      throw new Error(
        `Insufficient budget. Need $${cost.toFixed(0)} but have $${gameState.budget.toFixed(0)}.`
      );
    }

    // Execute purchase
    gameState.budget -= cost;
    gameState.municipalInventory[materialType] += requestedAmount;
    gameState.externalStock[materialType] -= requestedAmount;

    // Record transaction
    gameState.transactions.push({
      id: `tx-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      turn: gameState.currentTurn,
      buyer: 'Municipality',
      seller: 'External Market',
      itemType: materialType,
      itemId: `ext-${Date.now()}`,
      mass: requestedAmount,
      price: cost,
      transactionType: 'external_sale',
      revenue: -cost, // Cost to buyer
    });

    // Restock if empty
    if (gameState.externalStock[materialType] === 0) {
      const newStock = Math.floor(Math.random() * 51) + 30; // 30-80 tons
      gameState.externalStock[materialType] = newStock;

      WebSocketService.broadcastSystemMessage(
        sessionId,
        `📦 External Wholesaler restocked: ${materialType} now has ${newStock.toFixed(1)} tons available`,
        'info'
      );
    }

    gameState.activityLog.unshift(
      `[Broker] Purchased ${requestedAmount.toFixed(1)}t ${materialType} from External Wholesaler for $${cost.toFixed(0)}`
    );
    gameState.activityLog.unshift(
      `[Broker] Material added to Municipality Inventory`
    );

    await GameService.updateGameState(sessionId, gameState);

    // Broadcast player action for announcement board
    WebSocketService.broadcastPlayerAction(
      sessionId,
      playerId,
      'Broker',
      `purchased ${requestedAmount.toFixed(1)}t ${materialType} from External Wholesaler for $${cost.toFixed(0)}`
    );

    // Broadcast concise external purchase update and emit full game state
    WebSocketService.broadcastGameStateUpdate(
      sessionId,
      gameState,
      'external-purchase',
      {
        materialType,
        requestedAmount: parseFloat(requestedAmount.toFixed(2)),
        cost: parseFloat(cost.toFixed(2)),
        newBudget: parseFloat(gameState.budget.toFixed(2)),
        remainingExternalStock: parseFloat(
          gameState.externalStock[materialType].toFixed(1)
        ),
      }
    );

    try {
      await GameService.emitFullGameState(
        sessionId,
        gameState,
        'external-purchase',
        {
          materialType,
          requestedAmount: parseFloat(requestedAmount.toFixed(2)),
          cost: parseFloat(cost.toFixed(2)),
        }
      );
    } catch (err) {
      // ignore
    }

    return gameState;
  }

  // NEW: Get external stock status with pricing for frontend
  static async getExternalStock(sessionId: string): Promise<
    Array<{
      materialType: string;
      availableAmount: number;
      pricePerUnit: number;
      lastUpdated: string;
    }>
  > {
    const gameState = await GameService.getGameState(sessionId);
    if (!gameState) {
      throw new Error('Game session not found');
    }

    // Build stock array with pricing information
    const materialTypes: Array<
      'paper' | 'plastic' | 'metal' | 'glass' | 'wood'
    > = ['paper', 'plastic', 'metal', 'glass', 'wood'];

    return materialTypes.map(materialType => {
      const basePrice =
        gameState.constants.MATERIAL_PROPERTIES[materialType].basePrice;
      const markupPrice = basePrice * gameState.constants.MARKUP_CONSTANT; // 2.5x markup
      const availableAmount = gameState.externalStock[materialType] || 0;

      return {
        materialType,
        availableAmount,
        pricePerUnit: markupPrice,
        lastUpdated: new Date().toISOString(),
      };
    });
  }
}
