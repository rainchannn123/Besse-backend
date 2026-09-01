import type { Request, Response, NextFunction } from 'express';
import { ObservabilityService } from '../services/observabilityService';
import { logger } from '../utils/logger';

const resolveRouteLabel = (req: Request): string => {
  const routePath = req.route?.path;
  if (typeof routePath === 'string' && routePath.length > 0) {
    return `${req.baseUrl || ''}${routePath}`;
  }

  return req.baseUrl ? `${req.baseUrl}${req.path}` : req.path || req.originalUrl;
};

export const requestLogger = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    const { method, originalUrl, ip } = req;
    const { statusCode } = res;
    const route = resolveRouteLabel(req);

    ObservabilityService.recordHttpRequest({
      durationMs: duration,
      method,
      route,
      statusCode,
    });

    const logMessage = `${method} ${originalUrl} ${statusCode} ${duration}ms - ${ip}`;

    if (statusCode >= 500) {
      logger.error(logMessage);
    } else if (statusCode >= 400) {
      logger.warn(logMessage);
    } else {
      logger.info(logMessage);
    }
  });

  next();
};

export const errorLogger = (
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  logger.error('Request error', {
    message: err.message,
    stack: err.stack,
    url: req.originalUrl,
    method: req.method,
    ip: req.ip,
  });
  next(err);
};
