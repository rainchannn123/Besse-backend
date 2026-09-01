import { randomUUID } from 'crypto';
import os from 'os';
import SchedulerLease from '../models/SchedulerLease';
import { logger } from '../utils/logger';

export class SchedulerLeaseService {
  private static readonly instanceId = `${os.hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
  private static readonly inFlightJobs = new Set<string>();

  private static getRenewIntervalMs(leaseMs: number): number {
    const target = Math.floor(leaseMs / 3);
    return Math.max(500, Math.min(5_000, target));
  }

  private static async tryAcquireLease(jobName: string, leaseMs: number): Promise<boolean> {
    const now = new Date();
    const leaseUntil = new Date(now.getTime() + leaseMs);

    const existing = await SchedulerLease.findOneAndUpdate(
      {
        jobName,
        $or: [{ leaseUntil: { $lte: now } }, { holderId: this.instanceId }],
      },
      {
        $set: {
          holderId: this.instanceId,
          leaseUntil,
          lastHeartbeatAt: now,
        },
      },
      {
        new: true,
      }
    ).lean();

    if (existing) {
      return true;
    }

    try {
      await SchedulerLease.create({
        jobName,
        holderId: this.instanceId,
        leaseUntil,
        lastHeartbeatAt: now,
      });
      return true;
    } catch (error: any) {
      if (error?.code !== 11000) {
        logger.error(`[SchedulerLease] Failed to acquire lease for '${jobName}'`, error);
      }
      return false;
    }
  }

  private static async renewLease(jobName: string, leaseMs: number): Promise<boolean> {
    const now = new Date();
    const leaseUntil = new Date(now.getTime() + leaseMs);

    const result = await SchedulerLease.updateOne(
      {
        jobName,
        holderId: this.instanceId,
      },
      {
        $set: {
          leaseUntil,
          lastHeartbeatAt: now,
        },
      }
    );

    return result.modifiedCount > 0;
  }

  private static async releaseLease(jobName: string): Promise<void> {
    const now = new Date();

    await SchedulerLease.updateOne(
      {
        jobName,
        holderId: this.instanceId,
      },
      {
        $set: {
          leaseUntil: now,
          lastHeartbeatAt: now,
        },
      }
    );
  }

  static async runSingletonJob(
    jobName: string,
    leaseMs: number,
    job: () => Promise<void>
  ): Promise<boolean> {
    if (this.inFlightJobs.has(jobName)) {
      return false;
    }

    const leaseAcquired = await this.tryAcquireLease(jobName, Math.max(1000, leaseMs));
    if (!leaseAcquired) {
      return false;
    }

    this.inFlightJobs.add(jobName);

    let renewTimer: NodeJS.Timeout | null = null;
    let leaseValid = true;

    const renewIntervalMs = this.getRenewIntervalMs(leaseMs);

    renewTimer = setInterval(() => {
      void (async () => {
        try {
          const renewed = await this.renewLease(jobName, leaseMs);
          if (!renewed) {
            leaseValid = false;
            logger.warn(
              `[SchedulerLease] Lost lease for '${jobName}' while job is running (holder=${this.instanceId})`
            );
          }
        } catch (error) {
          leaseValid = false;
          logger.error(`[SchedulerLease] Failed lease heartbeat for '${jobName}'`, error);
        }
      })();
    }, renewIntervalMs);

    try {
      await job();

      if (!leaseValid) {
        logger.warn(
          `[SchedulerLease] Job '${jobName}' completed after lease heartbeat failure; another instance may have taken over`
        );
      }

      return true;
    } finally {
      if (renewTimer) {
        clearInterval(renewTimer);
      }

      try {
        await this.releaseLease(jobName);
      } catch (error) {
        logger.error(`[SchedulerLease] Failed to release lease for '${jobName}'`, error);
      }

      this.inFlightJobs.delete(jobName);
    }
  }
}
