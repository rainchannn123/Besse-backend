import { Request, Response } from 'express';
import { GameService } from '../services/gameService';
import { MRFService } from '../services/mrfService';
import { AssignGradeInput, ProcessWasteInput } from '../types';
import { asyncHandler } from '../utils/asyncHandler';
import { sendResponse } from '../utils/response';

export const processWaste = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { queueId, sessionId }: ProcessWasteInput = req.body;
    const userId = (req as any).user._id;
    
    // ✅ Verify user has MRF role
    const userRole = await GameService.getPlayerRole(sessionId, userId);
    
    if (userRole !== 'mrf') {
      sendResponse(res, 403, 'Only MRF player can process waste');
      return;
    }

    const gameState = await MRFService.processWaste(sessionId, queueId, userId);

    sendResponse(res, 200, 'Waste processed successfully', { gameState });
  }
);

export const assignGrade = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { auctionId, grade, sessionId, customPrice }: AssignGradeInput =
      req.body;
    const userId = (req as any).user._id;

    // ✅ Verify user has MRF role
    const userRole = await GameService.getPlayerRole(sessionId, userId);
    
    if (userRole !== 'mrf') {
      sendResponse(res, 403, 'Only MRF player can assign grades');
      return;
    }

    const gameState = await MRFService.assignGrade(
      sessionId,
      auctionId,
      grade,
      customPrice
    );

    sendResponse(res, 200, 'Grade and price assigned successfully', {
      gameState,
    });
  }
);

export const sendToLandfill = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { queueId, sessionId }: ProcessWasteInput = req.body;
    const userId = (req as any).user._id;

    const userRole = await GameService.getPlayerRole(sessionId, userId);
    if (userRole !== 'mrf') {
      sendResponse(res, 403, 'Only MRF player can send waste to landfill');
      return;
    }

    const gameState = await MRFService.sendToLandfill(sessionId, queueId, userId);

    sendResponse(res, 200, 'Waste sent to landfill successfully', { gameState });
  }
);

export const getQueue = asyncHandler(

  async (req: Request, res: Response): Promise<void> => {
    const { sessionId } = req.params;
    const userId = (req as any).user._id;

    // ✅ Verify user has MRF role
    const userRole = await GameService.getPlayerRole(sessionId, userId);
    
    if (userRole !== 'mrf') {
      sendResponse(res, 403, 'Only MRF player can view queue');
      return;
    }

    // ✅ Get team data
    const team = await GameService.getTeamData(sessionId);
    if (!team) {
      sendResponse(res, 404, 'Team not found');
      return;
    }

    const queue = team.mrfQueue.filter(item => !item.delivered);

    sendResponse(res, 200, 'MRF queue retrieved successfully', { queue });
  }
);

export const getMRFInventory = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { sessionId } = req.params;
    const userId = (req as any).user._id;

    // ✅ Verify user has MRF role
    const userRole = await GameService.getPlayerRole(sessionId, userId);
    
    if (userRole !== 'mrf') {
      sendResponse(res, 403, 'Only MRF player can view MRF inventory');
      return;
    }

    // ✅ Get team data
    const team = await GameService.getTeamData(sessionId);
    if (!team) {
      sendResponse(res, 404, 'Team not found');
      return;
    }

    const inventory = team.materialInventory.filter(
      item => item.owner === 'mrf'
    );

    sendResponse(res, 200, 'MRF inventory retrieved successfully', {
      inventory,
    });
  }
);

// ✅ NEW: Get pending auctions for MRF to assign grades and prices
export const getPendingAuctions = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { sessionId } = req.params;
    const userId = (req as any).user._id;

    // ✅ Verify user has MRF role
    const userRole = await GameService.getPlayerRole(sessionId, userId);
    
    if (userRole !== 'mrf') {
      sendResponse(res, 403, 'Only MRF player can view pending auctions');
      return;
    }

    // ✅ Get team data
    const team = await GameService.getTeamData(sessionId);
    if (!team) {
      sendResponse(res, 404, 'Team not found');
      return;
    }

    // Get pending auctions owned by this team
    const pendingAuctions = team.marketplaceListing.filter(
      auction =>
        auction.status === 'pending' && auction.originTeam === sessionId
    );

    sendResponse(res, 200, 'Pending auctions retrieved successfully', {
      pendingAuctions,
    });
  }
);

export const sendBackToMunicipality = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { sessionId } = req.params;
    const { auctionId, mode } = req.body;
    const userId = (req as any).user._id;

    const userRole = await GameService.getPlayerRole(sessionId, userId);
    if (userRole !== 'mrf') {
      sendResponse(res, 403, 'Only MRF player can send materials back to municipality');
      return;
    }

    const gameState = await MRFService.sendBackToMunicipalityWithTransport(
      sessionId,
      auctionId,
      userId,
      mode
    );

    sendResponse(res, 200, `${mode} transport started successfully`, { gameState });
  }
);
