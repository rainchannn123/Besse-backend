import { Request, Response } from 'express';
import { BrokerService } from '../services/brokerService';
import { GameService } from '../services/gameService';
import { BuyFromExternalWholesalerInput, PlaceBidInput } from '../types';
import { asyncHandler } from '../utils/asyncHandler';
import { sendResponse } from '../utils/response';

// ✅ Get active auctions scoped to the player's room
export const getActiveAuctions = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const userId = (req as any).user._id;
    const currentSession = (req as any).user.currentSession;

    if (!currentSession) {
      sendResponse(res, 400, 'No active session found');
      return;
    }

    // ✅ Get game state and check if user is a broker
    const gameState = await GameService.getGameState(currentSession);
    if (!gameState) {
      sendResponse(res, 404, 'Game session not found');
      return;
    }

    // ✅ Check if user is broker in their team
    const team = gameState.teams.find(t => 
      t.players.broker === userId.toString()
    );

    if (!team) {
      sendResponse(res, 403, 'Only broker player can view auctions');
      return;
    }

    // ✅ Get auctions from ALL teams in the room
    const auctions = await BrokerService.getRoomAuctions(currentSession);

    sendResponse(res, 200, 'Active auctions retrieved successfully', {
      auctions,
    });
  }
);

// ✅ Place bid on auction
export const placeBid = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { auctionId }: PlaceBidInput = req.body;
    const userId = (req as any).user._id;
    const currentSession = (req as any).user.currentSession;

    if (!currentSession) {
      sendResponse(res, 400, 'No active session found');
      return;
    }

    // ✅ Check if user is broker
    const gameState = await GameService.getGameState(currentSession);
    if (!gameState) {
      sendResponse(res, 404, 'Game session not found');
      return;
    }

    const team = gameState.teams.find(t => 
      t.players.broker === userId.toString()
    );

    if (!team) {
      sendResponse(res, 403, 'Only broker player can place bids');
      return;
    }

    // ✅ Place bid
    const updatedTeam = await BrokerService.placeBid(
      currentSession,
      auctionId,
      userId
    );

    sendResponse(res, 200, 'Bid placed successfully', { team: updatedTeam });
  }
);

// ✅ Resolve expired auctions
export const resolveExpiredAuctions = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { sessionId } = req.params;
    const userId = (req as any).user._id;

    // ✅ Check if user is broker
    const gameState = await GameService.getGameState(sessionId);
    if (!gameState) {
      sendResponse(res, 404, 'Game session not found');
      return;
    }

    const team = gameState.teams.find(t => 
      t.players.broker === userId.toString()
    );

    if (!team) {
      sendResponse(res, 403, 'Only broker player can resolve auctions');
      return;
    }

    const updatedTeam = await BrokerService.resolveExpiredAuctions(sessionId);

    sendResponse(res, 200, 'Expired auctions resolved successfully', {
      team: updatedTeam,
    });
  }
);

// ✅ Buy from external wholesaler
export const buyFromExternalWholesaler = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const {
      materialType,
      requestedAmount,
      sessionId,
    }: BuyFromExternalWholesalerInput = req.body;
    const userId = (req as any).user._id;

    if (!sessionId) {
      sendResponse(res, 400, 'Session ID is required');
      return;
    }

    // ✅ Check if user is broker
    const gameState = await GameService.getGameState(sessionId);
    if (!gameState) {
      sendResponse(res, 404, 'Game session not found');
      return;
    }

    const team = gameState.teams.find(t => 
      t.players.broker === userId.toString()
    );

    if (!team) {
      sendResponse(res, 403, 'Only broker player can buy from external wholesaler');
      return;
    }

    const updatedTeam = await BrokerService.buyFromExternalWholesaler(
      sessionId,
      materialType,
      requestedAmount,
      userId
    );

    sendResponse(res, 200, 'Purchase from external wholesaler successful', {
      team: updatedTeam,
    });
  }
);

// ✅ Get external stock status
export const getExternalStock = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { sessionId } = req.params;
    const userId = (req as any).user._id;

    if (!sessionId) {
      sendResponse(res, 400, 'Session ID is required');
      return;
    }

    // ✅ Check if user is broker
    const gameState = await GameService.getGameState(sessionId);
    if (!gameState) {
      sendResponse(res, 404, 'Game session not found');
      return;
    }

    const team = gameState.teams.find(t => 
      t.players.broker === userId.toString()
    );

    if (!team) {
      sendResponse(res, 403, 'Only broker player can view external stock');
      return;
    }

    const externalStock = await BrokerService.getExternalStock(sessionId);

    sendResponse(res, 200, 'External stock retrieved successfully', {
      externalStock,
    });
  }
);