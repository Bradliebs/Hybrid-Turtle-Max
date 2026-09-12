---
title: Trading simulation development results
description: Isolated historical replay and synthetic evidence checks with explicit limits on performance claims.
ms.date: 2026-09-12
---

## Decision

Do not change live risk, entry, ranking or stop settings from this experiment.
The funded replay is cost-sensitive and contains only nine completed trades
across four signal dates. FULL and CORE_LITE produce identical aggregate
results in every paired scenario. No profit improvement has been established.

The [machine-readable results](trading-simulation-2026-09-12.json) were generated
at 2026-09-12T08:49:09Z. These are development simulations, not reconciled account
profit, a full reproduction of live trading, or out-of-sample validation.

## Fixed experiment

* May 1 through June 30, 2026 signals, using stored snapshot trigger crossings
* GBP10,000 initial capital, 2% planned risk per trade, four simultaneous positions
* Existing FULL and CORE_LITE scoring modes, without tuning either mode
* Adverse execution costs of 0%, 0.25% and 0.5% per side
* Each scenario repeated with every fourth chronological ticker signal removed
* August 1 onward snapshots and daily bars removed from the sandbox before replay

The missed-entry case removes 306 of 1,224 signals before portfolio selection.
It is a deterministic sensitivity test, not an estimated 25% fill-failure rate.
The twelve scenarios share data and are not twelve independent experiments.

## Historical results

Both scoring modes produced these same aggregates. Each scenario funded nine
completed trades on four signal dates. P&L below is modeled closed-trade P&L
in GBP; it is not verified portfolio return.

| Cost per side | Baseline mean net R | Baseline modeled P&L | Missed-entry mean net R | Missed-entry modeled P&L |
| --- | --- | --- | --- | --- |
| 0% | 0.1177 | 184.19 | 0.1129 | 159.12 |
| 0.25% | 0.0401 | 68.52 | 0.0330 | 64.17 |
| 0.5% | -0.0375 | -51.56 | -0.0469 | -30.12 |

The baseline produced 1,224 candidate crossings: 1,213 were position-rejected,
two were cash-rejected, and nine funded. No funded selection failed FX checks.
These counts do not justify raising position or risk limits: the replay does
not apply the complete live entry policy, and its larger all-signal population
has weaker outcomes than the selected funded sample.

Across all candidates, 1,197 have completed outcomes on 26 signal dates and
27 remain incomplete. The gross daily-mean outcome is -0.0757R, with the
runner's overlap-adjusted 95% interval of approximately -0.27R to +0.12R.
That interval is for all signals, not the nine funded trades. The runner
classifies the evidence INCONCLUSIVE and validity PARTIAL, and continues to
suppress portfolio return, drawdown and equity curves.

## Replay corrections

The [runner](../packages/backtest/src/runner.ts) now carries session opens into
stop simulation. A long stop fills at the worse of the valid opening price and
active stop. It no longer credits a stop-price fill through an opening gap.
Missing/invalid opens retain the disclosed legacy stop-price assumption.

Stop evaluation is bounded by the chosen time exit. A later stop no longer
overwrites a prior time exit, and exit-day or post-exit closes no longer inflate
the reported favorable/adverse excursions. Excursions remain based on observed
pre-exit closes and the exit fill, not full intraday highs/lows.

Stop-raising thresholds and monotonicity are unchanged. No sacred file, live
strategy setting, order payload, automation schedule or production record was
changed. Shared backtest API callers inherit the simulation corrections.

## Synthetic evidence

The [offline harness](../scripts/trading-simulation.test.ts) verifies gaps from
-1R through -5R. One explicit scenario enters at 100, plans a stop at 90, and
opens at 80. It loses 2R before costs and 2.09R with 0.5% costs on each side.
At 20 shares, planned risk is GBP200 but modeled loss is GBP418.

The [connected evidence fixture](../src/lib/trading-evidence-simulation.test.ts)
uses real Prisma queries, exact recovery, closure reconciliation and analytics:

