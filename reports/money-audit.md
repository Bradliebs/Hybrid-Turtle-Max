# HybridTurtle — Money Audit

**Generated:** 2026-07-03T08:19:46.752Z  
> Follows actual cash, not R-multiples. Read-only snapshot.

---

## 1. Equity Curve (the bottom line)

### User `turtle@hybridturtle.local` (mode: NORMAL, profile: SMALL_ACCOUNT)

| Metric | Value |
|--------|-------|
| Set equity (config) | £967.51 |
| First snapshot | £1017.94 (2026-05-17) |
| Latest snapshot | £967.51 (2026-07-02) |
| Peak | £1055.15 |
| Trough | £967.51 |
| **Net change** | **-£50.43 (-5.0%)** |
| Drawdown from peak | 8.3% |
| Snapshots | 54 |

Recent equity snapshots:

| Date | Equity | Source |
|------|--------|--------|
| 2026-06-24 20:07 | £1010.53 | NIGHTLY |
| 2026-06-25 20:06 | £1018.58 | NIGHTLY |
| 2026-06-26 20:06 | £1015.93 | NIGHTLY |
| 2026-06-27 20:06 | £1019.59 | NIGHTLY |
| 2026-06-28 20:06 | £1019.59 | NIGHTLY |
| 2026-06-29 20:07 | £1011.36 | NIGHTLY |
| 2026-06-30 20:07 | £986.18 | NIGHTLY |
| 2026-07-01 20:07 | £968.78 | NIGHTLY |
| 2026-07-02 13:08 | £967.93 | BROKER |
| 2026-07-02 20:06 | £967.51 | NIGHTLY |

---

## 2. Open Positions — Unrealised P&L

Open positions: 2

| Ticker | Entry | Now | Shares | Unreal £ | Unreal % | Stop | Risk-if-stopped £ | Held (d) | Prot |
|--------|-------|-----|--------|----------|----------|------|-------------------|----------|------|
| HAYW | 17.30 | 16.94 | 15.380 | -£5.47 | -2.1% | 16.50 | -£6.77 | 2 | TRAILING_ATR |
| DSMa | 83.76 | 83.05 | 5.590 | -£3.97 | -0.8% | 79.57 | -£19.44 | 2 | INITIAL |

**Total unrealised P&L: -£9.44** across 2 positions (2 underwater).
Additional loss if every stop hit from here: -£26.21.

---

## 3. Closed Positions — Realised Cash

Closed positions: 14 | with GBP data: 13

| Metric | Value |
|--------|-------|
| **Total realised P&L** | **£0.05** |
| Gross wins | £53.25 (7) |
| Gross losses | -£53.20 (6) |
| Profit factor (GBP) | 1.00 |
| Avg win | £7.61 |
| Avg loss | -£8.87 |

Every closed trade (chronological):

| Exit date | Ticker | Entry | Exit | P&L £ | R | Reason | ClosedBy | Whipsaw |
|-----------|--------|-------|------|-------|---|--------|----------|---------|
| 2026-05-18 | UNH | 395.38 | — | — | — | Closed on Trading 212 (ISA) | — | 0 |
| 2026-05-20 | OSCR | 20.90 | 23.59 | £31.42 | 2.57 | STOP_HIT | AUTO_SYNC | 0 |
| 2026-06-02 | TKNO | 4.68 | 4.88 | £0.65 | 0.85 | STOP_HIT | AUTO_SYNC | 0 |
| 2026-06-05 | CNDX | 1671.22 | 1709.00 | £3.70 | 0.45 | STOP_HIT | AUTO_SYNC | 0 |
| 2026-06-05 | CYRX | 15.30 | 15.63 | £3.16 | 0.43 | STOP_HIT | AUTO_SYNC | 0 |
| 2026-06-05 | NUE | 251.74 | 252.36 | £4.14 | 0.05 | STOP_HIT | AUTO_SYNC | 0 |
| 2026-06-11 | ANTM | 415.61 | 395.17 | -£17.76 | -0.98 | STOP_HIT | AUTO_SYNC | 0 |
| 2026-06-15 | CORT | 84.00 | 79.54 | -£12.03 | -1.06 | STOP_HIT | AUTO_SYNC | 0 |
| 2026-06-16 | GCBC | 28.29 | 29.00 | £1.37 | 0.50 | STOP_HIT | AUTO_SYNC | 0 |
| 2026-06-22 | SPCX | 162.49 | 170.60 | £8.81 | 1.00 | STOP_HIT | AUTO_SYNC | 0 |
| 2026-06-23 | VIRT | 63.72 | 61.00 | -£5.76 | -0.85 | STOP_HIT | AUTO_SYNC | 0 |
| 2026-06-26 | MS | 224.76 | 218.37 | -£6.57 | -0.57 | STOP_HIT | AUTO_SYNC | 0 |
| 2026-06-30 | HST | 24.71 | 23.95 | -£9.31 | -0.62 | STOP_HIT | AUTO_SYNC | 0 |
| 2026-07-02 | CLDX | 38.68 | 36.37 | -£1.77 | -1.05 | STOP_HIT | AUTO_SYNC | 0 |

