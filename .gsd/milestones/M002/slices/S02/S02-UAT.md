# S02: Research Agenda Planning & Execution — UAT

**Milestone:** M002
**Written:** 2026-03-14

## UAT Type

- UAT mode: mixed (artifact-driven for agenda state/persistence/prompts, live-runtime for `labrat plan` interaction)
- Why this mode is sufficient: Core agenda logic is pure functions verified by 212 contract tests. Live runtime validates LLM interaction quality and end-to-end phase execution, which contract tests cannot cover.

## Preconditions

- Repository builds clean: `npm run build` exits 0
- A campaign slice exists with `CAMPAIGN.json` containing `researchQuestion`, `targetFiles`, `metricDefinitions`, `evalCommand`, and `maxExperiments`
- Git repo with at least one commit
- LLM provider configured (any provider — model quality affects agenda decomposition but not mechanics)
- All 398 contract test assertions pass (212 new + 186 backward compat)

## Smoke Test

1. Run `labrat plan` from a directory with an active campaign
2. **Expected:** Interactive discussion begins with the LLM asking clarifying questions about the research question, then producing a structured agenda written to `CAMPAIGN.json`'s `agenda` field
3. Verify: `jq '.agenda.phases | length' <slice-dir>/CAMPAIGN.json` returns ≥1

## Test Cases

### 1. Agenda planning produces valid structure

1. Set up a campaign with `CAMPAIGN.json` containing a research question (e.g., "Optimize inference speed for transformer model") with `maxExperiments: 20`
2. Run `labrat plan`
3. Confirm the LLM asks clarifying questions about dimensions to explore
4. After discussion, verify `jq '.agenda' CAMPAIGN.json` shows a valid `AgendaConfig` with:
   - `phases` array with ≥1 phase
   - Each phase has `name`, `goal`, `dimension`, `maxExperiments`
   - Sum of phase `maxExperiments` ≤ campaign `maxExperiments` (20)
   - Optional `experimentPlans` array with `description` and `hypothesis` per plan
5. **Expected:** Well-structured agenda with concrete, testable experiment phases. Phases should represent distinct research dimensions (e.g., "quantization methods", "attention optimization", "batch size tuning").

### 2. Phase-by-phase execution with boundary reassessment

1. Start with a campaign that has a 2-phase agenda (e.g., phase 1: 5 experiments on method A, phase 2: 5 experiments on method B)
2. Run `labrat auto`
3. Observe experiments 1–5 execute within phase 1 context
4. At experiment 5 boundary, observe phase transition notification: "Phase 0 → Phase 1: <phase-2-name>"
5. Verify `AGENDA-STATE.json` shows `currentPhaseIndex: 1` and `phaseResults[0]` contains phase 1's best metrics
6. Observe experiments 6–10 execute with phase 2 context in prompts
7. **Expected:** Clear phase separation — experiment prompts in phase 2 reference phase 2 goals and include phase 1 results as prior knowledge. Phase-level baseline resets at boundary.

### 3. Phase context appears in experiment prompts

1. With an active 2-phase agenda (currently in phase 1), trigger an experiment dispatch
2. Inspect the experiment prompt (visible in agent context)
3. **Expected:** Prompt includes a "Current Research Phase" section with:
   - Phase name and goal
   - Dimension being explored
   - Experiment count (X of Y for this phase)
   - If phase 2+: summary of previous phase results

### 4. Experiment phase attribution in log

1. Run several experiments across 2 phases
2. Inspect `EXPERIMENT-LOG.jsonl`
3. **Expected:** Each entry has a `phaseIndex` field. Phase 1 experiments have `phaseIndex: 0`, phase 2 experiments have `phaseIndex: 1`.

### 5. Auto-start bridge after plan

1. Run `labrat plan`, complete the interactive discussion
2. Observe the LLM writes the agenda to `CAMPAIGN.json`
3. **Expected:** `checkAutoStartAfterPlan()` detects the agenda, initializes `AGENDA-STATE.json` (with `currentPhaseIndex: 0`), and automatically starts `labrat auto`

### 6. Non-agenda campaigns unchanged

