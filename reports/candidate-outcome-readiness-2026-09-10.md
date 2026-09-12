---
title: Candidate Outcome Research Readiness
description: Read-only coverage findings and conditions for one advisory-only ranking experiment.
ms.date: 2026-09-10
---

## Decision

Do not tune strategy parameters or evaluate a profit-improvement claim using the
stored forward outcomes yet. Coverage is concentrated in ten scan dates, the
current enrichment path has a confirmed ordering defect, and partial horizons
are not retried. First reconstruct a validated research dataset outside the live
tables. Substantial local daily-bar history makes that worth attempting.

This check measured coverage, inspected the current calculation path, and ran
mocked characterization tests. It did not compare strategy returns, repair live
outcomes, invoke market-data providers, or place trades.

## Evidence boundary

Candidate cohort cutoff: `2026-09-10T00:00:00Z`, using current local SQLite rows.
Enrichment counts require enrichedAt at or before the cutoff. This is not a
historical database snapshot: current grades, metadata and rows may have changed
since their original creation. Grade joins use exact scanId and Stock ticker;
multiple matching ScanResult rows are left unclassified rather than guessed.

Selected-source SHA256:

```text
6bf2f7edd7ba71f7bc4e09cc063156daa4b9e3402fb8f297dbb8e24b086d113c
```

## Coverage

There are 81,999 candidate rows across 76 scans, 67 UTC scan dates and 1,121
tickers. Collapsing same-ticker same-date observations leaves 72,196 ticker-days:
9,803 rows are additional observations within those same ticker-days, not new
independent trials. Even distinct dates share market shocks and overlapping
twenty-session outcome windows.

| Scan month | Rows | Scan dates | Stored 20-day outcomes | Dates with 20-day outcomes |
| --- | ---: | ---: | ---: | ---: |
| May | 7,666 | 5 | 1,225 | 3 |
| June | 24,010 | 16 | 10,112 | 7 |
| July | 23,759 | 21 | 0 | 0 |
| August | 19,118 | 18 | 0 | 0 |
| September | 7,446 | 7 | 0 | 0 |

Of 54,369 observations at least 42 calendar days old, 43,032 lack a twenty-day
outcome: 35,805 have no recorded enrichment and 7,227 have partial enrichment.
Another 27,630 more-recent rows lack twenty-day outcomes. The 42-day boundary is
an age diagnostic, not proof of twenty available exchange sessions. The recent
group includes both potentially mature and genuinely immature observations;
exchange calendars and validated bars must distinguish them.

Across all rows, 18,564 have five-day and 16,567 have ten-day outcomes. All 1,121
tickers have some old missing twenty-day evidence. While 1,106 tickers have at
least one stored twenty-day value, only fifteen have none. This is predominantly
a time-coverage problem, not merely a small group of unsupported symbols.
PSTV has 43 old missing observations; AA, AAPL, ABBV and ACLS each have 41.

| Stored grade | Rows | Stored 20-day outcomes | Dates with those outcomes |
| --- | ---: | ---: | ---: |
| A_GRADE_BUY | 59 | 8 | 3 |
| B_GRADE_WATCH | 1,474 | 170 | 5 |
| BLOCKED_CHASE | 336 | 39 | 4 |
| BLOCKED_DATA | 43,974 | 5,456 | 4 |
| BLOCKED_RISK | 36,156 | 5,664 | 7 |

READY status is not executable A-grade: 5,469 rows are READY, versus only 59
stored A-grade rows. There are 54,114 non-null NCS values; 27,885 are missing.
Zero candidates have exact placed-trade links in this cohort. Therefore neither
the broad universe count nor the READY count is a usable sample size for actual
trade performance. Stored grades and their historical policy versions also need
validation before comparing periods.

## Calculation limitations

