# M002: Structured Research & Intelligence — Research

**Date:** 2026-03-14

## Summary

M002 adds five capabilities on top of M001's proven autonomous experiment loop: research agenda planning (R016), simplicity-aware keep/discard (R017), runtime steering (R018), multi-file experiment scope (R019), and experiment sequencing (R020). After thorough codebase analysis, the key finding is that the existing infrastructure supports these features far more than expected — multi-file experiments already work mechanically via `targetFiles[]` and `smartStage()`, the reassessment pattern (`checkNeedsReassessment` + assessment file) is directly reusable for experiment phase boundaries, and the `showDiscuss`/`buildDiscussSlicePrompt` flow provides a proven template for the `labrat plan` command.

The primary risk is simplicity scoring (R017) — there's no established consensus on how to quantify "code simplicity" in a language-agnostic way that correlates with actual maintainability. LLM-based judgment is the pragmatic choice but introduces non-determinism in the keep/discard decision. Everything else is architectural wiring and prompt engineering on top of proven M001 patterns. The recommended approach is to prove simplicity scoring first (highest risk, most novel), then build agenda planning (highest value, drives sequencing), then runtime steering (requires careful concurrency design), then multi-file validation (lowest risk, mostly works today), and finally experiment sequencing (depends on agenda planning).

A notable constraint: `auto.ts` is already 3250 lines. M002 features must be factored into separate modules rather than growing auto.ts further. The eval-runner, state machine, and git service are cleanly separated already — new features should follow that pattern.

## Recommendation

**Prove simplicity scoring first, then build outward.** Simplicity-aware keep/discard is the highest-risk, most novel feature. If the simplicity metric doesn't work well, R017 needs to be reconsidered before building other features that might depend on it. Start with a standalone `simplicity-scorer.ts` module that integrates into `makeKeepDiscardDecision()`, then build the agenda planning flow which is the highest-value feature and drives experiment sequencing naturally. Runtime steering should come after agenda planning because steering is more useful when there's a structured agenda to steer. Multi-file scope is lowest risk — it already works at the git layer and primarily needs validation and prompt refinement.

## Don't Hand-Roll

| Problem | Existing Solution | Why Use It |
|---------|------------------|------------|
| Code complexity measurement | `git diff --stat` (already in `extractDiffStat`) + line count delta | Git diff is already extracted per experiment. Lines added/removed is a simple, language-agnostic proxy for complexity change. Avoid building an AST parser. |
| Research agenda data structure | Extend existing `CampaignConfig` JSON | Campaign config is already parsed, validated, and integrated into the state machine. Adding `agenda` and `phases` fields is incremental. |
| Discussion flow for agenda planning | Adapt `showDiscuss` + `buildDiscussSlicePrompt` pattern | The slice discuss flow already handles: contextual prompts with inlined artifacts, wizard-style UI, template-based output. Same pattern works for research agenda discussion. |
| File-based inter-process signaling | `STEERING.json` in slice directory (same pattern as `CAMPAIGN.json`) | Campaign config is already read at experiment boundaries. Adding a steering file read at the same point is zero-risk. |
| Phase boundary reassessment | Adapt `checkNeedsReassessment` + assessment file pattern | Already proven: check for assessment file → if missing, trigger reassessment unit → write assessment → continue. Same pattern for experiment phase boundaries. |
| Multi-file atomic revert | Existing `commitExperiment` / `revertExperiment` | `smartStage()` stages ALL changes, `git revert --no-commit` reverts ALL changes in a commit. Multi-file atomicity is already guaranteed by git. |

## Existing Code and Patterns

