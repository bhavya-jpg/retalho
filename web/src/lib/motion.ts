import { useEffect, useRef, useState } from "react";

// ---------------------------------------------------------------- motion
// Animations are always on, by product decision: there is no pause control and the system's
// reduced-motion setting is not applied. Content never depends on animation to be visible.
export const motionLive = () => true;

/** Enable reveal and ambient motion on <html>. */
export function applyMotionClasses() {
  document.documentElement.classList.add("motion-ok");
}

export function useMotion() {
  return { live: true };
}

/** Adds `is-in` to the element the first time it scrolls into view (once). Content stays visible if
 *  IntersectionObserver is missing or slow: a fallback timer reveals it anyway. */
export function useReveal<T extends Element>(threshold = 0.2) {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!("IntersectionObserver" in window) || !motionLive()) {
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

/** Animate a number from 0 to `to` once, the first time it is visible. Final value is exact. */
export function useCountUp(to: number, inView: boolean, ms = 1100) {
  const { live } = useMotion();
  const [v, setV] = useState(live ? 0 : to);
  const done = useRef(!live);
  useEffect(() => {
    if (!live || done.current) { done.current = true; setV(to); return; }
    if (!inView) return;
    let raf = 0;
    const t0 = performance.now();
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / ms);
      setV(to * (1 - Math.pow(1 - k, 3)));
      if (k < 1) raf = requestAnimationFrame(step); else { done.current = true; setV(to); }
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [to, inView, live, ms]);
  return v;
}
