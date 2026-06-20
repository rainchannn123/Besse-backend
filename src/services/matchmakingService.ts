import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import MatchmakingRoom, { IMatchmakingRoom } from '../models/MatchmakingRoom';
import Lobby from '../models/Lobby';
import User from '../models/User';
import GameSession from '../models/GameSession';
import { ValidationError, NotFoundError, ForbiddenError } from '../utils/AppError';
import { generateUniqueLobbyCode } from '../utils/lobbyCode';
import { WebSocketService } from './websocketService';
import { GameService } from './gameService';

export class MatchmakingService {
  private static readonly MAX_TEAMS = 30;
  private static readonly ROOM_CODE_LENGTH = 6;

  // ✅ Helper: Sort players by role in the correct seat order
  // Seat order: Municipality (0), MRF (1), Broker (2)
  public static sortPlayersByRole(players: any[]): any[] {
    const roleOrder: Record<string, number> = {
      'municipality': 0,
      'mrf': 1,
      'broker': 2,
    };

    const sortedPlayers = players
      .filter(p => p.role !== null)
      .sort((a, b) => (roleOrder[a.role] || 99) - (roleOrder[b.role] || 99));

    const result: any[] = [];
    const roles = ['municipality', 'mrf', 'broker'];
    let sortedIndex = 0;

    for (const role of roles) {
      if (sortedIndex < sortedPlayers.length && sortedPlayers[sortedIndex].role === role) {
        result.push(sortedPlayers[sortedIndex]);
        sortedIndex++;
      } else {
        result.push({
          userId: 'empty',
          name: 'Empty Seat',
          role: null,
          isLeader: false,
        });
      }
    }

    return result;
  }

  static async generateRoomCode(): Promise<string> {
    let code: string;
    let attempts = 0;
    const maxAttempts = 100;

    do {
      code = this.generateRandomCode();
      attempts++;
      if (attempts >= maxAttempts) {
        throw new Error('Unable to generate unique room code after maximum attempts');
      }
    } while (await MatchmakingRoom.findOne({ roomCode: code }));

    return code;
  }

