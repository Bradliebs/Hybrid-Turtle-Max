---
title: Entry Quality Review 2026-09-11
description: Stored entry-gap evidence, corrected measurement and bounded next research actions.
ms.date: 2026-09-11
---

## Recommendation

Investigate entry timing before increasing trade frequency or risk. Stored fills
show substantial movement above planned triggers relative to planned stop
distances. This establishes a measurement priority, not evidence that tighter
orders would have filled or improved net profit. Do not activate a new entry
threshold from these observations.

## Evidence

Read TradeLog ENTRY rows with TAKEN, EXECUTED or BUY decisions and tradeDate
before September 11, 2026 UTC. The local SQLite database was opened read-only
with query-only enabled and queried inside a transaction. Position was joined
by its exact ID only to identify source and current status. No broker call,
historical repair, candidate-outcome query or holdout strategy comparison ran.

All fifteen matching entries have usable planned entry, fill and planned stop
values and are linked to automated positions. They span eight entry dates.
These counts include two currently open positions and positions with unresolved
closure accounting. They differ from the earlier six-date measured-closed-trade
cohort because this is entry evidence, not a realized-return sample.

| Measurement | Stored result |
| --- | ---: |
| Entries / distinct entry dates | 15 / 8 |
| Mean trigger-to-fill gap | +1.6283% |
| Mean gap / planned risk distance | +0.4658 |
| Median gap / planned risk distance | +0.4873 |
| Gaps exceeding 0.25 planned-risk units | 11 |
| Gaps exceeding 0.50 planned-risk units | 7 |

The two cut points describe this sample only; neither is a selected trading
threshold. Planned-risk units use `(fill - plannedEntry) / (plannedEntry -
initialStop)`. Stored initialR often uses fill minus stop instead and would
understate this planned-risk-relative entry movement.

| Example | Trigger gap | Planned-risk units | Current stored status |
| --- | ---: | ---: | --- |
| ATRC | +2.8938% | +1.0281 | OPEN |
| PRTS | +4.1946% | +0.9617 | OPEN |
| CLDX | +2.4973% | +0.7479 | CLOSED |
| SAP | +0.1913% | +0.0323 | CLOSED |

These are illustrative entry observations, not a comparison of winners and
losers. A trigger is not a contemporaneous executable quote. Gaps can reflect
signal age, market movement, spread, fill handling or incompatible price bases.
Source values assume matching currency units and adjustment conventions, which
have not been independently certified. No GBP savings are inferred, and no gap
is subtracted again from recorded profit.

## Implemented measurement repair

[Execution drag](../src/lib/execution-drag.ts) now includes TAKEN entries and
excludes EXIT rows. It requires an explicit positive finite planned price;
entryPrice is not silently substituted for a missing plan. Fill counts require
actual positive finite fill evidence, not a stored slippage percentage alone.
Signed percent gaps and planned-risk-relative gaps preserve favorable and exact
fills. Coverage counts expose missing plans, fills and usable risk distances.

Removed the invalid subtraction of a price-risk distance from a final R multiple.
Unavailable model R, R drag, decision-to-fill latency and GBP cost are null,
not zero. Quantity and historical FX are not inferred. Recorded final R is
retained only as an independently labeled stored field, never as model drag.
The API includes a measurement label and limitations. Existing slippage field
names remain for compatibility, but their meaning is trigger-to-fill movement.

This API's nullable fields are an intentional correction: external consumers
must render missing values as unavailable, not zero. Repository typecheck passes.
The execution-quality dashboard consumes the separate execution-audit endpoint;
its charts and recommendations were not changed or validated by this repair.

## Next profit research

1. Verify price units and adjustment basis, then separate planned-trigger to
   decision-quote movement from decision-quote to fill movement using exact
   execution identity and trustworthy timestamps. Do not reconstruct these
   components from rounded log-write times.
