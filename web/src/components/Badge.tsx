// Source labels from PLAN.md §8. Every number in the UI carries one.
import { t, type Key } from "../lib/i18n";

export type BadgeKind =
  | "measured" | "simulated" | "benchmark" | "assumption"
  | "synthetic" | "public" | "sponsor" | "approx" | "straight-line";

const WARN: Partial<Record<BadgeKind, true>> = { synthetic: true, approx: true };

export function Badge({ kind }: { kind: BadgeKind }) {
  const b = { text: t(`badge.${kind}` as Key), title: t(`badge.${kind}.title` as Key), warn: WARN[kind] };
  return (
    <span
      title={b.title}
      className={`mono inline-flex cursor-help items-center rounded-[var(--r-xs)] border px-1.5 py-px text-[10.5px] font-medium uppercase leading-4 tracking-[0.06em] whitespace-nowrap ${
        b.warn ? "border-transparent bg-warn-bg text-warn-ink" : "border-line-strong text-ink-2"
      }`}
    >
      {b.text}
    </span>
  );
}

export const sourceBadge = (s: string): BadgeKind =>
  s === "sponsor" ? "sponsor" : s === "public" ? "public" : s === "synthetic" ? "synthetic" : "assumption";
