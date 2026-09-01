import { Server as SocketIOServer } from 'socket.io';
import {
  AuthenticatedSocket,
  socketAuthMiddleware,
  validateGameAccess,
} from '../middleware/socketAuth';
import { GameState } from '../types';
import { logger } from '../utils/logger';
import { GameService } from './gameService';
import MatchmakingRoom from '../models/MatchmakingRoom';

export class WebSocketService {
  private static io: SocketIOServer;
  private static gameRooms: Map<string, Set<string>> = new Map();
  private static pendingGameStateUpdates: Map<
    string,
    { payload: Record<string, any>; timer: NodeJS.Timeout }
  > = new Map();
  private static socketRateLimitState: Map<
    string,
    Map<string, { count: number; windowStartedAt: number; lastWarnAt: number }>
  > = new Map();
  private static readonly ADMIN_MONITOR_ROOM_PREFIX = 'admin-monitor-';
  private static gameStateCoalesceMs = 75;
  private static teamChatRateWindowMs = 10_000;
  private static teamChatRateMaxMessages = 20;
  private static teamChatMaxMessageChars = 400;

  static configure(options: {
    gameStateCoalesceMs?: number;
    teamChatRateWindowMs?: number;
    teamChatRateMaxMessages?: number;
    teamChatMaxMessageChars?: number;
  }) {
    if (typeof options.gameStateCoalesceMs === 'number') {
      this.gameStateCoalesceMs = Math.min(
        500,
        Math.max(20, Math.floor(options.gameStateCoalesceMs))
      );
    }

    if (typeof options.teamChatRateWindowMs === 'number') {
      this.teamChatRateWindowMs = Math.min(
        60_000,
        Math.max(1_000, Math.floor(options.teamChatRateWindowMs))
      );
    }

    if (typeof options.teamChatRateMaxMessages === 'number') {
      this.teamChatRateMaxMessages = Math.min(
        200,
        Math.max(1, Math.floor(options.teamChatRateMaxMessages))
      );
    }

    if (typeof options.teamChatMaxMessageChars === 'number') {
      this.teamChatMaxMessageChars = Math.min(
        2_000,
        Math.max(80, Math.floor(options.teamChatMaxMessageChars))
      );
    }
  }

  private static getAdminMonitorRoomName(roomCode: string): string {
    return `${this.ADMIN_MONITOR_ROOM_PREFIX}${String(roomCode || '').trim().toUpperCase()}`;
  }

  private static ensureAuthorizedSessionCache(socket: AuthenticatedSocket): Set<string> {
    if (!socket.authorizedSessionIds) {
      socket.authorizedSessionIds = new Set<string>();
    }

    return socket.authorizedSessionIds;
  }

  private static markSessionAuthorized(socket: AuthenticatedSocket, sessionId: string): void {
    this.ensureAuthorizedSessionCache(socket).add(sessionId);
  }

  private static revokeSessionAuthorization(socket: AuthenticatedSocket, sessionId: string): void {
    this.ensureAuthorizedSessionCache(socket).delete(sessionId);
  }

  private static async isSessionAuthorizedOrValidate(
    socket: AuthenticatedSocket,
    sessionId: string
  ): Promise<boolean> {
    const authorizedSessions = this.ensureAuthorizedSessionCache(socket);
    if (authorizedSessions.has(sessionId)) {
      return true;
    }

    const hasAccess = await validateGameAccess(socket, sessionId);
    if (hasAccess) {
      authorizedSessions.add(sessionId);
    }

    return hasAccess;
  }

