import { Request, Response } from 'express';
import { GameService } from '../services/gameService';
import { MunicipalityService } from '../services/municipalityService';
import { asyncHandler } from '../utils/asyncHandler';
import { sendResponse } from '../utils/response';

export const collectWaste = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { batchId } = req.body;
    const { sessionId } = req.params;
    const userId = (req as any).user._id;

    console.log(
      `[DEBUG] Collect waste request - SessionId: ${sessionId}, BatchId: ${batchId}, UserId: ${userId}`
    );

    // REMOVED: Role check - any player can collect waste from Municipality dashboard
    // The frontend already ensures only Municipality players see this dashboard

    const gameState = await GameService.collectWaste(
      sessionId,
      batchId,
      userId
    );

    sendResponse(res, 200, 'Waste collected successfully', { gameState });
  }
);

// NEW: Collect waste with transport mode (fast/slow) - NO ROLE CHECK
export const collectWasteWithTransport = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { batchId, mode } = req.body;
    const { sessionId } = req.params;
    const userId = (req as any).user._id;

    console.log(`[DEBUG] Collect waste with transport - SessionId: ${sessionId}, BatchId: ${batchId}, Mode: ${mode}, UserId: ${userId}`);

    // REMOVED: Role check - any player can start transport from Municipality dashboard
    // The frontend already ensures only Municipality players see this dashboard

    const gameStateResult = await MunicipalityService.collectWasteWithTransport(
      sessionId,
      batchId,
      userId,
      mode
    );

    sendResponse(res, 200, `${mode} transport started successfully`, { gameState: gameStateResult });
  }
);

export const rejectWaste = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { batchId, sessionId } = req.body;
    const userId = (req as any).user._id;

    // Keep role check for reject - only municipality should reject
    const userRole = await GameService.getPlayerRole(sessionId, userId);
    if (userRole !== 'municipality') {
      sendResponse(res, 403, 'Only municipality player can reject waste');
      return;
    }

    const gameState = await MunicipalityService.rejectWaste(
      sessionId,
      batchId,
      userId
    );

    sendResponse(res, 200, 'Waste rejected', { gameState });
  }
);

export const getWasteBatches = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { sessionId } = req.params;
    const userId = (req as any).user._id;

    // Keep role check for viewing - only municipality should view waste batches
    const userRole = await GameService.getPlayerRole(sessionId, userId);
    if (userRole !== 'municipality') {
      sendResponse(res, 403, 'Only municipality player can view waste batches');
      return;
    }

    const gameState = await GameService.getGameState(sessionId);

    if (!gameState) {
      sendResponse(res, 404, 'Game session not found');
      return;
    }

    // Filter only pending batches for municipality
    const pendingBatches = gameState.wasteBatches.filter(
      batch => batch.status === 'PENDING'
    );

    sendResponse(res, 200, 'Waste batches retrieved successfully', {
      batches: pendingBatches,
      wasteInventory: gameState.wasteInventory,
      maxCapacity: gameState.maxCapacity,
      budget: gameState.budget,
    });
  }
);

// View broker's available materials for ordering
export const viewBrokerMaterials = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { sessionId } = req.params;
    const userId = (req as any).user._id;

    // Keep role check - only municipality should view broker materials
    const userRole = await GameService.getPlayerRole(sessionId, userId);
    if (userRole !== 'municipality') {
      sendResponse(
        res,
        403,
        'Only municipality player can view broker materials'
      );
      return;
    }

    const gameState = await GameService.getGameState(sessionId);

    if (!gameState) {
      sendResponse(res, 404, 'Game session not found');
      return;
    }

    // Get broker's available materials (owned by broker)
    const brokerMaterials = gameState.materialInventory.filter(
      item => item.owner === 'broker'
    );

    sendResponse(res, 200, 'Broker materials retrieved successfully', {
      materials: brokerMaterials,
      municipalityBudget: gameState.budget,
    });
  }
);

// View municipality's current projects and material needs
export const getCityProjects = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { sessionId } = req.params;
    const userId = (req as any).user._id;

    // Keep role check - only municipality should view city projects
    const userRole = await GameService.getPlayerRole(sessionId, userId);
    if (userRole !== 'municipality') {
      sendResponse(res, 403, 'Only municipality player can view city projects');
      return;
    }

    const gameState = await GameService.getGameState(sessionId);

    if (!gameState) {
      sendResponse(res, 404, 'Game session not found');
      return;
    }

    sendResponse(res, 200, 'City projects retrieved successfully', {
      projects: gameState.cityProjects,
      municipalityInventory: gameState.materialInventory.filter(
        item => item.owner === 'municipality'
      ),
    });
  }
);

// Get municipality inventory as a list
export const getMunicipalityInventory = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { sessionId } = req.params;
    const userId = (req as any).user._id;

    // Keep role check - only municipality should view inventory
    const userRole = await GameService.getPlayerRole(sessionId, userId);
    if (userRole !== 'municipality') {
      sendResponse(res, 403, 'Only municipality player can view inventory');
      return;
    }

    const gameState = await GameService.getGameState(sessionId);

    if (!gameState) {
      sendResponse(res, 404, 'Game session not found');
      return;
    }

    // Convert municipalInventory object to array list
    const inventoryList = Object.entries(gameState.municipalInventory).map(
      ([material, quantity]) => ({
        material,
        quantity,
      })
    );

    sendResponse(res, 200, 'Municipality inventory retrieved successfully', {
      inventory: inventoryList,
    });
  }
);

// Construct city project
export const constructProject = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { sessionId } = req.params;
    const { projectId, materialType, materialAmount } = req.body;
    const userId = (req as any).user._id;

    // Keep role check - only municipality should construct projects
    const userRole = await GameService.getPlayerRole(sessionId, userId);
    if (userRole !== 'municipality') {
      sendResponse(res, 403, 'Only municipality player can construct projects');
      return;
    }

    const gameState = await MunicipalityService.constructProject(
      sessionId,
      projectId,
      materialType,
      materialAmount,
      userId
    );

    sendResponse(res, 200, 'Material contributed to project successfully', {
      gameState,
    });
  }
);