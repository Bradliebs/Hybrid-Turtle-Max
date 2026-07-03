# HybridTurtle — Historical Data Audit

**Generated:** 2026-07-01T18:58:11.967Z  
**Data span:** 2026-05-16 → 2026-06-30 (45 days)  
**Graded user:** default-user  

> Read-only "Learn" review (Job 8). No strategy logic touched. Snapshot of live DB.

---

## 1. Data Sufficiency

| Metric | Count |
|--------|-------|
| Scans recorded | 29 |
| Candidate outcomes (rows) | 31676 |
| — with scores (NCS) | 19817 |
| — enriched with forward returns | 7326 |
| — became actual trades | 0 |
| Positions (all) | 15 |
| Closed positions | 13 |
| — with R-multiple data | 12 |
| Equity snapshots | 51 |

---

## 2. Profit Scoreboard (live P&L edge)

**System grade: B** — Positive edge: 0.15R expectancy. Need more data to confirm.

> ⚠ 1 closed position(s) missing R data — metrics based on 12 trades only.

| Metric | Value |
|--------|-------|
| Closed trades (with R) | 12 |
| Total realised R | 1.77 |
| Expectancy / trade | 0.15R |
| Win rate | 58.3% (7W / 5L) |
| Avg win / avg loss | 0.84R / -0.82R |
| Profit factor | 1.43 |
| Max drawdown | 6.5% |
| Current drawdown | 6.5% |
| Avg / median hold | 9.2d / 8d |

---

## 3. Do Scores Predict Outcomes? (monotonicity)

Candidates scored: 19817 | enriched: 7326

| Score | Metric | Direction | Values across bands | Monotonic | Violations |
|-------|--------|-----------|--------------------|-----------|-----------|
| NCS | Fwd 20d Return | ascending | 9.6 → -0.3 → 1.5 → 1.8 → 2.4 | ✗ | 1 |
| NCS | 1R Hit Rate | ascending | 13.9 → 17.6 → 23.8 → 23.2 → 45.0 | ✗ | 1 |
| NCS | MFE (R) | ascending | 1.0 → 0.8 → 0.9 → 0.9 → 1.6 | ✗ | 2 |
| NCS | Stop Hit Rate | descending | 95.2 → 93.1 → 86.5 → 85.4 → 67.0 | ✓ | 0 |
| FWS | Fwd 20d Return | descending | 3.4 → 11.6 → 2.7 → — → — | ✗ | 1 |
| FWS | 1R Hit Rate | descending | 12.6 → 27.5 → 28.3 → — → — | ✗ | 2 |
| FWS | Stop Hit Rate | ascending | 95.1 → 85.8 → 75.9 → — → — | ✗ | 2 |
| BQS | Fwd 20d Return | ascending | 11.5 → 4.8 → 1.0 → 2.4 → 3.7 | ✗ | 2 |
| BQS | MFE (R) | ascending | 1.2 → 0.6 → 0.8 → 1.2 → 2.0 | ✗ | 1 |

**Predictive summary:** 1/9 tested relationships are monotonic (score → outcome).

- NCS vs Fwd 20d Return: Mostly ascending (75% consistent). Minor noise — score is largely predictive.
- NCS vs 1R Hit Rate: Mostly ascending (75% consistent). Minor noise — score is largely predictive.
- NCS vs MFE (R): Non-monotonic (2/4 violations). Score may not reliably predict MFE (R).
- NCS vs Stop Hit Rate: Lower NCS → better Stop Hit Rate. Score is predictive.
- FWS vs Fwd 20d Return: Mostly descending (50% consistent). Minor noise — score is largely predictive.
- FWS vs 1R Hit Rate: Non-monotonic (2/2 violations). Score may not reliably predict 1R Hit Rate.
- FWS vs Stop Hit Rate: Non-monotonic (2/2 violations). Score may not reliably predict Stop Hit Rate.
- BQS vs Fwd 20d Return: Non-monotonic (2/4 violations). Score may not reliably predict Fwd 20d Return.
- BQS vs MFE (R): Mostly ascending (75% consistent). Minor noise — score is largely predictive.

---

## 4. Filter / Gate Scorecard (edge per rule)

Candidates: 31676 | enriched: 7326

