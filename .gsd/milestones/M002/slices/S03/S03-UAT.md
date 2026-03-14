# S03: Runtime Steering — UAT

**Milestone:** M002
**Written:** 2026-03-14

## UAT Type

- UAT mode: mixed (artifact-driven for I/O and wiring, live-runtime for two-terminal steering exercise)
- Why this mode is sufficient: Core steering logic (atomic I/O, directive application, facade behavior) proven by 137 contract tests. Two-terminal operational exercise confirms the end-to-end user experience that contract tests cannot simulate.

## Preconditions

- `npm run build` passes clean
- `npx tsx src/resources/extensions/gsd/tests/steering.test.ts` — 76 passed
- `npx tsx src/resources/extensions/gsd/tests/steering-command.test.ts` — 61 passed
- A campaign is active (CAMPAIGN.json exists in a slice directory) — use `labrat start` or set up manually
- Two terminal windows available for concurrent process exercise

## Smoke Test

1. Open a terminal and start a campaign: `labrat start --target src/example.ts --eval "echo '{\"score\": 0.5}'" --metric score:max`
2. Open a second terminal in the same directory
3. Run `labrat discuss` (or `/gsd discuss` in interactive mode)
4. **Expected:** The discuss flow routes to steering mode (not normal discuss), showing campaign context and asking about steering intent

## Test Cases

### 1. Atomic Write and Read Roundtrip

1. In a test directory, create a STEERING.json manually:
   ```json
   {"type": "refocus", "message": "Try smaller learning rates", "timestamp": "2026-03-14T00:00:00Z"}
   ```
2. Run: `npx tsx -e "import {readSteeringDirective} from './src/resources/extensions/gsd/steering.ts'; const d = readSteeringDirective('<test-dir>'); console.log(JSON.stringify(d))"`
3. **Expected:** Prints the directive object with type, message, timestamp fields intact

### 2. Corrupt STEERING.json Recovery

1. Write invalid JSON to `<slice-dir>/STEERING.json`: `echo "not json {" > <slice-dir>/STEERING.json`
2. Start or resume `labrat auto` for that campaign
3. **Expected:** Auto loop continues without crashing. stderr shows `[steering] Corrupt STEERING.json in <dir>`. The corrupt file is treated as no directive (null).

### 3. Refocus Directive via Discuss

1. Start `labrat auto` in terminal 1 — campaign begins running experiments
2. In terminal 2, run `labrat discuss`
3. Tell the LLM: "I want to refocus on trying smaller batch sizes"
4. The LLM formulates a refocus directive and writes `STEERING.json`
5. **Expected:**
   - `cat <slice-dir>/STEERING.json` shows `{"type": "refocus", "message": "...", "timestamp": "..."}`
   - Terminal 2 prints: "Steering directive written. Will take effect after the current experiment finishes."
   - After the current experiment completes in terminal 1, `ui.notify` shows "Steering: refocused — ..."
   - `cat <slice-dir>/STEERING-FOCUS.md` contains the refocus message
   - STEERING.json is deleted (consumed)
   - Subsequent experiments include the refocus context in their prompts

### 4. Skip Phase Directive

1. Start a campaign with an agenda that has multiple phases
2. During phase 1, write a skip_phase directive:
   ```json
   {"type": "skip_phase", "message": "Phase 1 explored enough", "timestamp": "2026-03-14T00:00:00Z"}
   ```
3. Wait for current experiment to finish
4. **Expected:**
   - `ui.notify` shows "Steering: skipped to next phase"
   - `jq '.currentPhaseIndex' <slice-dir>/AGENDA-STATE.json` shows the next phase index
   - Subsequent experiments target the next phase's dimensions/goals
   - STEERING.json is deleted
   - STEERING-FOCUS.md is cleared (new phase = fresh direction)

### 5. Stop Directive

1. While `labrat auto` is running, write a stop directive:
   ```json
   {"type": "stop", "message": "Enough for today", "timestamp": "2026-03-14T00:00:00Z"}
   ```