- `src/resources/extensions/gsd/eval-runner.ts` — **Core modification target for R017.** `makeKeepDiscardDecision()` (line 192) is the pure function that decides keep/discard based on composite scoring. Simplicity scoring integrates here as an additional factor. `computeCompositeScore()` (line 155) normalizes metrics — simplicity could be added as a synthetic metric or as a separate multiplier. `extractDiffStat()` (line 387) already captures file change statistics per experiment — could provide raw material for simplicity measurement.
- `src/resources/extensions/gsd/types.ts` — **Type extension target.** `CampaignConfig` (line 224) needs `agenda`, `phases`, and `simplicityWeight` fields. `ExperimentResult` (line 213) may need a `simplicityScore` field. `KeepDiscardDecision` (line 207) may need `simplicityFactor` in the comparison.
- `src/resources/extensions/gsd/state.ts` — **State machine wiring.** `parseCampaignConfig()` (line 60) validates campaign config shape — must be extended for new fields. `deriveState()` (line 144) already checks campaign config at line 413 and transitions to `experimenting` phase. Phase-level experiment sequencing would add logic here to determine which phase is active.
- `src/resources/extensions/gsd/auto.ts` — **Orchestrator wiring.** `handleAgentEnd()` (line 594) runs eval post-processing after each experiment — steering file check goes here. `dispatchNextUnit()` (line 1137) determines next unit type — agenda-aware dispatch adds phase boundary logic here. `buildExperimentPrompt()` (line 1945) assembles experiment context — agenda context and phase context inject here. **CRITICAL: this file is 3250 lines. New features MUST be extracted to separate modules.**
- `src/resources/extensions/gsd/guided-flow.ts` — **Template for `labrat plan`.** `showDiscuss()` (line 377) shows a picker, builds a rich prompt with inlined context, dispatches to the LLM. `buildDiscussSlicePrompt()` (line 299) demonstrates the inlined-context pattern. `checkAutoStartAfterDiscuss()` (line 45) shows how to bridge interactive discussion → auto-mode.
- `src/resources/extensions/gsd/commands.ts` — **CLI registration.** `registerGSDCommand()` (line 54) registers `/gsd` with subcommands. `labrat plan` and `labrat discuss` would register as new subcommands here. The existing `discuss` subcommand (line 149) calls `showDiscuss()` — the new runtime steering `discuss` would be a separate flow.
- `src/resources/extensions/gsd/git-service.ts` — **Multi-file safety.** `commitExperiment()` (line 555) calls `smartStage()` which does `git add -A` then unstages runtime files. This means ALL changes to tracked files are committed atomically. `revertExperiment()` (line 582) does `git revert --no-commit` which reverts ALL changes in the target commit. **Multi-file atomicity already works** — the gap is validation (are changes only in target files?) not mechanics.
- `src/resources/extensions/gsd/prompts/run-experiment.md` — **Experiment prompt.** Safety boundary (line 61) says "ONLY modify the target files listed above." This is prompt-enforced, not code-enforced. For multi-file, the prompt already supports listing multiple target files. Agenda context and phase instructions would be added to this prompt.
- `src/resources/extensions/gsd/prompts/discuss.md` — **Discussion flow template.** The milestone discuss flow is a rich multi-round interview. The `labrat plan` agenda planning flow should follow the same pattern but focused on research dimensions and experiment design.
- `src/resources/extensions/gsd/morning-report.ts` — **Report extension point.** `generateMorningReport()` is a pure function taking data in, returning string. Agenda progress, phase boundaries, and simplicity scores should be added to the report.
- `src/resources/extensions/gsd/preferences.ts` — **Preferences extension.** `GSDResearchPreferences` (line 75) already exists with `budget_per_experiment` and `max_experiments`. Simplicity weight, agenda preferences, and steering options would be added here.
- `src/resources/extensions/gsd/tests/` — **Test patterns.** 480 existing tests use a consistent pattern: temp directory fixtures, `assert()`/`assertEq()` helpers, deterministic inputs, no mocks for pure functions. Follow the same patterns for M002 tests.

## Constraints

- **auto.ts must not grow further.** At 3250 lines, it's already at the limit of maintainability. New features (agenda management, steering, simplicity scoring) MUST be extracted into separate modules (`agenda.ts`, `steering.ts`, `simplicity-scorer.ts`) with clean interfaces that auto.ts calls.
- **Campaign config is validated by `parseCampaignConfig()` with explicit shape checks.** Any new fields added to `CampaignConfig` must either be optional (so existing campaigns still parse) or the validation function must be updated. Breaking existing campaign configs would break M001's core loop.
- **`targetFiles` is already an array.** The `CampaignConfig.targetFiles` field, `buildExperimentPrompt()`, and `labrat start --target` already support multiple files. R019 (multi-file scope) is primarily about validation and prompt refinement, not new mechanics.
- **Safety boundary is prompt-enforced, not code-enforced.** The experiment prompt tells the LLM to only modify target files, but `smartStage()` will commit ANY changes to tracked files. R019 should consider whether to add a post-commit validation step that checks only target files were modified (and reverts if not).
- **State derives from files on disk.** `deriveState()` is the single source of truth. Any new state (current agenda phase, steering directives) must be representable as files in the `.gsd/` directory structure, following the existing pattern of `CAMPAIGN.json`, `EXPERIMENT-LOG.jsonl`, etc.
- **Experiment boundaries are the only safe intervention points.** The experiment loop runs synchronously within a unit: LLM generates changes → auto-commit → eval → keep/discard. Steering can only take effect between experiments (at `dispatchNextUnit` time), never mid-experiment.
- **Test infrastructure is pure TypeScript with no test runner.** Tests use `assert()`/`assertEq()` with process exit codes. No Jest, Vitest, or other frameworks. New tests must follow this pattern.
- **`revertExperiment` is idempotent.** It handles already-reverted commits gracefully. Any multi-file validation that triggers revert must account for this.

