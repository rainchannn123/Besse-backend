import mongoose from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import GameSession from '../models/GameSession';
import Lobby, { ILobby } from '../models/Lobby';
import PairScore from '../models/PairScore';
import User from '../models/User';
import { LobbyState } from '../types';
import { NotFoundError } from '../utils/AppError';
import { generateUniqueLobbyCode, isValidLobbyCode } from '../utils/lobbyCode';
import { WebSocketService } from './websocketService';

export class LobbyService {
  static async createLobby(userId: string, userName: string): Promise<ILobby> {
    const userObjectId = new mongoose.Types.ObjectId(userId);

    const newSessionId = uuidv4();
    const newLobbyCode = await generateUniqueLobbyCode();

    const lobby = await Lobby.create({
      sessionId: newSessionId,
      lobbyCode: newLobbyCode,
      leader: userObjectId,
      players: [
        {
          userId: userObjectId,
          name: userName,
          selectedRole: null,
          joinedAt: new Date(),
        },
      ],
      status: 'waiting',
      maxPlayers: 3,
    });

    await User.findByIdAndUpdate(userId, { currentSession: lobby.sessionId });
    return lobby;
  }

  static async joinLobby(
    userId: string,
    userName: string,
    lobbyCode?: string
  ): Promise<ILobby> {
    const userObjectId = new mongoose.Types.ObjectId(userId);

    let lobby: ILobby | null = null;

    if (lobbyCode && isValidLobbyCode(lobbyCode)) {
      // Try to join specific lobby
      lobby = await Lobby.findOne({ lobbyCode, status: 'waiting' });
      if (!lobby) {
        throw new NotFoundError('Lobby not found or not accepting players');
      }
    } else {
      // Random assignment: find an available waiting lobby or create new
      lobby = await Lobby.findOne({
        status: 'waiting',
        $expr: { $lt: [{ $size: '$players' }, '$maxPlayers'] },
      }).sort({ createdAt: -1 }); // Prefer newer lobbies

      if (!lobby) {
        // Create new lobby for random assignment
        const newSessionId = uuidv4();
        const newLobbyCode = await generateUniqueLobbyCode();
        lobby = await Lobby.create({
          sessionId: newSessionId,
          lobbyCode: newLobbyCode,
          leader: userObjectId,
          players: [
            {
              userId: userObjectId,
              name: userName,
              selectedRole: null,
              joinedAt: new Date(),
            },
          ],
          status: 'waiting',
          maxPlayers: 3,
        });
        await User.findByIdAndUpdate(userId, {
          currentSession: lobby.sessionId,
        });
        return lobby;
      }
    }

    // Check if already in this lobby
    const existingPlayer = lobby.players.find(
      p => p.userId.toString() === userId
    );
    if (existingPlayer) throw new Error('You are already in this lobby');

    if (lobby.players.length >= lobby.maxPlayers)
      throw new Error('Lobby is full');

    lobby.players.push({
      userId: userObjectId,
      name: userName,
      selectedRole: null,
      joinedAt: new Date(),
    });
    await User.findByIdAndUpdate(userId, { currentSession: lobby.sessionId });
    await lobby.save();
    return lobby;
  }

  static async selectRole(
    sessionId: string,
    userId: string,
    role: 'municipality' | 'mrf' | 'broker'
  ): Promise<ILobby> {
    const userObjectId = new mongoose.Types.ObjectId(userId);
    const lobby = await Lobby.findOne({
      sessionId,
      status: { $in: ['waiting', 'ready'] },
    });
    if (!lobby)
      throw new NotFoundError('Lobby not found or game already started');

    const player = lobby.players.find(p => p.userId.equals(userObjectId));
    if (!player) throw new Error('You are not in this lobby');

    const roleTaken = lobby.players.some(
      p => p.selectedRole === role && !p.userId.equals(userObjectId)
    );
    if (roleTaken)
      throw new Error('This role is already taken by another player');

    player.selectedRole = role;
    const allRolesSelected = lobby.players.every(p => p.selectedRole !== null);
    const uniqueRoles = new Set(lobby.players.map(p => p.selectedRole));
    if (allRolesSelected && uniqueRoles.size === 3) lobby.status = 'ready';

    await lobby.save();

    // Emit real-time lobby state update when all roles are selected and status becomes ready
    if (lobby.status === 'ready') {
      const lobbyState = await LobbyService.getLobbyState(sessionId);
      WebSocketService.emitToGameRoom(
        sessionId,
        'lobby-state-update',
        lobbyState
      );
    }

    return lobby;
  }

