import { Request, Response } from 'express';
import { ActivityCategory, ActivityStatus } from '../models/ActivityLog';
import {
  adminLogin,
  forceExitPlayer,
  getAdminMonitoringOverview,
  getPlayerGameHistory,
  getRoomLiveOverview,
} from '../services/adminService';

import { ActivityLogService } from '../services/activityLogService';
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

const VALID_CATEGORIES: ActivityCategory[] = [
  'auth',
  'lobby',
  'matchmaking',
  'game',
  'municipality',
  'mrf',
  'broker',
  'admin',
  'system',
];

const VALID_STATUSES: ActivityStatus[] = ['success', 'failure'];

// ✅ NEW: Get activity logs for admin
export const getActivityLogs = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);

    const categoryParam = (req.query.category as string) || '';
    const statusParam = (req.query.status as string) || '';

    const filters: any = {};

    if (categoryParam && VALID_CATEGORIES.includes(categoryParam as ActivityCategory)) {
      filters.category = categoryParam;
    }

    if (statusParam && VALID_STATUSES.includes(statusParam as ActivityStatus)) {
      filters.status = statusParam;
    }

    if (req.query.action) filters.action = String(req.query.action);
    if (req.query.userId) filters.userId = String(req.query.userId);
    if (req.query.userEmail) filters.userEmail = String(req.query.userEmail);
    if (req.query.sessionId) filters.sessionId = String(req.query.sessionId);
    if (req.query.search) filters.search = String(req.query.search);

    if (req.query.fromDate) {
      const fromDate = new Date(String(req.query.fromDate));
      if (!isNaN(fromDate.getTime())) {
        filters.fromDate = fromDate;
      }
    }

    if (req.query.toDate) {
      const toDate = new Date(String(req.query.toDate));
      if (!isNaN(toDate.getTime())) {
        filters.toDate = toDate;
      }
    }

    const data = await ActivityLogService.getLogs(filters, { page, limit });

    sendResponse(res, 200, 'Activity logs retrieved', data);
  }
);

// ✅ NEW: Get activity log statistics for admin
export const getActivityLogStats = asyncHandler(
  async (_req: Request, res: Response): Promise<void> => {
    const stats = await ActivityLogService.getStats();
    sendResponse(res, 200, 'Activity log statistics retrieved', stats);
  }
);