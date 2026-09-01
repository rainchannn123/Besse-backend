import cors from 'cors';
import express from 'express';
import { createServer } from 'node:http';
import { Server as SocketIOServer } from 'socket.io';
import connectDB from './config/database';
import { env } from './config/env';
import { specs, swaggerUi } from './config/swagger';
import { errorHandler } from './middleware/errorHandler';
import { errorLogger, requestLogger } from './middleware/logger';
import { securityHeaders } from './middleware/security';
import GameSession from './models/GameSession';
import adminRoutes from './routes/adminRoutes';
import authRoutes from './routes/authRoutes';
import brokerRoutes from './routes/brokerRoutes';
import chatbotRoutes from './routes/chatbotRoutes';
import gameRoutes from './routes/gameRoutes';
import lobbyRoutes from './routes/lobbyRoutes';
import matchmakingRoutes from './routes/matchmakingRoutes';
import mrfRoutes from './routes/mrfRoutes';
import municipalityRoutes from './routes/municipalityRoutes';
import { GameService } from './services/gameService';
import { AdminMonitorTelemetryService } from './services/adminMonitorTelemetryService';
import { BrokerService } from './services/brokerService';
import { ObservabilityService } from './services/observabilityService';
import { MRFService } from './services/mrfService';
import { MunicipalityService } from './services/municipalityService';
import { SchedulerLeaseService } from './services/schedulerLeaseService';
import { WebSocketService } from './services/websocketService';
import { NotFoundError } from './utils/AppError';
import { logger } from './utils/logger';

import dns from "node:dns/promises";
dns.setServers(["1.1.1.1"]);

const app = express();

// Connect to MongoDB
connectDB();
import fs from 'fs';
import path from 'path';

// Security Middlewares
app.use(securityHeaders);
app.use(cors());

// Body parsing middleware - MUST be before routes
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Logging
app.use(requestLogger);

// API Routes - ALL routes go here (after body parsing)
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
// Auto-load vectorstore docs if present
try {
  const docsPath = path.join(__dirname, '..', 'vectorstore', 'chroma_docs.json');
  if (fs.existsSync(docsPath)) {
    const raw = fs.readFileSync(docsPath, 'utf-8');
    const docs = JSON.parse(raw) as Array<{ id: string; text: string; metadata?: Record<string, unknown> }>; 
    // lazy import to avoid circular inits
    import('./services/chatbotService').then(mod => {
      if (mod.chatbotService && typeof mod.chatbotService.ingestSeedDocs === 'function') {
        mod.chatbotService.ingestSeedDocs(docs);
        console.log(`Loaded ${docs.length} chatbot docs from vectorstore/chroma_docs.json`);
      }
    }).catch(err => console.error('Failed loading chatbot docs:', err));
  }
} catch {
  console.warn('No prebuilt chatbot docs found or failed to load.');
}
app.use('/api/lobby', lobbyRoutes);
app.use('/api/games', gameRoutes);
app.use('/api/municipality', municipalityRoutes);
app.use('/api/mrf', mrfRoutes);
app.use('/api/broker', brokerRoutes);
app.use('/api/chatbot', chatbotRoutes);

app.use('/api/matchmaking', matchmakingRoutes);

// Swagger Documentation
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(specs));

// Health check
app.get('/', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Besse Backend is running!',
    timestamp: new Date().toISOString(),
    environment: env.NODE_ENV,
  });
});

// API Health check
app.get('/api/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'BESSE API is healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: env.NODE_ENV,
    version: process.env.npm_package_version || '1.0.0',
  });
});

const isMetricsAuthorized = (headerValue: unknown): boolean => {
  const configuredKey = String(env.OBSERVABILITY_METRICS_KEY || '').trim();
  if (!configuredKey) {
    return true;
  }

  return String(headerValue || '').trim() === configuredKey;
};

app.get('/api/health/metrics', (req, res) => {
  const incomingKey = req.header('x-observability-key');
  if (!isMetricsAuthorized(incomingKey)) {
    res.status(403).json({ success: false, message: 'Forbidden' });
    return;
  }

  res.status(200).json({
    success: true,
    message: 'Observability metrics snapshot',
    data: ObservabilityService.getMetricsSnapshot(),
  });
});

app.get('/api/health/slo', (req, res) => {
  const incomingKey = req.header('x-observability-key');
  if (!isMetricsAuthorized(incomingKey)) {
    res.status(403).json({ success: false, message: 'Forbidden' });
    return;
  }

  res.status(200).json({
    success: true,
    message: 'Observability SLO status',
    data: ObservabilityService.getSloStatus(),
  });
});

// 404 handler
app.use((req, res, next) => {
  next(new NotFoundError(`Route ${req.originalUrl} not found`));
});

// Error handling
app.use(errorLogger);
app.use(errorHandler);

const PORT = env.PORT;

// Create HTTP server
const server = createServer(app);

