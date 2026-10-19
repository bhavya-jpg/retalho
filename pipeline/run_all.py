"""End-to-end pipeline: data/clean -> matrix -> simulation -> costs + break-even -> coverage -> results.json.

Run `make data SOURCE=...` first (or `make all`, which does both). Stops at the first failing step.

Usage:
    python -m pipeline.run_all [--provider auto|osrm|approx]
"""

from __future__ import annotations

import argparse
import sys
import time

from pipeline import cost, coverage, export, matrix, simulate


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--provider", choices=["auto", "osrm", "approx"], default="auto")
    args = ap.parse_args(argv)

    steps = [
        ("distance matrix", matrix.main, ["--provider", args.provider]),
        ("coverage (MCLP)", coverage.main, []),  # before the simulation: it may collect proposed sites too
        ("four-week simulation (A vs B)", simulate.main, ["--provider", args.provider]),
        ("costs and break-even sweep", cost.main, ["--provider", args.provider]),
        ("export results.json", export.main, []),
    ]
    t_all = time.perf_counter()
    for i, (name, fn, fn_args) in enumerate(steps, start=1):
        print(f"\n=== [{i}/{len(steps)}] {name}", flush=True)
        t0 = time.perf_counter()
        rc = fn(fn_args)
        if rc != 0:
            print(f"\nFAILED at step {i} ({name}).", file=sys.stderr)
            return rc
        print(f"--- {name}: {time.perf_counter() - t0:.1f} s")
    print(f"\nPipeline complete in {time.perf_counter() - t_all:.0f} s.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
