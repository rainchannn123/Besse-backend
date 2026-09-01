type HttpSample = {
  timestamp: number;
  durationMs: number;
  statusCode: number;
  method: string;
  route: string;
};

type SocketEventSample = {
  timestamp: number;
  event: string;
  channel: 'game' | 'matchmaking' | 'all';
  dropped: boolean;
};

type IdempotencyEvent = {
  timestamp: number;
  outcome:
    | 'new_request'
    | 'replay'
    | 'in_progress_conflict'
    | 'payload_mismatch'
    | 'duplicate_key_race';
};

const ROLLING_WINDOW_MS = 5 * 60 * 1000;

const percentile = (sortedValues: number[], p: number): number => {
  if (sortedValues.length === 0) return 0;
  const index = Math.min(sortedValues.length - 1, Math.max(0, Math.ceil((p / 100) * sortedValues.length) - 1));
  return sortedValues[index];
};

export class ObservabilityService {
  private static httpSamples: HttpSample[] = [];
  private static socketEvents: SocketEventSample[] = [];
  private static idempotencyEvents: IdempotencyEvent[] = [];
  private static socketConnectionCount = 0;
  private static socketDisconnectCount = 0;

  private static pruneOldEntries(now: number): void {
    const threshold = now - ROLLING_WINDOW_MS;
    this.httpSamples = this.httpSamples.filter((item) => item.timestamp >= threshold);
    this.socketEvents = this.socketEvents.filter((item) => item.timestamp >= threshold);
    this.idempotencyEvents = this.idempotencyEvents.filter((item) => item.timestamp >= threshold);
  }

  static recordHttpRequest(sample: Omit<HttpSample, 'timestamp'>): void {
    const now = Date.now();
    this.httpSamples.push({ ...sample, timestamp: now });
    this.pruneOldEntries(now);
  }

  static recordSocketConnection(): void {
    this.socketConnectionCount += 1;
  }

  static recordSocketDisconnection(): void {
    this.socketDisconnectCount += 1;
  }

  static recordSocketEvent(event: Omit<SocketEventSample, 'timestamp'>): void {
    const now = Date.now();
    this.socketEvents.push({ ...event, timestamp: now });
    this.pruneOldEntries(now);
  }

  static recordIdempotencyOutcome(outcome: IdempotencyEvent['outcome']): void {
    const now = Date.now();
    this.idempotencyEvents.push({ timestamp: now, outcome });
    this.pruneOldEntries(now);
  }

  private static summarizeHttp() {
    const durations = this.httpSamples.map((item) => item.durationMs).sort((a, b) => a - b);
    const total = this.httpSamples.length;
    const errors = this.httpSamples.filter((item) => item.statusCode >= 500).length;
    const clientErrors = this.httpSamples.filter((item) => item.statusCode >= 400 && item.statusCode < 500).length;

    return {
      total,
      p50Ms: percentile(durations, 50),
      p95Ms: percentile(durations, 95),
      p99Ms: percentile(durations, 99),
      errorRate: total > 0 ? errors / total : 0,
      clientErrorRate: total > 0 ? clientErrors / total : 0,
    };
  }

  private static summarizeSocket() {
    const emitted = this.socketEvents.filter((item) => !item.dropped).length;
    const dropped = this.socketEvents.filter((item) => item.dropped).length;
    const total = emitted + dropped;

    return {
      emitted,
      dropped,
      dropRate: total > 0 ? dropped / total : 0,
      connectCount: this.socketConnectionCount,
      disconnectCount: this.socketDisconnectCount,
    };
  }

  private static summarizeIdempotency() {
    const total = this.idempotencyEvents.length;
    const byOutcome = this.idempotencyEvents.reduce<Record<string, number>>((acc, item) => {
      acc[item.outcome] = (acc[item.outcome] || 0) + 1;
      return acc;
    }, {});

    return {
      total,
      byOutcome,
      replayRate: total > 0 ? (byOutcome.replay || 0) / total : 0,
    };
  }

  static getMetricsSnapshot() {
    const now = Date.now();
    this.pruneOldEntries(now);

    return {
      generatedAt: new Date(now).toISOString(),
      windowMs: ROLLING_WINDOW_MS,
      http: this.summarizeHttp(),
      websocket: this.summarizeSocket(),
      idempotency: this.summarizeIdempotency(),
    };
  }

  static getSloStatus() {
    const metrics = this.getMetricsSnapshot();
    const checks = {
      httpP95WithinTarget: {
        targetMs: 1200,
        actualMs: metrics.http.p95Ms,
        pass: metrics.http.p95Ms <= 1200,
      },
      httpServerErrorRate: {
        targetMax: 0.01,
        actual: metrics.http.errorRate,
        pass: metrics.http.errorRate <= 0.01,
      },
      websocketDropRate: {
        targetMax: 0.01,
        actual: metrics.websocket.dropRate,
        pass: metrics.websocket.dropRate <= 0.01,
      },
    };

    const overallPass = Object.values(checks).every((check) => check.pass);

    return {
      overallPass,
      checks,
      metrics,
    };
  }
}
