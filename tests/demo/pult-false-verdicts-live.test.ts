// Ложные вердикты на правильных тестах (Р-1537, Р-1538): сюжеты 6, 7, 9 (П-03, П-04, П-07) с настоящим агентом — у П-03
// остановка после отказа клиента от корзины — «решение клиента» (поломка С3 «без проверки события отказа» здесь
// краснеет), паспортов нет ни у одного «правильного» сюжета. R26 здесь — только страж: на этих сюжетах он и до правки не
// был «ждёт» (поломка С3 R26 краснеет в модульном тесте `tests/pult/engine.test.ts`). Сюжеты 8 и 10 —
// `pult-scope-live.test.ts` (покупки нет, R26 не применяется).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { interpret, LOCAL_STAND_EMULATED, type InterpretEnv } from "../../src/dashboards/interpret.js";
import { parseDiagSnapshot } from "../../src/dashboards/wire.js";
import { startDemo, type Demo } from "../../src/demo/run.js";
import { TRAINING_MERCHANTS } from "../../src/demo/shops.js";
import { passports } from "../../src/pult/control.js";
import { evaluate } from "../../src/pult/engine.js";
import { buildTxModel } from "../../src/pult/tx.js";
import { verdicts } from "../../src/pult/verdict.js";
import { driver } from "./drive.js";

describe("ложные вердикты на правильных тестах — сюжеты 6, 7, 9 (Р-1537, Р-1538)", { timeout: 300_000 }, () => {
  let demo: Demo;
  let env: InterpretEnv;
  beforeAll(async () => {
    demo = await startDemo();
    const raw = await (await fetch(`${demo.monitor.url}/api/diag`)).json();
    env = { snapshot: parseDiagSnapshot(raw)!.snapshot, emulated: LOCAL_STAND_EMULATED, training: TRAINING_MERCHANTS };
  }, 30_000);
  afterAll(async () => {
    await demo?.close();
  });

  const judge = async (no: 6 | 7 | 9) => {
    const items = (await driver(demo).run(no)).map((i) => interpret(i, env));
    const model = buildTxModel(items);
    const view = evaluate(model, items, { now: demo.stand.stand.now().toISOString() });
    return { model, view, vs: verdicts(view, model, items), items };
  };

  it("сюжет 6 (П-03): отказ от корзины — «решение клиента», нарушений и паспортов нет; R26 не «ждёт»", async () => {
    const { view, vs, items } = await judge(6);
    // Форма, ради которой Р-1538: агент остановился с MANDATE_NOT_ACTIVE (ревью блока № 2 — предпосылка явно).
    expect(items.some((x) => x.stream === "console" && x.who?.code === "MANDATE_NOT_ACTIVE")).toBe(true);
    // Р-1541 (ревью № 6): запись «узнал об отказе» — `agent.refused` с кодом и поручением отказанной корзины; без неё правило
    // молча не сработало бы (ложное «соблюдено» у нарушения).
    const cart = items.find((x) => x.source === "pao_event" && x.ref === "mandate.rejected")?.ids?.mandate_id;
    expect(cart).toBeDefined();
    expect(items.some((x) => x.ref === "agent.refused" && x.who?.code === "MANDATE_NOT_ACTIVE" && x.ids?.mandate_id === cart)).toBe(true);
    expect(vs.filter((v) => v.kind === "violation")).toEqual([]);
    expect(passports(vs)).toEqual([]);
    // R09 «решение клиента» по отказу от корзины, одна запись на покупку (Р-1538).
    const cd = vs.filter((v) => v.violator === "client_decision");
    expect(cd.map((v) => [v.cond, v.kind, v.cause?.kind === "rule" ? v.cause.rule : undefined])).toEqual([["R09", "client_decision", "rejected_agent_stop"]]);
    for (const o of view.objs.filter((x) => x.kind === "tx")) expect(o.conds.R26.status, o.id).not.toBe("wait");
  });

  for (const no of [7, 9] as const)
    it(`сюжет ${no}: нарушений и паспортов нет; у остановленной покупки R26 не «ждёт»`, async () => {
      const { view, vs } = await judge(no);
      expect(vs.filter((v) => v.kind === "violation")).toEqual([]);
      expect(passports(vs)).toEqual([]);
      for (const o of view.objs.filter((x) => x.kind === "tx")) expect(o.conds.R26.status, o.id).not.toBe("wait");
    });
});