  private static consumeSocketRateLimit(
    socketId: string,
    key: string,
    maxPerWindow: number,
    windowMs: number
  ): { allowed: boolean; retryAfterMs: number; shouldWarn: boolean } {
    const now = Date.now();
    let limitsByKey = this.socketRateLimitState.get(socketId);

    if (!limitsByKey) {
      limitsByKey = new Map();
      this.socketRateLimitState.set(socketId, limitsByKey);
    }

    const current = limitsByKey.get(key);
    if (!current || now - current.windowStartedAt >= windowMs) {
      limitsByKey.set(key, {
        count: 1,
        windowStartedAt: now,
        lastWarnAt: 0,
      });

      return { allowed: true, retryAfterMs: 0, shouldWarn: false };
    }

    current.count += 1;
    if (current.count <= maxPerWindow) {
      return { allowed: true, retryAfterMs: 0, shouldWarn: false };
    }

    const retryAfterMs = Math.max(0, windowMs - (now - current.windowStartedAt));
    const shouldWarn = now - current.lastWarnAt > Math.min(windowMs, 30_000);
    if (shouldWarn) {
      current.lastWarnAt = now;
    }

    return { allowed: false, retryAfterMs, shouldWarn };
  }

  private static clearSocketRateLimitState(socketId: string): void {
    this.socketRateLimitState.delete(socketId);
  }

  private static queueCoalescedGameStateUpdate(
    sessionId: string,
    payload: Record<string, any>
  ): void {
    const existingEntry = this.pendingGameStateUpdates.get(sessionId);
    if (existingEntry) {
      existingEntry.payload = payload;
      return;
    }

    const timer = setTimeout(() => {
      const pendingEntry = this.pendingGameStateUpdates.get(sessionId);
      if (!pendingEntry) return;

      this.pendingGameStateUpdates.delete(sessionId);
      this.emitToGameRoom(sessionId, 'game-state-update', pendingEntry.payload);
    }, this.gameStateCoalesceMs);

    this.pendingGameStateUpdates.set(sessionId, {
      payload,
      timer,
    });
  }


  static initialize(io: SocketIOServer) {
    this.io = io;
    io.use(socketAuthMiddleware);
    this.setupSocketHandlers();
  }

