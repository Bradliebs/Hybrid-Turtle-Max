## Execution Discipline

This repository is a live, risk-sensitive trading system.

When working in this codebase:

- prefer small, surgical changes
- do not expand scope
- do not casually refactor money logic
- preserve behaviour unless explicitly asked to change it
- optimize for correctness, traceability, and low blast radius

If additional issues are noticed outside the task:
- note them separately
- do not fix them automatically

## Sacred File Escalation

The following files are sacred / risk-sensitive:

- stop-manager.ts
- position-sizer.ts
- risk-gates.ts
- regime-detector.ts
- dual-score.ts
- scan-engine.ts

If a task requires editing any of these files:

1. clearly state that a sacred file is being modified
2. explain why the change is necessary
3. make the smallest possible edit
4. add or extend tests
5. explain what behaviour must remain unchanged

Do not perform style-only or speculative refactors in sacred files.

## Scope Discipline

- Do only the requested task
- Do not bundle unrelated cleanup into the same change
- Do not fix neighbouring code unless it blocks the task
- If you spot related improvements, list them as follow-up notes only

## Advisory-Only Default

Any new feature involving:
- analytics
- prediction
- AI
- confidence scoring
- weighting
- optimization
- ranking overlays
- reinforcement learning

must default to:
- advisory-only
- shadow mode
- display-only
- no direct execution impact

unless explicitly instructed otherwise.

## Definition of Done

A task is not done unless:

- code is implemented
- types pass
- relevant tests pass
- changed files are listed
- risk-sensitive impact is explained
- manual checks are provided where relevant

## Required Task Response Format

For every non-trivial task, respond with:

1. Plan
2. Files to change
3. Risk-sensitive impact
4. Implementation
5. Tests run / still needed
6. Manual checks
7. Changed files summary