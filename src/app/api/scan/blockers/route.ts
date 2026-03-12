import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { ensureDefaultUser } from '@/lib/default-user';
import { apiError } from '@/lib/api-response';

export const dynamic = 'force-dynamic';

/**
 * Gate Blocker Breakdown — advisory-only analytics endpoint.
 * Aggregates per-gate blocker counts from FilterAttribution for the latest scan.
 * Display-only: no execution effect whatsoever.
 */

interface BlockerCount {
  rule: string;
  count: number;
}

interface StageBreakdown {
  stage: string;
  entering: number;
  exiting: number;
  blockers: BlockerCount[];
}

export async function GET() {
  try {
    const userId = await ensureDefaultUser();

    // Find the latest scan
    const latestScan = await prisma.scan.findFirst({
      where: { userId },
      orderBy: { runDate: 'desc' },
      select: { id: true, runDate: true, regime: true },
    });

    if (!latestScan) {
      return NextResponse.json({ ok: true, available: false, message: 'No scan data available' });
    }

    // Get all FilterAttribution records for this scan
    const attributions = await prisma.filterAttribution.findMany({
      where: { scanId: latestScan.id },
    });

    if (attributions.length === 0) {
      return NextResponse.json({
        ok: true,
        available: false,
        message: 'Run a new scan to see breakdown',
        scanId: latestScan.id,
        scanDate: latestScan.runDate,
      });
    }

    const total = attributions.length;

    // ── Stage 2: Technical Filters ──
    const s2Blockers: BlockerCount[] = [
      { rule: 'Price below MA200', count: attributions.filter((a) => !a.priceAboveMa200).length },
      { rule: 'ADX < 20', count: attributions.filter((a) => !a.adxAbove20).length },
      { rule: '+DI ≤ −DI', count: attributions.filter((a) => !a.plusDIAboveMinusDI).length },
      { rule: 'ATR% above cap', count: attributions.filter((a) => !a.atrPctBelow8).length },
      { rule: 'Data quality failure', count: attributions.filter((a) => !a.dataQuality).length },
      { rule: 'ATR spike (hard block)', count: attributions.filter((a) => a.atrSpikeAction === 'HARD_BLOCK').length },
      { rule: 'ATR spike (soft cap → WATCH)', count: attributions.filter((a) => a.atrSpikeAction === 'SOFT_CAP').length },
      { rule: 'Efficiency < 30%', count: attributions.filter((a) => !a.efficiencyAbove30).length },
    ].filter((b) => b.count > 0);

    // Count candidates that passed all Stage 2 filters
    const passedTech = attributions.filter((a) =>
      a.priceAboveMa200 && a.adxAbove20 && a.plusDIAboveMinusDI &&
      a.atrPctBelow8 && a.dataQuality && a.atrSpikeAction !== 'HARD_BLOCK'
    ).length;

    // ── Stage 3: Classification ──
    const readyCount = attributions.filter((a) => a.status === 'READY').length;
    const watchCount = attributions.filter((a) => a.status === 'WATCH').length;
    const farCount = attributions.filter((a) => a.status === 'FAR').length;
    const otherCount = attributions.filter((a) =>
      a.status !== 'READY' && a.status !== 'WATCH' && a.status !== 'FAR'
    ).length;

    const s3Blockers: BlockerCount[] = [
      { rule: 'READY', count: readyCount },
      { rule: 'WATCH', count: watchCount },
      { rule: 'FAR', count: farCount },
      ...(otherCount > 0 ? [{ rule: 'Other (earnings block, etc.)', count: otherCount }] : []),
    ].filter((b) => b.count > 0);

    // ── Stage 5: Risk Gates ──
    const failedGateAttrs = attributions.filter((a) => !a.passesRiskGates && a.riskGatesFailed);
    const gateCounter: Record<string, number> = {};
    for (const attr of failedGateAttrs) {
      const gates = (attr.riskGatesFailed || '').split(',').map((g) => g.trim()).filter(Boolean);
      for (const gate of gates) {
        gateCounter[gate] = (gateCounter[gate] || 0) + 1;
      }
    }
    const s5Blockers: BlockerCount[] = Object.entries(gateCounter)
      .map(([rule, count]) => ({ rule: `Blocked by: ${rule}`, count }))
      .sort((a, b) => b.count - a.count);

    const passedRiskGates = attributions.filter((a) => a.passesRiskGates).length;

    // ── Stage 6: Anti-Chase Guard ──
    const failedAntiChase = attributions.filter((a) => !a.passesAntiChase && a.antiChaseReason);
    const acCounter: Record<string, number> = {};
    for (const attr of failedAntiChase) {
      const reason = attr.antiChaseReason || 'Unknown';
      // Normalize reason to category
      let category: string;
      if (reason.includes('COOLDOWN')) category = 'Failed breakout cooldown (COOLDOWN)';
      else if (reason.includes('WAIT_PULLBACK') || reason.includes('ext_atr')) category = 'extATR > 0.8 (WAIT_PULLBACK)';
      else if (reason.includes('GAP') || reason.includes('gap')) category = 'Monday gap guard';
      else category = reason.slice(0, 60);

      acCounter[category] = (acCounter[category] || 0) + 1;
    }
    const s6Blockers: BlockerCount[] = Object.entries(acCounter)
      .map(([rule, count]) => ({ rule, count }))
      .sort((a, b) => b.count - a.count);

    const passedAntiChase = attributions.filter((a) => a.passesAntiChase).length;

    // ── Prediction Engine (post-scan) ──
    // Query latest failure mode scores and stress test results for tickers in this scan
    const scanTickers = attributions.map((a) => a.ticker);

    const [fmScores, stressResults] = await Promise.all([
      prisma.failureModeScore.findMany({
        where: { ticker: { in: scanTickers } },
        orderBy: { scoredAt: 'desc' },
        distinct: ['ticker'],
        select: { ticker: true, gatePass: true, blockedBy: true },
      }),
      prisma.stressTestResult.findMany({
        where: { ticker: { in: scanTickers } },
        orderBy: { testedAt: 'desc' },
        distinct: ['ticker'],
        select: { ticker: true, stopHitProbability: true, gate: true },
      }),
    ]);

    // Conformal: check calibration + NCS for each candidate
    const latestCal = await prisma.conformalCalibration.findFirst({
      where: { regime: latestScan.regime },
      orderBy: { calibratedAt: 'desc' },
      select: { qHatDown: true },
    });

    // lookup NCS from scan results (join through scanId → ScanResult → FilterAttribution)
    const ncsMap: Record<string, number | null> = {};
    const scanResults = await prisma.scanResult.findMany({
      where: { scanId: latestScan.id },
      select: { stock: { select: { ticker: true } } },
    });
    // NCS isn't stored on ScanResult; use FilterAttribution's presence as proxy
    // We can check conformal lower bound from NCS on candidates
    // For now, use a simpler approach: count FM failures and MC failures

    const predBlockers: BlockerCount[] = [];

    // Failure modes
    const fmBlocked = fmScores.filter((fm) => !fm.gatePass);
    if (fmBlocked.length > 0) {
      // Group by which FM blocked
      const fmCategories: Record<string, number> = {};
      for (const fm of fmBlocked) {
        const modes = (fm.blockedBy || 'Unknown').split(',').map((m) => m.trim());
        for (const mode of modes) {
          fmCategories[mode] = (fmCategories[mode] || 0) + 1;
        }
      }
      for (const [mode, count] of Object.entries(fmCategories)) {
        predBlockers.push({ rule: `Failure mode: ${mode}`, count });
      }
    }

    // Monte Carlo
    const mcBlocked = stressResults.filter((s) => s.stopHitProbability > 0.25);
    if (mcBlocked.length > 0) {
      predBlockers.push({ rule: 'Monte Carlo stop-hit probability > 25%', count: mcBlocked.length });
    }

    // Conformal lower bound
    if (latestCal) {
      // Count candidates where NCS - qHatDown < 70 (if NCS data available from attribution)
      // FilterAttribution doesn't store NCS directly, but ScanResult doesn't either
      // Use a count of candidates where the conformal check would fail
      // This is best-effort — actual conformal decisions are in the prediction layer
      const conformalNote = predBlockers.length === 0
        ? null
        : `qHatDown: ${latestCal.qHatDown.toFixed(1)}`;
      if (conformalNote) {
        // Add as context, not a separate blocker count (no reliable NCS per candidate here)
      }
    }

    predBlockers.sort((a, b) => b.count - a.count);

    // ── Build stages ──
    const stages: StageBreakdown[] = [
      { stage: 'Stage 2: Technical Filters', entering: total, exiting: passedTech, blockers: s2Blockers },
      { stage: 'Stage 3: Classification', entering: passedTech, exiting: readyCount, blockers: s3Blockers },
      { stage: 'Stage 5: Risk Gates', entering: readyCount, exiting: passedRiskGates, blockers: s5Blockers },
      { stage: 'Stage 6: Anti-Chase Guard', entering: passedRiskGates, exiting: passedAntiChase, blockers: s6Blockers },
    ];

    if (predBlockers.length > 0) {
      stages.push({
        stage: 'Prediction Engine (post-scan)',
        entering: passedAntiChase,
        exiting: passedAntiChase - predBlockers.reduce((sum, b) => sum + b.count, 0),
        blockers: predBlockers,
      });
    }

    // ── Most restrictive gate ──
    const allBlockers = [
      ...s2Blockers,
      ...s5Blockers,
      ...s6Blockers,
      ...predBlockers,
    ].filter((b) => b.count > 0);
    const mostRestrictive = allBlockers.length > 0
      ? allBlockers.reduce((max, b) => b.count > max.count ? b : max, allBlockers[0])
      : null;

    return NextResponse.json({
      ok: true,
      available: true,
      scanId: latestScan.id,
      scanDate: latestScan.runDate,
      regime: latestScan.regime,
      totalCandidates: total,
      stages,
      mostRestrictive,
    });
  } catch (error) {
    console.error('[ScanBlockers] Error:', error);
    return apiError(500, 'SCAN_BLOCKERS_FAILED', 'Failed to compute blocker breakdown', (error as Error).message, true);
  }
}
