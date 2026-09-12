---
title: Candidate Outcome Reconstruction Pilot
description: Fixed-sample read-only reconstruction evidence, rejected windows, and stored-label comparisons.
ms.date: 2026-09-10
---

## Result and decision

Eight of 29 selected candidate rows pass the pilot's conditional price-return
checks at all three horizons. Twenty-one rows are rejected. Five accepted rows
have stored five-session returns: all five differ, including their signs, from
the reconstructed values. The largest absolute difference is 12.2455 percentage
points. No accepted row has a stored ten- or twenty-session value to compare.

This establishes limited reconstruction feasibility, not a profitable strategy.
The eight accepted rows span only May 16, June 17 and June 18. All five stored
comparisons come from May 16. Do not treat the rows or horizons as independent
trials, extrapolate the discrepancy rate, or tune risk and ranking from them.

No production code, database records, schema, broker orders, provider refreshes,
or scheduled tasks changed. All trading safety gates remain unchanged. The
July candidate cohort and August 3 onward holdout outcomes were not queried.

## Fixed sample and evidence

The [pilot script](../scripts/candidate-outcome-pilot.mjs) freezes seven named
instruments, May and June 2026, and three enrichment states. For each symbol,
month and state, select the earliest scanDate, breaking ties by candidate ID.
States are unenriched, partially enriched, and complete twenty-session label.
Selection uses label availability, never its sign or magnitude. Of 42 slots,
29 exist and 13 are empty; no replacement symbols or later rows were selected
after seeing rejection or return results. This is a diagnostic sample, not a
random or representative sample of tradable signals.

| Candidate ticker | Resolved symbol | Selected | Accepted | Rejected |
| --- | --- | ---: | ---: | ---: |
| AA | AA | 4 | 0 | 4 |
| AAPL | AAPL | 4 | 1 | 3 |
| ABBV | ABBV | 4 | 1 | 3 |
| AAL.L | AAL.L | 4 | 2 | 2 |
| AIAI | AIAI.L | 4 | 0 | 4 |
| AD.AS | AD.AS | 4 | 2 | 2 |
| ASML | ASML.AS | 5 | 2 | 3 |

The [version 2 JSON evidence](candidate-outcome-pilot-2026-09-10-v2.json)
contains every selected candidate, exact IDs, current Stock/Instrument identity,
source bars, source timestamps, expected session dates, per-horizon rejection
reasons, stored values, reconstructed values, and differences. It also records
empty slots, the manifest and code fingerprint. SQLite is opened read-only with
query-only enabled, and evidence is read within a transaction without importing
application Prisma initialization.

Evidence cutoff: `2026-09-10T00:00:00Z`. This is current local evidence filtered
by timestamps, not an archived point-in-time database. Current metadata and
vendor-adjusted history can differ from what existed when a scan ran.

Version 2 selected-source SHA256:

```text
33186f7a20596470c86b86dc0761f9bbfbbe6fd5e4355bc30132a471c566032a
```

Implementation plus canonical ticker-map SHA256:

```text
ffa0c3daa00230df20ba5d105871eb6a9911e8423e754e173957f2235c9016db
```

## Acceptance contract

`ACCEPTED_CONDITIONAL` means the following local checks pass, not that a trade
was executable or its realized P&L is known:

1. Exactly one Stock and Instrument, canonical ticker mapping, expected venue,
   Yahoo source and matching currency units. GBp and GBX both mean pence; GBP
   is not treated as pence. No FX or guessed conversion is applied.
2. The scan is after a conservative post-close cutoff: 20:15 UTC for the US,
   16:00 UTC for London and Amsterdam during this fixed summer window. These
   are safety buffers, not claimed official closing times. Non-session scans
   use the preceding session as the price anchor. Pre-close scans are rejected,
   even when a quote might be valid, because its historical basis is unproven.
3. Scan price matches the anchor's raw close within one part per million.
   Every required session has exactly one Yahoo bar. No missing sessions are
   filled, duplicates selected, non-session bars counted, or horizon dates shifted.
4. OHLC values are finite, positive and internally consistent. Adjusted closes
   are positive. Each bar was fetched no earlier than the following UTC day
   and no later than the evidence cutoff. This screens unfinished observations;
   it does not establish an immutable vendor finalization record.
5. Adjusted-close/raw-close factors remain constant, within one part per million,
   from the anchor through the endpoint. Constant scale cancels in a ratio.
   A factor change rejects that horizon; no dividend/split decomposition or
   corporate-action correction is invented.

Returns are `100 * (endpoint raw close / stored scan price - 1)` after the
checks above. Five, ten and twenty sessions are assessed independently. The
first session is strictly after the scan's UTC date, matching the existing
outcome definition. There is no entry-trigger, stop, slippage, cost, FX or
capital simulation, and no MFE/MAE or captured-profit claim.

### Bounded calendars

Calendars cover May 1 through July 31, 2026 only. Weekends are excluded, plus:

* US: May 25, June 19, July 3
* London: May 4 and May 25
* Amsterdam: May 1; May 25 is a full trading day

