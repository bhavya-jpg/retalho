import type { Range } from "../types";

const nf = (digits: number) => new Intl.NumberFormat("en-GB", { maximumFractionDigits: digits, minimumFractionDigits: digits });

export const fmt = (x: number, digits = 0) => nf(digits).format(x);
export const eur = (x: number, digits = 0) => `€${fmt(x, digits)}`;
export const pct = (share: number, digits = 1) => `${fmt(share * 100, digits)}%`;
export const signedPct = (x: number, digits = 1) => `${x > 0 ? "+" : x < 0 ? "−" : ""}${fmt(Math.abs(x), digits)}%`;

/** "430 (430–431)" style: median with the min–max range across seeds. */
export function fmtRange(r: Range | null, f: (x: number) => string = (x) => fmt(x)): { median: string; range: string } {
  if (!r) return { median: "n/a", range: "" };
  return { median: f(r.median), range: r.min === r.max ? "same in every run" : `${f(r.min)} to ${f(r.max)}` };
}

export const humanKey = (key: string) =>
  key.replace(/_/g, " ").replace(/\bkm\b/, "km").replace(/^./, (c) => c.toUpperCase());
