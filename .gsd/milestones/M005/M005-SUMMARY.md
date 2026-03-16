---
id: M005
provides:
  - Hypothesis-driven research flow replacing single-prompt experiments with 4-phase (research→plan→execute→verify) cycling per hypothesis
  - /nightshift interactive interview command collecting 6 research parameters and generating parser-compatible scaffold
  - Four hypothesis-native prompt templates with exported builder functions for deep research, grounded planning, focused execution, and structured verification
  - HYPOTHESIS-STATE.json state machine with crash-recoverable per-experiment plan→execute→verify cycling
  - Learning loop — verifier analysis feeds into next experiment's plan agent context via EXPERIMENT-NNN-ANALYSIS.md
  - NightShift naming consistency across all 28 prompts, 10 TS files, templates, docs, README, and examples
  - Karpathy auto-research analysis artifact informing prompt design (19 sections, adopt/avoid tables, prompt fragments)
  - 313 hypothesis-specific contract assertions across 5 test files with 0 failures
key_decisions:
  - "D076: Leverage GSD's existing 4-agent flow — hypothesis=slice, experiment=task"
  - "D077: User-facing naming only — .gsd/ paths, /gsd commands, @gsd/ imports unchanged"
  - "D084: /nightshift as programmatic wizard, not LLM discussion"
  - "D085: Scaffold generator as pure function"
  - "D089: Hypothesis sub-phase dispatch via HYPOTHESIS-STATE.json, not deriveState changes"
  - "D090: hypothesisMode flag for backward-compatible dispatch routing"
  - "D091: Plan agent writes EXPERIMENT-NNN-PLAN.md to disk for inter-unit persistence"
  - "D092: Eval results persisted to EXPERIMENT-NNN-RESULTS.md between execute and verify"
patterns_established:
  - "Hypothesis sub-phase state machine following agenda.ts atomic-write pattern (D045)"
  - "Inter-unit data persistence via purpose-built markdown files (plan, results, analysis) with placeholder fallback"
  - "Contract tests validating scaffold↔parser roundtrip through all three parsers"
  - "Naming compliance regex with word boundaries (\\bGSD\\b|\\blabrat\\b) to avoid false positives"
  - "Integration test pattern: compose sub-components in tmpdir with real git repo"
observability_surfaces:
  - "[hypothesis] phase → research|plan|execute|verify on stderr at each sub-phase transition"
  - "HYPOTHESIS-STATE.json in slice dir inspectable via jq — ground truth for dispatch routing"
  - "EXPERIMENT-NNN-PLAN.md, EXPERIMENT-NNN-RESULTS.md, EXPERIMENT-NNN-ANALYSIS.md on disk for post-mortem"
  - "rg -w 'GSD' src/resources/extensions/gsd/prompts/ — zero hits confirms naming compliance"
  - "5 test files runnable independently: hypothesis-state, hypothesis-dispatch, hypothesis-prompt, nightshift-interview, hypothesis-integration"
requirement_outcomes:
  - id: R042
    from_status: active
    to_status: validated
    proof: "S01 — 28 prompt files, 10 TS files, templates, docs, README, examples renamed. rg -w 'GSD' on prompts/templates/docs returns zero hits. rg -iw 'labrat' on README/examples/index.ts returns zero hits. 726 tests pass."
  - id: R043
    from_status: active
    to_status: validated
    proof: "S02 — S02-RESEARCH.md with 19 sections, 7-row adopt table, 8-row avoid table, prompt fragments for all 4 agent phases, 6 cited primary sources including Karpathy's GitHub repos."
  - id: R044
    from_status: active
    to_status: validated
    proof: "S03 — /nightshift registered, interview collects 6 fields, generateNightShiftScaffold produces parser-compatible scaffold. 99 contract assertions prove roundtrip through parseRoadmapSlices, parsePlan, parseCampaignConfig."
  - id: R045
    from_status: active
    to_status: validated
    proof: "S04 — Four prompt templates (research-hypothesis.md, plan-experiment.md, execute-experiment.md, verify-experiment.md) with exported builder functions. 69 contract assertions proving template/builder parity, content requirements, naming compliance."
  - id: R046
    from_status: active
    to_status: validated
    proof: "S04 — Research prompt names search-the-web, fetch_page, resolve_library, get_library_docs (7 tool references). Requires 3+ distinct sources. Multi-step research process prescribed."
  - id: R047
    from_status: active
    to_status: validated
    proof: "S05 — formatResultsForVerify produces structured markdown. advanceHypothesisPhase transitions verify→plan(next) with experiment number increment. resolveExpectedArtifactPath maps verify-hypothesis→EXPERIMENT-NNN-ANALYSIS.md. 92 contract assertions."
  - id: R048
    from_status: active
    to_status: validated
    proof: "S05 — HYPOTHESIS-STATE.json tracks sub-phase and experiment number with atomic writes. Full phase cycle research→plan→execute→verify→plan(+1)→done proven. Backward compat with non-hypothesis campaigns preserved. Crash recovery via null-on-corrupt. 92 assertions."
  - id: R049
    from_status: active
    to_status: validated
    proof: "S06 — 53-assertion integration test proving scaffold roundtrip, prompt builder parity, state machine cycling, eval execution, JSONL sync, multi-hypothesis transition. 313 total assertions across 5 test files, 0 failures."
