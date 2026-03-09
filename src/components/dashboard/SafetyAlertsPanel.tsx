'use client';

/**
 * DEPENDENCIES
 * Consumed by: src/app/dashboard/page.tsx
 * Consumes: /api/alerts/active, src/components/review/ReviewStatusBadge.tsx, src/lib/api-client.ts
 * Risk-sensitive: NO
 * Last modified: 2026-03-09
 * Notes: Dashboard panel for Phase 10 active safety alerts.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { apiRequest } from '@/lib/api-client';
import ReviewStatusBadge from '@/components/review/ReviewStatusBadge';
import type { SafetyAlertSnapshot } from '@/lib/safety-alerts';

export default function SafetyAlertsPanel() {
  const [snapshot, setSnapshot] = useState<SafetyAlertSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function load() {
      try {
        const data = await apiRequest<SafetyAlertSnapshot>('/api/alerts/active?sync=true');
        if (mounted) {
          setSnapshot(data);
        }
      } catch (fetchError) {
        if (mounted) {
          setError(fetchError instanceof Error ? fetchError.message : 'Failed to load safety alerts.');
        }
      }
    }

    load();
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <section className="card-surface p-4 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-loss" />
            Safety Alerts
          </h3>
          <p className="text-xs text-muted-foreground">Active Phase 10 dangerous states and kill-switch context.</p>
        </div>
        {snapshot ? <ReviewStatusBadge status={snapshot.summary.critical > 0 ? 'FAILED' : snapshot.summary.warning > 0 ? 'PARTIAL' : 'SUCCEEDED'} /> : null}
      </div>

      {!snapshot && !error ? (
        <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-4 py-4 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin text-primary-400" />
          Loading safety alerts…
        </div>
      ) : null}

      {error ? <div className="rounded-lg border border-loss/30 bg-loss/10 px-4 py-3 text-sm text-loss">{error}</div> : null}

      {snapshot ? (
        <>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="rounded-xl border border-border bg-surface-2 p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Critical</div>
              <div className="mt-2 text-2xl font-bold text-loss">{snapshot.summary.critical}</div>
            </div>
            <div className="rounded-xl border border-border bg-surface-2 p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Warning</div>
              <div className="mt-2 text-2xl font-bold text-warning">{snapshot.summary.warning}</div>
            </div>
            <div className="rounded-xl border border-border bg-surface-2 p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Kill Switches</div>
              <div className="mt-2 text-sm text-foreground">
                {snapshot.killSwitches.disableAllSubmissions || snapshot.killSwitches.disableAutomatedSubmissions || snapshot.killSwitches.disableScansWhenDataStale
                  ? 'Configured'
                  : 'Defaults'}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">Review or change in Settings.</div>
            </div>
          </div>

          <div className="space-y-2">
            {snapshot.alerts.slice(0, 4).map((alert) => (
              <div key={alert.kind} className="rounded-lg border border-border bg-surface-2 px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-foreground">{alert.title}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{alert.message}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <ReviewStatusBadge status={alert.severity} />
                    <Link href={alert.actionHref} className="text-xs text-primary-400 hover:text-primary-300">
                      Review
                    </Link>
                  </div>
                </div>
              </div>
            ))}
            {snapshot.alerts.length === 0 ? (
              <div className="rounded-lg border border-profit/30 bg-profit/10 px-4 py-3 text-sm text-profit">
                No active safety alerts. The current safety state is clear.
              </div>
            ) : null}
          </div>

          <div className="flex items-center gap-4 text-xs">
            <Link href="/alerts" className="text-primary-400 hover:text-primary-300">Open alerts page</Link>
            <Link href="/settings" className="text-primary-400 hover:text-primary-300">Open safety controls</Link>
          </div>
        </>
      ) : null}
    </section>
  );
}