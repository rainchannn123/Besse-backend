import { Document } from 'mongoose';
import { z } from 'zod';

// ============================================
// CORE TYPES
// ============================================

export type MaterialType = 'paper' | 'plastic' | 'metal' | 'glass' | 'wood';
export type QualityGrade = 'A' | 'B' | 'C' | 'F';
export type PlayerRole = 'municipality' | 'mrf' | 'broker';
export type WasteOrigin = 'Residential' | 'Commercial' | 'Industrial';
export type BatchStatus = 'PENDING' | 'DELIVERED' | 'FAILED';
export type GameStatus = 'active' | 'won' | 'lost' | 'complete' | 'eliminated';
export type GameMode = 'waste' | 'energy';
export type LobbyStage = 'waiting-room' | 'role-selection' | 'pairing' | 'in-game' | 'completed';
export type TeamStatus = 'active' | 'eliminated' | 'completed';

// ============================================
// USER TYPES
// ============================================

export interface IUser extends Document {
  name: string;
  email: string;
  password: string;
  accountType: 'student' | 'educator' | 'spectator' | 'admin';
  role: 'municipality' | 'mrf' | 'broker' | null;
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

// ============================================
// LOBBY & SESSION TYPES
// ============================================

export interface LobbyState {
  sessionId: string;
  lobbyCode: string;
  leader: string;
  gameMode: GameMode;
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
  pairStatus?: 'active' | 'team_a_eliminated' | 'team_b_eliminated' | 'completed' | null;
  createdAt: Date;
  maxPlayers: number;
}

// ============================================
// ACTIVE TRANSPORT
// ============================================

export interface ActiveTransport {
  id: string;
  batchId: string;
  wasteBatch: WasteBatch;
  mode: 'fast' | 'slow';
  startTime: number;
  endTime: number;
  cost: number;
  co2Emission: number;
  status: 'in-transit' | 'completed';
}

// ============================================
// GAME CONSTANTS
// ============================================

export interface GameConstants {
  REAL_TIME_GAME_DURATION_MINUTES: number;
  GAME_DURATION_DAYS: number;
  WASTE_SPAWN_INTERVAL_MINUTES: number;
  AUTO_SAVE_INTERVAL_SECONDS: number;
  BATCH_COLLECTION_DEADLINE_MINUTES: number;
  OVERDUE_BATCH_HEALTH_PENALTY: number;
  FIXED_DISTANCE_TO_MRF_KM: number;
  STARTING_BUDGET: number;
  STARTING_HEALTH: number;
  WINNING_HEALTH: number;
  LOSING_HEALTH: number;
  CO2_TRANSPORT_FACTOR_PER_TON_KM: number;
  CO2_PROCESSING_FACTOR_PER_TON_MIN: number;
  CO2_DUMPING_FACTOR_PER_TON_MIN: number;
  CO2_FACTOR_TRANSPORT: number;
  CO2_FACTOR_LANDFILL: number;
  TRANSPORT_COST_PER_TON_KM: number;
  DUMPING_FEE: number;
  OPERATING_COST: number;
  MATERIAL_PROPERTIES: {
    paper: { 
      basePrice: number; 
      processRate: number; 
      wasteRate: number; 
      co2Profile: string;
      co2EmissionPerTon: number;
    };
    plastic: { 
      basePrice: number; 
      processRate: number; 
      wasteRate: number; 
      co2Profile: string;
      co2EmissionPerTon: number;
    };
    metal: { 
      basePrice: number; 
      processRate: number; 
      wasteRate: number; 
      co2Profile: string;
      co2EmissionPerTon: number;
    };
    glass: { 
      basePrice: number; 
      processRate: number; 
      wasteRate: number; 
      co2Profile: string;
      co2EmissionPerTon: number;
    };
    wood: { 
      basePrice: number; 
      processRate: number; 
      wasteRate: number; 
      co2Profile: string;
      co2EmissionPerTon: number;
    };
  };
  QUALITY_MULTIPLIERS: {
    material: { A: number; B: number; C: number; };
    waste: { B: number; C: number; F: number; };
  };
  WASTE_PENALTY_THRESHOLD: number;
  CO2_PENALTY_THRESHOLD: number;
  HEALTH_PENALTY_PER_TON_OVER: number;
  HEALTH_PENALTY_PER_50_TONS_CO2_OVER: number;
  PROJECT_COMPLETION_BONUS: number;
  COUNTDOWN_DURATION_SECONDS: number;
  COUNTDOWN_RECOVERY_HEALTH_THRESHOLD: number;
  COUNTDOWN_RECOVERY_BUDGET_THRESHOLD: number;
  AUCTION_DURATION_SECONDS: number;
  AUCTION_BID_INCREMENT_RATE: number;
  PLAYER_BID_CAP: number;
  MARKUP_CONSTANT: number;
  REFUSE_HEALTH_PENALTY_PER_TON: number;
  // ✅ NEW: Per-team timer
  TEAM_GAME_DURATION_MINUTES: number;
}

// ============================================
// TEAM DATA (NEW)
// ============================================

export interface TeamData {
  teamId: string;
  sessionId: string;
  citySlot: number;
  teamName: string;
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
  // Team metrics
  budget: number;
  cityHealth: number;
  totalCO2: number;
  wasteInventory: number;
  totalTransportTrips: number;
  totalLandfillTons: number;
  // Timer
  teamStartTime: number;
  minutesElapsed: number;
  gameStatus: TeamStatus;
  // Projects (per team)
  cityProjects: CityProject[];
  // Inventory (per team)
  municipalInventory: {
    paper: number;
    plastic: number;
    metal: number;
    glass: number;
    wood: number;
  };
  // Other game state (per team)
  wasteBatches: WasteBatch[];
  mrfQueue: MRFQueue[];
  materialInventory: Material[];
  transactions: Transaction[];
  activityLog: string[];
  activeLocks: {
    [key: string]: {
      playerId: string;
      timestamp: number;
      type: 'batch' | 'queue' | 'material';
    };
  };
  gameOverCountdown: {
    active: boolean;
    startTime: number | null;
    reason: 'health' | 'budget' | 'time' | null;
  };
  surrenderVotes: string[];
  marketplaceListing: Auction[];
  externalStock: {
    paper: number;
    plastic: number;
    metal: number;
    glass: number;
    wood: number;
  };
  activeBids: {
    [playerId: string]: number;
  };
  activeTransports: ActiveTransport[];
  // ✅ NEW: Total project score for ranking
  totalProjectScore: number;
  // ✅ NEW: Is team eliminated
  isEliminated: boolean;
  eliminationReason?: 'health' | 'budget' | 'time' | null;
}

// ============================================
// GAME STATE (UPDATED)
// ============================================

export interface GameState {
  sessionId: string;
  roomCode?: string;
  roomTeams?: Array<{
    teamId: string;
    citySlot: number;
    sessionId: string;
  }>;
  citySlot?: number;
  // ✅ UPDATED: Multi-team support - teams array
  teams: TeamData[];
  // Game-wide settings
  constants: GameConstants;
  gameStartTime: number;
  gameStatus: 'active' | 'completed';
  // Legacy fields - kept for backward compatibility but will be migrated
  currentTurn?: number;
  budget?: number;
  cityHealth?: number;
  totalCO2?: number;
  wasteInventory?: number;
  maxCapacity?: number;
  wasteBatches?: WasteBatch[];
  mrfQueue?: MRFQueue[];
  materialInventory?: Material[];
  transactions?: Transaction[];
  cityProjects?: CityProject[];
  activityLog?: string[];
  players?: {
    municipality: string;
    mrf: string;
    broker: string;
  };
  playerNames?: {
    municipality: string;
    mrf: string;
    broker: string;
  };
  lastWasteSpawnTime?: number;
  lastAutoSaveTime?: number;
  currentGameDay?: number;
  currentGameHour?: number;
  activeLocks?: {
    [key: string]: {
      playerId: string;
      timestamp: number;
      type: 'batch' | 'queue' | 'material';
    };
  };
  pairId?: string | null;
  partnerSessionId?: string | null;
  teamRole?: 'Team A' | 'Team B' | null;
  pairStatus?: 'active' | 'team_a_eliminated' | 'team_b_eliminated' | 'completed' | null;
  gameOverCountdown?: {
    active: boolean;
    startTime: number | null;
    reason: 'health' | 'budget' | 'time' | null;
  };
  totalTransportTrips?: number;
  totalLandfillTons?: number;
  municipalInventory?: {
    paper: number;
    plastic: number;
    metal: number;
    glass: number;
    wood: number;
  };
  surrenderVotes?: string[];
  marketplaceListing?: Auction[];
  externalStock?: {
    paper: number;
    plastic: number;
    metal: number;
    glass: number;
    wood: number;
  };
  activeBids?: {
    [playerId: string]: number;
  };
  activeTransports?: ActiveTransport[];
}

// ============================================
// WASTE BATCH
// ============================================

export interface WasteBatch {
  id: string;
  playerId: string;
  turnGenerated: number;
  generationTime: number;
  origin: WasteOrigin;
  mass: number;
  composition: {
    paper: number;
    plastic: number;
    metal: number;
    glass: number;
    wood?: number;
  };
  status: BatchStatus | 'IN_TRANSIT';
  collectionDeadline: number;
  lockToken: string | null;
  lockedAt: number | null;
  penalized: boolean;
}

// ============================================
// MRF QUEUE
// ============================================

export interface MRFQueue {
  id: string;
  batchId: string;
  playerId: string;
  arrivalTime: number;
  delivered: boolean;
  lockToken: string | null;
  penaltyApplied?: boolean;
}

// ============================================
// MATERIAL
// ============================================

export interface Material {
  id: string;
  type: MaterialType;
  materialOrWaste: boolean;
  quality: QualityGrade;
  mass: number;
  contamination: number;
  owner: 'mrf' | 'broker' | 'municipality';
  listed: boolean;
}

// ============================================
// TRANSACTION
// ============================================

export interface Transaction {
  id: string;
  turn: number;
  buyer: string;
  seller: string;
  itemType: string;
  itemId: string;
  mass: number;
  price: number;
  transactionType: 'external_sale' | 'internal_transfer';
  revenue: number;
}

// ============================================
// CITY PROJECT (UPDATED - Per Team)
// ============================================

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
  score: number;
}

