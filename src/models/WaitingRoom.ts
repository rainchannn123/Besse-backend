import mongoose, { Document, Schema } from 'mongoose';

export interface IWaitingRoom extends Document {
  roomCode: string;           // 6-character unique code
  createdAt: Date;
  updatedAt: Date;
  teams: {
    sessionId: string;        // Lobby session ID of the team
    teamRole: 'Team A' | 'Team B';
    isReady: boolean;
    teamName: string;         // Name of the team (from lobby)
    players: {
      userId: string;
      name: string;
      role: string | null;
    }[];
  }[];
  status: 'waiting' | 'ready' | 'in-progress' | 'completed';
  gameSessionId?: string;     // When game starts, store the game session ID
}

const waitingRoomSchema = new Schema<IWaitingRoom>(
  {
    roomCode: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      length: 6,
    },
    teams: [
      {
        sessionId: { type: String, required: true },
        teamRole: { type: String, enum: ['Team A', 'Team B'], required: true },
        isReady: { type: Boolean, default: false },
        teamName: { type: String, required: true },
        players: [
          {
            userId: { type: String, required: true },
            name: { type: String, required: true },
            role: { type: String, default: null },
          },
        ],
      },
    ],
    status: {
      type: String,
      enum: ['waiting', 'ready', 'in-progress', 'completed'],
      default: 'waiting',
    },
    gameSessionId: { type: String, default: null },
  },
  {
    timestamps: true,
  }
);

// Index for faster lookups
waitingRoomSchema.index({ roomCode: 1 });
waitingRoomSchema.index({ status: 1 });
waitingRoomSchema.index({ 'teams.sessionId': 1 });

export default mongoose.model<IWaitingRoom>('WaitingRoom', waitingRoomSchema);