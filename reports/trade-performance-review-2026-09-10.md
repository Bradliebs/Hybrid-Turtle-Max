---
title: Trade Performance Baseline 2026-09-10
description: Read-only Phase 1 evidence, descriptive results, reconciliation gaps, and next actions.
ms.date: 2026-09-10
---

## Decision

Do not increase risk, loosen entry gates, or tune exits from this sample.
First recover missing outcomes and reconcile exit quantities, then connect
candidate decisions to actual trades. The available automated-trade records
show negative descriptive results, but are too incomplete and concentrated
in a few entry days to establish a reliable strategy-performance estimate.

Phase 1 delivered a reproducible report and a coverage assessment. A fully
reconciled live-account baseline is not yet available. No trades, stops,
configuration, database records, or scheduled jobs were changed.

## Scope and provenance

* Reporting interval: 2026-03-10 00:00:00 UTC through 2026-09-10 15:25:00 UTC.
* Source: local `prisma/dev.db`, opened with SQLite read-only and query-only
  flags. Core results are read inside one transaction. Supplemental coverage
  and spot checks used separate read-only transactions during this session.
* Position cohorts use entry dates and currently stored statuses. They do not
  reconstruct a historical account or calculate all profit realized during
  the interval. September 10 was an incomplete trading session at the cutoff.
* All 30 positions belong to one user and have account type `isa`. No invest
  position cohort exists in these records. Source `trading212` means synced,
  not necessarily a manual trade; source `auto-trade` identifies automated entries.
* Current configuration names the live environment with ISA connected.
  Historical environment is not persisted per position. These results therefore
  remain locally recorded ISA evidence, not independently confirmed live history.
* No credentials, raw broker payloads, or account identifiers are included.

## Descriptive baseline

All-history Position results equal the six-month cohort: the earliest stored
position entry is May 8, 2026. The 145 TradeLog rows extend back to January 15,
but imported sell records are not equivalent to strategy-managed positions.
They must not be added to Position P&L without account and lifecycle reconciliation.

| Metric | Automated ISA | Broker-synced ISA | Combined stored records |
| --- | ---: | ---: | ---: |
| Position rows | 15 | 15 | 30 |
| Open positions | 2 | 0 | 2 |
| Closed positions | 13 | 15 | 28 |
| Closed positions with usable stored R and exit data | 11 | 14 | 25 |
| Missing closed outcomes | 2 | 1 | 3 |
| Distinct entry days among measured outcomes | 6 | 10 | 16 |
| Wins / losses / flat, by stored R | 2 / 9 / 0 | 7 / 6 / 1 | 9 / 15 / 1 |
| Win rate | 18.18% | 50.00% | 36.00% |
| Total stored R | -5.2892 | +1.5980 | -3.6912 |
| Mean stored R per measured trade | -0.4808 | +0.1141 | -0.1476 |
| Average winning R | +0.6442 | +0.8369 | +0.7940 |
| Average losing R, excluding flat | -0.7309 | -0.7100 | -0.7225 |
| Profit factor, R-based | 0.1959 | 1.3751 | 0.6594 |
| Mean holding days using stored position dates | 8.69 | 10.56 | 9.74 |
| Median holding days using stored position dates | 6.76 | 8.38 | 7.27 |
| Stored GBP P&L subtotal for measured rows | -14.96 | -0.97 | -15.93 |

These are descriptive stored-value subtotals, not net strategy or account profit.
They include the quantity exceptions below. Broker-synced risk distances can
be reconstructed rather than original trade risk: 12 of 15 synced positions
have notes referring to a 5% fallback. R and GBP need not move together because
trade risk amounts, quantities, currencies, and outcome provenance differ.
Do not compare the two source cohorts as a controlled strategy experiment.

The existing evidence framework requires at least 30 distinct entry days even
to begin interpreting expectancy. Neither source cohort meets that minimum.
No confidence interval, supported-edge verdict, annualized return, or
drawdown claim is issued. A minimum sample threshold alone would not resolve
missing outcomes, dependence between trades, or selection bias.

