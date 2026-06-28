import GameSession from '../models/GameSession';
import MatchmakingRoom from '../models/MatchmakingRoom';
import {
  AdminMaterialFlowEvent,
  AdminMonitorRoomSnapshot,
  MaterialAmountMap,
  MaterialType,
  TELEMETRY_MATERIAL_TYPES,
} from '../models/AdminMonitorTelemetry';
import { TeamData } from '../types';
import { ValidationError } from '../utils/AppError';
import { logger } from '../utils/logger';
import { WebSocketService } from './websocketService';

const DEFAULT_SNAPSHOT_INTERVAL_MS = 15_000;

const round2 = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

const emptyMaterialMap = (): MaterialAmountMap => ({
  paper: 0,
  metal: 0,
  plastic: 0,
  wood: 0,
  glass: 0,
});

const sanitizeMaterialType = (value: string): MaterialType | null => {
  return TELEMETRY_MATERIAL_TYPES.includes(value as MaterialType)
    ? (value as MaterialType)
    : null;
};

const addAmount = (
  map: MaterialAmountMap,
  type: MaterialType,
  amount: number
): void => {
  if (!Number.isFinite(amount) || amount <= 0) return;
  map[type] = round2((map[type] || 0) + amount);
};

const mergeMaterialMap = (
  target: MaterialAmountMap,
  source: MaterialAmountMap
): void => {
  for (const type of TELEMETRY_MATERIAL_TYPES) {
    addAmount(target, type, source[type] || 0);
  }
};

const deriveTotalProjectScore = (team: TeamData): number => {
  if (typeof team.totalProjectScore === 'number') return round2(team.totalProjectScore);

  return round2(
    (team.cityProjects || [])
      .filter((project) => project.completed)
      .reduce((sum, project) => sum + Number(project.score ?? project.scoreBonus ?? 0), 0)
  );
};

const deriveCompletedProjects = (team: TeamData): number => {
  return (team.cityProjects || []).filter((project) => project.completed).length;
};

const getMaterialHoldingMaps = (team: TeamData) => {
  const municipalityInventory = emptyMaterialMap();
  const inventoryItems = emptyMaterialMap();
  const listedForAuction = emptyMaterialMap();

  if (team.municipalInventory) {
    for (const type of TELEMETRY_MATERIAL_TYPES) {
      addAmount(municipalityInventory, type, Number(team.municipalInventory[type] || 0));
    }
  }

  for (const item of team.materialInventory || []) {
    const type = sanitizeMaterialType(item.type);
    if (!type) continue;
    addAmount(inventoryItems, type, Number(item.mass || 0));
  }

  for (const auction of team.marketplaceListing || []) {
    const type = sanitizeMaterialType(auction.materialType);
    if (!type) continue;
    addAmount(listedForAuction, type, Number(auction.mass || 0));
  }

  const totalHeld = emptyMaterialMap();
  mergeMaterialMap(totalHeld, municipalityInventory);
  mergeMaterialMap(totalHeld, inventoryItems);
  mergeMaterialMap(totalHeld, listedForAuction);

  return {
    municipalityInventory,
    inventoryItems,
    listedForAuction,
    totalHeld,
  };
};

const getWasteMaps = (team: TeamData) => {
  const totalByType = emptyMaterialMap();
  const byStatus = {
    pending: emptyMaterialMap(),
    delivered: emptyMaterialMap(),
    inTransit: emptyMaterialMap(),
    failed: emptyMaterialMap(),
  };

  for (const batch of team.wasteBatches || []) {
    const composition = batch.composition || {};

    const statusKey =
      batch.status === 'PENDING'
        ? 'pending'
        : batch.status === 'DELIVERED'
          ? 'delivered'
          : batch.status === 'IN_TRANSIT'
            ? 'inTransit'
            : 'failed';

    for (const type of TELEMETRY_MATERIAL_TYPES) {
      const ratio = Number((composition as any)[type] || 0);
      if (!Number.isFinite(ratio) || ratio <= 0) continue;

      const amount = Number(batch.mass || 0) * ratio;
      addAmount(totalByType, type, amount);
      addAmount(byStatus[statusKey], type, amount);
    }
  }

  return { totalByType, byStatus };
};

