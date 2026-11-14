// П-2.2 (модель пульта 1.23 `renderGraph`): «График» — отрезки стадий по времени, «Завершены» — с события итога Платформы,
// метки — записи с ошибкой, конфликтом, фродом; поручение без покупки — своей строкой.
import { describe, expect, it } from "vitest";
import type { Interpretation, TxIds } from "../../src/dashboards/interpret.js";
import { graphView } from "../../src/pult/graph.js";
import { buildTxModel } from "../../src/pult/tx.js";

let seq = 0;
const at = (n: number) => new Date(Date.UTC(2026, 10, 10, 12, 0, n)).toISOString();
function rec(stream: Interpretation["stream"], ref: string, ids: TxIds, o: Partial<Pick<Interpretation, "stage" | "level" | "source" | "kind">> = {}): Interpretation {
  const n = ++seq;
  return {
    seq: n,
    at: at(n),
    stream,
    ref,
    level: o.level ?? "key",
    stage: o.stage ?? "payment",
    actor: "agent",
    emulated: false,
    kind: o.kind ?? "norm",
    phrase: { ru: ref, en: ref },
    ...(Object.keys(ids).length > 0 && { ids }),
    ...(o.source !== undefined && { source: o.source }),
  };
}
const step = (ref: string, ids: TxIds, o: Parameters<typeof rec>[3] = {}) => rec("scenario", ref, ids, o);
const event = (ref: string, ids: TxIds, o: Parameters<typeof rec>[3] = {}) => rec("monitor", ref, ids, { ...o, source: "pao_event" });
const view = (items: Interpretation[], limit?: number) => graphView(buildTxModel(items), items, limit);

