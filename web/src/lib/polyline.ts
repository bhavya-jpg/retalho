/** Decode a Google encoded polyline (OSRM `polyline6` uses precision 6). Throws on malformed input. */
export function decodePolyline(encoded: string, precision = 6): [number, number][] {
  if (typeof encoded !== "string" || !encoded) throw new Error("empty polyline");
  const factor = 10 ** precision;
  const out: [number, number][] = [];
  let index = 0, lat = 0, lon = 0;
  while (index < encoded.length) {
    for (let which = 0; which < 2; which++) {
      let shift = 0, result = 0, b: number;
      do {
        if (index >= encoded.length) throw new Error("truncated polyline");
        b = encoded.charCodeAt(index++) - 63;
        if (b < 0 || b > 63) throw new Error("invalid polyline character");
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      const delta = result & 1 ? ~(result >> 1) : result >> 1;
      if (which === 0) lat += delta; else lon += delta;
    }
    out.push([lat / factor, lon / factor]);
  }
  return out;
}