2. Freeze one entry-policy challenger before collecting a fresh shadow sample.
   Keep eligibility, ranking, risk budgets and stops identical. Record actual
   executable quotes, spread, fill feasibility, missed fills and capital use.
   Evaluate net outcomes per eligible opportunity, not only filled trades.
3. Resume winner-capture research after complete fills, exits and holding-window
   prices are reconciled. Post-stop rallies are not attainable trade profits.
   Continue to reserve candidate holdout data from strategy tuning.

No challenger or live threshold was selected here. Eight dates cannot support a
reliable policy-profit claim; even the project's thirty-date minimum would not
by itself resolve missing evidence, correlated trades or selection bias.

## Verification

Twenty-six tests passed across the production calculator and API route. Tests
cover query filters, signed and zero gaps, missing/nonfinite inputs, unavailable
costs and timing, response serialization, and the recorded ATRC denominator.
Typecheck, scoped ESLint and editor diagnostics passed. Database inspection was
read-only; no live enrichment, provider, broker or trading job ran. Full-suite,
external-client compatibility and independent broker reconciliation remain
unchecked. These changes improve measurement, not demonstrated profitability.

## Prospective reference capture

The subsequent implementation adds version-1 reference evidence to existing
ExecutionLog JSON payloads in the automated path. It does not select an entry
challenger, change thresholds or claim an executable price.

Each revalidated candidate receives a unique decision ID, user and scan identity,
session, planned trigger and stop, scan price, reference price, decision and
local timestamps. The existing forced-refresh batch call remains the only price
request for this gate. Its completion timestamp is captured when that call
settles, not after the concurrent technical-data request. The batch window does
not establish individual ticker quote ages. Missing or invalid reference prices
are null in the evidence; the original price values still feed the guards.

Both LIVE_REVAL_KEEP and LIVE_REVAL_SKIP retain evidence, including candidates
that do not proceed to an order. BUY_PLACED and BUY_FAILED carry the same decision
ID and evidence plus a local submission-start timestamp. BUY_PLACED retains the
broker order ID, which can connect to existing completion records for that same
account. Calls without reference evidence explicitly record null. Do not join by
ticker and nearby date when exact identifiers are missing.

The source label is GET_BATCH_PRICES, identifying the actual application API;
it does not assert an upstream provider or exchange venue. Price basis remains
UNVERIFIED, executableQuote is false, and provider quote time, bid and ask are
null. Submission start is the local method-call boundary, not proof of broker
receipt or exchange execution time. Quote-to-submission elapsed time includes
application work and is not broker execution latency. Wall-clock reversal or
missing timestamps must make elapsed-time analysis unavailable.

Logging is best-effort with visible errors. A kept candidate adds one awaited
log write, which can add latency under database contention. No extra provider
calls, schema migration, order parameters, sizing, ranking or stop rules change.
The watchdog previously counted every ExecutionLog row as a buy attempt; it now
counts only BUY_PLACED and BUY_FAILED so observations cannot suppress the
zero-buy warning. Its time window and alert criteria remain unchanged.

### Routine-run verification and remaining limits

After a scheduled run, inspect version-1 log payloads read-only. Match a kept
decision to its submission by decision ID, user, scan and ticker, and match
completion using account and broker order ID. Confirm skipped decisions persist
without creating orders. Missing submissions are not automatically missed fills:
later gates, attempt limits, crashes and log-write failures remain possible.
Use explicit downstream evidence before assigning any reason.

The quote wrapper and order handoff are covered by mocked production-function
tests, including forced refresh, response timing, rejected buys, absent evidence
and persistence failure. Temporary SQLite tests exercise the watchdog's actual
Prisma count and zero-buy warning. The full scheduled orchestration remains
source-inspected rather than executed end to end. No live job, broker request,
provider request or production data write was triggered during implementation.

This records a reference price, not executable bid/ask or verified fill-price
provenance. Those remain prerequisites for a credible entry-policy comparison.
The dashboard and execution-drag endpoint do not yet consume these new payloads.

