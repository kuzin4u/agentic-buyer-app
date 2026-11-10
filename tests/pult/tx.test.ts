// П-1.2 (модель пульта 1.23, Р-1442, Р-1396 п. 2): модель транзакций пульта — по идентификаторам, а не по времени; итог —
// только по событию Платформы (инвариант 6). Записи — интерпретации в форме линии; живые сюжеты 1–5 — в
// tests/demo/interpret-live.test.ts.
import { describe, expect, it } from "vitest";
import type { Interpretation, TxIds } from "../../src/dashboards/interpret.js";
import { buildTxModel } from "../../src/pult/tx.js";

let seq = 0;
const at = (n: number) => new Date(Date.UTC(2026, 10, 10, 12, 0, n)).toISOString();

function rec(
  stream: Interpretation["stream"],
  ref: string,
  ids: TxIds,
  o: Partial<Pick<Interpretation, "kind" | "stage" | "level" | "who" | "source">> = {},
): Interpretation {
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
    ...(o.who && { who: o.who }),
    ...(o.source !== undefined && { source: o.source }),
  };
}
const step = (ref: string, ids: TxIds, o: Parameters<typeof rec>[3] = {}) => rec("scenario", ref, ids, o);
const event = (ref: string, ids: TxIds, o: Parameters<typeof rec>[3] = {}) => rec("monitor", ref, ids, { ...o, source: "pao_event" });
const who = (code: string): Interpretation["who"] => ({ code, status: "found", side: ["bank"], verdict: "expected" });