duration: ~2h 45m
verification_result: passed
completed_at: 2026-03-16
---

# M005: Hypothesis-Driven Research Flow

**Hypothesis-driven research flow with deep per-hypothesis research, per-experiment plan→execute→verify cycling with learning loop, NightShift naming consistency, and 313 contract assertions proving end-to-end composition.**

## What Happened

M005 replaced the single-prompt-per-experiment approach with a hypothesis-driven flow that leverages GSD's existing 4-agent infrastructure. The milestone delivered six slices across three parallel workstreams that converged into an integrated whole.

**Naming cleanup (S01)** swept all 28 prompt files, 10 TypeScript source files, templates, docs, README, and examples — replacing GSD/labrat branding with NightShift. The boundary rule (D077) preserved internal identifiers (.gsd/ paths, /gsd commands, @gsd/ imports) while ensuring zero branding leaks in user-facing surfaces.

**Karpathy analysis (S02)** produced a structured research artifact with 19 sections analyzing Karpathy's three-file autoresearch design. The adopt/avoid tables and prompt fragments fed directly into S04's prompt design — the simplicity criterion, NEVER STOP directive, output suppression, and structured analysis patterns all appear in the final prompts.

**Interview & scaffold (S03)** created `/nightshift` as a programmatic wizard collecting targets, eval command, metrics, priors, hypothesis count, and experiments per hypothesis. The pure-function scaffold generator produces parser-compatible output proven by 99 roundtrip assertions through all three parsers. `/nightshift auto` routes to the existing `startAuto()`.

**Hypothesis-native prompts (S04)** — the highest-risk slice — created four research-tuned prompt templates grounded in S02's Karpathy analysis. The research prompt explicitly names all four search tools and requires 3+ distinct sources. The verify prompt requires structured What Worked/What Didn't/Signals analysis. All four include the NEVER STOP autonomy directive. Exported builder functions follow the established `buildExperimentPrompt` pattern with graceful degradation for optional context files.

**Learning loop & state flow (S05)** built the hypothesis state machine — `hypothesis-state.ts` following the atomic-write pattern from agenda.ts. Four new unit types (research-hypothesis, plan-hypothesis, execute-hypothesis, verify-hypothesis) wired into `dispatchNextUnit` and `handleAgentEnd` with HYPOTHESIS-STATE.json tracking sub-phase and experiment number. Inter-unit persistence via EXPERIMENT-NNN-PLAN.md and EXPERIMENT-NNN-RESULTS.md bridges the fresh-context-per-unit constraint. The `hypothesisMode` flag on CampaignConfig ensures backward compatibility.

**End-to-end integration (S06)** assembled all five prior slices and proved composition with a 53-assertion integration test covering scaffold→parser roundtrip, all four prompt builders, full state machine cycling (research→plan→execute→verify→plan+1→done), real eval execution, and multi-hypothesis transition.

## Cross-Slice Verification

### Success Criterion: `/nightshift` interview captures research setup and scaffolds GSD structure
**VERIFIED** — S03's 99 contract assertions prove scaffold roundtrip through parseRoadmapSlices, parsePlan, parseCampaignConfig. Edge cases (1×1, 10+ hypotheses, priors present/absent, mixed metrics) all covered. `/nightshift auto` routes to startAuto(). S06 integration test re-proves scaffold→parser roundtrip with real data.

### Success Criterion: `/nightshift auto` runs fully autonomously with each hypothesis getting a dedicated research phase
**VERIFIED** — S05's dispatch logic checks `config.hypothesisMode` and routes to hypothesis sub-phases. Research dispatches once per hypothesis (state machine transitions research→plan, not research→research). S06 integration test proves full state machine cycling through research→plan→execute→verify→plan+1→done for one hypothesis, then transition to next hypothesis.