## Fill-source capture and collection check

At 2026-09-11T14:34:38.612Z a read-only, query-only SQLite transaction inspected
208 ExecutionLog rows. All request payloads parsed as JSON; zero contained
version-1 entryReference evidence. This does not establish why collection has
not occurred. No trading session was invoked to manufacture observations, and
real decision-to-submission linkage remains unverified.

Subsequent completion records now include version-1 fillEvidence in responseBody.
The existing requestBody linkage and broker order ID remain unchanged. Evidence
includes user and decision identity, local observation time, the price and
quantity used by execution, and one of four source labels:

* ORDER_VALUE_OVER_QUANTITY: pending-order filled value divided by filled quantity
* PLANNED_ENTRY_FALLBACK: the planned entry substituted when filled value is absent
* HISTORY_HELPER: the existing historical-fill helper supplied the price
* TIMEOUT_RECOVERY: the existing timeout-recovery helper supplied the price

The timestamp is captured when the route accepts the fill, before stop handling,
not when the completion record is later written. It is not a broker execution
timestamp. Price basis remains UNVERIFIED. History helpers can themselves use
fallback calculations, so neither history label certifies a quantity-weighted
execution price. A planned fallback must never be treated as independent fill
evidence or as proof of zero slippage.

This is an additive log change only: price selection, fill acceptance, order
arguments, cancellation, protective stops and existing TradeLog fields remain
unchanged. No extra log writes or provider requests are added by fill capture.
Evidence is present only when the completion log succeeds; an unrecorded or
unresolved order does not gain a fabricated completion. Older records are not
backfilled. Dashboard metrics still require separate provenance-aware integration.

Focused tests exercise all four labels through executeTrade, verify observation
time before delayed stop handling, and assert unchanged buy, stop and timeout
behavior. Production capture, complete broker-fill reconciliation and executable
quote evidence remain unverified. No profitable entry policy has been selected.

## Provenance-aware entry-gap API

The execution-drag calculator now reads COMPLETE logs for the selected tickers
and associates them by exact tradeLogId. It requires position ID and ticker
agreement, a supported version-1 payload, matching user, used price and entry
shares, a nonempty order ID and a recognized invest/isa account label before
reporting a fill source. This checks internal consistency, not broker or account
reconciliation. No ticker/date approximation or historical backfill is used.

Records expose fillEvidenceStatus and the summary exposes fillEvidenceCounts
over records with valid planned entries and dates. PLANNED_ENTRY_FALLBACK and
INVALID_EVIDENCE produce null actualEntry, entrySlippagePct and entryGapR and
contribute nothing to fill counts or gap aggregates. Duplicated exact links,
including identical duplicates, are conservatively invalid. Malformed responses,
unsupported versions and mismatched linked evidence are also invalid.

Legacy rows without attributable completion evidence, or with a matching old
completion whose responseBody is null, retain their existing stored-fill metrics
as LEGACY_UNVERIFIED. Unreadable request JSON or a missing trade ID cannot be
attributed; these do not certify a fill or trigger approximate matching. A readable
exact trade ID with missing or malformed position identity is invalid instead.
Other source labels remain unverified, including their units and adjustment basis.
Summary means may therefore still include legacy unverified prices; source counts
make that mixture explicit. Query failures propagate instead of hiding the missing
evidence. The API does not return raw completion payloads or alter stored fills.

Fifty calculator/API tests passed, including fallback-only and mixed-sample
aggregation, all supported sources, invalid identity/quantity, duplicate/conflicting
evidence, query failure and JSON null serialization. Typecheck, scoped lint and
editor diagnostics passed. Database access was mocked in this phase; no live
endpoint, trading process or production collection check was run.

