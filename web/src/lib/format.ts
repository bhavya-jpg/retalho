import type { Range } from "../types";
import { getLocale, t } from "./i18n";

const cache = new Map<string, Intl.NumberFormat>();
const nf = (digits: number, currency = false) => {
  const key = `${getLocale()}|${digits}|${currency}`;
  let f = cache.get(key);
  if (!f) {
    f = new Intl.NumberFormat(getLocale(), { maximumFractionDigits: digits, minimumFractionDigits: digits,
      ...(currency ? { style: "currency", currency: "EUR" } : {}) });
    cache.set(key, f);
  }
  return f;
};

export const fmt = (x: number, digits = 0) => nf(digits).format(x);
export const eur = (x: number, digits = 0) => nf(digits, true).format(x);
export const pct = (share: number, digits = 1) => `${fmt(share * 100, digits)}%`;
export const signedPct = (x: number, digits = 1) => `${x > 0 ? "+" : x < 0 ? "−" : ""}${fmt(Math.abs(x), digits)}%`;
export const fmtDate = (iso: string) => new Date(iso).toLocaleString(getLocale());

/** "430 (430–431)" style: median with the min–max range across seeds. */
export function fmtRange(r: Range | null, f: (x: number) => string = (x) => fmt(x)): { median: string; range: string } {
  if (!r) return { median: t("common.na"), range: "" };
  return { median: f(r.median), range: r.min === r.max ? t("common.sameEveryRun") : t("common.range", { min: f(r.min), max: f(r.max) }) };
}

export const humanKey = (key: string) =>
  key.replace(/_/g, " ").replace(/\bkm\b/, "km").replace(/^./, (c) => c.toUpperCase());
