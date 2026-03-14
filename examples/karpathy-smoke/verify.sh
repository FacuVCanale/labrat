#!/usr/bin/env bash
#
# Verify the Karpathy smoke test eval pipeline.
# Runs eval.py, checks that stdout is valid JSON with expected keys
# and finite numeric values. Exits 0 on PASS, 1 on FAIL.
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "=== Karpathy smoke test verification ==="
echo ""

# Run eval.py and capture stdout separately from stderr
echo "Running eval.py..."
EVAL_OUTPUT=$(python3 "$SCRIPT_DIR/eval.py" 2>/dev/null) || {
    echo "FAIL: eval.py exited with non-zero status"
    exit 1
}

echo "Raw output: $EVAL_OUTPUT"
echo ""

# Check that output is valid JSON
if ! echo "$EVAL_OUTPUT" | python3 -c "import json, sys; json.load(sys.stdin)" 2>/dev/null; then
    echo "FAIL: eval.py output is not valid JSON"
    exit 1
fi
echo "✓ Valid JSON"

# Check for required keys and numeric values
python3 -c "
import json, sys, math

data = json.loads('''$EVAL_OUTPUT''')

# Check required keys
for key in ['val_bpb', 'train_loss']:
    if key not in data:
        print(f'FAIL: missing key \"{key}\"')
        sys.exit(1)
    val = data[key]
    if not isinstance(val, (int, float)):
        print(f'FAIL: \"{key}\" is not a number (got {type(val).__name__})')
        sys.exit(1)
    if math.isnan(val) or math.isinf(val):
        print(f'FAIL: \"{key}\" is not finite ({val})')
        sys.exit(1)
    print(f'✓ {key} = {val} (finite number)')
" || exit 1

# Determinism check: run again and compare
echo ""
echo "Checking determinism..."
EVAL_OUTPUT_2=$(python3 "$SCRIPT_DIR/eval.py" 2>/dev/null)
if [ "$EVAL_OUTPUT" = "$EVAL_OUTPUT_2" ]; then
    echo "✓ Deterministic (two runs produced identical output)"
else
    echo "FAIL: non-deterministic output"
    echo "  Run 1: $EVAL_OUTPUT"
    echo "  Run 2: $EVAL_OUTPUT_2"
    exit 1
fi

echo ""
echo "=== PASS ==="
exit 0
