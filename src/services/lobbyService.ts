import mongoose from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import GameSession from '../models/GameSession';
import Lobby, { GameMode, ILobby } from '../models/Lobby';
import PairScore from '../models/PairScore';
import User from '../models/User';
import { LobbyState } from '../types';
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../utils/AppError';
import { generateUniqueLobbyCode, isValidLobbyCode } from '../utils/lobbyCode';
import { WebSocketService } from './websocketService';

type LeaveLobbyResult = {
  sessionId: string;
  leftUserId: string;
  leftUserName: string;
  leader: string | null;
  status: LobbyState['status'] | 'closed';
  currentSessionCleared: boolean;
  lobbyDeleted: boolean;
  playersRemaining: number;
  alreadyLeft: boolean;
  lobbyState: LobbyState | null;
};

export class LobbyService {
  private static async broadcastLobbyState(
    sessionId: string,
    reason?: string
  ): Promise<LobbyState> {
    const lobbyState = await LobbyService.getLobbyState(sessionId);

    WebSocketService.emitToGameRoom(sessionId, 'lobby-state-update', {
      lobbyState,
      reason,
    });

    return lobbyState;
  }

  private static calculateLobbyStatus(lobby: ILobby): ILobby['status'] {
    const allRolesSelected = lobby.players.every(p => p.selectedRole !== null);
    const uniqueRoles = new Set(
      lobby.players
        .map(p => p.selectedRole)
        .filter((role): role is NonNullable<typeof role> => role !== null)
    );

    if (
      lobby.players.length === lobby.maxPlayers &&
      allRolesSelected &&
      uniqueRoles.size === lobby.maxPlayers
    ) {
      return 'ready';
    }

    return 'waiting';
  }

  private static emitLobbyLeftEvents(
    sessionId: string,
    leftUserId: string,
    leftUserName: string,
    lobbyState: LobbyState | null,
    lobbyClosed: boolean
  ) {
    WebSocketService.emitToGameRoom(sessionId, 'player-left', {
      userId: leftUserId,
      leftUserId,
      playerId: leftUserId,
      playerName: leftUserName,
      lobbyClosed,
      playersRemaining: lobbyState?.players.length ?? 0,
      leader: lobbyState?.leader ?? null,
      status: lobbyState?.status ?? 'closed',
      lobbyState,
    });

    WebSocketService.emitToGameRoom(sessionId, 'lobby-state-update', {
      lobbyState,
      lobbyClosed,
    });
  }