### Success Criterion: Research agent demonstrably uses web search, library docs, and page fetching
**VERIFIED** — S04's research-hypothesis.md explicitly names `search-the-web`, `fetch_page`, `resolve_library`, `get_library_docs` (7 tool references confirmed by grep). Requires "at least 3 distinct sources." Multi-step process prescribed: understand → search broadly → read deeply → check library docs → synthesize. Contract tests verify all tool names present. Note: runtime validation of agent adherence is UAT territory — the prompt instructs it correctly.

### Success Criterion: Verifier produces structured analysis that appears in next experiment's plan agent context
**VERIFIED** — S04's verify-experiment.md requires What Worked / What Didn't Work / Signals for Next Experiment sections. S05's `readLatestExperimentAnalysis` scans backwards for EXPERIMENT-NNN-ANALYSIS.md and injects it into the plan builder. S05's `advanceHypothesisPhase` transitions verify→plan(next) with experiment number increment. Dispatch routing confirmed by 49 dispatch assertions.

### Success Criterion: All user-facing output says NightShift — no GSD or labrat leaking through
**VERIFIED** — `rg -w 'GSD' src/resources/extensions/gsd/prompts/ src/resources/extensions/gsd/templates/ src/resources/extensions/gsd/docs/` returns zero hits. `rg -iw 'labrat' README.md examples/ src/resources/extensions/gsd/index.ts` returns zero hits. S06 integration test includes naming compliance check across all four prompt builders. README's 7 remaining GSD references are all historical predecessor proper nouns or internal identifiers (D082).

### Success Criterion: Prompts are grounded in Karpathy's auto-research patterns
**VERIFIED** — S02-RESEARCH.md has 19 sections with 39 Karpathy references. Concrete patterns adopted: simplicity criterion (in verify prompt), NEVER STOP directive (in all 4 prompts), structured analysis output (in verify prompt), tool-suite research (in research prompt). Adopt/avoid tables trace directly to prompt content.

### Definition of Done: All 6 slices completed with verified outcomes
**VERIFIED** — All 6 slices marked `[x]` in M005-ROADMAP.md. All 6 S0N-SUMMARY.md files exist with `verification_result: passed`.

### Definition of Done: All 8 requirements (R042–R049) validated
**VERIFIED** — REQUIREMENTS.md shows 0 active requirements, 38 validated. R042–R049 all show `validated` status with evidence.

### Definition of Done: Crash recovery works across hypothesis→experiment flow
**VERIFIED** — S05's hypothesis-state.test.ts proves null-on-corrupt recovery with stderr warning (5 corruption assertions). HYPOTHESIS-STATE.json uses atomic write pattern (D045). Lock file enriched with experimentNumber. recoverTimedOutUnit handles all 4 new unit types.

## Requirement Changes

- R042: active → validated — 28 prompts, 10 TS files, templates, docs, README, examples renamed. Zero GSD/labrat in user-facing surfaces.
- R043: active → validated — S02-RESEARCH.md: 19 sections, adopt/avoid tables, prompt fragments for all 4 phases, 6 primary sources.
- R044: active → validated — /nightshift command, interview wizard, pure-function scaffold generator, 99 roundtrip assertions.
- R045: active → validated — Four prompt templates with builders, 69 contract assertions proving parity and content.
- R046: active → validated — Research prompt names 4 search tools, requires 3+ sources, prescribes multi-step process.
- R047: active → validated — Structured verify analysis, readLatestExperimentAnalysis, state transitions, 92 assertions.
- R048: active → validated — HYPOTHESIS-STATE.json state machine, full phase cycling, backward compat, crash recovery, 92 assertions.
- R049: active → validated — 53-assertion integration test, 313 total across 5 files, 0 failures.

## Forward Intelligence

### What the next milestone should know
- The hypothesis flow is fully assembled but runtime validation of research depth (does the agent actually follow multi-source research instructions?) is UAT territory — contract tests prove prompt content, not LLM adherence.
- `auto.ts` is now ~3400+ lines. It handles both legacy `run-experiment` dispatch and hypothesis sub-phase dispatch. Consider extraction if adding more dispatch paths.
- All M001–M004 campaigns still work unchanged — `hypothesisMode` flag gates all new behavior. Non-hypothesis campaigns route through the original `run-experiment` path.
- The NightShift naming boundary (D077) is firm: user-facing = NightShift, internal code = gsd. Any new prompts or user-facing strings must follow this convention.

