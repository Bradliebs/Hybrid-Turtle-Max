/**
 * DEPENDENCIES
 * Consumed by: src/app/planned-trades/page.tsx, src/app/stops/page.tsx, src/app/orders/page.tsx, src/app/jobs/page.tsx, src/components/dashboard/EveningReviewSummary.tsx
 * Consumes: src/lib/utils.ts
 * Risk-sensitive: NO
 * Last modified: 2026-03-08
 * Notes: Shared badge mapping for Phase 9 review surfaces.
 */
import { cn } from '@/lib/utils';

const toneMap: Record<string, string> = {
  FRESH: 'bg-profit/15 text-profit border border-profit/30',
  SUCCEEDED: 'bg-profit/15 text-profit border border-profit/30',
  ACTIVE: 'bg-profit/15 text-profit border border-profit/30',
  APPROVED: 'bg-profit/15 text-profit border border-profit/30',
  READY: 'bg-profit/15 text-profit border border-profit/30',
  FILLED: 'bg-profit/15 text-profit border border-profit/30',
  CLEAR: 'bg-profit/15 text-profit border border-profit/30',
  PARTIAL: 'bg-warning/15 text-warning border border-warning/30',
  RUNNING: 'bg-warning/15 text-warning border border-warning/30',
  PENDING: 'bg-warning/15 text-warning border border-warning/30',
  SUBMITTED: 'bg-warning/15 text-warning border border-warning/30',
  MISSING: 'bg-warning/15 text-warning border border-warning/30',
  MISMATCHED: 'bg-warning/15 text-warning border border-warning/30',
  UNKNOWN: 'bg-navy-700 text-muted-foreground border border-border',
  STALE: 'bg-loss/15 text-loss border border-loss/30',
  FAILED: 'bg-loss/15 text-loss border border-loss/30',
  REJECTED: 'bg-loss/15 text-loss border border-loss/30',
  CANCELLED: 'bg-loss/15 text-loss border border-loss/30',
  ALERT: 'bg-loss/15 text-loss border border-loss/30',
  CRITICAL: 'bg-loss/15 text-loss border border-loss/30',
};

export default function ReviewStatusBadge({ status }: { status: string | null | undefined }) {
  const label = (status ?? 'UNKNOWN').toUpperCase();
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold tracking-wide',
        toneMap[label] ?? 'bg-navy-700 text-muted-foreground border border-border'
      )}
    >
      {label.replaceAll('_', ' ')}
    </span>
  );
}