## Reconciliation and exclusions

Three closed positions have no exit price, R, or GBP P&L: UNH (synced), CCRN
(automated), and CRON (automated). They are excluded from measured results,
not assigned zero. Their absence can bias either the profit or loss estimate.

For the 25 measured positions:

* All 25 stored R values agree with `(exitPrice - entryPrice) / initial_R`
  within 0.00000001. This verifies arithmetic, not original-risk provenance.
* Twenty-four GBP values agree within GBP 0.01 with a unique, position-linked
  exit log containing a broker order ID and `realisedPnlT212`. These fields
  share the sync writer, so agreement is internal consistency, not independent
  broker reconciliation or proof that all fees are included.
* DSFIR.AS records zero P&L and an exit price equal to entry, but lacks an exit
  order ID, fill timestamp, and broker P&L. Its zero is not a verified breakeven.
* Five linked exits have a fill quantity different from the position quantity.
  Their GBP figures cannot be treated as complete position-lifecycle profit
  until partial sales, other fills, adds, or stale quantities are reconciled.

| Ticker | Source | Position shares | Linked exit fill shares | Recorded GBP |
| --- | --- | ---: | ---: | ---: |
| TKNO | Synced | 30.840 | 4.730 | +0.65 |
| GCBC | Synced | 9.000 | 3.305 | +1.37 |
| CLDX | Automated | 6.980 | 0.889 | -1.77 |
| HAYW | Automated | 15.380 | 1.607 | -1.13 |
| PEBO | Automated | 3.410 | 1.929 | -1.43 |

Spot checks also covered ETSY (USD loss: -7.06 GBP, quantity 2.69 agrees), SAP
(EUR winner: +4.93 GBP, quantity 0.57 agrees), and CNDX (stored GBP currency:
+3.70 GBP, quantity 0.09 agrees). Currency-unit and complete fee reconciliation
are still required; no GBX conversion was inferred from CNDX metadata.
Three positions have null Stock currency. No GBP P&L was invented from those
prices, and no current FX rate was substituted for historical FX.

Position exit dates can reflect the sync closure time rather than the broker
fill time. For example, SAP's linked fill is on August 26 before the stored
closure time. Holding-time results above use the labeled stored dates only.

## Coverage of the learning data

| Evidence | Observed coverage |
| --- | --- |
| TradeLog rows in interval | 74 of 145 all-history rows |
| Imported history rows in interval | 34, all unlinked to Position |
| Position-linked logs in interval | 40 |
| Broker order IDs / fill timestamps / FX / net value | 58 rows each in interval |
| Broker P&L field | 58 rows in interval |
| Planned entry / actual fill / logged fill time / rank score | 15 rows each |
| Entry NCS | 0 rows |
| Entry regime | 15 rows, all BULLISH |
| Duplicate broker order ID groups | 0 stored groups |
| Dangling non-null position links | 0 |
| CandidateOutcome rows | 81,999 across 67 scan dates |
| Candidate rows enriched / with 20-day return | 18,564 / 11,337 |
| Candidate rows marked traded / linked to TradeLog | 0 / 0 |
| EquitySnapshot rows | 126: 22 BROKER and 104 NIGHTLY |
| StopHistory rows | 114 for 29 positions |
| DailyBar rows | 294,052 across 1,088 instruments |

Candidate records span May 16 through September 9. Repeated candidate scans
are not independent trades. Their forward returns and MFE/MAE describe
planned-trigger windows, not actual held-trade results or attainable profits.
Zero trade links means the report cannot establish which historical candidates
became which fills. No approximate ticker/date backfill was run.

Daily bars have a latest stored timestamp of September 2, 2026, 09:54:53 UTC;
that timestamp is not evidence of a complete daily close. Six position tickers
have no direct ticker/yahooTicker match to Instrument: ALV, ANTM, CCRN, CNDX,
SAP, and SPCX. This is a direct-match diagnostic, not proof their price history
is absent. Canonical alias mapping must precede historical exit analysis.

