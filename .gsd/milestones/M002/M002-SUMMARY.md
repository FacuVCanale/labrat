---
id: M002
provides:
  - "simplicity-scorer.ts — diff-stat based simplicity scoring with configurable weight"
  - "agenda.ts — structured research agenda with multi-phase execution, crash-recoverable state"
  - "steering.ts — atomic STEERING.json I/O with experiment-boundary directive processing"
  - "labrat plan command — LLM-assisted agenda decomposition into ordered phases"
  - "labrat discuss routing to steering during active campaigns"
  - "Phase-aware experiment prompts with phase goals, dimension focus, phase-level baselines"
  - "Pre-eval target file validation with immediate revert on scope violation"
  - "CampaignConfig backward-compatible extensions (simplicityWeight, agenda — all optional)"
key_decisions:
  - "D038: Diff-stat simplicity scoring (language-agnostic, default-off)"
  - "D039: Module extraction pattern (simplicity-scorer.ts, agenda.ts, steering.ts)"
  - "D040: Sequential phases not DAG"
  - "D041: Atomic write-to-temp-then-rename for concurrent file access"
  - "D042: CampaignConfig backward compat via optional fields"
  - "D043: Post-commit target file validation with immediate revert"
  - "D044: Phase transitions in dispatchNextUnit, not deriveState"
  - "D045: Atomic AGENDA-STATE.json writes"
  - "D047: Facade functions for thin auto.ts wiring"
  - "D048: Three steering directive types (refocus, skip_phase, stop); add_experiments deferred"
  - "D049: Persistent refocus context via STEERING-FOCUS.md"
  - "D050: Discuss command routing via deriveState phase check"
  - "D051: LLM-assisted steering via gsd-steer workflow dispatch"
patterns_established:
  - "Pure-function module extraction: new .ts module with facade functions, called from auto.ts with thin wiring"
  - "Atomic file I/O via write-to-temp-then-rename for crash-recoverable and concurrent-access-safe state files"
  - "Template variable that collapses to empty string for non-applicable campaigns (phaseContext, steeringContext)"
  - "Optional CampaignConfig fields with sensible defaults — zero behavioral change for M001-era configs"
  - "Facade function pattern: multi-step operations packaged as single auto.ts call sites"
  - "Context-aware command routing based on campaign state (discuss → steering)"
observability_surfaces:
  - "ExperimentResult.simplicityScore in EXPERIMENT-LOG.jsonl — per-experiment simplicity scores"
  - "AGENDA-STATE.json — phase progress, experiment ranges, phase results"
  - "STEERING.json — pending directive (consumed-then-deleted, usually empty)"
  - "STEERING-FOCUS.md — active refocus context (persists across experiments)"
  - "ctx.ui.notify on phase transitions and steering directive application"
  - "phaseIndex in EXPERIMENT-LOG.jsonl — per-experiment phase attribution"
  - "Target file violations in decision.reason in EXPERIMENT-LOG.jsonl"
  - "[steering] / [agenda] corrupt file stderr warnings on graceful recovery"
requirement_outcomes:
  - id: R016
    from_status: active
    to_status: validated
    proof: "labrat plan decomposes research questions into structured agendas with phases via plan-agenda.md template + parseAgenda validation. 45 plan-command + 106 agenda contract tests."
  - id: R017
    from_status: active
    to_status: validated
    proof: "computeSimplicityScore produces 0-1 score from diff stats. makeKeepDiscardDecision blends metric+simplicity when simplicityWeight>0. Weight=0/absent identical to M001. 39 contract tests."
  - id: R018
    from_status: deferred
    to_status: validated
    proof: "steering.ts with atomic STEERING.json I/O, checkSteeringDirective in dispatchNextUnit, 3 directive types (refocus/skip_phase/stop). showDiscuss routes to showSteering when campaign active. 137 contract tests."
  - id: R019
    from_status: active
    to_status: validated
    proof: "validateTargetFiles checks git diff --name-only against targetFiles[]. Violations trigger immediate revert without eval. Git failure safely defaults to valid. 31 contract tests."
  - id: R020
    from_status: active
    to_status: validated
    proof: "Phase boundary detection via checkAndAdvancePhase in dispatchNextUnit. Phase-scoped prompts, metrics, history. AGENDA-STATE.json crash-recoverable. 61+106 contract tests."
