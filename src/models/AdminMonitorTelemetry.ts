import mongoose, { Document, Schema } from 'mongoose';

const MATERIAL_TYPES = ['paper', 'metal', 'plastic', 'wood', 'glass'] as const;
type MaterialType = (typeof MATERIAL_TYPES)[number];

type MaterialAmountMap = Record<MaterialType, number>;

interface ITeamSnapshot {
  teamId: string;
  sessionId: string;
  citySlot: number;
  teamName: string;
  gameStatus: string;
  metrics: {
    health: number;
    wallet: number;
    totalCO2: number;
    completedProjects: number;
    totalProjectScore: number;
    wasteInventory: number;
    totalLandfillTons: number;
    minutesElapsed: number;
  };
  rank: number;
  materials: {
    municipalityInventory: MaterialAmountMap;
    inventoryItems: MaterialAmountMap;
    listedForAuction: MaterialAmountMap;
    totalHeld: MaterialAmountMap;
  };
  waste: {
    totalByType: MaterialAmountMap;
    byStatus: {
      pending: MaterialAmountMap;
      delivered: MaterialAmountMap;
      inTransit: MaterialAmountMap;
      failed: MaterialAmountMap;
    };
  };
}

export interface IAdminMonitorRoomSnapshot extends Document {
  schemaVersion: 'v1';
  roomCode: string;
  snapshotAt: Date;
  roomStatus: string;
  teamCount: number;
  summary: {
    avgHealth: number;
    totalWallet: number;
    totalCO2: number;
    totalCompletedProjects: number;
  };
  teams: ITeamSnapshot[];
  rankings: Array<{
    rank: number;
    teamId: string;
    sessionId: string;
    citySlot: number;
    teamName: string;
    totalProjectScore: number;
  }>;
  createdAt: Date;
  updatedAt: Date;
}

export interface IAdminMaterialFlowEvent extends Document {
  schemaVersion: 'v1';
  roomCode: string;
  teamId: string;
  sessionId: string;
  citySlot: number;
  flowClass: 'material' | 'waste';
  source: string;
  destination: string;
  materialType: MaterialType;
  amount: number;
  eventAt: Date;
  metadata?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

const materialAmountMapSchema = new Schema<MaterialAmountMap>(
  {
    paper: { type: Number, default: 0 },
    metal: { type: Number, default: 0 },
    plastic: { type: Number, default: 0 },
    wood: { type: Number, default: 0 },
    glass: { type: Number, default: 0 },
  },
  { _id: false }
);

const teamSnapshotSchema = new Schema<ITeamSnapshot>(
  {
    teamId: { type: String, required: true },
    sessionId: { type: String, required: true },
    citySlot: { type: Number, required: true },
    teamName: { type: String, required: true },
    gameStatus: { type: String, required: true },
    metrics: {
      health: { type: Number, required: true },
      wallet: { type: Number, required: true },
      totalCO2: { type: Number, required: true },
      completedProjects: { type: Number, required: true },
      totalProjectScore: { type: Number, required: true },
      wasteInventory: { type: Number, required: true },
      totalLandfillTons: { type: Number, required: true },
      minutesElapsed: { type: Number, required: true },
    },
    rank: { type: Number, required: true },
    materials: {
      municipalityInventory: { type: materialAmountMapSchema, required: true },
      inventoryItems: { type: materialAmountMapSchema, required: true },
      listedForAuction: { type: materialAmountMapSchema, required: true },
      totalHeld: { type: materialAmountMapSchema, required: true },
    },
    waste: {
      totalByType: { type: materialAmountMapSchema, required: true },
      byStatus: {
        pending: { type: materialAmountMapSchema, required: true },
        delivered: { type: materialAmountMapSchema, required: true },
        inTransit: { type: materialAmountMapSchema, required: true },
        failed: { type: materialAmountMapSchema, required: true },
      },
    },
  },
  { _id: false }
);

const roomSnapshotSchema = new Schema<IAdminMonitorRoomSnapshot>(
  {
    schemaVersion: { type: String, default: 'v1' },
    roomCode: { type: String, required: true, uppercase: true, index: true },
    snapshotAt: { type: Date, required: true, index: true },
    roomStatus: { type: String, required: true },
    teamCount: { type: Number, required: true },
    summary: {
      avgHealth: { type: Number, required: true },
      totalWallet: { type: Number, required: true },
      totalCO2: { type: Number, required: true },
      totalCompletedProjects: { type: Number, required: true },
    },
    teams: { type: [teamSnapshotSchema], default: [] },
    rankings: {
      type: [
        {
          rank: { type: Number, required: true },
          teamId: { type: String, required: true },
          sessionId: { type: String, required: true },
          citySlot: { type: Number, required: true },
          teamName: { type: String, required: true },
          totalProjectScore: { type: Number, required: true },
        },
      ],
      default: [],
    },
  },
  {
    timestamps: true,
  }
);

const materialFlowEventSchema = new Schema<IAdminMaterialFlowEvent>(
  {
    schemaVersion: { type: String, default: 'v1' },
    roomCode: { type: String, required: true, uppercase: true, index: true },
    teamId: { type: String, required: true, index: true },
    sessionId: { type: String, required: true, index: true },
    citySlot: { type: Number, required: true },
    flowClass: {
      type: String,
      enum: ['material', 'waste'],
      required: true,
      index: true,
    },
    source: { type: String, required: true, index: true },
    destination: { type: String, required: true, index: true },
    materialType: {
      type: String,
      enum: MATERIAL_TYPES,
      required: true,
      index: true,
    },
    amount: { type: Number, required: true, min: 0 },
    eventAt: { type: Date, required: true, index: true },
    metadata: { type: Schema.Types.Mixed, default: undefined },
  },
  {
    timestamps: true,
  }
);

roomSnapshotSchema.index({ roomCode: 1, snapshotAt: -1 });
materialFlowEventSchema.index({ roomCode: 1, eventAt: -1 });
materialFlowEventSchema.index({ roomCode: 1, sessionId: 1, eventAt: -1 });

export const AdminMonitorRoomSnapshot = mongoose.model<IAdminMonitorRoomSnapshot>(
  'AdminMonitorRoomSnapshot',
  roomSnapshotSchema,
  'admin_monitor_room_snapshots'
);

export const AdminMaterialFlowEvent = mongoose.model<IAdminMaterialFlowEvent>(
  'AdminMaterialFlowEvent',
  materialFlowEventSchema,
  'admin_material_flow_events'
);

export const TELEMETRY_MATERIAL_TYPES = MATERIAL_TYPES;
export type { MaterialType, MaterialAmountMap };
