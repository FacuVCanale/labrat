# Requirements

This file is the explicit capability and coverage contract for the project.

Use it to track what is actively in scope, what has been validated by completed work, what is intentionally deferred, and what is explicitly out of scope.

Guidelines:
- Keep requirements capability-oriented, not a giant feature wishlist.
- Requirements should be atomic, testable, and stated in plain language.
- Every **Active** requirement should be mapped to a slice, deferred, blocked with reason, or moved out of scope.
- Each requirement should have one accountable primary owner and may have supporting slices.
- Research may suggest requirements, but research does not silently make them binding.
- Validation means the requirement was actually proven by completed work and verification, not just discussed.

## Active

### R026 — GSD-2 Upstream Feature Sync
- Class: operability
- Status: active
- Description: Mechanism for analyzing GSD-2 upstream changes and selectively integrating relevant infrastructure improvements into Labrat. Since both share the same core infrastructure DNA, an LLM can diff upstream changes against Labrat's codebase and port relevant features.
- Why it matters: GSD-2 continues to evolve. Labrat should benefit from infrastructure fixes and improvements without manual porting effort.
- Source: user
- Primary owning slice: M003/S01
- Supporting slices: M003/S02, M003/S03
- Validation: S01 — upstream-sync.ts fetches, classifies, and reports 532 real upstream commits (467 infra, 14 dev, 51 mixed). Sync state persists across invocations. `labrat sync` CLI operational. 137 contract+integration tests. Remaining: selective apply (S02), LLM adaptation (S03).
- Notes: Upstream remote already tracked. Cherry-pick selective, not merge. An LLM analyzing code differences can identify and adapt new features.

### R001 — GSD-2 Base & Upstream Tracking
- Class: constraint
- Status: validated
- Description: Repository starts from GSD-2 codebase with upstream remote for selective cherry-picks. Builds and runs.
- Why it matters: All infrastructure (crash recovery, cost tracking, timeout, multi-provider LLM) comes from GSD-2 — rebuilding it is waste.
- Source: user
- Primary owning slice: M001/S01
- Supporting slices: none
- Validation: S01 — GSD-2 v2.10.6 merged, upstream remote set, `npm run build` passes, all workspace packages compile, native bindings present
- Notes: `git remote add upstream` for GSD-2. Cherry-pick selectively, no direct merge.

### R002 — Research Flow Semantics
- Class: core-capability
- Status: validated
- Description: State machine adapted for research where failure is data, phases are theories/hypotheses, and advancement is exploration-driven rather than success-gated.
- Why it matters: This is the fundamental difference between Labrat and GSD-2. Research flow cannot use development flow semantics where failure blocks progress.
- Source: user
- Primary owning slice: M001/S02
- Supporting slices: M001/S04
- Validation: S02 — deriveState returns experimenting phase when campaign config present, malformed config degrades gracefully, all switch sites handle new phase, experiment revert+continue flow. 33 contract tests.
- Notes: Failed experiments advance the campaign with knowledge. Phases are exploratory, not commitments.

### R003 — Experiment Loop
- Class: primary-user-loop
- Status: validated
- Description: Autonomous loop: modify target file(s) → commit → run eval → parse metrics → compare against best → keep if improved, revert if not → repeat.
- Why it matters: This is the core product loop. Everything else supports it.
- Source: user
- Primary owning slice: M001/S03
- Supporting slices: M001/S02, M001/S04
- Validation: S03 — Full eval pipeline (subprocess, parsing, aggregation, scoring, keep/discard with git revert) proven by 66 contract tests. handleAgentEnd wiring triggers post-processing for run-experiment units. End-to-end loop integration deferred to S07 smoke test.
- Notes: Target files specified by user at campaign start. Eval script and infrastructure are immutable.

