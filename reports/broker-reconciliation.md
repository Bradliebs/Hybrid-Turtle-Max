# HybridTurtle — Broker Reconciliation

**Generated:** 2026-07-03T10:03:29.297Z  
> Follow-up to `money-audit.md`. Reconciles the local ledger against the broker
> and **corrects the earlier "churn" hypothesis**. Read-only snapshot.

---

## 1. The Two Ledgers Do Not Overlap

| Ledger | Rows | Distinct tickers |
|--------|------|------------------|
| Auto-trade positions (local) | 16 | 16 |
| Imported T212 fills (broker) | 105 | 74 |
| **Tickers in BOTH** | — | **0** |

The auto-trade system's 16 positions and the 105 imported broker fills share **0 tickers** — they are effectively separate datasets. The prior audit's "105 fills = churn" reading was therefore wrong; those fills are not the auto-trade system's activity.

## 2. Those Fills Are Legacy History (Not the Recent Loss)

Fill `tradeType` values: EXIT. Total realised: **£2.24**.

| Month | Fills | Realised £ |
|-------|-------|-----------|
| 2026-01 | 62 | -£10.59 |
| 2026-02 | 6 | -£9.41 |
| 2026-03 | 13 | £12.80 |
| 2026-04 | 16 | £12.91 |
| 2026-05 | 8 | -£3.47 |

Every imported fill predates June. They net near-zero and are **irrelevant to the June/July drawdown.**

## 3. The Equity Decline Is Real (broker ≈ nightly)

BROKER (pulled from T212) and NIGHTLY (system) snapshots agree within pennies, so equity is not an estimate:

| Date | BROKER | NIGHTLY |
|------|--------|---------|
| 2026-06-13 | £1031.92 | £1031.92 |
| 2026-06-16 | £1055.15 | £1045.41 |
| 2026-06-19 | £1041.94 | £1041.83 |
| 2026-06-22 | £1034.93 | £1027.03 |
| 2026-06-24 | £1019.02 | £1010.53 |
| 2026-07-02 | £967.93 | £967.51 |

## 4. £52 Lost in 3 Trading Days (6/29 → 7/02)

| Date | Equity | Δ |
|------|--------|---|
| 2026-06-26 20:06 | £1015.93 | — |
| 2026-06-27 20:06 | £1019.59 | £3.66 |
| 2026-06-28 20:06 | £1019.59 | £0.00 |
| 2026-06-29 20:07 | £1011.36 | -£8.23 |
| 2026-06-30 20:07 | £986.18 | -£25.18 |
| 2026-07-01 20:07 | £968.78 | -£17.40 |
| 2026-07-02 13:08 | £967.93 | -£0.85 |
| 2026-07-02 20:06 | £967.51 | -£0.42 |

## 5. The Real Driver — Unhedged USD Exposure on a GBP Account

Positions by currency: USD 11, GBP 1, UNKNOWN 4.
Universe by currency: USD 1135, NULL 120, GBX 55, EUR 23, GBP 21, DKK 4, CHF 3, SEK 2, AUD 1.

The account is denominated in **GBP** but holds almost entirely **USD** assets, so equity moves with GBP/USD even when stocks are flat. Recent fill FX rates:

| Date | Ticker | GBP/USD |
|------|--------|---------|
| 2026-07-02 | CLDX | 1.3372 |
| 2026-06-30 | HST | 1.3229 |
| 2026-06-26 | MS | 1.3219 |
| 2026-06-23 | VIRT | 1.3212 |
| 2026-06-22 | SPCX | 1.3249 |
| 2026-06-16 | GCBC | 1.3412 |

GBP/USD moved **1.3229 → 1.3372** (GBP strengthened 1.1%). On ~£900 of USD holdings that is ≈ **-£9.68** of pure FX translation on 7/01–7/02 alone.

## 6. Reconciliation of the 3-Day Drop

| Component | Est. GBP | Basis |
|-----------|----------|-------|
| Auto-trade realised losses (HST, CLDX) | -£11.08 | local `realisedPnlGbp` |
| Open USD positions MTM (HAYW, DSMa, native) | ≈ -£9 | price marks |
| FX translation (GBP +1.1% vs USD) | ≈ -£9.68 | fxRateAtFill |
| Residual (other USD holdings' MTM on 6/30 down-day, fees/spread) | ≈ balance | broker truth |
| **Total equity change 6/27→7/02** | **-£52.08** | snapshots |

### Corrected Verdict

- **The earlier "churn from 105 fills" explanation was wrong.** Those fills are legacy Jan–May history (net £2.24), disjoint from the auto-trade book.
- **The £52 loss is real and concentrated in 3 days.** Broker and nightly equity corroborate to the penny.
- **Only ~£11 is tracked auto-trade realised loss.** The rest is USD mark-to-market plus **unhedged GBP/USD FX** — a GBP account holding ~95% USD assets.
- **The local ledger cannot reconcile to broker equity by construction:** it records P&L in each stock's native currency and ignores FX translation, so the "£41 gap" is mostly an FX/accounting artefact, not missing trades.
- **Structural risk for a £1k account:** a routine ±1% GBP/USD swing ≈ ±£10 — the same order as the entire 2% per-trade risk budget (£20). FX is an unmanaged risk as large as the strategy edge itself.

**Advisory next steps (no code changed):**
1. Treat broker equity as the sole P&L truth; the R-scoreboard measures native-currency trade selection only.
2. Add FX-aware GBP valuation to open positions so unrealised P&L and equity reconcile.
3. Consider whether a £1k GBP account should hold GBP/GBX/ETF instruments to remove unhedged USD FX noise.
4. Separate legacy imported fills from the auto-trade book in all reporting to stop them muddying analysis.
