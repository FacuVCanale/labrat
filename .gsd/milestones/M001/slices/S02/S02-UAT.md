# S02: Research Types & State Machine — UAT

**Milestone:** M001
**Written:** 2026-03-13

## UAT Type

- UAT mode: artifact-driven
- Why this mode is sufficient: This slice is pure types, state logic, and git operations — all verifiable through unit/integration tests and build checks. No runtime loop or UI to test.

## Preconditions

- Repository cloned and dependencies installed (`npm install`)
- `npm run build` passes (S01 complete)
- Git available on PATH

## Smoke Test

Run `npm run build && npm test -- research-types.test.ts git-experiment.test.ts` — build succeeds and all 47 tests pass.

## Test Cases

### 1. Campaign config triggers experimenting phase

1. Create a valid CAMPAIGN.json in a slice directory:
   ```json
   {
     "researchQuestion": "Test question",
     "targetFiles": ["test.py"],
     "evalCommand": "python eval.py",
     "metrics": [{"name": "accuracy", "direction": "maximize", "weight": 1.0}]
   }
   ```
2. Call `deriveState()` with that slice path as the active slice
3. **Expected:** State has `phase: "experimenting"` and `progress.experiments` with `done` and `total` fields

### 2. Missing campaign config yields normal phase

1. Call `deriveState()` on a slice directory with no CAMPAIGN.json
2. **Expected:** State returns a normal development phase (e.g., `executing`, `planning`), not `experimenting`

### 3. Malformed campaign config degrades gracefully

1. Create a CAMPAIGN.json with invalid JSON: `{broken`
2. Call `deriveState()` with that slice path
3. **Expected:** State returns a normal phase, not crash. parseCampaignConfig returns null.

### 4. Incomplete campaign config (missing required fields)

1. Create a CAMPAIGN.json with only `{ "researchQuestion": "test" }` — missing targetFiles, evalCommand, metrics
2. Call `deriveState()` with that slice path
3. **Expected:** parseCampaignConfig returns null, state falls through to normal phase

### 5. Experiment progress reflects JSONL log

1. Create a CAMPAIGN.json (valid) and an EXPERIMENT-LOG.jsonl with 3 lines of JSON objects
2. Call `deriveState()` with that slice path
3. **Expected:** `progress.experiments.done === 3`, `progress.experiments.total` reflects CampaignConfig.maxExperiments or default

### 6. classifyUnitPhase maps run-experiment correctly

1. Call `classifyUnitPhase("run-experiment")`
2. **Expected:** Returns `"experiment"`
3. Call `classifyUnitPhase("write-code")` (existing type)
4. **Expected:** Returns `"execution"` (unchanged behavior)

### 7. run-experiment wired into auto.ts switch sites

1. Call `unitVerb("run-experiment")`
2. **Expected:** Returns a verb string (not undefined, not throwing)
3. Call `unitPhaseLabel("run-experiment")`
4. **Expected:** Returns a label string
5. Call `describeNextUnit("run-experiment", ...)`
6. **Expected:** Returns a description string mentioning experiment

### 8. commitExperiment produces labeled commit

1. Initialize a git repo, create and stage a file change
2. Call `commitExperiment(repoPath, "E001", "test activation function")`
3. **Expected:** Git log shows commit with message matching `experiment(E001): test activation function`
4. Returns a valid commit hash (40 hex chars)

### 9. revertExperiment produces clean revert

1. After commitExperiment (test 8), call `revertExperiment(repoPath, "E001", commitHash, "no improvement")`
2. **Expected:** Git log shows commit with message matching `revert(E001): discard — no improvement`
3. Working tree matches pre-experiment state (tree hash comparison)

### 10. revertExperiment is idempotent

1. Call `revertExperiment()` again with the same experimentId and commitHash
2. **Expected:** No error thrown, no duplicate revert commit created

### 11. commitExperiment throws on empty staging

1. Initialize a git repo with no uncommitted changes
2. Call `commitExperiment(repoPath, "E002", "nothing changed")`
3. **Expected:** Throws an error (not a silent no-op)

### 12. Dispatch guard allows run-experiment

1. Call `getPriorSliceCompletionBlocker(base, main, "run-experiment", sliceId)` where prior slices are complete on main
2. **Expected:** Returns null (no blocker)

### 13. Dispatch guard blocks run-experiment when prior slices incomplete

1. Call `getPriorSliceCompletionBlocker(base, main, "run-experiment", sliceId)` where prior slices are NOT complete on main
2. **Expected:** Returns a string describing the blocker

### 14. LockData includes experiment fields

1. Inspect LockData type definition in crash-recovery.ts
2. **Expected:** Has optional `experimentNumber?: number` and `lastMetrics?: Record<string, number>` fields

### 15. GSDPreferences includes research section

1. Inspect GSDPreferences type in preferences.ts
2. **Expected:** Has optional `research` field with `evalTimeout`, `maxExperiments`, `budgetPerExperiment`, `metricDirections`

## Edge Cases

### parseCampaignConfig with non-object JSON

1. Create CAMPAIGN.json containing `"just a string"` or `42` or `null`
2. Call `parseCampaignConfig(slicePath)`
3. **Expected:** Returns null (not crash)

### countExperiments with missing JSONL file

1. Call `countExperiments(slicePath)` where no EXPERIMENT-LOG.jsonl exists
2. **Expected:** Returns 0 (not crash)

### countExperiments with empty JSONL file

1. Create an empty EXPERIMENT-LOG.jsonl
2. Call `countExperiments(slicePath)`
3. **Expected:** Returns 0

### countExperiments with trailing newline

1. Create EXPERIMENT-LOG.jsonl with content `{"id":"E001"}\n{"id":"E002"}\n` (trailing newline)
2. Call `countExperiments(slicePath)`
3. **Expected:** Returns 2 (not 3 — empty trailing line ignored)

## Failure Signals

- `npm run build` fails with unhandled Phase or unit type in a switch statement
- `research-types.test.ts` reports < 33 passing tests
- `git-experiment.test.ts` reports < 14 passing tests
- `grep 'Unexpected phase' auto.ts` shows `experimenting` reaching the exhaustive throw
- `derive-state.test.ts` or `dispatch-guard.test.ts` regress (existing tests break)

## Requirements Proved By This UAT

- R002 (Research Flow Semantics) — Tests 1-5 prove state machine dual-mode with research semantics, tests 6-7 prove dispatch routing
- R006 (Git-Based Experiment State) — Tests 8-11 prove atomic commit/revert lifecycle on campaign branches

## Not Proven By This UAT

- Actual experiment execution (eval running, metric parsing, keep/discard) — S03
- Research prompt quality and context assembly — S04
- Crash recovery consuming LockData experiment fields — S05
- End-to-end experiment loop — S03+S04+S05 integration

## Notes for Tester

- All test cases in sections 1-15 are already covered by the automated test suite (research-types.test.ts and git-experiment.test.ts). Running the tests IS the UAT for this contract-level slice.
- The experiment dispatch in auto.ts contains a stub prompt — this is intentional, not a bug. Real prompt building is S04's scope.
- Git experiment tests create temporary repos in /tmp — they clean up after themselves but may leave artifacts if tests are killed mid-run.