// ============================================
// AUCTION
// ============================================

export interface Auction {
  auctionId: string;
  originTeam: string;
  materialType: MaterialType;
  grade: QualityGrade;
  mass: number;
  currentBid: number;
  entryPrice: number;
  startingPrice?: number;
  highBidder: string | null;
  highBidderSessionId?: string | null;
  endTime: number;
  status: 'pending' | 'active' | 'sold' | 'expired';
}

// ============================================
// MATCHMAKING TYPES
// ============================================

export interface MatchmakingRoom {
  roomCode: string;
  roomName: string;
  ownerId: string;
  ownerName: string;
  isPrivate: boolean;
  isAdminRoom: boolean;
  maxTeams: number;
  teams: MatchmakingTeam[];
  status: 'waiting' | 'ready' | 'started' | 'completed';
  gameSessionId?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface MatchmakingTeam {
  teamId: string;
  sessionId: string;
  citySlot: number;
  players: MatchmakingPlayer[];
  isReady: boolean;
}

export interface MatchmakingPlayer {
  userId: string;
  name: string;
  role: PlayerRole | null;
  isLeader: boolean;
}

// ============================================
// GAME RESULTS TYPES
// ============================================

export interface GameResult {
  sessionId: string;
  teamId: string;
  teamName: string;
  citySlot: number;
  projectScoreTotal: number;
  rank: number;
  health: number;
  budget: number;
  totalCO2: number;
  gameStatus: TeamStatus;
  failReason?: 'health' | 'budget' | 'time' | null;
  createdAt: Date;
}

// ============================================
// ZOD SCHEMAS (Keep existing ones)
// ============================================

// ... (keep all existing Zod schemas unchanged)

// ============================================
// TYPE INFERENCES
// ============================================

export type RegisterInput = z.infer<typeof registerSchema>['body'];
export type LoginInput = z.infer<typeof loginSchema>['body'];
export type JoinLobbyInput = z.infer<typeof joinLobbySchema>['body'];
export type SelectRoleInput = z.infer<typeof selectRoleSchema>['body'];
export type LeaveLobbyInput = z.infer<typeof leaveLobbySchema>['body'];
export type ContinueToRoleSelectionInput = z.infer<typeof continueToRoleSelectionSchema>['body'];
export type ContinueToPairingInput = z.infer<typeof continueToPairingSchema>['body'];
export type CollectWasteInput = z.infer<typeof collectWasteSchema>;
export type CollectWasteTransportInput = z.infer<typeof collectWasteTransportSchema>;
export type ProcessWasteInput = z.infer<typeof processWasteSchema>['body'];
export type AssignGradeInput = z.infer<typeof assignGradeSchema>['body'];
export type SellMaterialInput = z.infer<typeof sellMaterialSchema>['body'];
export type PlaceBidInput = z.infer<typeof placeBidSchema>['body'];
export type BuyFromExternalWholesalerInput = z.infer<typeof buyFromExternalWholesalerSchema>['body'];
export type ConstructProjectInput = z.infer<typeof constructProjectSchema>;