1. Run a campaign with no `agenda` field in `CAMPAIGN.json` (M001-style)
2. Run `labrat auto` for several experiments
3. **Expected:** No phase context in prompts, no `AGENDA-STATE.json` created, no phase boundary notifications. Behavior identical to M001. Experiment prompts contain the standard 5-section format without any phase section.

### 7. Guard: re-planning when agenda exists

1. Run `labrat plan` on a campaign that already has a valid `agenda` field
2. **Expected:** Warning notification: "Agenda already exists" (or similar). Plan does not proceed. User told to remove agenda field manually to re-plan.

## Edge Cases

### Corrupt AGENDA-STATE.json recovery

1. Manually corrupt `AGENDA-STATE.json` (e.g., `echo 'garbage' > AGENDA-STATE.json`)
2. Run next experiment dispatch
3. **Expected:** `readAgendaState` returns null, stderr shows `[agenda] Corrupt AGENDA-STATE.json`. System degrades to global baseline (no phase-scoped metrics). Experiments continue without crash.

### Process crash mid-phase

1. Start a campaign with a 3-phase agenda
2. Kill the process mid-phase-2 (e.g., after experiment 8 of a 15-experiment agenda with phases of 5/5/5)
3. Restart `labrat auto`
4. **Expected:** `AGENDA-STATE.json` still reflects the last completed phase transition. Experiments resume from the correct phase. No experiments are double-counted.

### Single-phase agenda

1. Create an agenda with only 1 phase
2. Run all experiments
3. **Expected:** No phase transition occurs. All experiments attributed to phase 0. Campaign ends normally when `maxExperiments` reached. `AGENDA-STATE.json` shows `currentPhaseIndex: 0` with phase completed in `completedPhases`.

### maxExperiments as hard ceiling

1. Create a 3-phase agenda with 10/10/10 experiments per phase, but campaign `maxExperiments: 15`
2. Run `labrat auto`
3. **Expected:** Campaign stops at experiment 15, regardless of which phase is active. The campaign does not run 30 experiments just because phases request them.

## Failure Signals

- `AGENDA-STATE.json` missing after `labrat plan` completes — auto-start bridge failed
- Phase context section missing from experiment prompts when agenda exists — `getPhasePromptOverrides` not wired
- No `phaseIndex` field in `EXPERIMENT-LOG.jsonl` entries — `stampPhaseIndex` not firing in `handleAgentEnd`
- Phase transition notification never appears — `checkAndAdvancePhase` not called in `dispatchNextUnit`
- Non-agenda campaign prompts contain "Current Research Phase" text — backward compatibility broken
- `npm run build` fails — type errors from agenda type additions

## Requirements Proved By This UAT

- R016 (Research Agenda Planning) — Test cases 1, 5, and 7 prove interactive planning, auto-start, and guard checks
- R020 (Experiment Dependency/Sequencing) — Test cases 2, 3, and 4 prove phase-by-phase execution, boundary reassessment, and phase attribution

## Not Proven By This UAT

- Agenda decomposition quality across different LLM models and research domains — depends on model capability, not system mechanics
- Runtime steering of agenda phases — deferred to S03
- Multi-file experiment validation interaction with agenda phases — validated independently in S01
- Statistical quality of phase-level metrics summaries — metrics are passed through, not analyzed

## Notes for Tester

- Agenda decomposition quality is highly model-dependent. GPT-4/Claude-3.5 level models produce reasonable phases; smaller models may produce generic or poorly structured agendas. The system validates structure (JSON schema) but not semantic quality.
- Phase boundary detection depends on experiment count matching phase `maxExperiments` — if a phase has `maxExperiments: 5`, the boundary triggers after the 5th experiment in that phase's range.
- The `{{phaseContext}}` template variable uses markdown whitespace collapse — if you inspect the raw prompt for non-agenda campaigns, there will be an extra blank line where phaseContext would be, but it's invisible in rendered output.
- auto.ts is at 3269 lines — close to the growth limit. If you observe prompt assembly issues, check that the 3 facade function call sites in auto.ts are intact.
