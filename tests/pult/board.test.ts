// П-2.1 (модель пульта 1.23 v1.20): доска «Ход по стадиям» — колонка карточки по модели транзакций, «Завершены» — только по
// итогу из события Платформы; лента пульта — переходы «скачком, по событию», время в стадии, сброс источника.
import { describe, expect, it } from "vitest";
import type { FeedEvent, InterpretFeed } from "../../src/dashboards/feed.js";
import type { Interpretation, TxIds } from "../../src/dashboards/interpret.js";
import { boardView, BOARD_COLUMNS } from "../../src/pult/board.js";
import { createPultFeed, type PultFeedEvent } from "../../src/pult/feed.js";
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
    phrase: { ru: `ру ${ref}`, en: `en ${ref}` },
    ...(Object.keys(ids).length > 0 && { ids }),
    ...(o.source !== undefined && { source: o.source }),
  };
}
const step = (ref: string, ids: TxIds, o: Parameters<typeof rec>[3] = {}) => rec("scenario", ref, ids, o);
const event = (ref: string, ids: TxIds, o: Parameters<typeof rec>[3] = {}) => rec("monitor", ref, ids, { ...o, source: "pao_event" });
const view = (items: Interpretation[]) => boardView(buildTxModel(items), items);

describe("доска «Ход по стадиям» (П-2.1)", () => {
  it("колонки — как в модели 1.23: Поручение, Подбор, Корзина, Подтверждение, Реквизит и оплата, Итог, После операции, Завершены", () => {
    expect(BOARD_COLUMNS).toEqual(["mandate", "select", "cart", "confirmation", "pay", "result", "post", "done"]);
  });

  it("поручение без покупки — карточка поручения: «Поручение», в поиске — «Подбор», отозвано — «Завершены»; с покупкой — только транзакция", () => {
    const signing = [step("intent.awaiting_signature", { mandate_id: "I1" }, { stage: "mandate" })];
    expect(view(signing).cards).toEqual([expect.objectContaining({ id: "I1", kind: "mandate", column: "mandate" })]);
    const searching = [...signing, event("mandate.signed", { mandate_id: "I1" }, { stage: "mandate" }), rec("console", "offer.flagged", { mandate_id: "I1" }, { stage: "search" })];
    expect(view(searching).cards[0]).toMatchObject({ column: "select" });
    const revoked = [...searching, event("mandate.revoked", { mandate_id: "I1" }, { stage: "revoke" })];
    expect(view(revoked).cards[0]).toMatchObject({ kind: "mandate", column: "done" });
    const bought = [...searching, step("cart.created", { mandate_id: "C1", intent_id: "I1" }, { stage: "cart" })];
    expect(view(bought).cards).toEqual([expect.objectContaining({ id: "C1", kind: "tx", column: "cart", intentId: "I1" })]);
  });

  it("транзакция идёт по стадиям последней ключевой записи; «Завершены» — только по итогу события Платформы, шаг сюжета — «Итог»", () => {
    const base = [step("cart.created", { mandate_id: "C2", intent_id: "I2" }, { stage: "cart" }), step("order.placed", { order_id: "O2", mandate_id: "C2" }, { stage: "payment" })];
    expect(view(base).cards[0]).toMatchObject({ column: "pay" });
    const stepOnly = [...base, step("outcome", { op_ref: "P2", order_id: "O2", mandate_id: "C2" }, { stage: "outcome" })];
    expect(view(stepOnly).cards[0]).toMatchObject({ column: "result" });
    expect(view(stepOnly).cards[0]!.outcome).toBeUndefined();
    const authorized = event("operation.authorized", { op_ref: "P2", order_id: "O2" }, { stage: "outcome" });
    const paid = [...stepOnly, authorized];
    // seq итога — порядок «Завершены» (повторное ревью П-2.1 № 4): seq события итога, а не начала транзакции.
    expect(view(paid).cards[0]).toMatchObject({ column: "done", outcome: "paid", outcomeSeq: authorized.seq });
    expect(view(paid).cards[0]!.outcomeSeq).not.toBe(view(paid).cards[0]!.order);
    // Последняя ключевая запись — фраза ru/en; служебная не показывается.
    const withDetail = [...paid, rec("monitor", "GET /pao/v1/operations/{op_ref}", { op_ref: "P2" }, { level: "detail", source: "agent_platform" })];
    expect(view(withDetail).cards[0]!.last?.phrase).toEqual({ ru: "ру operation.authorized", en: "en operation.authorized" });
  });

  it("конфликт звеньев и связь, не подтверждённая агентом, — на карточке; итога нет", () => {
    const conflict = view([
      step("cart.created", { mandate_id: "CA", intent_id: "IA" }),
      step("order.placed", { order_id: "O1", mandate_id: "CA" }),
      step("order.placed", { order_id: "O1", mandate_id: "CB" }),
    ]);
    expect(conflict.cards[0]).toMatchObject({ linkConflict: true, worst: "conflict" });
    expect(conflict.cards[0]!.outcome).toBeUndefined();
    const unconfirmed = view([step("order.placed", { order_id: "OU", mandate_id: "CU" }), event("operation.authorized", { op_ref: "PX", order_id: "OU" })]);
    expect(unconfirmed.cards[0]).toMatchObject({ unconfirmed: true });
    expect(unconfirmed.cards[0]!.column).not.toBe("done");
  });
});

