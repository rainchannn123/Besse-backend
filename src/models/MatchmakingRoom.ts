import mongoose, { Document, Schema } from 'mongoose';

export interface IMatchmakingRoom extends Document {
  roomCode: string;
  roomName: string;
  ownerId: mongoose.Types.ObjectId;
  ownerName: string;
  isPrivate: boolean;
  passwordHash?: string;
  isAdminRoom: boolean;
  maxTeams: number;
  teams: Array<{
    teamId: string;
    sessionId: string;
    citySlot: number;
    players: Array<{
      userId: string;
      name: string;
      role: string | null;
      isLeader: boolean;
    }>;
    isReady: boolean;
  }>;
  status: 'waiting' | 'ready' | 'started' | 'completed';
  gameSessionId?: string;
  createdAt: Date;
  updatedAt: Date;
}

const matchmakingRoomSchema = new Schema<IMatchmakingRoom>(
  {
    roomCode: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      length: 6,
      match: /^[A-Z0-9]{6}$/,
    },
    roomName: {
      type: String,
      required: true,
    },
    ownerId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    ownerName: {
      type: String,
      required: true,
    },
    isPrivate: {
      type: Boolean,
      default: false,
    },
    passwordHash: {
      type: String,
      required: false,
    },
    isAdminRoom: {
      type: Boolean,
      default: false,
    },
    maxTeams: {
      type: Number,
      default: 30,
    },
    teams: [
      {
        teamId: {
          type: String,
          required: true,
        },
        sessionId: {
          type: String,
          required: true,
        },
        citySlot: {
          type: Number,
          required: true,
        },
        players: [
          {
            userId: {
              type: String,
              required: true,
            },
            name: {
              type: String,
              required: true,
            },
            role: {
              type: String,
              enum: ['municipality', 'mrf', 'broker', null],
              default: null,
            },
            isLeader: {
              type: Boolean,
              default: false,
            },
          },
        ],
        isReady: {
          type: Boolean,
          default: false,
        },
      },
    ],
    status: {
      type: String,
      enum: ['waiting', 'ready', 'started', 'completed'],
      default: 'waiting',
    },
    gameSessionId: {
      type: String,
      required: false,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
matchmakingRoomSchema.index({ roomCode: 1 });
matchmakingRoomSchema.index({ status: 1 });
matchmakingRoomSchema.index({ 'teams.sessionId': 1 });

export default mongoose.model<IMatchmakingRoom>('MatchmakingRoom', matchmakingRoomSchema);