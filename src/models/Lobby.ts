import mongoose, { Document, Schema } from 'mongoose';
import { LobbyStage } from '../types';

export interface ILobby extends Document {
  sessionId: string;
  lobbyCode: string; // 6-character alphanumeric code for joining
  leader: mongoose.Types.ObjectId; // User ID of the lobby leader
  stage: LobbyStage;
  players: {
    userId: mongoose.Types.ObjectId;
    name: string;
    selectedRole: 'municipality' | 'mrf' | 'broker' | null;
    joinedAt: Date;
  }[];
  status: 'waiting' | 'ready' | 'active' | 'completed';
  // Pairing fields
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
  updatedAt: Date;
  maxPlayers: number;
}

const lobbySchema = new Schema<ILobby>(
  {
    sessionId: {
      type: String,
      required: true,
      unique: true,
    },
    lobbyCode: {
      type: String,
      required: true,
      unique: true,
      minlength: 6,
      maxlength: 6,
      match: /^[A-Z0-9]{6}$/,
    },
    leader: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    stage: {
      type: String,
      enum: ['waiting-room', 'role-selection', 'pairing', 'in-game', 'completed'],
      default: 'waiting-room',
    },
    players: [
      {
        userId: {
          type: Schema.Types.ObjectId,
          ref: 'User',
          required: true,
        },
        name: {
          type: String,
          required: true,
        },
        selectedRole: {
          type: String,
          enum: ['municipality', 'mrf', 'broker', null],
          default: null,
        },
        joinedAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    status: {
      type: String,
      enum: ['waiting', 'ready', 'active', 'completed'],
      default: 'waiting',
    },
    maxPlayers: {
      type: Number,
      default: 3,
    },
    // Pairing metadata (optional)
    pairId: {
      type: String,
      default: null,
    },
    partnerSessionId: {
      type: String,
      default: null,
    },
    teamRole: {
      type: String,
      enum: ['Team A', 'Team B', null],
      default: null,
    },
    pairStatus: {
      type: String,
      enum: [
        'active',
        'team_a_eliminated',
        'team_b_eliminated',
        'completed',
        null,
      ],
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes - REMOVE the sessionId index since unique: true already creates it
// lobbySchema.index({ sessionId: 1 }); // ← DELETE or COMMENT OUT THIS LINE

// Keep these other indexes
lobbySchema.index({ status: 1 });
lobbySchema.index({ createdAt: 1 });

export default mongoose.model<ILobby>('Lobby', lobbySchema);