const socketPingIntervalMs = Math.max(10_000, Number(env.SOCKET_PING_INTERVAL_MS) || 30_000);
const socketPingTimeoutMs = Math.max(
  socketPingIntervalMs + 5_000,
  Number(env.SOCKET_PING_TIMEOUT_MS) || 90_000
);
const socketGameStateCoalesceMs = Math.min(
  500,
  Math.max(20, Number(env.SOCKET_GAMESTATE_COALESCE_MS) || 75)
);
const socketTeamChatRateWindowMs = Math.min(
  60_000,
  Math.max(1_000, Number(env.SOCKET_TEAM_CHAT_RATE_WINDOW_MS) || 10_000)
);
const socketTeamChatRateMaxMessages = Math.min(
  200,
  Math.max(1, Number(env.SOCKET_TEAM_CHAT_RATE_MAX_MESSAGES) || 20)
);
const socketTeamChatMaxMessageChars = Math.min(
  2_000,
  Math.max(80, Number(env.SOCKET_TEAM_CHAT_MAX_MESSAGE_CHARS) || 400)
);

// Initialize Socket.IO for real-time communication
const io = new SocketIOServer(server, {
  cors: {

    origin: env.ALLOWED_ORIGINS,
    methods: ['GET', 'POST'],
    credentials: true,
    },
  pingTimeout: socketPingTimeoutMs,
  pingInterval: socketPingIntervalMs,
});

// Initialize WebSocket service
WebSocketService.configure({
  gameStateCoalesceMs: socketGameStateCoalesceMs,
  teamChatRateWindowMs: socketTeamChatRateWindowMs,
  teamChatRateMaxMessages: socketTeamChatRateMaxMessages,
  teamChatMaxMessageChars: socketTeamChatMaxMessageChars,
});

WebSocketService.initialize(io);

const MIN_ADMIN_MONITOR_TELEMETRY_INTERVAL_MS = 15_000;

if (env.ADMIN_MONITOR_TELEMETRY_ENABLED) {
  const telemetryIntervalMs = Math.max(
    MIN_ADMIN_MONITOR_TELEMETRY_INTERVAL_MS,
    Number(env.ADMIN_MONITOR_TELEMETRY_INTERVAL_MS) || MIN_ADMIN_MONITOR_TELEMETRY_INTERVAL_MS
  );

  // Admin monitor telemetry snapshots (minimum every 15 seconds for started rooms)
  AdminMonitorTelemetryService.startScheduledSnapshots(telemetryIntervalMs);
}

// Scheduled system checks (every 30 seconds)
const SYSTEM_CHECK_INTERVAL = 30 * 1000;
const TRANSPORT_COMPLETION_INTERVAL = 1 * 1000;
const AUCTION_RESOLUTION_INTERVAL = 1 * 1000;

const dedupeSessionIdsByRoom = (
  sessions: Array<{ sessionId: string; gameState?: { roomCode?: string | null } }>
): string[] => {
  const canonicalSessionsByRoom = new Map<string, string>();

  for (const session of sessions) {
    const roomCode = String(session.gameState?.roomCode || '').trim().toUpperCase();
    const dedupeKey = roomCode || session.sessionId;

    if (!canonicalSessionsByRoom.has(dedupeKey)) {
      canonicalSessionsByRoom.set(dedupeKey, session.sessionId);
    }
  }

  return Array.from(canonicalSessionsByRoom.values());
};

setInterval(async () => {
  await SchedulerLeaseService.runSingletonJob('scheduler.transport-completion', 1500, async () => {
    try {
      const activeSessions = await GameSession.find(
        {
          'gameState.gameStatus': 'active',
          'gameState.teams.activeTransports.status': 'in-transit',
        },
        { sessionId: 1, gameState: 1, _id: 0 }
      ).lean();

      // Transport completion is team-specific. Do not dedupe by room here,
      // otherwise only one team in a room gets processed per tick.
      const targetSessionIds = Array.from(
        new Set(
          (activeSessions as Array<{ sessionId: string }>).map((session) => session.sessionId)
        )
      );

      for (const sessionId of targetSessionIds) {

        try {
          await MunicipalityService.completeAllTransports(sessionId);
        } catch (error) {
          logger.error(`Transport completion (municipality) failed for session ${sessionId}`, error);
        }

        try {
          await MRFService.completeMrfMaterialTransports(sessionId);
        } catch (error) {
          logger.error(`Transport completion (mrf) failed for session ${sessionId}`, error);
        }
      }
    } catch (error) {
      logger.error('Error during transport completion scheduler', error);
    }
  });
}, TRANSPORT_COMPLETION_INTERVAL);

setInterval(async () => {
  await SchedulerLeaseService.runSingletonJob('scheduler.auction-resolution', 1500, async () => {
    try {
      const activeSessions = await GameSession.find(
        {
          'gameState.gameStatus': 'active',
          'gameState.teams.marketplaceListing.status': 'active',
        },
        { sessionId: 1, gameState: 1, _id: 0 }
      ).lean();

      const uniqueSessionIds = dedupeSessionIdsByRoom(
        activeSessions as Array<{ sessionId: string; gameState?: { roomCode?: string | null } }>
      );

      for (const sessionId of uniqueSessionIds) {
        try {
          await BrokerService.resolveExpiredAuctions(sessionId);
        } catch (error) {
          logger.error(`Auction resolution failed for session ${sessionId}`, error);
        }
      }
    } catch (error) {
      logger.error('Error during auction resolution scheduler', error);
    }
  });
}, AUCTION_RESOLUTION_INTERVAL);