interface MaterialFlowEventInput {
  roomCode: string;
  teamId: string;
  sessionId: string;
  citySlot: number;
  flowClass: 'material' | 'waste';
  source: string;
  destination: string;
  materialType: MaterialType;
  amount: number;
  eventAt?: Date;
  metadata?: Record<string, any>;
}

interface WasteBatchDestinationInput {
  roomCode: string;
  teamId: string;
  sessionId: string;
  citySlot: number;
  source: string;
  destination: string;
  mass: number;
  composition: Partial<Record<MaterialType, number>>;
  metadata?: Record<string, any>;
}

interface RoomOverviewQuery {
  flowLimit?: number;
  flowFrom?: Date;
  flowTo?: Date;
  includeFlowEvents?: boolean;
}

interface FlowAggregateRow {
  sessionId: string;
  materialType: MaterialType;
  destination: string;
  flowClass: 'material' | 'waste';
  totalAmount: number;
}

const rankTeams = (teams: TeamData[]) => {
  return [...teams]
    .map((team) => ({
      team,
      totalProjectScore: deriveTotalProjectScore(team),
      health: Number(team.cityHealth || 0),
      totalCO2: Number(team.totalCO2 || 0),
      citySlot: Number(team.citySlot || 0),
    }))
    .sort((a, b) => {
      if (b.totalProjectScore !== a.totalProjectScore) {
        return b.totalProjectScore - a.totalProjectScore;
      }

      if (b.health !== a.health) {
        return b.health - a.health;
      }

      if (a.totalCO2 !== b.totalCO2) {
        return a.totalCO2 - b.totalCO2;
      }

      return a.citySlot - b.citySlot;
    })
    .map(({ team, totalProjectScore }) => ({ team, totalProjectScore }));
};

const sumMaterialMap = (map: MaterialAmountMap): number => {
  return round2(
    TELEMETRY_MATERIAL_TYPES.reduce((sum, type) => sum + Number(map[type] || 0), 0)
  );
};

const classifyFlowDirection = (destination: string): 'in' | 'out' | 'internal' => {
  const normalizedDestination = String(destination || '').toLowerCase();

  if (normalizedDestination === 'landfill' || normalizedDestination.startsWith('project:')) {
    return 'out';
  }

  if (
    normalizedDestination.includes('inventory') ||
    normalizedDestination.includes('pending_auction') ||
    normalizedDestination.includes('marketplace')
  ) {
    return 'in';
  }

  return 'internal';
};

const toIsoDate = (value: unknown): string | null => {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return value.toISOString();
  }

  if (typeof value === 'number') {
    const parsed = new Date(value);
    return !isNaN(parsed.getTime()) ? parsed.toISOString() : null;
  }

  return null;
};

const getSessionConnectionFlags = (sessionId: string) => {
  const connectedClients = WebSocketService.getPlayerCount(sessionId);

  return {
    connectedClients,
    hasActiveSocketConnections: connectedClients > 0,
    isDisconnected: connectedClients === 0,
  };
};

