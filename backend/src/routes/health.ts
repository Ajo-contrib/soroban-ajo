import { Router } from 'express';
import os from 'os';
import { execSync } from 'child_process';
import { HealthCheckService } from '../services/healthCheck';
import { register } from '../services/metricsService';
import { healthMonitor } from '../monitoring/healthMonitor';
import { alertingService, AlertSeverity } from '../monitoring/alerting';

const router = Router();
const healthCheck = new HealthCheckService();

/** GET /health — basic liveness (no dependency checks) */
router.get('/', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'ajo-backend',
    version: '0.1.0',
  });
});

/** GET /health/live — Kubernetes liveness probe */
router.get('/live', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

/** GET /health/ready — Kubernetes readiness probe */
router.get('/ready', async (_req, res) => {
  const health = await healthCheck.getHealthStatus();
  res.status(health.status === 'healthy' ? 200 : 503).json(health);
});

/** GET /health/detailed — full status: dependencies + system resources */
router.get('/detailed', async (_req, res) => {
  const [health, resources] = await Promise.all([
    healthCheck.getHealthStatus(),
    getSystemResources(),
  ]);

  const snapshot = healthMonitor.getLastSnapshot();

  res.json({
    ...health,
    resources,
    monitor: snapshot
      ? { overall: snapshot.overall, services: snapshot.services }
      : null,
    alerts: {
      active: alertingService.getActiveAlerts().length,
    },
  });
});

/** GET /health/monitor — live monitor snapshot */
router.get('/monitor', (_req, res) => {
  res.json({
    status: healthMonitor.getStatus(),
    snapshot: healthMonitor.getLastSnapshot(),
  });
});

/** GET /health/monitor/alerts/active */
router.get('/monitor/alerts/active', (_req, res) => {
  res.json({ alerts: alertingService.getActiveAlerts() });
});

/** GET /health/monitor/alerts?severity=&service=&activeOnly= */
router.get('/monitor/alerts', (req, res) => {
  const { severity, service, activeOnly } = req.query as Record<string, string>;
  const filter: Parameters<typeof alertingService.getHistory>[0] = {};
  if (severity) filter.severity = severity as AlertSeverity;
  if (service) filter.service = service;
  if (activeOnly === 'true') filter.activeOnly = true;
  const alerts = alertingService.getHistory(filter);
  res.json({ total: alerts.length, alerts });
});

/** GET /health/metrics — Prometheus metrics */
router.get('/metrics', async (_req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});

// ── Helpers ───────────────────────────────────────────────────────────────────

interface SystemResources {
  memory: { totalMb: number; freeMb: number; usedMb: number; usagePercent: number }
  cpu: { loadAvg1m: number; loadAvg5m: number; cores: number }
  disk: { totalGb: number | null; freeGb: number | null; usagePercent: number | null }
  uptime: number
}

function getSystemResources(): SystemResources {
  const totalMem = os.totalmem()
  const freeMem = os.freemem()
  const usedMem = totalMem - freeMem
  const [load1, load5] = os.loadavg()

  let disk: SystemResources['disk'] = { totalGb: null, freeGb: null, usagePercent: null }
  try {
    // Works on Linux/macOS; silently skipped on Windows
    const out = execSync("df -k / | tail -1", { timeout: 2000 }).toString().trim()
    const parts = out.split(/\s+/)
    if (parts.length >= 4) {
      const totalKb = parseInt(parts[1], 10)
      const usedKb = parseInt(parts[2], 10)
      const freeKb = parseInt(parts[3], 10)
      disk = {
        totalGb: Math.round(totalKb / 1024 / 1024 * 100) / 100,
        freeGb: Math.round(freeKb / 1024 / 1024 * 100) / 100,
        usagePercent: Math.round((usedKb / totalKb) * 100),
      }
    }
  } catch { /* non-critical */ }

  return {
    memory: {
      totalMb: Math.round(totalMem / 1024 / 1024),
      freeMb: Math.round(freeMem / 1024 / 1024),
      usedMb: Math.round(usedMem / 1024 / 1024),
      usagePercent: Math.round((usedMem / totalMem) * 100),
    },
    cpu: { loadAvg1m: Math.round(load1 * 100) / 100, loadAvg5m: Math.round(load5 * 100) / 100, cores: os.cpus().length },
    disk,
    uptime: Math.round(os.uptime()),
  }
}

export const healthRouter = router;
