import { Document } from 'mongoose';
import { z } from 'zod';

// User Types
export interface IUser extends Document {
  name: string;
  email: string;
  password: string;
  role: 'player' | 'admin';
  currentSession: string | null;
  comparePassword(candidatePassword: string): Promise<boolean>;
  createdAt: Date;
  updatedAt: Date;
}

export interface DecodedToken {
  id: string;
  iat: number;
  exp: number;
}

// Lobby & Session Types
export type LobbyStage =
  | 'waiting-room'
  | 'role-selection'
  | 'pairing'
  | 'in-game'
  | 'completed';

export interface LobbyState {
  sessionId: string;
  lobbyCode: string; // 6-character alphanumeric code for joining
  leader: string; // User ID of the lobby leader
  stage: LobbyStage;
  players: {
    userId: string;
    name: string;
    selectedRole: 'municipality' | 'mrf' | 'broker' | null;
    joinedAt: Date;
  }[];
  status: 'waiting' | 'ready' | 'active' | 'completed';
  pairId?: string | null;
  partnerSessionId?: string | null;
  teamRole?: 'Team A' | 'Team B' | null;
  pairStatus?:
    | 'active'
    | 'team_a_eliminated'
    | 'team_b_eliminated'
    | 'completed'
    | null;
  createdAt: Date;
  maxPlayers: number;
}

// Game Constants
export interface GameConstants {
  // Time & Session - UPDATED to match manual exactly
  REAL_TIME_GAME_DURATION_MINUTES: number; // 30 minutes real-world time
  GAME_DURATION_DAYS: number; // 7 game days
  WASTE_SPAWN_INTERVAL_MINUTES: number; // 2 minutes real-world time
  AUTO_SAVE_INTERVAL_SECONDS: number; // 30 seconds
  BATCH_COLLECTION_DEADLINE_MINUTES: number; // 10 minutes game time
  OVERDUE_BATCH_HEALTH_PENALTY: number; // 2% per overdue batch
  FIXED_DISTANCE_TO_MRF_KM: number; // 10 km fixed distance

  // Starting values
  STARTING_BUDGET: number;
  STARTING_HEALTH: number;
  WINNING_HEALTH: number;
  LOSING_HEALTH: number;

  // CO2 Factors (UPDATED to match manual exactly)
  CO2_TRANSPORT_FACTOR_PER_TON_KM: number; // 120 kg CO2 / ton / km
  CO2_PROCESSING_FACTOR_PER_TON_MIN: number; // 15 kg CO2 / ton / min
  CO2_DUMPING_FACTOR_PER_TON_MIN: number; // 250 kg CO2 / ton / min
  CO2_FACTOR_TRANSPORT: number; // 1.6 tons per truck
  CO2_FACTOR_LANDFILL: number; // 2.5 tons per ton

  // Costs (UPDATED to match manual exactly)
  TRANSPORT_COST_PER_TON_KM: number; // $2.50 / ton / km
  DUMPING_FEE: number; // $50 / ton
  OPERATING_COST: number; // $500 / shift

  // Material Properties (UPDATED to match manual table exactly - includes Wood)
  MATERIAL_PROPERTIES: {
    paper: {
      basePrice: number;
      processRate: number;
      wasteRate: number;
      co2Profile: string;
    };
    plastic: {
      basePrice: number;
      processRate: number;
      wasteRate: number;
      co2Profile: string;
    };
    metal: {
      basePrice: number;
      processRate: number;
      wasteRate: number;
      co2Profile: string;
    };
    glass: {
      basePrice: number;
      processRate: number;
      wasteRate: number;
      co2Profile: string;
    };
    wood: {
      basePrice: number;
      processRate: number;
      wasteRate: number;
      co2Profile: string;
    };
  };

  // Quality Multipliers - UPDATED to match manual exactly
  QUALITY_MULTIPLIERS: {
    material: {
      A: number; // 1.25x
      B: number; // 1.0x
      C: number; // 0.5x
    };
    waste: {
      B: number; // 0.3x
      C: number; // 0.2x
      F: number; // 0.1x
    };
  };