### R004 — Multi-Metric Evaluation Framework
- Class: core-capability
- Status: validated
- Description: User-defined eval command produces JSON to stdout with named metrics. Configurable directions (min/max per metric). Weighted composite scoring. Hard timeout per eval (default 5 min).
- Why it matters: Real research has multiple metrics. Single-metric is too narrow for general use.
- Source: user
- Primary owning slice: M001/S03
- Supporting slices: none
- Validation: S03 — Direction-aware (min/max) weighted composite scoring, weight normalization, zero baseline guard, multi-run median aggregation, timeout enforcement, JSON parsing from mixed stdout — all proven by 66 contract tests.
- Notes: Non-deterministic eval supported via `--runs N` flag (run N times, use median). Default N=1.

### R005 — Fresh Context Per Experiment
- Class: core-capability
- Status: validated
- Description: Each experiment gets a clean LLM context. The prompt includes: research question, target file source, best results so far, compressed history of prior attempts, what to try next.
- Why it matters: Prevents context pollution between experiments. LLM reasons from clean state with relevant history.
- Source: user
- Primary owning slice: M001/S04
- Supporting slices: M001/S02
- Validation: S04 — buildExperimentPrompt() assembles five-section prompt with campaign overview, target files, best metrics, compressed history, and instructions. 55 contract tests covering assembly, edge cases (no history, missing files, no best metrics). Fresh context per experiment via new LLM context window per dispatch.
- Notes: Inherited from GSD-2's fresh-context-per-unit pattern.

### R006 — Git-Based Experiment State
- Class: continuity
- Status: validated
- Description: Branch per campaign. Each experiment is an atomic commit. Failed experiments revert cleanly. Improvements accumulate on the branch.
- Why it matters: Git is the state backbone — experiments are traceable, revertable, and survive crashes.
- Source: user
- Primary owning slice: M001/S02
- Supporting slices: M001/S03
- Validation: S02 — commitExperiment produces labeled atomic commits, revertExperiment produces clean reverts, idempotent on repeated calls, tree hash matches pre-experiment state. 14 integration tests.
- Notes: Adapts GSD-2's branch-per-slice strategy.

### R007 — Crash Recovery for Experiments
- Class: failure-visibility
- Status: validated
- Description: Lock file tracks current experiment. On restart: detect interruption, revert incomplete changes, resume from clean state. No manual intervention.
- Why it matters: Silent failure is the worst outcome. Overnight runs must survive crashes.
- Source: user
- Primary owning slice: M001/S05
- Supporting slices: none
- Validation: S05 — Orphan commit detection in startAuto compares git log experiment commits vs JSONL entries, reverts orphans. Lock file enriched with experimentNumber during dispatch. run-experiment timeout handler reverts incomplete experiments. formatCrashInfo displays experiment context. 37 contract tests.
- Notes: Adapted from GSD-2's crash recovery. Must revert incomplete experiment on resume.

### R008 — Cost & Token Tracking with Budget Ceiling
- Class: operability
- Status: validated
- Description: Cost tracked per experiment and per campaign total. Budget ceiling pauses before exceeding user-defined limit.
- Why it matters: Overnight runs can be expensive. User needs cost visibility and a safety valve.
- Source: inferred
- Primary owning slice: M001/S05
- Supporting slices: none
- Validation: S05 — Per-experiment budget guard pauses on overspend (strict >), degrades gracefully on zero-cost providers. Campaign-level budget_ceiling triggers at-or-over (>=). 11 budget-specific contract tests.
- Notes: Inherited from GSD-2's metrics system. Budget ceiling already implemented.

### R009 — Timeout & Idle Supervision
- Class: operability
- Status: validated
- Description: Configurable timeouts per experiment and per eval execution. Idle detection for stuck agents.
- Why it matters: Prevents runaway experiments from consuming time and money.
- Source: inferred
- Primary owning slice: M001/S05
- Supporting slices: none
- Validation: S05 — run-experiment case in recoverTimedOutUnit reverts orphan commits and dispatches next unit. lastProgressAt updated after eval completion prevents false idle triggers. Contract tests verify both paths.
- Notes: Inherited from GSD-2's timeout supervision.

