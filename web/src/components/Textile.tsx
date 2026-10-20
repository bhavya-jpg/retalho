// Textile graphic language: swatches, thread rules and section headers. Original SVG, no assets.
import type { ReactNode } from "react";
import { t, type Key } from "../lib/i18n";
import { useReveal } from "../lib/motion";

export type SwatchKind = "cotton" | "linen" | "denim" | "knit" | "recycled";

/** Small square of cloth drawn in SVG. Decorative unless `labelled`. */
export function Swatch({ kind, size = 120, labelled = false, className = "" }: { kind: SwatchKind; size?: number; labelled?: boolean; className?: string }) {
  const id = `sw-${kind}-${size}`;
  return (
    <figure className="m-0">
      <svg width={size} height={size} viewBox="0 0 60 60" aria-hidden className={`block h-auto rounded-[var(--r-sm)] shadow-[var(--shadow-1)] ${className}`}>
        <defs>
          {kind === "cotton" && (
            <pattern id={id} width="4" height="4" patternUnits="userSpaceOnUse">
              <rect width="4" height="4" fill="#efe7d6" />
              <rect x="0" y="0" width="2" height="2" fill="#e2d6be" /><rect x="2" y="2" width="2" height="2" fill="#e2d6be" />
            </pattern>
          )}
          {kind === "linen" && (
            <pattern id={id} width="12" height="6" patternUnits="userSpaceOnUse">
              <rect width="12" height="6" fill="#ddd0b4" />
              <path d="M0 1.5h5M6.5 1.5h5.5M0 4.5h2.5M4 4.5h8" stroke="#c7b691" strokeWidth="1.1" />
              <path d="M2 0v6M8 0v6" stroke="#e8dec8" strokeWidth="0.6" />
            </pattern>
          )}
          {kind === "denim" && (
            <pattern id={id} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(-30)">
              <rect width="6" height="6" fill="#2f4f7f" />
              <rect width="6" height="2.2" fill="#3c639a" />
              <rect y="4" width="6" height="0.6" fill="#8ea7c8" opacity="0.5" />
            </pattern>
          )}
          {kind === "knit" && (
            <pattern id={id} width="8" height="7" patternUnits="userSpaceOnUse">
              <rect width="8" height="7" fill="#b9694a" />
              <path d="M0 0.5 L2 5.5 L4 0.5 M4 0.5 L6 5.5 L8 0.5" stroke="#d38c6c" strokeWidth="1.6" fill="none" />
            </pattern>
          )}
          {kind === "recycled" && (
            <pattern id={id} width="20" height="20" patternUnits="userSpaceOnUse">
              <rect width="20" height="20" fill="#e6dfd0" />
              <path d="M2 4l5 1M11 2l4 3M3 13l3-2M12 12l6 2M7 17l5-1M15 8l3-1" stroke="#2f5c9e" strokeWidth="0.9" />
              <path d="M5 8l4 2M14 17l4-2M1 18l3 1M9 6l2-3" stroke="#b65e3b" strokeWidth="0.9" />
              <path d="M6 1l1 4M17 11l-1 4M10 15l3 1" stroke="#355447" strokeWidth="0.9" />
            </pattern>
          )}
        </defs>
        <rect width="60" height="60" fill={`url(#${id})`} />
        {/* frayed edge: a stitched seam inset from the cut */}
        <rect x="4" y="4" width="52" height="52" fill="none" stroke="rgba(255,255,255,.55)" strokeWidth="0.7" strokeDasharray="2.2 1.8" />
      </svg>
      {labelled && <figcaption className="eyebrow mt-2 max-w-[11ch] text-[10.5px] leading-snug sm:max-w-none">{t(`swatch.${kind}` as Key)}</figcaption>}
    </figure>
  );
}

/** A thread that draws itself once when it scrolls into view. Decorative. */
export function ThreadRule({ className = "", tone = "var(--flax)" }: { className?: string; tone?: string }) {
  const { ref, cls } = useReveal<SVGSVGElement>(0.6);
  return (
    <svg ref={ref} className={`block h-6 w-full ${cls} ${className}`} viewBox="0 0 1200 24" preserveAspectRatio="none" aria-hidden>
      <path className="thread-draw" pathLength={1} d="M0 12 C 150 2, 300 22, 450 12 S 750 2, 900 12 S 1100 20, 1200 10"
            fill="none" stroke={tone} strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** Numbered section header: mono index and eyebrow, serif title, optional lede. */
export function SectionHead({ index, eyebrow, title, lede, as: H = "h2", size = "lg" }: {
  index?: string; eyebrow: string; title: ReactNode; lede?: ReactNode; as?: "h1" | "h2" | "h3"; size?: "lg" | "md";
}) {
  const { ref, cls } = useReveal<HTMLDivElement>();
  return (
    <div ref={ref} className={`reveal ${cls}`}>
      <p className="eyebrow flex items-center gap-3">
        {index && <span className="text-terracotta-ink">{index}</span>}
        <span className="h-px w-8 bg-[var(--border-strong)]" aria-hidden />
        <span>{eyebrow}</span>
      </p>
      <H className={`font-display mt-3 text-ink ${size === "lg" ? "text-[clamp(2rem,4.2vw,3.5rem)] leading-[1.02]" : "text-[clamp(1.6rem,2.6vw,2.25rem)] leading-[1.08]"}`}>
        {title}
      </H>
      {lede && <p className="mt-4 max-w-[62ch] text-[15.5px] text-ink-2">{lede}</p>}
    </div>
  );
}

/** Wrapper that fades its children in when scrolled into view. */
export function Reveal({ children, delay = 0, className = "", as: Tag = "div" }: {
  children: ReactNode; delay?: number; className?: string; as?: "div" | "section" | "li" | "figure";
}) {
  const { ref, cls } = useReveal<HTMLDivElement>();
  return (
    <Tag ref={ref as any} className={`reveal ${cls} ${className}`} style={{ ["--reveal-delay" as string]: `${delay}ms` }}>
      {children}
    </Tag>
  );
}
