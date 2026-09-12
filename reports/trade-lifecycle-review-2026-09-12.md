---
title: Trade Lifecycle Review 2026-09-12
description: Read-only diagnosis of recorded entry, stop-history and closure evidence behind the trading record.
ms.date: 2026-09-12
---

## Conclusion

Prioritize entry follow-through and exact exit reconciliation before changing
stop thresholds. The recorded automated cohort is losing, and most of its
losers have little favorable movement in the available stop-update records.
SCHW is a distinct gap-risk example: its cached exit-session open was already
below the logged stop, close to its recorded fill. This is not evidence that
every loss was a winner sold badly. No live rule, risk setting or historical
record was changed for this review.

## Scope and accounting

Read-only SQLite inspection on September 12, 2026, starting at
18:39:55 UTC. The chart requests the latest 30 measured closed positions for
`default-user`. Its current 25 rows reproduce the screenshot: 9 wins, 15
losses, one flat, 36% wins and -3.6911969242R total (-0.1476478770R/trade).
The API counts the flat as a loss; this review distinguishes it.

The database has 28 closed positions and two open positions. UNH, CCRN and
CRON lack measured closures and are absent from the chart. ATRC and PRTS
remain open and are not assigned realized outcomes. Existing accounting
exceptions also affect TKNO, GCBC, CLDX, HAYW, DSFIR.AS and PEBO.

All results below describe stored records, not independently reconciled net
account performance. The stored GBP subtotal for the 25 measured positions
is -15.93, not a full account cash-flow return. No fees, missing fills or FX
adjustments were invented.

| Cohort | Measured | Entry dates | Wins / losses / flat | Total stored R | Mean stored R | Stored GBP subtotal |
| --- | ---: | ---: | --- | ---: | ---: | ---: |
| All | 25 | 16 | 9 / 15 / 1 | -3.6912 | -0.1476 | -15.93 |
| Imported (`trading212`) | 14 | 10 | 7 / 6 / 1 | +1.5980 | +0.1141 | -0.97 |
| Automated (`auto-trade`) | 11 | 6 | 2 / 9 / 0 | -5.2892 | -0.4808 | -14.96 |

These are not matched strategy cohorts. Entry periods differ, and all 15
imported positions have a stored initial risk equal to 5% of entry price.
The sync implementation supports this fallback when an original stop is
unavailable; eight imported position notes explicitly mention a default or 5%.
An imported R denominator is not established as the original risk decision.
Source labels do not prove which person or system originally chose the trade.

Average recorded winner: +0.7940R. Average recorded loser: -0.7225R. R-based
profit factor: 0.6594. The winners do not offset the losses in this sample.
These observations do not establish a stable future win rate or payoff ratio.

## Trade-by-trade record

`Ref R` is the maximum rounded `High` value in a trailing-ATR StopHistory
reason recorded between entry and recorded closure, normalized by the stored
initial risk. The producer calls this `highestClose` and initializes it to
entry price. It is a model reference, not an independently verified market
peak, a complete price path, or an executable profit. Missing means unknown.
Updates occur only when a stop recommendation is recorded, so this sampling
can miss favorable excursions. Entry-day references can include partial bars.
Days are elapsed calendar days, not trading sessions.

### Automated measured closures

| Ticker | Entry | Exit | Days | Stored R | Ref R | Entry gap / planned risk | Evidence note |
| --- | --- | --- | ---: | ---: | ---: | ---: | --- |
| CLDX | 2026-06-30 | 2026-07-02 | 1.91 | -1.0472 | unknown | 0.7479 | No stop-history rows; exit quantity mismatch |
| HAYW | 2026-06-30 | 2026-07-07 | 6.76 | -0.9284 | 0.017 | 0.3297 | Low logged reference; exit quantity mismatch |
| ETSY | 2026-07-15 | 2026-07-21 | 5.85 | -0.9150 | 0.039 | 0.5994 | Low logged reference |
| PEBO | 2026-07-16 | 2026-07-17 | 0.80 | -0.9325 | 0.012 | 0.6308 | Early closure; exit quantity mismatch |
| TOST | 2026-08-05 | 2026-08-12 | 7.09 | -0.7289 | 0.270 | 0.7137 | Low logged reference |
| SAP | 2026-08-05 | 2026-08-26 | 20.75 | +1.0053 | 1.760 | 0.0323 | Winner; reference-to-exit decline |
| SCHW | 2026-08-05 | 2026-08-26 | 20.76 | -0.0470 | 1.561 | 0.4873 | Cached opening gap below logged stop |
| URGN | 2026-08-05 | 2026-08-20 | 14.89 | +0.2831 | 1.334 | 0.5371 | Winner; reference-to-exit decline |
| CYRX | 2026-08-21 | 2026-08-24 | 2.89 | -0.8841 | 0.152 | 0.0909 | Early closure despite small entry gap |
| SBLK | 2026-09-02 | 2026-09-08 | 6.00 | -0.4642 | 0.447 | 0.0971 | Low logged reference despite small entry gap |
| HRMY | 2026-09-02 | 2026-09-10 | 7.91 | -0.6305 | 0.440 | 0.3535 | Low logged reference |