Sources checked September 10, 2026:
[NYSE holidays](https://www.nyse.com/markets/hours-calendars),
[LSE business-day policy](https://www.londonstockexchange.com/equities-trading/business-days),
[England and Wales bank holidays](https://www.gov.uk/bank-holidays), and
[Euronext calendar](https://www.euronext.com/en/trade/trading-hours-holidays).
This is not a reusable global calendar or proof against unrecorded exceptional
closures. Only post-scan prices needed for May-June endpoints are read in July;
no July signals are evaluated or tuned.

## Accepted values

Returns and differences below are percentages and percentage points respectively.
Blank stored values are absent, not zero. All eight rows pass all three horizons.

| Scan date | Ticker | Rebuilt 5 | Stored 5 | Difference | Rebuilt 10 | Rebuilt 20 |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| 2026-05-16 | AAPL | 2.8611 | -0.7961 | 3.6572 | 2.0251 | -1.2690 |
| 2026-05-16 | ABBV | 2.5239 | -0.4658 | 2.9897 | 1.2073 | 5.3234 |
| 2026-05-16 | AAL.L | 0.0522 | -4.5917 | 4.6439 | 5.8440 | 6.6528 |
| 2026-06-17 | AAL.L | -12.5847 | | | -9.9226 | -14.1578 |
| 2026-05-16 | AD.AS | -0.4076 | 2.2554 | -2.6630 | -1.7120 | -1.1685 |
| 2026-06-17 | AD.AS | -0.3673 | | | -0.6499 | 1.3846 |
| 2026-05-16 | ASML | 7.8371 | -4.4084 | 12.2455 | 5.9850 | 24.7206 |
| 2026-06-18 | ASML | -4.8926 | | | -5.8592 | -4.6301 |

The five May 16 rows were partially enriched; the three June rows were
unenriched. No stored-complete20 row passes the pilot's conservative gates.
Differences do not identify which historical provider, code version, baseline
or window produced a legacy value. The prior ordering characterization is
evidence about current code, not proof of every historical discrepancy's cause.

## Rejected rows

Reasons overlap; do not add these counts as distinct rejected rows:

| Evidence gate | Rows affected | Interpretation |
| --- | ---: | --- |
| Before post-close cutoff | 18 | Historical quote basis needs separate evidence |
| Scan/anchor raw close mismatch | 18 | Do not substitute a different denominator |
| Currency/unit conflict | 4 | AIAI Stock says GBP; AIAI.L Instrument says USD |
| Adjustment factor changes | 2 | AA May 16 and ABBV June 17 need action-aware treatment |

There were no missing or duplicate sessions, unsupported sources, invalid OHLC,
or non-session bars in these selected windows. Each has 21 source bars including
the anchor. This says nothing about the unselected universe's quality.
The full JSON lists every rejected ID and its affected horizons.

AA illustrates a real factor-change rejection: the anchor factor is about
0.99646849, still 0.99646853 on May 18, then 0.99806317 on May 19. The validator
does not assume whether this is a dividend, split, vendor revision or other event.
The AIAI metadata conflict is not automatically repaired from one source.

## Revision trace

The [initial artifact](candidate-outcome-pilot-2026-09-10.json) retains the first
run: 29 rejected rows. Its rule required raw close to equal adjusted close,
which unnecessarily rejects a consistent non-unit adjustment factor.

Version 2 replaces only that adjustment requirement with constant-factor
invariance. Synthetic tests prove return equality for factors 0.997, 0.5 and 2,
and rejection when the factor changes within a horizon. Sample, candidate
values, metadata and source bars were asserted identical between runs. No
return threshold was optimized; rejected rows were not replaced. The initial
artifact is an archived diagnostic, not the output of the current implementation.

## Verification and manual checks

Ten focused tests passed, including chronology, missing/duplicate sessions,
partial windows, holiday differences, alias/venue/unit conflicts, unfinished
bars, evidence cutoff, zero-versus-null handling, adjustment invariance,
deterministic sampling, SQLite byte preservation and holdout isolation.
Scoped ESLint, repository typecheck and script diagnostics passed.

Independent read-only SQL checks re-read all 24 accepted endpoint prices and
verified the return arithmetic. Adjusted-anchor/adjusted-endpoint ratios agree
within 0.0002 percentage points. AAPL's May 16 scan price equals the May 15 raw
close, 300.2300109863281. Sessions May 18-22 end at 308.8200073242188, yielding
2.8611384684%. Session twenty is June 15 at 296.4200134277344, yielding -1.2690%.
May 25 is excluded as a US holiday.

Reproduce with Node 24, existing dependencies and a new output filename:

```powershell
node --test scripts/candidate-outcome-pilot.test.mjs
node scripts/candidate-outcome-pilot.mjs prisma/dev.db reports/candidate-outcome-pilot-rerun.json
npx eslint scripts/candidate-outcome-pilot.mjs scripts/candidate-outcome-pilot.test.mjs
npm run typecheck
```

The output uses exclusive creation and will not overwrite an existing artifact.
Without an output filename, only summary and fingerprints are printed. Node
emits a nonfatal module-type warning when loading the existing canonical TS map;
the project module configuration was not changed to suppress it. No full-suite,
live-provider or broker test ran.

## Remaining work

This is a conditional data-quality pass for eight rows, not a gate to bulk
historical replacement. The local normalizer widens stored highs/lows to contain
open/close, so these are normalized bars, not an immutable raw-provider archive.
There is no independent corporate-action archive, historical currency snapshot,
quote-source timestamp, or proof of point-in-time eligibility in this pilot.

Next, make a scoped prospective enrichment repair at the consumer boundary:
chronological ordering, horizon-aware retries, and explicit window/basis checks.
Keep uncertain historical rows unmodified. Intraday/pre-open baselines and
factor-changing windows require a separate evidence contract before extending
reconstruction. Historical accounting exceptions and normal automated-fill
attribution observation remain separate outstanding tasks. Ranking evaluation
and the August holdout remain unopened; first verify holdout non-exposure and
the readiness report's sample-size and replay gates.