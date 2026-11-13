// П-5.1а (Р-1524, Р-1525, Р-1536): П-06 и П-09 на живом стенде с настоящим агентом — вердикт пульта по сроку поручения из
// его данных (`valid_to` шага `intent.created`, П-11.5б окна Б). Сюжет 8 — отказ ядра MANDATE_OUT_OF_SCOPE раньше срока:
// R17 «сработало», защитил агент; сюжет 10 — тот же код после срока: R09 «сработало», защитил агент. Нарушителя нет —
// паспорта нет. Часы: время журнала агента — часы ядра (`new Date()`), срок — от `new Date()` сюжета, шаг — `stand.now()`;
// сейчас это одни системные часы, пока стенд их не сдвигает. Тест сверяет порядок «отказ ↔ срок» с запасом сюжета
// (`EXPIRY_MARGIN_MS`, 1 с) и расхождение часов меньше запаса не докажет (ревью П-5.1а № 2, STATUS «Открыто»).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { interpret, LOCAL_STAND_EMULATED, type InterpretEnv, type Interpretation } from "../../src/dashboards/interpret.js";
import { parseDiagSnapshot } from "../../src/dashboards/wire.js";
import { startDemo, type Demo } from "../../src/demo/run.js";
import { TRAINING_MERCHANTS } from "../../src/demo/shops.js";
import { passports } from "../../src/pult/control.js";
import { evaluate } from "../../src/pult/engine.js";
import { emptyProtocol, protocolStep } from "../../src/pult/protocol.js";
import { buildTxModel } from "../../src/pult/tx.js";
import { verdicts } from "../../src/pult/verdict.js";
import { driver } from "./drive.js";

describe("П-06 и П-09 на стенде — вердикт по сроку поручения (П-5.1а)", { timeout: 180_000 }, () => {
  const EXPIRY = 6; // секунд — как в tests/demo/more-scenarios.test.ts: подпись успевает, ожидание короткое
  let demo: Demo;
  let env: InterpretEnv;
  beforeAll(async () => {
    demo = await startDemo({ expirySec: EXPIRY });
    const raw = await (await fetch(`${demo.monitor.url}/api/diag`)).json();
    env = { snapshot: parseDiagSnapshot(raw)!.snapshot, emulated: LOCAL_STAND_EMULATED, training: TRAINING_MERCHANTS };
  }, 30_000);
  afterAll(async () => {
    await demo?.close();
  });

  const judge = (items: Interpretation[]) => {
    const model = buildTxModel(items);
    const view = evaluate(model, items, {});
    return { model, view, vs: verdicts(view, model, items) };
  };
  /** П-6.1а: защита видна в «Журнале» — запись протокола «сработала гарантия», «остановлено гарантией» (по вердикту, а не
   *  только по `GuaranteeHit`: у П-06 и П-09 защита живёт в условии — ревью П-5.1а № 3). */
  const protocolOf = (items: Interpretation[], j: ReturnType<typeof judge>) =>
    protocolStep(emptyProtocol(), { verdicts: j.vs, waits: [], waitMs: 15_000, now: items.at(-1)!.at, reactions: [], model: j.model, items, ev: j.view }).entries.map((e) => [
      e.type,
      e.cond,
      e.obj,
      e.status,
      e.protector,
    ]);
  /** Поручение прогона, срок из его данных и запись журнала агента об отказе ядра — у того же поручения. */
  const parts = (items: Interpretation[]) => {
    const created = items.find((x) => x.ref === "intent.created")!;
    const id = created.ids!.mandate_id!;
    const refusal = items.find((x) => x.stream === "console" && x.who?.code === "MANDATE_OUT_OF_SCOPE");
    return { created, id, refusal };
  };

  it("сюжет 8 (П-06): отказ ядра раньше срока поручения — R17 «сработало», защитил агент; паспорта нет", async () => {
    const items = (await driver(demo).run(8)).map((i) => interpret(i, env));
    const { created, id, refusal } = parts(items);
    expect(created.validTo).toBeDefined();
    // Журнал агента несёт поручение (иначе — правка модели транзакций, Р-1536 п. 3).
    expect(refusal?.ids?.mandate_id).toBe(id);
    expect(Date.parse(refusal!.at)).toBeLessThan(Date.parse(created.validTo!));
    const j = judge(items);
    const { model, view, vs } = j;
    expect(protocolOf(items, j)).toEqual([["fired", "R17", id, "stopped", "agent"]]);
    expect(model.mandates.find((m) => m.id === id)?.txIds).toEqual([]);
    const conds = view.objs.find((o) => o.id === id)!.conds;
    expect(conds.R17).toMatchObject({ status: "fired", cause: { kind: "rule", rule: "mandate_scope_agent" } });
    expect(conds.R09.status).toBe("na");
    expect(vs.map((v) => [v.obj, v.cond, v.kind, v.violator, v.protector])).toEqual([[id, "R17", "protection", undefined, "agent"]]);
    expect(passports(vs)).toEqual([]);
  });

  it("сюжет 10 (П-09): тот же код ядра после срока поручения — R09 «сработало» (срок), защитил агент; R17 не «вне пределов»; паспорта нет", async () => {
    const items = (await driver(demo).run(10)).map((i) => interpret(i, env));
    const { created, id, refusal } = parts(items);
    expect(created.validTo).toBeDefined();
    expect(refusal?.ids?.mandate_id).toBe(id);
    // Отказ записан не раньше срока (сюжет ждёт срок + 1 с по часам стенда).
    expect(Date.parse(refusal!.at)).toBeGreaterThanOrEqual(Date.parse(created.validTo!));
    const j = judge(items);
    const { view, vs } = j;
    expect(protocolOf(items, j)).toEqual([["fired", "R09", id, "stopped", "agent"]]);
    const conds = view.objs.find((o) => o.id === id)!.conds;
    expect(conds.R09).toMatchObject({ status: "fired", cause: { kind: "rule", rule: "expired_agent_stop" } });
    expect(conds.R17.status).toBe("none");
    expect(vs.map((v) => [v.obj, v.cond, v.kind, v.violator, v.protector])).toEqual([[id, "R09", "protection", undefined, "agent"]]);
    expect(passports(vs)).toEqual([]);
  });
});
