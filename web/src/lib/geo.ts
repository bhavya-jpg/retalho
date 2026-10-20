// Tiny projection helpers for the static SVG views (hero, city section). Real coordinates in,
// SVG coordinates out; no tiles, no network. Equirectangular with a cos(latitude) correction,
// which is accurate enough at municipal scale.
export type LonLat = [number, number];
export type Bounds = { minLon: number; minLat: number; maxLon: number; maxLat: number };

export function boundsOf(points: LonLat[]): Bounds {
  if (!points.length) throw new Error("no points");
  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
  for (const [lon, lat] of points) {
    minLon = Math.min(minLon, lon); maxLon = Math.max(maxLon, lon);
    minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
  }
  return { minLon, minLat, maxLon, maxLat };
}

/** Fit `b` into a width x height box (with padding), preserving the aspect ratio, centred. */
export function makeProjection(b: Bounds, width: number, height: number, pad = 0) {
  const k = Math.cos((((b.minLat + b.maxLat) / 2) * Math.PI) / 180);
  const spanX = Math.max((b.maxLon - b.minLon) * k, 1e-9);
  const spanY = Math.max(b.maxLat - b.minLat, 1e-9);
  const scale = Math.min((width - 2 * pad) / spanX, (height - 2 * pad) / spanY);
  const ox = (width - spanX * scale) / 2;
  const oy = (height - spanY * scale) / 2;
  return ([lon, lat]: LonLat): [number, number] => [
    ox + (lon - b.minLon) * k * scale,
    oy + (b.maxLat - lat) * scale,
  ];
}

/** Outer rings of every polygon in a GeoJSON FeatureCollection. */
export function outerRings(fc: GeoJSON.FeatureCollection): LonLat[][] {
  const rings: LonLat[][] = [];
  for (const f of fc.features) {
    const g = f.geometry;
    if (g?.type === "Polygon") rings.push(g.coordinates[0] as LonLat[]);
    else if (g?.type === "MultiPolygon") for (const p of g.coordinates) rings.push(p[0] as LonLat[]);
  }
  return rings;
}

/** Keep at most `max` points, evenly spaced, always keeping the first and last. */
export function thin<T>(pts: T[], max: number): T[] {
  if (pts.length <= max) return pts;
  const step = (pts.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => pts[Math.round(i * step)]);
}

export const pathD = (xy: [number, number][], close = false) =>
  xy.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join("") + (close ? "Z" : "");