  // Health Calculation (UPDATED to match manual exactly)
  WASTE_PENALTY_THRESHOLD: number; // 100 tons
  CO2_PENALTY_THRESHOLD: number; // 200 tons
  HEALTH_PENALTY_PER_TON_OVER: number; // 1% per ton over waste threshold
  HEALTH_PENALTY_PER_50_TONS_CO2_OVER: number; // 1% per 50 tons over CO2 threshold
  PROJECT_COMPLETION_BONUS: number; // 5% per project

  // Game Over Countdown
  COUNTDOWN_DURATION_SECONDS: number; // 180 seconds (3 minutes)
  COUNTDOWN_RECOVERY_HEALTH_THRESHOLD: number; // 5%
  COUNTDOWN_RECOVERY_BUDGET_THRESHOLD: number; // $1,000

  // Auction and Broker settings
  AUCTION_DURATION_SECONDS: number; // 30 seconds
  AUCTION_BID_INCREMENT_RATE: number; // 0.05 => 5% of entry price per click
  PLAYER_BID_CAP: number; // 10 active bids
  MARKUP_CONSTANT: number; // 2.5x

  // Penalties
  REFUSE_HEALTH_PENALTY_PER_TON: number; // 0.5% per ton
}

export interface GameState {
  sessionId: string;
  currentTurn: number;
  budget: number;
  cityHealth: number;
  totalCO2: number;
  wasteInventory: number;
  maxCapacity: number;
  constants: GameConstants;
  wasteBatches: WasteBatch[];
  mrfQueue: MRFQueue[];
  materialInventory: Material[];
  transactions: Transaction[];
  cityProjects: CityProject[];
  activityLog: string[];
  gameStatus: 'active' | 'won' | 'lost' | 'complete';
  players: {
    municipality: string;
    mrf: string;
    broker: string;
  };
  playerNames: {
    municipality: string;
    mrf: string;
    broker: string;
  };
  // NEW: Real-time game mechanics
  gameStartTime: number; // Timestamp when game started
  lastWasteSpawnTime: number; // Timestamp of last waste spawn
  lastAutoSaveTime: number; // Timestamp of last auto-save
  minutesElapsed: number; // Real-world minutes elapsed
  currentGameDay: number; // Current game day (1-7)
  currentGameHour: number; // Current hour in game day
  // NEW: Active locks for concurrent processing prevention
  activeLocks: {
    [key: string]: {
      playerId: string;
      timestamp: number;
      type: 'batch' | 'queue' | 'material';
    };
  };
  // NEW: Pairing information for paired-team mode
  pairId?: string | null;
  partnerSessionId?: string | null;
  teamRole?: 'Team A' | 'Team B' | null;
  pairStatus?:
    | 'active'
    | 'team_a_eliminated'
    | 'team_b_eliminated'
    | 'completed'
    | null;
  // NEW: Game Over Countdown System
  gameOverCountdown: {
    active: boolean;
    startTime: number | null;
    reason: 'health' | 'budget' | 'time' | null;
  };
  // NEW: Transport tracking
  totalTransportTrips: number;
  totalLandfillTons: number;

  // NEW: Municipal Inventory for materials available for projects
  municipalInventory: {
    paper: number;
    plastic: number;
    metal: number;
    glass: number;
    wood: number;
  };

  // NEW: Surrender voting — all 3 must agree within the enabled window
  surrenderVotes: string[]; // array of playerIds who have voted to surrender

  // NEW: Marketplace Listing for live auctions
  marketplaceListing: Auction[];

  // NEW: External wholesaler stock (randomized at game start)
  externalStock: {
    paper: number;
    plastic: number;
    metal: number;
    glass: number;
    wood: number;
  };

  // NEW: Active bids tracking per player (for bid cap enforcement)
  activeBids: {
    [playerId: string]: number; // playerId -> count of active bids
  };
}