### R010 — Experiment Log
- Class: continuity
- Status: validated
- Description: Structured JSON log of each experiment: ID, timestamp, description of change, metrics before/after, decision (keep/revert), cost, duration. Crash-survivable. Queryable and sorteable.
- Why it matters: The log is the research artifact. Must survive crashes and be useful for analysis.
- Source: user
- Primary owning slice: M001/S05
- Supporting slices: M001/S03
- Validation: S05 — ExperimentResult.timestamp populated in all three result construction paths. JSONL format crash-survivable (append-only, truncated last line recoverable). Queryable via readAllExperiments(). Contract tests verify timestamp presence.
- Notes: Append-only, flushed to disk after each experiment.

### R011 — Live MLOps Integration
- Class: integration
- Status: validated
- Description: W&B and MLFlow connected via REST API in real-time while the loop runs. Labrat logs orchestration metadata (experiment ID, keep/discard, timing, cost). User's eval scripts handle domain tracking (loss curves, model artifacts) natively via their own W&B/MLFlow calls.
- Why it matters: Users already have MLOps tools. Labrat must fit into that ecosystem, not replace it.
- Source: user
- Primary owning slice: M001/S06
- Supporting slices: none
- Validation: S06 — MLFlowClient REST and WandbClient GraphQL/filestream implementations with 105 contract tests proving request shapes, auth headers, metric sanitization, circuit breaker, non-fatal error handling. Wired into auto.ts campaign lifecycle at init/log/finish. CampaignConfig.mlops optional field.
- Notes: Two-layer integration: Labrat logs orchestration, eval scripts log domain metrics. Both write to the same platform.

### R012 — CLI Commands
- Class: launchability
- Status: validated
- Description: `start` (quick loop), `auto` (autonomous campaign), `stop` (graceful shutdown), `status` (progress), `report` (summary).
- Why it matters: The CLI is the user's interface to Labrat.
- Source: user
- Primary owning slice: M001/S07
- Supporting slices: none
- Validation: S07 — `labrat report` reads campaign data and prints formatted morning report, exits 0 on no-campaign. `labrat start` parses --target/--eval/--metric/--max-experiments/--budget-per-experiment flags, creates GSD scaffold, auto-starts interactive mode. `/gsd report` interactive command operational. Help text and graceful error handling verified.
- Notes: Adapts GSD-2's existing CLI framework. `stop` and `status` inherited from GSD-2 interactive mode.

### R013 — Terminal Morning Report
- Class: primary-user-loop
- Status: validated
- Description: Terminal summary showing: experiments run/kept/reverted, best result, improvement trajectory, cost breakdown, time elapsed, top experiments ranked. Plus link to MLOps platform dashboard.
- Why it matters: "Wake up, check results" is the core user journey endpoint.
- Source: user
- Primary owning slice: M001/S07
- Supporting slices: M001/S06
- Validation: S07 — `generateMorningReport()` pure formatter with 7 conditional sections: campaign header, experiment summary, top experiments table, improvement trajectory, cost breakdown, duration, dashboard link. 46 contract tests. NO_COLOR respected via useColor parameter. Missing data sections silently skipped.
- Notes: Quick glance in terminal, deep dive in W&B/MLFlow dashboard.

### R014 — Research Prompts
- Class: core-capability
- Status: validated
- Description: LLM sees target file source code, prior experiment diffs, compressed history, best results. Decides what code changes to try. Prompt is experiment-oriented, not development-oriented.
- Why it matters: The prompt shapes the LLM's exploration strategy. Research prompts ≠ development prompts.
- Source: user
- Primary owning slice: M001/S04
- Supporting slices: none
- Validation: S04 — run-experiment.md template with five context sections, safety boundary (D006), eval-is-automatic directive. buildExperimentPrompt() assembles context from campaign config, target files, JSONL history, best metrics. extractDiffStat() provides meaningful change descriptions. 55 + 4 contract tests.
- Notes: Replaces GSD-2's 20+ development prompt templates.

### R015 — Full LLM Provider Support
- Class: constraint
- Status: validated
- Description: All 20+ LLM providers from GSD-2 available. Users pick whatever model they want.
- Why it matters: Zero cost to maintain — it's inherited infrastructure. Different models suit different research tasks.
- Source: user
- Primary owning slice: M001/S01
- Supporting slices: none
- Validation: S01 — All provider infrastructure inherited from GSD-2 unchanged, compiles clean. No providers removed or modified.
- Notes: Inherited from GSD-2. No changes needed.

