import { describe, expect, it } from "vitest";
import { en, enData } from "../i18n/en";
import { DICTS, LANGS, plural, rich, setLang, t, td } from "./i18n";

// Values and markup a translation must keep: {name} placeholders and <tag> pairs, as sorted lists.
const shape = (s: string) => ({
  vars: [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort(),
  tags: [...s.matchAll(/<(\w+)>/g)].map((m) => m[1]).sort(),
});

describe("translations", () => {
  it("lists every dictionary as a language", () => {
    expect(Object.keys(DICTS).sort()).toEqual(LANGS.map((l) => l.code).sort());
  });

  for (const { code } of LANGS) {
    it(`${code}: same keys, placeholders and tags as English`, () => {
      const { ui, data } = DICTS[code];
      expect(Object.keys(ui).sort()).toEqual(Object.keys(en).sort());
      expect(Object.keys(data).sort()).toEqual(Object.keys(enData).sort());
      for (const [k, s] of Object.entries(en)) expect(shape(ui[k as keyof typeof en]), `${code} ${k}`).toEqual(shape(s));
      for (const [k, s] of Object.entries(enData)) expect(shape(data[k as keyof typeof enData]), `${code} ${k}`).toEqual(shape(s));
    });

    it(`${code}: no empty strings`, () => {
      const { ui, data } = DICTS[code];
      for (const [k, s] of [...Object.entries(ui), ...Object.entries(data)]) expect(s.trim(), `${code} ${k}`).not.toBe("");
    });
  }

  it("plural keys exist in pairs", () => {
    const keys = Object.keys(en);
    for (const k of keys.filter((x) => x.endsWith("_one"))) expect(keys).toContain(k.replace(/_one$/, "_other"));
  });
});

describe("rich()", () => {
  it("leaves plain text alone and fills values", () => {
    expect(rich("no markup")).toBe("no markup");
    expect(rich("{n} points", { n: 3 })).toBeTruthy();
  });
});

describe("td() and t() in another language", () => {
  it("translates known data texts and patterns, keeping the variable part", () => {
    setLang("pt");
    try {
      expect(td("OpenStreetMap road network via Geofabrik (portugal-261018), routed with OSRM"))
        .toBe("Rede de estradas do OpenStreetMap via Geofabrik (portugal-261018), com rotas OSRM");
      expect(td("Synthetic candidate site 36")).toBe("Local candidato sintético 36");
      expect(td("Vidrão")).toBe("Vidrão"); // a proper name stays as written
      expect(t("cov.points", { n: 3 })).toBe("3 pontos");
      expect(t(plural("prov.osm", 1), { n: 1 })).toContain("1 contentor de têxteis");
    } finally {
      setLang("en");
    }
  });
});