  static async deselectRole(
    sessionId: string,
    userId: string
  ): Promise<ILobby> {
    const userObjectId = new mongoose.Types.ObjectId(userId);
    const lobby = await Lobby.findOne({
      sessionId,
      status: { $in: ['waiting', 'ready'] },
    });
    if (!lobby)
      throw new NotFoundError('Lobby not found or game already started');

    const player = lobby.players.find(p => p.userId.equals(userObjectId));
    if (!player) throw new Error('You are not in this lobby');

    player.selectedRole = null;
    lobby.status = 'waiting';
    await lobby.save();

    // Emit real-time lobby state update when role is deselected and status changes back to waiting
    const lobbyState = await LobbyService.getLobbyState(sessionId);
    WebSocketService.emitToGameRoom(
      sessionId,
      'lobby-state-update',
      lobbyState
    );

    return lobby;
  }

  static async getLobbyState(sessionId: string): Promise<LobbyState> {
    const lobby = await Lobby.findOne({ sessionId }).populate(
      'players.userId',
      'name email'
    );
    if (!lobby) throw new NotFoundError('Lobby not found');

    return {
      sessionId: lobby.sessionId,
      lobbyCode: lobby.lobbyCode,
      leader: lobby.leader.toString(),
      players: lobby.players.map(p => ({
        userId: (p.userId as any)._id
          ? (p.userId as any)._id.toString()
          : p.userId.toString(),
        name: p.name,
        selectedRole: p.selectedRole,
        joinedAt: p.joinedAt,
      })),
      status: lobby.status,
      createdAt: lobby.createdAt,
      maxPlayers: lobby.maxPlayers,
      pairId: (lobby as any).pairId || null,
      partnerSessionId: (lobby as any).partnerSessionId || null,
      teamRole: (lobby as any).teamRole || null,
      pairStatus: (lobby as any).pairStatus || null,
    };
  }

  static async leaveLobby(sessionId: string, userId: string): Promise<void> {
    const userObjectId = new mongoose.Types.ObjectId(userId);
    const lobby = await Lobby.findOne({ sessionId });
    if (!lobby) throw new NotFoundError('Lobby not found');

    lobby.players = lobby.players.filter(p => !p.userId.equals(userObjectId));
    await User.findByIdAndUpdate(userId, { currentSession: null });

    if (lobby.players.length === 0) await Lobby.findByIdAndDelete(lobby._id);
    else {
      const allRolesSelected = lobby.players.every(
        p => p.selectedRole !== null
      );
      const uniqueRoles = new Set(lobby.players.map(p => p.selectedRole));
      if (!allRolesSelected || uniqueRoles.size < 3) lobby.status = 'waiting';
      await lobby.save();
    }
  }

  static async startGame(sessionId: string): Promise<ILobby> {
    const lobby = await Lobby.findOne({ sessionId, status: 'ready' });
    if (!lobby) throw new Error('Lobby not ready to start game');

    const assignedRoles = lobby.players.map(p => p.selectedRole);
    const uniqueRoles = new Set(assignedRoles);
    if (
      assignedRoles.length !== 3 ||
      uniqueRoles.size !== 3 ||
      assignedRoles.includes(null)
    )
      throw new Error(
        'All three unique roles must be assigned before starting the game'
      );

    lobby.status = 'active';
    await lobby.save();
    WebSocketService.emitToGameRoom(sessionId, 'lobby-activated', lobby);
    return lobby;
  }

