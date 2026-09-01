import mongoose, { Document, Schema } from 'mongoose';

export interface IPlayerGameResult extends Document {
  userId: string;
  roomCode: string;
  teamSessionId: string;
  teamId: string;
  roleInGame: 'municipality' | 'mrf' | 'broker';
  playerName: string;
  rank: number;
  city: number;
  teamName: string;
  score: number;
  budget: number;
  health: number;
  status: string;
  recordedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const playerGameResultSchema = new Schema<IPlayerGameResult>(
  {
    userId: { type: String, required: true, index: true },
    roomCode: { type: String, required: true, index: true },
    teamSessionId: { type: String, required: true, index: true },
    teamId: { type: String, required: true },
    roleInGame: {
      type: String,
      enum: ['municipality', 'mrf', 'broker'],
      required: true,
    },
    playerName: { type: String, required: true },
    rank: { type: Number, required: true },
    city: { type: Number, required: true },
    teamName: { type: String, required: true },
    score: { type: Number, required: true },
    budget: { type: Number, required: true },
    health: { type: Number, required: true },
    status: { type: String, required: true },
    recordedAt: { type: Date, required: true, index: true },
  },
  {
    timestamps: true,
    collection: 'player_game_results',
  }
);

playerGameResultSchema.index(
  { roomCode: 1, teamSessionId: 1, userId: 1, roleInGame: 1 },
  { unique: true }
);
playerGameResultSchema.index({ userId: 1, recordedAt: -1 });

const PlayerGameResult = mongoose.model<IPlayerGameResult>(
  'PlayerGameResult',
  playerGameResultSchema
);

export default PlayerGameResult;
