// Source labels from PLAN.md §8. Every number in the UI carries one.
export type BadgeKind =
  | "measured" | "simulated" | "benchmark" | "assumption"
  | "synthetic" | "public" | "sponsor" | "approx" | "straight-line";

const LABELS: Record<BadgeKind, { text: string; title: string; warn?: boolean }> = {
  measured: { text: "Measured", title: "Computed directly from real data, with no model assumptions" },
  simulated: { text: "Simulated", title: "Model output under the listed assumptions; shown as a range across seeds" },
  benchmark: { text: "Benchmark", title: "Published external result; not produced by Retalho" },
  assumption: { text: "Assumption", title: "An input we chose; replace with a confirmed value" },
  synthetic: { text: "Synthetic data", title: "Generated data, not VITRUS or public data", warn: true },
  public: { text: "Public", title: "From public data (e.g. OpenStreetMap)" },
  sponsor: { text: "Sponsor", title: "Provided by VITRUS" },
  approx: { text: "Approx. distances", title: "Straight line x detour factor, not road distance", warn: true },
  "straight-line": { text: "Straight-line", title: "Distance measured as the crow flies, not along streets" },
};

export function Badge({ kind }: { kind: BadgeKind }) {
  const b = LABELS[kind];
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
