import { NextFunction, Request, Response } from 'express';
import { ActivityCategory, ActivityStatus } from '../models/ActivityLog';
import { ActivityLogService } from '../services/activityLogService';

const resolveCategoryFromPath = (path: string): ActivityCategory => {
  const p = path.toLowerCase();
  if (p.includes('/auth')) return 'auth';
  if (p.includes('/admin')) return 'admin';
  if (p.includes('/lobby')) return 'lobby';
  if (p.includes('/matchmaking')) return 'matchmaking';
  if (p.includes('/municipality')) return 'municipality';
  if (p.includes('/mrf')) return 'mrf';
  if (p.includes('/broker')) return 'broker';
  if (p.includes('/games')) return 'game';
  return 'system';
};

const resolveAction = (method: string, path: string): string => {
  const segments = path
    .replace(/^\/api\//, '')
    .split('/')
    .filter(seg => seg.length > 0 && !seg.match(/^[a-f0-9]{8,}$/i));
  const base = segments.slice(0, 3).join('.') || 'request';
  return `${method.toUpperCase()}:${base}`;
};

const buildDescription = (
  req: Request,
  res: Response,
  status: ActivityStatus
): string => {
  const user = (req as any).user;
  const admin = (req as any).admin;
  const actor = user?.name || user?.email || admin?.username || 'Anonymous';
  const method = req.method;
  const path = req.originalUrl.split('?')[0];
  if (status === 'failure') {
    return `${actor} attempted ${method} ${path} → HTTP ${res.statusCode}`;
  }
  return `${actor} performed ${method} ${path}`;
};

const sanitizeBody = (body: any): Record<string, any> => {
  if (!body || typeof body !== 'object') return {};
  const SENSITIVE_KEYS = [
    'password',
    'currentPassword',
    'newPassword',
    'token',
    'authToken',
    'refreshToken',
    'apiKey',
    'secret',
  ];
  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(body)) {
    if (SENSITIVE_KEYS.includes(key)) {
      result[key] = '[REDACTED]';
      continue;
    }
    if (typeof value === 'string' && value.length > 500) {
      result[key] = value.slice(0, 500) + '…[truncated]';
      continue;
    }
    if (value === null || value === undefined) {
      result[key] = value;
      continue;
    }
    if (typeof value === 'object') {
      try {
        const stringified = JSON.stringify(value);
        result[key] =
          stringified.length > 2000
            ? stringified.slice(0, 2000) + '…[truncated]'
            : value;
      } catch {
        result[key] = '[unserializable]';
      }
      continue;
    }
    result[key] = value;
  }
  return result;
};

const SHOULD_LOG_GET_PATHS = ['/api/auth/profile'];

const shouldLog = (req: Request): boolean => {
  const method = req.method.toUpperCase();
  if (method === 'GET') {
    return SHOULD_LOG_GET_PATHS.some(p => req.originalUrl.startsWith(p));
  }
  return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
};

export const activityLogger = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  if (!shouldLog(req)) {
    return next();
  }

  const bodySnapshot = sanitizeBody(req.body);
  const querySnapshot = sanitizeBody(req.query);
  const paramsSnapshot = sanitizeBody(req.params);

  res.on('finish', () => {
    const isFailure = res.statusCode >= 400;
    const status: ActivityStatus = isFailure ? 'failure' : 'success';

    const user = (req as any).user;
    const admin = (req as any).admin;
    const path = req.originalUrl.split('?')[0];
    const category: ActivityCategory = resolveCategoryFromPath(path);
    const action = resolveAction(req.method, path);
    const description = buildDescription(req, res, status);

    const ipAddress =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      req.socket?.remoteAddress ||
      null;

    const userAgent = (req.headers['user-agent'] as string) || null;

    ActivityLogService.log({
      userId: user?._id || null,
      userName: user?.name || admin?.username || null,
      userEmail: user?.email || null,
      accountType: user?.accountType || (admin ? 'admin' : null),
      role: user?.role || null,
      category,
      action,
      description,
      sessionId:
        bodySnapshot.sessionId ||
        paramsSnapshot.sessionId ||
        querySnapshot.sessionId ||
        user?.currentSession ||
        null,
      targetUserId: paramsSnapshot.userId || null,
      status,
      statusCode: res.statusCode,
      method: req.method,
      route: path,
      ipAddress,
      userAgent,
      metadata: {
        body: bodySnapshot,
        query: querySnapshot,
        params: paramsSnapshot,
      },
    });
  });

  next();
};
