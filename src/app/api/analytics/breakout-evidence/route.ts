export const dynamic = 'force-dynamic';

/**
 * DEPENDENCIES
 * Consumed by: /breakout-evidence page, research tooling
 * Consumes: prisma.ts (SnapshotTicker, CandidateOutcome)
 * Risk-sensitive: NO — read-only analytics, Layer 2 advisory
 * Last modified: 2026-03-11
 * Notes: Aggregates breakout evidence from SnapshotTicker + forward outcomes
 *        from CandidateOutcome. All data is observational — never affects
 *        scan decisions or risk gates.
 */

import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

// ── Types ──────────────────────────────────────────────────────────

interface BucketStats {
  count: number;
  withOutcomes: number;
  avgFwd5d: number | null;
  avgFwd10d: number | null;
  avgFwd20d: number | null;
  avgMfeR: number | null;
  avgMaeR: number | null;
  hit1RRate: number | null;
  stopHitRate: number | null;
  avgEntropy63: number | null;
  avgNetIsolation: number | null;
}

function computeBucketStats(
  snapshots: { entropy63: number | null; netIsolation: number | null }[],
  outcomes: { fwdReturn5d: number | null; fwdReturn10d: number | null; fwdReturn20d: number | null; mfeR: number | null; maeR: number | null; reached1R: boolean | null; stopHit: boolean | null }[]
): BucketStats {
  const count = snapshots.length;
  const withOutcomes = outcomes.length;

  const avg = (arr: (number | null)[]): number | null => {
    const valid = arr.filter((v): v is number => v != null);
    return valid.length > 0 ? valid.reduce((s, v) => s + v, 0) / valid.length : null;
  };

  const rate = (arr: (boolean | null)[]): number | null => {
    const valid = arr.filter((v): v is boolean => v != null);
    return valid.length > 0 ? (valid.filter(Boolean).length / valid.length) * 100 : null;
  };

  return {
    count,
    withOutcomes,
    avgFwd5d: avg(outcomes.map((o) => o.fwdReturn5d)),
    avgFwd10d: avg(outcomes.map((o) => o.fwdReturn10d)),
    avgFwd20d: avg(outcomes.map((o) => o.fwdReturn20d)),
    avgMfeR: avg(outcomes.map((o) => o.mfeR)),
    avgMaeR: avg(outcomes.map((o) => o.maeR)),
    hit1RRate: rate(outcomes.map((o) => o.reached1R)),
    stopHitRate: rate(outcomes.map((o) => o.stopHit)),
    avgEntropy63: avg(snapshots.map((s) => s.entropy63)),
    avgNetIsolation: avg(snapshots.map((s) => s.netIsolation)),
  };
}