  private static generateRandomCode(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < 6; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  static async getTeamDataFromLobby(sessionId: string): Promise<{
    teamName: string;
    players: { userId: string; name: string; role: string | null }[];
  }> {
    const lobby = await Lobby.findOne({ sessionId });
    if (!lobby) {
      throw new NotFoundError('Lobby not found');
    }

    return {
      teamName: lobby.leader.toString(),
      players: lobby.players.map((p: any) => ({
        userId: p.userId.toString(),
        name: p.name,
        role: p.selectedRole,
      })),
    };
  }

  // ✅ NEW: Get all team members for a session
  static async getTeamMembers(sessionId: string): Promise<{ userId: string; name: string; sessionId: string }[]> {
    const lobby = await Lobby.findOne({ sessionId });
    if (!lobby) {
      return [];
    }

    return lobby.players.map((p: any) => ({
      userId: p.userId.toString(),
      name: p.name,
      sessionId: lobby.sessionId,
    }));
  }

  static async createRoom(
    sessionId: string,
    teamName: string,
    isPrivate: boolean = false,
    password?: string,
    isAdminRoom: boolean = false
  ): Promise<IMatchmakingRoom> {
    // Check if team already has an active room
    const existingRoom = await MatchmakingRoom.findOne({
      'teams.sessionId': sessionId,
      status: { $in: ['waiting', 'ready'] },
    });

    if (existingRoom) {
      throw new ValidationError('Your team already has an active game room');
    }

    // Get team data from lobby
    const teamData = await this.getTeamDataFromLobby(sessionId);

    // Get user info for owner
    const user = await User.findOne({ currentSession: sessionId });
    if (!user) {
      throw new NotFoundError('User not found');
    }

    // Generate room code
    const roomCode = await this.generateRoomCode();

    // Hash password if private
    let passwordHash: string | undefined;
    if (isPrivate && password) {
      if (password.length < 6) {
        throw new ValidationError('Password must be at least 6 characters');
      }
      passwordHash = await bcrypt.hash(password, 10);
    }

    // ✅ Sort players by role for correct seat assignment
    const sortedPlayers = this.sortPlayersByRole(teamData.players);

    // Create room
    const room = await MatchmakingRoom.create({
      roomCode,
      roomName: `${teamName}'s Room`,
      ownerId: user._id,
      ownerName: user.name,
      isPrivate,
      passwordHash,
      isAdminRoom,
      maxTeams: this.MAX_TEAMS,
      teams: [
        {
          teamId: uuidv4(),
          sessionId,
          citySlot: 1,
          players: sortedPlayers.map((p: any) => ({
            userId: p.userId === 'empty' ? 'empty' : p.userId,
            name: p.name || 'Empty Seat',
            role: p.role,
            isLeader: p.userId === user._id.toString(),
          })),
          isReady: false,
        },
      ],
      status: 'waiting',
    });

    // ✅ Broadcast room created event to ALL team members
    const teamMembers = await this.getTeamMembers(sessionId);
    for (const member of teamMembers) {
      WebSocketService.emitToGameRoom(member.sessionId, 'room:created', {
        roomCode: room.roomCode,
        room: this.sanitizeRoom(room),
        teamMember: true,
      });
    }

    WebSocketService.broadcastToAll('room:created', {
      roomCode: room.roomCode,
      room: this.sanitizeRoom(room),
    });

    return room;
  }

  // ✅ UPDATED: Join room - adds ALL team members
  static async joinRoom(
    roomCode: string,
    sessionId: string,
    password?: string
  ): Promise<IMatchmakingRoom> {
    // Check if team already has an active room
    const existingRoom = await MatchmakingRoom.findOne({
      'teams.sessionId': sessionId,
      status: { $in: ['waiting', 'ready'] },
    });

    if (existingRoom) {
      if (existingRoom.roomCode === roomCode) {
        return existingRoom;
      }
      throw new ValidationError('Your team already has an active game room');
    }

    // Find the room
    const room = await MatchmakingRoom.findOne({
      roomCode: roomCode.toUpperCase(),
      status: { $in: ['waiting', 'ready'] },
    });

    if (!room) {
      throw new NotFoundError('Room not found or already started');
    }

    // Check if room is full
    if (room.teams.length >= room.maxTeams) {
      throw new ValidationError('Room is full');
    }

    // Check password for private rooms
    if (room.isPrivate) {
      if (!password) {
        throw new ValidationError('Password required for private room');
      }
      if (!room.passwordHash) {
        throw new ValidationError('Room password not set');
      }
      const isValid = await bcrypt.compare(password, room.passwordHash);
      if (!isValid) {
        throw new ValidationError('Invalid password');
      }
    }

    // Get team data
    const teamData = await this.getTeamDataFromLobby(sessionId);
    const user = await User.findOne({ currentSession: sessionId});
    if (!user) {
      throw new NotFoundError('User not found');
    }

    // Find next available city slot
    const occupiedSlots = room.teams.map((t: any) => t.citySlot);
    let citySlot = 1;
    for (let i = 1; i <= this.MAX_TEAMS; i++) {
      if (!occupiedSlots.includes(i)) {
        citySlot = i;
        break;
      }
    }

    // ✅ Sort players by role for correct seat assignment
    const sortedPlayers = this.sortPlayersByRole(teamData.players);

    // ✅ Add team to room
    room.teams.push({
      teamId: uuidv4(),
      sessionId,
      citySlot,
      players: sortedPlayers.map((p: any) => ({
        userId: p.userId === 'empty' ? 'empty' : p.userId,
        name: p.name || 'Empty Seat',
        role: p.role,
        isLeader: p.userId === user._id.toString(),
      })),
      isReady: false,
    });

    await room.save();

    // ✅ Broadcast to ALL team members that they joined
    const teamMembers = await this.getTeamMembers(sessionId);
    for (const member of teamMembers) {
      WebSocketService.emitToGameRoom(member.sessionId, 'room:joined', {
        roomCode: room.roomCode,
        room: this.sanitizeRoom(room),
        teamMember: true,
        redirect: `/dashboard/game-room/${room.roomCode}`,
      });
    }

    // Broadcast room update to all
    WebSocketService.broadcastToAll('room:updated', {
      roomCode: room.roomCode,
      room: this.sanitizeRoom(room),
    });

    // Broadcast seating update to all members in the room
    this.broadcastToRoom(room.roomCode, 'room:seating:update', {
      roomCode: room.roomCode,
      teams: room.teams.map((t: any) => ({
        citySlot: t.citySlot,
        players: t.players.map((p: any) => ({
          userId: p.userId,
          name: p.name,
          role: p.role,
          isLeader: p.isLeader,
        })),
      })),
    });

    return room;
  }

  static async leaveRoom(
    roomCode: string,
    sessionId: string
  ): Promise<{ deleted: boolean; roomCode: string }> {
    const room = await MatchmakingRoom.findOne({
      roomCode: roomCode.toUpperCase(),
      status: { $in: ['waiting', 'ready'] },
    });

    if (!room) {
      throw new NotFoundError('Room not found');
    }

    // Find team in room
    const teamIndex = room.teams.findIndex((t: any) => t.sessionId === sessionId);
    if (teamIndex === -1) {
      throw new ValidationError('Team not found in this room');
    }

    // Remove team
    room.teams.splice(teamIndex, 1);

    // If room is empty, delete it
    if (room.teams.length === 0) {
      await MatchmakingRoom.deleteOne({ _id: room._id });
      WebSocketService.broadcastToAll('room:deleted', {
        roomCode: room.roomCode,
      });
      return { deleted: true, roomCode: room.roomCode };
    }

    await room.save();

    // Broadcast room update
    WebSocketService.broadcastToAll('room:updated', {
      roomCode: room.roomCode,
      room: this.sanitizeRoom(room),
    });

    return { deleted: false, roomCode: room.roomCode };
  }

  static async getRooms(): Promise<any[]> {
    const rooms = await MatchmakingRoom.find({
      status: { $in: ['waiting', 'ready'] },
    }).sort({ createdAt: -1 });

    return rooms.map((room) => this.sanitizeRoom(room));
  }

  static async getRoom(roomCode: string): Promise<any> {
    const room = await MatchmakingRoom.findOne({
      roomCode: roomCode.toUpperCase(),
    });

    if (!room) {
      throw new NotFoundError('Room not found');
    }

    return this.sanitizeRoom(room);
  }

  static async startGame(
    roomCode: string,
    userId: string
  ): Promise<{ gameSessionId: string; teams: any[] }> {
    const room = await MatchmakingRoom.findOne({
      roomCode: roomCode.toUpperCase(),
      status: { $in: ['waiting', 'ready'] },
    });

    if (!room) {
      throw new NotFoundError('Room not found');
    }

    // ✅ Check if user is admin
    const user = await User.findById(userId);
    const isAdmin = user?.accountType === 'admin';

    if (!isAdmin) {
      throw new ForbiddenError('Only admin can start the game');
    }

    // Check if at least 2 teams
    if (room.teams.length < 2) {
      throw new ValidationError('Need at least 2 teams to start the game');
    }

    // Update room status
    room.status = 'started';
    await room.save();

    // Create game sessions for each team
    const gameSessions: any[] = [];

    for (const team of room.teams) {
      try {
        const gameState = await GameService.createGameFromLobby(team.sessionId);
        
        const gameSession = await GameSession.findOne({ sessionId: team.sessionId });
        if (gameSession) {
          gameSession.gameState.roomCode = room.roomCode;
          gameSession.gameState.roomTeams = room.teams.map((t: any) => ({
            teamId: t.teamId,
            citySlot: t.citySlot,
            sessionId: t.sessionId,
          }));
          await gameSession.save();
        }

        gameSessions.push({
          sessionId: team.sessionId,
          teamId: team.teamId,
          citySlot: team.citySlot,
          gameState,
        });
      } catch (error) {
        console.error(`Failed to create game for team ${team.sessionId}:`, error);
        throw new Error(`Failed to create game for team ${team.teamId}`);
      }
    }

    room.gameSessionId = gameSessions[0]?.gameState?.sessionId || '';
    await room.save();

    // Broadcast game started to all teams
    this.broadcastToRoom(room.roomCode, 'room:started', {
      roomCode: room.roomCode,
      gameSessions: gameSessions.map((gs: any) => ({
        sessionId: gs.sessionId,
        teamId: gs.teamId,
        citySlot: gs.citySlot,
      })),
    });

    for (const gs of gameSessions) {
      WebSocketService.emitToGameRoom(gs.sessionId, 'game-started', {
        sessionId: gs.sessionId,
        gameSessionId: room.gameSessionId,
        teamRole: `City ${gs.citySlot}`,
        gameState: gs.gameState,
      });
    }

    return {
      gameSessionId: room.gameSessionId || '',
      teams: gameSessions,
    };
  }

  static sanitizeRoom(room: IMatchmakingRoom): any {
    const roomObj = room.toObject();
    return {
      roomCode: roomObj.roomCode,
      roomName: roomObj.roomName,
      ownerId: roomObj.ownerId.toString(),
      ownerName: roomObj.ownerName,
      isPrivate: roomObj.isPrivate,
      isAdminRoom: roomObj.isAdminRoom,
      maxTeams: roomObj.maxTeams,
      teams: roomObj.teams.map((t: any) => ({
        teamId: t.teamId,
        citySlot: t.citySlot,
        players: t.players.map((p: any) => ({
          userId: p.userId,
          name: p.name,
          role: p.role,
          isLeader: p.isLeader,
        })),
        isReady: t.isReady,
      })),
      status: roomObj.status,
      gameSessionId: roomObj.gameSessionId,
      createdAt: roomObj.createdAt,
    };
  }

  static broadcastToRoom(roomCode: string, event: string, data: any) {
    MatchmakingRoom.findOne({ roomCode }).then((room) => {
      if (room) {
        for (const team of room.teams) {
          WebSocketService.emitToGameRoom(team.sessionId, event, data);
        }
      }
    }).catch((err) => {
      console.error('Failed to broadcast to room:', err);
    });
  }
}