describe("модель транзакций пульта (П-1.2)", () => {
  it("звенья одной покупки связываются по идентификаторам: корзина → заказ → операция → подтверждение; поручение — по intent_id", () => {
    const m = buildTxModel([
      step("intent.awaiting_signature", { mandate_id: "I1" }, { stage: "mandate" }),
      event("mandate.signed", { mandate_id: "I1" }, { stage: "mandate" }),
      step("cart.created", { mandate_id: "C1", intent_id: "I1" }, { stage: "cart" }),
      event("mandate.signed", { mandate_id: "C1" }, { stage: "cart" }),
      step("order.placed", { order_id: "O1", mandate_id: "C1", merchant_id: "MER-1" }),
      event("confirmation.requested", { confirmation_id: "Q1", order_id: "O1" }, { stage: "confirmation" }),
      event("operation.authorized", { op_ref: "P1", order_id: "O1" }, { stage: "outcome" }),
    ]);
    expect(m.txs).toHaveLength(1);
    const t = m.txs[0]!;
    expect(t).toMatchObject({ id: "C1", intentId: "I1", cartMandateId: "C1", orderIds: ["O1"], opRefs: ["P1"], confirmationIds: ["Q1"], merchantId: "MER-1", stage: "outcome" });
    expect(t.outcome?.kind).toBe("paid");
    expect(m.mandates).toEqual([expect.objectContaining({ id: "I1", status: "active", txIds: ["C1"] })]);
    expect(m.unattached).toEqual([]);
  });

  it("итог — только по событию Платформы: шаг сюжета outcome, шаг ответа витрины и обращение агента к операции итогом не являются (инвариант 6)", () => {
    const m = buildTxModel([
      step("cart.created", { mandate_id: "C2", intent_id: "I2" }),
      step("order.placed", { order_id: "O2", mandate_id: "C2" }),
      step("order.shop_reply", { order_id: "O2" }),
      step("outcome", { op_ref: "P2", order_id: "O2" }, { stage: "outcome" }),
      rec("monitor", "operation.authorized", { op_ref: "P2" }, { source: "agent_platform" }),
    ]);
    expect(m.txs).toHaveLength(1);
    expect(m.txs[0]!.opRefs).toEqual(["P2"]);
    expect(m.txs[0]!.outcome).toBeUndefined();
  });

  it("отказ: событие operation.declined несёт только op_ref — с заказом его связывает шаг limit.declined; код — из квалификации", () => {
    const m = buildTxModel([
      step("cart.created", { mandate_id: "C3", intent_id: "I3" }),
      step("order.placed", { order_id: "O3", mandate_id: "C3" }),
      event("operation.declined", { op_ref: "P3" }, { kind: "conflict", who: who("LIMIT_EXCEEDED"), stage: "outcome" }),
      step("limit.declined", { order_id: "O3", op_ref: "P3" }, { stage: "outcome" }),
    ]);
    expect(m.txs).toHaveLength(1);
    expect(m.txs[0]).toMatchObject({ id: "C3", orderIds: ["O3"], opRefs: ["P3"], worst: "conflict" });
    expect(m.txs[0]!.outcome).toMatchObject({ kind: "declined", code: "LIMIT_EXCEEDED" });
  });

  it("две покупки вперемешку по времени — две транзакции: принадлежность по идентификаторам, а не по соседству записей (Р-1396 п. 2)", () => {
    const m = buildTxModel([
      step("cart.created", { mandate_id: "CA", intent_id: "IA" }),
      step("cart.created", { mandate_id: "CB", intent_id: "IB" }),
      step("order.placed", { order_id: "OB", mandate_id: "CB" }),
      step("order.placed", { order_id: "OA", mandate_id: "CA" }),
      event("operation.declined", { op_ref: "PB", order_id: "OB" }),
      event("operation.authorized", { op_ref: "PA", order_id: "OA" }),
    ]);
    expect(m.txs.map((t) => [t.id, t.intentId, t.orderIds, t.opRefs, t.outcome?.kind])).toEqual([
      ["CA", "IA", ["OA"], ["PA"], "paid"],
      ["CB", "IB", ["OB"], ["PB"], "declined"],
    ]);
  });

  it("поручение: создано → ждёт подписи → действует → отозвано по событиям Платформы; записи без звеньев — вне транзакций", () => {
    const m = buildTxModel([
      step("run.intent", {}, { stage: "service", level: "detail" }),
      step("intent.created", { mandate_id: "I4" }, { stage: "mandate" }),
      step("intent.awaiting_signature", { mandate_id: "I4" }, { stage: "mandate" }),
      rec("console", "purchase.stage", { mandate_id: "I4" }, { stage: "search", level: "detail" }),
      step("search.picked", { merchant_id: "MER-2" }, { stage: "search" }),
      event("mandate.signed", { mandate_id: "I4" }, { stage: "mandate" }),
      event("mandate.revoked", { mandate_id: "I4" }, { stage: "revoke" }),
    ]);
    expect(m.txs).toEqual([]);
    expect(m.mandates).toHaveLength(1);
    expect(m.mandates[0]).toMatchObject({ id: "I4", status: "revoked", txIds: [], stage: "revoke" });
    expect(m.mandates[0]!.seqs).toHaveLength(5);
    // Метка прогона и шаг поиска без поручения — вне поручений и транзакций.
    expect(m.unattached).toHaveLength(2);
  });

  it("блокер ревью № 1: витрина повторила номер оплаченного заказа — две корзины не сливаются молча: «конфликт звеньев», итога нет", () => {
    const m = buildTxModel([
      step("cart.created", { mandate_id: "CA", intent_id: "IA" }),
      step("order.placed", { order_id: "O1", mandate_id: "CA" }),
      event("operation.authorized", { op_ref: "PA", order_id: "O1" }),
      step("outcome", { op_ref: "PA", order_id: "O1", mandate_id: "CA" }),
      step("cart.created", { mandate_id: "CB", intent_id: "IB" }),
      step("order.placed", { order_id: "O1", mandate_id: "CB" }),
      step("intent.awaiting_signature", { mandate_id: "IA" }, { stage: "mandate" }),
      step("intent.awaiting_signature", { mandate_id: "IB" }, { stage: "mandate" }),
    ]);
    expect(m.txs).toHaveLength(1);
    const t = m.txs[0]!;
    expect(t.linkConflict).toEqual({ carts: ["CA", "CB"], intents: ["IA", "IB"] });
    expect(t.outcome).toBeUndefined();
    expect(t.cartMandateId).toBeUndefined();
    expect(t.intentId).toBeUndefined();
    expect(t.worst).toBe("conflict");
    // Транзакция видна у обоих поручений — человек её не потеряет.
    expect(m.mandates.map((x) => [x.id, x.txIds])).toEqual([
      ["IA", [t.id]],
      ["IB", [t.id]],
    ]);
  });

  it("пустой идентификатор звеном не считается: две покупки с order_id \"\" — две транзакции (ревью № 6)", () => {
    const m = buildTxModel([
      step("cart.created", { mandate_id: "C7", intent_id: "I7" }),
      step("order.placed", { order_id: "", mandate_id: "C7" }),
      step("cart.created", { mandate_id: "C8", intent_id: "I8" }),
      step("order.placed", { order_id: "", mandate_id: "C8" }),
      event("operation.declined", { op_ref: "", order_id: "" }),
    ]);
    expect(m.txs.map((t) => t.id)).toEqual(["C7", "C8"]);
    expect(m.txs.every((t) => t.orderIds.length === 0 && t.linkConflict === undefined)).toBe(true);
    expect(m.unattached).toHaveLength(1);
  });

  it("номер транзакции без корзины — с типом звена и не совпадает с номером корзины (ревью № 8); запись поручения до шага корзины — в транзакции", () => {
    const m = buildTxModel([
      event("mandate.signed", { mandate_id: "Z" }, { stage: "cart" }),
      step("cart.created", { mandate_id: "Z", intent_id: "I9" }),
      event("operation.declined", { op_ref: "Z" }),
    ]);
    expect(m.txs.map((t) => t.id).sort()).toEqual(["Z", "op:Z"]);
    // Событие подписи корзины пришло раньше шага, объявившего Z корзиной, — всё равно в транзакции Z.
    expect(m.txs.find((t) => t.id === "Z")!.seqs).toHaveLength(2);
  });

  it("отзыв поручения корзины событием Платформы — итог «отозвано»; первый итог не перезаписывается, settled уточняет paid", () => {
    const revoked = buildTxModel([step("cart.created", { mandate_id: "C5", intent_id: "I5" }), event("mandate.revoked", { mandate_id: "C5" })]);
    expect(revoked.txs[0]!.outcome?.kind).toBe("revoked");
    const settled = buildTxModel([
      step("order.placed", { order_id: "O6", mandate_id: "C6" }),
      event("operation.authorized", { op_ref: "P6", order_id: "O6" }),
      event("operation.settled", { op_ref: "P6" }),
      event("operation.declined", { op_ref: "P6" }),
    ]);
    expect(settled.txs[0]!.outcome?.kind).toBe("settled");
  });
});
