# S03: /nightshift Interview & Scaffold — Research

**Date:** 2026-03-16

## Summary

S03 implements the `/nightshift` interactive command that collects research campaign parameters from the user and generates a GSD scaffold with hypothesis-slices and experiment-tasks. The work is well-constrained: the UI API (`ctx.ui.input`, `ctx.ui.select`, `showNextAction`) provides all needed input primitives, the existing `nightshift start` CLI (cli.ts:310-424) demonstrates the scaffold generation pattern, and the state machine already supports research→experiment flow per slice with CAMPAIGN.json detection. The main design decision is the interview style — a programmatic wizard (like `/gsd prefs wizard`) rather than an LLM-driven discussion (like `/gsd` discuss), because the user explicitly wants NightShift to "arranque de una" without the multi-round interview overhead.

The scaffold maps cleanly to existing GSD structure per D076/D078: milestone = session, each hypothesis = slice (S01..SN), each experiment within = task (T01..TM). Each hypothesis-slice gets its own CAMPAIGN.json. The existing `deriveState()` → `experimenting` phase already dispatches `research-slice` before experiments begin, so auto-mode will just work with the generated scaffold.

Two areas need careful attention: (1) where to store the user's "priors" (things to try/avoid) since `CampaignConfig` has no such field, and (2) ensuring generated roadmap and plan files parse correctly with the existing parsers (`parseRoadmapSlices` and `parsePlan` use specific regex patterns).

## Recommendation

Build `/nightshift` as a **programmatic wizard** using `ctx.ui.input()` and `ctx.ui.select()` — not an LLM-driven discussion. The interview collects 6-7 structured fields, generates scaffold files directly in TypeScript, then offers to start auto-mode. This matches the user's stated preference for a quick-start flow.

The command should be implemented as a new module `nightshift-interview.ts` (following D039's module extraction pattern), with command registration added to `commands.ts` alongside `/gsd`. The scaffold generator should be a pure function for testability (following D036's pattern from morning-report).

For priors/context, extend `CampaignConfig` with an optional `priors?: string` field and write a `PRIORS.md` file in the slice directory for richer context injection into prompts. This separates structured config (CAMPAIGN.json) from free-form research context (PRIORS.md).

## Don't Hand-Roll

| Problem | Existing Solution | Why Use It |
|---------|------------------|------------|
| Interactive input collection | `ctx.ui.input()`, `ctx.ui.select()` in commands.ts prefs wizard | Already proven pattern, handles Escape/null gracefully |
| Action picker UI | `showNextAction()` from shared/next-action-ui.ts | Consistent NightShift TUI style with keyboard navigation |
| Scaffold file generation | `nightshift start` CLI (cli.ts:310-424) | Same ROADMAP.md, PLAN.md, CAMPAIGN.json patterns |
| Campaign config parsing | `parseCampaignConfig()` in state.ts | Already validates required fields, handles missing gracefully |
| Roadmap/plan parsing | `parseRoadmapSlices()` in roadmap-slices.ts, `parsePlan()` in files.ts | Regex-based parsers define the exact format we must produce |
| Prompt loading | `loadPrompt()` in prompt-loader.ts | Mustache-templated .md files with `{{variable}}` substitution |
| Directory structure | `gsdRoot()`, `milestonesDir()`, `resolveSlicePath()` in paths.ts | Consistent path resolution across the extension |
| Workflow dispatch | `dispatchWorkflow()` in guided-flow.ts | Sends prompts to the LLM with GSD-WORKFLOW.md context |

## Existing Code and Patterns