// ── GET handler ────────────────────────────────────────────────────

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const sleeve = searchParams.get('sleeve');
  const from = searchParams.get('from');
  const to = searchParams.get('to');
  const limit = Math.min(Number(searchParams.get('limit')) || 2000, 5000);

  // 1. Fetch recent SnapshotTicker rows that have breakout evidence fields
  const snapshotWhere: Record<string, unknown> = {
    novelSignalVersion: { not: null },
  };
  if (sleeve) snapshotWhere.sleeve = sleeve;
  if (from || to) {
    snapshotWhere.createdAt = {
      ...(from ? { gte: new Date(from) } : {}),
      ...(to ? { lte: new Date(to) } : {}),
    };
  }

  const snapshots = await prisma.snapshotTicker.findMany({
    where: snapshotWhere,
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      ticker: true,
      sleeve: true,
      status: true,
      close: true,
      isBreakout20: true,
      breakoutDistancePct: true,
      breakoutWindowDays: true,
      entropy63: true,
      netIsolation: true,
      entropyObsCount: true,
      netIsolationPeerCount: true,
      netIsolationObsCount: true,
      novelSignalVersion: true,
      smartMoney21: true,
      fractalDim: true,
      complexity: true,
      createdAt: true,
    },
  });

  // 2. Split into breakout vs non-breakout
  const breakoutSnaps = snapshots.filter((s) => s.isBreakout20 === true);
  const nonBreakoutSnaps = snapshots.filter((s) => s.isBreakout20 === false);

  // 3. Find matching CandidateOutcome records for forward return data.
  //    Match by ticker — CandidateOutcome has enrichment data from forward lookups.
  const breakoutTickers = Array.from(new Set(breakoutSnaps.map((s) => s.ticker)));
  const nonBreakoutTickers = Array.from(new Set(nonBreakoutSnaps.map((s) => s.ticker)));

  const [breakoutOutcomes, nonBreakoutOutcomes] = await Promise.all([
    breakoutTickers.length > 0
      ? prisma.candidateOutcome.findMany({
          where: {
            ticker: { in: breakoutTickers },
            enrichedAt: { not: null },
          },
          select: {
            ticker: true,
            fwdReturn5d: true,
            fwdReturn10d: true,
            fwdReturn20d: true,
            mfeR: true,
            maeR: true,
            reached1R: true,
            stopHit: true,
          },
        })
      : [],
    nonBreakoutTickers.length > 0
      ? prisma.candidateOutcome.findMany({
          where: {
            ticker: { in: nonBreakoutTickers },
            enrichedAt: { not: null },
          },
          select: {
            ticker: true,
            fwdReturn5d: true,
            fwdReturn10d: true,
            fwdReturn20d: true,
            mfeR: true,
            maeR: true,
            reached1R: true,
            stopHit: true,
          },
        })
      : [],
  ]);

  // 4. Compute stats for each bucket
  const breakoutStats = computeBucketStats(breakoutSnaps, breakoutOutcomes);
  const nonBreakoutStats = computeBucketStats(nonBreakoutSnaps, nonBreakoutOutcomes);

  // 5. Shadow stats: breakout + low entropy (structured trend)
  const breakoutLowEntropy = breakoutSnaps.filter(
    (s) => s.entropy63 != null && s.entropy63 < 2.5
  );
  const breakoutLowEntropyTickers = Array.from(new Set(breakoutLowEntropy.map((s) => s.ticker)));
  const breakoutLowEntropyOutcomes = breakoutOutcomes.filter((o) =>
    breakoutLowEntropyTickers.includes(o.ticker)
  );
  const breakoutLowEntropyStats = computeBucketStats(breakoutLowEntropy, breakoutLowEntropyOutcomes);

  // 6. Shadow stats: breakout + high isolation (independent mover)
  const breakoutHighIsolation = breakoutSnaps.filter(
    (s) => s.netIsolation != null && s.netIsolation > 0.5
  );
  const breakoutHighIsolationTickers = Array.from(new Set(breakoutHighIsolation.map((s) => s.ticker)));
  const breakoutHighIsolationOutcomes = breakoutOutcomes.filter((o) =>
    breakoutHighIsolationTickers.includes(o.ticker)
  );
  const breakoutHighIsolationStats = computeBucketStats(breakoutHighIsolation, breakoutHighIsolationOutcomes);

  // 7. Per-ticker latest breakout snapshot (for the detail table)
  const latestByTicker = new Map<string, typeof snapshots[number]>();
  for (const snap of snapshots) {
    if (!latestByTicker.has(snap.ticker)) {
      latestByTicker.set(snap.ticker, snap);
    }
  }

  const tickerDetails = Array.from(latestByTicker.values())
    .filter((s) => s.isBreakout20 === true)
    .sort((a, b) => (a.breakoutDistancePct ?? 0) - (b.breakoutDistancePct ?? 0))
    .slice(0, 50);

  return NextResponse.json({
    ok: true,
    generatedAt: new Date().toISOString(),
    totalSnapshots: snapshots.length,
    breakout: breakoutStats,
    nonBreakout: nonBreakoutStats,
    shadow: {
      breakoutLowEntropy: breakoutLowEntropyStats,
      breakoutHighIsolation: breakoutHighIsolationStats,
    },
    tickerDetails,
  });
}
