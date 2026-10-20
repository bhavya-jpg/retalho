import { useEffect, useRef, useState } from "react";

export const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Adds `is-in` to the element the first time it scrolls into view (once). Content stays visible if
 *  IntersectionObserver is missing or slow: a fallback timer reveals it anyway. */
export function useReveal<T extends Element>(threshold = 0.2) {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!("IntersectionObserver" in window) || prefersReducedMotion()) {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setInView(true);
        io.disconnect();
      }
    }, { threshold, rootMargin: "0px 0px -8% 0px" });
    io.observe(el);
    const fallback = window.setTimeout(() => setInView(true), 4000);
    return () => { io.disconnect(); window.clearTimeout(fallback); };
  }, [threshold]);
  return { ref, inView, cls: inView ? "is-in" : "" };
}
