---
estimated_steps: 4
estimated_files: 2
---

# T01: Validate research artifact and finalize S02

**Slice:** S02 — Karpathy Auto-Research Analysis
**Milestone:** M005

## Description

S02 is a research-only slice. The research phase produced a comprehensive `S02-RESEARCH.md` analyzing Karpathy's autoresearch system. This task validates the artifact is complete per R043 and the S02→S04 boundary contract (S04 needs prompt fragments and adopt/avoid analysis), then updates requirement tracking.

## Steps

1. Verify S02-RESEARCH.md contains all required sections: architecture analysis, experiment loop, key design principles, adopt table, avoid table, prompt fragments for S04, recommendations, sources.
2. Verify the S02→S04 boundary contract: prompt fragment text exists for each of the four new prompt types (research-hypothesis.md, verify-experiment.md, execute-experiment.md, plan-experiment.md).
3. Update R043 in `.gsd/REQUIREMENTS.md` — change status from "active" to "validated", fill in validation evidence.
4. Run all slice verification grep checks to confirm.

## Must-Haves

- [ ] Architecture analysis covers Karpathy's three-file design
- [ ] Adopt table with ≥5 patterns to adopt
- [ ] Avoid table with ≥5 anti-patterns to reject
- [ ] Prompt fragments for all 4 agent phases (research, plan, execute, verify)
- [ ] Sources section with ≥3 cited primary sources
- [ ] R043 validation updated in REQUIREMENTS.md

## Verification

- `grep -c "## " .gsd/milestones/M005/slices/S02/S02-RESEARCH.md` ≥ 8
- `grep -q "What NightShift Should ADOPT" .gsd/milestones/M005/slices/S02/S02-RESEARCH.md && echo PASS`
- `grep -q "What NightShift Should AVOID" .gsd/milestones/M005/slices/S02/S02-RESEARCH.md && echo PASS`
- `grep -q "Prompt Fragments for S04" .gsd/milestones/M005/slices/S02/S02-RESEARCH.md && echo PASS`
- `grep -q "research-hypothesis.md" .gsd/milestones/M005/slices/S02/S02-RESEARCH.md && echo PASS`
- `grep -q "verify-experiment.md" .gsd/milestones/M005/slices/S02/S02-RESEARCH.md && echo PASS`
- `grep -q "execute-experiment.md" .gsd/milestones/M005/slices/S02/S02-RESEARCH.md && echo PASS`
- `grep -c "source:" .gsd/milestones/M005/slices/S02/S02-RESEARCH.md` ≥ 3
- `grep "R043" .gsd/REQUIREMENTS.md | grep -q "validated"`

## Inputs

- `.gsd/milestones/M005/slices/S02/S02-RESEARCH.md` — research artifact from the research phase
- `.gsd/REQUIREMENTS.md` — requirement tracking file to update

## Expected Output

- R043 validated in `.gsd/REQUIREMENTS.md` with concrete evidence string
- All verification checks passing

## Observability Impact

- **R043 status transition:** REQUIREMENTS.md changes R043 from `Status: active` / `Validation: unmapped` to `Status: validated` with concrete evidence string. Future agents can `grep "R043" .gsd/REQUIREMENTS.md | grep "validated"` to confirm.
- **Research artifact completeness:** No new runtime signals — this task validates a static artifact. The artifact itself is the inspectable surface (`S02-RESEARCH.md`).
- **Failure visibility:** If validation fails, R043 remains "active/unmapped" — the absence of the "validated" status is the failure signal.