## Validated

### R001 — GSD-2 Base & Upstream Tracking
- Class: constraint
- Status: validated
- Description: Repository starts from GSD-2 codebase with upstream remote for selective cherry-picks. Builds and runs.
- Validation: S01 — GSD-2 v2.10.6 merged, upstream remote set, `npm run build` passes, all workspace packages compile, native bindings present

### R002 — Research Flow Semantics
- Class: core-capability
- Status: validated
- Description: State machine adapted for research where failure is data, phases are theories/hypotheses, and advancement is exploration-driven rather than success-gated.
- Validation: S02 — deriveState returns experimenting phase when campaign config present, malformed config degrades gracefully, all switch sites handle new phase, experiment revert+continue flow. 33 contract tests.

### R006 — Git-Based Experiment State
- Class: continuity
- Status: validated
- Description: Branch per campaign. Each experiment is an atomic commit. Failed experiments revert cleanly. Improvements accumulate on the branch.
- Validation: S02 — commitExperiment produces labeled atomic commits, revertExperiment produces clean reverts, idempotent on repeated calls, tree hash matches pre-experiment state. 14 integration tests.

### R003 — Experiment Loop
- Class: primary-user-loop
- Status: validated
- Description: Autonomous loop: modify target file(s) → commit → run eval → parse metrics → compare against best → keep if improved, revert if not → repeat.
- Validation: S03 — Full eval pipeline (subprocess, parsing, aggregation, scoring, keep/discard with git revert) proven by 66 contract tests. handleAgentEnd wiring triggers post-processing for run-experiment units.

### R004 — Multi-Metric Evaluation Framework
- Class: core-capability
- Status: validated
- Description: User-defined eval command produces JSON to stdout with named metrics. Configurable directions (min/max per metric). Weighted composite scoring. Hard timeout per eval (default 5 min).
- Validation: S03 — Direction-aware weighted composite scoring, weight normalization, zero baseline guard, multi-run median aggregation, timeout enforcement, JSON parsing from mixed stdout — all proven by 66 contract tests.

### R005 — Fresh Context Per Experiment
- Class: core-capability
- Status: validated
- Description: Each experiment gets a clean LLM context with research question, target file source, best results, compressed history, and instructions.
- Validation: S04 — buildExperimentPrompt() assembles five-section prompt. 55 contract tests covering assembly, edge cases (no history, missing files, no best metrics).

### R014 — Research Prompts
- Class: core-capability
- Status: validated
- Description: LLM sees target file source code, prior experiment diffs, compressed history, best results. Experiment-oriented, not development-oriented.
- Validation: S04 — run-experiment.md template with five context sections, safety boundary, eval-is-automatic directive. extractDiffStat() provides meaningful change descriptions. 55 + 4 contract tests.

### R015 — Full LLM Provider Support
- Class: constraint
- Status: validated
- Description: All 20+ LLM providers from GSD-2 available. Users pick whatever model they want.
- Validation: S01 — All provider infrastructure inherited from GSD-2 unchanged, compiles clean. No providers removed or modified.

### R007 — Crash Recovery for Experiments
- Class: failure-visibility
- Status: validated
- Description: Lock file tracks current experiment. On restart: detect interruption, revert incomplete changes, resume from clean state. No manual intervention.
- Validation: S05 — Orphan commit detection in startAuto, run-experiment timeout handler, lock enrichment with experimentNumber. 37 contract tests.

### R008 — Cost & Token Tracking with Budget Ceiling
- Class: operability
- Status: validated
- Description: Cost tracked per experiment and per campaign total. Budget ceiling pauses before exceeding user-defined limit.
- Validation: S05 — Per-experiment budget guard pauses on overspend, degrades on zero cost. Campaign-level budget_ceiling verified. 11 budget-specific contract tests.

