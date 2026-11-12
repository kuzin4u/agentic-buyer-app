// П-2.1 (модель пульта 1.23 v1.20): доска «Ход по стадиям» — колонка карточки по модели транзакций, «Завершены» — только по
// итогу из события Платформы; лента пульта — переходы «скачком, по событию», время в стадии, сброс источника.
import { describe, expect, it } from "vitest";
import type { FeedEvent, InterpretFeed } from "../../src/dashboards/feed.js";
import type { Interpretation, TxIds } from "../../src/dashboards/interpret.js";
import { boardView, BOARD_COLUMNS } from "../../src/pult/board.js";
import { evaluate, HIDDEN_RECORD } from "../../src/pult/engine.js";
import { createControlFeed } from "../../src/dashboards/control-feed.js";
import { createPultFeed, type PultFeedEvent } from "../../src/pult/feed.js";
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
    const base = [step("cart.created", { mandate_id: "C2", intent_id: "I2" }, { stage: "cart" }), step("order.placed", { order_id: "O2", mandate_id: "C2", merchant_id: "MER-9" }, { stage: "payment" })];
    // Продавец покупки — для разреза «продавец» (П-2.3).
    expect(view(base).cards[0]).toMatchObject({ column: "pay", merchantIds: ["MER-9"] });
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
    // До шага итога агента — «ждём шаг агента»; после шага без связи — «связь не подтверждена» (П-3.2а).
    const pending = view([step("order.placed", { order_id: "OU", mandate_id: "CU" }), event("operation.authorized", { op_ref: "PX", order_id: "OU" })]);
    expect(pending.cards[0]).toMatchObject({ pending: true });
    expect(pending.cards[0]!.unconfirmed).toBeUndefined();
    expect(pending.cards[0]!.column).not.toBe("done");
    const unconfirmed = view([
      step("order.placed", { order_id: "OU", mandate_id: "CU" }),
      event("operation.authorized", { op_ref: "PX", order_id: "OU" }),
      step("outcome", { op_ref: "PX", order_id: "OU" }),
    ]);
    expect(unconfirmed.cards[0]).toMatchObject({ unconfirmed: true });
    expect(unconfirmed.cards[0]!.pending).toBeUndefined();
    expect(unconfirmed.cards[0]!.column).not.toBe("done");
  });

  it("ревью П-2.1 № 6: доска и «График» — один код: колонка карточки = колонка последнего отрезка строки, время входа = его начало", () => {
    const items = [
      // Поручение без покупки в поиске; отозванное поручение без покупки.
      step("intent.awaiting_signature", { mandate_id: "IS" }, { stage: "mandate" }),
      rec("console", "purchase.stage", { mandate_id: "IS" }, { stage: "search" }),
      step("intent.awaiting_signature", { mandate_id: "IR" }, { stage: "mandate" }),
      event("mandate.revoked", { mandate_id: "IR" }, { stage: "revoke" }),
      // Поручения без покупки на стадиях корзины и оплаты — у доски «Подбор» и «Поручение»; «График» — то же (П-3.2г,
      // повторное ревью № 2: раньше «График» брал колонку стадии — «Корзина», «Реквизит и оплата»).
      step("intent.awaiting_signature", { mandate_id: "IC" }, { stage: "mandate" }),
      rec("console", "purchase.stage", { mandate_id: "IC" }, { stage: "cart" }),
      step("intent.awaiting_signature", { mandate_id: "IY" }, { stage: "mandate" }),
      rec("console", "purchase.stage", { mandate_id: "IY" }, { stage: "payment" }),
      // Оплаченная покупка, покупка в оплате, покупка с конфликтом звеньев.
      step("cart.created", { mandate_id: "CP", intent_id: "IP" }, { stage: "cart" }),
      step("order.placed", { order_id: "OP", mandate_id: "CP" }),
      event("operation.authorized", { op_ref: "PP", order_id: "OP" }, { stage: "outcome" }),
      step("outcome", { op_ref: "PP", order_id: "OP", mandate_id: "CP" }, { stage: "outcome" }),
      step("cart.created", { mandate_id: "CW", intent_id: "IW" }, { stage: "cart" }),
      step("order.placed", { order_id: "OW", mandate_id: "CW" }),
      step("order.placed", { order_id: "OK", mandate_id: "CK1" }),
      step("order.placed", { order_id: "OK", mandate_id: "CK2" }, { stage: "confirmation" }),
    ];
    const model = buildTxModel(items);
    const cards = boardView(model, items).cards;
    const rows = new Map(graphView(model, items).rows.map((r) => [r.id, r]));
    expect(cards.length).toBeGreaterThanOrEqual(7);
    expect(cards.filter((c) => c.kind === "mandate").map((c) => [c.id, c.column])).toEqual([
      ["IS", "select"],
      ["IR", "done"],
      ["IC", "select"],
      ["IY", "mandate"],
    ]);
    for (const c of cards) {
      const last = rows.get(c.id)?.segs.at(-1);
      expect(last?.col, c.id).toBe(c.column);
      expect(last?.from, c.id).toBe(c.enteredAt);
    }
  });

  it("П-3.2а: «оплачено» после отзыва и два списания — на карточке и строке «Графика»; операции — на карточке при повторе", () => {
    const items = [
      step("order.placed", { order_id: "OF", mandate_id: "CF" }),
      event("mandate.revoked", { mandate_id: "CF" }, { stage: "revoke" }),
      event("operation.authorized", { op_ref: "PF1", order_id: "OF" }),
      step("outcome", { op_ref: "PF1", order_id: "OF", mandate_id: "CF" }),
      event("operation.authorized", { op_ref: "PF2", order_id: "OF" }),
      step("outcome", { op_ref: "PF2", order_id: "OF", mandate_id: "CF" }),
    ];
    const c = view(items).cards[0]!;
    expect(c).toMatchObject({ outcome: "paid", column: "done", afterRevoke: true, doubleDebit: true });
    expect(c.ops).toEqual([
      { opRef: "PF1", kind: "paid" },
      { opRef: "PF2", kind: "paid" },
    ]);
    expect(graphView(buildTxModel(items), items).rows[0]).toMatchObject({ afterRevoke: true, doubleDebit: true });
    // Одна операция — списка нет; признаков нет.
    const one = view([
      step("order.placed", { order_id: "OG", mandate_id: "CG" }),
      event("operation.authorized", { op_ref: "PG", order_id: "OG" }),
      step("outcome", { op_ref: "PG", order_id: "OG", mandate_id: "CG" }),
    ]).cards[0]!;
    expect(one.ops).toBeUndefined();
    expect(one.afterRevoke).toBeUndefined();
    expect(one.doubleDebit).toBeUndefined();
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

  it("ревью П-2.1 № 6: в одной пачке время перехода — запись, которая перевела в колонку, а не последняя; «Завершены» — время события итога", async () => {
    const f = fakeFeed();
    const p = createPultFeed(f.feed, { now: () => new Date("2026-11-12T12:00:00Z"), debounceMs: 20 });
    const created = step("cart.created", { mandate_id: "C6", intent_id: "I6" }, { stage: "cart" });
    f.push(created);
    await new Promise((r) => setTimeout(r, 40));
    // Одна пачка: заказ (переводит в «Реквизит и оплата»), затем ещё запись той же колонки.
    const order = step("order.placed", { order_id: "O6", mandate_id: "C6" }, { stage: "payment" });
    const started = step("payment.started", { order_id: "O6" }, { stage: "payment" });
    f.push(order, started);
    await new Promise((r) => setTimeout(r, 40));
    expect(p.board().cards[0]).toMatchObject({ column: "pay", since: order.at });
    expect(p.board().jumps.at(-1)).toEqual({ at: order.at, id: "C6", from: "cart", to: "pay" });
    // Одна пачка: событие итога и шаг агента после него — «Завершены» с события, а не с шага.
    const paid = event("operation.authorized", { op_ref: "P6", order_id: "O6" }, { stage: "outcome" });
    const fin = step("outcome", { op_ref: "P6", order_id: "O6", mandate_id: "C6" }, { stage: "outcome" });
    f.push(paid, fin);
    await new Promise((r) => setTimeout(r, 40));
    expect(p.board().cards[0]).toMatchObject({ column: "done", since: paid.at });
    expect(p.board().jumps.at(-1)).toEqual({ at: paid.at, id: "C6", from: "pay", to: "done" });
    p.close();
  });

  it("П-4.1: в состоянии ленты — «Контроль»: порог из настройки (по умолчанию 15 с), «В работе сейчас» — незавершённые транзакции доски с колонкой и временем входа", async () => {
    const f = fakeFeed();
    const p = createPultFeed(f.feed, { now: () => new Date("2026-11-12T12:00:00Z"), debounceMs: 0 });
    expect(p.board().control).toMatchObject({ passports: [], waits: [], waitMs: 15_000, active: [], counts: { txs: 0, wrong: 0 } });
    const created = step("cart.created", { mandate_id: "CK1", intent_id: "IK1" }, { stage: "cart" });
    const ask = step("cart.awaiting_signature", { mandate_id: "CK1" }, { stage: "cart" });
    f.push(created, ask);
    await tick();
    const c = p.board().control;
    expect(c.active).toEqual([{ id: "CK1", column: "cart", since: created.at }]);
    expect(c.waits).toEqual([{ kind: "consent", cond: "R18", obj: "CK1", since: ask.at }]);
    expect(c.counts).toEqual({ txs: 1, wrong: 0 });
    p.close();
    const q = createPultFeed(fakeFeed().feed, { now: () => new Date(), debounceMs: 0, waitMs: 5_000 });
    expect(q.board().control.waitMs).toBe(5_000);
    q.close();
  });

  it("ревью П-4.1 № 5, № 16: ошибка в движке условий доску не гасит; прежние — только паспорта и число с паспортом, ожидания и «В работе сейчас» — свежие", async () => {
    const f = fakeFeed();
    let broken = false;
    const p = createPultFeed(f.feed, {
      now: () => new Date("2026-11-12T12:00:00Z"),
      debounceMs: 0,
      evaluate: (...a) => {
        if (broken) throw new Error("сбой условия");
        return evaluate(...a);
      },
    });
    f.push(step("cart.created", { mandate_id: "CK5", intent_id: "IK5" }, { stage: "cart" }));
    await tick();
    const before = p.board().control;
    expect(before.counts.txs).toBe(1);
    expect(before.waits).toEqual([]);
    // «Условия» (П-4.2) — из того же результата движка: посчитаны, при сбое остаются прежними (тем же объектом).
    const condBefore = p.board().conditions;
    expect(condBefore && Object.keys(condBefore.rules)).toHaveLength(89);
    broken = true;
    const order = step("order.placed", { order_id: "OK5", mandate_id: "CK5" }, { stage: "payment" });
    const req = event("confirmation.required", { confirmation_id: "QK5", order_id: "OK5" }, { stage: "confirmation" });
    f.push(order, req);
    await tick();
    const after = p.board().control;
    expect(p.board().cards[0]).toMatchObject({ id: "CK5", column: "confirmation" });
    expect(after.passports).toBe(before.passports);
    expect(after.counts).toEqual({ txs: 1, wrong: before.counts.wrong });
    expect(after.active).toEqual([{ id: "CK5", column: "confirmation", since: req.at }]);
    expect(after.waits).toEqual([{ kind: "confirmation", cond: "R21", obj: "CK5", confirmationId: "QK5", since: req.at }]);
    expect(p.board().conditions).toBe(condBefore);
    p.close();
  });

  it("ревью П-5.1 № 5 (инвариант 1): номера карты нет ни в доске и «Причинах», ни в сообщении SSE пульта, ни в выгрузке ACC-1", async () => {
    // Похожее на номер карты собирается во время теста (литералов номеров нет): префикс 9 — не схема карт, контрольная цифра — Луна.
    const body = "9" + "3".repeat(14);
    let sum = 0;
    for (let i = 0; i < body.length; i++) {
      let d = Number(body[body.length - 1 - i]);
      if (i % 2 === 0) d = d * 2 > 9 ? d * 2 - 9 : d * 2;
      sum += d;
    }
    const n = body + String((10 - (sum % 10)) % 10);
    const f = fakeFeed();
    const sent: string[] = [];
    const p = createPultFeed(f.feed, { now: () => new Date("2026-11-12T12:00:00Z"), debounceMs: 0 });
    // Сообщение SSE — это JSON события ленты (`sseWrite`); подписчик видит ровно его.
    p.subscribe((e) => sent.push(JSON.stringify(e)));
    const leak = { ...rec("console", "shop.call", { mandate_id: "CK9", order_id: "OK9" }, { stage: "payment", level: "key" }), phrase: { ru: `карта ${n}`, en: `card ${n}` } };
    f.push(step("cart.created", { mandate_id: "CK9", intent_id: "IK9" }, { stage: "cart" }), leak);
    await tick();
    const board = p.board();
    // Нарушение R41 есть — и в «Причинах» оно разобрано, но номер скрыт.
    expect(board.causes!.flatMap((c) => c.items).some((x) => x.cond === "R41")).toBe(true);
    for (const s of [JSON.stringify(board), ...sent]) expect(s).not.toContain(n);
    expect(JSON.stringify(board)).toContain(HIDDEN_RECORD.ru);
    // Выгрузка ACC-1 (лента «Контроля» К2) — по тем же записям.
    const c = createControlFeed(f.feed, { now: () => new Date("2026-11-12T12:10:00Z"), tickMs: 0 });
    f.push({ ...step("run.intent", {}), seq: 9000 }, { ...leak, seq: 9001 });
    c.recompute();
    expect(c.markdown("ru")).not.toContain(n);
    expect(c.markdown("en")).not.toContain(n);
    c.close();
    p.close();
  });

  it("ревью П-4.2 № 4: «Условия» пересчитываются при каждом пересчёте доски — за выдачей движка, а не один раз", async () => {
    const f = fakeFeed();
    let bad = false;
    const p = createPultFeed(f.feed, {
      now: () => new Date("2026-11-12T12:00:00Z"),
      debounceMs: 0,
      evaluate: (...a) => {
        const v = evaluate(...a);
        return bad ? { ...v, system: { ...v.system, R46: { status: "bad", seqs: [] } } } : v;
      },
    });
    f.push(step("cart.created", { mandate_id: "CK6", intent_id: "IK6" }, { stage: "cart" }));
    await tick();
    expect(p.board().conditions!.rules["Ж03"]).not.toBe("bad");
    bad = true;
    f.push(step("order.placed", { order_id: "OK6", mandate_id: "CK6" }, { stage: "payment" }));
    await tick();
    expect(p.board().conditions!.rules["Ж03"]).toBe("bad");
    bad = false;
    f.push(step("payment.started", { order_id: "OK6" }));
    await tick();
    expect(p.board().conditions!.rules["Ж03"]).not.toBe("bad");
    p.close();
  });

  it("ревью П-2.1 № 7: карточка ушла с доски (окно записей) и вернулась — без ложного перехода из старой колонки, время — новое", async () => {
    const f = fakeFeed();
    const p = createPultFeed(f.feed, { now: () => new Date("2026-11-12T12:00:00Z"), debounceMs: 0, limit: 2 });
    f.push(step("cart.created", { mandate_id: "CA7", intent_id: "IA7" }, { stage: "cart" }));
    await tick();
    expect(p.board().cards.map((c) => c.id)).toEqual(["CA7"]);
    // Две записи другой покупки вытесняют CA7 из окна.
    f.push(step("cart.created", { mandate_id: "CB7", intent_id: "IB7" }, { stage: "cart" }), step("order.placed", { order_id: "OB7", mandate_id: "CB7" }));
    await tick();
    expect(p.board().cards.map((c) => c.id)).toEqual(["CB7"]);
    // CA7 возвращается записью другой колонки: прежний «Корзина» забыт — перехода нет, время — новой записи.
    const back = step("order.placed", { order_id: "OA7", mandate_id: "CA7" });
    f.push(back);
    await tick();
    expect(p.board().cards.find((c) => c.id === "CA7")).toMatchObject({ column: "pay", since: back.at });
    expect(p.board().jumps.filter((j) => j.id === "CA7")).toEqual([]);
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
