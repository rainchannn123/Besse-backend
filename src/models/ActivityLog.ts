import mongoose, { Document, Schema } from 'mongoose';

export type ActivityCategory =
  | 'auth'
  | 'lobby'
  | 'matchmaking'
  | 'game'
  | 'municipality'
  | 'mrf'
  | 'broker'
  | 'admin'
  | 'system';

export type ActivityStatus = 'success' | 'failure';

export interface IActivityLog extends Document {
  userId: mongoose.Types.ObjectId | null;
  userName: string | null;
  userEmail: string | null;
  accountType: string | null;
  role: string | null;
  category: ActivityCategory;
  action: string;
  description: string;
  sessionId: string | null;
  targetUserId: string | null;
  targetUserName: string | null;
  status: ActivityStatus;
  statusCode: number | null;
  method: string | null;
  route: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  metadata: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

const activityLogSchema = new Schema<IActivityLog>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
    userName: { type: String, default: null },
    userEmail: { type: String, default: null, index: true },
    accountType: { type: String, default: null },
    role: { type: String, default: null },
    category: {
      type: String,
      enum: [
        'auth',
        'lobby',
        'matchmaking',
        'game',
        'municipality',
        'mrf',
        'broker',
        'admin',
        'system',
      ],
      required: true,
      index: true,
    },
    action: { type: String, required: true, index: true },
    description: { type: String, required: true },
    sessionId: { type: String, default: null, index: true },
    targetUserId: { type: String, default: null },
    targetUserName: { type: String, default: null },
    status: {
      type: String,
      enum: ['success', 'failure'],
      default: 'success',
      index: true,
    },
    statusCode: { type: Number, default: null },
    method: { type: String, default: null },
    route: { type: String, default: null },
    ipAddress: { type: String, default: null },
    userAgent: { type: String, default: null },
    metadata: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

activityLogSchema.index({ createdAt: -1 });
activityLogSchema.index({ category: 1, createdAt: -1 });
activityLogSchema.index({ userId: 1, createdAt: -1 });
activityLogSchema.index({ action: 1, createdAt: -1 });

export default mongoose.model<IActivityLog>('ActivityLog', activityLogSchema);
