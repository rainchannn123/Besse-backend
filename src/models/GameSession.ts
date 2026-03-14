import mongoose, { Document, Schema } from 'mongoose';
import { GameState } from '../types';

export interface IGameSession extends Document {
  sessionId: string;
  gameState: GameState;
  players: {
    municipality: mongoose.Types.ObjectId;
    mrf: mongoose.Types.ObjectId;
    broker: mongoose.Types.ObjectId;
  };
  playerNames: {
    municipality: string;
    mrf: string;
    broker: string;
  };
  createdAt: Date;
  updatedAt: Date;
}

const gameSessionSchema = new Schema<IGameSession>(
  {
    sessionId: {
      type: String,
      required: true,
      unique: true,
    },
    gameState: {
      type: Schema.Types.Mixed,
      required: true,
    },
    players: {
      municipality: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true,
      },
      mrf: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true,
      },
      broker: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true,
      },
    },
    playerNames: {
      municipality: {
        type: String,
        required: true,
      },
      mrf: {
        type: String,
        required: true,
      },
      broker: {
        type: String,
        required: true,
      },
    },
  },
  {
    timestamps: true,
  }
);

// Indexes - REMOVE the sessionId index since unique: true already creates it
// gameSessionSchema.index({ sessionId: 1 }); // ← COMMENT OUT OR DELETE THIS LINE

// Keep these other indexes
gameSessionSchema.index({ createdAt: -1 });
gameSessionSchema.index({ 'players.municipality': 1 });
gameSessionSchema.index({ 'players.mrf': 1 });
gameSessionSchema.index({ 'players.broker': 1 });

export default mongoose.model<IGameSession>('GameSession', gameSessionSchema);
