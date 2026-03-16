# S06: End-to-End Integration — Research

**Date:** 2026-03-16

## Summary

S06 is the integration proof for M005's hypothesis-driven research flow. All building blocks exist from S01-S05: NightShift naming (S01), Karpathy analysis (S02), interview/scaffold (S03), hypothesis-native prompts (S04), and hypothesis state machine with dispatch wiring (S05). The work is assembling these pieces into a proven end-to-end flow and fixing any integration gaps discovered along the way.

The codebase is in good shape. All 92 hypothesis contract tests pass. The scaffold generator roundtrips through all 3 parsers. The dispatch routing correctly branches on `hypothesisMode`. The handleAgentEnd handlers correctly advance hypothesis state. The JSONL count drives hypothesis→summarizing→complete-slice→next-hypothesis transitions correctly. The primary risk is not code gaps but behavioral gaps — whether the assembled system actually exercises real eval, real git, real web search, and real hypothesis cycling in a single run.

The recommendation is a focused integration test using the existing `examples/karpathy-smoke/` fixture, plus targeted wiring fixes for the issues discovered below.

## Recommendation

**Approach**: Build a contract-level integration test that exercises the full scaffold→dispatch→eval→state-transition flow using the karpathy-smoke fixture, without requiring a live LLM. This verifies the wiring layer — that scaffold output drives dispatch correctly, eval runs and produces JSONL entries, state transitions fire in the right order, and hypothesis-to-hypothesis transitions work.

Complement with targeted grep/assertion checks for the behavioral properties (naming compliance, prompt content, R049 requirements). Fix any wiring issues found. Do NOT attempt a live LLM e2e test — that's UAT territory and depends on API keys, token budget, and non-deterministic LLM behavior.

**Why**: The existing 92 hypothesis tests + 69 prompt tests + 99 scaffold tests cover individual components thoroughly. What's missing is proof that components compose correctly. A deterministic integration test that drives the state machine through scaffold→research→plan→execute(eval)→verify→next-experiment→next-hypothesis without an LLM fills this gap.

## Don't Hand-Roll

| Problem | Existing Solution | Why Use It |
|---------|------------------|------------|
| Scaffold generation | `generateNightShiftScaffold()` in nightshift-interview.ts | Pure function, proven by 99 assertions |
| State transitions | `advanceHypothesisPhase()` in hypothesis-state.ts | Atomic writes, crash recovery, proven by 43 assertions |
| Eval execution | `runExperimentPostProcess()` in eval-runner.ts | Full pipeline: subprocess → parse → score → keep/discard → JSONL |
| Campaign config parsing | `parseCampaignConfig()` in state.ts | Shape validation, null-on-invalid, used by all dispatch paths |
| State derivation | `deriveState()` in state.ts | 614 lines with 33+ contract tests, handles all phase transitions |
| Experiment counting | `countExperiments()` in state.ts | JSONL line count — drives the maxExperiments guard |

## Existing Code and Patterns

- `src/resources/extensions/gsd/hypothesis-state.ts` (186 lines) — Complete hypothesis state machine: types, atomic read/write (D045 pattern), phase transitions (research→plan→execute→verify→plan+1→done), results formatting. All exported and tested.
- `src/resources/extensions/gsd/auto.ts` lines 1574-1647 — Hypothesis-mode dispatch block in `dispatchNextUnit`. Reads `HYPOTHESIS-STATE.json`, switches on `subPhase`, calls the correct builder, reads inter-unit persistence files with placeholder fallback.
- `src/resources/extensions/gsd/auto.ts` lines 698-815 — Four `handleAgentEnd` cases for hypothesis unit types. `execute-hypothesis` runs eval, persists results, advances state. Others advance state. `verify-hypothesis` calls `advanceHypothesisPhase` with `maxExperiments` to detect hypothesis completion.
- `src/resources/extensions/gsd/nightshift-interview.ts` lines 53-148 — `generateNightShiftScaffold` pure function. Creates roadmap, per-slice plans, CAMPAIGN.json (with `hypothesisMode: true`), and optional PRIORS.md. Proven to roundtrip through all 3 parsers.
- `src/resources/extensions/gsd/state.ts` lines 462-512 — Campaign detection in `deriveState`. Returns `experimenting` when CAMPAIGN.json present and experiments < max, `summarizing` when experiments >= max.
- `src/resources/extensions/gsd/eval-runner.ts` lines 519-780 — `runExperimentPostProcess`. Full eval pipeline: compute backend → subprocess → metric parsing → scoring → keep/discard → JSONL append → git revert on discard. Called by execute-hypothesis handler.
- `examples/karpathy-smoke/` — Trivially fast eval fixture. `eval.py` runs `train.py`, outputs JSON metrics to stdout. Deterministic. Runs in <1 second. Perfect for integration tests.
- `src/resources/extensions/gsd/tests/hypothesis-dispatch.test.ts` — 49 assertions proving artifact paths, switch-site coverage, backward compat, dispatch routing via grep/source inspection. Pattern to follow for integration assertions.
- `src/resources/extensions/gsd/tests/hypothesis-state.test.ts` — 43 assertions proving state I/O, phase transitions, formatting, corruption recovery. Uses tmpdir fixtures.

## Constraints

