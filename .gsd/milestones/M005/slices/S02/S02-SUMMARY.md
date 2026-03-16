---
id: S02
parent: M005
milestone: M005
provides:
  - S02-RESEARCH.md — structured Karpathy autoresearch analysis with architecture, adopt/avoid tables, prompt fragments for all 4 agent phases
  - R043 validated with concrete evidence
  - S02→S04 boundary contract fulfilled (research-hypothesis.md, plan-experiment.md, execute-experiment.md, verify-experiment.md fragments)
requires:
  - slice: none
    provides: none (parallel with S01, no dependencies)
affects:
  - S04 (consumes research artifact for hypothesis-native prompt design)
  - S06 (integration — research patterns inform end-to-end flow)
key_files:
  - .gsd/milestones/M005/slices/S02/S02-RESEARCH.md
  - .gsd/REQUIREMENTS.md
key_decisions:
  - Added plan-experiment.md prompt fragment to complete 4-phase boundary contract (research had produced 3 of 4 fragments)
patterns_established:
  - Research artifact validation via grep-based section/content checks
  - Adopt/avoid table format for research analysis consumed by downstream prompt design
observability_surfaces:
  - R043 status in REQUIREMENTS.md (grep "R043" .gsd/REQUIREMENTS.md | grep "validated")
  - Research artifact completeness (grep -c "## " S02-RESEARCH.md → 19 sections)
  - S02→S04 boundary (grep for all 4 prompt type names in S02-RESEARCH.md)
drill_down_paths:
  - .gsd/milestones/M005/slices/S02/tasks/T01-SUMMARY.md
duration: ~10m
verification_result: passed
completed_at: 2026-03-16
---

# S02: Karpathy Auto-Research Analysis

**Structured research artifact analyzing Karpathy's autoresearch approach — architecture, prompt patterns, adopt/avoid tables, and prompt fragments for all 4 NightShift agent phases — ready for S04 consumption.**

## What Happened

Research phase produced S02-RESEARCH.md with 19 sections covering Karpathy's three-file autoresearch design (prepare.py, train.py, program.md), experiment loop mechanics, 6 key design principles, and detailed adopt/avoid analysis. The single validation task (T01) confirmed completeness against R043 requirements, identified a missing plan-experiment.md prompt fragment (3 of 4 phases had fragments), added it, and validated R043 in REQUIREMENTS.md.

The research artifact captures concrete patterns from Karpathy's approach: simplicity criterion, NEVER STOP directive, output suppression, git experiment state, prompt-as-skill, fixed metric focus, and "think harder" escalation. It also identifies anti-patterns NightShift should avoid: no research phase, flat loop without hypothesis structure, single agent, raw logging without structured analysis, no learning feedback between experiments.

## Verification

All 12 verification checks pass:
- Section count: 19 (≥8 ✓)
- ADOPT analysis present ✓
- AVOID analysis present ✓
- Prompt Fragments section present ✓
- All 4 prompt type references (research-hypothesis.md, plan-experiment.md, execute-experiment.md, verify-experiment.md) ✓
- Source citations: 6 (≥3 ✓)
- R043 validated in REQUIREMENTS.md ✓
- R043 not unmapped ✓
- Observability diagnostics (ADOPT+AVOID completeness check) ✓

## Requirements Validated

- R043 — S02-RESEARCH.md with 19 sections, 7-row adopt table, 8-row avoid table, prompt fragments for all 4 agent phases, 6 cited primary sources. Karpathy's architecture analyzed, patterns extracted, anti-patterns identified.

## Requirements Advanced

- R045 — Prompt fragments in S02-RESEARCH.md directly feed S04 hypothesis-native prompt design (not yet validated — S04's job).

## New Requirements Surfaced

None.

## Requirements Invalidated or Re-scoped

None.

## Deviations

- Added plan-experiment.md prompt fragment to S02-RESEARCH.md — the research phase had produced fragments for research-hypothesis, execute-experiment, and verify-experiment, but the plan phase was covered only by a generic "NEVER STOP" section. Added a concrete hypothesis formation pattern covering what to change, why (grounded in research), expected metric movement, and refutation criteria.

## Known Limitations

None — this is a research-only artifact slice with no code changes.

## Follow-ups

None — S04 consumes this artifact directly.

## Files Created/Modified

- `.gsd/milestones/M005/slices/S02/S02-RESEARCH.md` — added plan-experiment.md prompt fragment section
- `.gsd/REQUIREMENTS.md` — R043 active→validated with evidence, traceability table and coverage counts updated
- `.gsd/milestones/M005/slices/S02/S02-PLAN.md` — added Observability/Diagnostics section, marked T01 done
- `.gsd/milestones/M005/slices/S02/tasks/T01-PLAN.md` — added Observability Impact section

## Forward Intelligence

### What the next slice should know
- S02-RESEARCH.md prompt fragments are starting points, not finished prompts. S04 should expand them with full context injection (campaign config, target files, prior experiment results, verifier analysis).
- The adopt table's "simplicity criterion" pattern maps directly to the existing `simplicityWeight` in CampaignConfig (M002). Prompt fragments reference this.
- Karpathy's "NEVER STOP" directive should appear in ALL four prompts, not just execute. The research artifact has it as a cross-cutting pattern.

### What's fragile
- Nothing — this is a static research document with no runtime dependencies.

### Authoritative diagnostics
- `grep -c "## " .gsd/milestones/M005/slices/S02/S02-RESEARCH.md` → 19 — confirms all sections present
- `grep "R043" .gsd/REQUIREMENTS.md | grep "validated"` — confirms requirement status

### What assumptions changed
- Originally assumed research phase would produce all 4 prompt fragments — it produced 3 of 4, requiring a small addition during validation.