The local schema has no dedicated deposit/withdrawal or dividend/split ledger.
Although every stored bar has an adjusted-close value, adjustment provenance
and compatibility with raw OHLC, stops, and fills were not established.
Account cash-flow-adjusted return, verified net profit, and drawdown remain
unavailable. Open ATRC and PRTS positions are excluded from realized results;
no fresh market quote was requested to invent an unrealized mark.

## Entry diagnostics and existing report limits

All 15 automated ENTRY logs record fills above their planned entries. The
recomputed gap averages 1.6283%, with a median of 1.2283% and a range of
0.0362% to 4.1946%. All 15 agree with the stored `slippagePct` within 0.00000001.
This includes the two open positions and two incomplete closed outcomes.

This is trigger-to-fill movement, not a pure spread, latency, or broker-slippage
cost. Logged entry and fill times are almost identical because they can be
written at recording time. They do not establish actual decision-to-fill latency.
Do not subtract this gap again from broker-reported P&L or infer that tighter
entries would have filled and improved results.

The existing execution-drag query accepts decisions EXECUTED or BUY, while
all 74 logs in this interval use TAKEN. Its query would omit this evidence.
Its GBP slippage aggregate also sums per-share price differences without
share quantities or FX, and its R-drag subtracts the initial price-risk
distance from the final R multiple. Those aggregates are not used here.
These are separately scoped analytics follow-ups; application code is unchanged.

## Ranked next actions

1. Reconcile missing and partial exits first. Obtain complete, account-scoped
   fill evidence for UNH, CCRN, CRON and the five quantity exceptions, plus
   DSFIR.AS. Use durable order/fill IDs and quantities. Require a read-only
   reconciliation proposal before any historical database correction.
2. Restore decision-to-trade attribution. Diagnose why no CandidateOutcome
   row is linked and why entry NCS is absent. Capture or prove exact scan,
   decision, order, and position identity; do not infer links from proximity
   in time. Then measure legitimate opportunities versus operational misses.
3. Investigate winner capture and entry timing only after the first two
   actions. Resolve aliases and obtain complete holding-window bars; compare
   actual exit policies and entry gaps in shadow research. Existing stop
   history and advisory tools should be reused. Freeze any candidate policy
   before evaluating later outcomes, with unchanged risk and cost assumptions.

Operational-event counts alone are not lost trades: 10 BUY_FAILED records,
11 BUY_TIMEOUT records and 13 LIVE_REVAL_SKIP records need order-level
deduplication, recovery checks and feasibility review before attribution.
No projected profit improvement is assigned to any of these actions.

## Reproduce and verify

Run from the repository root:

```powershell
node scripts/trade-performance-baseline.mjs prisma/dev.db 2026-03-10T00:00:00.000Z 2026-09-10T15:25:00.000Z
node --test scripts/trade-performance-baseline.test.mjs
npx eslint scripts/trade-performance-baseline.mjs scripts/trade-performance-baseline.test.mjs
npm run typecheck
```

The script writes JSON to standard output only. It refuses a missing database,
uses explicit column selection, and imports neither application startup code
nor a broker client. Do not use the application's schema verifier or history
importer as read-only checks; those paths can write data.

Core evidence fingerprint at extraction:

```text
a08cf437ae8dc49e402a2164e84c72723e780330dc474540aba0bc98737bc540
```

This hashes selected position/log evidence plus candidate/equity aggregates,
not the full database or supplemental queries. A later rerun can differ if
automation updates records. No historical snapshot file was copied; the report
preserves the summarized evidence, and the fingerprint detects drift in core
inputs rather than promising exact historical reconstruction.

Verification completed: nine unit/integration tests passed; scoped ESLint and
repository typecheck passed. The SQLite fixture test verifies byte-for-byte
preservation, repeatable fingerprints, and source/account separation. Manual
local-record spot checks covered a winner, loser, GBP-labeled instrument and
partial-quantity cases. Independent broker statements, complete lifecycle/fee
reconciliation, price refresh and a full application test run were not performed.