All eleven have one exact position-linked ENTRY row labeled BULLISH. The
records alone do not establish that every historical technical and risk gate
passed with fresh, correctly normalized inputs. All eleven recorded exit
reasons are STOP_HIT, which does not independently certify broker execution.

Seven of nine automated losers have available references below +0.45R:
HAYW, ETSY, PEBO, TOST, CYRX, SBLK and HRMY. SCHW has a +1.561R reference;
CLDX has no reference. Three losers closed within three calendar days:
CLDX, PEBO and CYRX. These are descriptive groups, not optimized filters.

### Imported measured closures

| Ticker | Entry | Exit | Days | Stored R | Ref R |
| --- | --- | --- | ---: | ---: | ---: |
| OSCR | 2026-05-08 | 2026-05-20 | 12.11 | +2.5742 | 4.211 |
| CNDX | 2026-05-12 | 2026-06-05 | 24.33 | +0.4521 | 1.041 |
| NUE | 2026-05-29 | 2026-06-05 | 7.27 | +0.0491 | 0.823 |
| CYRX | 2026-05-29 | 2026-06-05 | 7.06 | +0.4281 | 1.565 |
| TKNO | 2026-05-29 | 2026-06-02 | 4.01 | +0.8549 | unknown |
| HST | 2026-06-08 | 2026-06-30 | 22.15 | -0.6161 | 0.339 |
| GCBC | 2026-06-08 | 2026-06-16 | 8.01 | +0.5019 | 1.329 |
| ANTM | 2026-06-05 | 2026-06-11 | 5.96 | -0.9837 | unknown |
| CORT | 2026-06-12 | 2026-06-15 | 3.03 | -1.0619 | unknown |
| SPCX | 2026-06-12 | 2026-06-22 | 9.92 | +0.9977 | unknown |
| MS | 2026-06-17 | 2026-06-26 | 8.76 | -0.5687 | 0.271 |
| VIRT | 2026-06-22 | 2026-06-23 | 1.02 | -0.8527 | 0.001 |
| DSFIR.AS | 2026-07-01 | 2026-07-23 | 22.00 | 0.0000 | 0.664 |
| ALV | 2026-07-03 | 2026-07-15 | 12.21 | -0.1768 | unknown |

These positions have no exact position-linked ENTRY row of the type used
for automated entry-gap analysis. DSFIR.AS's zero result lacks complete broker
exit evidence and must not be interpreted as a confirmed flat trade.

## Cached holding-window cross-check

Canonical ticker resolution maps SAP to SAP.DE; both its position and bar
metadata say EUR. All other covered automated positions have USD metadata.
Only bars on UTC dates strictly after entry day and strictly before exit day
are included. This excludes ambiguous intraday entry/exit ordering but also
omits potentially important price movement on those boundary days.

| Ticker | Canonical symbol | Interior bars | Maximum observed close R |
| --- | --- | ---: | ---: |
| CLDX | CLDX | 1 | -0.861 |
| HAYW | HAYW | 3 | -0.385 |
| ETSY | ETSY | 3 | -0.312 |
| PEBO | PEBO | 0 | unknown |
| TOST | TOST | 4 | +0.270 |
| SAP | SAP.DE | 14 | +1.760 |
| SCHW | SCHW | 14 | +1.552 |
| URGN | URGN | 10 | +1.334 |
| CYRX | CYRX | 0 | unknown |
| SBLK | SBLK | 0 | unknown |
| HRMY | HRMY | 0 | unknown |

CLDX, HAYW and ETSY never have an above-entry close in these cached interior
sessions. This supports weak observed follow-through, not proof that the
entries were invalid. PEBO closed the next day; CYRX spans Friday to Monday,
so neither has an intervening weekday. SBLK and HRMY lack cached interior
bars despite longer holding periods. Missing coverage is not zero movement.

Each covered row has one bar per observed date. A complete exchange-calendar
coverage check was not performed. Adjusted close equals raw close for these
cached bars except SCHW, whose adjusted/raw ratio ranges from approximately
0.99709 to 1. The table uses raw closes, not mixed adjusted returns, but that
does not independently certify historical price basis or capture dividends.
SCHW's +1.552R cached reference differs slightly from the +1.561R rounded
stop-log reference; different fetch times or revisions remain unresolved.

## Entry and execution interpretation

