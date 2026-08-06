// ============================================================
// Module 17: Weekly Action Card
// ============================================================
// Auto-generates markdown summary: regime, ready candidates,
// stop updates, risk budget, laggard flags — one-page battle plan.
// ============================================================

import 'server-only';
import type {
  WeeklyActionCard,
  TriggerMetCandidate,
  MarketRegime,
  LaggardFlag,
  ClimaxSignal,
  WhipsawBlock,
  SwapSuggestion,
  ReEntrySignal,
} from '@/types';

interface ActionCardInput {
  regime: MarketRegime;
  breadthPct: number;
  readyCandidates: { ticker: string; status: string }[];
  triggerMet?: TriggerMetCandidate[];
  stopUpdates: { ticker: string; from: number; to: number }[];
  riskBudgetPct: number;
  laggards: LaggardFlag[];
  climaxSignals: ClimaxSignal[];
  whipsawBlocks: WhipsawBlock[];
  swapSuggestions: SwapSuggestion[];
  reentrySignals: ReEntrySignal[];
  maxPositions: number;
}

/**
 * Generate the weekly action card.
 */
export function generateActionCard(input: ActionCardInput): WeeklyActionCard {
  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - now.getDay()); // Sunday

  const notes: string[] = [];

  // Auto-generate notes based on conditions
  if (input.regime !== 'BULLISH') {
    notes.push(`⚠️ Regime is ${input.regime} — no new entries unless Early Bird criteria met`);
  }
  if (input.breadthPct < 40) {
    notes.push(`🛑 Breadth only ${input.breadthPct.toFixed(0)}% — Safety Valve active, max ${input.maxPositions} positions`);
  }
  if (input.laggards.length > 0) {
    notes.push(`🐌 ${input.laggards.length} laggard(s) flagged for review`);
  }
  if (input.climaxSignals.length > 0) {
    notes.push(`🔥 ${input.climaxSignals.length} climax signal(s) detected — consider trimming`);
  }
  if (input.whipsawBlocks.length > 0) {
    notes.push(`🚫 ${input.whipsawBlocks.length} ticker(s) blocked by whipsaw kill switch`);
  }
  if (input.swapSuggestions.length > 0) {
    notes.push(`🔄 ${input.swapSuggestions.length} swap suggestion(s) — upgrade portfolio quality`);
  }
  if (input.reentrySignals.filter(r => r.eligible).length > 0) {
    notes.push(`🔁 ${input.reentrySignals.filter(r => r.eligible).length} re-entry signal(s) after profitable exits`);
  }
  if (input.riskBudgetPct > 80) {
    notes.push(`⚠️ Risk budget ${input.riskBudgetPct.toFixed(0)}% utilized — limited capacity`);
  }
  const triggerMet = input.triggerMet || [];
  if (triggerMet.length > 0) {
    notes.push(`🚨 ${triggerMet.length} trigger(s) met — price above entry trigger, confirm volume & buy`);
  }

  return {
    weekOf: weekStart.toISOString().split('T')[0],
    regime: input.regime,
    breadthPct: input.breadthPct,
    readyCandidates: input.readyCandidates,
    triggerMet,
    stopUpdates: input.stopUpdates,
    riskBudgetPct: input.riskBudgetPct,
    // Rich detail objects for drill-down
    laggardDetails: input.laggards,
    climaxDetails: input.climaxSignals.filter(c => c.isClimax),
    whipsawDetails: input.whipsawBlocks,
    swapDetails: input.swapSuggestions,
    reentryDetails: input.reentrySignals.filter(r => r.eligible),
    // Backward-compat flat strings (Telegram / markdown)
    laggardFlags: input.laggards.map(l => `${l.ticker}: ${l.reason}`),
    climaxFlags: input.climaxSignals.filter(c => c.isClimax).map(c => `${c.ticker}: ${c.reason}`),
    whipsawBlocks: input.whipsawBlocks.map(w => w.reason),
    swapSuggestions: input.swapSuggestions.map(s => s.reason),
    reentrySignals: input.reentrySignals?.filter(r => r.eligible).map(r => `${r.ticker}: ${r.reason}`) || [],
    maxPositions: input.maxPositions,
    notes,
  };
}

/**
 * Render action card as markdown (for Telegram / export).
 */
export function actionCardToMarkdown(card: WeeklyActionCard): string {
  const lines: string[] = [
    `# 📋 Weekly Action Card — Week of ${card.weekOf}`,
    '',
    `## Market`,
    `- **Regime:** ${card.regime}`,
    `- **Breadth:** ${card.breadthPct.toFixed(0)}% above 50DMA`,
    `- **Max Positions:** ${card.maxPositions}`,
    `- **Risk Budget:** ${card.riskBudgetPct.toFixed(0)}% used`,
    '',
  ];

  if (card.readyCandidates.length > 0) {
    lines.push(`## 🎯 Ready Candidates (${card.readyCandidates.length})`);
    for (const c of card.readyCandidates) {
      lines.push(`- ${c.ticker} [${c.status}]`);
    }
    lines.push('');
  }

  if (card.triggerMet.length > 0) {
    lines.push(`## 🚨 TRIGGER MET (${card.triggerMet.length})`);
    for (const t of card.triggerMet) {
      lines.push(`- **${t.ticker}** (${t.sleeve}) — Close: ${t.close.toFixed(2)} ≥ Trigger: ${t.entryTrigger.toFixed(2)} — CONFIRM VOLUME & BUY`);
    }
    lines.push('');
  }

  if (card.stopUpdates.length > 0) {
    lines.push(`## 🔧 Stop Updates (${card.stopUpdates.length})`);
    for (const s of card.stopUpdates) {
      lines.push(`- ${s.ticker}: $${s.from.toFixed(2)} → $${s.to.toFixed(2)}`);
    }
    lines.push('');
  }

  if (card.laggardFlags.length > 0) {
    lines.push(`## 🐌 Laggard Flags`);
    card.laggardFlags.forEach(f => lines.push(`- ${f}`));
    lines.push('');
  }

  if (card.climaxFlags.length > 0) {
    lines.push(`## 🔥 Climax Signals`);
    card.climaxFlags.forEach(f => lines.push(`- ${f}`));
    lines.push('');
  }

  if (card.whipsawBlocks.length > 0) {
    lines.push(`## 🚫 Whipsaw Blocks`);
    card.whipsawBlocks.forEach(w => lines.push(`- ${w}`));
    lines.push('');
  }

  if (card.swapSuggestions.length > 0) {
    lines.push(`## 🔄 Swap Suggestions`);
    card.swapSuggestions.forEach(s => lines.push(`- ${s}`));
    lines.push('');
  }

  if (card.reentrySignals.length > 0) {
    lines.push(`## 🔁 Re-Entry Signals`);
    card.reentrySignals.forEach(r => lines.push(`- ${r}`));
    lines.push('');
  }

  if (card.notes.length > 0) {
    lines.push(`## 📝 Notes`);
    card.notes.forEach(n => lines.push(`- ${n}`));
    lines.push('');
  }

  return lines.join('\n');
}
