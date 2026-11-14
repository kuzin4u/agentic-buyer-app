// П-4.2 «Условия» пульта: `conditionsView` — статусы 89 правил, плитки узлов, сектора — только из результата движка
// (инвариант 2); `rulesForPage` — справочник для страницы на языке экрана (П6 доп. 1). Здесь — на собранном результате
// движка (каждый статус задан явно); на записях в форме шины — tests/pult/engine.test.ts, «П-4.2».
import { describe, expect, it } from "vitest";
import { conditionsView, rulesForPage } from "../../src/pult/conditions.js";
import { ruleStatus, STATUSES, type CondResult, type CondResults, type CondStatus, type EngineView, type Note } from "../../src/pult/engine.js";
import { CHECKABLE_CONDITIONS, isCheckable, NODES, RULES89, SECTORS, type CheckableCondition } from "../../src/pult/rules89.js";

type Set_ = Partial<Record<CheckableCondition, CondStatus | [CondStatus, Note]>>;
const res = (x: CondStatus | [CondStatus, Note] | undefined): CondResult =>
  x === undefined ? { status: "na", seqs: [] } : Array.isArray(x) ? { status: x[0], seqs: [], note: x[1] } : { status: x, seqs: [] };
const conds = (s: Set_ = {}): CondResults => Object.fromEntries(CHECKABLE_CONDITIONS.map((c) => [c, res(s[c])])) as CondResults;
const view = (system: Set_, objs: { id: string; s: Set_ }[] = []): EngineView => ({
  system: conds(system),
  objs: objs.map((o) => ({ id: o.id, kind: "tx", conds: conds(o.s) })),
  guarantees: [],
});

describe("«Условия» пульта (П-4.2): conditionsView", () => {
  it("89 правил: статус каждого — ruleStatus по сводным статусам движка; 68 без проверки — «на стенде не проверяется» или «вне стенда» по покрытию; счётчик — по тем же статусам", () => {
    const v = view({ R46: "bad", R21: "wait", R08: "ok", R17: "fired" });
    const c = conditionsView(v);
    expect(Object.keys(c.rules)).toHaveLength(89);
    for (const r of RULES89) expect(c.rules[r.id], r.id).toBe(ruleStatus(r, v.system));
    expect(c.rules["Ж03"]).toBe("bad");
    expect(c.rules["Д05"]).toBe("wait");
    const off = RULES89.filter((r) => !isCheckable(r));
    expect(off).toHaveLength(68);
    for (const r of off) expect(c.rules[r.id], r.id).toBe(r.coverage === "outside" ? "out" : "none");
    // Счётчик — по статусам правил, сумма — 89 (экран список не пересчитывает — уточнение 5).
    const tally: Partial<Record<CondStatus, number>> = {};
    for (const s of Object.values(c.rules)) tally[s] = (tally[s] ?? 0) + 1;
    expect(c.counts).toEqual(tally);
    expect(Object.values(c.counts).reduce((a, b) => a + (b ?? 0), 0)).toBe(89);
    expect(c.counts.out).toBe(3);
  });

  it("плитка узла — худший статус условий узла (не лучший); объекты — у которых условие узла в статусе плитки; «сработало» — тоже с объектами", () => {
    // У2 — R23, R25, R46: R23 «соблюдено», R46 «нарушено» → «нарушено», объект — тот, у кого R46 «нарушено».
    const v = view({ R23: "ok", R46: "bad", R09: "fired" }, [
      { id: "T1", s: { R46: "ok" } },
      { id: "T2", s: { R46: "bad" } },
      { id: "T3", s: { R09: "fired" } },
    ]);
    const c = conditionsView(v);
    expect(c.nodes.map((n) => n.id)).toEqual(Object.keys(NODES));
    const y2 = c.nodes.find((n) => n.id === "У2")!;
    expect(y2).toMatchObject({ status: "bad", objs: ["T2"], system: false });
    expect(c.nodes.find((n) => n.id === "У5")).toMatchObject({ status: "fired", objs: ["T3"], system: false });
    // У1 — R14 (без проверки на стенде, «на стенде не проверяется») и R47 «не применяется»: худший — «не применяется»; R14
    // статус узла не понижает и «соблюдено» не даёт (ревью П-4.2 № 9 — комментарий).
    expect(c.nodes.find((n) => n.id === "У1")!.status).toBe("na");
    expect(conditionsView(view({})).nodes.find((n) => n.id === "У1")!.status).toBe("na");
  });

  it("уточнение 1: «нарушено» только сводно — записью системы без транзакции — плитка «система», объектов нет; «сработало» сводно — тоже «система»", () => {
    const c = conditionsView(view({ R23: "bad" }, [{ id: "T1", s: { R23: "ok", R46: "ok" } }]));
    expect(c.nodes.find((n) => n.id === "У2")).toMatchObject({ status: "bad", objs: [], system: true });
    // R47 «сработало» движок ставит только сводно (агент исключил предложение с инструкцией) — ревью П-4.2 № 1.
    expect(conditionsView(view({ R47: "fired" })).nodes.find((n) => n.id === "У1")).toMatchObject({ status: "fired", objs: [], system: true });
  });

  it("ревью П-4.2 № 2: смешанный узел — R46 «нарушено» у T2 и R23 «нарушено» только записью системы: видны оба", () => {
    const c = conditionsView(view({ R46: "bad", R23: "bad" }, [{ id: "T2", s: { R46: "bad", R23: "ok" } }]));
    expect(c.nodes.find((n) => n.id === "У2")).toMatchObject({ status: "bad", objs: ["T2"], system: true });
  });

  it("уточнение 2: «конфликт звеньев» у статуса плитки — пометкой, а не простым «ждёт»; пометка другого статуса в плитку не попадает", () => {
    const c = conditionsView(view({ R46: ["wait", "link_conflict"], R25: "ok" }, [{ id: "TK", s: { R46: ["wait", "link_conflict"] } }]));
    expect(c.nodes.find((n) => n.id === "У2")).toMatchObject({ status: "wait", notes: ["link_conflict"], objs: [], system: false });
    // Пометка объекта при статусе плитки — тоже (сводная пометка могла быть другой).
    const c2 = conditionsView(view({ R46: ["wait", "unconfirmed_paid"] }, [{ id: "TK", s: { R46: ["wait", "link_conflict"] } }]));
    expect(c2.nodes.find((n) => n.id === "У2")!.notes).toEqual(["unconfirmed_paid", "link_conflict"]);
    const c3 = conditionsView(view({ R46: "bad", R23: ["wait", "link_conflict"] }, [{ id: "T9", s: { R46: "bad" } }]));
    expect(c3.nodes.find((n) => n.id === "У2")!.notes).toEqual([]);
  });

  it("8 секторов: статус — худший из сводных статусов его условий; «Гонки и устойчивость» без условий — «на стенде не проверяется»", () => {
    const c = conditionsView(view({ R18: "bad", R17: "fired", R21: "wait", R08: "ok", R26: "ok" }));
    expect(c.sectors.map((s) => s.id)).toEqual(Object.keys(SECTORS));
    const st = Object.fromEntries(c.sectors.map((s) => [s.id, s.status]));
    expect(st).toMatchObject({ cart: "bad", confirmation: "wait", mandate: "ok", credential: "ok", races: "none", outcome: "none", access: "none", antifraud: "none" });
  });
});

