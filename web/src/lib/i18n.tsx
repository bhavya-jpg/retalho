// Interface language. Strings live in src/i18n/<lang>.ts, one flat dictionary per language with the
// same keys as en.ts. The language is a module-level value read by t() during render; App re-renders
// the whole tree when it changes, and memoised text depends on useLang().
import { createContext, Fragment, useContext, type ReactNode } from "react";
import { en, enData, type DataDict, type DataKey, type Dict, type Key } from "../i18n/en";
import { de, deData } from "../i18n/de";
import { es, esData } from "../i18n/es";
import { fr, frData } from "../i18n/fr";
import { it, itData } from "../i18n/it";
import { pt, ptData } from "../i18n/pt";

export type { Key } from "../i18n/en";

export const LANGS = [
  { code: "en", name: "English", locale: "en-GB", dir: "ltr" },
  { code: "pt", name: "Português", locale: "pt-PT", dir: "ltr" },
  { code: "es", name: "Español", locale: "es-ES", dir: "ltr" },
  { code: "fr", name: "Français", locale: "fr-FR", dir: "ltr" },
  { code: "de", name: "Deutsch", locale: "de-DE", dir: "ltr" },
  { code: "it", name: "Italiano", locale: "it-IT", dir: "ltr" },
] as const;
export type Lang = (typeof LANGS)[number]["code"];

export const DICTS: Record<Lang, { ui: Dict; data: DataDict }> = {
  en: { ui: en, data: enData }, pt: { ui: pt, data: ptData }, es: { ui: es, data: esData }, fr: { ui: fr, data: frData },
  de: { ui: de, data: deData }, it: { ui: it, data: itData },
};

const STORE = "retalho.lang";
let current: Lang = "en";
export const isLang = (x: unknown): x is Lang => LANGS.some((l) => l.code === x);
export const getLang = () => current;
export const getLocale = () => LANGS.find((l) => l.code === current)!.locale;

/** ?lang=xx, then the visitor's earlier choice, then the browser's languages, then English. */
export function detectLang(): Lang {
  try {
    const q = new URLSearchParams(window.location.search).get("lang");
    if (isLang(q)) return q;
  } catch { /* no URL */ }
  try {
    const saved = window.localStorage.getItem(STORE);
    if (isLang(saved)) return saved;
  } catch { /* storage blocked */ }
  for (const l of navigator.languages ?? [navigator.language]) {
    const base = l?.toLowerCase().split("-")[0];
    if (isLang(base)) return base;
  }
  return "en";
}

/** Set the language for t() and formatting only (no DOM changes). */
export function setLang(l: Lang) {
  current = l;
}

/** Switch language: strings, <html lang/dir>, title and description. Remembered when storage allows. */
export function applyLang(l: Lang, remember = false) {
  setLang(l);
  const root = document.documentElement;
  root.lang = l;
  root.dir = LANGS.find((x) => x.code === l)!.dir;
  document.title = t("meta.title");
  document.querySelector('meta[name="description"]')?.setAttribute("content", t("meta.description"));
  if (remember) {
    try { window.localStorage.setItem(STORE, l); } catch { /* storage blocked */ }
  }
}

export const LangContext = createContext<{ lang: Lang; setLang: (l: Lang) => void }>({ lang: "en", setLang: () => {} });
export const useLang = () => useContext(LangContext);

const fill = (s: string, vars?: Record<string, string | number>) =>
  vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : s;

const raw = (key: Key) => DICTS[current].ui[key] ?? en[key];

/** Plain-text translation with {name} values. */
export function t(key: Key, vars?: Record<string, string | number>): string {
  return fill(raw(key), vars);
}

/** Key for a count: `${base}_one` or `${base}_other`, by the language's plural rules. */
export function plural(base: string, n: number): Key {
  return `${base}_${new Intl.PluralRules(getLocale()).select(n) === "one" ? "one" : "other"}` as Key;
}

/** Translation for a key built at run time (e.g. a profile name), or the fallback if there is none. */
export function tOr(key: string, fallback: string): string {
  return (DICTS[current].ui as Record<string, string>)[key] ?? (en as Record<string, string>)[key] ?? fallback;
}

type Part = ReactNode | ((children: ReactNode) => ReactNode);
const TAGS: Record<string, (c: ReactNode) => ReactNode> = {
  b: (c) => <b className="text-ink">{c}</b>,
  em: (c) => <em>{c}</em>,
  i: (c) => <i>{c}</i>,
  code: (c) => <code className="mono rounded bg-surface-2 px-1">{c}</code>,
};

/** Parse "<b>x</b> and {n}" into React nodes. Tags and values come from `parts`, else the defaults. */
export function rich(s: string, parts: Record<string, Part> = {}): ReactNode {
  const out: ReactNode[] = [];
  const re = /<(\w+)>([\s\S]*?)<\/\1>|\{(\w+)\}/g;
  let last = 0, k = 0, m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push(s.slice(last, m.index));
    if (m[1]) {
      const tag = parts[m[1]] ?? TAGS[m[1]];
      const inner = rich(m[2], parts);
      out.push(<Fragment key={k++}>{typeof tag === "function" ? tag(inner) : inner}</Fragment>);
    } else {
      const v = parts[m[3]];
      out.push(<Fragment key={k++}>{v === undefined ? m[0] : typeof v === "function" ? v(null) : v}</Fragment>);
    }
    last = re.lastIndex;
  }
  if (last < s.length) out.push(s.slice(last));
  return out.length === 1 ? out[0] : <>{out}</>;
}

/** Rich translation: markup tags plus values (strings, numbers or nodes). */
export function tr(key: Key, parts: Record<string, Part> = {}): ReactNode {
  return rich(raw(key), parts);
}

// ---------------------------------------------------------------- text from the data files
const dataRaw = (key: DataKey) => DICTS[current].data[key] ?? enData[key];

const escape = (x: string) => x.replace(/[.*+?^$()|[\]\\]/g, "\\$&");
const PATTERNS = (Object.keys(enData) as DataKey[]).filter((k) => k.startsWith("pattern."))
  .map((k) => ({ k, re: new RegExp(`^${escape(enData[k]).replace("{v}", "(.+)")}$`) }));

/** A data string, translated when it is one of the known English texts or patterns ({v} is kept). */
export function td(s: string | null | undefined): string {
  if (!s) return s ?? "";
  const exact = `text.${s}` as DataKey;
  if (exact in enData) return dataRaw(exact);
  for (const { k, re } of PATTERNS) {
    const m = s.match(re);
    if (m) return dataRaw(k).replace("{v}", m[1]);
  }
  return s;
}

/** Parameter display name, or the humanised key if it is not a known parameter. */
export function tParam(key: string, fallback: string): string {
  const k = `param.${key}` as DataKey;
  return k in enData ? dataRaw(k) : fallback;
}

/** A parameter's note, translated only while the file still holds the original English note. */
export function tNote(key: string, note: string): string {
  const k = `note.${key}` as DataKey;
  return k in enData && enData[k] === note ? dataRaw(k) : note;
}

export function tUnit(unit: string): string {
  const k = `unit.${unit}` as DataKey;
  return k in enData ? dataRaw(k) : unit;
}