### R009 — Timeout & Idle Supervision
- Class: operability
- Status: validated
- Description: Configurable timeouts per experiment and per eval execution. Idle detection for stuck agents.
- Validation: S05 — run-experiment timeout recovery, lastProgressAt update after eval. Contract tests verify both paths.

### R010 — Experiment Log
- Class: continuity
- Status: validated
- Description: Structured JSON log with ID, timestamp, metrics, decision, cost, duration. Crash-survivable. Queryable.
- Validation: S05 — ExperimentResult.timestamp in all result paths. JSONL crash-survivable, queryable via readAllExperiments(). Contract tests.

### R011 — Live MLOps Integration
- Class: integration
- Status: validated
- Description: W&B and MLFlow connected via REST API in real-time while the loop runs. Labrat logs orchestration metadata.
- Validation: S06 — MLFlowClient REST and WandbClient GraphQL/filestream with 105 contract tests. Circuit breaker, non-fatal hooks, auto.ts lifecycle wiring.

### R012 — CLI Commands
- Class: launchability
- Status: validated
- Description: `start` (quick loop), `auto` (autonomous campaign), `stop` (graceful shutdown), `status` (progress), `report` (summary).
- Validation: S07 — `labrat report` and `labrat start` subcommands operational with flag parsing, help text, GSD scaffold creation, and graceful error handling. `/gsd report` interactive command. 46 contract tests for morning report.

### R013 — Terminal Morning Report
- Class: primary-user-loop
- Status: validated
- Description: Terminal summary showing experiments run/kept/reverted, best result, improvement trajectory, cost breakdown, time elapsed, top experiments ranked, dashboard link.
- Validation: S07 — `generateMorningReport()` pure formatter with 7 conditional sections. 46 contract tests. NO_COLOR respected. Missing data sections silently skipped.

### R017 — Simplicity-Aware Keep/Discard
- Class: differentiator
- Status: validated
- Description: Beyond metric improvement, consider code complexity. Prefer simpler solutions over marginal improvements. Configurable weight.
- Validation: M002/S01 — `computeSimplicityScore` produces 0–1 score from diff stats. `makeKeepDiscardDecision` blends metric and simplicity when `simplicityWeight > 0`. Weight=0/absent identical to M001. 39 contract tests.

### R019 — Multi-File Experiment Scope
- Class: core-capability
- Status: validated
- Description: Experiments can modify multiple files. Scope of modification specified per campaign.
- Validation: M002/S01 — `validateTargetFiles` checks `git diff --name-only` against `targetFiles[]`. Violations trigger immediate revert without eval. Git failure safely defaults to valid. 31 contract tests.

### R016 — Research Agenda Planning
- Class: core-capability
- Status: validated
- Description: Discussion flow for capturing research question, dimensions to explore, evaluation criteria. Auto-decomposition into planned experiments. Reassessment after batches.
- Validation: M002/S02 — `labrat plan` with campaign-aware guards, `plan-agenda.md` template with AgendaConfig JSON schema, `parseAgenda()` validation, `checkAutoStartAfterPlan()` auto-start bridge. 45 + 106 contract tests.

### R020 — Experiment Dependency/Sequencing
- Class: core-capability
- Status: validated
- Description: Some experiments depend on others. Support for sequential phases within a campaign.
- Validation: M002/S02 — Phase boundary detection via `checkAndAdvancePhase()`, phase-specific prompts via `getPhasePromptOverrides()`, phase attribution via `stampPhaseIndex()`, AGENDA-STATE.json crash-recoverable. 61 + 106 contract tests.

### R018 — Runtime Steering
- Class: core-capability
- Status: validated
- Description: `discuss` command to redirect the campaign while it runs. Reprioritize experiments, add new ideas, skip unpromising directions.
- Validation: M002/S03 — `steering.ts` module with atomic STEERING.json I/O, `checkSteeringDirective` facade in `dispatchNextUnit`, three directive types (refocus/skip_phase/stop) with graceful degradation. `showDiscuss` routes to `showSteering` when campaign active. 137 contract tests.

## Deferred

(none)

## Out of Scope