  static async getAvailableLobbies(): Promise<ILobby[]> {
    return await Lobby.find({
      status: 'waiting',
      $expr: { $lt: [{ $size: '$players' }, '$maxPlayers'] },
    })
      .populate('players.userId', 'name')
      .sort({ createdAt: -1 });
  }

  private static unpairedTeamsQueue: Array<{
    sessionId: string;
    queueTime: number;
  }> = [];

  static async addToPairingQueue(
    sessionId: string
  ): Promise<{ queuePosition: number; message: string }> {
    const lobby = await Lobby.findOne({ sessionId, status: 'ready' });
    if (!lobby) throw new Error('Lobby not ready to join pairing queue');

    const alreadyQueued = this.unpairedTeamsQueue.find(
      t => t.sessionId === sessionId
    );
    if (alreadyQueued)
      return {
        queuePosition: this.unpairedTeamsQueue.indexOf(alreadyQueued) + 1,
        message: 'Team already in pairing queue',
      };

    this.unpairedTeamsQueue.push({ sessionId, queueTime: Date.now() });
    const queuePosition = this.unpairedTeamsQueue.length;

    // Emit WebSocket event for pairing-joined
    WebSocketService.emitToGameRoom(sessionId, 'pairing-joined', {
      position: queuePosition,
      estimatedWaitTime: queuePosition === 1 ? 30 : 60, // Rough estimate
    });

    // Automatically check for pairing if we have 2 or more teams
    if (this.unpairedTeamsQueue.length >= 2) {
      // Run pairing check asynchronously without blocking the response
      this.checkAndCreatePairs().catch(err => {
        console.error('Automatic pairing check failed:', err);
      });
    }

    return {
      queuePosition,
      message:
        queuePosition === 1
          ? 'Waiting for another team...'
          : `You are position ${queuePosition} in the queue`,
    };
  }