duration: 123m
verification_result: passed
completed_at: 2026-03-14
---

# M002: Structured Research & Intelligence

**Labrat transformed from brute-force optimizer into structured research partner — agenda planning decomposes multi-dimensional questions into phased experiments, simplicity-aware scoring prefers cleaner code, pre-eval scope validation catches out-of-scope modifications, and mid-campaign steering enables runtime redirection — all backward-compatible with M001, proven by 419 new contract tests with zero regressions across 274 existing assertions.**

## What Happened

M002 shipped in three slices over ~2 hours, each building on the previous via a consistent module extraction pattern (D039): pure-function TypeScript modules with facade functions, called from auto.ts with thin wiring.

**S01: Simplicity-Aware Evaluation & Multi-File Safety (40m)** — Created `simplicity-scorer.ts` with `extractNumericDiffStat` (parses `git diff --numstat`) and `computeSimplicityScore` (score = 1/(1+totalChurn), producing 0–1 values). Extended `makeKeepDiscardDecision` with optional simplicity blending: when `simplicityWeight > 0`, blends `(1-weight)*metricSignal + weight*simplicitySignal` so simpler solutions with slightly lower metrics can win. Added `validateTargetFiles` to `eval-runner.ts` — checks `git diff --name-only HEAD~1..HEAD` against the declared target set, immediately reverting violations without wasting eval time. Both features default-off; weight=0 or absent produces identical M001 behavior. 70 new assertions (39 simplicity + 31 target validation), all 73 eval-runner tests unchanged.

**S02: Research Agenda Planning & Execution (53m)** — Created `agenda.ts` (~369 lines) with four type definitions (`AgendaConfig`, `AgendaPhase`, `ExperimentPlan`, `AgendaState`), validation (`parseAgenda`), atomic state I/O via temp+rename, phase navigation (`getCurrentPhase`/`advancePhase`/`shouldAdvancePhase`), and three facade functions for auto.ts wiring (`checkAndAdvancePhase`, `getPhasePromptOverrides`, `stampPhaseIndex`). Phase boundary detection fires in `dispatchNextUnit` — when a phase's experiments are exhausted, triggers reassessment then advances with phase-level baseline updates. Added `labrat plan` command with campaign-aware guards, `plan-agenda.md` template with AgendaConfig JSON schema, and auto-start bridge that initializes AGENDA-STATE.json and triggers auto-mode. `{{phaseContext}}` template variable in `run-experiment.md` collapses to empty string for non-agenda campaigns. Auto.ts stayed at 3269 lines (19 net delta). 212 new assertions, all 186 existing backward-compat tests passing.

**S03: Runtime Steering (30m)** — Created `steering.ts` (~219 lines) with atomic STEERING.json I/O (write-to-temp-then-rename), persistent refocus context via STEERING-FOCUS.md, and `checkSteeringDirective` facade that reads/applies/clears directives at experiment boundaries. Three directive types: `refocus` (writes focus file for prompt injection across subsequent experiments), `skip_phase` (advances via agenda.ts with graceful degradation for non-agenda campaigns), `stop` (halts campaign). `showDiscuss` routes to `showSteering` when campaign is active — no new subcommand needed. `steer-campaign.md` prompt template enables LLM-assisted directive formulation. `{{steeringContext}}` added to `run-experiment.md`. Auto.ts at 3275 lines (+6 net). 137 new assertions, all S01/S02 regression suites passing.

**Cross-slice integration**: The boundary map held precisely — S01 established the module extraction pattern and CampaignConfig extension approach consumed by S02 and S03. S02's agenda.ts functions were imported by S03's steering.ts for `skip_phase` support. All three modules' facade functions are called from the same `dispatchNextUnit` block in auto.ts, executing in sequence: steering check → phase boundary check → experiment dispatch.

## Cross-Slice Verification

Each success criterion from M002-ROADMAP.md verified:

**1. "Running a campaign with `simplicityWeight > 0` causes the loop to prefer simpler code when metric improvement is within the configured margin"**
✅ MET — `simplicity-scorer.test.ts` assertion "weight>0 prefers simpler code when metric regresses" proves blended scoring changes keep/discard decisions. `simplicityScore` appears in ExperimentResult (JSON round-trip test). Weight=0 tests prove identical M001 behavior. 39 contract tests.

