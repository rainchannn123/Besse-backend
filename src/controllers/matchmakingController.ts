import { Request, Response } from 'express';
import { AdminAuthRequest } from '../middleware/adminAuth';
import { MatchmakingService } from '../services/matchmakingService';
import { GameService } from '../services/gameService';
import { asyncHandler } from '../utils/asyncHandler';
import { sendResponse } from '../utils/response';
import { ValidationError, NotFoundError, ForbiddenError, UnauthorizedError } from '../utils/AppError';
import MatchmakingRoom from '../models/MatchmakingRoom';
import User from '../models/User';
import { WebSocketService } from '../services/websocketService';

export const getRooms = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const rooms = await MatchmakingService.getRooms();
    sendResponse(res, 200, 'Rooms retrieved successfully', { rooms });
  }
);

export const getRoom = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { roomCode } = req.params;
    const room = await MatchmakingService.getRoom(roomCode);
    sendResponse(res, 200, 'Room retrieved successfully', { room });
  }
);

export const createRoom = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const userId = (req as any).user._id;
    const { sessionId, teamName, isPrivate, password, isAdminRoom } = req.body;

    if (!sessionId) {
      throw new ValidationError('Session ID is required');
    }

    if (isPrivate && (req as any).user.accountType !== 'admin') {
      throw new ValidationError('Only admins can create private rooms');
    }

    const room = await MatchmakingService.createRoom(
      sessionId,
      teamName || 'Team',
      isPrivate || false,
      password,
      isAdminRoom || false
    );

    sendResponse(res, 201, 'Room created successfully', {
      roomCode: room.roomCode,
      room: MatchmakingService.sanitizeRoom(room),
    });
  }
);

// ✅ Admin creates a room with detailed error logging
export const adminCreateRoom = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    console.log('🔐 [adminCreateRoom] ========== START ==========');
    console.log('📋 Request body:', JSON.stringify(req.body, null, 2));
    
    const adminInfo = (req as AdminAuthRequest).admin;
    
    if (!adminInfo) {
      console.error('❌ No admin info found in request');
      throw new UnauthorizedError('Admin authentication required');
    }
    
    console.log('👤 Admin username:', adminInfo.username);
    
    const { isPrivate, isAdminRoom } = req.body;

    try {
      // Find the admin user by username
      console.log('🔍 Looking up admin user...');
      const user = await User.findOne({ name: adminInfo.username, accountType: 'admin' });
      
      if (!user) {
        console.error('❌ Admin user not found:', adminInfo.username);
        throw new NotFoundError('Admin user not found');
      }
      
      console.log('👤 User found:', {
        id: user._id,
        name: user.name,
        accountType: user.accountType
      });
      
      if (user.accountType !== 'admin') {
        console.error('❌ User is not admin:', user.accountType);
        throw new ForbiddenError('Only admin can create rooms');
      }

      console.log('✅ User verified as admin');

      // Generate room code
      console.log('🔑 Generating room code...');
      let roomCode: string;
      try {
        roomCode = await MatchmakingService.generateRoomCode();
        console.log('✅ Generated room code:', roomCode);
      } catch (genError) {
        console.error('❌ Failed to generate room code:', genError);
        throw new Error('Failed to generate unique room code');
      }

      // Create room with admin as owner
      console.log('📝 Creating room in database...');
      const roomData = {
        roomCode,
        roomName: `Admin Room ${roomCode}`,
        ownerId: user._id,
        ownerName: user.name || 'Admin',
        isPrivate: isPrivate || false,
        isAdminRoom: true,
        maxTeams: 30,
        teams: [],
        status: 'waiting',
      };
      console.log('📝 Room data:', JSON.stringify(roomData, null, 2));

      let room;
      try {
        room = await MatchmakingRoom.create(roomData);
        console.log('✅ Room created:', room.roomCode);
      } catch (dbError) {
        console.error('❌ Database error creating room:', dbError);
        throw new Error('Failed to create room in database');
      }

      // Broadcast room created event
      try {
        console.log('📡 Broadcasting room:created event...');
        const sanitizedRoom = MatchmakingService.sanitizeRoom(room);
        console.log('📡 Sanitized room:', JSON.stringify(sanitizedRoom, null, 2));
        WebSocketService.broadcastToAll('room:created', {
          roomCode: room.roomCode,
          room: sanitizedRoom,
        });
        console.log('✅ Broadcasted room:created event');
      } catch (wsError) {
        console.error('⚠️ WebSocket broadcast failed (non-critical):', wsError);
        // Don't fail the request if WebSocket fails
      }

      console.log('✅ [adminCreateRoom] ========== SUCCESS ==========');
      sendResponse(res, 201, 'Room created successfully', {
        roomCode: room.roomCode,
        room: MatchmakingService.sanitizeRoom(room),
      });
    } catch (error: any) {
      console.error('❌ [adminCreateRoom] ERROR:', error.message);
      console.error('❌ Stack:', error.stack);
      console.error('❌ [adminCreateRoom] ========== FAILED ==========');
      throw error;
    }
  }
);