Realised P&L by exit reason:

| Exit reason | Trades | Total £ |
|-------------|--------|---------|
| STOP_HIT | 13 | £0.05 |

---

## 4. Broker-Reported Realised P&L (T212 truth)

T212 fills with realised P&L: 105 | **Total broker realised: £2.29**

Wins: 44 / 105 (42%)

---

## 5. Slippage & Churn (silent money leaks)

Fills with slippage data: 2 | avg 1.86% | worst 2.50%

Total whipsaw count across closed positions: 0
Trade logs — BUY: 0, SELL: 0

---

## 6. Diagnosis — Why Is Money Being Lost?

### A. The trend-following payoff structure is broken

| Metric | Value | Healthy for trend-following |
|--------|-------|------------------------------|
| Expectancy | 0.06R | > +0.2R |
| Avg win / avg loss (R) | 0.84 / -0.86 | — |
| **Payoff ratio** | **0.98** | **> 2.0** |
| Big wins (≥1.5R) | 1 of 13 | many (fat right tail) |
| Avg hold: winners vs losers | 10.4d vs 7.1d | winners MUCH longer |

Winners are no bigger than losers (payoff ≈ 0.98) and are held barely longer. 
A trend system needs a few large winners to pay for many small losers — that fat right tail is absent.

### B. The edge has decayed and turned negative

- First half expectancy: **0.56R** (6 trades)
- Second half expectancy: **-0.38R** (7 trades)
- Last 5 trades: 1.00, -0.85, -0.57, -0.62, -1.05 → sum **-2.09R**

### C. The regime safety gate never engaged (and leaves no audit trail)

- `RegimeHistory` table rows: **0** — the regime detector (Job 1) persists no history, so gate decisions cannot be audited.
- Candidates blocked by regime in last 7 days: **0 / 5440**.
- Regime label on recent scans: BULLISH (5440).

The gate that is meant to stop trading in poor conditions classified the market as tradable throughout the drawdown and blocked nothing.

### D. Reporting understates the loss — local records are an incomplete mirror

| Source | Value |
|--------|-------|
| **Real broker equity change** (snapshot first→last) | **-£50.43** |
| Local realised P&L (closed positions) | £0.05 |
| Local open unrealised | -£9.44 |
| **Unexplained gap** | **-£41.04** |
| T212 broker fills | 105 (gross notional £11804.80) |
| Local positions (all) | 16 |

The account fell **-£50.43** but local position P&L explains only **-£9.39** of it — a **-£41.04** gap. 
There are **105 broker fills** against ~16 local positions, so the R-scoreboard (and its "grade B") is measuring a subset and masks the real loss. Likely leaks: churn, spread/FX, and slippage (avg 1.86%).

### Verdict

**Real broker equity: -£50.43 (-5.0%).** 
The system is losing money for four compounding reasons: (A) winners are cut too short so there is no fat tail, 
(B) the edge has already flipped negative, (C) the regime brake never engaged and keeps no record, and 
(D) most broker activity is invisible to the local P&L, so prior "grade B" reports were false comfort.

**Highest-priority fixes (advisory — no code changed here):** 
1. Trust broker equity, not the R-scoreboard, until local positions reconcile with all broker fills.
2. Investigate why winners exit at ~10 days (trailing-stop tightness / breakout-failure exits cutting trends).
3. Make the regime detector persist to `RegimeHistory` and verify the gate actually blocks in non-bullish conditions.
4. Quantify slippage/churn cost across all 105 fills — a ~2% entry slippage on a 2% risk trade erases ~1R instantly.