/** Лента интерпретатора на заглушке: список (не длиннее window — как вытеснение по limit), подписка, события. */
function fakeFeed(window = Infinity) {
  const items: Interpretation[] = [];
  const ls = new Set<(e: FeedEvent) => void>();
  const feed: InterpretFeed = {
    list: () => [...items],
    status: () => "open",
    diag: () => ({ state: "ready" }),
    subscribe: (l) => (ls.add(l), () => ls.delete(l)),
    close: async () => undefined,
  };
  return {
    feed,
    push(...rs: Interpretation[]) {
      for (const r of rs) {
        items.push(r);
        if (items.length > window) items.splice(0, items.length - window);
        for (const l of ls) l({ type: "item", item: r });
      }
    },
    reset() {
      items.length = 0;
      for (const l of ls) l({ type: "reset" });
    },
    status(s: "closed") {
      for (const l of ls) l({ type: "status", status: s });
    },
    listeners: () => ls.size,
  };
}
const tick = () => new Promise((r) => setTimeout(r, 5));

describe("лента пульта (П-2.1)", () => {
  it("переход карточки между колонками — «скачком, по событию»: время перехода и «в стадии с» — время записи, которая его вызвала", async () => {
    const f = fakeFeed();
    const now = new Date("2026-11-10T12:30:00Z");
    const p = createPultFeed(f.feed, { now: () => now, debounceMs: 0 });
    const got: PultFeedEvent[] = [];
    p.subscribe((e) => got.push(e));
    const created = step("cart.created", { mandate_id: "C9", intent_id: "I9" }, { stage: "cart" });
    f.push(created);
    await tick();
    expect(p.board().cards[0]).toMatchObject({ id: "C9", column: "cart", since: created.at });
    expect(p.board().jumps).toEqual([]);
    const order = step("order.placed", { order_id: "O9", mandate_id: "C9" }, { stage: "payment" });
    f.push(order);
    await tick();
    expect(p.board().cards[0]).toMatchObject({ column: "pay", since: order.at });
    expect(p.board().jumps).toEqual([{ at: order.at, id: "C9", from: "cart", to: "pay" }]);
    expect(p.board().now).toBe(now.toISOString());
    // Запись без смены колонки — время в стадии прежнее.
    f.push(step("payment.started", { order_id: "O9" }, { stage: "payment" }));
    await tick();
    expect(p.board().cards[0]).toMatchObject({ column: "pay", since: order.at });
    expect(got.filter((e) => e.type === "board").length).toBeGreaterThanOrEqual(3);
    p.close();
  });

  it("пересчёт — один на пачку записей; состояние источника передаётся", async () => {
    const f = fakeFeed();
    const p = createPultFeed(f.feed, { now: () => new Date(), debounceMs: 20 });
    let boards = 0;
    p.subscribe((e) => {
      if (e.type === "board") boards++;
    });
    f.push(step("cart.created", { mandate_id: "CA", intent_id: "IA" }, { stage: "cart" }), step("order.placed", { order_id: "OA", mandate_id: "CA" }), step("payment.started", { order_id: "OA" }));
    await new Promise((r) => setTimeout(r, 60));
    expect(boards).toBe(1);
    const statuses: string[] = [];
    p.subscribe((e) => {
      if (e.type === "status") statuses.push(e.status);
    });
    f.status("closed");
    expect(statuses).toEqual(["closed"]);
    p.close();
  });

  it("сброс источника (ревью П-2.1 № 9): переходы очищены, карточка с тем же номером после сброса — без ложного перехода", async () => {
    const f = fakeFeed();
    const p = createPultFeed(f.feed, { now: () => new Date(), debounceMs: 0 });
    f.push(step("cart.created", { mandate_id: "CR", intent_id: "IR" }, { stage: "cart" }));
    await tick();
    f.push(step("order.placed", { order_id: "OR", mandate_id: "CR" }, { stage: "payment" }));
    await tick();
    expect(p.board().jumps).toHaveLength(1);
    f.reset();
    await tick();
    expect(p.board().cards).toEqual([]);
    expect(p.board().jumps).toEqual([]);
    // Тот же номер в новом экземпляре источника — сразу в «Реквизит и оплата»: перехода «Корзина → оплата» нет.
    f.push(step("order.placed", { order_id: "OR", mandate_id: "CR" }, { stage: "payment" }));
    await tick();
    expect(p.board().cards[0]).toMatchObject({ id: "CR", column: "pay" });
    expect(p.board().jumps).toEqual([]);
    p.close();
  });

  it("close при ожидающем пересчёте (ревью П-2.1 № 9): новой доски нет, подписка на ленту снята", async () => {
    const f = fakeFeed();
    const p = createPultFeed(f.feed, { now: () => new Date(), debounceMs: 30 });
    let boards = 0;
    p.subscribe((e) => {
      if (e.type === "board") boards++;
    });
    f.push(step("cart.created", { mandate_id: "CC", intent_id: "IC" }, { stage: "cart" }));
    expect(f.listeners()).toBe(1);
    p.close();
    await new Promise((r) => setTimeout(r, 60));
    expect(boards).toBe(0);
    expect(f.listeners()).toBe(0);
  });

  it("своё окно пульта (ревью П-2.1 № 3): начало покупки ушло из окна ленты интерпретатора — оплаченная карточка остаётся в «Завершены»", async () => {
    const f = fakeFeed(2);
    const p = createPultFeed(f.feed, { now: () => new Date(), debounceMs: 0 });
    f.push(
      step("cart.created", { mandate_id: "CW", intent_id: "IW" }, { stage: "cart" }),
      step("order.placed", { order_id: "OW", mandate_id: "CW" }),
      event("operation.authorized", { op_ref: "PW", order_id: "OW" }, { stage: "outcome" }),
      step("outcome", { op_ref: "PW", order_id: "OW", mandate_id: "CW" }, { stage: "outcome" }),
    );
    await tick();
    // В окне интерпретатора — только последние две записи: без пульта корзина и заказ потерялись бы.
    expect(f.feed.list()).toHaveLength(2);
    expect(p.board().cards).toEqual([expect.objectContaining({ id: "CW", column: "done", outcome: "paid" })]);
    p.close();
  });

  it("предел своего окна пульта (повторное ревью П-2.1 № 2): старые записи уходят, порядок по seq сохраняется, повтор seq не добавляется", async () => {
    const f = fakeFeed();
    const p = createPultFeed(f.feed, { now: () => new Date(), debounceMs: 0, limit: 3 });
    const a = step("cart.created", { mandate_id: "C1", intent_id: "I1" }, { stage: "cart" });
    const b = step("cart.created", { mandate_id: "C2", intent_id: "I2" }, { stage: "cart" });
    const c = step("cart.created", { mandate_id: "C3", intent_id: "I3" }, { stage: "cart" });
    const d = step("cart.created", { mandate_id: "C4", intent_id: "I4" }, { stage: "cart" });
    // Пришли не по порядку: d, b, a, c. В окне — три старших по seq (b, c, d): a вытеснена.
    f.push(d, b, a, c);
    await tick();
    expect(p.board().cards.map((x) => x.id)).toEqual(["C2", "C3", "C4"]);
    p.close();
    // Повтор seq места не занимает: при limit 3 и a, b, b, c — все три (без защиты дубль b вытеснил бы a).
    const g = fakeFeed();
    const q = createPultFeed(g.feed, { now: () => new Date(), debounceMs: 0, limit: 3 });
    g.push(a, b, b, c);
    await tick();
    expect(q.board().cards.map((x) => x.id)).toEqual(["C1", "C2", "C3"]);
    q.close();
  });
});
