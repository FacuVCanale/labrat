# M001: Core Research Loop

**Vision:** Take the GSD-2 codebase and reshape its development-oriented flow into an autonomous research engine. The core loop — modify target files, run eval, parse metrics, keep or discard based on results — runs reliably overnight, survives crashes, tracks costs, logs to MLOps platforms in real-time, and produces an actionable morning report.

## Success Criteria

- User can run `labrat start` with a target file and eval command, walk away, and come back to meaningful experiment results
- Failed experiments advance the campaign with knowledge instead of blocking progress
- Process killed mid-experiment resumes cleanly on restart with no data loss
- Experiment metrics appear in W&B/MLFlow dashboard while the loop is still running
- Terminal morning report shows top experiments, improvement trajectory, and cost breakdown in under 2 minutes of reading
- Karpathy train.py + val_bpb scenario runs end-to-end as validation

## Key Risks / Unknowns

- **State machine adaptation depth** — auto.ts (~3000 lines) has development phase logic deeply woven in. Research semantics require surgical changes to advancement, failure handling, and dispatch.
- **Research prompt effectiveness** — the LLM's exploration quality depends on prompt design. Bad prompts = wasted overnight runs.
- **W&B/MLFlow REST from TypeScript** — both platforms are Python-native. REST API auth and metric logging need verification from Node.js.

## Proof Strategy

- State machine adaptation depth → retire in S02 by proving the state machine correctly advances through failed experiments without blocking
- Research prompt effectiveness → retire in S04 by proving the LLM receives meaningful experiment context and produces code modifications
- W&B/MLFlow REST from TypeScript → retire in S06 by proving live metric logging works from Node.js via REST

## Verification Classes

- Contract verification: unit tests for eval parsing, metric comparison, keep/discard logic, state derivation
- Integration verification: full experiment loop end-to-end (modify → eval → compare → keep/revert → log)
- Operational verification: crash recovery (kill mid-experiment, resume), budget ceiling pause, timeout enforcement
- UAT / human verification: Karpathy train.py smoke test, morning report readability

## Milestone Definition of Done

This milestone is complete only when all are true:

- The full experiment loop (modify → eval → parse → compare → keep/revert) works autonomously
- State machine handles research flow: failed experiments advance, phases are exploratory
- Crash mid-experiment → restart → clean resume with no data loss
- Experiments log to W&B/MLFlow in real-time via REST API
- Karpathy train.py + val_bpb runs as end-to-end smoke test
- Terminal morning report shows actionable results (top experiments, trajectory, costs)
- All GSD-2 inherited infrastructure (cost tracking, timeout, multi-provider LLM) functional
- CLI commands work: start, auto, stop, status, report

## Requirement Coverage

- Covers: R001, R002, R003, R004, R005, R006, R007, R008, R009, R010, R011, R012, R013, R014, R015
- Partially covers: none
- Leaves for later: R016, R017, R018, R019, R020 (M002), R026 (M003)
- Orphan risks: none

## Slices

- [x] **S01: Repository Bootstrap & Build** `risk:medium` `depends:[]`
  > After this: `npm run build` passes with GSD-2 source in the repo, upstream remote set, package identity updated to Labrat, all inherited infrastructure functional.

- [ ] **S02: Research Types & State Machine** `risk:high` `depends:[S01]`
  > After this: state machine recognizes research flow — phases are theories, failed experiments advance instead of blocking, campaign/phase/experiment hierarchy works with the existing Milestone/Slice/Task structure.

- [ ] **S03: Eval Runner & Keep/Discard Engine** `risk:high` `depends:[S02]`
  > After this: run a user-defined eval command, parse JSON metrics from stdout, compare against baseline with weighted composite scoring, keep (commit) if improved or discard (revert) if not.

- [ ] **S04: Research Prompts & Fresh Context** `risk:medium` `depends:[S02]`
  > After this: LLM receives experiment-oriented prompt with target file source, prior experiment diffs, compressed history, best results — fresh context per experiment. LLM produces meaningful code modifications.

- [ ] **S05: Experiment Log, Crash Recovery & Supervision** `risk:medium` `depends:[S03]`
  > After this: structured JSON experiment log survives crashes. Kill mid-experiment, restart, resume from clean state. Budget ceiling pauses before overspending. Timeout supervision enforced.

- [ ] **S06: Live MLOps Integration** `risk:medium` `depends:[S03]`
  > After this: experiment metrics and orchestration metadata appear in W&B/MLFlow dashboard in real-time while the loop runs.

- [ ] **S07: CLI, Morning Report & Smoke Test** `risk:low` `depends:[S04,S05,S06]`
  > After this: `labrat start` runs the Karpathy train.py scenario end-to-end. `labrat report` shows terminal summary with top experiments, trajectory, costs, and platform dashboard link.

## Boundary Map

### S01 → S02

Produces:
- Full GSD-2 codebase building and running as `labrat`
- `package.json` with updated identity (name, bin, description)
- Upstream remote configured for GSD-2 cherry-picks
- All existing infrastructure functional (build, LLM providers, extension system)

Consumes:
- nothing (first slice)

### S02 → S03

Produces:
- Research-oriented types in `types.ts` (ExperimentResult, MetricDefinition, EvaluationConfig, KeepDiscard decision)
- Adapted state derivation that treats experiment failure as data, not blocker
- Modified dispatch logic that advances through exploratory phases
- Git strategy adapted for experiment commits/reverts on campaign branch

Consumes from S01:
- Working GSD-2 codebase with build system

### S02 → S04

Produces:
- Research phase types and state machine semantics
- Experiment context structure (what the LLM needs to know per experiment)

Consumes from S01:
- Working GSD-2 codebase with build system

### S03 → S05

Produces:
- Eval runner: `runEval(command, timeout) → ExperimentResult`
- Metric parser: `parseMetrics(stdout) → Record<string, number>`
- Metric comparator: `compareMetrics(current, best, config) → KeepDiscard`
- Keep/discard executor: `applyDecision(decision) → git commit | git revert`

Consumes from S02:
- Research types (ExperimentResult, MetricDefinition, EvaluationConfig)
- State machine with research advancement logic

### S03 → S06

Produces:
- ExperimentResult with full metrics, timing, and decision data
- Keep/discard events as integration points for external logging

Consumes from S02:
- Research types and state machine

### S04 → S07

Produces:
- Research prompt templates (experiment context, history injection, what-to-try-next)
- Fresh context builder (assembles prompt from target files, history, best results)

Consumes from S02:
- Research types and experiment context structure

### S05 → S07

Produces:
- `ExperimentLog` — append-only structured JSON, queryable, crash-survivable
- Crash recovery adapted for experiments (revert incomplete, resume clean)
- Budget ceiling and timeout supervision wired to experiment loop

Consumes from S03:
- Eval runner and keep/discard engine (experiment lifecycle events)

### S06 → S07

Produces:
- `MLOpsIntegration` — W&B/MLFlow REST client for logging orchestration metadata
- Live logging hooks that fire during experiment execution
- Platform dashboard URL resolver

Consumes from S03:
- ExperimentResult with metrics and decision data
