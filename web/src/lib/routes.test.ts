import { describe, expect, it } from "vitest";
import type { Results } from "../types";
import { decodePolyline } from "./polyline";
import { routeDrawing } from "./routes";

const at = new Map<string, [number, number]>([["C1", [41.4425, -8.2918]], ["C2", [41.45, -8.3]]]);
const depot: [number, number] = [41.421, -8.315];
// "_p~iF~ps|U_ulLnnqC_mqNvxq`@" is Google's reference example at precision 5.
const ref = "_p~iF~ps|U_ulLnnqC_mqNvxq`@";

const geo = (g: object): Results["route_geometry"] => ({
  route_keys: { "C1|C2": "k1" }, geometries: { k1: g as never }, stats: { road: 1, straight: 0 }, data_version: "t",
});

describe("decodePolyline", () => {
  it("matches the reference example", () => {
    expect(decodePolyline(ref, 5)).toEqual([[38.5, -120.2], [40.7, -120.95], [43.252, -126.453]]);
  });
  it.each(["", "_p~iF~ps|U_", "\x10\x10"])("rejects malformed input %j", (bad) => {
    expect(() => decodePolyline(bad)).toThrow();
  });
});

describe("routeDrawing", () => {
  it("uses valid street geometry", () => {
    const d = routeDrawing(["C1", "C2"], at, depot, geo({ status: "road", polyline6: ref, osrm_distance_m: 10 }));
    expect(d.approximate).toBe(false);
    expect(d.coords).toEqual(decodePolyline(ref));
  });
  it("falls back to straight segments in stop order when geometry is missing", () => {
    const d = routeDrawing(["C1", "C2"], at, depot, null);
    expect(d).toEqual({ coords: [depot, at.get("C1"), at.get("C2"), depot], approximate: true,
                        reason: "road geometry was not computed for these results" });
  });
  it("falls back when the pipeline itself fell back, keeping its reason", () => {
    const d = routeDrawing(["C1", "C2"], at, depot, geo({ status: "straight", reason: "routing service unavailable", coords: [] }));
    expect(d.approximate).toBe(true);
    expect(d.reason).toBe("routing service unavailable");
  });
  it("falls back on an invalid polyline or out-of-range points", () => {
    expect(routeDrawing(["C1", "C2"], at, depot, geo({ status: "road", polyline6: "!!", osrm_distance_m: 1 })).approximate).toBe(true);
    // two points, the first at latitude 95 (out of range); generated with pipeline.matrix.encode_polyline
    const outOfRange = "_{ietD?~v{~eB~~ggN";
    expect(routeDrawing(["C1", "C2"], at, depot, geo({ status: "road", polyline6: outOfRange, osrm_distance_m: 1 })).approximate).toBe(true);
  });
  it("falls back when this stop sequence has no geometry", () => {
    expect(routeDrawing(["C2", "C1"], at, depot, geo({ status: "road", polyline6: ref, osrm_distance_m: 1 })).reason)
      .toBe("no road geometry for this route");
  });
  it("throws on unknown stops instead of drawing a wrong line", () => {
    expect(() => routeDrawing(["C1", "ZZ"], at, depot, null)).toThrow(/unknown stops: ZZ/);
  });
});