- `src/resources/extensions/gsd/commands.ts` lines 518-635 — **handlePrefsWizard** demonstrates the exact pattern: loop through fields with `ctx.ui.input()` and `ctx.ui.select()`, collect values, serialize output. The `/nightshift` interview should follow this structure.
- `src/cli.ts` lines 310-424 — **nightshift start** creates the GSD scaffold (ROADMAP.md, PLAN.md, CAMPAIGN.json) for a single hypothesis. The `/nightshift` interview extends this to N hypotheses. The CAMPAIGN.json shape, roadmap format, and plan format are all established here.
- `src/resources/extensions/gsd/guided-flow.ts` lines 839-1253 — **showSmartEntry** shows how `/gsd` bootstraps a new project (git init, .gsd/ creation, .gitignore). The `/nightshift` command needs the same bootstrap but should be simpler since it always creates a research session.
- `src/resources/extensions/gsd/roadmap-slices.ts` lines 22-23 — **parseRoadmapSlices regex**: `^\s*-\s+\[([ xX])\]\s+\*\*(\w+):\s+(.+?)\*\*\s*(.*)` — the generated roadmap MUST produce slice lines matching this pattern exactly. The `risk:` and `depends:[]` backtick annotations must appear in the `(.*)` tail.
- `src/resources/extensions/gsd/files.ts` lines 350-351 — **parsePlan task regex**: `^-\s+\[([ xX])\]\s+\*\*(\w+):\s+(.+?)\*\*\s*(.*)` — task checkboxes must match this pattern. The `est:` backtick annotation appears in the tail.
- `src/resources/extensions/gsd/state.ts` lines 462-489 — **Campaign detection in deriveState**: Checks `parseCampaignConfig(sliceDir)` for the active slice. If valid, enters `experimenting` phase. This means CAMPAIGN.json must exist in each hypothesis-slice's directory AND a plan file must exist (deriveState checks plan existence at line 420 before reaching campaign detection).
- `src/resources/extensions/gsd/auto.ts` lines 1396-1416 — **Research-slice dispatch**: When a slice has no research file, auto-mode dispatches `research-slice` before `plan-slice`. If milestone-level research exists and this is S01, research is skipped. For `/nightshift` hypothesis-slices, each should get its own research phase (per D079).
- `src/resources/extensions/gsd/auto.ts` lines 1426-1446 — **Experimenting dispatch**: When in `experimenting` phase, dispatches `run-experiment` with `buildExperimentPrompt()`. Steering and phase boundary checks happen here. Each hypothesis-slice with CAMPAIGN.json enters this path independently.
- `src/resources/extensions/gsd/index.ts` lines 220-228 — **Auto-start trigger**: `NIGHTSHIFT_AUTO_START=1` env var triggers `startAuto()` after session initialization. The `/nightshift auto` subcommand reuses this same `startAuto()` path.

## Constraints

- **Roadmap format is rigid** — `parseRoadmapSlices()` uses a specific regex pattern. Generated roadmap must produce lines like: `- [ ] **S01: Hypothesis 1** \`risk:medium\` \`depends:[]\`` followed by `> After this: ...` for the demo line. Deviation from this format breaks `deriveState()`.
- **Plan format is rigid** — `parsePlan()` expects task lines like: `- [ ] **T01: Experiment 1** \`est:15m\``. Missing bold markers or wrong ID format will produce empty task lists, which blocks `deriveState()` from finding active tasks.
- **Plan frontmatter required** — `deriveState()` checks for plan content (not just file existence) at line 420. The plan must have actual content, not just an empty file.
- **CAMPAIGN.json required per hypothesis** — Each hypothesis-slice needs its own CAMPAIGN.json for the state machine to enter `experimenting` phase. The config must pass `parseCampaignConfig()` validation: `name` (string), `targetFiles` (array), `evalConfig` (object with `command`, `timeout`, `metrics`, `runs`), `maxExperiments` (number), `budgetPerExperiment` (number).
- **NightShift naming** — All user-facing text (prompts, notifications, labels) must say NightShift per S01's cleanup. Internal identifiers (`.gsd/`, `/gsd`, `@gsd/`) stay as-is per D077.
- **No plan→execute→verify per experiment yet** — S03 generates the scaffold. The per-experiment cycling within a hypothesis is S05's concern. S03's scaffold should be compatible with both the current state machine (which just runs `run-experiment` units) and the future enhanced flow.
- **CampaignConfig type extension** — Adding fields to `CampaignConfig` requires updating `types.ts` and potentially `parseCampaignConfig()` validation in `state.ts`. New fields must be optional with sensible defaults (per D042).

