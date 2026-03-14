---
estimated_steps: 4
estimated_files: 5
---

# T03: Karpathy smoke test harness

**Slice:** S07 — CLI, Morning Report & Smoke Test
**Milestone:** M001

## Description

Create the `examples/karpathy-smoke/` directory with a trivially fast "Karpathy train.py" scenario that validates the full experiment loop without requiring actual ML training or an LLM. The eval script produces deterministic metrics based on the content of `train.py`, so different code modifications yield different metric values. This is the UAT artifact — the manual end-to-end test runs `labrat start` with a real LLM and verifies the loop completes.

The harness must be self-contained: `eval.py` runs `train.py`, computes metrics, and outputs JSON to stdout in the format `parseMetrics()` expects. A `verify.sh` script validates the eval pipeline works without any LLM.

## Steps

1. Create `examples/karpathy-smoke/train.py`:
   - A trivially fast Python script (~50 lines) that simulates a training run
   - Contains a `compute_loss()` function that returns a deterministic "val_bpb" value
   - The val_bpb is derived from the content of the file itself (e.g., hash of specific code sections, length of certain functions, presence of optimization patterns)
   - The script prints training-like output to stderr (epoch progress, loss values) to simulate realistic eval noise
   - Completes in under 1 second
   - The key insight: when an LLM modifies this file, the val_bpb changes deterministically — some changes improve it, some don't

2. Create `examples/karpathy-smoke/eval.py`:
   - Runs `train.py` as a subprocess (or imports it directly)
   - Captures the val_bpb metric
   - Outputs a single JSON line to stdout: `{"val_bpb": <float>, "train_loss": <float>}`
   - Prints any diagnostic info to stderr (not stdout) so `parseMetrics()` only sees clean JSON
   - Exit code 0 on success, non-zero on failure

3. Create `examples/karpathy-smoke/verify.sh`:
   - Runs `eval.py` and captures stdout
   - Verifies the output is valid JSON with expected keys (`val_bpb`, `train_loss`)
   - Verifies the values are finite numbers
   - Prints PASS/FAIL result
   - Exit code 0 on pass, 1 on fail
   - Make executable: `chmod +x`

4. Create `examples/karpathy-smoke/README.md`:
   - Brief description of the smoke test
   - Quick-start one-liner: `labrat start --target examples/karpathy-smoke/train.py --eval 'python3 examples/karpathy-smoke/eval.py' --metric 'val_bpb:min:1.0' --max-experiments 5`
   - What to expect: 5 experiments, some kept, some discarded, a morning report at the end
   - Verification without LLM: `bash examples/karpathy-smoke/verify.sh`
   - Explains that the smoke test validates the loop machinery, not LLM research quality

## Must-Haves

- [ ] `eval.py` outputs valid JSON with `val_bpb` and `train_loss` keys to stdout
- [ ] `eval.py` output is parseable by `parseMetrics()` (tested via verify.sh)
- [ ] `train.py` completes in under 2 seconds
- [ ] Metrics are deterministic (same code → same metrics)
- [ ] `verify.sh` validates the eval pipeline and exits 0
- [ ] README includes the `labrat start` one-liner command

## Verification

- `python3 examples/karpathy-smoke/eval.py` — outputs JSON with val_bpb and train_loss
- `bash examples/karpathy-smoke/verify.sh` — exits 0 with PASS
- `python3 -c "import json; d=json.loads(open('/dev/stdin').read()); assert 'val_bpb' in d" < <(python3 examples/karpathy-smoke/eval.py)` — JSON parseable with expected key

## Observability Impact

- **New signals:** `eval.py` writes diagnostic messages to stderr (epoch progress, timing) and clean JSON metrics to stdout — agents can inspect stderr for eval health and stdout for metric values
- **Inspection:** Run `python3 examples/karpathy-smoke/eval.py` to see raw metrics output; run `bash examples/karpathy-smoke/verify.sh` to validate the full pipeline including JSON parsing
- **Failure visibility:** `eval.py` exits non-zero on failure with error message on stderr; `verify.sh` prints PASS/FAIL with specific failure reason (missing key, non-numeric value, invalid JSON)
- **Determinism check:** Running eval.py twice on unmodified train.py produces identical output — any drift indicates a bug in the hash-based metric computation

## Inputs

- `src/resources/extensions/gsd/eval-runner.ts` — `parseMetrics()` format specification (last JSON line in stdout)
- S07/T02 — `labrat start` command with `--target`, `--eval`, `--metric` flags for the README one-liner

## Expected Output

- `examples/karpathy-smoke/train.py` — trivially fast training script with deterministic metrics
- `examples/karpathy-smoke/eval.py` — eval wrapper that outputs JSON metrics to stdout
- `examples/karpathy-smoke/verify.sh` — pipeline validation script
- `examples/karpathy-smoke/README.md` — usage instructions with one-liner command
