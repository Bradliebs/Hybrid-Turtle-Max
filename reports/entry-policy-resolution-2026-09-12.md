---
title: Entry Policy Resolution and Remaining Evidence
description: Current-policy screening of isolated historical replay and explicit blockers to historical reconciliation and strategy promotion.
ms.date: 2026-09-12
---

## Decision

No live strategy change is validated. The offline experiment resolves one
question: the existing trigger-crossing simulation includes many candidates
that fail observable necessary conditions of the current A-grade rule. Adding
those conditions does not establish profitable performance after costs.

The nine broker-supported accounting corrections were approved and applied.
SCHW's final stop order and fill are confirmed.
See the [application report](broker-closure-applied-2026-09-12.md).
Full execution-policy parity remains blocked on missing evidence. Do not
substitute modeled fills for broker records, alter original risk distances,
increase risk, or loosen gates.

## Experiment

The [retained machine-readable result](entry-policy-screen-2026-09-12.json)
contains the original 12 scenarios and 12 additional policy-screen cases.
Signals are May 1 through June 30, 2026. The existing sandbox removes August 1
onward before replay and drops account tables. It blocks network access, opens
the source read-only and verifies that the sanitized sandbox stays byte-identical.

The research screen reuses production score thresholds and checks regime,
blocking statuses, confirmed trigger, NCS, BQS, FWS, volume, relative strength
and ATR spike. Synthetic parity tests compare these decisions with the actual
production classifier. No production decision function was modified.

All 1,224 trigger-crossing observations had exactly one ticker/timestamp snapshot
match. That establishes record identity, not point-in-time data provenance.
Snapshot columns can contain schema defaults; scores are recomputed research
scores rather than certified execution-time scores. The four volume thresholds
are existing execution-session values, applied to stored snapshot volume as
sensitivity cases. They do not reconstruct historical intraday sessions.

Every non-rejected observation remains `INCOMPLETE`. Health, complete technical
filters, all six portfolio gates, sizing, session routing, existing holdings,
fresh prices and execution technicals, anti-chase, attainable fills and costs
have not been fully reconstructed. There is deliberately no eligible verdict.

## Results

All amounts below are exploratory closed-trade GBP P&L in the existing
GBP 10,000 model, with 2% modeled risk per trade and four concurrent slots.
Live account settings were not changed. Costs are adverse percentages per side,
not observed broker charges. Subset results assume incomplete candidates can
be traded; they are not deployable strategy returns.

| Screen volume threshold | Rejected | Incomplete | Funded trades | Entry dates | 0% cost | 0.25% cost | 0.5% cost |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 0.15 | 921 | 303 | 9 | 4 | 91.73 | -19.30 | -117.78 |
| 0.40 | 928 | 296 | 9 | 4 | 91.73 | -19.30 | -117.78 |
| 0.50 | 929 | 295 | 10 | 5 | 143.03 | 19.25 | -96.03 |
| 0.60 | 933 | 291 | 10 | 5 | 143.03 | 19.25 | -96.03 |

The unchanged FULL trigger-only baseline funds nine trades on four entry dates:
GBP 184.19, 68.52 and -51.56 respectively. The screened variants are worse in
this small, incomplete model. Neither result proves the live policy good or bad.
Do not select the apparently better volume threshold or discard safety checks
based on these development results.

At 0.15 volume, rejection reasons are NCS 713, relative strength 434, ATR spike
318, BQS 219, FWS 19 and volume 9. Reasons overlap, so their counts must not be
added to obtain rejected candidates. These are snapshot-screen failures, not
proof that historical automated buys violated their then-current rules.

The existing simulation's other limitations remain: close-as-fill assumptions,
uncertified bar adjustment and metadata provenance, approximate calendar-day
exits, outcome/FX coverage that can affect selection, and incomplete portfolio
marking. No independent holdout or new strategy challenger was evaluated.

## Resolution checklist

| Concern | Status | Evidence or requirement |
| --- | --- | --- |
| Trigger-only simulation mistaken for live policy | Addressed in research | Explicit necessary-condition screen, exact snapshot matching and incomplete verdicts |
| Profitable entry-rule improvement | Not established | Screened P&L fails the higher-cost scenario; no threshold promoted |
| Historical nine accounting exceptions | Applied and verified | Nine positions, six log updates and three inserts; backup verified and repeat run changes nothing |
| SCHW stop-to-fill difference | Final order confirmed | Broker STOP 110.84 filled at 108.21; opening gap corroborated |
| Historical trigger movement called execution cost | Not measurable | No contemporaneous executable quotes; do not subtract it again from P&L |
| Original risk for imported holdings | Unknown | Original orders/stops needed; stored 5% fallback is not original-risk evidence |
| Full policy replay and independent validation | Blocked | Point-in-time technical, session, portfolio and execution evidence remains incomplete |

## Broker evidence needed

The initial export blocker was superseded by a bounded GET-only collection
using the already-configured live ISA integration. Account identity matched;
749 records across 15 pages exhausted the available order-history pagination.
Raw evidence stays in Git-ignored backups. No separate export is needed for
the nine applied closure corrections. Additional corporate-action, original
risk and historical quote evidence remains necessary for broader performance
claims. No API credentials need to be shared.

Two closure-selector false-rejection cases were fixed and tested: explicitly
unfilled cancelled sells, and later same-ticker lifecycle sells. The approved
historical repair used a verified backup, expected-state transaction and
idempotence checks. See the
[reconciliation prerequisites](trade-exit-reconciliation-2026-09-10.md).

## Verification

* Final opted-in replay and screen suite: 35 tests passed, including network
  exclusion, sandbox byte preservation and opening-gap stress.
* Screen plus production classifier suite: 64 tests passed, including parity.
* Project typecheck and scoped ESLint passed.
* Before the approved repair, the read-only baseline recheck retained all nine
  exceptions and fingerprint
  `a125d38675bd5eeebb52a9d8a902c73be89bb15e3eac58d8bf56abe0bc10a4f0`.
* An accidental duplicate report-writing invocation was refused with `EEXIST`.
  The original result was preserved; the final rerun without a report destination
  passed. No overwrite guard was weakened.

Reproduce without overwriting the retained report:

```powershell
try {
  $env:HT_SIMULATION_SOURCE = 'prisma/dev.db'
  Remove-Item Env:HT_SIMULATION_REPORT -ErrorAction SilentlyContinue
  npx vitest run scripts/entry-policy-screen.test.ts scripts/trading-simulation.test.ts --silent
} finally {
  Remove-Item Env:HT_SIMULATION_SOURCE -ErrorAction SilentlyContinue
}
```

To retain a separate run, set `HT_SIMULATION_REPORT` to a new, unused filename.
The replay is research-only and did not write source records. A separate approved
step subsequently repaired the nine historical closures as linked above.
No broker orders, sacred files, automation or live trading thresholds changed.
Shared closure evidence selection was corrected as described above. Broker GET
calls can update the existing local quota telemetry. No commit or push was performed.