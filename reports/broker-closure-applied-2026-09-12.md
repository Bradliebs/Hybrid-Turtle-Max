---
title: Approved Historical Closure Corrections Applied
description: Verified application of nine broker-supported accounting corrections with backup and repeat-run evidence.
ms.date: 2026-09-12
---

## Outcome

The user approved the nine corrections with "Go for it" after the explicit
accounting approval request. All nine were applied in one Prisma transaction.
Six existing exit logs were updated and three missing exit logs were created.
No positions were reopened and no broker requests were made during the repair.

| Metric | Before | After |
| --- | ---: | ---: |
| Measured closed ISA positions | 25 | 28 |
| Wins | 9 | 10 |
| Losses | 15 | 18 |
| Flat outcomes | 1 | 0 |
| Total R | -3.691197 | -4.905926 |
| Mean R | -0.147648 | -0.175212 |
| Closed-position GBP subtotal | -15.93 | -42.36 |

These are corrected historical results, not new losses caused by the repair.
The GBP subtotal is not net account return. Existing original-risk denominators
were preserved, including imported positions whose original risk is unverified.

The [approved proposal](broker-closure-proposal-2026-09-12.md) retains all nine
old/new values and broker order IDs. UNH, CCRN and CRON now have exit logs.
CCRN is an EXIT, not a STOP_HIT; its actual exit date is July 23. CRON's actual
exit date is August 27. DSFIR.AS is now correctly recorded as a stop exit.
SCHW and the other 18 non-target closed positions were not changed.

## Safeguards and recovery

The [standalone repair](../scripts/apply-broker-closure-corrections.ts) is dry-run
by default. It pins the reviewed archive hash, nine position identities, broker
order IDs and old/new outcomes. It checks the configured live ISA identity,
CLOSED status, original risk, full-quantity fills and exit-log ownership.
All target records and linked logs are reread inside the transaction and must
match the prepared snapshot before any write. Postconditions run before commit.

Recovery artifacts are local and Git-ignored under
`prisma/backups/closure-corrections-2026-09-12-approved/`:

* `before.db`: consistent SQLite backup, verified with `integrity_check`
* `intent.json`: exact before records, intended updates and broker fill IDs
* `receipt.json`: successful nine-correction application result

Backup SHA-256:

```text
2f5e09a9733f8f3bc92b3ac2d2802b857af35828023eb898f2fdf443fb071cae
```

Broker archive SHA-256:

```text
0a41156bd2f757e48f531d8eca86ea7d4f3a9852e1c293cd0318abb772be2e1b
```

Retain these artifacts. Do not overwrite a running database with the backup:
any recovery requires stopping writers, preserving the current database and
its journal files, and reviewing changes since this backup. A full restore
would also discard subsequent legitimate activity.

## Verification

* All 13 repair tests passed, including an opted-in rehearsal on a disposable
  source copy. A forced mid-transaction failure rolled back every position and
  log change. The successful backup exactly retained the original records.
* The copy rehearsal preserved all other positions/logs, original entry/risk,
  shares and stop history. Repeating application left the copy byte-identical.
* Typecheck, scoped ESLint and editor diagnostics passed.
* Independent live-versus-backup comparison verified exactly nine position
  changes, six exit-log updates and three inserts, with no deleted records.
  Only permitted fields changed; all other positions/logs and stop-history
  rows were identical. Original risk, entry data, shares and stops were unchanged.
* Live SQLite integrity check returned `ok`; final totals match the table.
* Repeating the live apply command returned `pending: 0`, `alreadyApplied: 9`,
  `applied: 0`. No second backup or log was created.

The rehearsal first exposed Windows cleanup masking an assertion, then exact
floating-point comparison after Prisma persistence. Handles now close on failure;
numeric postconditions allow only a 1e-10 absolute tolerance. Archive identity,
record identity, dates and pre-write snapshots remain exact checks.

Recheck the completed repair without writes:

```powershell
npx tsx scripts/apply-broker-closure-corrections.ts prisma/dev.db prisma/backups/broker-reconciliation-full-2026-09-12.json
```

Reproduce the full repair rehearsal using the pre-repair backup, not the now
corrected live database:

```powershell
try {
  $env:HT_CLOSURE_REPAIR_SOURCE = 'prisma/backups/closure-corrections-2026-09-12-approved/before.db'
  npx vitest run scripts/apply-broker-closure-corrections.test.ts --silent
} finally {
  Remove-Item Env:HT_CLOSURE_REPAIR_SOURCE -ErrorAction SilentlyContinue
}
```

## Remaining work

Refresh the dashboard and clear date filters when checking the full history.
Database totals are verified; the browser-rendered chart was not inspected in
this step. The earlier lifecycle report remains a pre-repair snapshot and its
verifier must use the backup to reproduce those original values.

No trading strategy, risk gate, live stop, scheduler or broker holding changed.
No commit or push was performed in this accounting step. Full execution-policy
replay and profitable strategy improvement remain unproven, as recorded in the
[research resolution](entry-policy-resolution-2026-09-12.md).