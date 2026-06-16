import { Server as SocketIOServer } from 'socket.io';
import {
  AuthenticatedSocket,
  socketAuthMiddleware,
  validateGameAccess,
} from '../middleware/socketAuth';
import { GameState } from '../types';
import { logger } from '../utils/logger';
import { GameService } from './gameService';
import Lobby from '../models/Lobby';

export class WebSocketService {
  private static io: SocketIOServer;
  private static gameRooms: Map<string, Set<string>> = new Map(); // sessionId -> Set of socketIds

  private static getTeamRoomName(sessionId: string, teamRole?: string | null): string | null {
    if (!teamRole) return null;
    const normalizedRole = String(teamRole).trim().toLowerCase().replace(/\s+/g, '-');
    return `${sessionId}:team:${normalizedRole}`;
  }

  private static getPlayerTeamRoleFromSession(
    gameState: GameState | null,
    userId?: string
  ): 'Team A' | 'Team B' | null {
    if (!gameState || !userId || !gameState.partnerSessionId) return null;

    const playerIds = [
      gameState.players?.municipality,
      gameState.players?.mrf,
      gameState.players?.broker,
    ].filter(Boolean) as string[];

    const isInCurrentSession = playerIds.includes(userId);
    if (!isInCurrentSession) return null;

    return (gameState.teamRole as 'Team A' | 'Team B' | null) || null;
  }

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

          // Join team-specific room for teammate-only chat
          const gameState = await GameService.getGameState(sessionId);
          const playerTeamRole = this.getPlayerTeamRoleFromSession(gameState, socket.userId);
          const teamRoomName = this.getTeamRoomName(sessionId, playerTeamRole);
          if (teamRoomName) {
            socket.join(teamRoomName);
            logger.info(
              `[WebSocket] User ${socket.user?.name} joined team room: ${teamRoomName}`
            );
          }

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

      // Handle surrender vote toggle
      socket.on('surrender-toggle', async (data: { sessionId: string }) => {
        const { sessionId } = data;
        const playerId = socket.userId!;

        try {
          const hasAccess = await validateGameAccess(socket, sessionId);
          if (!hasAccess) {
            socket.emit('error', { message: 'You do not have access to this game session' });
            return;
          }

          const gameState = await GameService.getGameState(sessionId);
          if (!gameState || gameState.gameStatus !== 'active') {
            socket.emit('surrender-error', { message: 'Game is not active' });
            return;
          }

          // Only available after 15 minutes of play
          if ((gameState.minutesElapsed || 0) < 15) {
            socket.emit('surrender-error', {
              message: 'Surrender is only available after 15 minutes of play',
            });
            return;
          }

          // Initialize if missing (backward compat)
          if (!gameState.surrenderVotes) gameState.surrenderVotes = [];

          const voteIndex = gameState.surrenderVotes.indexOf(playerId);
          if (voteIndex === -1) {
            gameState.surrenderVotes.push(playerId);
            logger.info(`[Surrender] ${socket.user?.name} voted to surrender in session ${sessionId}`);
          } else {
            gameState.surrenderVotes.splice(voteIndex, 1);
            logger.info(`[Surrender] ${socket.user?.name} withdrew surrender vote in session ${sessionId}`);
          }

          const totalVotes = gameState.surrenderVotes.length;

          // Check if all 3 players surrendered
          if (totalVotes >= 3) {
            gameState.gameStatus = 'lost';
            gameState.activityLog.unshift('[SURRENDER] All players have surrendered. The game has ended.');

            // Update pair status
            if (gameState.teamRole === 'Team A') {
              gameState.pairStatus = 'team_a_eliminated';
            } else if (gameState.teamRole === 'Team B') {
              gameState.pairStatus = 'team_b_eliminated';
            }

            // Mark lobby as completed
            await Lobby.findOneAndUpdate({ sessionId }, { status: 'completed' });

            await GameService.updateGameState(sessionId, gameState);

            // Broadcast final game state so all players route to game-over
            this.emitToGameRoom(sessionId, 'game-state-full', {
              gameState,
              actionType: 'surrender',
              surrenderVotes: gameState.surrenderVotes,
              totalVotes,
            });
          } else {
            await GameService.updateGameState(sessionId, gameState);

            // Broadcast updated vote count to all players in the session
            this.emitToGameRoom(sessionId, 'surrender-update', {
              surrenderVotes: gameState.surrenderVotes,
              totalVotes,
            });
          }
        } catch (err) {
          logger.error('[Surrender] Error handling surrender-toggle:', err);
          socket.emit('error', { message: 'Failed to process surrender vote' });
        }
      });

      // Team chat (only visible within same game session room)
      socket.on('team-chat-message', async (data: { sessionId: string; message: string }) => {
        const { sessionId, message } = data || {};

        try {
          if (!sessionId || !message || !message.trim()) {
            socket.emit('error', { message: 'Invalid team chat payload' });
            return;
          }

          const hasAccess = await validateGameAccess(socket, sessionId);
          if (!hasAccess) {
            socket.emit('error', { message: 'You do not have access to this game session' });
            return;
          }

          const gameState = await GameService.getGameState(sessionId);
          const playerTeamRole = this.getPlayerTeamRoleFromSession(gameState, socket.userId);
          const teamRoomName = this.getTeamRoomName(sessionId, playerTeamRole);
          if (!teamRoomName) {
            socket.emit('error', { message: 'Team chat is not available for this session' });
            return;
          }

          this.io.to(teamRoomName).emit('team-chat-message', {
            senderId: socket.userId,
            senderName: socket.user?.name || 'Unknown',
            senderRole: socket.user?.role || 'player',
            message: message.trim(),
            sessionId,
            timestamp: Date.now(),
          });
        } catch (err) {
          logger.error('[WebSocket] Error handling team-chat-message:', err);
          socket.emit('error', { message: 'Failed to send team chat message' });
        }
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
