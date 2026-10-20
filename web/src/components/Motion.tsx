// Shared motion controls and effects. Everything here is static under reduced motion or when paused.
import type { ReactNode } from "react";
import { useCountUp, useMotion, useReveal } from "../lib/motion";
import { Swatch, type SwatchKind } from "./Textile";

/** Play / pause every animation on the page (WCAG 2.2.2). Defaults to the system's reduced-motion
 *  setting; the visitor's choice here overrides it and is remembered. */
export function MotionToggle({ className = "" }: { className?: string }) {
  const { live, reduced, pref, toggle } = useMotion();
  const paused = !live;
  return (
    <button type="button" onClick={toggle} aria-pressed={paused}
            title={paused && reduced && pref === "auto" ? "Animations are off because your system asks for reduced motion. Click to turn them on." : undefined}
            className={`inline-flex h-8 items-center gap-1.5 ${paused ? "border-accent text-accent-text" : ""} rounded-[var(--r-pill)] border border-line-strong bg-surface px-3 text-xs text-ink-2 transition-colors duration-[var(--dur-1)] hover:border-ink hover:text-ink ${className}`}>
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
        {paused ? <path d="M3 1.5v9l7-4.5z" fill="currentColor" /> : <path d="M3 1.5h2v9H3zM7 1.5h2v9H7z" fill="currentColor" />}
      </svg>
      {paused ? "Play animations" : "Pause animations"}
    </button>
  );
}

/** A number that counts up once when it scrolls into view. Screen readers get the final value. */
export function CountUp({ value, format, className = "" }: { value: number; format: (x: number) => string; className?: string }) {
  const { ref, inView } = useReveal<HTMLSpanElement>(0.4);
  const v = useCountUp(value, inView);
  return (
    <span ref={ref} className={className}>
      <span aria-hidden>{format(v)}</span>
      <span className="sr-only">{format(value)}</span>
    </span>
  );
}

/** Woven selvedge ribbon: product vocabulary and swatches drifting slowly. Decorative. */
export function Selvedge({ items }: { items: ReactNode[] }) {
  const kinds: SwatchKind[] = ["cotton", "denim", "linen", "knit", "recycled"];
  const row = (k: string) => (
    <div className="flex shrink-0 items-center gap-8 pr-8" key={k}>
      {items.map((it, i) => (
        <span key={i} className="flex items-center gap-8">
          <Swatch kind={kinds[i % kinds.length]} size={22} />
          <span className="font-display whitespace-nowrap text-[26px] leading-none text-ink">{it}</span>
        </span>
      ))}
    </div>
  );
  return (
    <div className="selvedge relative -mx-4 overflow-hidden border-y border-line bg-surface py-5 [mask-image:linear-gradient(90deg,transparent,black_7%,black_93%,transparent)]" aria-hidden>
      <div className="loop marquee flex w-max">{row("a")}{row("b")}</div>
    </div>
  );
}
