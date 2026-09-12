---
title: Broker-Supported Historical Closure Proposal
description: Read-only ISA reconciliation findings, proposed accounting corrections and verified closure-selector fixes.
ms.date: 2026-09-12
---

## Decision

Status update: the user subsequently approved these nine corrections and they
were applied. See the [application and verification report](broker-closure-applied-2026-09-12.md).
The proposal below is retained as the pre-approval record; its pending wording
describes that earlier stage, not the current database.

Complete available Trading 212 order history now supports proposed corrections
for all nine historical exceptions. These are not applied. Review the table
before a separate backup-backed, expected-old-value, idempotent database repair.
Do not reopen positions, replace original risk distances, or send broker orders.

This supersedes the export-unavailable blocker in the earlier
[lifecycle review](trade-lifecycle-review-2026-09-12.md) and the initial
[resolution work](entry-policy-resolution-2026-09-12.md). The user was unavailable;
existing credentials were used only through constrained read-only calls.

## Evidence custody

The broker returned 749 order/fill records over 15 pages, ending pagination.
The account-summary response matched the configured live ISA account and GBP
currency. Authentication material and the account ID were not printed. Raw
responses and normalized fills are retained under the Git-ignored
`prisma/backups/` directory, separate from public research results.

Complete archive: `broker-reconciliation-full-2026-09-12.json` in that directory.
SHA-256:

```text
0a41156bd2f757e48f531d8eca86ea7d4f3a9852e1c293cd0318abb772be2e1b
```

An earlier eight-page archive is explicitly incomplete and must not be used as
the complete source. The collection cap is 16 history pages and 19 total
requests per invocation. GET-only allowlisting, redirect blocking, per-request
timeouts and the existing client pacing prevent order mutation or unbounded
collection. Across the successful identity probe and two collection runs,
26 GET requests were made. Existing quota telemetry may update normally.

Endpoint exhaustion establishes completeness of the returned order-history
pagination, not a full account audit. Corporate actions, dividends, cash flows,
original imported risk and historical executable quotes are not certified here.

## Proposed corrections

GBP P&L is the sum of unique broker fill wallet P&L. Exit price is the
quantity-weighted fill price. Proposed R retains each position's existing
`initial_R ?? initialRisk`; this does not establish original risk for imported
holdings. Missing old values are unknown, not zero. Numbers are rounded only
for this table; any repair must use the unrounded evidence.

| Ticker | Old GBP | Proposed GBP | Old R | Proposed R | Actual exit UTC date | Broker order ID | Unique fills |
| --- | ---: | ---: | ---: | ---: | --- | ---: | ---: |
| UNH | unknown | -2.15 | unknown | -0.421625 | 2026-05-18 | 51064787629 | 1 |
| TKNO | 0.65 | 5.60 | 0.854874 | 1.108141 | 2026-06-02 | 51820280473 | 2 |
| GCBC | 1.37 | 2.41 | 0.501944 | 0.367739 | 2026-06-16 | 52522044922 | 2 |
| CLDX | -1.77 | -14.57 | -1.047206 | -1.104460 | 2026-07-02 | 53460865768 | 3 |
| HAYW | -1.13 | -10.90 | -0.928417 | -0.938997 | 2026-07-07 | 53565199834 | 2 |
| DSFIR.AS | 0.00 | -6.57 | 0.000000 | -0.167212 | 2026-07-23 | 54511302683 | 1 |
| CCRN | unknown | 0.97 | unknown | 0.007388 | 2026-07-23 | 54563439464 | 1 |
| PEBO | -1.43 | -2.61 | -0.932460 | -0.966038 | 2026-07-17 | 54261752626 | 2 |
| CRON | unknown | -0.92 | unknown | -0.650930 | 2026-08-27 | 56309129372 | 1 |

CCRN's broker exit is July 23, not the application's August 4 discovery of
absence. CRON's exit is August 27, not September 2. CCRN used a MARKET order;
do not label that exit a stop hit. The other eight proposed exits are STOP orders.

Applying only these nine changes would produce 28 measured closures, 10 wins,
18 losses, -4.905926R total, -0.175212R mean and a GBP -42.36 closed-position
subtotal. Current stored values remain 25 measured, -3.691197R and GBP -15.93.
This would correct previously understated losses; it would not represent new
trading losses caused by the repair or verified net account return.

All 28 closed ISA positions produce complete single-order closure candidates
under the corrected selector. The other 19 stored GBP results match the broker
fill sums within one penny and are not proposed for change.

## SCHW confirmation

Broker order 56261421177 is a STOP order at 110.84, filled at 108.21 on August
26 at 13:30:25 UTC, fill ID 56304878896. Quantity is 1.04 and wallet P&L is
GBP -1.00, matching the stored outcome. This strengthens the existing opening-gap
explanation: the cached session open is 108.25 and high is below the stop.
No SCHW accounting correction is proposed. Full amendment acknowledgements and
historical bid/ask prices are still not reconstructed.

## Code fixes

The shared closure selector had two conservative false-rejection cases:

* CANCELLED sells with zero filled quantity/value and no fills were rejected
  for missing fill dates. Thirty-five such records affected the inspected
  instruments. They are now excluded; ambiguous cancellations or any fill
  evidence remain subject to conservative validation.
* Sells from later same-ticker lifecycles were included when reconciling an
  earlier closure. Selection now respects both entry and recorded closure time.
  A repeated CYRX lifecycle supplied the concrete historical example.

The fixes change evidence selection, not risk, entry signals or stops. Existing
quantity, unique fill ID, duplicate conflict, single-order, time-window and GBP
requirements remain. No historical records were changed by running the checks.

## Verification and remaining decision

* Closure evidence and position-sync regression suites: 43 tests passed.
* Collector safety suite: 8 tests passed with no broker calls in those tests.
* Typecheck and scoped lint passed.
* Actual read-only dry run: all 28 closure candidates matched; 19 other GBP
  values unchanged; nine corrections supported by full-quantity unique fills.
* Raw evidence files confirmed Git-ignored; no credentials or raw account ID
  are included in the tracked reports.

Before applying, make a consistent SQLite backup and retain the source evidence
hash. Recheck account scope and each exact position/exit-log identity. Use an
expected-old-value transaction, update or create the exact linked exit log,
preserve original risk and CLOSED status, and make a repeat application a no-op.
Re-run the baseline and preserve both before/after fingerprints. This write
requires separate review; the current user request has been handled up to that
historical-accounting approval boundary.