### R021 — Visualization & Dashboards
- Class: anti-feature
- Status: out-of-scope
- Description: Charts, graphs, and visual experiment dashboards built into Labrat.
- Why it matters: Prevents building what W&B/MLFlow already do well. Integrate, don't build.
- Source: user
- Primary owning slice: none
- Supporting slices: none
- Validation: n/a
- Notes: Delegated to W&B/MLFlow dashboards.

### R022 — Statistical Analysis
- Class: anti-feature
- Status: out-of-scope
- Description: Significance tests, confidence intervals, noise detection built into Labrat.
- Why it matters: Existing statistical tools (scipy, MLOps platforms) handle this.
- Source: user
- Primary owning slice: none
- Supporting slices: none
- Validation: n/a
- Notes: User's eval scripts or MLOps platform handle statistical analysis.

### R023 — Reproducibility / Environment Capture
- Class: anti-feature
- Status: out-of-scope
- Description: Exact environment capture and reproduction per experiment.
- Why it matters: Git history + MLOps artifact tracking already provide this.
- Source: user
- Primary owning slice: none
- Supporting slices: none
- Validation: n/a
- Notes: Delegated to git + MLOps platforms.

### R024 — Domain-Specific Templates
- Class: differentiator
- Status: out-of-scope
- Description: Pre-built templates for ML training, API benchmarking, algorithm comparison, etc.
- Why it matters: Low priority — the general loop handles all domains.
- Source: user
- Primary owning slice: none
- Supporting slices: none
- Validation: n/a
- Notes: May revisit after core is proven.

### R025 — Notifications (Slack/Discord)
- Class: operability
- Status: out-of-scope
- Description: Push notifications when campaign completes or hits budget ceiling.
- Why it matters: Delegated to W&B/MLFlow alerting or separate webhook integration.
- Source: user
- Primary owning slice: none
- Supporting slices: none
- Validation: n/a
- Notes: MLOps platforms already have alerting capabilities.

## Traceability

| ID | Class | Status | Primary owner | Supporting | Proof |
|---|---|---|---|---|---|
| R001 | constraint | validated | M001/S01 | none | S01 |
| R002 | core-capability | validated | M001/S02 | M001/S04 | S02 |
| R003 | primary-user-loop | validated | M001/S03 | M001/S02, M001/S04 | S03 |
| R004 | core-capability | validated | M001/S03 | none | S03 |
| R005 | core-capability | validated | M001/S04 | M001/S02 | S04 |
| R006 | continuity | validated | M001/S02 | M001/S03 | S02 |
| R007 | failure-visibility | validated | M001/S05 | none | S05 |
| R008 | operability | validated | M001/S05 | none | S05 |
| R009 | operability | validated | M001/S05 | none | S05 |
| R010 | continuity | validated | M001/S05 | M001/S03 | S05 |
| R011 | integration | validated | M001/S06 | none | S06 |
| R012 | launchability | validated | M001/S07 | none | S07 |
| R013 | primary-user-loop | validated | M001/S07 | M001/S06 | S07 |
| R014 | core-capability | validated | M001/S04 | none | S04 |
| R015 | constraint | validated | M001/S01 | none | S01 |
| R016 | core-capability | validated | M002/S02 | none | M002/S02 |
| R017 | differentiator | validated | M002/S01 | none | M002/S01 |
| R018 | core-capability | validated | M002/S03 | none | M002/S03 |
| R019 | core-capability | validated | M002/S01 | none | M002/S01 |
| R020 | core-capability | validated | M002/S02 | none | M002/S02 |
| R021 | anti-feature | out-of-scope | none | none | n/a |
| R022 | anti-feature | out-of-scope | none | none | n/a |
| R023 | anti-feature | out-of-scope | none | none | n/a |
| R024 | differentiator | out-of-scope | none | none | n/a |
| R025 | operability | out-of-scope | none | none | n/a |
| R026 | operability | active | M003/S01 | M003/S02, M003/S03 | unmapped |

## Coverage Summary

- Active requirements: 1
- Mapped to slices: 1
- Validated: 20
- Unmapped active requirements: 0
