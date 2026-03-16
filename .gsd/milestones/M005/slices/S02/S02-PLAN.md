# S02: Karpathy Auto-Research Analysis

**Goal:** Structured research artifact analyzing Karpathy's autoresearch approach — architecture, prompt patterns, what to adopt, what to avoid — ready for S04 prompt design consumption.
**Demo:** `S02-RESEARCH.md` exists with architecture analysis, adopt/avoid tables, prompt fragments for all four agent phases, and cited sources. S04's planner can read this file and extract concrete prompt patterns without further research.

## Must-Haves

- Architecture analysis of Karpathy's three-file design (prepare.py, train.py, program.md)
- Adopt table: patterns NightShift should take from autoresearch (simplicity criterion, NEVER STOP, output suppression, git experiment state)
- Avoid table: anti-patterns NightShift should reject (no research phase, flat loop, single agent, no feedback)
- Prompt fragments for S04: concrete text for research-hypothesis.md, verify-experiment.md, execute-experiment.md, and plan-experiment.md
- Sources cited with URLs for all primary material analyzed
- Recommendations section connecting analysis to NightShift's 4-agent architecture

## Verification

- `grep -c "## " .gsd/milestones/M005/slices/S02/S02-RESEARCH.md` returns ≥8 sections
- `grep -l "What NightShift Should ADOPT" .gsd/milestones/M005/slices/S02/S02-RESEARCH.md` finds the adopt analysis
- `grep -l "What NightShift Should AVOID" .gsd/milestones/M005/slices/S02/S02-RESEARCH.md` finds the avoid analysis
- `grep -l "Prompt Fragments for S04" .gsd/milestones/M005/slices/S02/S02-RESEARCH.md` finds the prompt patterns
- `grep -c "source:" .gsd/milestones/M005/slices/S02/S02-RESEARCH.md` returns ≥3 cited sources
- R043 validation updated in REQUIREMENTS.md

## Observability / Diagnostics

- **Research artifact completeness:** `grep -c "## " S02-RESEARCH.md` returns section count; ≥8 means all major sections present.
- **S02→S04 boundary contract:** `grep -q "plan-experiment.md" S02-RESEARCH.md` confirms all four prompt type references exist (research-hypothesis, plan-experiment, execute-experiment, verify-experiment).
- **Source citation depth:** `grep -c "source:" S02-RESEARCH.md` returns ≥3 confirms primary sources are cited.
- **Failure state:** If R043 validation remains "unmapped" in REQUIREMENTS.md, the research artifact was not validated — check grep results above for which sections are missing.
- **Diagnostic check for missing content:** `grep -q "What NightShift Should ADOPT" S02-RESEARCH.md && grep -q "What NightShift Should AVOID" S02-RESEARCH.md && echo COMPLETE || echo INCOMPLETE` — verifies both adopt/avoid analyses exist.

## Verification (failure-path check)

- If `grep "R043" .gsd/REQUIREMENTS.md | grep -q "unmapped"` returns true, validation was NOT completed — the research artifact needs review against must-haves before R043 can transition to "validated."

## Tasks

- [x] **T01: Validate research artifact and finalize S02** `est:15m`
  - Why: The research artifact was produced during the research phase. This task validates completeness against R043 and the S02→S04 boundary contract, then marks the slice done.
  - Files: `.gsd/milestones/M005/slices/S02/S02-RESEARCH.md`, `.gsd/REQUIREMENTS.md`
  - Do: (1) Verify S02-RESEARCH.md contains all must-have sections: architecture, adopt/avoid tables, prompt fragments for all 4 agent phases, sources. (2) Verify the S02→S04 boundary: prompt fragments exist for research-hypothesis.md, verify-experiment.md, execute-experiment.md, plan-experiment.md. (3) Update R043 validation in REQUIREMENTS.md. (4) Run slice verification checks.
  - Verify: All grep checks from Verification section pass. R043 status is "validated" in REQUIREMENTS.md.
  - Done when: S02-RESEARCH.md passes all completeness checks and R043 is validated.

## Files Likely Touched

- `.gsd/milestones/M005/slices/S02/S02-RESEARCH.md` (read-only validation)
- `.gsd/REQUIREMENTS.md`