1. A synthetic scan and 10-share entry at 101 link exactly and survive reconnect.
2. A partial four-share sale leaves outcome R null.
3. Complete same-order fills of 4 at 110 and 6 at 115, supplied out of order
   with an identical duplicate, reconcile to exit price 113 and GBP120 P&L.
4. The fixture persists synthetic 2R; analytics keeps it separate from a 0.2R
   planned-trigger-to-fill gap and leaves unsupported drag estimates null.
5. A duplicate completion makes fill evidence invalid and removes it from
   fill-measurement denominators without inventing or rewriting outcome R.

The fixture supplies entry and closure persistence. It does not call the live
broker, the production position-sync writer, or an entire scan-to-close workflow.
An additional 283 existing tests passed across 14 execution, stop-retry,
accounting, provenance, exact-link and enrichment suites. Those are component
scenarios, not 283 new trades or an empirical reliability estimate.

## Isolation and reproducibility

The source SQLite connection was readonly with query-only enabled. SQLite's
backup API created a disposable copy. Account tables and other tables outside
Snapshot, SnapshotTicker, Stock, Instrument and DailyBar were dropped from that
copy; reserved-period market rows were removed before evaluation.

The harness checked the real Prisma database path, enabled query-only on its
single connection, and confirmed that a write was rejected. Fetch and Node
socket connections were blocked; neither was called. The sandbox's SHA256 was
identical before and after replay:

```text
2a72c02239c05e2395c865338f5be8a3ae33b5c1ab87c23d44522645e93017a9
```

The temporary database was deleted after testing. The report is retained, but
the input snapshot is not archived; repeating against a changed source database
can produce different results. No BacktestRun was stored in production.

Default checks do not open the historical database:

```powershell
npx vitest run packages/backtest/src/runner.test.ts scripts/trading-simulation.test.ts src/lib/trading-evidence-simulation.test.ts
```

An explicit historical rerun uses these process-local environment variables.
Choose a new report name; output creation refuses to overwrite existing files.

```powershell
$env:HT_SIMULATION_SOURCE = (Resolve-Path prisma/dev.db).Path
$env:HT_SIMULATION_REPORT = 'reports/trading-simulation-rerun.json'
$env:HYBRIDTURTLE_SKIP_STARTUP_PRECACHE = 'true'
try {
  npx vitest run scripts/trading-simulation.test.ts
} finally {
  Remove-Item Env:HT_SIMULATION_SOURCE, Env:HT_SIMULATION_REPORT
  Remove-Item Env:HYBRIDTURTLE_SKIP_STARTUP_PRECACHE
}
```

## Remaining work

| Workstream | What this run establishes | Still required |
| --- | --- | --- |
| Replay mechanics | Gap-aware exits and holding-period bounds tested | Certified price adjustment basis, daily-bar quality and point-in-time metadata |
| Existing execution/accounting components | Synthetic regression checks pass | Real broker observations and one full integrated scan-to-close sandbox workflow |
| Automated evidence pipeline | Connected synthetic attribution/reconciliation/analytics contract passes | Real fills and currency-basis reconciliation |
| Historical strategy research | Fixed mode/cost/missed-entry grid executed | Policy-aligned entry selection, predeclared alternatives and independent holdout evaluation |
| Entry/exit alternatives | Existing stop policy stress-tested | No alternative entry policy or stop thresholds compared in this phase |
| Nine historical closure exceptions | No historical accounting rewritten | Actual account-scoped broker fill evidence |
| Manual attribution and dashboard | Not changed by this phase | End-to-end scan identity propagation and provenance-aware UI integration |
| Enrichment | Existing synthetic cursor/evidence checks pass | Observed throughput and mature prospective windows |

Additional limitations remain material: entry prices are snapshot closes, not
attainable quotes; costs are assumptions; intraday order and liquidity are not
reconstructed; time exits approximate 20 calendar days rather than 20 trading
sessions. The runner can reject candidates using missing future exit FX, which
is not a strictly point-in-time execution policy. No Monte Carlo distribution
was fitted to the nine-trade sample; resampling would not supply missing
independent evidence.

The next research step is policy-aligned, price-basis-validated replay. The
engineering tasks for manual attribution and dashboard integration do not need
to wait for the nine historical broker exceptions to be resolved.