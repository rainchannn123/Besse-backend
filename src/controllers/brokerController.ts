import { Request, Response } from 'express';
import { BrokerService } from '../services/brokerService';
import { GameService } from '../services/gameService';
import { BuyFromExternalWholesalerInput, PlaceBidInput } from '../types';
import { asyncHandler } from '../utils/asyncHandler';
import { sendResponse } from '../utils/response';

// NEW: Get active auctions from all active games
export const getActiveAuctions = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const userId = (req as any).user._id;

    // Check if user is a broker in any active game
    const allGameStates = await GameService.getAllActiveGameStates();
    const isBroker = allGameStates.some(
      gs => gs.players.broker.toString() === userId.toString()
    );

    if (!isBroker) {
      sendResponse(res, 403, 'Only broker player can view auctions');
      return;
    }

    const auctions = await BrokerService.getActiveAuctions();

    sendResponse(res, 200, 'Active auctions retrieved successfully', {
      auctions,
    });
  }
);

// NEW: Place bid on auction
export const placeBid = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { auctionId }: PlaceBidInput = req.body;
    const userId = (req as any).user._id;

    // Check if user is a broker in any active game
    const allGameStates = await GameService.getAllActiveGameStates();
    const isBroker = allGameStates.some(
      gs => gs.players.broker.toString() === userId.toString()
    );

    if (!isBroker) {
      sendResponse(res, 403, 'Only broker player can place bids');
      return;
    }

    // Find the bidder's session
    const bidderSession = allGameStates.find(
      gs => gs.players.broker.toString() === userId.toString()
    );

    if (!bidderSession) {
      sendResponse(res, 404, 'Bidder session not found');
      return;
    }

    const gameState = await BrokerService.placeBid(
      bidderSession.sessionId,
      auctionId,
      userId
    );

    sendResponse(res, 200, 'Bid placed successfully', { gameState });
  }
);

// NEW: Resolve expired auctions (admin/system call, but allowing broker for now)
export const resolveExpiredAuctions = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { sessionId } = req.params;
    const userId = (req as any).user._id;

    const userRole = await GameService.getPlayerRole(sessionId, userId);
    if (userRole !== 'broker') {
      sendResponse(res, 403, 'Only broker player can resolve auctions');
      return;
    }

    const gameState = await BrokerService.resolveExpiredAuctions(sessionId);

    sendResponse(res, 200, 'Expired auctions resolved successfully', {
      gameState,
    });
  }
);

// NEW: Buy from external wholesaler
export const buyFromExternalWholesaler = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const {
      materialType,
      requestedAmount,
      sessionId,
    }: BuyFromExternalWholesalerInput = req.body;
    const userId = (req as any).user._id;

    const userRole = await GameService.getPlayerRole(sessionId, userId);
    if (userRole !== 'broker') {
      sendResponse(
        res,
        403,
        'Only broker player can buy from external wholesaler'
      );
      return;
    }

    const gameState = await BrokerService.buyFromExternalWholesaler(
      sessionId,
      materialType,
      requestedAmount,
      userId
    );

    sendResponse(res, 200, 'Purchase from external wholesaler successful', {
      gameState,
    });
  }
);

// NEW: Get external stock status
export const getExternalStock = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { sessionId } = req.params;
    const userId = (req as any).user._id;

    const userRole = await GameService.getPlayerRole(sessionId, userId);
    if (userRole !== 'broker') {
      sendResponse(res, 403, 'Only broker player can view external stock');
      return;
    }

    const externalStock = await BrokerService.getExternalStock(sessionId);

    sendResponse(res, 200, 'External stock retrieved successfully', {
      externalStock,
    });
  }
);