Manual follow-up: after routine execution, inspect exact linked completion records
read-only and confirm their API status. A planned fallback must return null gaps
and not increase withFills. The execution-quality dashboard uses execution-audit,
not this endpoint, so its display is unchanged. This repair prevents a known
fallback from appearing as a zero-gap fill; it does not establish profit uplift.

## Operational follow-up on September 11

The absence of new evidence has an observed explanation in today's session logs:
trading stopped at Health: RED before entry revalidation. US sessions at 14:45
and 17:00 UK reported BULLISH with 7 and 9 READY candidates respectively. Task
Scheduler reported successful completion; this was a gated exit, not a confirmed
scheduler failure. READY counts do not establish that orders should have filled.

The latest persisted health report has only A7 RED: PRTS has no sector, affecting
one of two open positions. Stored and checked-in cluster maps classify PRTS as
Consumer Discretionary. The seed assigns null sectors to HIGH_RISK-only stocks
and previously overwrote existing classifications with that null. Its update now
preserves an existing sector when the source is null; creation and explicit
source classifications are unchanged.

Sixty seed/health tests and static checks passed. No live data correction or
health/trading run was performed. The current PRTS gap therefore remains, pending
approval for a guarded one-row metadata correction and routine health reassessment.
Preserve every gate and do not substitute a forced GREEN result. This operational
repair path takes priority over tuning an entry policy from incomplete evidence.

## Approved live metadata correction

The later request to complete pending work autonomously authorized the described
PRTS correction. At 21:12:10.133Z on September 11, exactly one Stock row changed
from null sector to CONSUMER DISCRETIONARY, with updatedAt also updated. Identity,
prior timestamp and both classification fields were checked inside an immediate
transaction. The database was backed up first and both backup and live integrity
checks passed. Independent read-back confirmed both open positions have sectors.

The existing health report remains RED until normal reassessment; no report was
forced GREEN and no trading, health or broker job was manually invoked. This
supersedes the earlier pending-approval status for the metadata repair only.
It does not resolve the broader evidence requirements or prove profit improvement.

Combined verification passed 382 application tests across 22 suites, 26 research
tests and the project typecheck. The [work log](../docs/WORK_LOG.md) records the
backup and exact mutation boundaries. Next evidence comes from routine health and
execution, not from weakening gates or manufacturing retrospective fill records.

## Health reassessment and exact recovery

The subsequent request to finish the remaining work authorized a standalone run
of the existing health evaluator. At 22:11:12.457Z on September 11 it appended a
computed YELLOW report with sector coverage GREEN. This supersedes the earlier
pending-reassessment status. Existing C3 position-size, G2 cluster-concentration
and G3 sector-concentration warnings remain. No order was submitted or holding
resized to remove them, and no risk threshold or stored report was forced GREEN.

An unexpected import-time side effect also ran the existing historical price
pre-cache for 1,073 tickers; all completed. Future standalone checks should set
`HYBRIDTURTLE_SKIP_STARTUP_PRECACHE=true` before importing market-data dependants.
Independent read-back confirmed the YELLOW result, unchanged 208 execution logs,
two open positions, 28 closed positions and database quick_check = ok.

The legacy approximate candidate backfill has now been replaced with exact-ID
recovery. It consumes COMPLETE request identities, validates the scan/trade/user/
position/ticker relationship through the transactional linker, rejects duplicates
and competing claims, preserves existing links and counts only new writes.
Maintenance errors propagate; live execution attribution remains best-effort.
Existing scheduled and API callers use the replacement without configuration
changes. No production backfill or combined research refresh was run.

