"""Single-day collection routing with pyvroom (PLAN.md M3).

solve_day(matrix, stop_ids, kg_by_id, fleet) -> plan

Each vehicle is one truck for one day: it starts and ends at the depot, carries
at most `capacity_kg`, and must finish within `shift_h`. VROOM minimises the
operating cost from config/assumptions.yaml (per km, per crew-hour of driving,
and fixed per vehicle used), so the optimiser and the cost model agree.

Every stop must be served. If VROOM leaves any stop unassigned, solve_day raises
InfeasibleError naming each stop and the likely reason, unless allow_unassigned=True.
Route km and hours are recomputed from the matrix and cross-checked against VROOM.

Usage (demo on data/clean + the cached matrix):
    python -m pipeline.solve [--fill 0.6] [--vehicles 3]
"""

from __future__ import annotations

import argparse
import math
import os
import sys
import time
from dataclasses import dataclass

import vroom

from pipeline.load import DEFAULT_ASSUMPTIONS, DEFAULT_CLEAN, load_assumptions, load_clean
from pipeline.matrix import get_matrix, matrix_points


class InfeasibleError(Exception):
    """Some stops could not be served. ``unassigned`` maps stop id -> reason."""

    def __init__(self, unassigned: dict[str, str]):
        self.unassigned = unassigned
        lines = "\n".join(f"  - {sid}: {why}" for sid, why in unassigned.items())
        super().__init__(f"{len(unassigned)} stop(s) could not be served:\n{lines}")


@dataclass(frozen=True)
class Fleet:
    vehicles: int                      # truck-days available for this solve
    capacity_kg: float
    shift_h: float
    service_min_per_stop: float
    speed_factor: float = 1.0          # truck speed / OSRM car speed
    cost_per_km: float | None = None   # used only as VROOM's objective
    crew_cost_per_h: float | None = None
    fixed_cost_per_vehicle: float | None = None

    @classmethod
    def from_assumptions(cls, a: dict, vehicles: int | None = None) -> "Fleet":
        v = {k: e["value"] for k, e in a.items()}
        return cls(vehicles=int(vehicles if vehicles is not None else v["trucks"]),
                   capacity_kg=float(v["truck_capacity_kg"]), shift_h=float(v["shift_h"]),
                   service_min_per_stop=float(v["service_min_per_stop"]),
                   speed_factor=float(v["truck_speed_factor"]), cost_per_km=v["cost_per_km"],
                   crew_cost_per_h=v["crew_cost_per_h"], fixed_cost_per_vehicle=v["fixed_cost_per_truck_day"])

    def vroom_costs(self) -> vroom.VehicleCosts:
        """Costs in euro cents (VROOM needs integers). Falls back to pure travel time if unknown."""
        if self.cost_per_km is None or self.crew_cost_per_h is None:
            return vroom.VehicleCosts()
        return vroom.VehicleCosts(fixed=round((self.fixed_cost_per_vehicle or 0) * 100),
                                  per_hour=round(self.crew_cost_per_h * 100), per_km=round(self.cost_per_km * 100))


def _truck_seconds(m: dict, i: int, j: int, speed_factor: float) -> int:
    return round(m["durations_s"][i][j] / speed_factor)


def _diagnose(m: dict, depot: int, idx: int, kg: float, fleet: Fleet, total_kg: float) -> str:
    if kg > fleet.capacity_kg:
        return f"load {kg:.0f} kg exceeds truck capacity {fleet.capacity_kg:.0f} kg"
    round_trip = (_truck_seconds(m, depot, idx, fleet.speed_factor) + _truck_seconds(m, idx, depot, fleet.speed_factor)
                  + fleet.service_min_per_stop * 60)
    if round_trip > fleet.shift_h * 3600:
        return f"depot round trip alone takes {round_trip / 3600:.2f} h, longer than the {fleet.shift_h} h shift"
    fleet_kg = fleet.vehicles * fleet.capacity_kg
    if total_kg > fleet_kg:
        return (f"fleet capacity: {total_kg:.0f} kg to collect but {fleet.vehicles} vehicle(s) x "
                f"{fleet.capacity_kg:.0f} kg = {fleet_kg:.0f} kg")
    return f"fleet time: {fleet.vehicles} vehicle(s) x {fleet.shift_h} h shift is not enough to reach every stop"