**2. "A multi-file experiment that modifies files outside the `targetFiles` list is caught post-commit and reverted without running the eval command"**
✅ MET — `target-file-validation.test.ts` assertions "commit touching extra file → invalid" and "pipeline: target file violation → revert without running eval" prove the full path. `validateTargetFiles` checks `git diff --name-only`, violation triggers immediate revert. 31 contract tests.

**3. "`labrat plan` decomposes a multi-dimensional research question into a structured agenda with ordered phases and concrete experiment plans"**
✅ MET — `plan-command.test.ts` proves command registration, prompt assembly with campaign context and JSON schema, agenda validation via `parseAgenda`, and auto-start bridge. `plan-agenda.md` template includes complete AgendaConfig schema with 3-phase example. 45 + 106 contract tests.

**4. "A campaign with a multi-phase agenda executes phase 1, reassesses at the boundary, then proceeds to phase 2 with the best result from phase 1 as the new baseline"**
✅ MET — `agenda-execution.test.ts` assertions for `checkAndAdvancePhase` (boundary detection, phase advance with metrics), `getPhasePromptOverrides` (phase-scoped context/metrics/history), and `stampPhaseIndex` (phase attribution). Phase-level best metrics update at boundaries. 61 contract tests.

**5. "Agenda state survives process crash — restarting a mid-phase campaign resumes from the correct phase and experiment"**
✅ MET — `agenda.test.ts` proves atomic write-to-temp-then-rename for AGENDA-STATE.json, corrupt state recovery (returns null, triggers phase-0 safe default), version field for future migration, and full write→read round-trip persistence. 106 contract tests including crash-recovery paths.

**6. "`labrat discuss` in a separate terminal writes steering directives that the running `labrat auto` loop picks up at the next experiment boundary"**
✅ MET — `steering.test.ts` proves atomic STEERING.json read/write/clear, `checkSteeringDirective` facade processes all 3 directive types (refocus/skip_phase/stop) at experiment boundaries. `steering-command.test.ts` proves `showDiscuss` routes to `showSteering` when campaign active. Latency communicated via `steer-campaign.md` prompt instruction. 137 contract tests.

**7. "All existing M001-era campaigns (no agenda, no simplicity config) still parse and run identically"**
✅ MET — `eval-runner.test.ts` (73), `derive-state.test.ts` (113), `experiment-prompt.test.ts` (55), `research-types.test.ts` (33) — all 274 existing assertions pass unchanged. CampaignConfig backward compat proven by "without simplicityWeight parses", "without agenda parses identically" tests.

**Definition of Done verification:**
- ✅ All three slices completed with passing contract tests — 419 new assertions extending the existing suite
- ✅ `labrat plan` produces a valid structured agenda from an interactive discussion flow
- ✅ Simplicity scoring integrates into `makeKeepDiscardDecision()` with configurable weight via `simplicityWeight`
- ✅ Post-commit target file validation catches out-of-scope modifications and reverts without eval
- ✅ Multi-phase agenda campaign executes phase boundaries with reassessment and phase-level baseline updates
- ✅ `labrat discuss` writes `STEERING.json` that the running loop picks up at experiment boundaries
- ✅ Existing M001-era `CAMPAIGN.json` files still parse and campaigns run without modification (274 backward-compat tests)
- ✅ `npm run build` compiles clean
- ✅ New features live in separate modules (`simplicity-scorer.ts`, `agenda.ts`, `steering.ts`) — auto.ts at 3275 lines (25 net increase, all thin wiring)

## Requirement Changes

- R016: active → validated — `labrat plan` with agenda decomposition, JSON schema, auto-start bridge. 151 contract tests.
- R017: active → validated — Diff-stat simplicity scoring with configurable weight, blended keep/discard. 39 contract tests.
- R018: deferred → validated — Steering module with atomic I/O, 3 directive types, discuss routing. 137 contract tests.
- R019: active → validated — Post-commit target file validation with immediate revert on violation. 31 contract tests.
- R020: active → validated — Phase boundary detection, phase-scoped execution, crash-recoverable state. 167 contract tests.

## Forward Intelligence

