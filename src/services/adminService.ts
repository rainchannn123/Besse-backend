import mongoose from 'mongoose';
import { env } from '../config/env';
import { WebSocketService } from './websocketService';
import GameSession from '../models/GameSession';
import Lobby from '../models/Lobby';
import User from '../models/User';
import { ValidationError } from '../utils/AppError';

import { generateAdminToken } from '../utils/jwt';

import { AdminMonitorTelemetryService } from './adminMonitorTelemetryService';

export type MonitorPlayerStatus =
  | 'offline'
  | 'waiting-room'
  | 'role-selection'
  | 'pairing'
  | 'in-game'
  | 'completed'
  | 'session-unknown';

interface MonitorUserRecord {
  _id: string;
  name: string;
  email: string;
  role: string;
  accountType: string;
  currentSession: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const derivePlayerStatus = (
  user: MonitorUserRecord,
  lobbyBySession: Map<string, any>,
  gameBySession: Map<string, any>
): MonitorPlayerStatus => {
  const sessionId = user.currentSession;
  if (!sessionId) {
    return 'offline';
  }

  const lobby = lobbyBySession.get(sessionId);
  const game = gameBySession.get(sessionId);

  if (game?.gameState?.gameStatus === 'active') {
    return 'in-game';
  }

  if (lobby?.stage === 'waiting-room') {
    return 'waiting-room';
  }

  if (lobby?.stage === 'role-selection') {
    return 'role-selection';
  }

  if (lobby?.stage === 'pairing') {
    return 'pairing';
  }

  if (lobby?.stage === 'in-game' || lobby?.status === 'active') {
    return 'in-game';
  }

  if (
    lobby?.stage === 'completed' ||
    lobby?.status === 'completed' ||
    game?.gameState?.gameStatus === 'won' ||
    game?.gameState?.gameStatus === 'lost' ||
    game?.gameState?.gameStatus === 'complete'
  ) {
    return 'completed';
  }

  return 'session-unknown';
};

const getRoleFromLobby = (lobby: any, userId: string) => {
  const found = lobby?.players?.find((p: any) => String(p.userId) === userId);
  return found?.selectedRole || null;
};

export const adminLogin = async (username: string, password: string) => {
  if (!env.ADMIN_MONITOR_ENABLED) {
    throw new ValidationError('Admin monitor is disabled');
  }

  if (!env.ADMIN_MONITOR_USERNAME || !env.ADMIN_MONITOR_PASSWORD) {
    throw new ValidationError(
      'Admin monitor credentials are not configured on server'
    );
  }

  if (
    username !== env.ADMIN_MONITOR_USERNAME ||
    password !== env.ADMIN_MONITOR_PASSWORD
  ) {
    throw new ValidationError('Invalid admin credentials');
  }

  const token = generateAdminToken(username);

  return {
    token,
    username,
  };
};

export const getAdminMonitoringOverview = async () => {
  const [users, lobbies, gameSessions] = await Promise.all([
    User.find({}, 'name email role accountType currentSession createdAt updatedAt')
      .sort({ createdAt: -1 })
      .lean<MonitorUserRecord[]>(),
    Lobby.find({})
      .select(
        'sessionId lobbyCode leader gameMode stage status pairId partnerSessionId teamRole pairStatus players createdAt updatedAt'
      )
      .lean<any[]>(),
    GameSession.find({})
      .select('sessionId gameState players playerNames createdAt updatedAt')
      .lean<any[]>(),
  ]);

  const lobbyBySession = new Map(lobbies.map(lobby => [lobby.sessionId, lobby]));
  const gameBySession = new Map(
    gameSessions.map(gameSession => [gameSession.sessionId, gameSession])
  );

  const usersById = new Map(users.map(user => [String(user._id), user]));

  const playerStatuses = users.map(user => {
    const userId = String(user._id);
    const sessionId = user.currentSession;
    const lobby = sessionId ? lobbyBySession.get(sessionId) : null;
    const game = sessionId ? gameBySession.get(sessionId) : null;

    const selectedRole = lobby ? getRoleFromLobby(lobby, userId) : null;

    const teammateNames = (lobby?.players || [])
      .filter((p: any) => String(p.userId) !== userId)
      .map((p: any) => p.name);

    const competitorNames = (() => {
      if (!lobby?.partnerSessionId) return [];
      const partnerLobby = lobbyBySession.get(lobby.partnerSessionId);
      if (!partnerLobby?.players) return [];
      return partnerLobby.players.map((p: any) => p.name);
    })();

    return {
      userId,
      name: user.name,
      email: user.email,
      accountRole: user.role,
      accountType: (user as any).accountType || 'student',
      currentSession: sessionId,
      status: derivePlayerStatus(user, lobbyBySession, gameBySession),
      hasActiveSocketConnections: sessionId
        ? WebSocketService.hasActiveConnections(sessionId)
        : false,
      roleInSession: selectedRole,
      gameMode: lobby?.gameMode || null,
      teamRole: lobby?.teamRole || null,
      isLobbyLeader: Boolean(
        lobby?.leader && String(lobby.leader) === userId
      ),
      pairId: lobby?.pairId || game?.gameState?.pairId || null,
      partnerSessionId:
        lobby?.partnerSessionId || game?.gameState?.partnerSessionId || null,
      teammateNames,
      competitorNames,
      gameStatus: game?.gameState?.gameStatus || null,
      gameDay: game?.gameState?.currentGameDay || null,
      gameMinutesElapsed: game?.gameState?.minutesElapsed || null,
      cityHealth: game?.gameState?.cityHealth || null,
      budget: game?.gameState?.budget || null,
      totalCO2: game?.gameState?.totalCO2 || null,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  });

  const pairGroupsMap = new Map<string, any>();

  for (const lobby of lobbies) {
    if (!lobby.pairId) continue;

    const existing = pairGroupsMap.get(lobby.pairId) || {
      pairId: lobby.pairId,
      pairStatus: lobby.pairStatus || null,
      teams: [],
    };

    existing.teams.push({
      sessionId: lobby.sessionId,
      lobbyCode: lobby.lobbyCode,
      gameMode: lobby.gameMode || 'waste',
      teamRole: lobby.teamRole,
      stage: lobby.stage,
      status: lobby.status,
      leaderId: String(lobby.leader),
      leaderName: usersById.get(String(lobby.leader))?.name || 'Unknown',
      playerCount: Array.isArray(lobby.players) ? lobby.players.length : 0,
      players: (lobby.players || []).map((player: any) => ({
        userId: String(player.userId),
        name: player.name,
        selectedRole: player.selectedRole,
      })),
    });

    pairGroupsMap.set(lobby.pairId, existing);
  }

  const summary = {
    totalUsers: users.length,
    inGame: playerStatuses.filter(player => player.status === 'in-game').length,
    waitingRoom: playerStatuses.filter(player => player.status === 'waiting-room')
      .length,
    roleSelection: playerStatuses.filter(
      player => player.status === 'role-selection'
    ).length,
    pairing: playerStatuses.filter(player => player.status === 'pairing').length,
    offline: playerStatuses.filter(player => player.status === 'offline').length,
    activeLobbies: lobbies.filter(lobby => lobby.status !== 'completed').length,
    activePairs: [...pairGroupsMap.values()].filter(
      pair => pair.pairStatus === 'active'
    ).length,
  };

  return {
    summary,
    players: playerStatuses,
    matchGroups: [...pairGroupsMap.values()],
    generatedAt: new Date().toISOString(),
  };
};

export const forceExitPlayer = async (userId: string, reason?: string) => {
  if (!mongoose.Types.ObjectId.isValid(userId)) {
    throw new ValidationError('Invalid user id');
  }

  const user = await User.findById(userId);
  if (!user) {
    throw new ValidationError('User not found');
  }

  const previousSession = user.currentSession;

  // ✅ ALWAYS clear the session first
  user.currentSession = null;

  // Try to clean up lobby if it exists
  if (previousSession) {
    const lobby = await Lobby.findOne({ sessionId: previousSession });

    if (lobby) {
      // Remove player from lobby
      lobby.players = lobby.players.filter(
        player => String(player.userId) !== String(user._id)
      );

      // If leader left, assign new leader
      if (String(lobby.leader) === String(user._id) && lobby.players.length > 0) {
        lobby.leader = lobby.players[0].userId;
      }

      // Delete lobby if empty
      if (lobby.players.length === 0) {
        await Lobby.deleteOne({ _id: lobby._id });
      } else {
        await lobby.save();
      }

      // Broadcast system message
      WebSocketService.broadcastSystemMessage(
        previousSession,
        `${user.name} was removed from the game by admin${
          reason ? `: ${reason}` : ''
        }`,
        'warning'
      );
    }

    // ✅ Also clean up any GameSession if exists
    const gameSession = await GameSession.findOne({ sessionId: previousSession });
    if (gameSession) {
      // Check if user is in this game and remove them if needed
      const isInGame = 
        String(gameSession.players.municipality) === String(user._id) ||
        String(gameSession.players.mrf) === String(user._id) ||
        String(gameSession.players.broker) === String(user._id);
      
      if (isInGame) {
        // You might want to handle game state cleanup here
        // For now, just log it
        console.log(`User ${user.name} was in game session ${previousSession}`);
      }
    }
  }

  // ✅ Save user with cleared session
  user.role = null;
  await user.save();

  return {
    userId: String(user._id),
    name: user.name,
    previousSession,
    currentSession: user.currentSession,
  };
};

export const getRoomLiveOverview = async (
  roomCode: string,
    options: {
    flowLimit?: number;
    flowFrom?: Date;
    flowTo?: Date;
    includeFlowEvents?: boolean;
  } = {}

) => {
  if (!roomCode || !roomCode.trim()) {
    throw new ValidationError('Room code is required');
  }

  return AdminMonitorTelemetryService.getRoomLiveOverview(roomCode, options);
};



export const getPlayerGameHistory = async (
  userId: string,
  limit: number,

  skip: number
) => {
  if (!mongoose.Types.ObjectId.isValid(userId)) {
    throw new ValidationError('Invalid user id');
  }

  const objectId = new mongoose.Types.ObjectId(userId);

  const orFilter = [
    { 'players.municipality': objectId },
    { 'players.mrf': objectId },
    { 'players.broker': objectId },
  ];

  const [records, total] = await Promise.all([
    GameSession.find({ $or: orFilter })
      .select('sessionId players playerNames gameState createdAt updatedAt')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean<any[]>(),
    GameSession.countDocuments({ $or: orFilter }),
  ]);

  const partnerSessionIds = records
    .map(s => s.gameState?.partnerSessionId)
    .filter(Boolean) as string[];

  const partnerSessions =
    partnerSessionIds.length > 0
      ? await GameSession.find({ sessionId: { $in: partnerSessionIds } })
          .select('sessionId playerNames')
          .lean<any[]>()
      : [];

  const partnerBySessionId = new Map(
    partnerSessions.map(ps => [ps.sessionId, ps])
  );

  const history = records.map(session => {
    let roleInGame: 'municipality' | 'mrf' | 'broker' | null = null;
    if (String(session.players.municipality) === userId) roleInGame = 'municipality';
    else if (String(session.players.mrf) === userId) roleInGame = 'mrf';
    else if (String(session.players.broker) === userId) roleInGame = 'broker';

    const partnerSessionId = session.gameState?.partnerSessionId || null;
    const partnerSession = partnerSessionId ? partnerBySessionId.get(partnerSessionId) : null;
    const competitorNames: string[] = partnerSession?.playerNames
      ? [
          partnerSession.playerNames.municipality,
          partnerSession.playerNames.mrf,
          partnerSession.playerNames.broker,
        ].filter(Boolean)
      : [];

    return {
      sessionId: session.sessionId,
      roleInGame,
      playerNames: session.playerNames,
      competitorNames,
      gameStatus: session.gameState?.gameStatus || null,
      cityHealth: session.gameState?.cityHealth ?? null,
      budget: session.gameState?.budget ?? null,
      totalCO2: session.gameState?.totalCO2 ?? null,
      currentGameDay: session.gameState?.currentGameDay ?? null,
      minutesElapsed: session.gameState?.minutesElapsed ?? null,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    };
  });

  return { userId, total, limit, skip, history };
};