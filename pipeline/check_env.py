"""Print the toolchain versions Retalho depends on (PLAN.md M0). Exits 1 if a required piece is missing."""

from __future__ import annotations

import importlib.metadata as md
import platform
import shutil
import subprocess
import sys

REQUIRED_PY = ["pyvroom", "spopt", "pulp", "numpy", "shapely", "pyyaml"]


def _cmd_version(cmd: list[str]) -> str | None:
    if shutil.which(cmd[0]) is None:
        return None
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=10).stdout.strip().splitlines()[0]
    except (subprocess.SubprocessError, IndexError):
        return None


def main() -> int:
    ok = True
    print(f"python   {platform.python_version()} ({platform.system()} {platform.machine()})")
    for pkg in REQUIRED_PY:
        try:
            print(f"{pkg:<8} {md.version(pkg)}")
        except md.PackageNotFoundError:
            print(f"{pkg:<8} MISSING")
            ok = False

    # Prove the native solvers actually load and run, not just that the packages are installed.
    try:
        import vroom

        p = vroom.Input()
        p.set_durations_matrix("car", [[0, 5], [5, 0]])
        p.add_vehicle(vroom.Vehicle(0, start=0, end=0))
        p.add_job(vroom.Job(1, location=1))
        sol = p.solve(exploration_level=1, nb_threads=1)
        print(f"vroom    solve OK (cost {sol.summary.cost}, unassigned {len(sol.unassigned)})")
    except Exception as e:  # report any import/solve failure
        print(f"vroom    FAILED: {e}")
        ok = False
    try:
        import pulp

        cbc = pulp.PULP_CBC_CMD(msg=False).available()
        print(f"cbc      {'available' if cbc else 'NOT AVAILABLE'} (MILP solver used by spopt)")
        ok = ok and bool(cbc)
    except Exception as e:
        print(f"cbc      FAILED: {e}")
        ok = False

    # Node and Docker are optional here: the pipeline Docker image has no Node,
    # and Docker is only needed for OSRM.
    print(f"node     {_cmd_version(['node', '--version']) or 'not found (needed on the frontend machine only)'}")
    print(f"docker   {_cmd_version(['docker', '--version']) or 'not found (needed for OSRM only)'}")

    print("check-env:", "OK" if ok else "FAILED")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
