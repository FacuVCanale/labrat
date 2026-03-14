# M002: Structured Research & Intelligence

**Vision:** Transform Labrat from a brute-force optimizer into a structured research partner that plans experiments across dimensions, prefers simpler solutions, validates multi-file scope, executes work in phases, and responds to mid-campaign redirection.

## Success Criteria

- Running a campaign with `simplicityWeight > 0` causes the loop to prefer simpler code when metric improvement is within the configured margin — visible as `simplicityScore` in the experiment log and as different keep/discard decisions compared to weight=0
- A multi-file experiment that modifies files outside the `targetFiles` list is caught post-commit and reverted without running the eval command
- `labrat plan` decomposes a multi-dimensional research question into a structured agenda with ordered phases and concrete experiment plans
- A campaign with a multi-phase agenda executes phase 1, reassesses at the boundary, then proceeds to phase 2 with the best result from phase 1 as the new baseline
- Agenda state survives process crash — restarting a mid-phase campaign resumes from the correct phase and experiment
- `labrat discuss` in a separate terminal writes steering directives that the running `labrat auto` loop picks up at the next experiment boundary, visibly changing experiment focus
- All existing M001-era campaigns (no agenda, no simplicity config) still parse and run identically — zero behavioral change for existing users

## Key Risks / Unknowns

- **Simplicity scoring utility** — No complexity metric perfectly correlates with human judgment of "simpler code." Diff-stat (lines changed) is a language-agnostic proxy but has failure modes (refactoring that increases lines but improves clarity). Configurable weight with default-off mitigates this but the scoring must still feel reasonable when enabled.
- **Agenda decomposition quality** — LLM prompt engineering for decomposing research questions into meaningful experiment dimensions is fundamentally hard. Quality varies by model and domain. A poor agenda cascades to every subsequent experiment.
- **Concurrent file access for steering** — Two separate processes (`labrat auto` + `labrat discuss`) read/write the same `STEERING.json`. Node.js file I/O is not atomic — partial writes produce invalid JSON.

## Proof Strategy

- **Simplicity scoring utility** → retire in S01 by shipping simplicity-aware keep/discard decisions using diff-stat scoring with configurable weight, proving via contract tests that (a) simplicity score is computed from real diff stats, (b) it correctly influences keep/discard when metrics are within margin, and (c) weight=0 produces identical behavior to M001
- **Agenda decomposition quality** → retire in S02 by shipping `labrat plan` with a structured JSON output schema that constrains the LLM toward concrete, testable experiment plans. Quality is bounded by the output format, not left open-ended.
- **Concurrent file access** → retire in S03 by implementing atomic write-to-temp-then-rename for `STEERING.json` and graceful JSON parse error recovery on the reader side, with contract tests proving both partial-write resilience and valid-write pickup

## Verification Classes

- Contract verification: Unit tests for simplicity scoring, target file validation, agenda parsing, phase state transitions, steering reads/writes, CampaignConfig backward compatibility. All follow existing pattern (assert/assertEq, process exit code, no test runner).
- Integration verification: Campaign with agenda executes phase-by-phase with boundary reassessment. Multi-file experiment validates target scope. Steering directive picked up at experiment boundary. All exercised through the real dispatch path with deterministic inputs.
- Operational verification: `labrat discuss` works from a separate terminal while `labrat auto` is running. Agenda state survives simulated crash (kill + restart). Steering latency is communicated in UI.
- UAT / human verification: Full autonomous loop with real LLM producing a structured research agenda and executing multi-phase experiments. Manual judgment on agenda decomposition quality and simplicity scoring utility.

## Milestone Definition of Done

This milestone is complete only when all are true:

- All three slices completed with passing contract tests extending the existing 480-test suite
- `labrat plan` produces a valid structured agenda from an interactive discussion flow
- Simplicity scoring integrates into `makeKeepDiscardDecision()` with configurable weight via `simplicityWeight`
- Post-commit target file validation catches out-of-scope modifications and reverts without eval
- Multi-phase agenda campaign executes phase boundaries with reassessment and phase-level baseline updates
- `labrat discuss` writes `STEERING.json` that the running loop picks up at experiment boundaries
- Existing M001-era `CAMPAIGN.json` files still parse and campaigns run without modification (backward compatibility proven by tests)
- All 480 existing tests still pass (no regressions)
- New features live in separate modules (`simplicity-scorer.ts`, `agenda.ts`, `steering.ts`) — auto.ts net line count does not increase

## Requirement Coverage

- Covers: R016, R017, R018, R019, R020
- Candidate requirements adopted: CR001 (target file validation), CR002 (agenda state persistence), CR003 (structured history by phase)
- Partially covers: none
- Leaves for later: R026 (upstream sync — M003)
- Orphan risks: none — all active requirements for M002 are mapped

