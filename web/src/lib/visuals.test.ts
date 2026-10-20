import { describe, expect, it } from "vitest";
import type { SeedRun } from "../types";
import { boundsOf, makeProjection, outerRings, pathD, thin } from "./geo";
import { collectionWeave, sharedOrder } from "./weave";

describe("geo", () => {
  it("fits bounds into the box, north up, aspect preserved", () => {
    const b = boundsOf([[-8.4, 41.3], [-8.2, 41.5]]);
    const p = makeProjection(b, 200, 200, 10);
    const [x0, y0] = p([-8.4, 41.5]);   // north-west corner
    const [x1, y1] = p([-8.2, 41.3]);   // south-east corner
    expect(y0).toBeCloseTo(10);         // north at the top
    expect(y1).toBeCloseTo(190);
    expect(x1 - x0).toBeLessThan(y1 - y0); // 0.2 deg of longitude is narrower than 0.2 deg of latitude here
  });
  it("reads outer rings from Polygon and MultiPolygon", () => {
    const sq = [[0, 0], [1, 0], [1, 1], [0, 0]];
    const fc = { type: "FeatureCollection", features: [
      { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [sq] } },
      { type: "Feature", properties: {}, geometry: { type: "MultiPolygon", coordinates: [[sq], [sq]] } },
    ] } as GeoJSON.FeatureCollection;
    expect(outerRings(fc)).toHaveLength(3);
  });
  it("thins evenly and keeps the endpoints", () => {
    const t = thin(Array.from({ length: 101 }, (_, i) => i), 11);
    expect(t).toEqual([0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
    expect(thin([1, 2], 5)).toEqual([1, 2]);
  });
  it("builds SVG path data", () => {
    expect(pathD([[0, 0], [1.25, 2]], true)).toBe("M0.0 0.0L1.3 2.0Z");
  });
});

const run = (weeks: string[][][]): SeedRun => ({
  seed: 1, inputs: "x", totals: {} as SeedRun["totals"],
  weeks: weeks.map((routes, i) => ({ week: i + 1, stops: 0, km: 0, travel_h: 0, service_h: 0, crew_h: 0, kg: 0,
    truck_days: routes.length, overflow_container_days: 0,
    routes: routes.map((stop_ids, t) => ({ truck: t + 1, stop_ids, km: 0, travel_h: 0, kg: 0 })) })),
});

describe("collectionWeave", () => {
  it("marks each container-week that was collected", () => {
    const w = collectionWeave(run([[["C1", "C2"]], [["C2"]], [], [["C1"], ["C3"]]]), ["C1", "C2", "C3"]);
    expect(w.cells).toEqual([[true, false, false, true], [true, true, false, false], [false, false, false, true]]);
    expect(w.collections).toBe(5);
    expect(w.weeks).toEqual([1, 2, 3, 4]);
  });
  it("refuses stops that are not in the network", () => {
    expect(() => collectionWeave(run([[["C9"]]]), ["C1"])).toThrow(/outside the network: C9/);
  });
  it("orders rows by collections, then id", () => {
    const w = collectionWeave(run([[["C2", "C3"]], [["C3"]]]), ["C1", "C2", "C3"]);
    expect(sharedOrder(w)).toEqual(["C3", "C2", "C1"]);
  });
});
