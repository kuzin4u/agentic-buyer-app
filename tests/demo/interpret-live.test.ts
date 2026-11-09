// К1.3 DEMO-2 ч. 1: интерпретатор на пяти сюжетах приёмки на живом стенде. Записи — из шины в формате линии, снимок
// реестров — по маршруту /api/diag (то же, что получают экраны через адаптер источника).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { interpret, LOCAL_STAND_EMULATED, type InterpretEnv, type Interpretation } from "../../src/dashboards/interpret.js";
import { parseDiagSnapshot } from "../../src/dashboards/wire.js";
import { control, DEFAULT_WAIT_MS, splitRuns } from "../../src/dashboards/control.js";
import { matches } from "../../src/dashboards/passports.js";
import { startDemo, type Demo } from "../../src/demo/run.js";
import { TRAINING_MERCHANTS } from "../../src/demo/shops.js";
import { rawInHumanText } from "../dashboards/human-text.js";
import { driver, type ScenarioNo } from "./drive.js";

describe("интерпретатор на пяти сюжетах приёмки", { timeout: 180_000 }, () => {
  let demo: Demo;
  const runs = new Map<ScenarioNo, Interpretation[]>();
  const key = (no: ScenarioNo) => runs.get(no)!.filter((r) => r.level === "key");

  beforeAll(async () => {
    demo = await startDemo();
    const raw = await (await fetch(`${demo.monitor.url}/api/diag`)).json();
    const env: InterpretEnv = { snapshot: parseDiagSnapshot(raw)!.snapshot, emulated: LOCAL_STAND_EMULATED, training: TRAINING_MERCHANTS };
    const d = driver(demo);
    for (const no of [1, 2, 3, 4, 5] as const) runs.set(no, (await d.run(no)).map((i) => interpret(i, env)));
  }, 180_000);
  afterAll(async () => {
    await demo?.close();
  });

  it("во всех сюжетах: у каждой записи фраза ru и en без незаполненных подстановок; словарь покрывает все записи; фрода нет", () => {
    for (const [, list] of runs) {
      expect(list.length).toBeGreaterThan(0);
      for (const r of list) {
        for (const t of [r.phrase.ru, r.phrase.en]) {
          expect(t.length).toBeGreaterThan(0);
          expect(t).not.toMatch(/[{}]/);
          expect(t).not.toMatch(/^(Обращение|Шаг сюжета|Журнал агента|Call|Scenario step|Agent journal): /);
        }
        expect(r.kind).not.toBe("fraud");
        expect(r.who?.verdict).not.toBe("owner");
        // Коды пяти сюжетов — ядра и агента: все находятся в реестрах снимка.
        if (r.who) expect(r.who.status).toBe("found");
      }
    }
  });

  it("сюжет 1: поручение — норма, стадия «поручение», карточка С-01; подпись — клиентом", () => {
    // Метка начала прогона (К2.3а) — служебная стадия; остальные ключевые строки — поручение.
    const k = key(1).filter((r) => r.ref !== "run.intent");
    expect(key(1).find((r) => r.ref === "run.intent")).toMatchObject({ stage: "service", kind: "norm" });
    expect(k.every((r) => r.kind === "norm" && r.stage === "mandate")).toBe(true);
    expect(k.some((r) => r.situation === "С-01")).toBe(true);
    expect(k.some((r) => r.actor === "client")).toBe(true);
  });

  it("сюжет 2: сигнал A5 — конфликт у продавца; ошибка витрины — сбой у продавца; итог «оплачено» — по событию Платформы, С-27", () => {
    const k = key(2);
    expect(k.find((r) => r.who?.code === "A5_PRICE_MISMATCH")).toMatchObject({ kind: "conflict", stage: "search", who: { side: ["merchant"], verdict: "expected" } });
    expect(k.find((r) => r.who?.code === "REQUIRED")).toMatchObject({ kind: "error", who: { side: ["merchant"], verdict: "failure" } });
    expect(k.find((r) => r.stage === "cart" && r.situation === "С-25" && r.actor === "client")).toBeDefined();
    const paid = k.filter((r) => /оплачено/i.test(r.phrase.ru));
    expect(paid).toHaveLength(1);
    expect(paid[0]).toMatchObject({ stream: "monitor", actor: "platform", stage: "outcome", kind: "norm", situation: "С-27" });
    expect(k.find((r) => r.actor === "merchant")).toMatchObject({ emulated: true, kind: "norm" });
  });

  it("сюжет 3: отказ Платформы по лимиту клиента — конфликт С-26, сторона клиент и банк, «так и должно быть»; лимит ставит эмулятор банка", () => {
    const k = key(3);
    const declined = k.find((r) => r.stream === "monitor" && r.stage === "outcome" && r.kind === "conflict");
    expect(declined).toMatchObject({ actor: "platform", situation: "С-26", who: { code: "LIMIT_EXCEEDED", codeDetail: "CLIENT", side: ["client", "bank"], verdict: "expected" } });
    expect(declined!.phrase.ru).toBe("Отказ: превышен лимит клиента в банке");
    expect(k.find((r) => r.actor === "bank")).toMatchObject({ emulated: true, situation: "С-26" });
    expect(k.some((r) => /оплачено/i.test(r.phrase.ru))).toBe(false);
  });

  it("сюжет 4: запрос подтверждения — норма на стадии «подтверждение»; ответ — клиентом; итог — по событию", () => {
    const k = key(4);
    const conf = k.filter((r) => r.stage === "confirmation");
    expect(conf.length).toBeGreaterThan(0);
    expect(conf.every((r) => r.kind === "norm")).toBe(true);
    expect(conf.some((r) => r.actor === "client" && r.stream === "monitor")).toBe(true);
    expect(k.filter((r) => /оплачено/i.test(r.phrase.ru))).toHaveLength(1);
  });

  it("сюжет 5: отзыв — клиентом в банке; агент останавливается сам — конфликт С-28, не фрод; оплаты нет", () => {
    const k = key(5);
    expect(k.find((r) => r.stream === "monitor" && r.stage === "revoke" && r.actor === "client")).toBeDefined();
    const stops = k.filter((r) => r.kind === "conflict");
    expect(stops.length).toBeGreaterThan(0);
    expect(stops.every((r) => r.actor === "agent" && r.who?.verdict === "expected" && ["MANDATE_REVOKED", "MANDATE_NOT_ACTIVE"].includes(r.who.code))).toBe(true);
    expect(stops.some((r) => r.situation === "С-28")).toBe(true);
    expect(k.some((r) => r.stage === "payment")).toBe(false);
  });

  it("К1.4а, З2: в тексте человека пяти сюжетов (ключевые строки) нет имён полей, сырых значений и машинных кодов — ru и en", () => {
    for (const [no] of runs)
      for (const r of key(no))
        for (const lang of ["ru", "en"] as const) expect(rawInHumanText(r.phrase[lang], lang), `сюжет ${no}, seq ${r.seq}, ${lang}: ${r.phrase[lang]}`).toBeUndefined();
  });

  it("К1.4а, инвариант 6: «оплач…» / «paid» — только у события Платформы и в ответе витрины с оговоркой «слова продавца» (ревью К1.4а № 3)", () => {
    for (const [no, list] of runs)
      for (const r of list) {
        const shopReply = r.stream === "scenario" && /слова продавца/.test(r.phrase.ru) && /merchant's words/.test(r.phrase.en);
        const platform = r.stream === "monitor" && r.actor === "platform" && r.stage === "outcome";
        if (/оплач/i.test(r.phrase.ru) || /\bpaid\b/i.test(r.phrase.en)) expect(shopReply || platform, `сюжет ${no}, seq ${r.seq}: ${r.phrase.ru}`).toBe(true);
      }
  });

  it("К1.4а, З4: порядок — по времени возникновения: записи агента о подборе выше корзины; шаг сюжета не выше записи, которую пересказывает", () => {
    const all = runs.get(2)!;
    const seqOf = (p: (r: Interpretation) => boolean) => all.find(p)?.seq;
    const flagged = seqOf((r) => r.stream === "console" && r.who?.code === "A5_PRICE_MISMATCH");
    const excluded = seqOf((r) => r.stream === "console" && r.who?.code === "REQUIRED");
    const stepFlagged = seqOf((r) => r.stream === "scenario" && r.who?.code === "A5_PRICE_MISMATCH");
    const card = seqOf((r) => r.stream === "scenario" && r.stage === "cart" && r.situation === "С-25");
    expect([flagged, excluded, stepFlagged, card].every((s) => s !== undefined)).toBe(true);
    expect(flagged!).toBeLessThan(stepFlagged!);
    expect(excluded!).toBeLessThan(card!);
    expect(flagged!).toBeLessThan(card!);
    // Записи агента и шаги сюжета — с одних часов процесса: по возрастанию seq время не убывает.
    const own = all.filter((r) => r.stream !== "monitor").sort((a, b) => a.seq - b.seq);
    for (let i = 1; i < own.length; i++) expect(own[i]!.at >= own[i - 1]!.at, `seq ${own[i]!.seq}`).toBe(true);
  });

  // К2.3а: общая лента драйвера режется на прогоны по меткам run.<имя>, как на экране «Контроль». Драйвер перед сюжетами
  // 2, 3 и 5 сам запускает сюжет 1 (подпись поручения) — это отдельные прогоны «intent».
  const segments = () =>
    splitRuns([...new Map([...runs.values()].flat().map((r) => [r.seq, r])).values()]).map((s) => {
      if (!s.passport) throw new Error(`прогон без паспорта: ${s.name}`);
      return { ...s, passport: s.passport };
    });

  it("К2.3а: нарезка по меткам — прогоны в порядке запуска драйвером, каждый начинается своей меткой", () => {
    expect(segments().map((s) => s.passport.name)).toEqual(["intent", "intent", "purchase", "intent", "limit", "upk", "intent", "revoke"]);
    for (const s of segments()) expect(s.items[0]).toMatchObject({ stream: "scenario", ref: `run.${s.passport.name}`, seq: s.startSeq });
  });

  it("К2.1: паспорт каждого прогона сходится с фактом стенда — всё ожидаемое есть (ровно столько раз, где указано), запрещённого нет", () => {
    for (const s of segments()) {
      const p = s.passport;
      for (const e of p.expect) {
        const n = s.items.filter((r) => matches(r, e.match)).length;
        if (e.times !== undefined) expect(n, `сюжет ${p.no} (seq ${s.startSeq}), ${e.id}`).toBe(e.times);
        else expect(n, `сюжет ${p.no} (seq ${s.startSeq}), ${e.id}`).toBeGreaterThan(0);
      }
      for (const e of p.forbid) expect(s.items.filter((r) => matches(r, e.match)).map((r) => `${r.seq} ${r.ref}`), `сюжет ${p.no}, запрет ${e.id}`).toEqual([]);
    }
  });

  it("К2.2: контролёр на каждом прогоне — до срока «ждёт» (выполнено N из N), после срока «принято N из N»; начало — метка", () => {
    for (const s of segments()) {
      const p = s.passport;
      const own = s.items.filter((r) => r.source !== "pao_event").map((r) => Date.parse(r.at));
      expect(own.every(Number.isFinite), `сюжет ${p.no}: время записей`).toBe(true);
      const last = Math.max(...own);
      const before = control(p, s.items, { now: new Date(last + 1), startedAt: s.startedAt });
      expect(before.state, `сюжет ${p.no}`).toBe("waiting");
      expect(before.met, `сюжет ${p.no}`).toBe(before.total);
      const done = control(p, s.items, { now: new Date(last + DEFAULT_WAIT_MS), startedAt: s.startedAt });
      expect(done.items.filter((i) => i.state !== "accepted").map((i) => `${i.id}: ${i.state} ${i.reasons.join(",")}`), `сюжет ${p.no} (seq ${s.startSeq})`).toEqual([]);
      expect(done.accepted).toBe(done.total);
    }
  });

  it("К1.4а, З10: неполная карточка MER-5501 — «учебный сбой витрины»; обычная покупка у MER-4401 — без пометки", () => {
    const k = key(2);
    expect(k.find((r) => r.who?.code === "REQUIRED")).toMatchObject({ training: true, kind: "error" });
    expect(k.filter((r) => r.kind === "norm").every((r) => r.training === undefined)).toBe(true);
  });
});
