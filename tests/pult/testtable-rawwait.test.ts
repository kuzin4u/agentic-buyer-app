// Признак ситуации У-01…У-03 по сырой шине (ревью П-11.5б-1 № 1; решение владельца 14.11 «3 — да»): признак не зависит от
// функции пульта, которую тест проверяет (`waits()`). Здесь `waits()` подменён «сломанным» (ничего не видит): при ожидании
// на шине до порога строка — «нет» (дефект пульта виден), а не «не проверено».
import { describe, expect, it, vi } from "vitest";
import type { Interpretation } from "../../src/dashboards/interpret.js";

vi.mock("../../src/pult/control.js", async (orig) => ({ ...(await orig<typeof import("../../src/pult/control.js")>()), waits: () => [] }));

const { testTable } = await import("../../src/pult/testtable.js");
const { buildTxModel } = await import("../../src/pult/tx.js");

const T0 = Date.UTC(2026, 10, 14, 12, 0, 0);
const at = (sec: number) => new Date(T0 + sec * 1000).toISOString();
const rec = (seq: number, sec: number, ref: string, o: Partial<Interpretation> = {}): Interpretation =>
  ({ seq, at: at(sec), stream: "scenario", ref, level: "key", stage: "mandate", actor: "agent", emulated: false, kind: "norm", phrase: { ru: ref, en: ref }, ...o }) as Interpretation;
const intent = (signedAfter?: number) => [
  rec(1, 0, "run.intent"),
  rec(2, 1, "intent.created", { ids: { mandate_id: "mnd_r" } }),
  rec(3, 1, "intent.awaiting_signature", { ids: { mandate_id: "mnd_r" } }),
  ...(signedAfter === undefined ? [] : [rec(4, 1 + signedAfter, "mandate.signed", { stream: "monitor", source: "pao_event", ids: { mandate_id: "mnd_r" } })]),
];
const u01 = (items: Interpretation[]) => testTable({ items, model: buildTxModel(items), verdicts: [], now: at(600) }).rows.find((r) => r.test === "У-01")!;

describe("У-01…У-03: признак ситуации — по шине, не через `waits()`", () => {
  it("на шине клиент медлил 19 с, а «Идёт к нарушению» (сломанный `waits()`) не показан — «нет» с причиной", () => {
    const r = u01(intent(19));
    expect(r.agree).toBe("no");
    expect(r.fact.ru).toContain("на шине ожидание дошло до порога");
    expect(r.fact.en).toContain("on the bus the wait reached the threshold");
  });
  it("на шине клиент подписал за 4 с — ситуации нет: «не проверено», как и при исправном пульте", () => {
    expect(u01(intent(4)).agree).toBe("unchecked");
  });
  it("подписи нет до конца — ожидание тянется до «сейчас»: ситуация есть — «нет»", () => {
    expect(u01(intent()).agree).toBe("no");
  });
  it("У-02 (согласие корзины) и У-03 (запрос подтверждения): на шине — до порога, «Идёт к нарушению» нет — «нет»; закрыто быстро — «не проверено»", () => {
    const row = (items: Interpretation[], test: "У-02" | "У-03") => testTable({ items, model: buildTxModel(items), verdicts: [], now: at(600) }).rows.find((r) => r.test === test)!;
    const cart = (after: number) => [
      rec(10, 100, "run.purchase"),
      rec(11, 101, "cart.created", { ids: { mandate_id: "crt_r", intent_id: "mnd_x" } }),
      rec(12, 101, "cart.awaiting_signature", { ids: { mandate_id: "crt_r" } }),
      rec(13, 101 + after, "mandate.signed", { stream: "monitor", source: "pao_event", ids: { mandate_id: "crt_r" } }),
    ];
    expect(row(cart(30), "У-02").agree).toBe("no");
    expect(row(cart(3), "У-02").agree).toBe("unchecked");
    const conf = (after: number) => [
      rec(20, 200, "run.upk"),
      rec(21, 201, "cart.created", { ids: { mandate_id: "crt_q", intent_id: "mnd_y" } }),
      rec(22, 202, "confirmation.required", { stream: "monitor", source: "pao_event", ids: { confirmation_id: "cnf_q", mandate_id: "crt_q" } }),
      rec(23, 202 + after, "confirmation.approved", { stream: "monitor", source: "pao_event", ids: { confirmation_id: "cnf_q", mandate_id: "crt_q" } }),
    ];
    expect(row(conf(30), "У-03").agree).toBe("no");
    expect(row(conf(3), "У-03").agree).toBe("unchecked");
  });
});