describe("справочник для страницы (П-4.2; П6 доп. 1)", () => {
  it("ru: 89 правил с текстами ru, без пометки; en: у 21 правила en, у 68 — ru и пометка «en — после MVP»", () => {
    const ru = rulesForPage("ru");
    expect(ru.rules).toHaveLength(89);
    expect(ru.rules.filter((r) => r.enLater)).toHaveLength(0);
    expect(ru.rules.find((r) => r.id === "Ж03")!.text.rule).toBe(RULES89.find((r) => r.id === "Ж03")!.ru.rule);
    const en = rulesForPage("en");
    expect(en.rules.filter((r) => !r.enLater)).toHaveLength(21);
    expect(en.rules.find((r) => r.id === "Ж03")).toMatchObject({ enLater: false, text: { rule: RULES89.find((r) => r.id === "Ж03")!.en!.rule } });
    expect(en.rules.find((r) => r.id === "А01")).toMatchObject({ enLater: true, text: { rule: RULES89.find((r) => r.id === "А01")!.ru.rule } });
    expect(en.enLater).toBe("en — after MVP");
    expect(Object.keys(en.statuses)).toEqual([...STATUSES]);
    expect(en.statuses.bad).toBe("violated");
  });

  it("узлы — с правилами из справочника (поле node), сектора — с условиями; зоны 9 / 33 / 23 / 24", () => {
    const d = rulesForPage("ru");
    for (const n of d.nodes) expect(n.rules, n.id).toEqual(RULES89.filter((r) => r.node === n.id).map((r) => r.id));
    expect(d.nodes.find((n) => n.id === "У2")!.rules).toEqual(["Е05", "Ж03", "О02"]);
    expect(d.sectors).toHaveLength(8);
    expect(d.sectors.find((s) => s.id === "races")!.conds).toEqual([]);
    const zc = Object.fromEntries(d.zones.map((z) => [z.id, d.rules.filter((r) => r.zone === z.id).length]));
    expect(zc).toEqual({ red: 9, orange: 33, yellow: 23, background: 24 });
  });
});