### What the next milestone should know
- auto.ts is at 3275 lines — the effective ceiling. Any new wiring must extract compensating lines or the limit must increase. The module extraction pattern (pure-function .ts module + facade functions) is the proven approach.
- Three atomic state files now live in slice directories: `AGENDA-STATE.json`, `STEERING.json`, `STEERING-FOCUS.md`. All use write-to-temp-then-rename. Any new state files should follow the same pattern.
- `CampaignConfig` extension is purely additive — optional fields with sensible defaults. `parseCampaignConfig` validates required fields only, new optional fields pass through the `as CampaignConfig` cast.
- The `dispatchNextUnit` experimenting block now has three sequential checks: steering → phase boundary → experiment dispatch. New hooks should integrate at this same boundary.
- `npm test` full suite has pre-existing failures from `mlops-integration.ts` TypeScript parameter property syntax in `--experimental-strip-types` mode — not a real regression, individual test files run clean via `npx tsx`.

### What's fragile
- auto.ts line count at exactly 3275 (ceiling) — any addition without extraction will breach the limit
- `stampPhaseIndex` patches the last line of JSONL — breaks if JSONL format changes or entries span multiple lines
- `runExperimentPostProcess` is the main orchestration point with ordered gates (diff-stat → simplicity → target validation → eval loop → keep/discard) — order matters, new gates must maintain the sequence

### Authoritative diagnostics
- `npx tsx <test-file>` for any of the 11 M002 test files — each is self-contained with explicit pass/fail counts
- `jq '.simplicityScore' EXPERIMENT-LOG.jsonl` — per-experiment simplicity scores
- `jq '.' AGENDA-STATE.json` — ground truth for phase progress
- `cat STEERING-FOCUS.md` — active refocus context
- `wc -l src/resources/extensions/gsd/auto.ts` — line count ceiling check

### What assumptions changed
- Test assertion counts far exceeded estimates: 419 actual vs ~250 estimated. Pure-function module design made thorough testing straightforward.
- auto.ts net growth was only 25 lines across all three slices (3250 → 3275) — the facade function pattern kept wiring minimal.
- `add_experiments` steering directive deferred (D048) — semantics unclear, three shipped types cover core value.

## Files Created/Modified

- `src/resources/extensions/gsd/simplicity-scorer.ts` — new module (84 lines): diff-stat extraction, simplicity scoring
- `src/resources/extensions/gsd/agenda.ts` — new module (369 lines): types, validation, state I/O, phase navigation, facade functions
- `src/resources/extensions/gsd/steering.ts` — new module (219 lines): atomic directive I/O, refocus context, steering facade
- `src/resources/extensions/gsd/types.ts` — added DiffStat, SimplicityScore, AgendaConfig, AgendaPhase, ExperimentPlan, AgendaState, SteeringDirective types; extended CampaignConfig and ExperimentResult
- `src/resources/extensions/gsd/auto.ts` — thin wiring for all three modules (3275 lines, +25 from M001 baseline)
- `src/resources/extensions/gsd/eval-runner.ts` — extended makeKeepDiscardDecision, added validateTargetFiles
- `src/resources/extensions/gsd/commands.ts` — registered plan subcommand, updated help text
- `src/resources/extensions/gsd/guided-flow.ts` — showPlan, showSteering, buildPlanPrompt, buildSteeringPrompt, discuss routing
- `src/resources/extensions/gsd/index.ts` — wired checkAutoStartAfterPlan
- `src/resources/extensions/gsd/prompts/run-experiment.md` — added phaseContext and steeringContext template variables
- `src/resources/extensions/gsd/prompts/plan-agenda.md` — new prompt template with AgendaConfig JSON schema
- `src/resources/extensions/gsd/prompts/steer-campaign.md` — new prompt template for LLM-assisted steering
- `src/resources/extensions/gsd/tests/simplicity-scorer.test.ts` — 39 assertions
- `src/resources/extensions/gsd/tests/target-file-validation.test.ts` — 31 assertions
- `src/resources/extensions/gsd/tests/agenda.test.ts` — 106 assertions
- `src/resources/extensions/gsd/tests/agenda-execution.test.ts` — 61 assertions
- `src/resources/extensions/gsd/tests/plan-command.test.ts` — 45 assertions
- `src/resources/extensions/gsd/tests/steering.test.ts` — 76 assertions
- `src/resources/extensions/gsd/tests/steering-command.test.ts` — 61 assertions
