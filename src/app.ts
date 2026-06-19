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
import mrfRoutes from './routes/mrfRoutes';
import municipalityRoutes from './routes/municipalityRoutes';
import waitingRoomRoutes from './routes/waitingRoomRoutes';
import { GameService } from './services/gameService';
import { LobbyService } from './services/lobbyService';
import { WebSocketService } from './services/websocketService';
import { NotFoundError } from './utils/AppError';
import { logger } from './utils/logger';

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

// Rate limiting (commented out)
// app.use('/api/auth', authLimiter);
// app.use('/api/', generalLimiter);

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
} catch (e) {
  console.warn('No prebuilt chatbot docs found or failed to load.');
}
app.use('/api/lobby', lobbyRoutes);
app.use('/api/games', gameRoutes);
app.use('/api/municipality', municipalityRoutes);
app.use('/api/mrf', mrfRoutes);
app.use('/api/broker', brokerRoutes);
app.use('/api/chatbot', chatbotRoutes);
app.use('/api/waiting-rooms', waitingRoomRoutes);

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

// Initialize Socket.IO for real-time communication
const io = new SocketIOServer(server, {
  cors: {
    origin: env.ALLOWED_ORIGINS,
    methods: ['GET', 'POST'],
    credentials: true,
  },
  pingTimeout: 60000,
  pingInterval: 25000,
});

// Initialize WebSocket service
WebSocketService.initialize(io);

// Scheduled system checks (every 30 seconds)
const SYSTEM_CHECK_INTERVAL = 30 * 1000;

setInterval(async () => {
  try {
    const activeSessions = await GameSession.find({
      'gameState.gameStatus': 'active',
    });

    logger.info(`Running system checks for ${activeSessions.length} active games`);

    for (const session of activeSessions) {
      try {
        await GameService.performSystemCheck(session.sessionId);
        logger.info(`System check completed for session: ${session.sessionId}`);
      } catch (error) {
        logger.error(`System check failed for session ${session.sessionId}`, error);
      }
    }
  } catch (error) {
    logger.error('Error during scheduled system checks', error);
  }
}, SYSTEM_CHECK_INTERVAL);

// Pairing scheduler
setInterval(async () => {
  try {
    const pairs = await LobbyService.checkAndCreatePairs();
    if (pairs && pairs.length > 0) {
      logger.info(
        `Created ${pairs.length} pair(s): ${pairs.map(p => p.pairId).join(', ')}`
      );
    }
  } catch (err) {
    logger.error('Error during pairing scheduler', err);
  }
}, SYSTEM_CHECK_INTERVAL);

// Countdown broadcaster
setInterval(async () => {
  try {
    const gamesWithCountdown = await GameSession.find({
      'gameState.gameOverCountdown.active': true,
      'gameState.gameStatus': 'active',
    });

    for (const session of gamesWithCountdown) {
      const gameState = session.gameState;
      if (
        gameState.gameOverCountdown.active &&
        gameState.gameOverCountdown.startTime
      ) {
        const now = Date.now();
        const elapsed = (now - gameState.gameOverCountdown.startTime) / 1000;
        const timeRemaining = Math.max(
          0,
          gameState.constants.COUNTDOWN_DURATION_SECONDS - elapsed
        );

        if (timeRemaining > 0) {
          const teamLabel = gameState.teamRole === 'Team A' ? 'A' : 'B';
          WebSocketService.broadcastSystemMessage(
            session.sessionId,
            `GAME OVER of TEAM ${teamLabel} IN ${Math.ceil(timeRemaining)} SECONDS`,
            'warning'
          );
        } else {
          try {
            await GameService.performSystemCheck(session.sessionId);
          } catch (err) {
            logger.error('Error finalizing game on countdown expiry', err);
          }
        }
      }
    }
  } catch (error) {
    logger.error('Error during countdown broadcaster', error);
  }
}, 1000);

server.listen(PORT, () => {
  logger.info(`Besse Backend server running on port ${PORT}`);
  logger.info(`WebSocket server initialized`);
  logger.info(`System checks scheduled every ${SYSTEM_CHECK_INTERVAL / 1000} seconds`);
});

export default app;
export { io };