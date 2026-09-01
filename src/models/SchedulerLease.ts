import mongoose, { Document, Schema } from 'mongoose';

export interface ISchedulerLease extends Document {
  jobName: string;
  holderId: string;
  leaseUntil: Date;
  lastHeartbeatAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const schedulerLeaseSchema = new Schema<ISchedulerLease>(
  {
    jobName: { type: String, required: true, unique: true, index: true },
    holderId: { type: String, required: true, index: true },
    leaseUntil: { type: Date, required: true, index: true },
    lastHeartbeatAt: { type: Date, required: true },
  },
  {
    timestamps: true,
    collection: 'scheduler_leases',
  }
);

const SchedulerLease = mongoose.model<ISchedulerLease>('SchedulerLease', schedulerLeaseSchema);

export default SchedulerLease;
