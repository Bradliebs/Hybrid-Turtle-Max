'use client';

/**
 * DEPENDENCIES
 * Consumed by: src/app/dashboard/page.tsx
 * Consumes: src/components/review/ReviewMetricCard.tsx, src/components/review/ReviewStatusBadge.tsx, src/lib/api-client.ts, src/lib/utils.ts
 * Risk-sensitive: NO
 * Last modified: 2026-03-08
 * Notes: Phase 9 dashboard block showing the nightly-review counts required by BUILD-ORDER.
 */
import { useEffect, useState } from 'react';
import ReviewMetricCard from '@/components/review/ReviewMetricCard';
import ReviewStatusBadge from '@/components/review/ReviewStatusBadge';
import { apiRequest } from '@/lib/api-client';
import { formatCurrency, formatDateTime } from '@/lib/utils';
import { Loader2 } from 'lucide-react';
import type { EveningReviewSummary as EveningReviewSummaryData } from '../../../packages/portfolio/src';

interface SummaryResponse {
  summary: EveningReviewSummaryData;
}

export default function EveningReviewSummary() {
  const [summary, setSummary] = useState<EveningReviewSummaryData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function load() {
      try {
        const data = await apiRequest<SummaryResponse>('/api/review/summary');
        if (mounted) {
          setSummary(data.summary);
          setError(null);
        }
      } catch (fetchError) {
        if (mounted) {
          setError(fetchError instanceof Error ? fetchError.message : 'Failed to load evening review summary.');
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
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Evening Review</h3>
          <p className="text-xs text-muted-foreground">
            Phase 9 nightly review summary across portfolio, plans, stops, orders, and data freshness.
          </p>
        </div>
        {summary ? (
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>Broker sync</span>
            <ReviewStatusBadge status={summary.latestBrokerSyncStatus} />
            <span>Data</span>
            <ReviewStatusBadge status={summary.latestDataFreshnessStatus} />
          </div>
        ) : null}
      </div>

      {!summary && !error ? (
        <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-4 py-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin text-primary-400" />
          Loading evening review summary…
        </div>
      ) : null}

      {error ? (
        <div className="rounded-lg border border-loss/30 bg-loss/10 px-4 py-3 text-sm text-loss">{error}</div>
      ) : null}

      {summary ? (
        <>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            <ReviewMetricCard
              label="Account Equity"
              value={summary.accountEquity == null ? 'N/A' : formatCurrency(summary.accountEquity, summary.currency)}
              detail={`Cash ${summary.cash == null ? 'N/A' : formatCurrency(summary.cash, summary.currency)}`}
              href="/portfolio/positions"
            />
            <ReviewMetricCard
              label="Open Risk"
              value={formatCurrency(summary.openRisk, summary.currency)}
              detail={`${summary.openPositions} open positions`}
              href="/portfolio/positions"
            />
            <ReviewMetricCard
              label="Protection"
              value={`${summary.protectedPositions}/${summary.openPositions}`}
              detail={`${summary.unprotectedPositions} unprotected positions`}
              href="/stops"
            />
            <ReviewMetricCard
              label="Tonight"
              value={`${summary.tonightCandidateCount} candidates`}
              detail={`${summary.tonightApprovedPlanCount} approved plan items`}
              href="/planned-trades"
            />
          </div>

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            <div className="rounded-xl border border-border bg-surface-2 p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Latest Broker Sync</div>
              <div className="mt-2 flex items-center gap-2">
                <ReviewStatusBadge status={summary.latestBrokerSyncStatus} />
              </div>
              <div className="mt-2 text-sm text-muted-foreground">
                {summary.latestBrokerSyncAt ? formatDateTime(summary.latestBrokerSyncAt) : 'No broker sync recorded yet.'}
              </div>
            </div>

            <div className="rounded-xl border border-border bg-surface-2 p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Data Freshness</div>
              <div className="mt-2 flex items-center gap-2">
                <ReviewStatusBadge status={summary.latestDataFreshnessStatus} />
              </div>
              <div className="mt-2 text-sm text-muted-foreground">
                {summary.latestDataRefreshAt ? formatDateTime(summary.latestDataRefreshAt) : 'No market-data refresh recorded yet.'}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">{summary.staleSymbolCount} stale symbols flagged</div>
            </div>

            <div className="rounded-xl border border-border bg-surface-2 p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Review Links</div>
              <div className="mt-3 flex flex-wrap gap-2 text-xs font-medium">
                <a href="/candidates" className="rounded-full border border-border px-3 py-1.5 text-foreground hover:bg-navy-700">Candidates</a>
                <a href="/planned-trades" className="rounded-full border border-border px-3 py-1.5 text-foreground hover:bg-navy-700">Planned Trades</a>
                <a href="/stops" className="rounded-full border border-border px-3 py-1.5 text-foreground hover:bg-navy-700">Stops</a>
                <a href="/orders" className="rounded-full border border-border px-3 py-1.5 text-foreground hover:bg-navy-700">Orders</a>
                <a href="/jobs" className="rounded-full border border-border px-3 py-1.5 text-foreground hover:bg-navy-700">Jobs & Logs</a>
              </div>
            </div>
          </div>
        </>
      ) : null}
    </section>
  );
}