## Common Pitfalls

- **Over-engineering simplicity scoring** — Building a full AST-based complexity analyzer for arbitrary languages is a rabbit hole. The pragmatic approach: use `git diff --stat` (lines changed), optionally combined with LLM judgment as a tie-breaker when metrics are within a configurable margin. Avoid cyclomatic complexity tools that only work for specific languages.
- **Breaking existing campaigns** — Adding required fields to `CampaignConfig` would break `parseCampaignConfig()` validation and cause all existing campaigns to degrade to normal task execution mode. All new fields must be optional with sensible defaults. Test that M001-era campaign configs still parse correctly.
- **Steering latency confusion** — If `labrat discuss` writes a `STEERING.json` but the current experiment takes 10 minutes, the user won't see their change take effect for 10+ minutes. The UI must explicitly communicate: "Steering will take effect after the current experiment finishes." Consider a notification mechanism.
- **Growing auto.ts instead of extracting** — The natural path of least resistance is to add new logic to `dispatchNextUnit()` and `handleAgentEnd()`. Instead, extract: `buildExperimentPrompt()` → `experiment-prompt.ts`, agenda logic → `agenda.ts`, steering → `steering.ts`, simplicity → `simplicity-scorer.ts`. Keep auto.ts as the orchestrator that calls into modules.
- **Agenda planning quality** — The LLM needs to decompose a research question into meaningful dimensions and experiments. This is prompt engineering at its hardest. Start with a structured output format (JSON schema for the agenda) and iterate on the prompt. Don't expect perfect decomposition — the value is in having a starting structure that can be steered.
- **Phase boundary race condition** — When experiment sequencing is active and one phase completes, the next phase's experiments might depend on the previous phase's best result. Ensure `readBestMetrics()` returns the correct baseline for the new phase, not just the global best.
- **Multi-file safety validation** — If a post-commit check finds the LLM modified files outside the target list, the revert is safe (git handles it), but the experiment is wasted. Consider a pre-eval validation step that checks `git diff --name-only HEAD~1..HEAD` against the target file list and reverts immediately without running eval if there are violations.

## Open Risks

- **Simplicity scoring subjectivity** — No complexity metric correlates perfectly with human judgment of "simpler code." Lines changed, AST depth, and cyclomatic complexity all have failure modes. LLM judgment adds non-determinism. The configurable weight (`simplicityWeight`) must default to 0 (disabled) so users opt in explicitly.
- **Agenda decomposition quality** — An LLM decomposing "how to optimize transformer inference" into meaningful experiment dimensions is fundamentally hard. The prompt must guide toward concrete, testable hypotheses rather than vague categories. Quality will vary by model and domain.
- **Concurrent file access for steering** — `labrat discuss` (running in one terminal) writes `STEERING.json` while `labrat auto` (running in another terminal) reads it. Node.js file I/O is not atomic — a partial write could produce invalid JSON. Use write-to-temp-then-rename pattern (atomic on POSIX) or catch JSON parse errors gracefully.
- **Campaign config schema migration** — If M002 extends `CampaignConfig` with agenda/phase fields and a user has existing `CAMPAIGN.json` files, those files must still parse. Forward compatibility is mandatory. Consider a `version` field in `CampaignConfig` to distinguish M001-era vs M002-era configs.
- **Experiment dependency graph complexity** — If experiment B depends on experiment A's results, and experiment A was discarded, what happens to B? Simplest: skip B with a note. But this could cascade and skip most of a phase. Need a clear policy documented in the agenda spec.

## Requirement Analysis

### Table Stakes (expected by any user)

- **R019 (Multi-file scope)** is table stakes for any non-trivial research. Most real-world optimization involves modifying multiple files (e.g., model architecture + training loop). The good news: it already works mechanically. The gap is validation and explicit documentation.
- **R016 (Agenda planning)** is the highest-value feature and the primary differentiator for M002. Without structured agendas, M002 is just M001 with minor enhancements.

### Likely Omissions

