// К1.3 DEMO-2 ч. 1: интерпретатор на пяти сюжетах приёмки на живом стенде. Записи — из шины в формате линии, снимок
// реестров — по маршруту /api/diag (то же, что получают экраны через адаптер источника).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { interpret, LOCAL_STAND_EMULATED, type InterpretEnv, type Interpretation } from "../../src/dashboards/interpret.js";
import { parseDiagSnapshot } from "../../src/dashboards/wire.js";
import { startDemo, type Demo } from "../../src/demo/run.js";
import { driver, type ScenarioNo } from "./drive.js";

describe("интерпретатор на пяти сюжетах приёмки", { timeout: 180_000 }, () => {
  let demo: Demo;
  const runs = new Map<ScenarioNo, Interpretation[]>();
  const key = (no: ScenarioNo) => runs.get(no)!.filter((r) => r.level === "key");

  beforeAll(async () => {
    demo = await startDemo();
    const raw = await (await fetch(`${demo.monitor.url}/api/diag`)).json();
    const env: InterpretEnv = { snapshot: parseDiagSnapshot(raw)!.snapshot, emulated: LOCAL_STAND_EMULATED };
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
    const k = key(1);
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
});
