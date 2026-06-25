import mongoose from 'mongoose';
import ActivityLog, {
  ActivityCategory,
  ActivityStatus,
  IActivityLog,
} from '../models/ActivityLog';
import { logger } from '../utils/logger';

export interface LogActivityParams {
  userId?: string | mongoose.Types.ObjectId | null;
  userName?: string | null;
  userEmail?: string | null;
  accountType?: string | null;
  role?: string | null;
  category: ActivityCategory;
  action: string;
  description: string;
  sessionId?: string | null;
  targetUserId?: string | null;
  targetUserName?: string | null;
  status?: ActivityStatus;
  statusCode?: number | null;
  method?: string | null;
  route?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, any>;
}

export interface ActivityLogFilters {
  category?: ActivityCategory;
  action?: string;
  userId?: string;
  userEmail?: string;
  sessionId?: string;
  status?: ActivityStatus;
  fromDate?: Date;
  toDate?: Date;
  search?: string;
}

export interface ActivityLogPagination {
  page: number;
  limit: number;
}

export class ActivityLogService {
  /**
   * Log an activity. Fire-and-forget — failures never break user flow.
   */
  static async log(params: LogActivityParams): Promise<void> {
    try {
      const userId =
        params.userId && mongoose.Types.ObjectId.isValid(params.userId.toString())
          ? new mongoose.Types.ObjectId(params.userId.toString())
          : null;

      await ActivityLog.create({
        userId,
        userName: params.userName ?? null,
        userEmail: params.userEmail ?? null,
        accountType: params.accountType ?? null,
        role: params.role ?? null,
        category: params.category,
        action: params.action,
        description: params.description,
        sessionId: params.sessionId ?? null,
        targetUserId: params.targetUserId ?? null,
        targetUserName: params.targetUserName ?? null,
        status: params.status ?? 'success',
        statusCode: params.statusCode ?? null,
        method: params.method ?? null,
        route: params.route ?? null,
        ipAddress: params.ipAddress ?? null,
        userAgent: params.userAgent ?? null,
        metadata: params.metadata ?? {},
      });
    } catch (error: any) {
      logger.error('Failed to write activity log', {
        error: error?.message,
        action: params.action,
        category: params.category,
      });
    }
  }

  static async getLogs(
    filters: ActivityLogFilters,
    pagination: ActivityLogPagination
  ): Promise<{
    logs: IActivityLog[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const { page, limit } = pagination;
    const skip = (page - 1) * limit;

    const query: any = {};

    if (filters.category) query.category = filters.category;
    if (filters.action) query.action = filters.action;
    if (filters.status) query.status = filters.status;
    if (filters.sessionId) query.sessionId = filters.sessionId;
    if (filters.userEmail) query.userEmail = filters.userEmail.toLowerCase();

    if (filters.userId && mongoose.Types.ObjectId.isValid(filters.userId)) {
      query.userId = new mongoose.Types.ObjectId(filters.userId);
    }

    if (filters.fromDate || filters.toDate) {
      query.createdAt = {};
      if (filters.fromDate) query.createdAt.$gte = filters.fromDate;
      if (filters.toDate) query.createdAt.$lte = filters.toDate;
    }

    if (filters.search && filters.search.trim()) {
      const term = filters.search.trim();
      const regex = new RegExp(
        term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
        'i'
      );
      query.$or = [
        { description: regex },
        { action: regex },
        { userName: regex },
        { userEmail: regex },
        { sessionId: regex },
      ];
    }

    const [logs, total] = await Promise.all([
      ActivityLog.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean<IActivityLog[]>(),
      ActivityLog.countDocuments(query),
    ]);

    return {
      logs,
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  static async getStats(): Promise<{
    totalLogs: number;
    byCategory: Array<{ category: string; count: number }>;
    byStatus: Array<{ status: string; count: number }>;
    last24Hours: number;
    last7Days: number;
  }> {
    const now = new Date();
    const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const since7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const [totalLogs, byCategoryAgg, byStatusAgg, last24Hours, last7Days] =
      await Promise.all([
        ActivityLog.countDocuments({}),
        ActivityLog.aggregate([
          { $group: { _id: '$category', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
        ]),
        ActivityLog.aggregate([
          { $group: { _id: '$status', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
        ]),
        ActivityLog.countDocuments({ createdAt: { $gte: since24h } }),
        ActivityLog.countDocuments({ createdAt: { $gte: since7d } }),
      ]);

    return {
      totalLogs,
      byCategory: byCategoryAgg.map((entry: any) => ({
        category: entry._id || 'unknown',
        count: entry.count,
      })),
      byStatus: byStatusAgg.map((entry: any) => ({
        status: entry._id || 'unknown',
        count: entry.count,
      })),
      last24Hours,
      last7Days,
    };
  }

  static async deleteOldLogs(olderThanDays: number): Promise<number> {
    const cutoff = new Date(
      Date.now() - olderThanDays * 24 * 60 * 60 * 1000
    );
    const result = await ActivityLog.deleteMany({
      createdAt: { $lt: cutoff },
    });
    return result.deletedCount || 0;
  }
}