const getTeamFlowSummary = (rows: FlowAggregateRow[], sessionId: string) => {
  const flowSummary = {
    inByType: emptyMaterialMap(),
    outByType: emptyMaterialMap(),
    wasteByType: emptyMaterialMap(),
    projectUsedByType: emptyMaterialMap(),
    landfillByType: emptyMaterialMap(),
  };

  for (const row of rows) {
    if (row.sessionId !== sessionId) continue;

    const direction = classifyFlowDirection(row.destination);

    if (direction === 'in') {
      addAmount(flowSummary.inByType, row.materialType, Number(row.totalAmount || 0));
    } else if (direction === 'out') {
      addAmount(flowSummary.outByType, row.materialType, Number(row.totalAmount || 0));
    }

    if (row.flowClass === 'waste') {
      addAmount(flowSummary.wasteByType, row.materialType, Number(row.totalAmount || 0));
    }

    const destination = String(row.destination || '').toLowerCase();
    if (destination === 'landfill') {
      addAmount(flowSummary.landfillByType, row.materialType, Number(row.totalAmount || 0));
    }

    if (destination.startsWith('project:')) {
      addAmount(flowSummary.projectUsedByType, row.materialType, Number(row.totalAmount || 0));
    }
  }

  return flowSummary;
};

const isValidDate = (date?: Date): date is Date => {
  return Boolean(date && !isNaN(date.getTime()));
};

export class AdminMonitorTelemetryService {
  private static telemetryInterval: NodeJS.Timeout | null = null;
  private static telemetryInFlight = false;

  static startScheduledSnapshots(intervalMs = DEFAULT_SNAPSHOT_INTERVAL_MS): void {
    if (this.telemetryInterval) {
      logger.warn('[AdminTelemetry] Snapshot scheduler already running');
      return;
    }

    const sanitizedIntervalMs = Math.max(DEFAULT_SNAPSHOT_INTERVAL_MS, intervalMs);

    this.telemetryInterval = setInterval(async () => {
      await this.captureStartedRoomsSnapshot();
    }, sanitizedIntervalMs);

    logger.info(`[AdminTelemetry] Snapshot scheduler started (interval=${sanitizedIntervalMs}ms)`);
    }

  static stopScheduledSnapshots(): void {
    if (!this.telemetryInterval) return;
    clearInterval(this.telemetryInterval);
    this.telemetryInterval = null;
    logger.info('[AdminTelemetry] Snapshot scheduler stopped');
  }

  static async captureStartedRoomsSnapshot(): Promise<void> {
    if (this.telemetryInFlight) return;
    this.telemetryInFlight = true;

    try {
      const startedRooms = await MatchmakingRoom.find({
        status: 'started',
        teams: { $exists: true, $ne: [] },
      })
        .select('roomCode status teams')
        .lean<any[]>();

      for (const room of startedRooms) {
        try {
          const snapshotResult = await this.captureSingleRoomSnapshot(room);

          if (snapshotResult === 'completed') {
            await MatchmakingRoom.updateOne(
              { _id: room._id, status: 'started' },
              { $set: { status: 'completed' } }
            );
          }
        } catch (error) {
          logger.error(`[AdminTelemetry] Failed snapshot for room ${room.roomCode}`, error);
        }
      }
    } catch (error) {
      logger.error('[AdminTelemetry] Failed scheduled snapshot run', error);
    } finally {
      this.telemetryInFlight = false;
    }
  }

