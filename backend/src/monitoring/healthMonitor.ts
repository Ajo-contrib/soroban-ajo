/**
 * healthMonitor.ts
 * Periodic health monitoring: polls dependencies, tracks consecutive failures,
 * fires severity-graded alerts (WARNING on slow response, CRITICAL on down),
 * and updates Prometheus gauges.
 */
import os from 'os';
import { HealthCheckService } from '../services/healthCheck';
import { AlertingService, AlertSeverity } from './alerting';
import {
  serviceHealthGauge,
  serviceResponseTimeMs,
  serviceConsecutiveFailures,
  responseTimeThresholdBreached,
  snapshotSystemMetrics,
} from './metricsCollector';
import { createModuleLogger } from '../utils/logger';

const logger = createModuleLogger('HealthMonitor');

export interface ServiceCheckResult {
  name: string;
  status: 'up' | 'down';
  responseTime?: number;
  consecutiveFailures: number;
  error?: string;
}

export interface MonitorSnapshot {
  timestamp: string;
  overall: 'healthy' | 'degraded' | 'unhealthy';
  services: ServiceCheckResult[];
  uptime: number;
  memoryMb: number;
}

/** Response time (ms) above which a WARNING alert fires. Per-service overrides supported. */
const DEFAULT_SLOW_THRESHOLD_MS = 1000;

const SLOW_THRESHOLDS: Record<string, number> = {
  database: 500,
  redis: 100,
  stellar: 2000,
  email: 3000,
};

function slowThreshold(service: string): number {
  return SLOW_THRESHOLDS[service] ?? DEFAULT_SLOW_THRESHOLD_MS;
}

const MEMORY_WARNING_PERCENT = parseInt(process.env.MEMORY_WARNING_PERCENT ?? '80', 10);
const MEMORY_CRITICAL_PERCENT = parseInt(process.env.MEMORY_CRITICAL_PERCENT ?? '90', 10);

export class HealthMonitor {
  private readonly healthCheck: HealthCheckService;
  private readonly alerting: AlertingService;
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private lastSnapshot: MonitorSnapshot | null = null;

  /** Tracks consecutive failures per service name. */
  private readonly failureCounts = new Map<string, number>();

  private readonly pollIntervalMs: number;

  constructor(
    pollIntervalMs = 30_000,
    healthCheck = new HealthCheckService(),
    alerting = new AlertingService(),
  ) {
    this.pollIntervalMs = pollIntervalMs;
    this.healthCheck = healthCheck;
    this.alerting = alerting;
  }

  /** Start the background polling loop. */
  start(): void {
    if (this.intervalHandle) return;
    logger.info('HealthMonitor started', { pollIntervalMs: this.pollIntervalMs });
    void this.runChecks();
    this.intervalHandle = setInterval(() => void this.runChecks(), this.pollIntervalMs);
  }

  /** Stop the polling loop. */
  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
      logger.info('HealthMonitor stopped');
    }
  }

  getLastSnapshot(): MonitorSnapshot | null {
    return this.lastSnapshot;
  }

  /** Quick summary suitable for a status page. */
  getStatus(): { overall: string; uptime: number } | null {
    if (!this.lastSnapshot) return null;
    return {
      overall: this.lastSnapshot.overall,
      uptime: this.lastSnapshot.uptime,
    };
  }

  /** Run all checks once, update metrics, fire alerts, return snapshot. */
  async runChecks(): Promise<MonitorSnapshot> {
    try {
      const health = await this.healthCheck.getHealthStatus();
      await snapshotSystemMetrics();

      const services: ServiceCheckResult[] = await Promise.all(
        Object.entries(health.checks).map(async ([name, result]) => {
          const prev = this.failureCounts.get(name) ?? 0;
          const failures = result.status === 'down' ? prev + 1 : 0;
          this.failureCounts.set(name, failures);

          // Update Prometheus
          serviceHealthGauge.set({ service: name }, result.status === 'up' ? 1 : 0);
          serviceConsecutiveFailures.set({ service: name }, failures);
          if (result.responseTime !== undefined) {
            serviceResponseTimeMs.set({ service: name }, result.responseTime);
          }

          // CRITICAL alert: service is down
          if (result.status === 'down') {
            await this.alerting.fire({
              severity: AlertSeverity.CRITICAL,
              service: name,
              message: `Dependency "${name}" is DOWN (${failures} consecutive failure${failures !== 1 ? 's' : ''})`,
              details: result.error,
            });
          } else {
            // Resolve any active critical alert when service recovers
            this.alerting.resolve(name, AlertSeverity.CRITICAL);

            // WARNING alert: slow response time
            const threshold = slowThreshold(name);
            if (result.responseTime !== undefined && result.responseTime > threshold) {
              responseTimeThresholdBreached.inc({ service: name });
              await this.alerting.fire({
                severity: AlertSeverity.WARNING,
                service: name,
                message: `Dependency "${name}" is slow: ${result.responseTime}ms (threshold: ${threshold}ms)`,
              });
            }
          }

          return { name, ...result, consecutiveFailures: failures };
        }),
      );

      // ── Resource threshold alerts ──────────────────────────────────────────
      const memUsedPercent = Math.round(((os.totalmem() - os.freemem()) / os.totalmem()) * 100);
      if (memUsedPercent >= MEMORY_CRITICAL_PERCENT) {
        await this.alerting.fire({
          severity: AlertSeverity.CRITICAL,
          service: 'system',
          message: `Memory usage critical: ${memUsedPercent}% (threshold: ${MEMORY_CRITICAL_PERCENT}%)`,
        });
      } else if (memUsedPercent >= MEMORY_WARNING_PERCENT) {
        await this.alerting.fire({
          severity: AlertSeverity.WARNING,
          service: 'system',
          message: `Memory usage high: ${memUsedPercent}% (threshold: ${MEMORY_WARNING_PERCENT}%)`,
        });
      }

      const snapshot: MonitorSnapshot = {
        timestamp: health.timestamp,
        overall: health.status,
        services,
        uptime: health.uptime,
        memoryMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      };

      this.lastSnapshot = snapshot;
      logger.debug('Health check completed', { overall: snapshot.overall });
      return snapshot;
    } catch (err) {
      logger.error('HealthMonitor runChecks failed', { error: err });
      throw err;
    }
  }
}

export const healthMonitor = new HealthMonitor();