  static async checkAndCreatePairs(): Promise<
    Array<{ teamA: string; teamB: string; pairId: string }>
  > {
    const createdPairs: Array<{
      teamA: string;
      teamB: string;
      pairId: string;
    }> = [];
    while (this.unpairedTeamsQueue.length >= 2) {
      const idxA = Math.floor(Math.random() * this.unpairedTeamsQueue.length);
      let idxB = Math.floor(Math.random() * this.unpairedTeamsQueue.length);
      while (idxB === idxA && this.unpairedTeamsQueue.length > 1)
        idxB = Math.floor(Math.random() * this.unpairedTeamsQueue.length);

      const firstIndex = Math.max(idxA, idxB);
      const secondIndex = Math.min(idxA, idxB);
      const teamAEntry = this.unpairedTeamsQueue.splice(firstIndex, 1)[0];
      const teamBEntry = this.unpairedTeamsQueue.splice(secondIndex, 1)[0];

      const pairId = `pair-${uuidv4().slice(0, 8)}`;

      // IMPORTANT: Update lobbies with pair information BEFORE creating games
      // so that GameService.createGameFromLobby() can read these values
      await Lobby.findOneAndUpdate(
        { sessionId: teamAEntry.sessionId },
        {
          pairId,
          partnerSessionId: teamBEntry.sessionId,
          teamRole: 'Team A',
          pairStatus: 'active',
        }
      );
      await Lobby.findOneAndUpdate(
        { sessionId: teamBEntry.sessionId },
        {
          pairId,
          partnerSessionId: teamAEntry.sessionId,
          teamRole: 'Team B',
          pairStatus: 'active',
        }
      );

      console.log(
        `[Pairing] ✅ Lobbies updated with pair info: ${pairId} (Team A: ${teamAEntry.sessionId}, Team B: ${teamBEntry.sessionId})`
      );

      const GameService = require('./gameService').GameService;
      let gameACreated = false;
      let gameBCreated = false;

      // Now create games for both teams - they will have pairing fields populated
      try {
        await GameService.createGameFromLobby(teamAEntry.sessionId);
        gameACreated = true;
        console.log(
          `[Pairing] ✅ Game created for Team A: ${teamAEntry.sessionId}`
        );
      } catch (err) {
        console.error(
          `[Pairing] ❌ Failed to create game for Team A (${teamAEntry.sessionId}):`,
          err
        );
      }

      try {
        await GameService.createGameFromLobby(teamBEntry.sessionId);
        gameBCreated = true;
        console.log(
          `[Pairing] ✅ Game created for Team B: ${teamBEntry.sessionId}`
        );
      } catch (err) {
        console.error(
          `[Pairing] ❌ Failed to create game for Team B (${teamBEntry.sessionId}):`,
          err
        );
      }

      // Check if both games were successfully created
      if (gameACreated && gameBCreated) {
        console.log(`[Pairing] ✅ Pair fully initialized: ${pairId}`);
      } else {
        // Game creation failed for one or both teams
        console.error(
          `[Pairing] ⚠️ Pairing failed. Team A created: ${gameACreated}, Team B created: ${gameBCreated}`
        );

        // Put teams back in queue if games failed
        if (!gameACreated) {
          this.unpairedTeamsQueue.push(teamAEntry);
          console.log(
            `[Pairing] 🔄 Team A (${teamAEntry.sessionId}) returned to queue`
          );
        }
        if (!gameBCreated) {
          this.unpairedTeamsQueue.push(teamBEntry);
          console.log(
            `[Pairing] 🔄 Team B (${teamBEntry.sessionId}) returned to queue`
          );
        }

        // Don't proceed with the rest of the pairing logic
        continue;
      }

      // Only consider pair created if both games were successfully created
      if (gameACreated && gameBCreated) {
        // Save initial pair score to database
        await PairScore.create({
          pairId,
          averagePairHealth: 0, // Initial value, will be updated at game end
          teamASessionId: teamAEntry.sessionId,
          teamBSessionId: teamBEntry.sessionId,
          teamAHealth: null,
          teamBHealth: null,
          teamABudget: 0,
          teamBBudget: 0,
          teamACO2: 0,
          teamBCO2: 0,
          teamAGameStatus: 'active',
          teamBGameStatus: 'active',
          teamAPairStatus: 'active',
          teamBPairStatus: 'active',
          pairStatus: 'active',
          // gameEndTimestamp not set yet
        });

        // Emit WebSocket events for teams-paired
        WebSocketService.emitToGameRoom(teamAEntry.sessionId, 'teams-paired', {
          pairId,
          partnerSessionId: teamBEntry.sessionId,
          teamRole: 'Team A',
        });
        WebSocketService.emitToGameRoom(teamBEntry.sessionId, 'teams-paired', {
          pairId,
          partnerSessionId: teamAEntry.sessionId,
          teamRole: 'Team B',
        });

        createdPairs.push({
          teamA: teamAEntry.sessionId,
          teamB: teamBEntry.sessionId,
          pairId,
        });
      } else {
        // Reset pair fields and status if games couldn't be created
        await Lobby.findOneAndUpdate(
          { sessionId: teamAEntry.sessionId },
          {
            pairId: null,
            partnerSessionId: null,
            teamRole: null,
            pairStatus: null,
            status: 'ready',
          }
        );
        await Lobby.findOneAndUpdate(
          { sessionId: teamBEntry.sessionId },
          {
            pairId: null,
            partnerSessionId: null,
            teamRole: null,
            pairStatus: null,
            status: 'ready',
          }
        );
      }
    }
    return createdPairs;
  }