  static async getRoomLiveOverview(roomCode: string, query: RoomOverviewQuery = {}) {
    const normalizedRoomCode = String(roomCode || '').trim().toUpperCase();

    if (!normalizedRoomCode) {
      throw new ValidationError('Room code is required');
    }

    const latestSnapshot = await AdminMonitorRoomSnapshot.findOne({ roomCode: normalizedRoomCode })
      .sort({ snapshotAt: -1 })
      .lean<any>();

    const room = await MatchmakingRoom.findOne({ roomCode: normalizedRoomCode })
      .select('roomCode roomName status isAdminRoom teams createdAt updatedAt')
      .lean<any>();

    if (!room) {
      throw new ValidationError('Room not found');
    }

    const sessionIds = (room.teams || []).map((team: any) => team.sessionId).filter(Boolean);

    if (!sessionIds.length) {
      return {
        roomCode: normalizedRoomCode,
        room: {
          roomCode: normalizedRoomCode,
          roomName: room.roomName,
          status: room.status,
          isAdminRoom: Boolean(room.isAdminRoom),
          startedAt: null,
          elapsedMs: 0,
          elapsedSeconds: 0,
          totalDurationSeconds: 0,
          remainingSeconds: 0,
          isExpired: false,
          createdAt: toIsoDate(room.createdAt),
          updatedAt: toIsoDate(room.updatedAt),
        },
        globalMetrics: {
          totalTeams: 0,
          avgHealth: 0,
          avgCO2: 0,
          avgBudget: 0,
          totalCompletedProjects: 0,
          activeTeams: 0,
          completedTeams: 0,
          eliminatedTeams: 0,
          connectedTeams: 0,
          disconnectedTeams: 0,
        },
        teams: [],
        rankings: [],
        snapshot: latestSnapshot,
        materialFlowEvents: [],
        generatedAt: new Date().toISOString(),
        warnings: ['Room has no teams registered yet'],
        contractVersion: 'admin-room-live-overview/v2',
      };
    }

    const gameSession = await GameSession.findOne({ sessionId: { $in: sessionIds } })
      .select('gameState')
      .lean<any>();

    const gameState = gameSession?.gameState;
    const teams: TeamData[] = Array.isArray(gameState?.teams) ? gameState.teams : [];

    if (!teams.length) {
      return {
        roomCode: normalizedRoomCode,
        room: {
          roomCode: normalizedRoomCode,
          roomName: room.roomName,
          status: room.status,
          isAdminRoom: Boolean(room.isAdminRoom),
          startedAt: null,
          elapsedMs: 0,
          elapsedSeconds: 0,
          totalDurationSeconds: 0,
          remainingSeconds: 0,
          isExpired: false,
          createdAt: toIsoDate(room.createdAt),
          updatedAt: toIsoDate(room.updatedAt),
        },
        globalMetrics: {
          totalTeams: 0,
          avgHealth: 0,
          avgCO2: 0,
          avgBudget: 0,
          totalCompletedProjects: 0,
          activeTeams: 0,
          completedTeams: 0,
          eliminatedTeams: 0,
          connectedTeams: 0,
          disconnectedTeams: 0,
        },
        teams: [],
        rankings: [],
        snapshot: latestSnapshot,
        materialFlowEvents: [],
        generatedAt: new Date().toISOString(),
        warnings: ['No active game state found for this room'],
        contractVersion: 'admin-room-live-overview/v2',
      };
    }

    const startedAt = toIsoDate(Number(gameState?.gameStartTime || 0));
    const elapsedMs = startedAt ? Math.max(0, Date.now() - new Date(startedAt).getTime()) : 0;
    const elapsedSeconds = Math.floor(elapsedMs / 1000);
    const totalDurationSeconds = Math.max(
      0,
      Math.round(Number(gameState?.constants?.TEAM_GAME_DURATION_MINUTES || 15) * 60)
    );
    const remainingSeconds = Math.max(0, totalDurationSeconds - elapsedSeconds);

    const flowFilter: Record<string, any> = { roomCode: normalizedRoomCode };
    const flowFrom = isValidDate(query.flowFrom)
      ? query.flowFrom
      : startedAt
        ? new Date(startedAt)
        : undefined;
    const flowTo = isValidDate(query.flowTo) ? query.flowTo : undefined;

    if (flowFrom || flowTo) {
      flowFilter.eventAt = {};
      if (flowFrom) flowFilter.eventAt.$gte = flowFrom;
      if (flowTo) flowFilter.eventAt.$lte = flowTo;
    }

    const flowLimit = Math.min(Math.max(query.flowLimit || 500, 1), 5000);

    const includeFlowEvents = query.includeFlowEvents !== false;

    const [flowAggregateRows, materialFlowEvents] = await Promise.all([
      AdminMaterialFlowEvent.aggregate<FlowAggregateRow>([
        { $match: flowFilter },
        {
          $group: {
            _id: {
              sessionId: '$sessionId',
              materialType: '$materialType',
              destination: '$destination',
              flowClass: '$flowClass',
            },
            totalAmount: { $sum: '$amount' },
          },
        },
        {
          $project: {
            _id: 0,
            sessionId: '$_id.sessionId',
            materialType: '$_id.materialType',
            destination: '$_id.destination',
            flowClass: '$_id.flowClass',
            totalAmount: 1,
          },
        },
      ]),
      includeFlowEvents
        ? AdminMaterialFlowEvent.find(flowFilter)
            .sort({ eventAt: -1 })
            .limit(flowLimit)
            .lean<any[]>()
        : Promise.resolve([] as any[]),
    ]);

    const rankedTeams = rankTeams(teams);
    const rankByTeamId = new Map<string, number>();
    rankedTeams.forEach((entry, index) => {
      rankByTeamId.set(entry.team.teamId, index + 1);
    });

    const teamsPayload = teams.map((team) => {
      const materials = getMaterialHoldingMaps(team);
      const waste = getWasteMaps(team);
      const flowSummary = getTeamFlowSummary(flowAggregateRows, team.sessionId);
      const connection = getSessionConnectionFlags(team.sessionId);

      const currentInventoryByType = materials.totalHeld;
      const totalIn = sumMaterialMap(flowSummary.inByType);
      const totalOut = sumMaterialMap(flowSummary.outByType);
      const currentInventoryTotal = sumMaterialMap(currentInventoryByType);
      const totalWasteLogged = sumMaterialMap(flowSummary.wasteByType);
      const totalProjectUsed = sumMaterialMap(flowSummary.projectUsedByType);
      const totalLandfill = sumMaterialMap(flowSummary.landfillByType);

      return {
        teamId: team.teamId,
        sessionId: team.sessionId,
        citySlot: team.citySlot,
        teamName: team.teamName,
        players: team.playerNames,
        gameStatus: team.gameStatus,
        isEliminated: Boolean(team.isEliminated),
        eliminationReason: team.eliminationReason || null,
        rank: rankByTeamId.get(team.teamId) || 0,
        metrics: {
          health: round2(Number(team.cityHealth || 0)),
          wallet: round2(Number(team.budget || 0)),
          budget: round2(Number(team.budget || 0)),
          totalCO2: round2(Number(team.totalCO2 || 0)),
          completedProjects: deriveCompletedProjects(team),
          totalProjectScore: deriveTotalProjectScore(team),
          wasteInventory: round2(Number(team.wasteInventory || 0)),
          totalLandfillTons: round2(Number(team.totalLandfillTons || 0)),
          minutesElapsed: round2(Number(team.minutesElapsed || 0)),
        },
        materialFlowSummary: {
          inByType: flowSummary.inByType,
          outByType: flowSummary.outByType,
          currentInventoryByType,
          wasteByType: flowSummary.wasteByType,
          projectUsedByType: flowSummary.projectUsedByType,
          landfillByType: flowSummary.landfillByType,
          totalIn,
          totalOut,
          currentInventoryTotal,
          totalWasteLogged,
          totalProjectUsed,
          totalLandfill,
        },
        materials,
        waste,
        connection,
      };
    });

    const teamCount = teamsPayload.length;
    const totalHealth = teamsPayload.reduce((sum, team) => sum + team.metrics.health, 0);
    const totalBudget = teamsPayload.reduce((sum, team) => sum + team.metrics.budget, 0);
    const totalCO2 = teamsPayload.reduce((sum, team) => sum + team.metrics.totalCO2, 0);
    const totalCompletedProjects = teamsPayload.reduce(
      (sum, team) => sum + team.metrics.completedProjects,
      0
    );

    const activeTeams = teamsPayload.filter((team) => team.gameStatus === 'active').length;
    const completedTeams = teamsPayload.filter((team) => team.gameStatus === 'completed').length;
    const eliminatedTeams = teamsPayload.filter((team) => team.gameStatus === 'eliminated').length;
    const connectedTeams = teamsPayload.filter(
      (team) => team.connection.hasActiveSocketConnections
    ).length;

    const rankings = rankedTeams.map((entry, index) => ({
      rank: index + 1,
      teamId: entry.team.teamId,
      sessionId: entry.team.sessionId,
      citySlot: entry.team.citySlot,
      teamName: entry.team.teamName,
      totalProjectScore: entry.totalProjectScore,
      health: round2(Number(entry.team.cityHealth || 0)),
      totalCO2: round2(Number(entry.team.totalCO2 || 0)),
      gameStatus: entry.team.gameStatus,
    }));

    return {
      roomCode: normalizedRoomCode,
      room: {
        roomCode: normalizedRoomCode,
        roomName: room.roomName,
        status: room.status,
        isAdminRoom: Boolean(room.isAdminRoom),
        startedAt,
        elapsedMs,
        elapsedSeconds,
        totalDurationSeconds,
        remainingSeconds,
        isExpired: remainingSeconds <= 0,
        createdAt: toIsoDate(room.createdAt),
        updatedAt: toIsoDate(room.updatedAt),
      },
      globalMetrics: {
        totalTeams: teamCount,
        avgHealth: teamCount > 0 ? round2(totalHealth / teamCount) : 0,
        avgCO2: teamCount > 0 ? round2(totalCO2 / teamCount) : 0,
        avgBudget: teamCount > 0 ? round2(totalBudget / teamCount) : 0,
        totalHealth: round2(totalHealth),
        totalCO2: round2(totalCO2),
        totalBudget: round2(totalBudget),
        totalCompletedProjects,
        activeTeams,
        completedTeams,
        eliminatedTeams,
        connectedTeams,
        disconnectedTeams: Math.max(0, teamCount - connectedTeams),
      },
      teams: teamsPayload,
      rankings,
      snapshot: latestSnapshot,
      materialFlowEvents,
      flowQuery: {
        flowLimit,
        flowFrom: flowFrom ? flowFrom.toISOString() : null,
        flowTo: flowTo ? flowTo.toISOString() : null,
        includeFlowEvents,
      },
      generatedAt: new Date().toISOString(),
      contractVersion: 'admin-room-live-overview/v2',
    };
  }

