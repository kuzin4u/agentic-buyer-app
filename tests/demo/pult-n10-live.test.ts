// Кирпич № 10 (Н-08; Р-1548, ответ чата #issuecomment-6857335967): корзина драйвера «ПР» — транзакция, ответ Платформы на
// запрос реквизита — в её транзакции (ключ идемпотентности из шага драйвера). Живой стенд, режим сбоев, эмулятор клиента
// «Авто»: Н-08 — обе ветки (Платформа отказала — «сработало, нарушил агент, защитила Платформа»; реквизит выдан — «нарушено»
// без защитника), и перепрогон Н-01, Н-06, Н-07, Н-09: вердикты — на транзакции корзины драйвера, без лишних (Н-01 — без
// R18, Н-06 — R09 «не определён», не «решение клиента»), паспорт — один, в «систему» ничего не уходит.
import { afterEach, describe, expect, it } from "vitest";
import { interpret, LOCAL_STAND_EMULATED, type InterpretEnv, type Interpretation } from "../../src/dashboards/interpret.js";
import { parseDiagSnapshot } from "../../src/dashboards/wire.js";
import type { BusItem, ScenarioLine } from "../../src/demo/bus.js";
import { FaultyDriver, n08Branch, type FaultTest } from "../../src/demo/faulty.js";
import { startDemo, type Demo } from "../../src/demo/run.js";
import { MASSA_MADRE, TRAINING_MERCHANTS } from "../../src/demo/shops.js";
import { passports } from "../../src/pult/control.js";
import { evaluate } from "../../src/pult/engine.js";
import { emptyProtocol, protocolStep } from "../../src/pult/protocol.js";
import type { StandLogEntry } from "../../src/pult/standlog.js";
import { buildTxModel } from "../../src/pult/tx.js";
import { verdicts, type Verdict } from "../../src/pult/verdict.js";

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("№ 10: корзина драйвера «ПР» — транзакция; Н-08 обе ветки, перепрогон Н-01, Н-06, Н-07, Н-09", { timeout: 300_000 }, () => {
  let demo: Demo | undefined;
  afterEach(async () => {
    await demo?.close();
    demo = undefined;
  });

  /** Прогон теста драйвера на своём стенде; вердикты пульта по всей ленте с журналом стенда. `branch` — подмена ветки (обратный Н-08). */
  async function judge(test: FaultTest, branch?: Parameters<typeof n08Branch>[0]) {
    demo = await startDemo({ faults: true });
    const raw = await (await fetch(`${demo.monitor.url}/api/diag`)).json();
    const env: InterpretEnv = { snapshot: parseDiagSnapshot(raw)!.snapshot, emulated: LOCAL_STAND_EMULATED, training: TRAINING_MERCHANTS };
    demo.clientEmulator!.setAuto(true);
    const d = branch === undefined ? demo.faulty! : new FaultyDriver(demo.stand, (s) => demo!.bus.scenario(s), { otherBusy: () => demo!.scenarios.busy, clientWaitMs: 15_000, branches: { "Н-08": n08Branch(branch) } });
    expect(d.start(test)).toEqual({ ok: true });
    await d.settled();
    const view = (hist: readonly BusItem[]) => {
      const items: Interpretation[] = hist.filter((i) => i.stream !== "stand").map((i) => interpret(i as Parameters<typeof interpret>[0], env));
      const standLog = hist.flatMap((i) => (i.stream === "stand" ? [i.line.entry as unknown as StandLogEntry] : []));
      const model = buildTxModel(items);
      const ev = evaluate(model, items, { standLog });
      return { items, model, ev, vs: verdicts(ev, model, items) };
    };
    // Ожидание по условию, а не паузой (ревью № 10 № 10): итог прогона на шине и вердикт у транзакции корзины.
    let hist: readonly BusItem[];
    let outcome: ScenarioLine | undefined;
    for (const end = Date.now() + 30_000; ; await pause(300)) {
      demo.bus.poll();
      hist = demo.bus.history();
      outcome = hist.flatMap((i) => (i.stream === "scenario" && /^fault\.(marked|refused|unplayed|failed)$/.test(i.line.step) ? [i.line] : [])).at(-1);
      if (outcome && view(hist).vs.some((v) => v.obj === String(outcome!.params.mandate_id))) break;
      if (Date.now() > end) throw new Error(`${test}: не дождались вердикта у корзины`);
    }
    // Протокол — по префиксам ленты, как его копит лента пульта (блокер ревью № 10 № 1): ни одной записи без объекта.
    let proto = emptyProtocol();
    for (let k = 1; k <= hist.length; k++) {
      const v = view(hist.slice(0, k));
      const now = v.items.at(-1)?.at ?? new Date().toISOString();
      proto = protocolStep(proto, { verdicts: v.vs, waits: [], waitMs: 15_000, now, reactions: [], model: v.model, items: v.items, ev: v.ev });
    }
    const last = view(hist);
    const cart = String(outcome!.params.mandate_id);
    return { outcome: outcome!, cart, model: last.model, vs: last.vs, pp: passports(last.vs), proto: proto.entries };
  }
  const brief = (vs: readonly Verdict[]) => vs.map((v) => [v.obj, v.cond ?? v.guarantee, v.kind, v.violator, v.protector]);

  it("Н-08: Платформа отказала MANDATE_SCOPE — у транзакции корзины R17 «сработало, нарушил агент, защитила Платформа»; в «системе» ничего, паспорт один", async () => {
    const j = await judge("Н-08");
    expect(j.outcome.step).toBe("fault.refused");
    expect(j.model.txs.map((t) => t.id)).toEqual([j.cart]);
    expect(brief(j.vs)).toEqual([[j.cart, "R17", "protection", "agent", "platform"]]);
    expect(j.pp.map((p) => p.obj)).toEqual([j.cart]);
    // В «Журнале» — только запись транзакции корзины; системной (без объекта) не было ни на одном шаге ленты.
    expect(j.proto.map((e) => [e.type, e.cond, e.obj, e.status])).toEqual([["fired", "R17", j.cart, "stopped"]]);
  });

  it("Н-08 обратный: реквизит в пределе корзины выдан — R17 «нарушено», нарушил агент, защитника нет", async () => {
    const j = await judge("Н-08", MASSA_MADRE.items[0]!.price!);
    expect(j.outcome.step).toBe("fault.marked");
    const r17 = j.vs.filter((v) => v.cond === "R17");
    expect(brief(r17)).toEqual([[j.cart, "R17", "violation", "agent", undefined]]);
    expect(j.pp.map((p) => p.obj)).toEqual([j.cart]);
  });

  it("перепрогон Н-01, Н-06, Н-07, Н-09: вердикты — на транзакции корзины драйвера, без лишних; паспорт один, в «системе» нет", async () => {
    const want: Record<"Н-01" | "Н-06" | "Н-07" | "Н-09", (cart: string) => unknown[][]> = {
      // Н-01: второе списание остановил продавец; R18 нет — шаг драйвера «корзина подписана» — согласие (п. 1).
      "Н-01": (c) => [
        [c, "R46", "violation", "agent", undefined],
        [c, "pay_refused", "protection", undefined, "merchant"],
      ],
      // Н-06: R37 «нарушено» (агент); R09 — «не определён», не «решение клиента»: в транзакции пометка «ПР» (п. 2).
      "Н-06": (c) => [
        [c, "R09", "protection", "undetermined", "platform"],
        [c, "R37", "violation", "agent", undefined],
      ],
      "Н-07": (c) => [[c, "R18", "violation", "agent", undefined]],
      "Н-09": (c) => [
        [c, "R17", "protection", undefined, "platform"],
        [c, "R26", "violation", "agent", undefined],
      ],
    };
    for (const t of ["Н-01", "Н-06", "Н-07", "Н-09"] as const) {
      const j = await judge(t);
      expect(j.outcome.step, t).toBe("fault.refused");
      expect(brief(j.vs), t).toEqual(want[t](j.cart));
      expect(j.pp.map((p) => p.obj), t).toEqual([j.cart]);
      expect(j.proto.filter((e) => e.obj !== j.cart), t).toEqual([]);
      await demo!.close();
      demo = undefined;
    }
  });
});
