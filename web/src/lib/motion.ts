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

// ---------------------------------------------------------------- continuous motion
// Ambient loops (the hero truck, data packets, the calendar playhead, the map truck) run only when
// the user has not asked for reduced motion and has not paused them. The pause choice is remembered
// per browser and shared by every toggle on the page (WCAG 2.2.2: moving content can be paused).
const PAUSE_KEY = "retalho-motion-paused";
const EVENT = "retalho-motion";

function readPaused(): boolean {
  try { return window.localStorage.getItem(PAUSE_KEY) === "1"; } catch { return false; }
}

export function setMotionPaused(paused: boolean) {
  try { window.localStorage.setItem(PAUSE_KEY, paused ? "1" : "0"); } catch { /* storage unavailable: session only */ }
  document.documentElement.classList.toggle("motion-paused", paused);
  window.dispatchEvent(new CustomEvent(EVENT, { detail: paused }));
}

/** live = ambient animation should run now. */
export function useMotion() {
  const [paused, setPaused] = useState(readPaused);
  const [reduced, setReduced] = useState(prefersReducedMotion);
  useEffect(() => {
    document.documentElement.classList.toggle("motion-paused", paused);
    const onToggle = (e: Event) => setPaused((e as CustomEvent<boolean>).detail);
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onMq = () => setReduced(mq.matches);
    window.addEventListener(EVENT, onToggle);
    mq.addEventListener("change", onMq);
    return () => { window.removeEventListener(EVENT, onToggle); mq.removeEventListener("change", onMq); };
  }, [paused]);
  return { live: !paused && !reduced, paused, reduced, toggle: () => setMotionPaused(!paused) };
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