Entry gap uses `(actualFill - plannedEntry) / (plannedEntry - initialStop)`.
It is trigger-to-fill movement, not quote-to-fill slippage. Across all 15
automated entries, the prior review measured a mean +1.6283% price gap and
0.4658 planned-risk units. Open and unresolved trades are included in that
entry-only sample; they are excluded from realized outcome statistics.

Small entry gaps did not ensure success: CYRX and SBLK lost with gaps near
0.09 and 0.10 planned-risk units. SAP won with 0.03 and URGN won with 0.54.
This small, selected sample does not justify choosing a new gap cutoff or
assuming rejected trades could have been filled later at better prices.

SCHW's last pre-closure logged stop was 110.84 on August 25 at 20:05:07 UTC.
Its linked exit fill is 108.21, versus entry 108.37 and initial risk
3.4017742702 per share. The logged-stop-to-fill difference is about 0.7731R.
That is an investigation target, not proven avoidable slippage: a stop price
is not guaranteed, and the log does not prove the broker held that exact stop
at execution. Inspect broker stop replacement acknowledgements, order type,
actual fill sequence and contemporaneous prices before attributing a cause.

The cached YAHOO DailyBar for August 26 has open 108.25, high 110.32,
low 106.34 and close 109.39, with adjusted close equal to close and instrument
currency USD. The session opened 2.59 below the 110.84 logged stop; the recorded
fill was only 0.04 below that opening price. This supports opening-gap exposure
as the explanation for most of the stop-to-fill difference, not a 2.63-per-share
avoidable execution loss. The entire cached session high was below the logged
stop. This bar was fetched September 2, after the trade, and is not independent
broker confirmation or a contemporaneous executable quote.

All 15 stored COMPLETE logs lack the new exact scan/trade/position combination
and version-1 fill evidence. They predate the new capture. Consequently this
review cannot measure decision-quote-to-fill slippage or prove historical entry
gate compliance from those payloads.

SAP and URGN also show reference-to-exit declines, which are expected to some
degree under trailing stops. Their references do not prove those gains were
available to an implementable exit rule. Do not sum peak-to-exit differences
as recoverable profit or subtract entry gaps again from realized returns.

## Next actions and limits

1. Resolve SCHW's stop-to-fill sequence and the existing quantity/closure
   exceptions using exact account-scoped broker evidence. No historical
   record should be changed by inference from a price chart.
2. Reconstruct entry and holding-window prices only where price basis,
   timestamps and coverage can be established. Mark absent evidence unknown.
3. Use policy-aligned replay to test a predefined entry challenger against
   unchanged risk and stops, including unfilled opportunities and costs.
   Do not tune a threshold on these eleven completed automated trades.
4. Test an exit challenger only after the exit-quality evidence is sufficient.
   Preserve independent evaluation and use shadow mode before live changes.

This review inspects actual held-position outcomes, including August and
September trades. It does not inspect reserved CandidateOutcome forward labels
or run a policy comparison on the candidate holdout. These actual outcomes are
now development evidence and cannot serve as an unseen test for a rule chosen
from this review. No broker, provider, scan or enrichment job was invoked.

## Evidence and verification

The existing [read-only baseline](../scripts/trade-performance-baseline.mjs)
was run with a 1970 start and an explicit current cutoff. Its fingerprint was
`a125d38675bd5eeebb52a9d8a902c73be89bb15e3eac58d8bf56abe0bc10a4f0`.
Supplementary queries used `better-sqlite3` with `readonly: true`,
`fileMustExist: true`, `query_only=ON` and read transactions. Position IDs,
not ticker/date proximity, linked entry, exit and stop records.

The chart path is [the trades API](../src/app/api/performance/trades/route.ts).
The reference producer is [stop-manager](../src/lib/stop-manager.ts), and
imported risk initialization is in [broker sync](../src/app/api/trading212/sync/route.ts).
Related reports: [entry evidence](entry-quality-review-2026-09-11.md),
[closure exceptions](trade-exit-reconciliation-2026-09-10.md) and
[isolated simulation](trading-simulation-2026-09-12.md).

The date-specific [report verifier](../scripts/verify-trade-lifecycle-review.mjs)
checks every trade-table row against the database, including holding time,
stored R, available stop references and eleven entry gaps, plus local links,
the baseline total, eleven cached-coverage rows and SCHW's exit-session prices:

```powershell
node scripts/verify-trade-lifecycle-review.mjs prisma/dev.db reports/trade-lifecycle-review-2026-09-12.md
```

This validates the report's transcription and arithmetic against current source
records, not the economic truth of those records. Later source corrections can
make this date-specific verification fail; do not alter records to make it pass.

Confidence is high in reproduction of the stored chart and arithmetic, but
limited in causal attribution and expected improvement. Source populations,
price bases, incomplete closures, sparse stop observations and six automated
entry dates prevent a validated profitability conclusion.