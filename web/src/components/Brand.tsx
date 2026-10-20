// Retalho mark: a small woven swatch whose middle weft thread leaves the cloth as a route and
// ends at a collection point. Interlacing is drawn with a halo in the background colour, so it
// reads as over/under at any size.
const WARP = [9, 15, 21];
const WEFT = [9, 15, 21];

export function LogoMark({ size = 28, bg = "var(--page)", ink = "var(--ink)", accent = "var(--terracotta)",
  title }: { size?: number; bg?: string; ink?: string; accent?: string; title?: string }) {
  const w = 3.2;
  const over = (i: number, j: number) => (i + j) % 2 === 0; // warp over weft at this crossing
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" role={title ? "img" : undefined} aria-hidden={title ? undefined : true}
         aria-label={title} fill="none" strokeLinecap="round">
      {title && <title>{title}</title>}
      {WARP.map((x) => <line key={`v${x}`} x1={x} y1={4.5} x2={x} y2={25.5} stroke={ink} strokeWidth={w} />)}
      {WEFT.map((y, j) => (
        <g key={`h${y}`}>
          <line x1={4.5} y1={y} x2={j === 1 ? 24 : 25.5} y2={y} stroke={bg} strokeWidth={w + 2.4} />
          <line x1={4.5} y1={y} x2={j === 1 ? 24 : 25.5} y2={y} stroke={j === 1 ? accent : ink} strokeWidth={w} />
        </g>
      ))}
      {WARP.map((x, i) => WEFT.map((y, j) => over(i, j) && (
        <g key={`o${i}${j}`}>
          <line x1={x} y1={y - 2.6} x2={x} y2={y + 2.6} stroke={bg} strokeWidth={w + 2.4} strokeLinecap="butt" />
          <line x1={x} y1={y - 3.2} x2={x} y2={y + 3.2} stroke={ink} strokeWidth={w} strokeLinecap="butt" />
        </g>
      )))}
      {/* the loose thread becomes a route to a collection point */}
      <path d="M24 15 C 28 15, 28.5 19, 27.5 22.5" stroke={accent} strokeWidth={w} />
      <circle cx={27.3} cy={26.4} r={2.6} fill={accent} />
    </svg>
  );
}

export function Wordmark({ size = 26 }: { size?: number }) {
  return (
    <span className="inline-flex items-center gap-2.5 text-ink">
      <LogoMark size={size + 4} />
      <span className="font-display leading-none" style={{ fontSize: size + 2 }}>Retalho</span>
    </span>
  );
}
