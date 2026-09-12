---
title: Trade Exit Reconciliation Proposal
description: Read-only exception evidence and prerequisites for correcting incomplete trade outcomes.
ms.date: 2026-09-10
---

## Decision

The diagnostic sections below describe the pre-repair snapshot. The
[authorized implementation](#2026-09-10-authorized-prospective-repair) supersedes
their descriptions of current production code, not their historical evidence.

Do not repair historical P&L from the currently inspected records. Nine closed
positions require account-scoped fill evidence. The reporting script now exposes
these as `periodPositions.reconciliationQueue`, with stable position IDs and
`repairAuthorized: false`. This is an exception list, not a verified-profit list:
an empty queue does not prove complete fees, correct attribution, or net return.

The original [performance baseline](trade-performance-review-2026-09-10.md)
remains descriptive. No risk, entry, ranking, stop, automation, or broker behavior
was changed. No database updates, imports, backfills, or broker requests were run.

## Local evidence

The cutoff remains September 10, 2026 at 15:25 UTC, with an entry cohort beginning
March 10. The selected source evidence has unchanged SHA-256 fingerprint:

```text
a08cf437ae8dc49e402a2164e84c72723e780330dc474540aba0bc98737bc540
```

All nine exceptions are stored as ISA positions. Dates below are stored entry and
closure dates in UTC, not proof of broker execution times. Synced entries may be
discovery dates rather than original purchase dates. Position shares may also
have changed during earlier syncs; a mismatch does not establish which record is
wrong or how many shares were actually sold over the entire holding period.

| Ticker | Stored entry | Recorded closure | Position shares | Linked sell shares | Evidence needed |
| --- | --- | --- | ---: | ---: | --- |
| UNH | 2026-05-12 | 2026-05-18 | 0.72 | Unavailable | Missing exit and outcome |
| TKNO | 2026-05-29 | 2026-06-02 | 30.84 | 4.73 | Complete quantity history |
| GCBC | 2026-06-08 | 2026-06-16 | 9 | 3.305 | Complete quantity history |
| CLDX | 2026-06-30 | 2026-07-02 | 6.98 | 0.889 | Complete quantity history |
| HAYW | 2026-06-30 | 2026-07-07 | 15.38 | 1.607 | Complete quantity history |
| DSFIR.AS | 2026-07-01 | 2026-07-23 | 5.59 | 5.59 | Missing broker exit provenance |
| CCRN | 2026-07-16 | 2026-08-04 | 10.22 | Unavailable | Missing exit and outcome |
| PEBO | 2026-07-16 | 2026-07-17 | 3.41 | 1.929 | Complete quantity history |
| CRON | 2026-08-25 | 2026-09-02 | 10.73 | Unavailable | Missing exit and outcome |

TradeLog searches for these stored tickers found no sell rows for UNH, CCRN or
CRON and no additional exits resolving the five quantity mismatches. This is not
proof that differently named records, external statements, or broker fills do
not exist. The queue itself uses exact `positionId` links, never ticker proximity.

ExecutionLog has `COMPLETE` buy records with matching quantities for CLDX, HAYW,
CCRN, PEBO and CRON, but those are application records, not independent fill
confirmations. TKNO has a buy timeout. DSFIR.AS has two timed-out buy attempts
whose quantities sum to 5.59. Neither timeout proves cancellation or execution;
do not count these as missed opportunities without broker confirmation.

## Mechanisms found

### Closures can bypass outcome reconciliation

The [account-sync closure branch](../src/app/api/trading212/sync/route.ts#L337)
sets only status, closure time and the reason `Closed on Trading 212 (ISA)` when
a successfully fetched account no longer contains a tracked holding. It does
not populate exit price or P&L, or create an exit TradeLog.

UNH, CCRN and CRON have that exact reason and missing outcomes. The separate
`syncClosedPositions` routine in [position-sync](../src/lib/position-sync.ts#L435)
selects OPEN positions, so already-CLOSED rows are not picked up by that routine.
This is a verified current-code failure path; historical call traces were not
replayed. Do not reopen closed holdings merely to trigger reconciliation: that
would affect position management and risk capacity.

### One sell order is not a complete position lifecycle

The [exit selector](../src/lib/position-sync.ts#L878) selects the latest FILLED
sell for the broker ticker. Inside this selector there is no entry-date or
position-quantity comparison and no aggregation across sell orders. Its caller
[copies that order's wallet P&L](../src/lib/position-sync.ts#L745) into both the
Position and exit TradeLog. Agreement between these values is shared-writer
consistency, not independent account reconciliation.

If no sell is selected, the selector returns entry price with UNKNOWN confidence.
The caller can consequently persist zero price-based P&L. DSFIR.AS has this data
shape: entry equals exit, with no broker order ID, fill timestamp, or broker P&L.
The fallback is confirmed in current code; its historical execution for DSFIR.AS
is inferred, not proven by a captured call trace. Treat the zero as unverified.

### Historical order records actually represent individual fills

Further inspection of [getOrderHistory](../src/lib/trading212.ts#L472) narrows
the quantity-mismatch mechanism. Each raw `{ order, fill }` pair becomes a
separate `T212HistoricalOrder` with the same order ID but the individual fill's
quantity, value, timestamp and wallet P&L. `quantity` retains the order quantity,
while `filledQuantity` is just the individual fill quantity. The raw fill ID
is discarded. Consumers cannot treat each returned record as a complete order
or deduplicate by order ID without potentially dropping distinct fills.

The closure selector takes the latest of these records, so even a fully filled
sell order may contribute only its final partial fill to the recorded position
outcome. Separately, [sync's history calls](../src/lib/position-sync.ts#L548)
use `maxPages: 1`; earlier fills can be on an unfetched page. Increasing the
page limit alone would not fix latest-record selection or lost fill identity.

Two mocked characterization cases in
[the broker client tests](../src/lib/trading212.test.ts) exercise the actual
client transformation without making broker requests:

| Synthetic 10-share order | Records returned | Sum of fill shares | Sum of fill P&L |
| --- | ---: | ---: | ---: |
| Final fill page only | 1 | 2 | GBP 1 |
| Both fill pages | 2, same order ID | 10 | GBP 5 |

The final record still has `quantity: 10` but `filledQuantity: 2`, and contains
only GBP 1 of wallet P&L. These tests describe the current client contract,
not desired whole-position reconciliation behavior. They prove the mechanism
under controlled input, not its historical occurrence for the five mismatches.

No full order-history artifact was found in the inspected `prisma/cache`,
`data` or `reports` folders. The inspected client method fetches pages without
persisting the raw history. This search did not cover external downloads,
database backups or other uninspected directories. The broker export remains
necessary unless an independent raw-history artifact is supplied.

### Candidate backfill cannot establish exact attribution

The [backfill query](../src/lib/candidate-outcome.ts#L322) accepts only EXECUTED
and BUY, while every TradeLog decision in the baseline interval is TAKEN.
The exact `linkTradeToOutcome` helper has no other symbol occurrence under
`src`, so no direct caller was found there. These observations explain why the
available paths do not populate the observed links; they do not establish every
historical invocation or external consumer.

Adding TAKEN to the backfill alone is unsafe: it has no ENTRY-only restriction
and links all unlinked same-ticker candidates within two days before or after
the trade. That can attribute exit logs and post-trade scans as decision inputs.
Do not run this backfill as a repair. Require the actual decision scan ID and
exact entry TradeLog/position identity before linking a historical candidate.

## Repair prerequisites and order

1. Obtain a read-only Trading 212 ISA export through the cutoff covering buys,
   sells and corporate actions for all nine instruments, including original
   purchases predating the local entry dates. Start with January 1 through
   September 10, 2026 and extend earlier for carried holdings. Include broker
   instrument IDs (DSFIR.AS is stored as `DSMa_EQ`), account and live/demo context,
   order IDs, unique fill IDs, UTC timestamps, side, quantity, price and currency,
   fees, FX, proceeds and realized wallet P&L. Do not provide API credentials.
2. Reconcile each account/instrument lifecycle independently. Deduplicate fills,
   distinguish repeated purchases and partial sales, account for corporate
   actions, and prove opening quantity plus buys minus sells reconciles to the
   closing holding. Do not multiply one partial fill's P&L by a quantity ratio.
   Preserve broker fill IDs before aggregation, retain account/environment
   identity, and record whether pagination covered the complete lifecycle.
   Do not use order-ID uniqueness or a FILLED status as proof of complete fills.
3. Produce a per-position old/new proposal with source fill IDs and unresolved
   fields. Aggregate only attributable fill P&L without double-counting fees.
   Preserve missing values where proof is absent. Do not overwrite initial risk
   or invent a full-trade R for mixed lots or partial exits.
4. Separately approve any historical write after a restorable backup, dry run,
   expected-old-value checks and an idempotent transaction design. Re-run the
   baseline afterward and explicitly record the changed source fingerprint.
5. Separately scope prospective closure repair and exact scan-to-entry linkage.
   Preserve broker absence guards, account isolation, position status/risk
   behavior and stop management. Regression tests must cover a holding closed
   by account sync before reconciliation, partial sells, prior-lifecycle sells,
   absent broker evidence, and ambiguous candidate identity. Add same-order
   fills split across pages, duplicate raw fill IDs, truncated history, and
   account/environment isolation. Preserve quota limits; missing evidence must
   stay unresolved rather than triggering unbounded broker polling. No such
   production repair is included in this reporting and test change.

## Reproduction and verification

Run the same read-only entry-cohort report and inspect its reconciliation queue:

```powershell
node scripts/trade-performance-baseline.mjs prisma/dev.db 2026-03-10T00:00:00.000Z 2026-09-10T15:25:00.000Z
node --test scripts/trade-performance-baseline.test.mjs
npx eslint scripts/trade-performance-baseline.mjs scripts/trade-performance-baseline.test.mjs
npx vitest run src/lib/trading212.test.ts
npm run typecheck
```

All 12 tests passed, including read-only SQLite byte preservation, deterministic
fingerprinting, missing outcomes, partial quantities, duplicate exits and fill
dates outside the stored holding window. Scoped ESLint and project typecheck
passed. A local read asserted exactly the nine tickers above and the unchanged
fingerprint. The fingerprint covers the baseline query, not supplemental
ExecutionLog reads or the source code. Automation can change it on later runs.

The subsequent broker-client characterization run passed all 31 tests,
including both added multi-fill/page-limit cases. Those cases use mocked fetch
responses and do not verify the broker's current external API contract or any
particular historical fill. No production code was changed.

The full application suite and broker-dependent workflows were not run: no
production modules changed. Manual review remains required against the broker
export before any correction. This queue catches selected internal inconsistencies;
it does not certify account provenance, complete lifecycle coverage or performance.

## 2026-09-10 authorized prospective repair

After the user authorized the necessary changes, the prospective closure path
was updated. Historical records were not rewritten. No live database writes,
broker requests, orders, imports, migrations or scheduler changes were executed
during implementation. Trading rules and sacred files remain unchanged.

### Implemented behavior

* [The history client](../src/lib/trading212.ts) now preserves each raw fill ID
   and wallet currency. Its per-fill return shape and pagination remain unchanged.
* [Closure evidence validation](../src/lib/closure-evidence.ts) deduplicates
   identical fill IDs and rejects conflicting duplicates. It requires one FILLED
   sell order, matching tracked quantity, complete distinct-fill quantity, valid
   prices and timestamps within the stored holding window, and explicit GBP
   wallet P&L on every fill. It sums P&L and weights exit price by fill quantity.
* [Scheduled reconciliation](../src/lib/position-sync.ts) separates Invest and
   ISA holdings and history. It rejects missing or failed owning-account evidence
   and suppresses ISA accounting when credentials duplicate Invest. Calls remain
   bounded to one history page per eligible account.
* Both scheduled reconciliation and
   [account sync](../src/app/api/trading212/sync/route.ts) record missing accounting
   as `PENDING_BROKER_RECONCILIATION`, with null exit/P&L fields and an environment
   marker. Holdings remain CLOSED, not reopened for accounting. Scheduled sync
   retries only these newly marked closures in the same environment.
* Incomplete evidence produces a warning, not an exit TradeLog or EV observation.
   Complete accounting uses the actual last fill timestamp. Entry-price and
   approximate-FX fallbacks were removed from this closure path.
* Complete Position and exit TradeLog writes share a transaction; log failures
   now propagate instead of committing partial accounting. Conditional updates
   reject stale position state. Missing R does not become a zero-R EV observation.

### Verification and limits

The changed accounting slice passed 71 Vitest tests across the history client,
closure helper, scheduled sync and account-sync route. Adjacent midday-sync,
position-merge and synced-risk tests passed 31 cases. The read-only baseline
suite passed all 12 cases. Project typecheck, scoped ESLint and editor diagnostics
passed. Broker calls and database writes in application tests were mocked;
transaction failure propagation and write filters were tested, not a concurrent
live-database run. The full application suite was not run.

This accepts only a narrow one-order match against the stored position. It does
not prove an entire account lifecycle, validate original entry quantities or risk,
repair earlier partial sales, reconcile corporate actions, or certify net returns.
It does not persist a raw fill archive. Multiple sell orders, missing pages,
non-GBP wallet data and uncertain attribution stay unresolved. Current holding
presence can also prevent retry of an older same-ticker pending closure.

The environment marker prevents retries across a live/demo change for newly
pending closures; it does not establish the historical environment of OPEN rows
or protect against a different broker account replacing credentials within the
same account slot. The legacy globally unique TradeLog order-ID constraint can
reject a conflicting import or account order ID; the transaction fails visibly
instead of reusing an unrelated log. These limitations need independent account
evidence, not guessed corrections or wider polling.

For operational verification, inspect the next routine sync result and pending
warnings without placing a test trade. Compare any completed accounting against
the owning account's fill statement. Pending rows must retain null outcomes and
must not gain an exit log or EV record until accepted evidence is available.
The existing all-empty-broker guard remains in scheduled OPEN-position closure;
the account-sync route retains its successful-position-fetch guard.

The next performance-analysis step remains obtaining the nine positions' complete
ISA lifecycle evidence, then reviewing an explicit historical correction proposal.
No entry, exit, ranking or risk parameter was tuned from the descriptive baseline.