### What's fragile
- Scaffold format is tightly coupled to parser regexes — roadmap lines must match specific patterns in parseRoadmapSlices, plan task lines must match parsePlan. Any format change breaks the 99-assertion contract.
- Template/builder var parity — if a template adds a `{{newVar}}`, the builder must add it too. The 69-assertion test catches this at test time, but new vars without corresponding builder changes crash loadPrompt.
- Inter-unit persistence files (EXPERIMENT-NNN-PLAN.md, EXPERIMENT-NNN-RESULTS.md, EXPERIMENT-NNN-ANALYSIS.md) degrade to placeholder text when missing — the agent runs but may produce poor results without real context.
- HYPOTHESIS-STATE.json corrupt recovery resets to research phase — acceptable for crash recovery but wastes a research dispatch if corruption happens late in a hypothesis.

### Authoritative diagnostics
- `npx tsx src/resources/extensions/gsd/tests/hypothesis-integration.test.ts` — 53 assertions prove full composition. If this passes, the assembled system works.
- `rg -w 'GSD' src/resources/extensions/gsd/prompts/` — zero hits is the authoritative naming compliance signal.
- `jq '.' <sliceDir>/HYPOTHESIS-STATE.json` — ground truth for hypothesis dispatch routing.
- stderr `[hypothesis] phase →` messages during runtime — confirm sub-phase transitions are happening correctly.

### What assumptions changed
- Plan estimated 23 prompt files and 6 TS files for S01 — actual was 28 prompts and 10 TS files. File count estimates should be treated as lower bounds.
- D088 assumed execute builder would receive plan text passed from prior unit's context. In practice, handleAgentEnd has no agent output text. D091 resolved this: plan agent writes to disk, execute dispatch reads from disk.
- The `sliceDir` template variable was added to plan-experiment.md builder during S05, not anticipated in S04's original design.

## Files Created/Modified

- `src/resources/extensions/gsd/prompts/research-hypothesis.md` — Research agent prompt (~75 lines)
- `src/resources/extensions/gsd/prompts/plan-experiment.md` — Plan agent prompt (~65 lines)
- `src/resources/extensions/gsd/prompts/execute-experiment.md` — Execute agent prompt (~85 lines)
- `src/resources/extensions/gsd/prompts/verify-experiment.md` — Verify agent prompt (~80 lines)
- `src/resources/extensions/gsd/prompts/*.md` (22 files) — GSD → NightShift branding
- `src/resources/extensions/gsd/hypothesis-state.ts` — State machine module (~170 lines)
- `src/resources/extensions/gsd/nightshift-interview.ts` — Interview wizard + scaffold generator (~373 lines)
- `src/resources/extensions/gsd/auto.ts` — Hypothesis dispatch, builders, handleAgentEnd cases (~450 lines added)
- `src/resources/extensions/gsd/dispatch-guard.ts` — 4 new unit types in SLICE_DISPATCH_TYPES
- `src/resources/extensions/gsd/types.ts` — hypothesisMode and priors on CampaignConfig
- `src/resources/extensions/gsd/commands.ts` — /nightshift command registration
- `src/resources/extensions/gsd/index.ts` — NightShift ASCII logo, command wiring
- `src/resources/extensions/gsd/guided-flow.ts` — NightShift naming
- `src/resources/extensions/gsd/doctor.ts` — NightShift naming
- `src/resources/extensions/gsd/dashboard-overlay.ts` — NightShift naming
- `src/resources/extensions/gsd/exit-command.ts` — NightShift naming
- `src/resources/extensions/gsd/worktree-command.ts` — NightShift naming
- `src/resources/extensions/gsd/preferences.ts` — NightShift naming
- `src/resources/extensions/gsd/gitignore.ts` — NightShift naming
- `src/resources/extensions/gsd/tests/hypothesis-integration.test.ts` — 53 assertions
- `src/resources/extensions/gsd/tests/hypothesis-state.test.ts` — 43 assertions
- `src/resources/extensions/gsd/tests/hypothesis-dispatch.test.ts` — 49 assertions
- `src/resources/extensions/gsd/tests/hypothesis-prompt.test.ts` — 69 assertions
- `src/resources/extensions/gsd/tests/nightshift-interview.test.ts` — 99 assertions
- `README.md` — Product title, branding, npm refs
- `examples/karpathy-smoke/README.md` — Command refs
- `.gsd/milestones/M005/slices/S02/S02-RESEARCH.md` — Karpathy auto-research analysis