  static async logMaterialFlowEvent(event: MaterialFlowEventInput): Promise<void> {
    try {
      if (!event.roomCode || !event.teamId || !event.sessionId) return;
      if (!Number.isFinite(event.amount) || event.amount <= 0) return;

      await AdminMaterialFlowEvent.create({
        schemaVersion: 'v1',
        roomCode: event.roomCode.toUpperCase(),
        teamId: event.teamId,
        sessionId: event.sessionId,
        citySlot: event.citySlot,
        flowClass: event.flowClass,
        source: event.source,
        destination: event.destination,
        materialType: event.materialType,
        amount: round2(event.amount),
        eventAt: event.eventAt || new Date(),
        metadata: event.metadata,
      });
    } catch (error) {
      logger.error('[AdminTelemetry] Failed to log material flow event', error);
    }
  }

  static async logWasteBatchToDestination(input: WasteBatchDestinationInput): Promise<void> {
    const composition = input.composition || {};

    for (const type of TELEMETRY_MATERIAL_TYPES) {
      const ratio = Number(composition[type] || 0);
      if (!Number.isFinite(ratio) || ratio <= 0) continue;

      const amount = Number(input.mass || 0) * ratio;
      await this.logMaterialFlowEvent({
        roomCode: input.roomCode,
        teamId: input.teamId,
        sessionId: input.sessionId,
        citySlot: input.citySlot,
        flowClass: 'waste',
        source: input.source,
        destination: input.destination,
        materialType: type,
        amount,
        metadata: input.metadata,
      });
    }
  }

