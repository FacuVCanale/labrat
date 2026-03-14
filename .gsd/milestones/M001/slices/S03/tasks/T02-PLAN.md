---
estimated_steps: 4
estimated_files: 1
---

# T02: Wire eval post-processing into handleAgentEnd

**Slice:** S03 — Eval Runner & Keep/Discard Engine
**Milestone:** M001

## Description

Add the experiment post-processing hook to `handleAgentEnd` in auto.ts. After the LLM finishes a `run-experiment` unit and the auto-commit happens, detect the unit type, grab the commit hash, and call `runExperimentPostProcess()`. This is the integration point that makes the eval engine actually run in the experiment loop.

## Steps

1. Add import for `runExperimentPostProcess` from `eval-runner.ts` and `countExperiments` from `state.ts` at the top of auto.ts.

2. In `handleAgentEnd`, after the auto-commit block (line ~549) and before the doctor/state-rebuild block (line ~551), add experiment post-processing. Guard with `currentUnit?.type === "run-experiment"`. Derive sliceDir from `currentUnit.id` (format: `M001/S01`) using the basePath and `.gsd/milestones/` path structure. Get commit hash via `execSync('git rev-parse HEAD', { cwd: basePath })`. Get experiment number via `countExperiments(sliceDir) + 1`. Call `runExperimentPostProcess({ sliceDir, basePath, experimentNumber, commitHash })`.

3. Wrap the call in try/catch — eval failure must not crash the dispatch loop. On success, notify UI with the decision (`ctx.ui.notify` with keep/discard result and key metrics). On error, notify UI with the error message and treat as a discarded experiment.

4. Verify build, run existing tests to confirm no regressions. Grep `handleAgentEnd` to confirm the hook is placed correctly between auto-commit and doctor.

## Must-Haves

- [ ] `run-experiment` unit type triggers eval post-processing after auto-commit
- [ ] Eval failure is non-fatal — caught and logged, dispatch continues
- [ ] UI notification shows keep/discard decision with reason
- [ ] Correct sliceDir derivation from currentUnit.id

## Verification

- `npm run build` — exits 0
- `npm test` — full test suite passes (no regressions)
- `grep -A5 'run-experiment.*post-process\|runExperimentPostProcess' src/resources/extensions/gsd/auto.ts` — confirms hook exists in handleAgentEnd

## Inputs

- `src/resources/extensions/gsd/eval-runner.ts` — `runExperimentPostProcess()` from T01
- `src/resources/extensions/gsd/auto.ts` — `handleAgentEnd()` at lines 528-582, existing auto-commit block

## Observability Impact

- **UI notifications:** Every `run-experiment` unit now emits a keep/discard notification with experiment ID, decision, reason, and metric values. Visible in the auto-mode notification stream.
- **Failure visibility:** Eval crashes surface as `"Experiment eval failed (non-fatal): <message>"` error notification — never silently swallowed.
- **Inspection:** `grep 'Experiment.*Kept\|Experiment.*Discarded' <logs>` shows decision history in UI output. EXPERIMENT-LOG.jsonl (written by eval-runner) is the durable record.
- **Future agent:** A future agent can verify this hook fires by checking for the UI notification after a `run-experiment` unit completes, or by inspecting EXPERIMENT-LOG.jsonl entries in the slice directory.

## Expected Output

- `src/resources/extensions/gsd/auto.ts` — modified with experiment post-processing hook in handleAgentEnd (~15-25 new lines)