1. The Yahoo branch of [getDailyPrices](../src/lib/market-data.ts#L308) returns
   newest-first bars. [enrichCandidateOutcomes](../src/lib/candidate-outcome-enrichment.ts#L137)
   filters after the scan date but does not reorder them. The metric calculator
   indexes positions 4, 9 and 19 as though they are chronological. A thirty-bar
   rising fixture correctly yields 5% and 20% for days five and twenty, but the
   batch path persists 26% and 11%. This establishes a current-path defect, not
   proof that every historical row was created by this version or provider.
2. The batch selects only enrichedAt=null and marks a row enriched after five
   bars. A seven-bar fixture permanently retains null twenty-day output under
   this selector even when thirty bars later exist. All 7,227 partial rows are
   excluded by the current selector; their individual historical causes remain
   unproven.
3. MFE/MAE use up to twenty available bars relative to the planned entry and
   stop, without proving entry execution or stopping the window at an exit.
   A stop-first, rally-later fixture reports both stopHit=true and MFE=4R.
   Threshold flags use closes, whereas MFE uses highs. These are price-path
   descriptors, not captured trade profit or a valid exit-policy comparison.
4. The compact fetch uses a rolling 120-calendar-day request. Rebuilding older
   observations needs date-specific coverage checks, not merely twenty returned
   bars. Yahoo uses adjusted close alongside raw highs/lows, which requires a
   consistent corporate-action basis before interpreting R excursions.

Do not fix this by reversing the shared provider output: scanners explicitly
depend on newest-first bars. A subsequent enrichment repair belongs at the
consumer boundary, with horizon-aware retries and completeness checks.

## Available reconstruction inputs

The separate local DailyBar table contains 294,052 rows for 1,088 instruments,
spanning May 16, 2025 through September 2, 2026. Every instrument has at least
twenty rows in total; that does not establish coverage after each candidate.
Only 103 instruments have a September 2 bar, and 1,059 have a September 1 bar.
No instrument has multiple recorded source values in this inventory.

Exact symbol matches cover 1,048 candidate tickers and 78,429 candidate rows.
The other 73 tickers require the existing canonical symbol mapping or explicit
exclusion, not guessed aliases. The inventory has not validated exchange
sessions, duplicate session dates, stale prices, corporate actions, FX, or
intraday ordering. Some stored dates are weekends. Source labels alone are not
quality certification. Local data is not yet sufficient for every August
signal's full twenty-session endpoint.

## First conditional experiment

Test selection before exit optimization: within an identical, point-in-time
eligible slate, compare the current rankScore ordering against descending NCS
ordering. Keep the existing risk profile, position limits, sizing, entry gates,
stop policy and transaction-cost assumptions identical. Missing NCS does not
receive an invented value. No blocked candidate may become executable.

This is a hypothesis to test, not a recommended live strategy change. It must
remain shadow-only. If too few eligible slates contain competing choices, record
insufficient evidence rather than widening eligibility to manufacture a sample.

1. Reconstruct chronological labels and baseline replay from validated,
   session-aligned prices in a separate research artifact. Preserve raw evidence
   and source fingerprints. Prove point-in-time eligibility and score provenance.
2. Use May-June for development, subject to verified coverage. Reserve August 3
   onward for evaluation and purge development observations whose full outcome
   window reaches the evaluation start. Do not tune on July purge data. Verify
   that prior project analyses have not exposed the chosen holdout; otherwise
   collect a new forward holdout. This check inspected coverage, not its returns.
3. Freeze eligibility, ordering/tie-breaks, missing-data handling, costs, primary
   metric and stopping rule before evaluating outcomes. Primary comparison:
   paired net realised R per valid decision day in a replay that respects capital
   and concurrent positions. Use an identical risk budget in both arms.
4. Require at least thirty distinct eligible evaluation dates with complete
   endpoints, then account for overlapping twenty-session windows and shared
   tickers in uncertainty estimates. Thirty dates is a minimum, not proof of
   statistical power. Require a positive paired effect with an overlap-adjusted
   95% interval above zero and no worsening of replay drawdown or risk breaches.
5. If any evidence gate fails, the result is inconclusive. A successful result
   advances to forward shadow validation, not automatic live activation. Daily
   bars alone cannot establish actual intraday fills; replay remains conditional
   on its execution assumptions and must not be sold as verified live profit.

## Verification and reproduction

```powershell
node scripts/candidate-outcome-coverage.mjs prisma/dev.db 2026-09-10T00:00:00Z
node --test scripts/candidate-outcome-coverage.test.mjs
npx vitest run src/lib/candidate-outcome-coverage.test.ts src/lib/candidate-outcome-enrichment.test.ts
```

Four reporting tests and twelve enrichment tests passed, including three new
characterization tests. The SQLite fixture remained byte-identical; missing
database paths are refused. Typecheck, scoped lint and editor diagnostics passed.
Production code, live tables, external services and scheduler configuration were
not changed. Full-suite and live-provider behavior were not exercised.

Immediate next implementation: a bounded research-only reconstruction pilot,
followed by validated enrichment repair if the pilot passes. Do not reset
enrichedAt or bulk-overwrite historical outcomes from this report.