| Rule | Pass rate | Passed 20d | Blocked 20d | Passed 1R% | Blocked 1R% |
|------|-----------|-----------|------------|-----------|------------|
| Technical Filter | 18.3% | -0.67 | 6.46 | 30.0% | 15.5% |
| Risk Gates | 96.5% | 6.01 | 0.33 | 18.2% | 28.8% |
| Anti-Chase Guard | 99.3% | 5.97 | 1.29 | 18.1% | 56.1% |
| Regime (Bullish) | 100.0% | 5.94 | — | 18.3% | — |
| Regime (Not Bearish) | 100.0% | 5.94 | — | 18.3% | — |
| Status = READY | 5.9% | -0.94 | 6.14 | 42.7% | 17.1% |
| Status = READY or WATCH | 20.4% | -1.06 | 7.08 | 36.0% | 14.8% |
| NCS ≥ 70 | 10.4% | 1.99 | 6.26 | 33.0% | 16.2% |
| NCS ≥ 60 | 22.7% | 1.68 | 6.98 | 28.3% | 14.8% |
| FWS ≤ 30 | 98.8% | 6.00 | 1.47 | 18.2% | 28.9% |
| FWS > 65 (Auto-No) | 0.0% | — | 5.94 | — | 18.3% |

> ⚠ **Read raw 20d return with care.** During a bull tape it is dominated by
> high-ATR "junk" names that this system deliberately avoids (note the ATR%<8
> rule below). For a trend system the risk-adjusted signal — **1R hit rate** and
> stop-hit rate — is the honest test. A filter is only genuinely suspect when it
> is inverted on *both* raw return AND 1R hit rate.

---

## 5. Evidence Framework (rule contribution to expectancy)

Sample — candidates: 31676, enriched: 7326, trades: 119, closed: 12

| Rule | Edge (20d, passed−blocked) | Edge (1R rate) |
|------|---------------------------|----------------|
| Price > MA200 | -7.13 | 14.5pp |
| ADX ≥ 20 | 8.19 | 0.6pp |
| ATR% < 8 | -42.31 | 3.6pp |
| Efficiency ≥ 30 | 7.83 | 0.8pp |
| Risk Gates | 5.68 | -10.6pp |
| Anti-Chase Guard | 4.68 | -38.0pp |
| Regime = BULLISH | — | — |
| Status = READY | -7.08 | 25.6pp |
| NCS ≥ 70 (A-Grade) | -4.27 | 16.8pp |
| NCS ≥ 60 | -5.30 | 13.5pp |
| FWS ≤ 30 | 4.53 | -10.7pp |

**Exit performance:**

| Exit category | Count | Avg R | Win rate |
|---------------|-------|-------|----------|
| Stop Hit (original ladder) | 47 | 0.15 | 58.3% |
| Early Exit (≤ 5d) | 77 | -0.51 | 25.0% |
| Normal Hold (6–20d) | 31 | 0.66 | 83.3% |
| Long Hold (> 20d) | 9 | -0.08 | 50.0% |
| All Exits | 117 | 0.15 | 58.3% |

**Small-account simulations:**

| Scenario | Trades | Win% | Avg R | Total R | Max DD (R) | Return% |
|----------|--------|------|-------|---------|-----------|---------|
| 2% risk, 4 pos, no pyramid | 0 | — | — | 0.00 | 0.00 | 0.0% |
| 2% risk, 4 pos, with pyramid | 0 | — | — | 0.00 | 0.00 | 0.0% |
| 2% risk, 4 pos, 0.3% slippage | 0 | — | — | 0.00 | 0.00 | 0.0% |
| 2% risk, 3 pos, no pyramid | 0 | — | — | 0.00 | 0.00 | 0.0% |
| 1.5% risk, 5 pos, no pyramid | 0 | — | — | 0.00 | 0.00 | 0.0% |

---

## 6. Audit Verdict & Flags

**System grade (P&L): B** | 🔴 0 red · 🟠 4 amber · 🟢 1 green

- 🟠 Only 23% of candidate outcomes are enriched — most rows too recent to have forward returns yet.
- 🟠 12 closed trades — preliminary; need ≥30 for reliable P&L conclusions.
- 🟠 15 positions exist but 0 candidate-outcome rows are marked tradePlaced — the candidate→trade linkage is not being written, so "did our picks convert?" cannot be measured.
- 🟠 Evidence-framework simulations returned 0 trades despite 12 closed trades — the simulation input feed (closed trades with R) is not wired, so the small-account projections are empty.
- 🟢 Positive expectancy (0.15R) over 12 trades.

**Verdict:** Data is sufficient and no red flags — edge review is meaningful.
