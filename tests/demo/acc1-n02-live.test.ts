// Н-02 в таблице тестирования и акте ACC-1 на живом стенде (окно Б, задача по передаче #22; стенд `#v0.49.1` принимает
// пометку «ПР» по Н-02 — передача #120 исполнена в v0.49.0). Строка Н-02 перестаёт быть «не проверено»: сбой стенда
// срабатывает (`SECOND_CREDENTIAL_ISSUED`, `StandCall.fault`), и пульт строит паспорт R23 / R25 с нарушителем «Платформа»
// в узле У2 — замечания П11 в акте больше нет (его «Пересмотр»). Образец прогона — `acc1-n08-live.test.ts`: режим сбоев,
// эмулятор клиента «Авто».
import { afterEach, describe, expect, it } from "vitest";
import { interpret, LOCAL_STAND_EMULATED, type InterpretEnv, type Interpretation } from "../../src/dashboards/interpret.js";
import { parseDiagSnapshot } from "../../src/dashboards/wire.js";
import type { BusItem, ScenarioLine } from "../../src/demo/bus.js";
import { startDemo, type Demo } from "../../src/demo/run.js";
import { TRAINING_MERCHANTS } from "../../src/demo/shops.js";
import { acc1Rows } from "../../src/pult/acc1.js";
import { evaluate } from "../../src/pult/engine.js";
import type { StandLogEntry } from "../../src/pult/standlog.js";
import { testTable } from "../../src/pult/testtable.js";
import { buildTxModel } from "../../src/pult/tx.js";
import { verdicts } from "../../src/pult/verdict.js";

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("Н-02 в таблице тестирования на живом стенде (снятие «не проверено»)", { timeout: 300_000 }, () => {
  let demo: Demo | undefined;
  afterEach(async () => {
    await demo?.close();
    demo = undefined;
  });

  it("сбой сработал — строка Н-02 «да» с паспортом R23 / R25 в узле У2, нарушитель Платформа; в акте замечания нет", async () => {
    demo = await startDemo({ faults: true });
    const raw = await (await fetch(`${demo.monitor.url}/api/diag`)).json();
    const env: InterpretEnv = { snapshot: parseDiagSnapshot(raw)!.snapshot, emulated: LOCAL_STAND_EMULATED, training: TRAINING_MERCHANTS };
    demo.clientEmulator!.setAuto(true);
    const logFrom = demo.stand.stand.demo!.log().length;
    const callsFrom = demo.stand.stand.calls().length;
    expect(demo.faulty!.start("Н-02")).toEqual({ ok: true });
    await demo.faulty!.settled();
    // Разбор ленты — как в `acc1-n08-live.test.ts` (общий помощник — после MVP, STATUS «Открыто»).
    const view = (hist: readonly BusItem[]) => {
      const items: Interpretation[] = hist.filter((i) => i.stream !== "stand").map((i) => interpret(i as Parameters<typeof interpret>[0], env));
      const standLog = hist.flatMap((i) => (i.stream === "stand" ? [i.line.entry as unknown as StandLogEntry] : []));
      const model = buildTxModel(items);
      const vs = verdicts(evaluate(model, items, { standLog }), model, items);
      return { items, model, vs, standLog };
    };
    // Ждём итога прогона на шине и вердикта у транзакции корзины нарушителя (условие окна А, ревью К8 № 2, 3).
    let hist: readonly BusItem[];
    let outcome: ScenarioLine | undefined;
    for (const end = Date.now() + 30_000; ; await pause(300)) {
      demo.bus.poll();
      hist = demo.bus.history();
      outcome = hist.flatMap((i) => (i.stream === "scenario" && /^fault\.(marked|refused|unplayed|failed)$/.test(i.line.step) ? [i.line] : [])).at(-1);
      if (outcome && (outcome.step !== "fault.marked" || view(hist).vs.some((v) => v.obj === String(outcome!.params.mandate_id)))) break;
      if (Date.now() > end) throw new Error(`Н-02: не дождались итога и вердикта у корзины (итог: ${outcome?.step ?? "нет"})`);
    }
    // Итог ветки — «совершено и помечено»: он выносится по записи стенда, а не по 2xx (К3а), поэтому сам по себе уже
    // доказывает срабатывание сбоя; ниже — та же запись и пометка обращения, прочитанные у стенда напрямую.
    expect(outcome!.step, JSON.stringify(outcome!.params)).toBe("fault.marked");
    const log = demo.stand.stand.demo!.log().slice(logFrom);
    const markSeq = log.find((e) => e.test === "Н-02" && e.what === "MARKED")!.seq;
    const fired = log.find((e) => e.test === "Н-02" && e.what === "SECOND_CREDENTIAL_ISSUED")!;
    expect(fired.seq).toBeGreaterThan(markSeq);
    expect(demo.stand.stand.calls().slice(callsFrom).some((c) => c.fault === "Н-02")).toBe(true);
    // **Живая проверка Р-1540** (П11 п. 3, строка передачи #120): звено записи точное — корзина и заказ в записи стенда те
    // же, что у ветки (шаг «первый реквизит» и итог ветки), а не «похожие». Разойдись они — пульт пометил бы звено
    // `order_mismatch` и строка не поднялась бы выше «ждёт» (`engine.ts`), то есть «да» ниже было бы недостижимо.
    const firstCred = hist.flatMap((i) => (i.stream === "scenario" && i.line.step === "fault.note.first_credential" ? [i.line] : [])).at(-1)!;
    const cartId = String(firstCred.params.mandate_id);
    expect(fired.ids?.mandate_id).toBe(cartId);
    expect(fired.ids?.order_ref).toBe(String(firstCred.params.order_ref));
    expect(String(outcome!.params.mandate_id)).toBe(cartId);

    const v = view(hist);
    const t = testTable({ items: v.items, model: v.model, verdicts: v.vs, standLog: v.standLog, now: v.items.at(-1)?.at ?? new Date().toISOString() });
    const r = t.rows.find((x) => x.test === "Н-02")!;
    expect(r.agree, r.fact.ru).toBe("yes");
    expect(r.driver).toBe("marked");
    // Паспорт — на вердиктах прямо, а не только словами факта: оба условия строки задания у корзины нарушителя, нарушитель
    // «Платформа», узел У2 (ревью К5 № 3; «да» без этого недостижимо — `judgeIncorrect`, но тест говорит это сам).
    const passport = v.vs.filter((x) => x.obj === cartId && (x.cond === "R23" || x.cond === "R25"));
    expect(passport.map((x) => x.cond).sort()).toEqual(["R23", "R25"]);
    for (const x of passport) {
      expect(x.violator, x.cond).toBe("platform");
      expect(x.node, x.cond).toBe("У2");
    }
    for (const lang of ["ru", "en"] as const) {
      expect(r.fact[lang]).toContain("R23");
      expect(r.fact[lang]).toContain("R25");
    }
    // Акт: «да», пометки «ПР» (П7 п. 4) и «Авто» (П5 п. 3), замечания П11 нет — ни в ru, ни в en.
    const a = acc1Rows(t).find((x) => x.test === "Н-02")!;
    expect(a.agree).toBe("yes");
    expect(a.violatorDriver).toBe(true);
    expect(a.auto).toBe(true);
    expect(a.note.ru).toBe("");
    expect(a.note.en).toBe("");
  });
});
