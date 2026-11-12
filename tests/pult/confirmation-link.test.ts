// П-11.5в (ревью № 2): поручение корзины в событии подтверждения меняет итог транзакции пульта уже до П-8.1 — закреплено здесь.
// Без `mandate_id` корзины `confirmation.rejected` (по ПАО 1.4.0 — только `confirmation_id`; шина добавляет номер заказа) —
// «связь не подтверждена», итога нет (Р-1460). С `mandate_id` корзины (шина берёт его из записи подтверждения Платформы) —
// итог «подтверждение отклонено». Если окно А в П-8.1 поменяет ветку подтверждений в `src/pult/tx.ts`, тест это покажет.
import { describe, expect, it } from "vitest";
import type { Interpretation } from "../../src/dashboards/interpret.js";
import { buildTxModel } from "../../src/pult/tx.js";

const at = (s: number) => new Date(Date.UTC(2026, 10, 12, 12, 0, s)).toISOString();
const rec = (seq: number, o: Partial<Interpretation>): Interpretation =>
  ({ seq, at: at(seq), level: "key", stage: "cart", actor: "agent", emulated: false, kind: "norm", phrase: { ru: "", en: "" }, ...o }) as Interpretation;

const purchase = (event: Partial<Interpretation>): Interpretation[] => [
  rec(1, { stream: "scenario", ref: "cart.created", ids: { mandate_id: "mnd_cart", intent_id: "mnd_intent" } }),
  rec(2, { stream: "scenario", ref: "order.placed", stage: "payment", ids: { order_id: "ORD-1", mandate_id: "mnd_cart" } }),
  rec(3, { stream: "monitor", source: "pao_event", ref: "confirmation.required", stage: "confirmation", actor: "platform", ids: { confirmation_id: "cnf_1", order_id: "ORD-1" } }),
  rec(4, { stream: "monitor", source: "pao_event", ref: "confirmation.rejected", stage: "confirmation", actor: "platform", ...event }),
];

describe("П-11.5в: событие подтверждения с поручением корзины — итог транзакции", () => {
  it("без mandate_id корзины — «связь не подтверждена», итога нет (как до П-11.5в)", () => {
    const tx = buildTxModel(purchase({ ids: { confirmation_id: "cnf_1", order_id: "ORD-1" } })).txs.find((t) => t.cartMandateId === "mnd_cart")!;
    expect(tx.outcome).toBeUndefined();
    expect(tx.unconfirmedConfirmations).toEqual(["cnf_1"]);
  });

  it("с mandate_id корзины (из записи подтверждения, П-11.5в) — итог «подтверждение отклонено», без «связь не подтверждена»", () => {
    const tx = buildTxModel(purchase({ ids: { confirmation_id: "cnf_1", order_id: "ORD-1", mandate_id: "mnd_cart" } })).txs.find((t) => t.cartMandateId === "mnd_cart")!;
    expect(tx.outcome).toMatchObject({ kind: "rejected", seq: 4 });
    expect(tx.unconfirmedConfirmations ?? []).toEqual([]);
  });

  it("с mandate_id чужой корзины — по-прежнему «связь не подтверждена»", () => {
    const tx = buildTxModel(purchase({ ids: { confirmation_id: "cnf_1", order_id: "ORD-1", mandate_id: "mnd_other" } })).txs.find((t) => t.cartMandateId === "mnd_cart");
    expect(tx?.outcome).toBeUndefined();
  });
});
