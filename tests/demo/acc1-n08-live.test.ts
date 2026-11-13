// Н-08 в таблице тестирования и акте ACC-1 на живом стенде (окно Б; после кирпича № 10 окна А, `cf35e9e`, Р-1548):
// Платформа отказала MANDATE_SCOPE — строка Н-08 «сходится» по ветке «сработало, защитила Платформа» (`firedBy`, Р-1546),
// замечания № 10 в акте нет. Прогон — как в `pult-n10-live.test.ts` окна А: режим сбоев, эмулятор клиента «Авто».
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

describe("Н-08 в таблице тестирования на живом стенде (снятие замечания № 10)", { timeout: 300_000 }, () => {
  let demo: Demo | undefined;
  afterEach(async () => {
    await demo?.close();
    demo = undefined;
  });

  it("Платформа отказала — строка Н-08 «да» по ветке `refused`, в акте замечания нет", async () => {
    demo = await startDemo({ faults: true });
    const raw = await (await fetch(`${demo.monitor.url}/api/diag`)).json();
    const env: InterpretEnv = { snapshot: parseDiagSnapshot(raw)!.snapshot, emulated: LOCAL_STAND_EMULATED, training: TRAINING_MERCHANTS };
    demo.clientEmulator!.setAuto(true);
    expect(demo.faulty!.start("Н-08")).toEqual({ ok: true });
    await demo.faulty!.settled();
    // Разбор ленты — как `view` в `pult-n10-live.test.ts` окна А (общий помощник — после MVP, STATUS «Открыто»).
    const view = (hist: readonly BusItem[]) => {
      const items: Interpretation[] = hist.filter((i) => i.stream !== "stand").map((i) => interpret(i as Parameters<typeof interpret>[0], env));
      const standLog = hist.flatMap((i) => (i.stream === "stand" ? [i.line.entry as unknown as StandLogEntry] : []));
      const model = buildTxModel(items);
      const vs = verdicts(evaluate(model, items, { standLog }), model, items);
      return { items, model, vs, standLog };
    };
    // Ожидание по условию окна А (ревью К8 № 2, 3): итог прогона на шине и вердикт у транзакции корзины; итог есть, а
    // вердикта нет — ждём; исход не тот — выходим, исход покажет проверка `driver`.
    let hist: readonly BusItem[];
    let outcome: ScenarioLine | undefined;
    for (const end = Date.now() + 30_000; ; await pause(300)) {
      demo.bus.poll();
      hist = demo.bus.history();
      outcome = hist.flatMap((i) => (i.stream === "scenario" && /^fault\.(marked|refused|unplayed|failed)$/.test(i.line.step) ? [i.line] : [])).at(-1);
      if (outcome && (outcome.step !== "fault.refused" || view(hist).vs.some((v) => v.obj === String(outcome!.params.mandate_id)))) break;
      if (Date.now() > end) throw new Error(`Н-08: не дождались итога и вердикта у корзины (итог: ${outcome?.step ?? "нет"})`);
    }
    const v = view(hist);
    const t = testTable({ items: v.items, model: v.model, verdicts: v.vs, standLog: v.standLog, now: v.items.at(-1)?.at ?? new Date().toISOString() });
    const r = t.rows.find((x) => x.test === "Н-08")!;
    expect(r.driver).toBe("refused");
    expect(r.fact.ru).toContain("MANDATE_SCOPE");
    expect(r.agree, r.fact.ru).toBe("yes");
    // акт: «да», пометки «ПР» (П7 п. 4) и «Авто» (П5 п. 3); что замечание № 10 снято — доказывает модульный тест
    const a = acc1Rows(t).find((x) => x.test === "Н-08")!;
    expect(a.agree).toBe("yes");
    expect(a.violatorDriver).toBe(true);
    expect(a.auto).toBe(true);
    expect(a.note.ru).toBe("");
  });
});
