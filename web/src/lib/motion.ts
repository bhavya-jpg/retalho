import { useEffect, useRef, useState } from "react";

// ---------------------------------------------------------------- motion preference
// Stored preference: "auto" follows the system's reduced-motion setting, "on" / "off" are the
// visitor's explicit choice from the Play / Pause animations control (WCAG 2.2.2: moving content
// can be paused; and a visitor who wants the animations can turn them on despite the default).
export type MotionPref = "auto" | "on" | "off";
const PREF_KEY = "retalho-motion";
const EVENT = "retalho-motion";

export const systemReducesMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function readMotionPref(): MotionPref {
  try {
    const v = window.localStorage.getItem(PREF_KEY);
    return v === "on" || v === "off" ? v : "auto";
  } catch { return "auto"; }
}

export const resolveLive = (pref: MotionPref, reduced: boolean) => pref === "on" || (pref === "auto" && !reduced);

/** Is ambient and reveal motion live right now? (Usable outside React.) */
export const motionLive = () => resolveLive(readMotionPref(), systemReducesMotion());

/** Apply the resolved state to <html>: motion-ok enables reveals, motion-off stops every animation. */
export function applyMotionClasses(live = motionLive()) {
  document.documentElement.classList.toggle("motion-ok", live);
  document.documentElement.classList.toggle("motion-off", !live);
}

export function setMotionPref(pref: MotionPref) {
  try { window.localStorage.setItem(PREF_KEY, pref); } catch { /* storage unavailable: session only */ }
  applyMotionClasses();
  window.dispatchEvent(new CustomEvent(EVENT, { detail: pref }));
}

/** live = animation should run now. */
export function useMotion() {
  const [pref, setPref] = useState(readMotionPref);
  const [reduced, setReduced] = useState(systemReducesMotion);
  useEffect(() => {
    const onPref = (e: Event) => setPref((e as CustomEvent<MotionPref>).detail);
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onMq = () => { setReduced(mq.matches); applyMotionClasses(); };
    window.addEventListener(EVENT, onPref);
    mq.addEventListener("change", onMq);
    return () => { window.removeEventListener(EVENT, onPref); mq.removeEventListener("change", onMq); };
  }, []);
  const live = resolveLive(pref, reduced);
  return { live, pref, reduced, toggle: () => setMotionPref(live ? "off" : "on") };
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