  static async createLobby(userId: string, userName: string, gameMode: GameMode = 'waste'): Promise<ILobby> {
    const userObjectId = new mongoose.Types.ObjectId(userId);

    await User.findByIdAndUpdate(userId, { currentSession: null });

    const newSessionId = uuidv4();
    const newLobbyCode = await generateUniqueLobbyCode();

    const lobby = await Lobby.create({
      sessionId: newSessionId,
      lobbyCode: newLobbyCode,
      leader: userObjectId,
      gameMode,
      stage: 'waiting-room',
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

    const existingUser = await User.findById(userId);
    if (existingUser?.currentSession) {
      const existingLobby = await Lobby.findOne({ sessionId: existingUser.currentSession });
      if (existingLobby) {
        return existingLobby;
      } else {
        await User.findByIdAndUpdate(userId, { currentSession: null });
      }
    }

    let lobby: ILobby | null = null;

    if (lobbyCode && isValidLobbyCode(lobbyCode)) {
      lobby = await Lobby.findOne({ lobbyCode, status: 'waiting' });
      if (!lobby) {
        throw new NotFoundError('Lobby not found or not accepting players');
      }
    } else {
      lobby = await Lobby.findOne({
        status: 'waiting',
        $expr: { $lt: [{ $size: '$players' }, '$maxPlayers'] },
      }).sort({ createdAt: -1 });

      if (!lobby) {
        const newSessionId = uuidv4();
        const newLobbyCode = await generateUniqueLobbyCode();
        lobby = await Lobby.create({
          sessionId: newSessionId,
          lobbyCode: newLobbyCode,
          leader: userObjectId,
          gameMode: 'waste',
          stage: 'waiting-room',
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

    const existingPlayer = lobby.players.find(
      p => p.userId.toString() === userId
    );
    if (existingPlayer) {
      return lobby;
    }

    if (lobby.players.length >= lobby.maxPlayers) {
      throw new ValidationError('Lobby is full');
    }

    lobby.players.push({
      userId: userObjectId,
      name: userName,
      selectedRole: null,
      joinedAt: new Date(),
    });
    lobby.stage = 'waiting-room';
    await User.findByIdAndUpdate(userId, { currentSession: lobby.sessionId });
    await lobby.save();

    await this.broadcastLobbyState(lobby.sessionId, 'player-joined');

    // ✅ FIX: Update matchmaking room if team already has a room
    try {
      const MatchmakingRoom = require('../models/MatchmakingRoom').default;
      const matchmakingRoom = await MatchmakingRoom.findOne({
        'teams.sessionId': lobby.sessionId,
        status: { $in: ['waiting', 'ready'] },
      });

      if (matchmakingRoom) {
        console.log(`[LobbyService] Updating matchmaking room for team: ${lobby.sessionId}`);
        
        const teamIndex = matchmakingRoom.teams.findIndex(
          (t: any) => t.sessionId === lobby.sessionId
        );
        
        if (teamIndex !== -1) {
          const { MatchmakingService } = require('./matchmakingService');
          
                    const playersWithRoles = lobby.players.map((p: any) => ({
            userId: p.userId.toString(),
            name: p.name,
            role: p.selectedRole,
            isLeader: p.userId.toString() === lobby.leader.toString(),
          }));

          
          console.log(`[LobbyService] Players in lobby:`, playersWithRoles);
          
          const sortedPlayers = MatchmakingService.sortPlayersByRole(playersWithRoles);
          
          console.log(`[LobbyService] Sorted players:`, sortedPlayers);
          
                    matchmakingRoom.teams[teamIndex].players = sortedPlayers.map((p: any) => ({
            userId: p.userId === 'empty' ? 'empty' : p.userId,
            name: p.name || 'Empty Seat',
            role: p.role ?? null,
            isLeader: !!p.isLeader,
          }));

          await matchmakingRoom.save();
          
          // Broadcast seating update to all team members
          for (const member of lobby.players) {
            WebSocketService.emitToGameRoom(member.userId.toString(), 'room:seating:update', {
              roomCode: matchmakingRoom.roomCode,
              teams: matchmakingRoom.teams,
            });
          }
        }
      }
    } catch (error) {
      console.error('[LobbyService] Error updating matchmaking room:', error);
    }

    return lobby;
  }

  static async continueToRoleSelection(
    sessionId: string,
    userId: string
  ): Promise<LobbyState> {
    const userObjectId = new mongoose.Types.ObjectId(userId);
    const lobby = await Lobby.findOne({ sessionId });

    if (!lobby) {
      throw new NotFoundError('Lobby not found');
    }

    const player = lobby.players.find(p => p.userId.equals(userObjectId));
    if (!player) {
      throw new ForbiddenError('You are not part of this lobby');
    }

    if (!lobby.leader.equals(userObjectId)) {
      throw new ForbiddenError('Only the group leader can continue');
    }

    if (lobby.stage === 'role-selection') {
      return LobbyService.getLobbyState(sessionId);
    }

    if (lobby.stage !== 'waiting-room') {
      throw new ValidationError('Lobby is not in the waiting-room stage');
    }

    if (lobby.players.length !== lobby.maxPlayers) {
      throw new ValidationError('Lobby must have exactly 3 joined players before continuing');
    }

    lobby.stage = 'role-selection';
    lobby.status = this.calculateLobbyStatus(lobby);
    await lobby.save();

    return this.broadcastLobbyState(sessionId, 'role-selection-entered');
  }

  static async continueToPairing(
    sessionId: string,
    userId: string
  ): Promise<LobbyState> {
    const userObjectId = new mongoose.Types.ObjectId(userId);
    const lobby = await Lobby.findOne({ sessionId });

    if (!lobby) {
      throw new NotFoundError('Lobby not found');
    }

    const player = lobby.players.find(p => p.userId.equals(userObjectId));
    if (!player) {
      throw new ForbiddenError('You are not part of this lobby');
    }

    if (!lobby.leader.equals(userObjectId)) {
      throw new ForbiddenError('Only the group leader can continue');
    }

    if (lobby.stage === 'pairing') {
      return LobbyService.getLobbyState(sessionId);
    }

    if (lobby.stage !== 'role-selection') {
      throw new ValidationError('Lobby is not in the role-selection stage');
    }

    if (lobby.status !== 'ready') {
      throw new ValidationError('Lobby must be ready before continuing to pairing');
    }

    lobby.stage = 'pairing';
    await lobby.save();

    return this.broadcastLobbyState(sessionId, 'pairing-entered');
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
    if (!player) throw new ValidationError('You are not in this lobby');

    const roleTaken = lobby.players.some(
      p => p.selectedRole === role && !p.userId.equals(userObjectId)
    );
    if (roleTaken)
      throw new ValidationError('This role is already taken by another player');

    player.selectedRole = role;
    const allRolesSelected = lobby.players.every(p => p.selectedRole !== null);
    const uniqueRoles = new Set(lobby.players.map(p => p.selectedRole));
    if (allRolesSelected && uniqueRoles.size === 3) lobby.status = 'ready';

    await lobby.save();

    await this.broadcastLobbyState(
      sessionId,
      lobby.status === 'ready' ? 'roles-ready' : 'role-selected'
    );

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
    if (!player) throw new ValidationError('You are not in this lobby');

    player.selectedRole = null;
    lobby.status = 'waiting';
    await lobby.save();

    await this.broadcastLobbyState(sessionId, 'role-deselected');

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
      gameMode: (lobby as any).gameMode || 'waste',
      stage: lobby.stage,
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

  static async leaveLobby(
    sessionId: string,
    userId: string
  ): Promise<LeaveLobbyResult> {
    const userObjectId = new mongoose.Types.ObjectId(userId);
    const user = await User.findById(userId).select('name currentSession');
    if (!user) throw new NotFoundError('User not found');

    const lobby = await Lobby.findOne({ sessionId });
    const currentSessionCleared = user.currentSession === sessionId;

    if (currentSessionCleared || !lobby) {
      await User.findByIdAndUpdate(userId, { currentSession: null });
    }

    if (!lobby) {
      return {
        sessionId,
        leftUserId: userId,
        leftUserName: user.name,
        leader: null,
        status: 'closed',
        currentSessionCleared: true,
        lobbyDeleted: true,
        playersRemaining: 0,
        alreadyLeft: true,
        lobbyState: null,
      };
    }

        if (lobby.status === 'active') {
          const currentGame = await GameSession.findOne({ sessionId }).select('gameState.gameStatus gameState.teams');
          const gameStatus = currentGame?.gameState?.gameStatus;
          const teamStatus = currentGame?.gameState?.teams?.find((t: any) => t.sessionId === sessionId)?.gameStatus;

          // Allow leaving when THIS team's run is done, even if the overall room/game is still active.
          const teamStillActive = !teamStatus || teamStatus === 'active';
          const roomStillActive = !gameStatus || gameStatus === 'active';

          if (roomStillActive && teamStillActive) {
            throw new ValidationError('Cannot leave a lobby while the game is active');
          }
        }

    const playerToRemove = lobby.players.find(p => p.userId.equals(userObjectId));

    if (!playerToRemove) {
      return {
        sessionId,
        leftUserId: userId,
        leftUserName: user.name,
        leader: lobby.leader.toString(),
        status: lobby.status,
        currentSessionCleared: true,
        lobbyDeleted: false,
        playersRemaining: lobby.players.length,
        alreadyLeft: true,
        lobbyState: await LobbyService.getLobbyState(sessionId),
      };
    }

    await this.removeFromPairingQueue(sessionId);

    const leftUserName = playerToRemove.name;
    const leaderLeft = lobby.leader.equals(userObjectId);

    lobby.players = lobby.players.filter(p => !p.userId.equals(userObjectId));

    await User.findByIdAndUpdate(userId, { currentSession: null });

    if (lobby.players.length === 0) {
      await Lobby.findByIdAndDelete(lobby._id);
      this.emitLobbyLeftEvents(sessionId, userId, leftUserName, null, true);

      return {
        sessionId,
        leftUserId: userId,
        leftUserName,
        leader: null,
        status: 'closed',
        currentSessionCleared: true,
        lobbyDeleted: true,
        playersRemaining: 0,
        alreadyLeft: false,
        lobbyState: null,
      };
    }

    if (leaderLeft) {
      lobby.leader = lobby.players[0].userId;
    }

    if (lobby.players.length < lobby.maxPlayers && lobby.stage !== 'in-game') {
      lobby.stage = 'waiting-room';
    }

    lobby.status = this.calculateLobbyStatus(lobby);
    await lobby.save();

    const lobbyState = await LobbyService.getLobbyState(sessionId);
    this.emitLobbyLeftEvents(sessionId, userId, leftUserName, lobbyState, false);

    return {
      sessionId,
      leftUserId: userId,
      leftUserName,
      leader: lobbyState.leader,
      status: lobbyState.status,
      currentSessionCleared: true,
      lobbyDeleted: false,
      playersRemaining: lobbyState.players.length,
      alreadyLeft: false,
      lobbyState,
    };
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
    lobby.stage = 'in-game';
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

    if (lobby.stage !== 'pairing') {
      lobby.stage = 'pairing';
      await lobby.save();
      await this.broadcastLobbyState(sessionId, 'pairing-entered');
    }

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

    WebSocketService.emitToGameRoom(sessionId, 'pairing-joined', {
      position: queuePosition,
      estimatedWaitTime: queuePosition === 1 ? 30 : 60,
    });

    if (this.unpairedTeamsQueue.length >= 2) {
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

      if (gameACreated && gameBCreated) {
        console.log(`[Pairing] ✅ Pair fully initialized: ${pairId}`);
      } else {
        console.error(
          `[Pairing] ⚠️ Pairing failed. Team A created: ${gameACreated}, Team B created: ${gameBCreated}`
        );

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

        continue;
      }

      if (gameACreated && gameBCreated) {
        await PairScore.create({
          pairId,
          averagePairHealth: 0,
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
        });

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

    if (wasInQueue) {
      const lobby = await Lobby.findOne({ sessionId });
      if (lobby && lobby.stage === 'pairing' && lobby.status !== 'active') {
        lobby.stage = 'role-selection';
        await lobby.save();
        await this.broadcastLobbyState(sessionId, 'pairing-left');
      }
    }

    if (wasInQueue) {
      WebSocketService.emitToGameRoom(sessionId, 'pairing-left', {});
    }
  }

  static async startNewGame(
    sessionId: string,
    userId: string
  ): Promise<ILobby> {
    if (!sessionId || !userId) {
      throw new Error('sessionId and userId are required');
    }

    const [lobby, currentGame] = await Promise.all([
      Lobby.findOne({ sessionId }),
      GameSession.findOne({ sessionId }),
    ]);

    if (!lobby) {
      throw new Error('Lobby not found');
    }

    if (currentGame?.gameState?.gameStatus === 'active') {
      throw new Error(
        'Current game is still in progress. Cannot start a new game.'
      );
    }

    const isLobbyPlayer = lobby.players.some(
      p => p.userId.toString() === userId.toString()
    );
    if (!isLobbyPlayer) {
      throw new Error('Only players in this team can start a new game');
    }

    if (!lobby.players || lobby.players.length === 0) {
      throw new Error('Lobby has no players');
    }

    const newSessionId = uuidv4();
    const newLobbyCode = await generateUniqueLobbyCode();

    const playerIds = lobby.players.map(p => p.userId);

    if (playerIds.length > 0) {
      await User.updateMany(
        { _id: { $in: playerIds } },
        { currentSession: newSessionId }
      );
    }

    const existingPlayers = lobby.players.map(p => p);
    const newLobby = await Lobby.create({
      sessionId: newSessionId,
      lobbyCode: newLobbyCode,
      leader: lobby.leader,
      gameMode: (lobby as any).gameMode || 'waste',
      stage: 'waiting-room',
      players: [...existingPlayers],
      status: 'ready',
      maxPlayers: 3,
    });

    try {
      await GameSession.updateOne(
        { sessionId },
        { $set: { archived: true, archivedAt: new Date() } }
      );
      return newLobby;
    } catch (error) {
      console.error('Failed to save lobby reset:', error);
      throw new Error('Failed to start new game. Please try again.');
    }
  }
}