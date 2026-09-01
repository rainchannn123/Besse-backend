import mongoose, { Document, Schema } from 'mongoose';

export interface IIdempotencyRequest extends Document {
  actorId: string;
  scope: string;
  key: string;
  requestFingerprint: string;
  status: 'in_progress' | 'completed';
  responseStatusCode?: number;
  responseBody?: Record<string, unknown>;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const idempotencyRequestSchema = new Schema<IIdempotencyRequest>(
  {
    actorId: { type: String, required: true, index: true },
    scope: { type: String, required: true, index: true },
    key: { type: String, required: true },
    requestFingerprint: { type: String, required: true },
    status: {
      type: String,
      enum: ['in_progress', 'completed'],
      default: 'in_progress',
      index: true,
    },
    responseStatusCode: { type: Number },
    responseBody: { type: Schema.Types.Mixed },
    expiresAt: { type: Date, required: true, index: true },
  },
  {
    timestamps: true,
    collection: 'idempotency_requests',
  }
);

idempotencyRequestSchema.index({ actorId: 1, scope: 1, key: 1 }, { unique: true });
idempotencyRequestSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const IdempotencyRequest = mongoose.model<IIdempotencyRequest>(
  'IdempotencyRequest',
  idempotencyRequestSchema
);

export default IdempotencyRequest;