2. **Expected:**
   - After current experiment finishes, the auto loop stops gracefully
   - `ui.notify` shows "Steering: campaign stopped"
   - No further experiments are dispatched
   - STEERING.json is deleted

### 6. Skip Phase on Non-Agenda Campaign

1. Start a campaign without an agenda (no agenda field in CAMPAIGN.json)
2. Write a skip_phase directive to STEERING.json
3. Wait for experiment boundary
4. **Expected:**
   - `ui.notify` shows warning that skip_phase requires an agenda — no-op
   - Campaign continues normally
   - STEERING.json is deleted (consumed even though no-op)

### 7. Discuss Command Routing

1. With NO active campaign, run `labrat discuss`
2. **Expected:** Normal discuss flow (milestone/roadmap discussion), NOT steering
3. Start a campaign, then run `labrat discuss` again
4. **Expected:** Routes to steering flow — shows campaign context, asks about steering intent

### 8. Steering Context in Experiment Prompts

1. Write a refocus directive and let it be consumed
2. Check that `STEERING-FOCUS.md` exists with refocus content
3. Run the next experiment
4. **Expected:** The experiment prompt includes the steering context section (visible in LLM conversation or by inspecting buildExperimentPrompt output)

## Edge Cases

### Missing STEERING.json (Normal State)

1. Ensure no STEERING.json exists in slice directory
2. Auto loop dispatches next experiment
3. **Expected:** No steering notification, experiment runs normally — STEERING.json absence is the default/happy path

### Rapid Successive Directives

1. Write a refocus directive to STEERING.json
2. Before the auto loop reads it, overwrite with a different directive
3. **Expected:** The auto loop reads whichever directive is on disk at experiment boundary — last writer wins (atomic writes prevent partial reads)

### Skip Phase When All Phases Complete

1. Set up a campaign with agenda where all phases are marked complete in AGENDA-STATE.json
2. Write a skip_phase directive
3. **Expected:** Graceful degradation — notify message says all phases complete, no advancement, no crash

### Concurrent Write During Read

1. The atomic write-to-temp-then-rename pattern means reads never see partial writes
2. **Expected:** Even if `writeSteeringDirective` and `readSteeringDirective` overlap, the reader sees either the old complete file or the new complete file, never a partial

## Failure Signals

- `labrat auto` crashes or hangs when STEERING.json is present — steering should never block experiments
- `labrat discuss` shows normal discuss flow when campaign is active — routing is broken
- STEERING.json persists after experiment boundary — consumption/deletion failed
- `ui.notify` never fires after directive is written — auto loop isn't checking steering
- `STEERING-FOCUS.md` not created after refocus — persistent context broken
- Phase doesn't advance after skip_phase — agenda integration broken
- Experiment prompt doesn't include steering context when STEERING-FOCUS.md exists — prompt injection broken

## Requirements Proved By This UAT

- R018 (Runtime Steering) — `discuss` command redirects campaign via steering directives picked up at experiment boundaries. Three directive types (refocus, skip_phase, stop) with graceful degradation for non-agenda campaigns.

## Not Proven By This UAT

- `add_experiments` directive type (deferred per D048)
- Steering under high-concurrency stress (dozens of rapid directives per second)
- LLM quality of directive formulation (depends on model, not testable mechanically)
- Real overnight campaign with steering applied mid-run (requires extended runtime UAT)

## Notes for Tester

- The steering check happens at experiment boundaries (between experiments, not mid-experiment). If an experiment takes 5 minutes, the steering directive waits up to 5 minutes before being read.
- `STEERING.json` is a consumed-then-deleted file — it exists briefly between `labrat discuss` writing it and `labrat auto` consuming it. Finding it empty is the normal state.
- `STEERING-FOCUS.md` is persistent — it survives across experiments until cleared by a new phase or new refocus. This is the file that actually influences future experiment prompts.
- The `npm test` full suite has pre-existing failures from `mlops-integration.ts` (parameter property syntax in --experimental-strip-types). These are unrelated to S03. Run individual test suites via `npx tsx` for clean results.
