// Map line for one simulated route (S1). Route ORDER and DISTANCE come from the pipeline and
// are never changed here: this only chooses how to draw the line between the same stops.
import type { Results } from "../types";
import { decodePolyline } from "./polyline";

export type RouteDrawing = { coords: [number, number][]; approximate: boolean; reason: string | null };

const valid = ([lat, lon]: [number, number]) =>
  Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;

/** Street geometry when the pipeline provided a valid one; otherwise straight segments, flagged approximate. */
export function routeDrawing(
  stopIds: string[], at: Map<string, [number, number]>, depot: [number, number],
  geo: Results["route_geometry"],
): RouteDrawing {
  const stops = stopIds.map((id) => at.get(id));
  if (stops.some((s) => !s)) throw new Error(`route references unknown stops: ${stopIds.filter((id) => !at.has(id)).join(", ")}`);
  const straight = [depot, ...(stops as [number, number][]), depot];
  const fallback = (reason: string): RouteDrawing => ({ coords: straight, approximate: true, reason });

  if (!geo) return fallback("road geometry was not computed for these results");
  const key = geo.route_keys[stopIds.join("|")];
  const g = key ? geo.geometries[key] : undefined;
  if (!g) return fallback("no road geometry for this route");
  if (g.status !== "road") return fallback(g.reason);
  try {
    const path = decodePolyline(g.polyline6);
    if (path.length < 2 || !path.every(valid)) return fallback("invalid road geometry");
    return { coords: path, approximate: false, reason: null };
  } catch {
    return fallback("invalid road geometry");
  }
}
