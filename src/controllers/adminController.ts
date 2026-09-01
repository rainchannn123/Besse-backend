import { Request, Response } from 'express';
import {
  adminLogin,
  forceExitPlayer,
  getAdminMonitoringOverview,
  getPlayerGameHistory,
  getRoomLiveOverview,
} from '../services/adminService';
import { asyncHandler } from '../utils/asyncHandler';

import { sendResponse } from '../utils/response';

export const loginAdmin = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { username, password } = req.body;

    const data = await adminLogin(username, password);

    sendResponse(res, 200, 'Admin login successful', data);
  }
);

export const monitoringOverview = asyncHandler(
  async (_req: Request, res: Response): Promise<void> => {
    const data = await getAdminMonitoringOverview();

    sendResponse(res, 200, 'Admin monitoring data retrieved', data);
  }
);



export const forceExit = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { userId } = req.params;

    const { reason } = req.body || {};

    const data = await forceExitPlayer(userId, reason);

    sendResponse(res, 200, 'Player was forced out of session', data);
  }
);

export const playerHistory = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { userId } = req.params;
    const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 50);
    const page = Math.max(Number(req.query.page) || 0, 0);
    const skip = page * limit;

    const data = await getPlayerGameHistory(userId, limit, skip);

    sendResponse(res, 200, 'Player game history retrieved', data);
  }
);

export const roomLiveOverview = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { roomCode } = req.params;

        const flowLimit = req.query.flowLimit ? Number(req.query.flowLimit) : undefined;
    const flowFrom = req.query.flowFrom ? new Date(String(req.query.flowFrom)) : undefined;
    const flowTo = req.query.flowTo ? new Date(String(req.query.flowTo)) : undefined;

    const includeFlowEvents = req.query.includeFlowEvents;
    const parsedIncludeFlowEvents =
      includeFlowEvents === undefined
        ? undefined
        : ['1', 'true', 'yes'].includes(String(includeFlowEvents).toLowerCase());

    const data = await getRoomLiveOverview(roomCode, {
      flowLimit: Number.isFinite(flowLimit) ? flowLimit : undefined,
      flowFrom: flowFrom && !isNaN(flowFrom.getTime()) ? flowFrom : undefined,
      flowTo: flowTo && !isNaN(flowTo.getTime()) ? flowTo : undefined,
      includeFlowEvents: parsedIncludeFlowEvents,
    });


    sendResponse(res, 200, 'Room live overview retrieved', data);
  }
);