- **No live LLM in integration tests**: Integration tests must be deterministic. The LLM agents (research, plan, execute, verify) write files and modify code — this behavior can't be deterministically replicated. Test the wiring/dispatch layer, not the LLM behavior.
- **GSD state machine is the backbone (D076)**: Do not modify `deriveState()` (614 lines, 33+ tests). Hypothesis dispatch lives in `dispatchNextUnit`, state derivation is read-only.
- **Auto-mode requires full runtime**: `dispatchNextUnit` uses `ctx.newSession()`, `ctx.ui.notify()`, `ctx.sessionManager`, etc. — integration tests can't easily call it directly. Test via sub-component composition instead.
- **Git state required for eval**: `runExperimentPostProcess` calls `git rev-parse HEAD`, `extractDiffStat`, `revertExperiment`. Integration tests need a real git repo.
- **Prompts are Mustache templates**: Template/builder var parity is already tested (69 assertions). Integration just needs to verify builders don't throw with real scaffold data.
- **Existing test harness is custom**: Project uses `node:assert` + custom `test()` wrappers, not node:test built-in's `describe/it`. Follow the existing pattern.

## Common Pitfalls

- **Missing git repo in test fixture** — `runExperimentPostProcess` calls `git rev-parse HEAD` and `extractDiffStat`. Tests must init a git repo and commit something first, or eval will fail with git errors.
- **JSONL count vs HYPOTHESIS-STATE mismatch** — `countExperiments` counts JSONL entries. `HYPOTHESIS-STATE.json` tracks experiment number independently. If these drift (e.g., eval fails to append), `deriveState` and `dispatchNextUnit` disagree on where we are. Integration test should verify they stay in sync.
- **`startAuto` called with 3 args from nightshift-interview.ts** — Missing `verboseMode` parameter (line 365). Works at runtime (JS ignores missing params, `verboseMode` is `undefined`→falsy) but should be fixed with explicit `false` for correctness.
- **Inter-unit file naming** — Plan files are `EXPERIMENT-N-PLAN.md` (no zero-padding), not `EXPERIMENT-001-PLAN.md`. The dispatch code at line 1602 uses `EXPERIMENT-${expNum}-PLAN.md` (raw number). Results files match. Analysis files match. Be consistent in tests.
- **complete-slice expects summary** — When `deriveState` returns `summarizing` after maxExperiments, the complete-slice unit runs. It expects a summary file. In hypothesis mode, there's no separate summary step — the agent is supposed to write it during verify. Integration test should verify this transition works or identify if a gap exists.
- **Hypothesis state corrupt recovery re-dispatches research** — If `HYPOTHESIS-STATE.json` is corrupted mid-hypothesis, `readHypothesisState` returns null → `dispatchNextUnit` creates initial state → re-dispatches research. This wastes one research dispatch but doesn't break the flow.

## Open Risks

- **complete-slice after hypothesis completion**: When all experiments finish, `deriveState` returns `summarizing`. The `complete-slice` prompt expects the LLM to write an `S0N-SUMMARY.md`. In hypothesis mode, the complete-slice prompt builds context from the slice files. It should find EXPERIMENT-LOG.jsonl and any HYPOTHESIS-RESEARCH.md. But it's an existing generic prompt — it might produce confusing output for hypothesis slices. Low risk (the LLM adapts), but worth verifying in the integration test.
- **Multi-hypothesis transitions**: The scaffold creates N hypothesis-slices (S01, S02, ..., S0N). After S01 completes (complete-slice merges), deriveState should find S02 as the next active slice. This depends on the roadmap having S02 unchecked. The scaffold writes all slices as unchecked. After complete-slice marks S01 done, S02 becomes active. This should work but hasn't been tested end-to-end.
- **Branch management per hypothesis-slice**: Each slice gets its own branch (standard GSD pattern). The hypothesis state file lives in the slice dir. When complete-slice merges, HYPOTHESIS-STATE.json should survive on main via squash-merge. This is standard slice behavior but worth verifying.

## Skills Discovered

| Technology | Skill | Status |
|------------|-------|--------|
| Node.js testing | (built-in node:assert) | No skill needed — project uses custom test harness |
| Integration testing | searched `npx skills find "integration testing"` | None relevant (all domain-specific: Oracle, .NET, etc.) |

## Sources

- Hypothesis state machine: `src/resources/extensions/gsd/hypothesis-state.ts` (186 lines, all exported functions)
- Dispatch wiring: `src/resources/extensions/gsd/auto.ts` lines 1574-1647 (dispatch) and 698-815 (handleAgentEnd)
- State derivation: `src/resources/extensions/gsd/state.ts` lines 462-512 (campaign detection/transition)
- Scaffold generator: `src/resources/extensions/gsd/nightshift-interview.ts` lines 53-148
- Eval pipeline: `src/resources/extensions/gsd/eval-runner.ts` lines 519-780
- Smoke test fixture: `examples/karpathy-smoke/` (eval.py, train.py, verify.sh)
- Existing hypothesis tests: `hypothesis-state.test.ts` (43 assertions), `hypothesis-dispatch.test.ts` (49 assertions), `hypothesis-prompt.test.ts` (69 assertions), `nightshift-interview.test.ts` (99 assertions)
- Decisions register: D076 (GSD 4-agent flow), D089 (HYPOTHESIS-STATE.json), D090 (hypothesisMode flag), D091 (plan to disk), D092 (results to disk)
