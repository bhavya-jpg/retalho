import type { ReactNode } from "react";
import { Badge, type BadgeKind } from "./Badge";

/** Stat tile: label · value (median) · range · source badges. Open layout under a stitched rule. */
export function StatTile({ label, value, sub, badges = [], swatch }: {
  label: string; value: ReactNode; sub?: ReactNode; badges?: BadgeKind[]; swatch?: string;
}) {
  return (
    <div data-stat={label} className="seam-top flex min-w-0 flex-col gap-1 pt-3">
      <div className="flex items-start gap-2 text-[13px] text-ink-2">
        {swatch && <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: swatch }} aria-hidden />}
        <span>{label}</span>
      </div>
      <div data-value className="text-[26px] font-semibold leading-tight text-ink">{value}</div>
      {sub && <div className="text-xs text-muted">{sub}</div>}
      {badges.length > 0 && <div className="mt-1 flex flex-wrap gap-1">{badges.map((b) => <Badge key={b} kind={b} />)}</div>}
    </div>
  );
}

export function Card({ title, subtitle, children, actions, eyebrow }: {
  title: string; subtitle?: ReactNode; children: ReactNode; actions?: ReactNode; eyebrow?: string;
}) {
  return (
    <section className="panel">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
        <div className="min-w-0">
          {eyebrow && <p className="eyebrow mb-1">{eyebrow}</p>}
          <h2 className="text-[16.5px] font-semibold text-ink">{title}</h2>
          {subtitle && <p className="mt-0.5 text-sm text-ink-2">{subtitle}</p>}
        </div>
        {actions}
      </div>
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}

export function Segmented<T extends string | number>({ value, options, onChange, label }: {
  value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-[var(--r-pill)] border border-line bg-surface-2 p-0.5">
      {options.map((o) => (
        <button
          key={String(o.value)}
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={`h-8 rounded-[var(--r-pill)] px-3 text-[13px] transition-colors duration-[var(--dur-1)] ${
            o.value === value ? "bg-ink font-medium text-page" : "text-ink-2 hover:text-ink"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="seam rounded-[var(--r-md)] p-6 text-center text-sm text-ink-2">{children}</div>;
}

/** Two thin bars on a shared scale, for a single comparison row. Decorative: the values are in the table text. */
export function PairBars({ a, b, colourA, colourB }: { a: number | null | undefined; b: number | null | undefined; colourA: string; colourB: string }) {
  const max = Math.max(a ?? 0, b ?? 0);
  if (!max || a == null || b == null) return <span className="text-xs text-muted">—</span>;
  const w = (x: number) => `${Math.max(2, (x / max) * 100)}%`;
  return (
    <div className="flex w-full min-w-[90px] flex-col gap-1" aria-hidden>
      <span className="block h-[5px] rounded-full" style={{ width: w(a), background: colourA, transition: "width var(--dur-2) var(--ease-out)" }} />
      <span className="block h-[5px] rounded-full" style={{ width: w(b), background: colourB, transition: "width var(--dur-2) var(--ease-out)" }} />
    </div>
  );
}
