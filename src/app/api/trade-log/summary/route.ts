import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { ensureDefaultUser } from '@/lib/default-user';
import { apiError } from '@/lib/api-response';

export const dynamic = 'force-dynamic';

type TagCounter = Record<string, number>;

type TradeRow = {
  finalRMultiple: number | null;
  gainLossGbp: number | null;
  slippagePct: number | null;
  decisionReason: string | null;
  regime: string | null;
  tags: string | null;
};

function parseDate(value: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseTags(tags: string | null): string[] {
  if (!tags) return [];

  try {
    const parsed = JSON.parse(tags);
    if (Array.isArray(parsed)) {
      return parsed.filter((item) => typeof item === 'string') as string[];
    }
  } catch {
    // ignore malformed tags JSON
  }

  return [];
}

function topItems(counter: TagCounter, size = 5): Array<{ key: string; count: number }> {
  return Object.entries(counter)
    .sort((a, b) => b[1] - a[1])
    .slice(0, size)
    .map(([key, count]) => ({ key, count }));
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;

    let userId = searchParams.get('userId');
    if (!userId) {
      userId = await ensureDefaultUser();
    }

    const ticker = searchParams.get('ticker')?.trim();
    const decision = searchParams.get('decision')?.trim();
    const tradeType = searchParams.get('tradeType')?.trim();
    const regime = searchParams.get('regime')?.trim();
    const from = parseDate(searchParams.get('from'));
    const to = parseDate(searchParams.get('to'));

    const rows = (await prisma.tradeLog.findMany({
      where: {
        userId,
        ...(ticker ? { ticker: { contains: ticker } } : {}),
        ...(decision ? { decision } : {}),
        ...(tradeType ? { tradeType } : {}),
        ...(regime ? { regime } : {}),
        ...(from || to
          ? {
              tradeDate: {
                ...(from ? { gte: from } : {}),
                ...(to ? { lte: to } : {}),
              },
            }
          : {}),
      },
      select: {
        finalRMultiple: true,
        gainLossGbp: true,
        slippagePct: true,
        decisionReason: true,
        regime: true,
        tags: true,
      },
    })) as TradeRow[];

    const outcomeRows = rows.filter((row) => row.finalRMultiple !== null || row.gainLossGbp !== null);

    const workedRows = outcomeRows.filter((row) => {
      if (row.finalRMultiple !== null) return row.finalRMultiple > 0;
      return (row.gainLossGbp || 0) > 0;
    });

    const failedRows = outcomeRows.filter((row) => {
      if (row.finalRMultiple !== null) return row.finalRMultiple <= 0;
      return (row.gainLossGbp || 0) <= 0;
    });

    const avgR = outcomeRows.length > 0
      ? outcomeRows.reduce((sum, row) => sum + (row.finalRMultiple ?? 0), 0) / outcomeRows.length
      : null;

    const avgSlippage = rows.filter((row) => row.slippagePct !== null);
    const avgSlippagePct = avgSlippage.length > 0
      ? avgSlippage.reduce((sum, row) => sum + (row.slippagePct ?? 0), 0) / avgSlippage.length
      : null;

    const reasonCounter: TagCounter = {};
    rows.forEach((row) => {
      if (row.decisionReason) {
        reasonCounter[row.decisionReason] = (reasonCounter[row.decisionReason] || 0) + 1;
      }
    });

    const winningTagCounter: TagCounter = {};
    workedRows.forEach((row) => {
      parseTags(row.tags).forEach((tag) => {
        winningTagCounter[tag] = (winningTagCounter[tag] || 0) + 1;
      });
    });

    const losingTagCounter: TagCounter = {};
    failedRows.forEach((row) => {
      parseTags(row.tags).forEach((tag) => {
        losingTagCounter[tag] = (losingTagCounter[tag] || 0) + 1;
      });
    });

    const regimeCounter: Record<string, { count: number; avgR: number | null }> = {};
    const groupedByRegime: Record<string, number[]> = {};

    outcomeRows.forEach((row) => {
      const key = row.regime || 'UNKNOWN';
      if (!groupedByRegime[key]) groupedByRegime[key] = [];
      groupedByRegime[key].push(row.finalRMultiple ?? 0);
    });

    Object.entries(groupedByRegime).forEach(([regime, values]) => {
      const avg = values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
      regimeCounter[regime] = { count: values.length, avgR: avg };
    });

    // ── Decision Stack breakdown (advisory analytics) ──
    // Join through positionId to get decisionStack from Position
    const stackRows = await prisma.tradeLog.findMany({
      where: {
        userId,
        positionId: { not: null },
        tradeType: 'ENTRY',
        ...(ticker ? { ticker: { contains: ticker } } : {}),
        ...(regime ? { regime } : {}),
        ...(from || to
          ? {
              tradeDate: {
                ...(from ? { gte: from } : {}),
                ...(to ? { lte: to } : {}),
              },
            }
          : {}),
      },
      select: {
        finalRMultiple: true,
        gainLossGbp: true,
        position: {
          select: { decisionStack: true },
        },
      },
    });

    const byStack: Record<string, { count: number; winRate: number; avgR: number | null }> = {};
    const stackGrouped: Record<string, { wins: number; total: number; rValues: number[] }> = {};

    for (const row of stackRows) {
      const stack = row.position?.decisionStack || 'UNKNOWN';
      if (!stackGrouped[stack]) stackGrouped[stack] = { wins: 0, total: 0, rValues: [] };

      const hasOutcome = row.finalRMultiple !== null || row.gainLossGbp !== null;
      if (!hasOutcome) continue;

      stackGrouped[stack].total += 1;
      stackGrouped[stack].rValues.push(row.finalRMultiple ?? 0);

      const won = row.finalRMultiple !== null ? row.finalRMultiple > 0 : (row.gainLossGbp ?? 0) > 0;
      if (won) stackGrouped[stack].wins += 1;
    }

    for (const [stack, data] of Object.entries(stackGrouped)) {
      byStack[stack] = {
        count: data.total,
        winRate: data.total > 0 ? (data.wins / data.total) * 100 : 0,
        avgR: data.rValues.length > 0
          ? data.rValues.reduce((a, b) => a + b, 0) / data.rValues.length
          : null,
      };
    }

    return NextResponse.json({
      totals: {
        totalLogs: rows.length,
        totalOutcomes: outcomeRows.length,
        worked: workedRows.length,
        failed: failedRows.length,
        winRate: outcomeRows.length > 0 ? (workedRows.length / outcomeRows.length) * 100 : 0,
        expectancyR: avgR,
        avgSlippagePct,
      },
      topDecisionReasons: topItems(reasonCounter),
      topWinningTags: topItems(winningTagCounter),
      topLosingTags: topItems(losingTagCounter),
      byRegime: regimeCounter,
      byStack,
    });
  } catch (error) {
    console.error('Trade log summary error:', error);
    return apiError(500, 'TRADE_LOG_SUMMARY_FAILED', 'Failed to fetch trade log summary', (error as Error).message, true);
  }
}