def solve_day(m: dict, stop_ids: list[str], kg_by_id: dict[str, float], fleet: Fleet, *,
              depot_id: str | None = None, exploration_level: int | None = None, threads: int | None = None,
              allow_unassigned: bool = False) -> dict:
    """exploration_level defaults to 5 (most thorough) up to 100 stops and 3 above that:
    on 150 stops, level 3 was within 1.2% of level 5's distance at under half the time."""
    if exploration_level is None:
        exploration_level = 5 if len(stop_ids) <= 100 else 3
    if threads is None:
        threads = min(8, os.cpu_count() or 1)
    index = {pid: i for i, pid in enumerate(m["ids"])}
    if depot_id is None:
        depot_id = m["ids"][m["roles"].index("depot")]
    depot = index[depot_id]

    problems = []
    if len(set(stop_ids)) != len(stop_ids):
        problems.append("duplicate stop ids")
    missing = [s for s in stop_ids if s not in index]
    if missing:
        problems.append(f"stops not in the distance matrix: {missing[:10]}")
    if depot_id in stop_ids:
        problems.append("the depot cannot be a stop")
    bad_kg = [s for s in stop_ids if not (isinstance(kg_by_id.get(s), (int, float))
                                           and math.isfinite(kg_by_id[s]) and kg_by_id[s] >= 0)]
    if bad_kg:
        problems.append(f"missing or invalid kg for: {bad_kg[:10]}")
    if fleet.vehicles < 1 or fleet.capacity_kg <= 0 or fleet.shift_h <= 0 or fleet.speed_factor <= 0:
        problems.append(f"invalid fleet: {fleet}")
    if problems:
        raise ValueError("; ".join(problems))

    t0 = time.perf_counter()
    plan = {"provider": m["provider"], "routes": [], "unassigned": {}}
    if stop_ids:
        n = len(m["ids"])
        problem = vroom.Input()
        problem.set_durations_matrix("car", [[_truck_seconds(m, i, j, fleet.speed_factor) for j in range(n)]
                                             for i in range(n)])
        problem.set_distances_matrix("car", m["distances_m"])
        for v in range(fleet.vehicles):
            problem.add_vehicle(vroom.Vehicle(
                v + 1, start=depot, end=depot, capacity=[math.floor(fleet.capacity_kg)],
                time_window=vroom.TimeWindow(0, round(fleet.shift_h * 3600)), costs=fleet.vroom_costs()))
        service_s = round(fleet.service_min_per_stop * 60)
        job_of = {}
        for k, sid in enumerate(stop_ids, start=1):
            job_of[k] = sid
            # Round load up so VROOM never packs more than the truck carries.
            problem.add_job(vroom.Job(k, location=index[sid], default_service=service_s,
                                      pickup=[math.ceil(kg_by_id[sid])]))
        sol = problem.solve(exploration_level=exploration_level, nb_threads=threads)

        df = sol.routes
        for vid in sorted(df["vehicle_id"].unique()):
            steps = df[(df["vehicle_id"] == vid) & (df["type"] == "job")]
            stops = [job_of[int(j)] for j in steps["id"]]
            plan["routes"].append(_route_metrics(m, depot, stops, kg_by_id, fleet, truck=int(vid)))
        # On a symmetric matrix a route and its reverse cost exactly the same, and which direction VROOM
        # returns is another tie-break (also seen on CI). Keep the smaller direction, but only when both
        # directions have identical distance and travel time, so no metric changes.
        for i, r in enumerate(plan["routes"]):
            rev = r["stop_ids"][::-1]
            if rev < r["stop_ids"] and _seq_cost(m, depot, rev, fleet) == _seq_cost(m, depot, r["stop_ids"], fleet):
                plan["routes"][i] = _route_metrics(m, depot, rev, kg_by_id, fleet, truck=r["truck"])
        # The vehicles are identical, so which one VROOM gives each route is an arbitrary tie-break that
        # can differ between runs (seen on CI). Put the routes in a canonical order (by stop sequence)
        # and number them 1..n, so identical inputs always give identical output. No route, distance,
        # time or cost changes.
        plan["routes"].sort(key=lambda r: r["stop_ids"])
        for i, r in enumerate(plan["routes"], start=1):
            r["truck"] = i
        unassigned_ids = [job_of[int(u["id"])] for u in sol.to_dict().get("unassigned", [])]
        total_kg = sum(kg_by_id[s] for s in stop_ids)
        plan["unassigned"] = {sid: _diagnose(m, depot, index[sid], kg_by_id[sid], fleet, total_kg)
                              for sid in sorted(unassigned_ids)}

        km_check = sum(r["distance_m"] for r in plan["routes"])
        if km_check != int(sol.summary.distance):
            raise RuntimeError(f"route distance mismatch: matrix {km_check} m vs VROOM {sol.summary.distance} m")

    if plan["unassigned"] and not allow_unassigned:
        raise InfeasibleError(plan["unassigned"])

    for key in ("km", "travel_h", "service_h", "duration_h", "kg"):
        plan[key] = round(sum(r[key] for r in plan["routes"]), 3)
    plan["stops"] = sum(len(r["stop_ids"]) for r in plan["routes"])
    plan["vehicles_used"] = len(plan["routes"])
    plan["solve_s"] = round(time.perf_counter() - t0, 3)
    return plan


