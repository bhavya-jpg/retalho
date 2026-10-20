import { useEffect, useState } from "react";

const NAMES = ["ink", "ink-2", "muted", "grid", "axis", "surface", "surface-2", "series-a", "series-b", "candidate",
  "accent", "baseline", "flax", "page"] as const;
export type Tokens = Record<(typeof NAMES)[number], string>;

function read(): Tokens {
  const s = getComputedStyle(document.documentElement);
  return Object.fromEntries(NAMES.map((n) => [n, s.getPropertyValue(`--${n}`).trim()])) as Tokens;
}

/** Resolved colour tokens for canvas/SVG libraries; re-read when the colour scheme changes. */
export function useTokens(): Tokens {
  const [t, setT] = useState(read);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setT(read());
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return t;
}
