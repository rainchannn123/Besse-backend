import mongoose, { Document, Schema } from 'mongoose';

export interface IPairScore extends Document {
  pairId: string;
  averagePairHealth: number;
  teamASessionId: string;
  teamBSessionId: string;
  teamAHealth: number | null;
  teamBHealth: number | null;
  teamABudget: number;
  teamBBudget: number;
  teamACO2: number;
  teamBCO2: number;
  teamAScore: number;
  teamBScore: number;
  winningTeam: 'Team A' | 'Team B' | 'Tie' | null;
  scoreRanking: Array<{
    rank: number;
    team: 'Team A' | 'Team B';
    sessionId: string;
    finalScore: number;
  }>;
  teamAGameStatus: string; // 'active', 'lost', 'complete'
  teamBGameStatus: string; // 'active', 'lost', 'complete'
  teamAPairStatus: string; // 'active', 'eliminated'
  teamBPairStatus: string; // 'active', 'eliminated'
  gameEndTimestamp?: Date;
  pairStatus: string; // 'active', 'team_a_eliminated', 'team_b_eliminated', 'completed'
  createdAt: Date;
  updatedAt: Date;
}

const pairScoreSchema = new Schema<IPairScore>(
  {
    pairId: {
      type: String,
      required: true,
      unique: true,
    },
    averagePairHealth: {
      type: Number,
      required: true,
    },
    teamASessionId: {
      type: String,
      required: true,
    },
    teamBSessionId: {
      type: String,
      required: true,
    },
    teamAHealth: {
      type: Number,
      required: false,
    },
    teamBHealth: {
      type: Number,
      required: false,
    },
    teamABudget: {
      type: Number,
      required: true,
    },
    teamBBudget: {
      type: Number,
      required: true,
    },
    teamACO2: {
      type: Number,
      required: true,
    },
    teamBCO2: {
      type: Number,
      required: true,
    },
    teamAScore: {
      type: Number,
      required: true,
      default: 0,
    },
    teamBScore: {
      type: Number,
      required: true,
      default: 0,
    },
    winningTeam: {
      type: String,
      required: false,
      enum: ['Team A', 'Team B', 'Tie', null],
      default: null,
    },
    scoreRanking: {
      type: [
        {
          rank: { type: Number, required: true },
          team: { type: String, required: true, enum: ['Team A', 'Team B'] },
          sessionId: { type: String, required: true },
          finalScore: { type: Number, required: true },
        },
      ],
      required: true,
      default: [],
    },
    teamAGameStatus: {
      type: String,
      required: true,
      enum: ['active', 'lost', 'complete'],
    },
    teamBGameStatus: {
      type: String,
      required: true,
      enum: ['active', 'lost', 'complete'],
    },
    teamAPairStatus: {
      type: String,
      required: true,
      enum: ['active', 'eliminated'],
    },
    teamBPairStatus: {
      type: String,
      required: true,
      enum: ['active', 'eliminated'],
    },
    gameEndTimestamp: {
      type: Date,
      required: false,
    },
    pairStatus: {
      type: String,
      required: true,
      enum: ['active', 'team_a_eliminated', 'team_b_eliminated', 'completed'],
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
pairScoreSchema.index({ pairId: 1 });
pairScoreSchema.index({ averagePairHealth: -1 }); // For ranking queries
pairScoreSchema.index({ gameEndTimestamp: -1 });

export default mongoose.model<IPairScore>('PairScore', pairScoreSchema);
