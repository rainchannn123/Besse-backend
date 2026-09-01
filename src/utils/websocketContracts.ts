import { z } from 'zod';
import { logger } from './logger';

const nonEmptyString = z.string().trim().min(1);

const inboundSchemas = {
  'join-game': z.object({ sessionId: nonEmptyString }),
  'leave-game': z.object({ sessionId: nonEmptyString }),
  'join-admin-monitor-room': z.object({ roomCode: nonEmptyString }),
  'leave-admin-monitor-room': z.object({ roomCode: nonEmptyString }),
  'join-matchmaking-room': z.object({ roomCode: nonEmptyString }),
  'leave-matchmaking-room': z.object({ roomCode: nonEmptyString }),
  'room:ready-toggle': z.object({
    roomCode: nonEmptyString,
    sessionId: nonEmptyString,
  }),
  'surrender-toggle': z.object({ sessionId: nonEmptyString }),
  'team-chat-message': z.object({
    sessionId: nonEmptyString,
    message: z.string().trim().min(1).max(2000),
  }),
} as const;

const outboundSchemas = {
  'game-state-update': z.object({
    sessionId: nonEmptyString,
    gameState: z.unknown(),
    timestamp: z.number().int().nonnegative(),
  }),
  'game-state-updated': z.object({
    sessionId: nonEmptyString,
    gameState: z.unknown(),
    actionType: nonEmptyString,
    actionDetails: z.unknown().optional(),
    timestamp: z.number().int().nonnegative(),
  }),
  'player-action': z.object({
    sessionId: nonEmptyString,
    playerId: nonEmptyString.optional(),
    playerName: nonEmptyString,
    action: nonEmptyString,
    details: z.unknown().optional(),
    timestamp: z.number().int().nonnegative(),
  }),
  'system-message': z.object({
    sessionId: nonEmptyString,
    message: nonEmptyString,
    type: z.enum(['info', 'warning', 'error']),
    timestamp: z.number().int().nonnegative(),
  }),
  'team-chat-message': z.object({
    sessionId: nonEmptyString,
    senderId: nonEmptyString,
    senderName: nonEmptyString,
    senderRole: nonEmptyString,
    message: nonEmptyString,
    timestamp: z.number().int().nonnegative(),
  }),
  'room:seating:update': z.object({
    roomCode: nonEmptyString,
    teams: z.array(
      z.object({
        citySlot: z.number().int(),
        players: z.array(
          z.object({
            userId: nonEmptyString,
            name: nonEmptyString,
            role: z.string().nullable(),
            isLeader: z.boolean(),
          })
        ),
        isReady: z.boolean(),
      })
    ),
    timestamp: z.number().int().nonnegative(),
  }),
  'room:all-ready': z.object({
    roomCode: nonEmptyString,
    message: nonEmptyString,
    timestamp: z.number().int().nonnegative(),
  }),
} as const;

type InboundEventName = keyof typeof inboundSchemas;
type OutboundEventName = keyof typeof outboundSchemas;

export function parseInboundSocketPayload<TEvent extends InboundEventName>(
  eventName: TEvent,
  payload: unknown
): z.infer<(typeof inboundSchemas)[TEvent]> | null {
  const parsed = inboundSchemas[eventName].safeParse(payload);
  if (parsed.success) {
    return parsed.data as z.infer<(typeof inboundSchemas)[TEvent]>;
  }

  logger.warn(
    `[WebSocket][contract] Invalid inbound payload for '${eventName}': ${parsed.error.issues
      .map((issue) => issue.message)
      .join(', ')}`
  );
  return null;
}

export function parseOutboundSocketPayload(
  eventName: string,
  payload: Record<string, unknown>
): Record<string, unknown> | null {
  if (!(eventName in outboundSchemas)) {
    return payload;
  }

  const schema = outboundSchemas[eventName as OutboundEventName];
  const parsed = schema.safeParse(payload);
  if (parsed.success) {
    return parsed.data as Record<string, unknown>;
  }

  logger.warn(
    `[WebSocket][contract] Outbound payload schema mismatch for '${eventName}': ${parsed.error.issues
      .map((issue) => issue.message)
      .join(', ')}`
  );

  // Keep emitting payload to avoid gameplay regressions while contracts evolve.
  return payload;
}
