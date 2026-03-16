---
estimated_steps: 4
estimated_files: 1
---

# T02: Validate R049 and run full hypothesis test suite

**Slice:** S06 — End-to-End Integration
**Milestone:** M005

## Description

Run all five hypothesis test files together to confirm the integration test doesn't break existing assertions (260+). Verify clean compilation. Update R049 from `active` to `validated` in REQUIREMENTS.md with concrete evidence from the integration test.

## Steps

1. Run all five hypothesis test files: hypothesis-state (43), hypothesis-dispatch (49), hypothesis-prompt (69), nightshift-interview (99), hypothesis-integration (≥30). Confirm all pass.

2. Run `npx tsc --noEmit` to confirm clean TypeScript compilation with the new test file and startAuto fix.

3. Update R049 in REQUIREMENTS.md: change status from `active` to `validated`. Add validation evidence citing the integration test file, assertion count, and what was proven (scaffold roundtrip, builder parity, state cycling, eval execution, JSONL sync, naming compliance). Update the traceability table status. Update coverage counts (active: 0, validated: 38).

4. Verify R049 shows `validated` and no active requirements remain unmapped.

## Must-Haves

- [ ] All 5 hypothesis test files pass (260+ existing + ≥30 new)
- [ ] TypeScript compilation clean
- [ ] R049 validated in REQUIREMENTS.md with evidence
- [ ] Coverage counts updated (0 active, 38 validated)

## Verification

- `npx tsc --noEmit` — clean
- All 5 test files pass with 0 failures
- `grep "R049" .gsd/REQUIREMENTS.md | grep "validated"` — confirms status

## Inputs

- `src/resources/extensions/gsd/tests/hypothesis-integration.test.ts` — T01's integration test (must pass)
- `.gsd/REQUIREMENTS.md` — current R049 status is `active`

## Observability Impact

- **Signals changed:** R049 status transitions from `active` to `validated` in REQUIREMENTS.md; coverage counts update to 0 active / 38 validated.
- **Inspection surface:** `grep "R049" .gsd/REQUIREMENTS.md | grep "validated"` confirms the status. `grep "active:" .gsd/REQUIREMENTS.md` confirms no remaining active requirements.
- **Failure visibility:** If any of the 5 test files regress, the assertion name and message identify the exact failure. If compilation fails, `tsc --noEmit` output names the offending file and line.

## Expected Output

- `.gsd/REQUIREMENTS.md` — R049 updated to validated with evidence, traceability and counts updated