export const joinRoom = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { roomCode, sessionId, password } = req.body;

    if (!roomCode || !sessionId) {
      throw new ValidationError('Room code and session ID are required');
    }

    const room = await MatchmakingService.joinRoom(roomCode, sessionId, password);

    sendResponse(res, 200, 'Joined room successfully', {
      room: MatchmakingService.sanitizeRoom(room),
    });
  }
);

export const leaveRoom = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { roomCode, sessionId } = req.body;

    if (!roomCode || !sessionId) {
      throw new ValidationError('Room code and session ID are required');
    }

    const result = await MatchmakingService.leaveRoom(roomCode, sessionId);

    sendResponse(res, 200, 'Left room successfully', result);
  }
);

// ✅ FIXED: Start game using req.admin instead of req.user
export const startGame = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { roomCode } = req.body;
    
    console.log('🎮 [startGame] ========== START ==========');
    console.log('📋 Room code:', roomCode);
    
    // ✅ Use req.admin instead of req.user
    const adminInfo = (req as AdminAuthRequest).admin;
    
    if (!adminInfo) {
      console.error('❌ No admin info found in request');
      throw new UnauthorizedError('Admin authentication required');
    }

    if (!roomCode) {
      throw new ValidationError('Room code is required');
    }

    console.log('👤 Admin username:', adminInfo.username);

    // Find the admin user by username
    const user = await User.findOne({ name: adminInfo.username, accountType: 'admin' });
    if (!user) {
      console.error('❌ Admin user not found:', adminInfo.username);
      throw new NotFoundError('Admin user not found');
    }

    console.log('✅ Admin user found:', user._id);

    const result = await MatchmakingService.startGame(roomCode, user._id.toString());

    console.log('✅ [startGame] ========== SUCCESS ==========');
    sendResponse(res, 200, 'Game started successfully', result);
  }
);

export const getRoomRankings = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { roomCode } = req.params;

    const room = await MatchmakingRoom.findOne({ roomCode: roomCode.toUpperCase() });
    if (!room) {
      throw new NotFoundError('Room not found');
    }

    const rankings = [];
    for (const team of room.teams) {
      const gameState = await GameService.getGameState(team.sessionId);
      if (gameState) {
        const totalScore = gameState.cityProjects
          ?.filter((p: any) => p.completed)
          ?.reduce((sum: number, p: any) => sum + (p.score || 0), 0) || 0;

        rankings.push({
          teamId: team.teamId,
          citySlot: team.citySlot,
          teamName: team.players.find((p: any) => p.isLeader)?.name || `Team ${team.citySlot}`,
          totalScore,
          gameStatus: gameState.gameStatus,
        });
      }
    }

    rankings.sort((a, b) => b.totalScore - a.totalScore);

    sendResponse(res, 200, 'Room rankings retrieved', { rankings });
  }
);

export const adminGetAllRooms = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const requestedStatus = String(req.query.status || '').trim();
    const allowedStatuses = new Set(['waiting', 'ready', 'started', 'completed']);

    const statuses = requestedStatus
      ? requestedStatus
          .split(',')
          .map((value) => value.trim().toLowerCase())
          .filter((value) => allowedStatuses.has(value))
      : [];

    const filter = statuses.length > 0 ? { status: { $in: statuses } } : {};

    const rooms = await MatchmakingRoom.find(filter).sort({ createdAt: -1 });

    const sanitizedRooms = rooms.map(room => MatchmakingService.sanitizeRoom(room));

    sendResponse(res, 200, 'All rooms retrieved successfully', { rooms: sanitizedRooms });
  }
);