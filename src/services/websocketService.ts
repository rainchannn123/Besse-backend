import { Server as SocketIOServer } from 'socket.io';
import {
  AuthenticatedSocket,
  socketAuthMiddleware,
  validateGameAccess,
} from '../middleware/socketAuth';
import { GameState } from '../types';
import { logger } from '../utils/logger';

export class WebSocketService {
  private static io: SocketIOServer;
  private static gameRooms: Map<string, Set<string>> = new Map(); // sessionId -> Set of socketIds

  static initialize(io: SocketIOServer) {
    this.io = io;

    // Use authentication middleware
    io.use(socketAuthMiddleware);

    this.setupSocketHandlers();
  }

  private static setupSocketHandlers() {
    this.io.on('connection', (socket: AuthenticatedSocket) => {
      logger.info(
        `Client connected: ${socket.id} (User: ${socket.user?.name})`
      );

      // Handle joining a game room
      socket.on('join-game', async (data: { sessionId: string }) => {
        const { sessionId } = data;

        logger.info(
          `[WebSocket] join-game event received: sessionId=${sessionId}, userId=${socket.userId}, userName=${socket.user?.name}`
        );

        try {
          // Validate user has access to this game
          const hasAccess = await validateGameAccess(socket, sessionId);
          if (!hasAccess) {
            logger.warn(
              `[WebSocket] Access denied: User ${socket.userId} (${socket.user?.name}) cannot access session ${sessionId}`
            );
            socket.emit('error', {
              message: 'You do not have access to this game session',
            });
            return;
          }

          // Leave any existing rooms
          socket.rooms.forEach(room => {
            if (room !== socket.id) {
              logger.info(
                `[WebSocket] User ${socket.user?.name} leaving room: ${room}`
              );
              socket.leave(room);
            }
          });

          // Join the game room
          socket.join(sessionId);

          // Track socket in game room
          if (!this.gameRooms.has(sessionId)) {
            this.gameRooms.set(sessionId, new Set());
          }
          this.gameRooms.get(sessionId)!.add(socket.id);

          logger.info(
            `[WebSocket] ✅ User ${socket.user?.name} (${socket.userId}) JOINED game room: ${sessionId}. Room has ${this.gameRooms.get(sessionId)!.size} users`
          );

          // Send confirmation
          socket.emit('joined-game', {
            sessionId,
            userId: socket.userId,
            userName: socket.user?.name,
          });
        } catch (error) {
          logger.error('[WebSocket] Error joining game room:', error);
          socket.emit('error', { message: 'Failed to join game room' });
        }
      });

      // Handle leaving a game room
      socket.on('leave-game', (data: { sessionId: string }) => {
        const { sessionId } = data;

        socket.leave(sessionId);

        // Remove from tracking
        const roomSockets = this.gameRooms.get(sessionId);
        if (roomSockets) {
          roomSockets.delete(socket.id);
          if (roomSockets.size === 0) {
            this.gameRooms.delete(sessionId);
          }
        }

        logger.warn(`User ${socket.user?.name} left game room: ${sessionId}`);
      });

      // Handle disconnection
      socket.on('disconnect', () => {
        logger.warn(
          `Client disconnected: ${socket.id} (User: ${socket.user?.name})`
        );

        // Clean up from all rooms
        this.gameRooms.forEach((sockets, sessionId) => {
          if (sockets.has(socket.id)) {
            sockets.delete(socket.id);
            if (sockets.size === 0) {
              this.gameRooms.delete(sessionId);
            }
          }
        });
      });
    });
  }

  /**
   * Broadcast game state update to all players in a game session
   */
  static broadcastGameState(
    sessionId: string,
    gameState: GameState,
    eventType: string = 'game-state-update'
  ) {
    this.io.to(sessionId).emit(eventType, {
      sessionId,
      gameState,
      timestamp: Date.now(),
    });
  }

  /**
   * Send specific event to all players in a game session
   */
  static emitToGameRoom(sessionId: string, event: string, data: any) {
    const roomSize = this.gameRooms.get(sessionId)?.size || 0;
    logger.info(
      `[WebSocket] Broadcasting '${event}' to room '${sessionId}' (${roomSize} connected clients)`
    );

    this.io.to(sessionId).emit(event, {
      ...data,
      sessionId,
      timestamp: Date.now(),
    });
  }

  /**
   * Send event to specific player in a game session
   */
  static emitToPlayer(
    sessionId: string,
    playerId: string,
    event: string,
    data: any
  ) {
    // Find socket for this player (this is a simplified approach)
    // In a production app, you'd want to maintain a mapping of userId to socketId
    this.io.to(sessionId).emit(event, {
      ...data,
      sessionId,
      playerId,
      timestamp: Date.now(),
    });
  }

  /**
   * Get number of connected players in a game session
   */
  static getPlayerCount(sessionId: string): number {
    return this.gameRooms.get(sessionId)?.size || 0;
  }

  /**
   * Check if a game session has active connections
   */
  static hasActiveConnections(sessionId: string): boolean {
    const roomSockets = this.gameRooms.get(sessionId);
    return roomSockets ? roomSockets.size > 0 : false;
  }

  /**
   * Broadcast system messages (waste spawned, penalties applied, etc.)
   */
  static broadcastSystemMessage(
    sessionId: string,
    message: string,
    type: 'info' | 'warning' | 'error' = 'info'
  ) {
    this.emitToGameRoom(sessionId, 'system-message', {
      message,
      type,
      timestamp: Date.now(),
    });
  }

  /**
   * Broadcast player action notifications
   */
  static broadcastPlayerAction(
    sessionId: string,
    playerId: string,
    playerName: string,
    action: string,
    details?: any
  ) {
    this.emitToGameRoom(sessionId, 'player-action', {
      playerId,
      playerName,
      action,
      details,
      timestamp: Date.now(),
    });
  }

  /**
   * Broadcast game state update after any action/change
   * This ensures all connected players receive real-time state updates
   */
  static broadcastGameStateUpdate(
    sessionId: string,
    gameState: GameState,
    actionType: string,
    actionDetails?: any
  ) {
    this.io.to(sessionId).emit('game-state-updated', {
      sessionId,
      gameState,
      actionType, // e.g., 'waste-collected', 'waste-spawned', 'turn-ended', etc.
      actionDetails, // Additional context about what changed
      timestamp: Date.now(),
    });

    logger.info(
      `Broadcasted game state update for session ${sessionId} - Action: ${actionType}`
    );
  }

  /**
   * Broadcast full game state payload that mirrors the `/api/games/:sessionId` response structure
   * Includes computed extras like countdown time remaining, turn summary and statistics.
   */
  static broadcastFullGameState(
    sessionId: string,
    payload: Record<string, any>,
    eventName: string = 'game-state-full'
  ) {
    this.io.to(sessionId).emit(eventName, {
      ...payload,
      sessionId,
      timestamp: Date.now(),
    });

    logger.info(
      `Broadcasted full game state for session ${sessionId} (event=${eventName})`
    );
  }
}
