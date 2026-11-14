// Справочник 89 правил пульта (П-3.1; П6 и П6 дополнение 1): данные модели 1.23 и правило английского текста.
import { describe, expect, it } from "vitest";
import {
  CHECKABLE_CONDITIONS,
  CONDITION_GROUPS,
  CONDITION_IDS,
  CONDITIONS,
  EN_LATER,
  isCheckable,
  JOINTS,
  NODES,
  POINTS,
  RULE_GROUPS,
  RULES89,
  ruleText,
  SECTORS,
  ZONES,
  type RuleText,
} from "../../src/pult/rules89.js";
import type { Phrase } from "../../src/pult/phrases.js";

/** 21 правило с проверяемым условием — перечнем из П6 дополнения 1. */
const CHECKABLE_RULES = [
  "Б04", "Б06", "В06", "Г03", "Г06", "Д04", "Д05", "Е03", "Е05", "Ж01", "Ж02",
  "Ж03", "Ж04", "З01", "З03", "З04", "И01", "Л01", "М01", "О02", "О03",
];
const CYRILLIC = /[А-Яа-яЁё]/;
const textFields = (t: RuleText) => [t.rule, t.who, t.evidence, t.whyVuln, t.whyCrit];
const filled = (s: string) => s.trim().length > 0;
const phraseOk = (x: Phrase) => filled(x.ru) && filled(x.en) && !CYRILLIC.test(x.en);

describe("справочник 89 правил (П-3.1)", () => {
  it("89 правил с уникальными кодами", () => {
    expect(RULES89).toHaveLength(89);
    expect(new Set(RULES89.map((r) => r.id)).size).toBe(89);
  });

  it("зоны модели 1.23: красная 9, оранжевая 33, жёлтая 23, фон 24", () => {
    const count = Object.fromEntries(ZONES.map((z) => [z, RULES89.filter((r) => r.zone === z).length]));
    expect(count).toEqual({ red: 9, orange: 33, yellow: 23, background: 24 });
  });

  it("красная зона — правила красных узлов У1–У5; правила защиты — А04, Д04, М01, Н02", () => {
    for (const r of RULES89) expect(r.zone === "red", r.id).toBe(r.node !== undefined);
    expect(RULES89.filter((r) => r.safe).map((r) => r.id)).toEqual(["А04", "Д04", "М01", "Н02"]);
  });

  it("уязвимость и критичность — 1–3; у каждого правила ru-тексты заполнены", () => {
    for (const r of RULES89) {
      expect([1, 2, 3], r.id).toContain(r.v);
      expect([1, 2, 3], r.id).toContain(r.c);
      expect(textFields(r.ru).every(filled), r.id).toBe(true);
    }
  });

  it("ссылки: условия, узлы, сектора, точки и группы существуют", () => {
    const known = new Set(CONDITION_IDS);
    expect(known.size).toBe(47);
    for (const r of RULES89) {
      for (const c of r.conds) expect(known.has(c), `${r.id} → ${c}`).toBe(true);
      expect(r.group in RULE_GROUPS, r.id).toBe(true);
      expect(r.point in POINTS, r.id).toBe(true);
      if (r.node !== undefined) expect(r.node in NODES, r.id).toBe(true);
      if (r.sector !== undefined) expect(r.sector in SECTORS, r.id).toBe(true);
    }
    for (const [id, n] of Object.entries(NODES)) for (const c of n.conds) expect(known.has(c), `${id} → ${c}`).toBe(true);
    for (const [id, s] of Object.entries(SECTORS)) for (const c of s.conds) expect(known.has(c), `${id} → ${c}`).toBe(true);
    for (const c of CHECKABLE_CONDITIONS) expect(known.has(c), c).toBe(true);
  });
});

describe("английский справочника (П6 дополнение 1)", () => {
  it("проверяемые — 21 правило перечня, «только ru» — 68", () => {
    const checkable = RULES89.filter(isCheckable).map((r) => r.id);
    expect(checkable).toEqual(CHECKABLE_RULES);
    expect(RULES89.length - checkable.length).toBe(68);
  });

  it("18 проверяемых условий — перечень П6 п. 2", () => {
    expect([...CHECKABLE_CONDITIONS]).toEqual([
      "R08", "R09", "R17", "R18", "R20", "R21", "R23", "R25", "R26",
      "R27", "R28", "R30", "R31", "R32", "R37", "R41", "R46", "R47",
    ]);
  });

  it("каждое из 18 условий проверяется хотя бы одним правилом", () => {
    for (const c of CHECKABLE_CONDITIONS) expect(RULES89.some((r) => r.conds.includes(c)), c).toBe(true);
  });

  it("у правила с проверяемым условием есть en, у остальных en нет", () => {
    for (const r of RULES89) {
      if (isCheckable(r)) {
        expect(r.en, `${r.id}: проверяемое правило без en`).toBeDefined();
        expect(textFields(r.en!).every(filled), r.id).toBe(true);
        expect(textFields(r.en!).some((s) => CYRILLIC.test(s)), `${r.id}: кириллица в en`).toBe(false);
      } else {
        expect(r.en, `${r.id}: en у непроверяемого — после MVP`).toBeUndefined();
      }
    }
  });

  it("на экране: en проверяемого — en; непроверяемого в en — ru с пометкой «en — после MVP»; в ru — без пометки", () => {
    const checkable = RULES89.find((r) => r.id === "Л01")!;
    const other = RULES89.find((r) => r.id === "А01")!;
    expect(ruleText(checkable, "en")).toEqual({ text: checkable.en, enLater: false });
    expect(ruleText(other, "en")).toEqual({ text: other.ru, enLater: true });
    expect(ruleText(other, "ru")).toEqual({ text: other.ru, enLater: false });
    expect(EN_LATER.en).toBe("en — after MVP");
  });

  it("18 условий — ru и en: формулировка, кто обеспечивает, доказательство, что делать", () => {
    expect(CONDITIONS.map((c) => c.id)).toEqual([...CHECKABLE_CONDITIONS]);
    for (const c of CONDITIONS) {
      for (const x of [c.rule, c.who, c.evidence, c.todo]) expect(phraseOk(x), c.id).toBe(true);
      expect(c.group in CONDITION_GROUPS, c.id).toBe(true);
    }
  });

  it("13 гарантий стыков J0–J3 — ru и en", () => {
    const g = JOINTS.flatMap((j) => j.guarantees);
    expect(JOINTS.map((j) => j.id)).toEqual(["J0", "J1", "J2", "J3"]);
    expect(g).toHaveLength(13);
    expect(new Set(g.map((x) => x.id)).size).toBe(13);
    for (const j of JOINTS) expect(phraseOk(j.name) && phraseOk(j.hand), j.id).toBe(true);
    for (const x of g) expect(phraseOk(x.name), x.id).toBe(true);
  });

  it("подписи справочника — ru и en (интерфейс пульта ru/en целиком, П6 п. 1)", () => {
    const labels: Phrase[] = [
      ...Object.values(RULE_GROUPS),
      ...Object.values(CONDITION_GROUPS),
      ...Object.values(POINTS).flatMap((x) => [x.name, x.what]),
      ...Object.values(NODES).flatMap((x) => [x.name, x.sign]),
      ...Object.values(SECTORS).map((x) => x.name),
    ];
    for (const x of labels) expect(phraseOk(x), x.ru).toBe(true);
  });
});
