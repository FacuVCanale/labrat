#!/usr/bin/env python3
"""
Eval wrapper for the Karpathy smoke test.

Runs train.py, captures the deterministic metrics, and outputs a single
JSON line to stdout in the format parseMetrics() expects:
  {"val_bpb": <float>, "train_loss": <float>}

All diagnostic output goes to stderr. Exit 0 on success, 1 on failure.
"""
import json
import os
import subprocess
import sys


def main():
    # Resolve train.py relative to this script's directory
    script_dir = os.path.dirname(os.path.abspath(__file__))
    train_py = os.path.join(script_dir, "train.py")

    if not os.path.exists(train_py):
        print(f"ERROR: train.py not found at {train_py}", file=sys.stderr)
        sys.exit(1)

    print(f"Running eval: {train_py}", file=sys.stderr)

    try:
        result = subprocess.run(
            [sys.executable, train_py],
            capture_output=True,
            text=True,
            timeout=10,
        )
    except subprocess.TimeoutExpired:
        print("ERROR: train.py timed out (>10s)", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"ERROR: Failed to run train.py: {e}", file=sys.stderr)
        sys.exit(1)

    # Forward train.py's stderr (training progress) to our stderr
    if result.stderr:
        print(result.stderr, file=sys.stderr, end="")

    if result.returncode != 0:
        print(
            f"ERROR: train.py exited with code {result.returncode}",
            file=sys.stderr,
        )
        sys.exit(1)

    # Import train.py to get deterministic metrics directly
    # (more reliable than parsing stdout text)
    sys.path.insert(0, script_dir)
    try:
        import train  # noqa: E402

        val_bpb, train_loss = train.get_deterministic_metrics()
    except Exception as e:
        print(f"ERROR: Failed to import train.py: {e}", file=sys.stderr)
        sys.exit(1)

    metrics = {"val_bpb": val_bpb, "train_loss": train_loss}

    print(f"Metrics computed: {metrics}", file=sys.stderr)

    # Single JSON line to stdout — this is what parseMetrics() reads
    print(json.dumps(metrics))


if __name__ == "__main__":
    main()
