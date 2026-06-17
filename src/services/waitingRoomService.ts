import WaitingRoom, { IWaitingRoom } from '../models/WaitingRoom';
import Lobby from '../models/Lobby';
import { generateUniqueLobbyCode } from '../utils/lobbyCode';
import { ValidationError, NotFoundError } from '../utils/AppError';

export class WaitingRoomService {
  // Generate a unique 6-character room code
  static async generateUniqueRoomCode(): Promise<string> {
    let code: string;
    let attempts = 0;
    const maxAttempts = 100;

    do {
      code = this.generateRandomCode();
      attempts++;
      if (attempts >= maxAttempts) {
        throw new Error('Unable to generate unique room code');
      }
    } while (await WaitingRoom.findOne({ roomCode: code }));

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

  // Get team data from lobby
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
      players: lobby.players.map(p => ({
        userId: p.userId.toString(),
        name: p.name,
        role: p.selectedRole,
      })),
    };
  }

  // Create a new waiting room (Team A)
  static async createWaitingRoom(
    sessionId: string,
    teamName: string
  ): Promise<IWaitingRoom> {
    // Check if team already has an active waiting room
    const existingRoom = await WaitingRoom.findOne({
      'teams.sessionId': sessionId,
      status: { $in: ['waiting', 'ready'] },
    });

    if (existingRoom) {
      throw new ValidationError('Your team already has an active waiting room');
    }

    const roomCode = await this.generateUniqueRoomCode();
    const teamData = await this.getTeamDataFromLobby(sessionId);

    const waitingRoom = await WaitingRoom.create({
      roomCode,
      teams: [
        {
          sessionId,
          teamRole: 'Team A',
          isReady: false,
          teamName: teamName || teamData.teamName,
          players: teamData.players,
        },
      ],
      status: 'waiting',
    });

    return waitingRoom;
  }

  // ✅ UPDATED: Join an existing waiting room as Team B with auto-redirect
  static async joinWaitingRoom(
    roomCode: string,
    sessionId: string,
    teamName: string
  ): Promise<IWaitingRoom> {
    // ✅ FIRST: Check if this team already has an active waiting room
    const existingRoom = await WaitingRoom.findOne({
      'teams.sessionId': sessionId,
      status: { $in: ['waiting', 'ready'] },
    });

    // ✅ If the team already has a room, return it (auto-redirect)
    if (existingRoom) {
      return existingRoom;
    }

    // ✅ If no existing room, try to join the requested room
    const waitingRoom = await WaitingRoom.findOne({
      roomCode: roomCode.toUpperCase(),
      status: 'waiting',
    });

    if (!waitingRoom) {
      throw new NotFoundError('Waiting room not found or already full');
    }

    if (waitingRoom.teams.length >= 2) {
      throw new ValidationError('This waiting room already has 2 teams');
    }

    // Check if this team is already in any waiting room (double-check)
    const existingRoomCheck = await WaitingRoom.findOne({
      'teams.sessionId': sessionId,
      status: { $in: ['waiting', 'ready'] },
    });

    if (existingRoomCheck) {
      return existingRoomCheck;
    }

    const teamData = await this.getTeamDataFromLobby(sessionId);

    waitingRoom.teams.push({
      sessionId,
      teamRole: 'Team B',
      isReady: false,
      teamName: teamName || teamData.teamName,
      players: teamData.players,
    });

    await waitingRoom.save();
    return waitingRoom;
  }

  // Toggle team ready status (only team leader can do this)
  static async toggleReady(
    roomCode: string,
    sessionId: string,
    isReady: boolean
  ): Promise<IWaitingRoom> {
    const waitingRoom = await WaitingRoom.findOne({
      roomCode: roomCode.toUpperCase(),
      status: { $in: ['waiting', 'ready'] },
    });

    if (!waitingRoom) {
      throw new NotFoundError('Waiting room not found');
    }

    const team = waitingRoom.teams.find(t => t.sessionId === sessionId);
    if (!team) {
      throw new ValidationError('Team not found in this waiting room');
    }

    team.isReady = isReady;

    // Check if both teams are ready
    const allReady = waitingRoom.teams.length === 2 && 
                     waitingRoom.teams.every(t => t.isReady === true);

    if (allReady) {
      waitingRoom.status = 'ready';
    } else {
      waitingRoom.status = 'waiting';
    }

    await waitingRoom.save();
    return waitingRoom;
  }

  // Leave waiting room
  static async leaveWaitingRoom(
    roomCode: string,
    sessionId: string
  ): Promise<{ deleted: boolean; roomCode: string }> {
    const waitingRoom = await WaitingRoom.findOne({
      roomCode: roomCode.toUpperCase(),
    });

    if (!waitingRoom) {
      throw new NotFoundError('Waiting room not found');
    }

    // Remove the team
    waitingRoom.teams = waitingRoom.teams.filter(t => t.sessionId !== sessionId);

    if (waitingRoom.teams.length === 0) {
      // Delete the room if no teams left
      await WaitingRoom.deleteOne({ _id: waitingRoom._id });
      return { deleted: true, roomCode: waitingRoom.roomCode };
    } else {
      // Reset ready status for remaining team
      waitingRoom.teams[0].isReady = false;
      waitingRoom.status = 'waiting';
      await waitingRoom.save();
      return { deleted: false, roomCode: waitingRoom.roomCode };
    }
  }

  // Get all available waiting rooms (not full, not in progress)
  static async getAvailableRooms(): Promise<IWaitingRoom[]> {
    return await WaitingRoom.find({
      status: 'waiting',
      'teams.1': { $exists: false },
    }).sort({ createdAt: -1 });
  }

  // Get waiting room by code
  static async getWaitingRoom(roomCode: string): Promise<IWaitingRoom | null> {
    return await WaitingRoom.findOne({
      roomCode: roomCode.toUpperCase(),
    });
  }

  // Start game from waiting room
  static async startGame(roomCode: string): Promise<{ 
    gameSessionId: string; 
    teamASessionId: string; 
    teamBSessionId: string;
    teamAGameState: any;
    teamBGameState: any;
  }> {
    const waitingRoom = await WaitingRoom.findOne({
      roomCode: roomCode.toUpperCase(),
      status: 'ready',
    });

    if (!waitingRoom) {
      throw new ValidationError('Waiting room not ready for game');
    }

    if (waitingRoom.teams.length !== 2) {
      throw new ValidationError('Need 2 teams to start game');
    }

    const teamASession = waitingRoom.teams[0].sessionId;
    const teamBSession = waitingRoom.teams[1].sessionId;

    // Update waiting room status
    waitingRoom.status = 'in-progress';
    await waitingRoom.save();

    // Import GameService dynamically to avoid circular dependency
    const { GameService } = await import('./gameService');
    
    // Create games for both teams
    let teamAGameState = null;
    let teamBGameState = null;
    let error = null;

    try {
      teamAGameState = await GameService.createGameFromLobby(teamASession);
      console.log(`[WaitingRoom] Game created for Team A: ${teamASession}`);
    } catch (err: any) {
      error = err;
      console.error(`[WaitingRoom] Failed to create game for Team A: ${teamASession}`, err);
    }

    try {
      teamBGameState = await GameService.createGameFromLobby(teamBSession);
      console.log(`[WaitingRoom] Game created for Team B: ${teamBSession}`);
    } catch (err: any) {
      error = err;
      console.error(`[WaitingRoom] Failed to create game for Team B: ${teamBSession}`, err);
    }

    if (!teamAGameState || !teamBGameState) {
      // Rollback waiting room status if game creation failed
      waitingRoom.status = 'ready';
      await waitingRoom.save();
      throw new ValidationError(error?.message || 'Failed to create games for both teams');
    }

    // Update waiting room with game session ID
    waitingRoom.gameSessionId = `${teamASession}-${teamBSession}`;
    await waitingRoom.save();

    // EMIT WEB SOCKET EVENTS TO BOTH TEAMS
    try {
      const { WebSocketService } = await import('./websocketService');
      
      // Get player roles for each team to help frontend redirect
      const teamAPlayers = waitingRoom.teams[0].players;
      const teamBPlayers = waitingRoom.teams[1].players;
      
      // Notify Team A
      WebSocketService.emitToGameRoom(teamASession, 'game-started', {
        sessionId: teamASession,
        gameSessionId: waitingRoom.gameSessionId,
        teamRole: 'Team A',
        players: teamAPlayers,
      });
      console.log(`[WaitingRoom] Emitted game-started to Team A: ${teamASession}`);
      
      // Notify Team B
      WebSocketService.emitToGameRoom(teamBSession, 'game-started', {
        sessionId: teamBSession,
        gameSessionId: waitingRoom.gameSessionId,
        teamRole: 'Team B',
        players: teamBPlayers,
      });
      console.log(`[WaitingRoom] Emitted game-started to Team B: ${teamBSession}`);
      
    } catch (wsError) {
      console.error('[WaitingRoom] Failed to emit game-started events:', wsError);
      // Don't throw - game is still created, just WebSocket notification failed
    }

    return {
      gameSessionId: waitingRoom.gameSessionId,
      teamASessionId: teamASession,
      teamBSessionId: teamBSession,
      teamAGameState,
      teamBGameState,
    };
  }
}