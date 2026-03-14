# M001: Core Research Loop — Context

**Gathered:** 2026-03-13
**Status:** Ready for planning

## Project Description

Labrat is an autonomous research agent built on GSD-2's infrastructure. It reshapes the development-oriented workflow into a research-oriented one: instead of plan → execute → ship, it's hypothesize → modify → evaluate → keep/discard → repeat. The core insight is that research ≠ development — most experiments fail, and the value is in the accumulated knowledge.

## Why This Milestone

This is the foundational milestone. Without the core experiment loop working end-to-end, nothing else matters. The full autonomous research flow must work: an LLM modifies target files, an eval command runs and produces JSON metrics, results are compared, improvements are kept (committed), failures are discarded (reverted), and the loop repeats with fresh context.

## User-Visible Outcome

### When this milestone is complete, the user can:

- Run `labrat start --target train.py --eval "python eval.py" --metric val_bpb --direction lower` and walk away
- Come back to find N experiments completed, M improvements kept, with a terminal report showing trajectory
- See experiment orchestration metadata in their W&B/MLFlow dashboard alongside their eval script's domain metrics
- Kill the process mid-experiment, restart, and resume cleanly from a known-good state

### Entry point / environment

- Entry point: CLI commands (`labrat start`, `labrat auto`, `labrat report`)
- Environment: local dev (terminal)
- Live dependencies involved: W&B/MLFlow REST API (optional), LLM provider API, user's eval command

## Completion Class

- Contract complete means: eval runner parses JSON metrics correctly, keep/discard logic compares and decides correctly, crash recovery reverts incomplete experiments
- Integration complete means: full loop runs autonomously — LLM modifies code, eval runs, metrics compared, git state updated, MLOps logged, repeat
- Operational complete means: overnight run survives crashes, respects budget ceiling, produces actionable morning report

## Final Integrated Acceptance

To call this milestone complete, we must prove:

- Karpathy train.py + val_bpb scenario runs end-to-end as smoke test
- Process killed mid-experiment resumes cleanly on restart
- Terminal morning report is readable and actionable after 10+ experiments
- W&B/MLFlow dashboard shows experiment data logged during the run

## Risks and Unknowns

- **GSD-2 state machine adaptation depth** — auto.ts is ~3000 lines with development-oriented phase logic deeply woven in. Research semantics (failure ≠ blocker, phases are theories) require careful surgery, not find-and-replace.
- **Eval generality** — making the eval framework truly domain-agnostic while handling edge cases (crashes, timeouts, non-determinism, multi-metric scoring).
- **W&B/MLFlow REST API from TypeScript** — both platforms are Python-native. REST API documentation quality varies. Need to verify auth, metric logging, and run management work cleanly from Node.js.
- **Research prompt effectiveness** — the LLM's ability to make meaningful code modifications for research depends heavily on prompt design. Wrong prompts = 40 useless experiments overnight.

## Existing Codebase / Prior Art

- `src/resources/extensions/gsd/auto.ts` (~3000 lines) — the state machine driving autonomous execution. Core dispatch logic, phase detection, unit management, timeout supervision. This is the primary refactoring target.
- `src/resources/extensions/gsd/types.ts` (~187 lines) — type definitions for the hierarchy. Needs research-oriented types added.
- `src/resources/extensions/gsd/state.ts` (~460 lines) — state derivation from disk files. Advancement logic lives here.
- `src/resources/extensions/gsd/files.ts` (~824 lines) — file parsing for roadmaps, plans, summaries. Mostly reusable.
- `src/resources/extensions/gsd/crash-recovery.ts` (~85 lines) — lock file mechanism. Needs experiment-specific adaptation.
- `src/resources/extensions/gsd/metrics.ts` (~374 lines) — cost/token tracking, budget ceiling. Largely reusable.
- `src/resources/extensions/gsd/session-forensics.ts` (~500 lines) — crash diagnosis. Reusable.
- `src/resources/extensions/gsd/git-service.ts` (~770 lines) — git operations. Reusable with adapted strategy.
- `src/resources/extensions/gsd/preferences.ts` (~745 lines) — configuration, supervisor config, budget. Reusable.
- `src/resources/extensions/gsd/prompts/` — 20+ development prompt templates. All need research equivalents.
- `packages/pi-ai/` — multi-provider LLM support (20+ providers). Keep as-is.
- `packages/pi-coding-agent/` — agent core, session management, extension system. Keep as-is.

