import { GameConstants } from '../types';

export const DEFAULT_GAME_CONSTANTS: GameConstants = {
  REAL_TIME_GAME_DURATION_MINUTES: 15,
  GAME_DURATION_DAYS: 7,
  WASTE_SPAWN_INTERVAL_MINUTES: 1,
  AUTO_SAVE_INTERVAL_SECONDS: 30,
  BATCH_COLLECTION_DEADLINE_MINUTES: 2,
  OVERDUE_BATCH_HEALTH_PENALTY: 7,
  FIXED_DISTANCE_TO_MRF_KM: 10,

  STARTING_BUDGET: 10000,
  STARTING_HEALTH: 50,
  WINNING_HEALTH: 60,
  LOSING_HEALTH: 0,

  CO2_TRANSPORT_FACTOR_PER_TON_KM: 0.12,
  CO2_PROCESSING_FACTOR_PER_TON_MIN: 0.015,
  CO2_DUMPING_FACTOR_PER_TON_MIN: 0.25,
  CO2_FACTOR_TRANSPORT: 1.6,
  CO2_FACTOR_LANDFILL: 2.5,

  TRANSPORT_COST_PER_TON_KM: 2.5,
  DUMPING_FEE: 50,
  OPERATING_COST: 500,

  MATERIAL_PROPERTIES: {
    paper: {
      basePrice: 180,
      processRate: 0.85,
      wasteRate: 0.15,
      co2Profile: 'Low',
      co2EmissionPerTon: 0.8,
    },
    plastic: {
      basePrice: 350,
      processRate: 0.8,
      wasteRate: 0.2,
      co2Profile: 'High',
      co2EmissionPerTon: 2.5,
    },
    metal: {
      basePrice: 600,
      processRate: 0.9,
      wasteRate: 0.1,
      co2Profile: 'Med',
      co2EmissionPerTon: 1.5,
    },
    glass: {
      basePrice: 120,
      processRate: 0.75,
      wasteRate: 0.25,
      co2Profile: 'Low',
      co2EmissionPerTon: 0.6,
    },
    wood: {
      basePrice: 100,
      processRate: 0.9,
      wasteRate: 0.1,
      co2Profile: 'Med',
      co2EmissionPerTon: 0.3,
    },
  },

  QUALITY_MULTIPLIERS: {
    material: { A: 1.25, B: 1.0, C: 0.5 },
    waste: { B: 0.3, C: 0.2, F: 0.1 },
  },

  WASTE_PENALTY_THRESHOLD: 100,
  CO2_PENALTY_THRESHOLD: 200,
  HEALTH_PENALTY_PER_TON_OVER: 1,
  HEALTH_PENALTY_PER_50_TONS_CO2_OVER: 1,
  PROJECT_COMPLETION_BONUS: 5,

  COUNTDOWN_DURATION_SECONDS: 30,
  COUNTDOWN_RECOVERY_HEALTH_THRESHOLD: 5,
  COUNTDOWN_RECOVERY_BUDGET_THRESHOLD: 1000,

  AUCTION_DURATION_SECONDS: 30,
  AUCTION_BID_INCREMENT_RATE: 0.05,
  PLAYER_BID_CAP: 10,
  MARKUP_CONSTANT: 2,

  REFUSE_HEALTH_PENALTY_PER_TON: 0.5,

  // ✅ NEW: Per-team timer (15 minutes)
  TEAM_GAME_DURATION_MINUTES: 15,
};