# Claude Code Prompt — Novel Signal Capture for HybridTurtle v2

Paste the prompt below into Claude Code (VSCode). It references the integration guide which you should add to your project first.

---

## Step 1: Add the integration guide to your project

Save the `ht2-integration-guide.md` file to your project root (or docs/ folder) so Claude Code can read it.

## Step 2: Paste this prompt

```
Read the file ht2-integration-guide.md in the project root. This contains the full specification for what we're building, including TypeScript code, Prisma schema changes, and pipeline wiring.

TASK: Implement passive novel signal capture for the nightly pipeline. This is DATA COLLECTION ONLY — no changes to scan logic, no changes to sacred files, no changes to any decision-making code.

CONTEXT:
- HybridTurtle v2 is a Next.js 14 / TypeScript / Prisma / PostgreSQL trading system
- It has sacred core files that MUST NOT be modified: regime-detector, dual-score, risk-gates, position-sizer, stop-manager, scan-engine
- It has a 9-step nightly pipeline with restart/dry-run capability
- Signal snapshots are already captured per-ticker per-scan with fields like ncs, bqs, fws, regime, adx, atrPct, etc.
- The system scans ~268 tickers via Yahoo Finance OHLCV data

WHAT TO DO (in this order):

1. SCHEMA: Add 5 nullable Float fields to the SignalSnapshot model in prisma/schema.prisma:
   - smartMoney21 (Float?)
   - entropy63 (Float?)
   - netIsolation (Float?)
   - fractalDim (Float?)
   - complexity (Float?)
   Add a comment block above them: "Novel signals — passive capture for Phase 6 prediction engine"
   Then run: npx prisma migrate dev --name add-novel-signals

2. CREATE src/lib/signals/novel-signals.ts
   Copy the implementation exactly from the integration guide section 2.
   This exports: computeSmartMoney, computeEntropy, computeFractalDimension, computeComplexity, computeAllNovelSignals
   All functions are pure — they take an array of OHLCV bars and return a number or null.
   Use Node.js built-in zlib for compression complexity (already available, no install needed).

3. CREATE src/lib/signals/network-isolation.ts
   Copy the implementation exactly from the integration guide section 3.
   This exports: computeNetworkIsolation
   It takes all tickers' return series and returns a Map<string, number> of isolation scores.

4. PIPELINE WIRING: Find where the nightly pipeline fetches price data and where it runs the scan.
   Add a new step BETWEEN data fetch and scan that:
   a. Calls computeAllNovelSignals(bars) for each ticker
   b. Calls computeNetworkIsolation(allReturnSeries) once for the full universe
   c. Attaches the results to whatever data structure gets passed to the snapshot capture
   This step should:
   - Log a summary line like "[novel-signals] Computed for 268 tickers"
   - Be skippable in dry-run mode (compute but don't persist)
   - NOT block the pipeline if it fails — wrap in try/catch and log errors
   - NOT affect any existing pipeline step behaviour

5. SNAPSHOT CAPTURE: Find where SignalSnapshot records are created (the Prisma create call).
   Add the 5 novel fields to the create data, pulling from whatever context the pipeline step populated.
   Default to null if novel signals weren't computed (graceful degradation).

CONSTRAINTS:
- DO NOT modify any sacred files
- DO NOT add novel signals to the scan-engine scoring or filtering logic
- DO NOT add any new npm dependencies
- DO NOT change the scan output (status, regime, breakout_level, stop_level, etc.)
- DO NOT add UI for novel signals yet
- All novel signal fields must be nullable (Float?) — the system must work identically if they're all null
- Add tests for the pure computation functions (novel-signals.ts) if a test framework is set up

Show me the plan before making changes. List each file you'll modify and what changes you'll make.
```

## Step 3: Review the plan

Claude Code will show you which files it intends to modify. Check that:
- It's NOT touching any sacred files
- It's NOT modifying scan-engine logic
- The schema migration looks clean
- The pipeline step is positioned correctly

Then approve and let it execute.

## Step 4: Verify

After implementation, run:
```bash
npx prisma migrate dev --name add-novel-signals
npm run test  # if tests exist
npm run build  # type check
```

Then do a dry-run of the nightly pipeline and check that:
1. Novel signals compute without errors
2. The log shows "[novel-signals] Computed for N tickers"
3. The scan output is identical to before (no decision changes)
4. Signal snapshots now include the 5 new fields

---

## Alternative: Phased approach (if you prefer smaller PRs)

If you want to break it into smaller steps, use these prompts in sequence:

### Prompt A — Schema only
```
Add 5 nullable Float fields to the SignalSnapshot model in prisma/schema.prisma: smartMoney21, entropy63, netIsolation, fractalDim, complexity. Add a comment: "Novel signals — passive capture for Phase 6 prediction engine". Run the migration.
```

### Prompt B — Signal module
```
Read ht2-integration-guide.md section 2. Create src/lib/signals/novel-signals.ts with the exact implementation from the guide. Export computeSmartMoney, computeEntropy, computeFractalDimension, computeComplexity, computeAllNovelSignals. Add unit tests if a test framework exists. No dependencies beyond Node built-in zlib.
```

### Prompt C — Network module
```
Read ht2-integration-guide.md section 3. Create src/lib/signals/network-isolation.ts with the exact implementation. Export computeNetworkIsolation. Add unit tests if a test framework exists.
```

### Prompt D — Pipeline wiring
```
Read ht2-integration-guide.md sections 4 and 5. Wire the novel signal computation into the nightly pipeline between data fetch and scan. Compute per-ticker signals and network isolation. Attach results to signal snapshot creation. Wrap in try/catch — must not break the pipeline if novel signals fail. DO NOT modify sacred files or scan logic.
```
