import type { Range } from "../types";

/** Median as Python's statistics.median: mean of the two middle values for an even count. */
export function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** min / median / max of the non-null values, or null if there are none. */
export function range(values: (number | null)[]): Range | null {
  const v = values.filter((x): x is number => x !== null && Number.isFinite(x));
  if (!v.length) return null;
  return { min: Math.min(...v), median: median(v), max: Math.max(...v) };
}
