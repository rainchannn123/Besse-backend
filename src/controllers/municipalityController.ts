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

    const gameState = await GameService.collectWaste(
      sessionId,
      batchId,
      userId
    );

    sendResponse(res, 200, 'Waste collected successfully', { gameState });
  }
);

export const collectWasteWithTransport = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { batchId, mode } = req.body;
    const { sessionId } = req.params;
    const userId = (req as any).user._id;

    console.log(`[DEBUG] Collect waste with transport - SessionId: ${sessionId}, BatchId: ${batchId}, Mode: ${mode}, UserId: ${userId}`);

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

    const userRole = await GameService.getPlayerRole(sessionId, userId);
    if (userRole !== 'municipality') {
      sendResponse(res, 403, 'Only municipality player can view waste batches');
      return;
    }

    // ✅ Get team data instead of gameState
    const team = await GameService.getTeamData(sessionId);
    if (!team) {
      sendResponse(res, 404, 'Team not found');
      return;
    }

    // Filter only pending batches for municipality
    const pendingBatches = team.wasteBatches.filter(
      batch => batch.status === 'PENDING'
    );

    sendResponse(res, 200, 'Waste batches retrieved successfully', {
      batches: pendingBatches,
      wasteInventory: team.wasteInventory,
      maxCapacity: 150,
      budget: team.budget,
    });
  }
);

export const viewBrokerMaterials = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { sessionId } = req.params;
    const userId = (req as any).user._id;

    const userRole = await GameService.getPlayerRole(sessionId, userId);
    if (userRole !== 'municipality') {
      sendResponse(
        res,
        403,
        'Only municipality player can view broker materials'
      );
      return;
    }

    // ✅ Get team data
    const team = await GameService.getTeamData(sessionId);
    if (!team) {
      sendResponse(res, 404, 'Team not found');
      return;
    }

    // Get broker's available materials (owned by broker)
    const brokerMaterials = team.materialInventory.filter(
      item => item.owner === 'broker'
    );

    sendResponse(res, 200, 'Broker materials retrieved successfully', {
      materials: brokerMaterials,
      municipalityBudget: team.budget,
    });
  }
);

export const getCityProjects = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { sessionId } = req.params;
    const userId = (req as any).user._id;

    const userRole = await GameService.getPlayerRole(sessionId, userId);
    if (userRole !== 'municipality') {
      sendResponse(res, 403, 'Only municipality player can view city projects');
      return;
    }

    // ✅ Get team data
    const team = await GameService.getTeamData(sessionId);
    if (!team) {
      sendResponse(res, 404, 'Team not found');
      return;
    }

    sendResponse(res, 200, 'City projects retrieved successfully', {
      projects: team.cityProjects,
      municipalityInventory: team.materialInventory.filter(
        item => item.owner === 'municipality'
      ),
    });
  }
);

export const getMunicipalityInventory = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { sessionId } = req.params;
    const userId = (req as any).user._id;

    const userRole = await GameService.getPlayerRole(sessionId, userId);
    if (userRole !== 'municipality') {
      sendResponse(res, 403, 'Only municipality player can view inventory');
      return;
    }

    // ✅ Get team data
    const team = await GameService.getTeamData(sessionId);
    if (!team) {
      sendResponse(res, 404, 'Team not found');
      return;
    }

    // Convert municipalInventory object to array list
    const inventoryList = Object.entries(team.municipalInventory || {}).map(
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

export const constructProject = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { sessionId } = req.params;
    const { projectId, materialType, materialAmount } = req.body;
    const userId = (req as any).user._id;

    const userRole = await GameService.getPlayerRole(sessionId, userId);
    if (userRole !== 'municipality') {
      sendResponse(res, 403, 'Only municipality player can construct projects');
      return;
    }

    const updatedTeam = await MunicipalityService.constructProject(
      sessionId,
      projectId,
      materialType,
      materialAmount,
      userId
    );

    sendResponse(res, 200, 'Material contributed to project successfully', {
      team: updatedTeam,
    });
  }
);