- **Agenda persistence and resume** — If a campaign with a structured agenda crashes mid-phase, the agenda state must survive restart. The JSONL log captures experiment results, but phase boundaries and agenda progress need explicit tracking. Consider an `AGENDA-STATE.json` alongside `CAMPAIGN.json`.
- **Experiment history visibility in agenda context** — When running experiment 15 of a 50-experiment agenda, the LLM should see not just raw history but structured history organized by phase/dimension. `compressExperimentHistory()` currently produces a flat list.
- **Validation of LLM-generated changes against target files** — Currently prompt-enforced only. A post-commit `git diff --name-only` check would catch violations before wasting eval time.

### Overbuilt Risks

- **R020 (Experiment dependency/sequencing)** could become overbuilt if implemented as a full DAG scheduler. Simple sequential phases (phase 1 completes → phase 2 starts) covers 90% of use cases. Only build dependency tracking if sequential phases prove insufficient.

### Candidate Requirements (advisory, not auto-binding)

- **CR001 — Target file validation**: Post-commit check that `git diff --name-only HEAD~1..HEAD` only contains files in `targetFiles[]`. Revert without eval if violated. Source: execution observation (smartStage stages everything).
- **CR002 — Agenda state persistence**: `AGENDA-STATE.json` tracking current phase, completed dimensions, and phase-level best metrics. Survives crash recovery. Source: continuity analysis (JSONL alone doesn't capture phase transitions).
- **CR003 — Structured experiment history by phase**: `compressExperimentHistory()` extended to group experiments by phase/dimension for agenda-aware prompts. Source: prompt quality analysis.

## Skills Discovered

| Technology | Skill | Status |
|------------|-------|--------|
| TypeScript state machine | (searched) | none found — domain-specific to this codebase |
| Autonomous agent loop | (searched) | none found — novel architecture |

## Sources

- Codebase analysis: `auto.ts` (3250 lines), `eval-runner.ts` (556 lines), `state.ts` (561 lines), `types.ts` (247 lines), `git-service.ts` (827 lines), `guided-flow.ts` (866 lines), `commands.ts` (583 lines), `morning-report.ts` (233 lines), `preferences.ts` (600+ lines)
- Test suite: 480 existing tests across eval-runner (661 lines), experiment-prompt (407 lines), git-experiment (246 lines), research-types (370 lines), morning-report (429 lines), derive-state (758 lines)
- Prompts: `run-experiment.md`, `discuss.md`, `guided-discuss-slice.md`, `reassess-roadmap.md`
- M001 decisions register: D001–D037 in `.gsd/DECISIONS.md`
- M001 requirements: R001–R015 (validated), R016–R020 (deferred to M002) in `.gsd/REQUIREMENTS.md`

## Strategic Answers

### What should be proven first?
Simplicity scoring (R017) — it's the only genuinely novel technical problem. Everything else is architectural wiring on proven patterns. If simplicity scoring doesn't work well, knowing that early shapes the rest of M002. Multi-file (R019) should be proven second because it's nearly free (already works mechanically) and provides quick validation wins.

### What existing patterns should be reused?
1. `checkNeedsReassessment` + assessment file → experiment phase boundary reassessment
2. `showDiscuss` + `buildDiscussSlicePrompt` → `labrat plan` agenda discussion
3. `parseCampaignConfig` + `CAMPAIGN.json` → agenda config with optional fields
4. `appendExperimentLog` + JSONL → agenda state persistence
5. `compressExperimentHistory` → phase-aware experiment history for prompts
6. `checkAutoStartAfterDiscuss` → bridge `labrat plan` to auto-mode

### What boundary contracts matter?
1. `CampaignConfig` backward compatibility — M001-era configs must still parse
2. `makeKeepDiscardDecision` return type — adding simplicity factor must not break existing callers
3. `handleAgentEnd` → `dispatchNextUnit` flow — steering reads must be non-blocking and non-fatal
4. `deriveState` phase transitions — new phase logic must not break the 33 existing derive-state tests

### What constraints does the existing codebase impose?
1. All state derives from disk files — no in-memory state survives restart
2. `auto.ts` is too large to grow — new features must be separate modules
3. `smartStage()` stages ALL changes — multi-file safety is prompt-enforced only
4. Experiments are sequential within a campaign — no parallel experiment execution
5. The experiment prompt is assembled by `buildExperimentPrompt()` which reads campaign config + JSONL — any new context must flow through these channels

### Are there known failure modes that should shape slice ordering?
1. **Prompt quality cascading** — If agenda planning produces a poor experiment plan, every subsequent experiment inherits that poor plan. Prove agenda planning quality before building experiment sequencing on top of it.
2. **Config schema migration** — Adding new CampaignConfig fields early and making them optional prevents breaking changes later. Do this in the first slice.
3. **auto.ts growth** — If early slices add code to auto.ts, later slices inherit the maintenance burden. Extract modules in the first slice.
