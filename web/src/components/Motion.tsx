// Shared motion effects.
import type { ReactNode } from "react";
import { useCountUp, useReveal } from "../lib/motion";
import { Swatch, type SwatchKind } from "./Textile";

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