> See `.gsd/DECISIONS.md` for all architectural and pattern decisions — it is an append-only register; read it during planning, append to it during execution.

## Relevant Requirements

- R001 — GSD-2 base with upstream tracking (S01)
- R002 — Research flow semantics: failure is data, phases are theories (S02)
- R003 — Core experiment loop: modify → eval → keep/revert (S03)
- R004 — Multi-metric evaluation framework (S03)
- R005 — Fresh context per experiment (S04)
- R006 — Git-based experiment state (S02)
- R007 — Crash recovery for experiments (S05)
- R008 — Cost & token tracking with budget ceiling (S05)
- R009 — Timeout & idle supervision (S05)
- R010 — Experiment log, structured and crash-survivable (S05)
- R011 — Live MLOps integration, W&B/MLFlow (S06)
- R012 — CLI commands (S07)
- R013 — Terminal morning report (S07)
- R014 — Research prompts (S04)
- R015 — Full LLM provider support (S01)

## Scope

### In Scope

- Repository bootstrap from GSD-2 with upstream tracking
- State machine adaptation for research flow (failure ≠ blocker, exploratory advancement)
- Eval runner: execute shell command, parse JSON stdout, multi-metric comparison
- Keep/discard engine: metric comparison, git commit on keep, git revert on discard
- Research-oriented prompts: target file source, experiment history, what to try next
- Experiment log: structured JSON, append-only, crash-survivable
- Crash recovery: detect interruption, revert incomplete experiment, resume
- Cost/token tracking and budget ceiling (inherited)
- Timeout and idle supervision (inherited)
- Live MLOps integration: W&B/MLFlow REST API for orchestration metadata
- CLI: start (quick loop), auto, stop, status, report
- Terminal morning report with platform dashboard link
- Karpathy train.py + val_bpb end-to-end smoke test

### Out of Scope / Non-Goals

- Research agenda planning / structured campaigns (M002)
- Simplicity-aware keep/discard (M002)
- Runtime steering / discuss command (M002)
- Multi-file experiments (M002 — MVP uses single target file)
- Visualization, dashboards, statistical analysis (delegated to MLOps platforms)
- Domain-specific templates
- Notifications (delegated to MLOps platform alerting)

## Technical Constraints

- GSD-2 is TypeScript/Node.js — all new code must be TypeScript
- W&B and MLFlow are Python-native — integration via REST API, not SDK
- Eval commands are user-defined shell processes — Labrat doesn't know what they do, just runs them and parses JSON output
- Target file safety boundary: agent can only modify files explicitly specified by the user
- The user's eval script and infrastructure are immutable — Labrat never touches them

## Integration Points

- **W&B REST API** — log orchestration metadata (experiment ID, keep/discard, timing, cost) alongside user's domain metrics
- **MLFlow REST API** — alternative to W&B, same integration pattern
- **LLM Provider APIs** — inherited from GSD-2, used for experiment reasoning
- **Git** — branch per campaign, atomic commits, reverts. Inherited git-service.ts
- **User's eval command** — shell subprocess, JSON stdout, timeout-supervised

## Open Questions

- **W&B REST API auth flow** — need to verify API key auth works cleanly from Node.js without the Python SDK
- **MLFlow server assumption** — does the user run a local MLFlow server, or use a hosted instance? Affects REST API endpoint configuration
- **Eval crash handling** — after 3 consecutive eval crashes, pause and alert. But should Labrat try a different modification strategy first, or just stop?