## Slices

- [x] **S01: Simplicity-Aware Evaluation & Multi-File Safety** `risk:high` `depends:[]`
  > After this: Running a campaign with `simplicityWeight` configured shows simplicity scores in the experiment log and prefers simpler code when metrics are close. A multi-file experiment that touches files outside the target list is caught and reverted pre-eval. All proven by contract tests exercising the real eval pipeline functions.

- [x] **S02: Research Agenda Planning & Execution** `risk:medium` `depends:[S01]`
  > After this: `labrat plan` runs an interactive discussion and produces a structured agenda with phases. Starting a campaign with an agenda executes experiments phase-by-phase with boundary reassessment and phase-level baselines. Agenda state survives restart. Proven by contract tests and live `labrat plan` interaction with a real LLM.

- [x] **S03: Runtime Steering** `risk:medium` `depends:[S02]`
  > After this: While `labrat auto` runs a campaign, `labrat discuss` in a separate terminal writes steering directives. The running loop picks up the new direction at the next experiment boundary with an explicit UI notification about when steering takes effect. Proven by contract tests and operational exercise of two-terminal steering.

## Boundary Map

### S01 → S02

Produces:
- `simplicity-scorer.ts` module with `computeSimplicityScore(diffStat: DiffStat): SimplicityScore` and `SimplicityScore` type — establishes the module extraction pattern for M002 (new .ts module with pure functions, called from auto.ts)
- Extended `CampaignConfig` type with optional `simplicityWeight?: number` field, backward-compatible with M001 configs (proven by existing `parseCampaignConfig` tests still passing)
- Extended `ExperimentResult` type with optional `simplicityScore?: SimplicityScore` field
- Extended `makeKeepDiscardDecision()` to factor in simplicity when `simplicityWeight > 0`
- `validateTargetFiles(targetFiles: string[], commitSha: string): { valid: boolean, violations: string[] }` function checking `git diff --name-only` against target list
- Pre-eval validation hook in `runExperimentPostProcess()` that reverts immediately on target file violations

Consumes:
- nothing (first slice)

### S02 → S03

Produces:
- `agenda.ts` module with `AgendaConfig`, `AgendaPhase`, `ExperimentPlan` types, `parseAgenda()`, `getCurrentPhase()`, `advancePhase()`, `writeAgendaState()`, `readAgendaState()` functions
- Extended `CampaignConfig` with optional `agenda?: AgendaConfig` field containing ordered phases with experiment plans
- `AGENDA-STATE.json` file format in slice directory — tracks `currentPhaseIndex`, `phaseResults`, `completedDimensions`, crash-recoverable
- Phase-aware `compressExperimentHistory()` variant grouping experiments by phase/dimension for structured prompt context
- `labrat plan` subcommand registered in commands.ts, adapting `showDiscuss` + `buildDiscussSlicePrompt` pattern
- Phase boundary detection in `dispatchNextUnit()` — when current phase's experiments are exhausted, trigger reassessment then advance
- `prompts/plan-agenda.md` template for LLM-driven agenda decomposition
- Phase-specific context injection in `buildExperimentPrompt()` — current phase goals, dimension focus, phase-level best metrics

Consumes:
- Module extraction pattern from S01 (same approach: pure-function module called from auto.ts)
- CampaignConfig extension pattern with backward compatibility from S01
- `ExperimentResult.simplicityScore` available for phase-level summaries

### S03 (terminal)

Produces:
- `steering.ts` module with `readSteeringDirective(sliceDir: string): SteeringDirective | null`, `writeSteeringDirective(sliceDir: string, directive: SteeringDirective): void` (atomic write-to-temp-then-rename), `clearSteeringDirective(sliceDir: string): void`
- `SteeringDirective` type: `{ type: 'refocus' | 'skip_phase' | 'add_experiments' | 'stop', message: string, timestamp: string, appliedAt?: string }`
- `STEERING.json` file format in slice directory — read once per experiment boundary, deleted after application
- `labrat discuss` subcommand in commands.ts for runtime steering — interactive prompt that writes STEERING.json
- Experiment-boundary steering check in `dispatchNextUnit()` — non-blocking, non-fatal, with `ui.notify` feedback about what changed
- Steering latency UX: `labrat discuss` prints "Steering will take effect after the current experiment finishes" after writing directive
- Integration with agenda phases: `refocus` can redirect within current phase, `skip_phase` advances to next phase

Consumes:
- `AgendaConfig` and `AGENDA-STATE.json` from S02 for phase-level steering
- Dispatch hook pattern from S01/S02 (read file at experiment boundary in `dispatchNextUnit`)
- CampaignConfig structure from S01/S02
