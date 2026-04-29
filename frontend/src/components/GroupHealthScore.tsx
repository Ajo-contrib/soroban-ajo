'use client';

import React, { useEffect, useState } from 'react';

type HealthRating = 'excellent' | 'good' | 'fair' | 'poor' | 'critical';

interface HealthBreakdown {
  contributionRate: number;
  memberActivity: number;
  payoutProgress: number;
  penaltyImpact: number;
}

interface HealthData {
  score: number;
  rating: HealthRating;
  breakdown: HealthBreakdown;
  warnings: string[];
}

interface GroupHealthScoreProps {
  groupId: string;
  apiUrl: string;
  /** Poll interval in ms (default 30 s) */
  pollInterval?: number;
}

const RATING_CONFIG: Record<HealthRating, { label: string; color: string; ring: string }> = {
  excellent: { label: 'Excellent', color: 'text-green-600 dark:text-green-400', ring: 'bg-green-500' },
  good: { label: 'Good', color: 'text-blue-600 dark:text-blue-400', ring: 'bg-blue-500' },
  fair: { label: 'Fair', color: 'text-yellow-600 dark:text-yellow-400', ring: 'bg-yellow-500' },
  poor: { label: 'Poor', color: 'text-orange-600 dark:text-orange-400', ring: 'bg-orange-500' },
  critical: { label: 'Critical', color: 'text-red-600 dark:text-red-400', ring: 'bg-red-500' },
};

const BREAKDOWN_LABELS: Record<keyof HealthBreakdown, string> = {
  contributionRate: 'Contribution Rate',
  memberActivity: 'Member Activity',
  payoutProgress: 'Payout Progress',
  penaltyImpact: 'Penalty Impact',
};

export default function GroupHealthScore({
  groupId,
  apiUrl,
  pollInterval = 30_000,
}: GroupHealthScoreProps) {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function fetchHealth() {
    try {
      const res = await fetch(`${apiUrl}/groups/${groupId}/health`);
      if (!res.ok) throw new Error('Failed to fetch health score');
      setHealth(await res.json());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchHealth();
    const id = setInterval(fetchHealth, pollInterval);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, pollInterval]);

  if (loading) {
    return (
      <div className="animate-pulse rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
        <div className="h-4 w-32 rounded bg-gray-200 dark:bg-gray-700" />
        <div className="mt-3 h-16 rounded bg-gray-200 dark:bg-gray-700" />
      </div>
    );
  }

  if (error || !health) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
        {error ?? 'Unable to load health score.'}
      </div>
    );
  }

  const cfg = RATING_CONFIG[health.rating];

  return (
    <div className="space-y-4">
      {/* Score card */}
      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
              Group Health
            </p>
            <p className={`mt-1 text-3xl font-bold ${cfg.color}`}>{health.score}</p>
            <p className={`text-sm font-medium ${cfg.color}`}>{cfg.label}</p>
          </div>

          {/* Circular indicator */}
          <div className="relative h-16 w-16">
            <svg viewBox="0 0 36 36" className="h-full w-full -rotate-90">
              <circle cx="18" cy="18" r="15.9" fill="none" stroke="#e5e7eb" strokeWidth="3" />
              <circle
                cx="18"
                cy="18"
                r="15.9"
                fill="none"
                strokeWidth="3"
                strokeDasharray={`${health.score} ${100 - health.score}`}
                strokeLinecap="round"
                className={cfg.ring.replace('bg-', 'stroke-')}
              />
            </svg>
            <span className="absolute inset-0 flex items-center justify-center text-xs font-bold text-gray-700 dark:text-gray-200">
              {health.score}
            </span>
          </div>
        </div>
      </div>

      {/* Breakdown */}
      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <h4 className="mb-3 text-sm font-semibold text-gray-900 dark:text-white">Breakdown</h4>
        <ul className="space-y-2">
          {(Object.keys(health.breakdown) as Array<keyof HealthBreakdown>).map((key) => {
            const val = health.breakdown[key];
            return (
              <li key={key}>
                <div className="mb-0.5 flex justify-between text-xs text-gray-600 dark:text-gray-400">
                  <span>{BREAKDOWN_LABELS[key]}</span>
                  <span>{val}%</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                  <div
                    className="h-full rounded-full bg-blue-500 transition-all"
                    style={{ width: `${val}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      {/* Warnings */}
      {health.warnings.length > 0 && (
        <div className="rounded-xl border border-yellow-200 bg-yellow-50 p-4 dark:border-yellow-800 dark:bg-yellow-900/20">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-yellow-700 dark:text-yellow-400">
            ⚠ Warnings
          </p>
          <ul className="space-y-1">
            {health.warnings.map((w, i) => (
              <li key={i} className="text-xs text-yellow-700 dark:text-yellow-400">
                • {w}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