  static async getQueueStatus(sessionId: string): Promise<{
    queuePosition: number | null;
    totalInQueue: number;
    message: string;
  }> {
    const queueIndex = this.unpairedTeamsQueue.findIndex(
      t => t.sessionId === sessionId
    );
    if (queueIndex === -1)
      return {
        queuePosition: null,
        totalInQueue: this.unpairedTeamsQueue.length,
        message: 'Team not in pairing queue',
      };

    const result = {
      queuePosition: queueIndex + 1,
      totalInQueue: this.unpairedTeamsQueue.length,
      message:
        queueIndex === 0
          ? 'Waiting for another team...'
          : `You are position ${queueIndex + 1} in the queue`,
    };

    // Emit pairing-status-update event
    WebSocketService.emitToGameRoom(sessionId, 'pairing-status-update', {
      status: {
        isInQueue: true,
        position: result.queuePosition,
        estimatedWaitTime: result.queuePosition === 1 ? 30 : 60,
        isPaired: false,
        pairId: null,
        partnerSessionId: null,
        teamRole: null,
      },
    });

    return result;
  }

  static async removeFromPairingQueue(sessionId: string): Promise<void> {
    const wasInQueue = this.unpairedTeamsQueue.some(
      t => t.sessionId === sessionId
    );
    this.unpairedTeamsQueue = this.unpairedTeamsQueue.filter(
      t => t.sessionId !== sessionId
    );

    // Emit WebSocket event for pairing-left if team was actually in queue
    if (wasInQueue) {
      WebSocketService.emitToGameRoom(sessionId, 'pairing-left', {});
    }
  }

  static async startNewGame(
    sessionId: string,
    userId: string
  ): Promise<ILobby> {
    // Validate inputs
    if (!sessionId || !userId) {
      throw new Error('sessionId and userId are required');
    }

    // Fetch lobby and current game session concurrently for better performance
    const [lobby, currentGame] = await Promise.all([
      Lobby.findOne({ sessionId }),
      GameSession.findOne({
        sessionId,
        status: { $in: ['completed', 'lost', 'won'] },
      }),
    ]);

    // Check if lobby exists
    if (!lobby) {
      throw new Error('Lobby not found');
    }

    // Check if there's an active game that hasn't ended
    const activeGame = await GameSession.findOne({
      sessionId,
      gameStatus: { $in: ['completed', 'lost', 'won'] },
    });

    if (activeGame) {
      throw new Error(
        'Current game is still in progress. Cannot start a new game.'
      );
    }

    // Verify user is the lobby leader
    if (lobby.leader.toString() !== userId.toString()) {
      throw new Error('Only the team owner can start a new game');
    }

    // Ensure lobby has players
    if (!lobby.players || lobby.players.length === 0) {
      throw new Error('Lobby has no players');
    }

    const userObjectId = new mongoose.Types.ObjectId(userId);

    // Generate new session and lobby code
    const [newSessionId, newLobbyCode] = await Promise.all([
      uuidv4(),
      generateUniqueLobbyCode(),
    ]);

    // Update all players' currentSession to new sessionId
    const playerIds = lobby.players.map(p => p.userId);

    if (playerIds.length > 0) {
      await User.updateMany(
        { _id: { $in: playerIds } },
        { currentSession: newSessionId }
      );
    }

    // Create a copy of the original lobby state for logging/auditing
    const originalLobby = { ...lobby.toObject() };

    const existingPlayers = lobby.players.map(p => p);

    lobby.players = lobby.players.map(p => p);
    const newLobby = await Lobby.create({
      sessionId: newSessionId,
      lobbyCode: newLobbyCode,
      leader: userObjectId,
      players: [...existingPlayers],
      status: 'ready',
      maxPlayers: 3,
    });

    try {
      // Optional: You might want to archive the old game session
      await GameSession.updateOne(
        { sessionId },
        { $set: { archived: true, archivedAt: new Date() } }
      );

      return newLobby;
    } catch (error) {
      // If save fails, log the error and provide a more helpful message
      console.error('Failed to save lobby reset:', error);
      throw new Error('Failed to start new game. Please try again.');
    }
  }
}