def _seq_cost(m: dict, depot: int, stops: list[str], fleet: Fleet) -> tuple[int, int]:
    """(distance m, truck travel s) of depot -> stops -> depot."""
    index = {pid: i for i, pid in enumerate(m["ids"])}
    seq = [depot] + [index[s] for s in stops] + [depot]
    return (sum(m["distances_m"][a][b] for a, b in zip(seq, seq[1:])),
            sum(_truck_seconds(m, a, b, fleet.speed_factor) for a, b in zip(seq, seq[1:])))


def _route_metrics(m: dict, depot: int, stops: list[str], kg_by_id: dict[str, float], fleet: Fleet,
                   truck: int) -> dict:
    index = {pid: i for i, pid in enumerate(m["ids"])}
    seq = [depot] + [index[s] for s in stops] + [depot]
    dist = sum(m["distances_m"][a][b] for a, b in zip(seq, seq[1:]))
    travel_s = sum(_truck_seconds(m, a, b, fleet.speed_factor) for a, b in zip(seq, seq[1:]))
    service_h = len(stops) * fleet.service_min_per_stop / 60
    return {
        "truck": truck, "stop_ids": stops, "distance_m": dist, "km": round(dist / 1000, 3),
        "travel_h": round(travel_s / 3600, 3), "service_h": round(service_h, 3),
        "duration_h": round(travel_s / 3600 + service_h, 3), "kg": round(sum(kg_by_id[s] for s in stops), 1),
    }


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Demo: route every container once, each filled to --fill.")
    ap.add_argument("--fill", type=float, default=0.6, help="fill level of every container (share of capacity)")
    ap.add_argument("--vehicles", type=int, default=None, help="truck-days available (default: trucks)")
    ap.add_argument("--provider", choices=["auto", "osrm", "approx"], default="auto")
    args = ap.parse_args(argv)

    a = load_assumptions(DEFAULT_ASSUMPTIONS)
    clean = load_clean(DEFAULT_CLEAN)
    m = get_matrix(matrix_points(clean), args.provider, detour_factor=a["detour_factor"]["value"],
                   speed_kmh=a["fallback_speed_kmh"]["value"])
    fleet = Fleet.from_assumptions(a, vehicles=args.vehicles)
    kg = {c["id"]: c["capacity_kg"] * args.fill for c in clean["containers"]}
    try:
        plan = solve_day(m, list(kg), kg, fleet)
    except InfeasibleError as e:
        print(f"INFEASIBLE with {fleet.vehicles} vehicle(s): {e}", file=sys.stderr)
        return 1

    print(f"Routed {plan['stops']} containers at {args.fill:.0%} fill with {plan['vehicles_used']} of "
          f"{fleet.vehicles} vehicle(s) in {plan['solve_s']} s  [distances: {m['provider']}; data: "
          f"{clean['manifest']['source']}]")
    for r in plan["routes"]:
        print(f"  truck {r['truck']}: {len(r['stop_ids'])} stops, {r['km']} km, {r['kg']:.0f} kg, "
              f"{r['travel_h']:.2f} h driving + {r['service_h']:.2f} h service = {r['duration_h']:.2f} h")
    print(f"  total: {plan['km']} km, {plan['travel_h']:.2f} h driving, {plan['service_h']:.2f} h service, "
          f"{plan['kg']:.0f} kg, unassigned: {len(plan['unassigned'])}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
