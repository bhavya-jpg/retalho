import type { ReactNode } from "react";
import { Badge, type BadgeKind } from "./Badge";

/** Stat tile: label · value (median) · range across seeds · source badges. */
export function StatTile({ label, value, sub, badges = [], swatch }: {
  label: string; value: ReactNode; sub?: ReactNode; badges?: BadgeKind[]; swatch?: string;
}) {
  return (
    <div data-stat={label} className="flex min-w-0 flex-col gap-1 rounded-lg border border-line bg-surface p-4">
      <div className="flex items-start gap-2 text-sm text-ink-2">
        {swatch && <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: swatch }} aria-hidden />}
        <span>{label}</span>
      </div>
      <div data-value className="text-2xl font-semibold text-ink">{value}</div>
      {sub && <div className="text-xs text-muted">{sub}</div>}
      {badges.length > 0 && <div className="mt-1 flex flex-wrap gap-1">{badges.map((b) => <Badge key={b} kind={b} />)}</div>}
    </div>
  );
}

export function Card({ title, subtitle, children, actions }: {
  title: string; subtitle?: ReactNode; children: ReactNode; actions?: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-line bg-surface p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold text-ink">{title}</h3>
          {subtitle && <p className="mt-0.5 text-sm text-ink-2">{subtitle}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function Segmented<T extends string | number>({ value, options, onChange, label }: {
  value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-md border border-line bg-surface p-0.5">
      {options.map((o) => (
        <button
          key={String(o.value)}
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={`rounded px-3 py-1 text-sm ${
            o.value === value ? "bg-surface-2 font-medium text-ink" : "text-ink-2 hover:text-ink"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-md border border-dashed border-line p-6 text-center text-sm text-ink-2">{children}</div>;
}
