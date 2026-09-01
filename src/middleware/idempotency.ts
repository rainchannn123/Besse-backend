import { createHash } from 'crypto';
import { NextFunction, Request, Response } from 'express';
import IdempotencyRequest from '../models/IdempotencyRequest';
import { ObservabilityService } from '../services/observabilityService';
import { logger } from '../utils/logger';

type ScopeResolver = (req: Request) => string;

interface IdempotencyOptions {
  scope: string;
  ttlSeconds?: number;
  resolveScope?: ScopeResolver;
}

const DEFAULT_TTL_SECONDS = 120;

const normalizeScopePart = (value: unknown): string => {
  const raw = String(value || '').trim();
  return raw.length > 0 ? raw : 'global';
};

const getActorId = (req: Request): string => {
  const userId = (req as any)?.user?._id;
  if (userId) {
    return `user:${String(userId)}`;
  }

  const adminUsername = (req as any)?.admin?.username;
  if (adminUsername) {
    return `admin:${String(adminUsername)}`;
  }

  return 'anonymous';
};

const buildRequestFingerprint = (req: Request): string => {
  const canonicalPayload = JSON.stringify({
    method: req.method,
    path: req.path,
    params: req.params || {},
    query: req.query || {},
    body: req.body || {},
  });

  return createHash('sha256').update(canonicalPayload).digest('hex');
};

export const idempotency = ({
  scope,
  ttlSeconds = DEFAULT_TTL_SECONDS,
  resolveScope,
}: IdempotencyOptions) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const incomingKey = req.header('Idempotency-Key') || req.header('idempotency-key');
    const idempotencyKey = String(incomingKey || '').trim();

    if (!idempotencyKey) {
      next();
      return;
    }

    const scopedValue = resolveScope ? resolveScope(req) : 'global';
    const compositeScope = `${scope}:${normalizeScopePart(scopedValue)}`;
    const actorId = getActorId(req);
    const requestFingerprint = buildRequestFingerprint(req);

    const existing = await IdempotencyRequest.findOne({
      actorId,
      scope: compositeScope,
      key: idempotencyKey,
    });

    if (existing) {
      if (existing.requestFingerprint !== requestFingerprint) {
        ObservabilityService.recordIdempotencyOutcome('payload_mismatch');
        res.status(409).json({
          success: false,
          message: 'Idempotency key has already been used with a different request payload',
        });
        return;
      }

      if (existing.status === 'completed') {
        ObservabilityService.recordIdempotencyOutcome('replay');
        res.setHeader('x-idempotent-replay', 'true');
        res.status(existing.responseStatusCode || 200).json(
          existing.responseBody || {
            success: true,
            message: 'Request already processed',
          }
        );
        return;
      }

      ObservabilityService.recordIdempotencyOutcome('in_progress_conflict');
      res.status(409).json({
        success: false,
        message: 'A request with this idempotency key is already being processed',
      });
      return;
    }

    let lockRecord;
    try {
      lockRecord = await IdempotencyRequest.create({
        actorId,
        scope: compositeScope,
        key: idempotencyKey,
        requestFingerprint,
        status: 'in_progress',
        expiresAt: new Date(Date.now() + ttlSeconds * 1000),
      });
    } catch (error: any) {
      if (error?.code === 11000) {
        ObservabilityService.recordIdempotencyOutcome('duplicate_key_race');
        res.status(409).json({
          success: false,
          message: 'Duplicate idempotency key detected. Retry after current request completes.',
        });
        return;
      }

      throw error;
    }

    ObservabilityService.recordIdempotencyOutcome('new_request');

    let responseBody: unknown;
    const originalJson = res.json.bind(res);
    res.json = ((body: unknown) => {
      responseBody = body;
      return originalJson(body as any);
    }) as Response['json'];

    res.once('finish', () => {
      void (async () => {
        try {
          await IdempotencyRequest.updateOne(
            { _id: lockRecord._id },
            {
              $set: {
                status: 'completed',
                responseStatusCode: res.statusCode,
                responseBody:
                  responseBody && typeof responseBody === 'object'
                    ? (responseBody as Record<string, unknown>)
                    : { success: res.statusCode < 400, message: String(responseBody || '') },
              },
            }
          );
        } catch (updateError) {
          logger.error('[Idempotency] Failed to finalize idempotency record', updateError);
        }
      })();
    });

    next();
  };
};