describe("«График» пульта (П-2.2)", () => {
  it("отрезки стадий по времени: начало — запись, которая перевела в стадию; конец — начало следующей; «Завершены» — с события итога", () => {
    const cart = step("cart.created", { mandate_id: "C1", intent_id: "I1" }, { stage: "cart" });
    const order = step("order.placed", { order_id: "O1", mandate_id: "C1" }, { stage: "payment" });
    const started = step("payment.started", { order_id: "O1" }, { stage: "payment" });
    const paid = event("operation.authorized", { op_ref: "P1", order_id: "O1" }, { stage: "outcome" });
    const fin = step("outcome", { op_ref: "P1", order_id: "O1", mandate_id: "C1" }, { stage: "outcome" });
    const g = view([cart, order, started, paid, fin]);
    expect(g.rows).toHaveLength(1);
    expect(g.rows[0]!.segs).toEqual([
      { col: "cart", from: cart.at, to: order.at },
      { col: "pay", from: order.at, to: paid.at },
      { col: "done", from: paid.at },
    ]);
  });

  it("без события итога — последний отрезок открыт (идёт до «сейчас»); шаг сюжета outcome — «Итог», не «Завершены»", () => {
    const cart = step("cart.created", { mandate_id: "C2", intent_id: "I2" }, { stage: "cart" });
    const fin = step("outcome", { op_ref: "P2", order_id: "O2", mandate_id: "C2" }, { stage: "outcome" });
    const g = view([cart, fin]);
    expect(g.rows[0]!.segs).toEqual([
      { col: "cart", from: cart.at, to: fin.at },
      { col: "result", from: fin.at },
    ]);
  });

  it("метки — ключевые записи с ошибкой, конфликтом, фродом; служебные и нормальные — без меток", () => {
    const cart = step("cart.created", { mandate_id: "C3", intent_id: "I3" }, { stage: "cart" });
    const bad = step("order.placed", { order_id: "O3", mandate_id: "C3" }, { kind: "error" });
    const noise = rec("monitor", "GET /v1/shops/{shop_id}/orders/{order_id}", { order_id: "O3" }, { kind: "conflict", level: "detail", source: "agent_merchant" });
    const g = view([cart, bad, noise]);
    expect(g.rows[0]!.marks).toEqual([{ at: bad.at, kind: "error" }]);
  });

  it("поручение без покупки — своя строка; отозвано — «Завершены» с события mandate.revoked; с покупкой — строки поручения нет", () => {
    const wait = step("intent.awaiting_signature", { mandate_id: "I4" }, { stage: "mandate" });
    const rev = event("mandate.revoked", { mandate_id: "I4" }, { stage: "revoke" });
    const g = view([wait, rev]);
    expect(g.rows).toEqual([expect.objectContaining({ id: "I4", kind: "mandate" })]);
    expect(g.rows[0]!.segs).toEqual([
      { col: "mandate", from: wait.at, to: rev.at },
      { col: "done", from: rev.at },
    ]);
    const bought = view([step("intent.awaiting_signature", { mandate_id: "I5" }, { stage: "mandate" }), step("cart.created", { mandate_id: "C5", intent_id: "I5" }, { stage: "cart" })]);
    expect(bought.rows.map((r) => [r.id, r.kind])).toEqual([["C5", "tx"]]);
  });

  it("ревью П-2.2 № 1: «оплачено» → «проведено» — «Завершены» с первого итогового события (как на доске)", () => {
    const cart = step("cart.created", { mandate_id: "C6", intent_id: "I6" }, { stage: "cart" });
    const paid = event("operation.authorized", { op_ref: "P6", order_id: "O6" }, { stage: "outcome" });
    const fin = step("outcome", { op_ref: "P6", order_id: "O6", mandate_id: "C6" }, { stage: "outcome" });
    const settled = event("operation.settled", { op_ref: "P6" }, { stage: "outcome" });
    const items = [cart, step("order.placed", { order_id: "O6", mandate_id: "C6" }), paid, fin, settled];
    const model = buildTxModel(items);
    expect(model.txs[0]!.outcome).toMatchObject({ kind: "settled", at: paid.at, seq: paid.seq });
    expect(view(items).rows[0]!.segs.at(-1)).toEqual({ col: "done", from: paid.at });
  });

  it("ревью П-2.2 № 3: время событий Платформы не по seq — отрезки монотонны, конец не раньше начала", () => {
    const cart = step("cart.created", { mandate_id: "C7", intent_id: "I7" }, { stage: "cart" });
    const order = step("order.placed", { order_id: "O7", mandate_id: "C7" }, { stage: "payment" });
    // Событие Платформы с часами раньше записи заказа.
    const early = { ...event("operation.authorized", { op_ref: "P7", order_id: "O7" }, { stage: "outcome" }), at: cart.at };
    const fin = step("outcome", { op_ref: "P7", order_id: "O7", mandate_id: "C7" }, { stage: "outcome" });
    const segs = view([cart, order, early, fin]).rows[0]!.segs;
    for (let i = 0; i < segs.length; i++) {
      if (segs[i]!.to) expect(Date.parse(segs[i]!.to!)).toBeGreaterThanOrEqual(Date.parse(segs[i]!.from));
      if (i > 0) expect(segs[i]!.from).toBe(segs[i - 1]!.to);
    }
    expect(segs.at(-1)).toMatchObject({ col: "done", from: order.at });
  });

  it("ревью П-2.2 № 5, № 9: строка без отрезков места не занимает; конфликт звеньев — без «Завершены»", () => {
    const noise = rec("monitor", "GET /v1/shops/{shop_id}/orders/{order_id}", { order_id: "OX" }, { level: "detail", source: "network_merchant" });
    const real = step("cart.created", { mandate_id: "C8", intent_id: "I8" }, { stage: "cart" });
    expect(view([real, noise], 1).rows.map((r) => r.id)).toEqual(["C8"]);
    const conflict = view([
      step("cart.created", { mandate_id: "CA", intent_id: "IA" }, { stage: "cart" }),
      step("order.placed", { order_id: "O1", mandate_id: "CA" }),
      step("order.placed", { order_id: "O1", mandate_id: "CB" }),
      event("operation.authorized", { op_ref: "PB", order_id: "O1" }, { stage: "outcome" }),
      step("outcome", { op_ref: "PB", order_id: "O1", mandate_id: "CB" }, { stage: "outcome" }),
    ]);
    expect(conflict.rows[0]!.segs.some((s) => s.col === "done")).toBe(false);
  });

  it("строк — не больше limit, последние по началу", () => {
    const items = [1, 2, 3, 4].map((i) => step("cart.created", { mandate_id: `C${10 + i}`, intent_id: `I${10 + i}` }, { stage: "cart" }));
    expect(view(items, 2).rows.map((r) => r.id)).toEqual(["C13", "C14"]);
  });
});