Unit, real SQLite and actual analytics POST tests cover exact recovery and
idempotence. The final combined run passed 350 application tests across 20 suites;
26 research tests, project typecheck, scoped lint and editor diagnostics passed.
All 30 Position rows and 145 TradeLog rows matched the retained pre-repair backup
by full-row hash, confirming unchanged accounting records. The
[work log](../docs/WORK_LOG.md#2026-09-11-exact-recovery-and-health-reassessment)
records verification and operational side effects.

## Completion ledger

| Workstream | Status | Remaining requirement |
| --- | --- | --- |
| Prospective closure accounting | Implemented and regression-tested | Observe exact broker evidence on a real closure; no historical profit certification |
| Automated attribution and safe recovery | Implemented and regression-tested | A new entry with explicit scan/trade/position identity |
| Entry reference, fill source and entry-gap API | Implemented and regression-tested | Collect real observations and independently reconcile price/currency basis |
| Enrichment ordering, evidence checks and durable cursor | Implemented and regression-tested | Mature prospective windows and observed sweep throughput |
| PRTS classification and seed recurrence prevention | Corrected and verified | Normal monitoring; no repeat repair required |
| Health reassessment | Completed, YELLOW with A7 GREEN | Preserve and monitor size/concentration warnings and all execution gates |
| Nine historical closure exceptions | Blocked on missing broker evidence | Complete account-scoped fill histories, lifecycle reconciliation and guarded correction proposal |
| Historical/manual candidate attribution | Blocked where original scan identity is absent | Original decision identity; never infer from latest scan, ticker, time or matching scores |
| Prospective manual attribution | Not implemented in this pass | End-to-end decision scan identity in the confirmation payload and validated persistence |
| Executable quote, missed-fill and cancellation research | Evidence incomplete | Independent bid/ask, execution times, price units, fees, FX and confirmed order outcomes |
| Ranking, entry and exit strategy comparison | Not validated | Credible paired data, frozen alternatives, costs, dependence-aware holdout and shadow evaluation |
| Dashboard provenance integration | Not implemented | Existing execution-quality page consumes a different API; do not claim the repaired API changed that page |
| Sector taxonomy normalization | Deliberately deferred | Reviewed taxonomy and concentration-impact analysis, not blanket metadata replacement |

At 22:17Z, coverage was 84,116 rows across 69 dates, but twenty-day labels still
covered only ten dates and there were zero linked entries. All nine closure
exceptions remained at the fresh read-only check: UNH, TKNO, GCBC, CLDX, HAYW,
DSFIR.AS, CCRN, PEBO and CRON. Counts are descriptive, not independent profit
evidence. No strategy settings were changed and no profit uplift is established.

The next reconciliation input is a Trading 212 ISA fill export covering the nine
instruments' complete holding lifecycles, including order/fill IDs, timestamps,
quantities, prices/currencies, fees/FX and wallet P&L. Do not provide credentials.
The detailed requirements remain in the
[historical reconciliation proposal](trade-exit-reconciliation-2026-09-10.md#repair-prerequisites-and-order).

## September 12 simulation update

The first isolated simulation phase is complete. The
[simulation report](trading-simulation-2026-09-12.md) records twelve fixed
development scenarios and their limitations. Backtest stop fills now account
for opening gaps, and stops after the selected time exit cannot overwrite that
exit. Live strategy settings and risk gates remain unchanged.

Both existing scoring modes produced identical aggregate results. The baseline
funded nine trades across four signal dates: modeled closed-trade P&L was
GBP184.19 with zero costs, GBP68.52 at 0.25% per side, and -GBP51.56 at 0.5%
per side. These are cost-sensitive simulated outcomes, not actual account profit
or evidence of an improved strategy. August-onward data was excluded before
evaluation.

The next deliverable is policy-aligned replay with an evidence-coverage report.
Validate price units, adjustment basis and timestamps; apply existing entry
rules only where historical inputs support them. Missing inputs must remain
unknown, not assumed passes. Then compare a small predefined set of alternatives
under equal risk and costs, preserving independent holdout evaluation.

Manual scan attribution and dashboard provenance integration remain separate
software tasks and do not depend on resolving the nine historical closures.
The connected synthetic evidence fixture verifies module contracts, but a full
scan-to-close simulation and real execution validation remain outstanding.