export interface WasteBatch {
  id: string;
  playerId: string; // Player who initiated collection
  turnGenerated: number;
  generationTime: number; // Timestamp when batch was generated
  origin: 'Residential' | 'Commercial' | 'Industrial';
  mass: number;
  composition: {
    paper: number;
    plastic: number;
    metal: number;
    glass: number;
    wood?: number;
  };
  status: 'PENDING' | 'DELIVERED' | 'FAILED';
  collectionDeadline: number; // Timestamp deadline for collection
  lockToken: string | null; // Lock token to prevent double processing
  lockedAt: number | null; // Timestamp when batch was locked
  penalized: boolean; // Whether health penalty has been applied for being overdue
}

export interface MRFQueue {
  id: string;
  batchId: string;
  playerId: string; // Player who initiated MRF processing
  arrivalTime: number; // Timestamp
  delivered: boolean; // If TRUE, hide from "IN TRANSIT" list
  lockToken: string | null; // Lock token to prevent double processing
  penaltyApplied?: boolean; // If TRUE, 5-minute penalty has been applied
}

export interface Material {
  id: string;
  type: 'paper' | 'plastic' | 'metal' | 'glass' | 'wood';
  materialOrWaste: boolean; // TRUE = material, FALSE = waste
  quality: 'A' | 'B' | 'C' | 'F';
  mass: number;
  contamination: number;
  owner: 'mrf' | 'broker' | 'municipality';
  listed: boolean;
}

export interface Transaction {
  id: string;
  turn: number;
  buyer: string; // "External Market" or "Municipality"
  seller: string;
  itemType: string;
  itemId: string;
  mass: number;
  price: number;
  transactionType: 'external_sale' | 'internal_transfer'; // NEW
  revenue: number; // Added to budget (for external sales)
}

export interface CityProject {
  id: string;
  name: string;
  requiredMaterials: {
    paper?: number;
    plastic?: number;
    metal?: number;
    glass?: number;
    wood?: number;
  };
  addedMaterials?: {
    paper?: number;
    plastic?: number;
    metal?: number;
    glass?: number;
    wood?: number;
  };
  progress: number;
  completed: boolean;
  healthBonus: number;
  budgetBonus: number;
  deadline: number;
}

export interface Auction {
  auctionId: string;
  originTeam: string; // sessionId of the team listing the auction
  materialType: 'paper' | 'plastic' | 'metal' | 'glass' | 'wood';
  grade: 'A' | 'B' | 'C' | 'F';
  mass: number;
  currentBid: number; // Current/highest bid amount
  entryPrice: number; // Entry price set by MRF - won't change even when bids are placed
  startingPrice?: number; // Entry price set by MRF (for reference, same as initial currentBid) [DEPRECATED - use entryPrice]
  highBidder: string | null; // playerId of highest bidder
  highBidderSessionId?: string | null; // sessionId of highest bidder's team (for self-win detection)
  endTime: number; // timestamp when auction expires
  status: 'pending' | 'active' | 'sold' | 'expired';
}

// Zod Schemas
export const registerSchema = z.object({
  body: z.object({
    name: z.string().min(2, 'Name must be at least 2 characters'),
    email: z.string().email('Invalid email address'),
    password: z.string().min(6, 'Password must be at least 6 characters'),
  }),
});

export const loginSchema = z.object({
  body: z.object({
    email: z.string().email('Invalid email address'),
    password: z.string().min(1, 'Password is required'),
  }),
});

export const adminLoginSchema = z.object({
  body: z.object({
    username: z.string().min(1, 'Username is required'),
    password: z.string().min(1, 'Password is required'),
  }),
});

export const adminForceExitSchema = z.object({
  params: z.object({
    userId: z.string().min(1, 'User ID is required'),
  }),
  body: z
    .object({
      reason: z.string().max(200).optional(),
    })
    .optional(),
});

export const createLobbySchema = z.object({
  body: z.object({}),
});