## Common Pitfalls

- **Roadmap not parseable** — If the generated roadmap doesn't match `parseRoadmapSlices()` regex exactly, `deriveState()` won't find any slices and the state machine stalls. Must test generated output against the parser.
- **Plan not parseable** — Same issue with `parsePlan()`. The checkbox format is strict: `- [ ] **T01: Title** \`est:time\``. Missing backticks or wrong spacing breaks parsing.
- **CAMPAIGN.json per-hypothesis duplication** — Each hypothesis-slice gets its own CAMPAIGN.json with the same `targetFiles`, `evalConfig`, and `budgetPerExperiment` but its own `maxExperiments` (= tries per hypothesis). If the user says 5 hypotheses × 10 tries, each slice's CAMPAIGN.json should have `maxExperiments: 10`.
- **Git not initialized** — If the user runs `/nightshift` in a directory without git, the scaffold generation will fail. Must follow the same `git init` pattern as `showSmartEntry()`.
- **State machine research-skip for S01** — auto.ts lines 1401-1404 skip `research-slice` for S01 if milestone-level research exists. For `/nightshift`, we don't want this skip because each hypothesis needs its own research. Either don't write milestone-level research, or ensure the skip logic is addressed in S04/S05.
- **Empty priors field** — User might skip the priors question. The scaffold must handle `priors: undefined` gracefully — PRIORS.md simply isn't created.
- **Escape during interview** — `ctx.ui.input()` returns `undefined` on Escape. Must handle this as cancellation at each step, not crash.

## Open Risks

- **Interview UX balance** — Too many questions and the user loses patience. Too few and the scaffold is underdefined. The sweet spot is ~6 prompts (targets, eval, metrics, priors, hypothesis count, tries count). Metric entry is the most awkward since it needs name+direction+weight per metric — may need a loop-until-done pattern.
- **Multi-metric entry** — Users need to define multiple metrics with name:direction:weight. The CLI uses `--metric name:dir:weight` flags. The interactive version needs a loop: "Add a metric → [name] → [min/max] → [weight] → Add another?" This is more interaction rounds than the other fields.
- **Priors persistence format** — `PRIORS.md` as a markdown file is simple but doesn't get automatically injected into experiment prompts. S04 must update `buildExperimentPrompt()` to read and inline PRIORS.md. If we instead add `priors` to CAMPAIGN.json, it's available to `buildExperimentPrompt()` immediately but doesn't render well for long-form text.
- **Generic placeholder hypothesis names** — The roadmap generates "Hypothesis 1", "Hypothesis 2" etc. These are meaningless until the research agent fills them in. The state machine and UI will show these generic names until the researcher updates them. This is expected behavior (per the open question in M005-ROADMAP.md).

## Skills Discovered

| Technology | Skill | Status |
|------------|-------|--------|
| No external technologies | — | No skills needed — purely internal TypeScript extension code |

## Implementation Approach

### Module Structure

1. **New file: `nightshift-interview.ts`** — Contains the interview flow and scaffold generator
   - `showNightShiftInterview(ctx, pi, basePath)` — Main interview flow
   - `generateNightShiftScaffold(basePath, config)` — Pure function that generates scaffold files
   - Types for interview data (`NightShiftInterviewResult`)

2. **Modified file: `commands.ts`** — Register `/nightshift` command
   - Add `registerNightShiftCommand(pi)` or extend `registerGSDCommand` with `/nightshift`
   - Route `/nightshift` → interview, `/nightshift auto` → startAuto

3. **Modified file: `index.ts`** — Call the new registration function

4. **Modified file: `types.ts`** — Add optional `priors` field to `CampaignConfig`

### Interview Flow