  private static setupSocketHandlers() {
    this.io.on('connection', (socket: AuthenticatedSocket) => {
      logger.info(
        `Client connected: ${socket.id} (User: ${socket.user?.name})`
      );

      socket.on('join-game', async (data: { sessionId: string }) => {
        const { sessionId } = data;

        logger.info(
          `[WebSocket] join-game event received: sessionId=${sessionId}, userId=${socket.userId}, userName=${socket.user?.name}`
        );

        try {
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

                    socket.rooms.forEach((room) => {
            if (room !== socket.id) {
              logger.info(
                `[WebSocket] User ${socket.user?.name} leaving room: ${room}`
              );
              this.revokeSessionAuthorization(socket, room);
              socket.leave(room);
            }
          });


          socket.join(sessionId);
          this.markSessionAuthorized(socket, sessionId);

          if (!this.gameRooms.has(sessionId)) {

            this.gameRooms.set(sessionId, new Set());
          }
          this.gameRooms.get(sessionId)!.add(socket.id);

          logger.info(
            `[WebSocket] ✅ User ${socket.user?.name} (${socket.userId}) JOINED game room: ${sessionId}. Room has ${this.gameRooms.get(sessionId)!.size} users`
          );

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

      socket.on('join-admin-monitor-room', (data: { roomCode: string }) => {
        const normalizedRoomCode = String(data?.roomCode || '').trim().toUpperCase();

        if (!normalizedRoomCode) {
          socket.emit('error', { message: 'Room code is required' });
          return;
        }

        if (socket.user?.accountType !== 'admin') {
          socket.emit('error', { message: 'Admin access required for live monitor' });
          return;
        }

        const monitorRoom = this.getAdminMonitorRoomName(normalizedRoomCode);
        socket.join(monitorRoom);

        socket.emit('joined-admin-monitor-room', {
          roomCode: normalizedRoomCode,
        });

        logger.info(
          `[WebSocket] ✅ Admin ${socket.user?.name} (${socket.userId}) joined admin monitor room: ${normalizedRoomCode}`
        );
      });

      socket.on('leave-admin-monitor-room', (data: { roomCode: string }) => {
        const normalizedRoomCode = String(data?.roomCode || '').trim().toUpperCase();
        if (!normalizedRoomCode) return;

        const monitorRoom = this.getAdminMonitorRoomName(normalizedRoomCode);
        socket.leave(monitorRoom);

        logger.info(
          `[WebSocket] Admin ${socket.user?.name} (${socket.userId}) left admin monitor room: ${normalizedRoomCode}`
        );
      });

      socket.on('join-matchmaking-room', async (data: { roomCode: string }) => {
        const { roomCode } = data;
        const userId = socket.userId!;


        logger.info(
          `[WebSocket] join-matchmaking-room event received: roomCode=${roomCode}, userId=${userId}`
        );

        try {
          const room = await MatchmakingRoom.findOne({ roomCode: roomCode.toUpperCase() });
          if (!room) {
            socket.emit('error', { message: 'Room not found' });
            return;
          }

          const isInRoom = room.teams.some(t =>
            t.players.some(p => p.userId === userId)
          );

          if (!isInRoom) {
            socket.emit('error', { message: 'You are not in this room' });
            return;
          }

          const roomSocketId = `matchmaking-${roomCode}`;
          socket.join(roomSocketId);

          this.emitToMatchmakingRoom(roomCode, 'room:seating:update', {
            roomCode: room.roomCode,
            teams: room.teams.map(t => ({
              citySlot: t.citySlot,
              players: t.players.map(p => ({
                userId: p.userId,
                name: p.name,
                role: p.role,
                isLeader: p.isLeader,
              })),
              isReady: t.isReady,
            })),
          });

          socket.emit('joined-matchmaking-room', {
            roomCode: room.roomCode,
          });

          logger.info(
            `[WebSocket] ✅ User ${socket.user?.name} (${userId}) JOINED matchmaking room: ${roomCode}`
          );
        } catch (error) {
          logger.error('[WebSocket] Error joining matchmaking room:', error);
          socket.emit('error', { message: 'Failed to join matchmaking room' });
        }
      });

      socket.on('leave-matchmaking-room', async (data: { roomCode: string }) => {
        const { roomCode } = data;
        const roomSocketId = `matchmaking-${roomCode}`;
        socket.leave(roomSocketId);

        logger.info(
          `[WebSocket] User ${socket.user?.name} left matchmaking room: ${roomCode}`
        );
      });

      socket.on('room:ready-toggle', async (data: { roomCode: string; sessionId: string }) => {
        const { roomCode, sessionId } = data;
        const userId = socket.userId!;

        try {
          const room = await MatchmakingRoom.findOne({ roomCode: roomCode.toUpperCase() });
          if (!room) {
            socket.emit('error', { message: 'Room not found' });
            return;
          }

          const team = room.teams.find(t => t.sessionId === sessionId);
          if (!team) {
            socket.emit('error', { message: 'Team not found' });
            return;
          }

          const isLeader = team.players.some(p => p.userId === userId && p.isLeader);
          if (!isLeader) {
            socket.emit('error', { message: 'Only team leader can toggle ready' });
            return;
          }

          team.isReady = !team.isReady;
          await room.save();

          this.emitToMatchmakingRoom(roomCode, 'room:seating:update', {
            roomCode: room.roomCode,
            teams: room.teams.map(t => ({
              citySlot: t.citySlot,
              players: t.players.map(p => ({
                userId: p.userId,
                name: p.name,
                role: p.role,
                isLeader: p.isLeader,
              })),
              isReady: t.isReady,
            })),
          });

          const allReady = room.teams.every(t => t.isReady === true);
          const hasMinimumTeams = room.teams.length >= 2;

          if (allReady && hasMinimumTeams) {
            this.emitToMatchmakingRoom(roomCode, 'room:all-ready', {
              roomCode: room.roomCode,
              message: 'All teams are ready!',
            });
          }

          logger.info(
            `[WebSocket] Team ${sessionId} in room ${roomCode} ready status: ${team.isReady}`
          );
        } catch (error) {
          logger.error('[WebSocket] Error toggling ready status:', error);
          socket.emit('error', { message: 'Failed to toggle ready status' });
        }
      });

            socket.on('leave-game', (data: { sessionId: string }) => {
        const { sessionId } = data;

        socket.leave(sessionId);
        this.revokeSessionAuthorization(socket, sessionId);

        const roomSockets = this.gameRooms.get(sessionId);

        if (roomSockets) {
          roomSockets.delete(socket.id);
          if (roomSockets.size === 0) {
            this.gameRooms.delete(sessionId);
          }
        }

        logger.warn(`User ${socket.user?.name} left game room: ${sessionId}`);
      });

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

          // ✅ Find team
          const team = gameState.teams?.find(t => t.sessionId === sessionId);
          if (!team) {
            socket.emit('error', { message: 'Team not found' });
            return;
          }

          const minutesElapsed = team.minutesElapsed || 0;

          if (minutesElapsed < 15) {
            socket.emit('surrender-error', {
              message: 'Surrender is only available after 15 minutes of play',
            });
            return;
          }

          if (!team.surrenderVotes) {
            team.surrenderVotes = [];
          }

          const surrenderVotes = team.surrenderVotes;
          const voteIndex = surrenderVotes.indexOf(playerId);
          if (voteIndex === -1) {
            surrenderVotes.push(playerId);
            logger.info(`[Surrender] ${socket.user?.name} voted to surrender in session ${sessionId}`);
          } else {
            surrenderVotes.splice(voteIndex, 1);
            logger.info(`[Surrender] ${socket.user?.name} withdrew surrender vote in session ${sessionId}`);
          }

          const totalVotes = surrenderVotes.length;

          // ✅ Check if all 3 players voted
          if (totalVotes >= 3) {
            team.gameStatus = 'eliminated';
            team.isEliminated = true;
            // ✅ Use a valid reason type
            team.eliminationReason = 'budget'; // Use existing type instead of 'surrender'
            if (team.activityLog) {
              team.activityLog.unshift('[SURRENDER] All players have surrendered. The team has been eliminated.');
            }

            await GameService.updateTeamData(sessionId, team);
            await GameService.updateGameState(sessionId, gameState);

            // Broadcast to all teams in the room
            for (const t of gameState.teams) {
              this.emitToGameRoom(t.sessionId, 'game-state-full', {
                gameState,
                actionType: 'surrender',
                surrenderVotes,
                totalVotes,
                teamId: team.teamId,
              });
            }
          } else {
            await GameService.updateTeamData(sessionId, team);

            // Broadcast updated vote count to all players in the team's session
            this.emitToGameRoom(sessionId, 'surrender-update', {
              surrenderVotes,
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
          const normalizedSessionId = String(sessionId || '').trim();
          const normalizedMessage = String(message || '').trim();

          if (!normalizedSessionId || !normalizedMessage) {
            socket.emit('error', { message: 'Invalid team chat payload' });
            return;
          }

          if (normalizedMessage.length > this.teamChatMaxMessageChars) {
            socket.emit('error', {
              message: `Team chat message is too long (max ${this.teamChatMaxMessageChars} characters)`,
            });
            return;
          }

          const rateLimit = this.consumeSocketRateLimit(
            socket.id,
            `team-chat-message:${normalizedSessionId}`,
            this.teamChatRateMaxMessages,
            this.teamChatRateWindowMs
          );

          if (!rateLimit.allowed) {
            if (rateLimit.shouldWarn) {
              logger.warn(
                `[WebSocket] Team chat rate limit exceeded: socket=${socket.id}, userId=${socket.userId}, sessionId=${normalizedSessionId}`
              );
            }

            socket.emit('error', {
              message: `Too many team chat messages. Please wait ${Math.max(
                1,
                Math.ceil(rateLimit.retryAfterMs / 1000)
              )}s and try again.`,
            });
            return;
          }

          const hasAccess = await this.isSessionAuthorizedOrValidate(
            socket,
            normalizedSessionId
          );
          if (!hasAccess) {
            socket.emit('error', { message: 'You do not have access to this game session' });
            return;
          }

          this.io.to(normalizedSessionId).emit('team-chat-message', {
            senderId: socket.userId,
            senderName: socket.user?.name || 'Unknown',
            senderRole: socket.user?.role || 'player',
            message: normalizedMessage,
            sessionId: normalizedSessionId,
            timestamp: Date.now(),
          });
        } catch (err) {
          logger.error('[WebSocket] Error handling team-chat-message:', err);
          socket.emit('error', { message: 'Failed to send team chat message' });
        }
      });


      socket.on('disconnect', () => {
        logger.warn(
          `Client disconnected: ${socket.id} (User: ${socket.user?.name})`
        );

        socket.authorizedSessionIds?.clear();
        this.clearSocketRateLimitState(socket.id);

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
        logger.debug(
      `[WebSocket] Broadcasting '${event}' to room '${sessionId}' (${roomSize} connected clients)`
    );


    this.io.to(sessionId).emit(event, {
      ...data,
      sessionId,
      timestamp: Date.now(),
    });
  }

  /**
   * Send specific event to all players in a matchmaking room
   */
  static emitToMatchmakingRoom(roomCode: string, event: string, data: any) {
    const roomSocketId = `matchmaking-${roomCode}`;
    logger.info(
      `[WebSocket] Broadcasting '${event}' to matchmaking room '${roomCode}'`
    );

    this.io.to(roomSocketId).emit(event, {
      ...data,
      roomCode,
      timestamp: Date.now(),
    });
  }

  /**
   * Broadcast to ALL connected clients
   */
  static broadcastToAll(event: string, data: any) {
    logger.info(
      `[WebSocket] Broadcasting '${event}' to ALL connected clients`
    );

    this.io.emit(event, {
      ...data,
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
   * Broadcast system messages
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
   */
  static broadcastGameStateUpdate(
    sessionId: string,
    gameState: GameState,
    actionType: string,
    actionDetails?: any
  ) {
    const payload = {
      gameState,
      actionType,
      actionDetails,
    };

    // Rich action event used by role pages (backward compatible)
    this.emitToGameRoom(sessionId, 'game-state-updated', payload);

    // Canonical state event used by layout/footer for immediate HUD refresh.
    // Coalesced to reduce emit pressure during action bursts.
    this.queueCoalescedGameStateUpdate(sessionId, payload);

    if (gameState?.roomCode) {
      this.emitAdminTelemetryUpdate(gameState.roomCode, {
        actionType,
        source: 'game-state-update',
        sessionId,
      });
    }

        logger.debug(
      `Broadcasted game state update for session ${sessionId} - Action: ${actionType}`
    );

  }

  static emitAdminTelemetryUpdate(

    roomCode: string,
        payload: {
      actionType?: string;
      source?: string;
      sessionId?: string | null;
      [key: string]: any;
    } = {}
  ) {
    if (!this.io) return;

    const normalizedRoomCode = String(roomCode || '').trim().toUpperCase();
    if (!normalizedRoomCode) return;

    const monitorRoom = this.getAdminMonitorRoomName(normalizedRoomCode);
    this.io.to(monitorRoom).emit('admin:room-telemetry-updated', {
      roomCode: normalizedRoomCode,
      actionType: payload.actionType || null,
      source: payload.source || 'unknown',
      sessionId: payload.sessionId || null,
      ...payload,
      timestamp: Date.now(),
    });
  }

  /**
   * Broadcast full game state payload
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
