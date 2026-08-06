---
title: HybridTurtle Simplification Plan
description: Evidence-led controls for reducing complexity without weakening trading safety or automation
author: HybridTurtle
ms.date: 2026-08-05
ms.topic: concept
keywords:
  - simplification
  - complexity budget
  - operations
  - lifecycle
estimated_reading_time: 7
---

## Decision

HybridTurtle operates under a net-zero complexity budget until the first
simplification review is complete. New pages, API routes, Prisma models,
scheduled tasks, feature flags, and navigation destinations require an explicit
replacement or a documented safety exception.

This policy protects the execution spine while reducing advisory and operator
surface area. It is not permission to remove working automation or refactor
money logic.

## Protected Boundary

The following behavior remains unchanged throughout the simplification work:

* All six risk gates must pass
* Stops never decrease
* Position sizing uses `floorShares()`
* Regime confirmation requires three consecutive bullish days
* Weekday and weekend execution gates remain enforced
* The seven-stage scan pipeline keeps its current order
* Yahoo Finance remains the primary market data source
* Broker sync, backup, watchdog, heartbeat, health checks, and Telegram safety
  alerts remain operational
* Advisory modules do not mutate execution behavior

Sacred files are outside the initial inventory and retirement phases. A verified
defect may justify a separate, tested change under the sacred-file rules.

## Current Baseline

Run the checked-in inventory:

```powershell
npm run complexity:audit
```

The 2026-08-05 baseline contains:

| Surface | Count |
|---------|------:|
| Pages | 37 |
| API routes | 138 |
| Prisma models | 62 |
| Expected scheduled tasks | 17 |
| Feature flags | 3 |
| Navigation destinations | 27 |
| Source tests | 124 |

Counts are tripwires, not goals. A reduction is not automatically safe, and a
necessary safety addition is not automatically waste. The audit makes growth
visible so it must be explained.

Retirement batch 1 completed on 2026-08-05. Fast Follower, Momentum Expansion,
and Benchmark Scan Mode were removed after source tracing confirmed that they
were disabled or unreachable. The batch also removed the now-empty feature-flag
API and Settings panel. Production scan behavior and current risk limits were
unchanged.

## Classification Vocabulary

Every reviewed surface receives one disposition:

| Disposition | Meaning |
|-------------|---------|
| `KEEP` | Active, distinct, and tied to a core job or safety requirement |
| `CONSOLIDATE` | Useful output duplicates or fragments another maintained surface |
| `QUARANTINE` | Experiment is preserved but removed from normal UI or scheduled computation |
| `RETIRE` | No active consumer, evidence value, or operational requirement remains |
| `UNKNOWN` | Runtime use or dependency evidence is not sufficient for a decision |

Each decision records the owning system job, consumer, persistent state,
failure impact, evidence, rollback method, and review date.

## Review Order

Review surfaces in the following order. This sequence starts with reversible,
non-executing candidates and leaves persistence and automation until their
dependencies are proven.

Preliminary dispositions and their current evidence are recorded in the
[simplification decision ledger](./simplification-decision-ledger.json). The
ledger is not removal authorization because operator usage evidence is still
missing.

1. Three disabled feature flags and their guarded modules
2. Research and system navigation destinations outside the five primary views
3. Advisory computations with no displayed, recorded, or reviewed consumer
4. Analytics pages and API routes that answer the same operator question
5. Alerts and Telegram messages that do not cause a distinct action
6. Prisma models with no current reader or writer
7. Scheduled jobs only after one complete runtime observation and dependency trace

The five primary views are Dashboard, Portfolio, Scan, Plan, and Risk. Research
and system tools may remain available, but they should not compete with the
daily trading path.

## Evidence Required

A static import search is not enough to retire a surface. Collect the strongest
available evidence:

* Direct execution or route-access evidence
* API consumers in UI, scripts, jobs, or external integrations
* Database readers, writers, retention requirements, and export dependencies
* Scheduled-task results and heartbeat records
* Operator confirmation for reports, alerts, and manual workflows
* Tests that encode behavior or invariants

When evidence is incomplete, use `UNKNOWN` or `QUARANTINE`. Do not infer that
an unseen operational consumer does not exist.

## Retirement Protocol

Each retirement batch must be small and reversible:

1. Record the surface, reason, evidence, and rollback method.
2. Trace direct callers, scheduled jobs, persistence, exports, and alerts.
3. Quarantine for one normal review cycle when runtime use is uncertain.
4. Remove the smallest coherent batch.
5. Run focused tests, type checking, lint, the full unit suite, scheduler audit,
   and smoke test.
6. Observe one normal operating cycle before starting another operational batch.

Never combine scheduler retirement, schema deletion, and sacred trading changes
in one batch.

## Experiment Contract

New experimental or advisory work must declare:

* The operator question it answers
* The existing output it replaces or complements
* Its owner
* Its decision consumer
* The minimum sample and success metric
* An expiry date
* Predeclared `PASS`, `FAIL`, and `INCONCLUSIVE` outcomes
* Its quarantine and removal path

Expired experiments default to quarantine. They do not become permanent because
code already exists.

## Acceptance Gates

The first simplification review is complete when:

* Every execution and scheduled surface is classified
* At least 90 percent of remaining surfaces are classified
* Every `UNKNOWN` has an owner and review date
* Normal trading actions remain reachable through the five primary views
* No protected invariant changes
* `npm run simplification:audit` passes
* `npm run complexity:audit` passes
* `npm run typecheck`, `npm run lint`, and `npm run test:unit` pass
* `npm run tasks:audit` and `npm run smoke` pass

## Next Review Questions

The next review should answer these questions before another retirement or
consolidation batch:

1. Which of the 20 secondary research and system destinations were used in the
   last 30 days?
2. Which prediction outputs have changed a review decision, rather than only
   adding another score?
3. Which alerts or reports produce the same action as a stronger existing signal?
4. Which persistence models exist only for experiments that cannot yet meet
   their own sample threshold?

The answers produce the next `KEEP`, `QUARANTINE`, `CONSOLIDATE`, and `RETIRE`
batch. They do not authorize changes to the execution spine.