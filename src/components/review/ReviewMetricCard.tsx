/**
 * DEPENDENCIES
 * Consumed by: src/app/planned-trades/page.tsx, src/app/stops/page.tsx, src/app/orders/page.tsx, src/app/jobs/page.tsx, src/components/dashboard/EveningReviewSummary.tsx
 * Consumes: none
 * Risk-sensitive: NO
 * Last modified: 2026-03-08
 * Notes: Shared metric-card shell for Phase 9 review pages.
 */
import Link from 'next/link';

interface ReviewMetricCardProps {
  label: string;
  value: string;
  detail?: string;
  href?: string;
}

function CardBody({ label, value, detail }: Omit<ReviewMetricCardProps, 'href'>) {
  return (
    <div className="rounded-xl border border-border bg-surface-1 p-4 shadow-card">
      <div className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">{label}</div>
      <div className="mt-2 text-2xl font-bold text-foreground">{value}</div>
      {detail ? <div className="mt-1 text-sm text-muted-foreground">{detail}</div> : null}
    </div>
  );
}

export default function ReviewMetricCard(props: ReviewMetricCardProps) {
  if (props.href) {
    return (
      <Link href={props.href} className="block transition-transform hover:-translate-y-0.5">
        <CardBody label={props.label} value={props.value} detail={props.detail} />
      </Link>
    );
  }

  return <CardBody label={props.label} value={props.value} detail={props.detail} />;
}