```
/nightshift
  │
  ├── Bootstrap (.gsd/, git init if needed)
  │
  ├── Prompt: "Target file(s) to optimize" (input, comma-separated or one at a time)
  ├── Prompt: "Eval command" (input)
  ├── Loop: "Add metric" → name, direction (min/max), weight → "Add another?"
  ├── Prompt: "Things to try, avoid, or known priors" (input, optional)
  ├── Prompt: "Number of hypotheses to explore" (input, default: 3)
  ├── Prompt: "Experiments per hypothesis" (input, default: 10)
  │
  ├── Generate scaffold:
  │   ├── .gsd/milestones/M001/M001-ROADMAP.md (N hypothesis-slices)
  │   ├── For each S01..SN:
  │   │   ├── .gsd/milestones/M001/slices/S0N/S0N-PLAN.md (M experiment-tasks)
  │   │   ├── .gsd/milestones/M001/slices/S0N/CAMPAIGN.json
  │   │   └── .gsd/milestones/M001/slices/S0N/PRIORS.md (if priors provided)
  │   └── git add + commit
  │
  └── Show: "NightShift session scaffolded. Start auto-mode?" → [Yes] / [Not yet]
```

### Scaffold File Formats

**Roadmap** (must match `parseRoadmapSlices` regex):
```markdown
# M001: Research Session

**Vision:** Optimize target files via hypothesis-driven experimentation.

## Slices

- [ ] **S01: Hypothesis 1** `risk:medium` `depends:[]`
  > After this: First hypothesis explored with N experiments.

- [ ] **S02: Hypothesis 2** `risk:medium` `depends:[]`
  > After this: Second hypothesis explored with N experiments.
```

**Plan** (must match `parsePlan` regex):
```markdown
---
status: in_progress
---

# S01: Hypothesis 1

**Goal:** Explore a hypothesis for improving target metrics.
**Demo:** Hypothesis researched and N experiments completed.

## Tasks

- [ ] **T01: Experiment 1** `est:15m`
- [ ] **T02: Experiment 2** `est:15m`
```

**CAMPAIGN.json** (must pass `parseCampaignConfig` validation):
```json
{
  "name": "Hypothesis 1",
  "researchQuestion": "user's research question",
  "targetFiles": ["path/to/target.py"],
  "evalConfig": {
    "command": "python eval.py",
    "timeout": 120,
    "metrics": [{"name": "accuracy", "direction": "max", "weight": 1.0}],
    "runs": 1
  },
  "maxExperiments": 10,
  "budgetPerExperiment": 1.0,
  "priors": "Optional free-form text from interview"
}
```

### `/nightshift auto` Subcommand

Routes directly to `startAuto(ctx, pi, basePath)` — same as `/gsd auto`. No new auto-mode logic needed in S03.

### Task Breakdown Estimate

- **T01: Implement interview & scaffold** — `nightshift-interview.ts` with the programmatic wizard, scaffold generator, and test scaffolds. Register `/nightshift` command. ~60min
- **T02: Contract tests & integration verification** — Verify scaffold parses correctly (roundtrip through `parseRoadmapSlices`, `parsePlan`, `parseCampaignConfig`), interview cancellation, edge cases. ~30min

## Sources

- `src/resources/extensions/gsd/commands.ts` lines 518-635 (prefs wizard pattern)
- `src/cli.ts` lines 310-424 (nightshift start scaffold)
- `src/resources/extensions/gsd/roadmap-slices.ts` lines 13-50 (roadmap parser)
- `src/resources/extensions/gsd/files.ts` lines 319-389 (plan parser)
- `src/resources/extensions/gsd/state.ts` lines 77-104 (campaign config parser)
- `src/resources/extensions/gsd/state.ts` lines 462-489 (campaign detection in deriveState)
- `src/resources/extensions/gsd/auto.ts` lines 1396-1446 (research-slice and experiment dispatch)
- `src/resources/extensions/gsd/guided-flow.ts` lines 839-1253 (showSmartEntry bootstrap)
- `src/resources/extensions/gsd/types.ts` lines 280-300 (CampaignConfig type)
- `.gsd/milestones/M005/slices/S02/S02-RESEARCH.md` (Karpathy analysis)