  private static async captureSingleRoomSnapshot(
    room: any
  ): Promise<'captured' | 'completed' | 'skipped'> {
    const sessionIds = (room.teams || []).map((team: any) => team.sessionId).filter(Boolean);
    if (sessionIds.length === 0) return 'completed';

    const gameSession = await GameSession.findOne({ sessionId: { $in: sessionIds } })
      .select('gameState')
      .lean<any>();

    const gameState = gameSession?.gameState;
    const teams: TeamData[] = gameState?.teams || [];
    if (!teams.length) return 'skipped';

    const totalDurationSeconds = Math.max(
      0,
      Math.round(Number(gameState?.constants?.TEAM_GAME_DURATION_MINUTES || 15) * 60)
    );
    const gameStartTime = Number(gameState?.gameStartTime || 0);
    const hasExpiredByTime =
      Number.isFinite(gameStartTime) &&
      gameStartTime > 0 &&
      Date.now() >= gameStartTime + totalDurationSeconds * 1000;
    const allTeamsFinished = teams.every(
      (team) => team.gameStatus === 'completed' || team.gameStatus === 'eliminated'
    );


    
    if (gameState?.gameStatus === 'completed' || allTeamsFinished || hasExpiredByTime) {
      return 'completed';
    }

    const rankedTeams = rankTeams(teams);

    const rankByTeamId = new Map<string, number>();
    rankedTeams.forEach((entry, index) => {
      rankByTeamId.set(entry.team.teamId, index + 1);
    });

    const snapshotTeams = teams.map((team) => {
      const materials = getMaterialHoldingMaps(team);
      const waste = getWasteMaps(team);

      return {
        teamId: team.teamId,
        sessionId: team.sessionId,
        citySlot: team.citySlot,
        teamName: team.teamName,
        gameStatus: team.gameStatus,
        metrics: {
          health: round2(Number(team.cityHealth || 0)),
          wallet: round2(Number(team.budget || 0)),
          totalCO2: round2(Number(team.totalCO2 || 0)),
          completedProjects: deriveCompletedProjects(team),
          totalProjectScore: deriveTotalProjectScore(team),
          wasteInventory: round2(Number(team.wasteInventory || 0)),
          totalLandfillTons: round2(Number(team.totalLandfillTons || 0)),
          minutesElapsed: round2(Number(team.minutesElapsed || 0)),
        },
        rank: rankByTeamId.get(team.teamId) || 0,
        materials,
        waste,
      };
    });

    const teamCount = snapshotTeams.length;
    const summary = snapshotTeams.reduce(
      (acc, team) => {
        acc.totalHealth += team.metrics.health;
        acc.totalWallet += team.metrics.wallet;
        acc.totalCO2 += team.metrics.totalCO2;
        acc.totalCompletedProjects += team.metrics.completedProjects;
        return acc;
      },
      {
        totalHealth: 0,
        totalWallet: 0,
        totalCO2: 0,
        totalCompletedProjects: 0,
      }
    );

        const rankings = rankedTeams.map((entry, index) => ({
      rank: index + 1,
      teamId: entry.team.teamId,
      sessionId: entry.team.sessionId,
      citySlot: entry.team.citySlot,
      teamName: entry.team.teamName,
      totalProjectScore: entry.totalProjectScore,
    }));

    await AdminMonitorRoomSnapshot.create({
      schemaVersion: 'v1',
      roomCode: String(room.roomCode).toUpperCase(),
      snapshotAt: new Date(),
      roomStatus: room.status,
      teamCount,
      summary: {
        avgHealth: teamCount > 0 ? round2(summary.totalHealth / teamCount) : 0,
        totalWallet: round2(summary.totalWallet),
        totalCO2: round2(summary.totalCO2),
        totalCompletedProjects: summary.totalCompletedProjects,
      },
      teams: snapshotTeams,
      rankings,
    });

    return 'captured';
  }
}