export const joinLobbySchema = z.object({
  body: z.object({
    lobbyCode: z
      .string()
      .regex(
        /^[A-Z0-9]{6}$/,
        'Lobby code must be exactly 6 alphanumeric characters'
      ),
  }),
});

export const selectRoleSchema = z.object({
  body: z.object({
    sessionId: z.string().min(1, 'Session ID is required'),
    role: z.enum(['municipality', 'mrf', 'broker']),
  }),
});

export const leaveLobbySchema = z.object({
  body: z.object({
    sessionId: z.string().min(1, 'Session ID is required'),
  }),
});

export const continueToRoleSelectionSchema = z.object({
  body: z.object({
    sessionId: z.string().min(1, 'Session ID is required'),
  }),
});

export const continueToPairingSchema = z.object({
  body: z.object({
    sessionId: z.string().min(1, 'Session ID is required'),
  }),
});

export const collectWasteSchema = z.object({
  body: z.object({
    batchId: z.string().min(1, 'Batch ID is required'),
  }),
  params: z.object({
    sessionId: z.string().min(1, 'Session ID is required'),
  }),
});

export const processWasteSchema = z.object({
  body: z.object({
    queueId: z.string().min(1, 'Queue ID is required'),
    sessionId: z.string().min(1, 'Session ID is required'),
  }),
});

export const assignGradeSchema = z.object({
  body: z.object({
    auctionId: z.string().min(1, 'Auction ID is required'),
    grade: z.enum(['A', 'B', 'C', 'F']),
    sessionId: z.string().min(1, 'Session ID is required'),
    customPrice: z.number(),
  }),
});

export const sellMaterialSchema = z.object({
  body: z.object({
    materialId: z.string().min(1, 'Material ID is required'),
    transactionType: z.enum(['external_sale', 'internal_transfer']),
    projectId: z.string().optional(), // Required for internal transfers
    sessionId: z.string().min(1, 'Session ID is required'),
  }),
});

export const placeBidSchema = z.object({
  body: z.object({
    auctionId: z.string().min(1, 'Auction ID is required'),
  }),
});

export const buyFromExternalWholesalerSchema = z.object({
  body: z.object({
    materialType: z.enum(['paper', 'plastic', 'metal', 'glass', 'wood']),
    requestedAmount: z.number().positive('Amount must be positive'),
    sessionId: z.string().min(1, 'Session ID is required'),
  }),
});

export const constructProjectSchema = z.object({
  body: z.object({
    projectId: z.string().min(1, 'Project ID is required'),
    materialType: z.enum(['paper', 'plastic', 'metal', 'glass', 'wood']),
    materialAmount: z.number().positive('Material amount must be positive'),
  }),
  params: z.object({
    sessionId: z.string().min(1, 'Session ID is required'),
  }),
});

export type RegisterInput = z.infer<typeof registerSchema>['body'];
export type LoginInput = z.infer<typeof loginSchema>['body'];
export type JoinLobbyInput = z.infer<typeof joinLobbySchema>['body'];
export type SelectRoleInput = z.infer<typeof selectRoleSchema>['body'];
export type LeaveLobbyInput = z.infer<typeof leaveLobbySchema>['body'];
export type ContinueToRoleSelectionInput = z.infer<
  typeof continueToRoleSelectionSchema
>['body'];
export type ContinueToPairingInput = z.infer<typeof continueToPairingSchema>['body'];
export type CollectWasteInput = z.infer<typeof collectWasteSchema>;
export type ProcessWasteInput = z.infer<typeof processWasteSchema>['body'];
export type AssignGradeInput = z.infer<typeof assignGradeSchema>['body'];
export type SellMaterialInput = z.infer<typeof sellMaterialSchema>['body'];
export type PlaceBidInput = z.infer<typeof placeBidSchema>['body'];
export type BuyFromExternalWholesalerInput = z.infer<
  typeof buyFromExternalWholesalerSchema
>['body'];
export type ConstructProjectInput = z.infer<typeof constructProjectSchema>;