setInterval(async () => {
  await SchedulerLeaseService.runSingletonJob(
    'scheduler.system-check',
    Math.max(5_000, Math.floor(SYSTEM_CHECK_INTERVAL * 0.9)),
    async () => {
      try {
        const activeSessions = await GameSession.find(
          { 'gameState.gameStatus': 'active' },
          { sessionId: 1, gameState: 1, _id: 0 }
        ).lean();

        const targetSessionIds = dedupeSessionIdsByRoom(activeSessions);

        logger.info(
          `Running system checks for ${targetSessionIds.length} active room(s) (${activeSessions.length} active session documents)`
        );

        for (const sessionId of targetSessionIds) {
          try {
            await GameService.performSystemCheck(sessionId);
            logger.info(`System check completed for session: ${sessionId}`);
          } catch (error) {
            logger.error(`System check failed for session ${sessionId}`, error);
          }
        }
      } catch (error) {
        logger.error('Error during scheduled system checks', error);
      }
    }
  );
}, SYSTEM_CHECK_INTERVAL);

// Pairing scheduler - Commented out (replaced by matchmaking)
// setInterval(async () => {
//   try {
//     const pairs = await LobbyService.checkAndCreatePairs();
//     if (pairs && pairs.length > 0) {
//       logger.info(
//         `Created ${pairs.length} pair(s): ${pairs.map(p => p.pairId).join(', ')}`
//       );
//     }
//   } catch (err) {
//     logger.error('Error during pairing scheduler', err);
//   }
// }, SYSTEM_CHECK_INTERVAL);

// Countdown broadcaster
setInterval(async () => {
  await SchedulerLeaseService.runSingletonJob('scheduler.countdown-broadcaster', 1500, async () => {
    try {
      const gamesWithCountdown = await GameSession.find(
        {
          'gameState.gameOverCountdown.active': true,
          'gameState.gameStatus': 'active',
        },
        { sessionId: 1, gameState: 1, _id: 0 }
      ).lean();

      const targetSessionIds = dedupeSessionIdsByRoom(gamesWithCountdown);

      for (const sessionId of targetSessionIds) {
        const session = gamesWithCountdown.find((item) => item.sessionId === sessionId);
        if (!session?.gameState) continue;

        const gameState = session.gameState;

        if (
          gameState.gameOverCountdown &&
          gameState.gameOverCountdown.active &&
          gameState.gameOverCountdown.startTime
        ) {
          const now = Date.now();
          const elapsed = (now - gameState.gameOverCountdown.startTime) / 1000;
          const timeRemaining = Math.max(
            0,
            (gameState.constants?.COUNTDOWN_DURATION_SECONDS || 30) - elapsed
          );

          if (timeRemaining > 0) {
            const team = gameState.teams?.find((t: any) => t.sessionId === sessionId);
            const teamLabel = team ? `City ${team.citySlot}` : 'Unknown';

            WebSocketService.broadcastSystemMessage(
              sessionId,
              `GAME OVER of TEAM ${teamLabel} IN ${Math.ceil(timeRemaining)} SECONDS`,
              'warning'
            );
          } else {
            try {
              await GameService.performSystemCheck(sessionId);
            } catch (err) {
              logger.error('Error finalizing game on countdown expiry', err);
            }
          }
        }
      }
    } catch (error) {
      logger.error('Error during countdown broadcaster', error);
    }
  });
}, 1000);

server.listen(PORT, () => {
  logger.info(`Besse Backend server running on port ${PORT}`);
  logger.info(

    `WebSocket server initialized (pingInterval=${socketPingIntervalMs}ms, pingTimeout=${socketPingTimeoutMs}ms)`
  );
  logger.info(
    `WebSocket traffic controls enabled (gameStateCoalesce=${socketGameStateCoalesceMs}ms, teamChatLimit=${socketTeamChatRateMaxMessages}/${socketTeamChatRateWindowMs}ms, teamChatMaxChars=${socketTeamChatMaxMessageChars})`
  );

  logger.info(`System checks scheduled every ${SYSTEM_CHECK_INTERVAL / 1000} seconds`);
  logger.info(
    `Transport completion scheduler running every ${TRANSPORT_COMPLETION_INTERVAL / 1000} seconds`
  );
  logger.info(
    `Auction resolution scheduler running every ${AUCTION_RESOLUTION_INTERVAL / 1000} seconds`
  );

  if (env.ADMIN_MONITOR_TELEMETRY_ENABLED) {
    logger.info(
      `Admin monitor telemetry snapshots scheduled every ${Math.max(
        MIN_ADMIN_MONITOR_TELEMETRY_INTERVAL_MS,
        Number(env.ADMIN_MONITOR_TELEMETRY_INTERVAL_MS) ||
          MIN_ADMIN_MONITOR_TELEMETRY_INTERVAL_MS
      ) / 1000} seconds`
    );
  }
});

export default app;
export { io };
