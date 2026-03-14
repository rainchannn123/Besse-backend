import { Auction, GameState } from '../types';
import { GameService } from './gameService';
import { WebSocketService } from './websocketService';

export class BrokerService {
  // Helper: Find session containing a specific player
  private static async findPlayerSession(
    playerId: string
  ): Promise<GameState | null> {
    const allGameStates = await GameService.getAllActiveGameStates();
    return (
      allGameStates.find(
        gs =>
          gs.players.municipality === playerId ||
          gs.players.mrf === playerId ||
          gs.players.broker === playerId
      ) || null
    );
  }
  // NEW: Get active auctions from all active games
  static async getActiveAuctions(): Promise<Auction[]> {
    const allGameStates = await GameService.getAllActiveGameStates();
    const allActiveAuctions: Auction[] = [];

    for (const gameState of allGameStates) {
      const activeAuctions = gameState.marketplaceListing.filter(
        auction => auction.status === 'active'
      );
      allActiveAuctions.push(...activeAuctions);
    }

    // Sort by end time ascending (earliest first)
    return allActiveAuctions.sort((a, b) => a.endTime - b.endTime);
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

    // Check 1: Bid cap validation
    const playerActiveBids = gameState.activeBids[playerId] || 0;
    if (playerActiveBids >= gameState.constants.PLAYER_BID_CAP) {
      throw new Error(
        `Team bid limit reached (${gameState.constants.PLAYER_BID_CAP}/${gameState.constants.PLAYER_BID_CAP}). Wait for auctions to resolve.`
      );
    }

    // Find auction across all active sessions
    const allGameStates = await GameService.getAllActiveGameStates();
    let auction: Auction | null = null;
    let auctionSession: GameState | null = null;

    for (const gs of allGameStates) {
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
    const bidIncrement = Math.max(entryPrice * 0.05, 50); // 5% of entry price or $50 minimum
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
    auction.highBidder = playerId;
    auction.highBidderSessionId = sessionId; // Store the bidder's sessionId for self-win detection

    // Handle active bids: decrement previous high bidder if different
    if (previousHighBidder && previousHighBidder !== playerId) {
      const prevBidderSession =
        await this.findPlayerSession(previousHighBidder);
      if (
        prevBidderSession &&
        prevBidderSession.activeBids[previousHighBidder]
      ) {
        prevBidderSession.activeBids[previousHighBidder]--;
        await GameService.updateGameState(
          prevBidderSession.sessionId,
          prevBidderSession
        );
      }
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

  // NEW: Resolve expired auctions across all sessions
  static async resolveExpiredAuctions(sessionId: string): Promise<GameState> {
    const allGameStates = await GameService.getAllActiveGameStates();
    const now = Date.now();

    for (const gameState of allGameStates) {
      const expiredAuctions = gameState.marketplaceListing.filter(
        auction => auction.status === 'active' && auction.endTime <= now
      );

      for (const auction of expiredAuctions) {
        await this.resolveAuction(gameState, auction, gameState.sessionId);

        // Ensure auction status is persisted to 'sold'
        const auctionIndex = gameState.marketplaceListing.findIndex(
          a => a.auctionId === auction.auctionId
        );
        if (auctionIndex !== -1) {
          gameState.marketplaceListing[auctionIndex].status = 'sold';
        }

        // Broadcast auction resolved event
        WebSocketService.broadcastSystemMessage(
          gameState.sessionId,
          `Auction for ${auction.mass.toFixed(1)}t ${auction.materialType} has been resolved`,
          'info'
        );
      }

      if (expiredAuctions.length > 0) {
        // IMPORTANT: Persist all changes including inventory updates
        await GameService.updateGameState(gameState.sessionId, gameState);

        // Also emit full game state after auction resolutions
        try {
          await GameService.emitFullGameState(
            gameState.sessionId,
            gameState,
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

        // Net-zero budget change: Broker pays from team budget, MRF receives to team budget
        // But since both are same team, it cancels out
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
        // Outcome B: External sale
        const buyerSession = await this.findPlayerSession(auction.highBidder);
        if (buyerSession) {
          // Deduct from buyer's budget
          buyerSession.budget -= auction.currentBid;
          // Add to buyer's municipal inventory
          buyerSession.municipalInventory[auction.materialType] += auction.mass;

          buyerSession.activityLog.unshift(
            `[Broker] ✅ Acquired ${auction.mass.toFixed(1)}t ${auction.materialType} for $${auction.currentBid.toFixed(0)}. Materials in inventory.`
          );

          // Record transaction for buyer
          buyerSession.transactions.push({
            id: `tx-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            turn: buyerSession.currentTurn,
            buyer: 'MUNI',
            seller: 'MRF',
            itemType: auction.materialType,
            itemId: auction.auctionId,
            mass: auction.mass,
            price: auction.currentBid,
            transactionType: 'external_sale',
            revenue: -auction.currentBid, // Cost to buyer
          });

          // Notify buyer
          WebSocketService.broadcastSystemMessage(
            buyerSession.sessionId,
            `✅ Acquired ${auction.mass.toFixed(1)}t ${auction.materialType} for $${auction.currentBid.toFixed(0)}. Materials in inventory.`,
            'info'
          );

          await GameService.updateGameState(
            buyerSession.sessionId,
            buyerSession
          );
        }

        gameState.activityLog.unshift(
          `[Broker] ✅ Sold ${auction.mass.toFixed(1)}t ${auction.materialType} to Team ${buyerSession!.teamRole} for $${auction.currentBid.toFixed(0)}`
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

    // Free bid slot for the bidder
    if (auction.highBidder) {
      const bidderSession = await this.findPlayerSession(auction.highBidder);
      if (bidderSession && bidderSession.activeBids[auction.highBidder]) {
        bidderSession.activeBids[auction.highBidder]--;
        await GameService.updateGameState(
          bidderSession.sessionId,
          bidderSession
        );
      }
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
