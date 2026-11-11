// П-3.2б (Р-1476, Р-1478, Р-1479; В5, В8): движок условий пульта на записях в форме шины. «Соблюдено», «не применяется» и
// «сработало» на настоящей шине (сюжеты 1–5 с агентом) — tests/demo/interpret-live.test.ts; «нарушено» — здесь, на
// записях той же формы. Номер seq выдаётся при создании записи — записи создаются в порядке шины.
import { describe, expect, it } from "vitest";
import type { Interpretation, TxIds, Who } from "../../src/dashboards/interpret.js";
import { evaluate, GUARANTEE_INFO, hasCardNumber, NOTE_LABEL, ruleStatus, STATUS_LABEL, STATUSES, worstStatus, type CondResults } from "../../src/pult/engine.js";
import { CHECKABLE_CONDITIONS, isCheckable, RULES89 } from "../../src/pult/rules89.js";
import { buildTxModel } from "../../src/pult/tx.js";

let seq = 0;
const at = (n: number) => new Date(Date.UTC(2026, 10, 11, 12, 0, 0, n)).toISOString();
type O = Partial<Pick<Interpretation, "kind" | "stage" | "level" | "source" | "phrase">> & { code?: string; detail?: string };
function rec(stream: Interpretation["stream"], ref: string, ids: TxIds, o: O = {}): Interpretation {
  const n = ++seq;
  const who: Who | undefined =
    o.code !== undefined ? { code: o.code, ...(o.detail !== undefined && { codeDetail: o.detail }), status: "found", side: ["platform"], verdict: "expected" } : undefined;
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
    phrase: o.phrase ?? { ru: ref, en: ref },
    ...(Object.keys(ids).length > 0 && { ids }),
    ...(who && { who }),
    ...(o.source !== undefined && { source: o.source }),
  };
}
const step = (ref: string, ids: TxIds, o: O = {}) => rec("scenario", ref, ids, o);
const event = (ref: string, ids: TxIds, o: O = {}) => rec("monitor", ref, ids, { ...o, source: "pao_event" });
const call = (ref: string, ids: TxIds, source: Interpretation["source"], o: O = {}) => rec("monitor", ref, ids, { ...o, source });
const PAY = "POST /v1/shops/{shop_id}/orders/{order_id}/payment";
const SIGN = "POST /participants/v1/mandates/{mandate_id}/sign";

type Phase = "cart" | "signed" | "order" | "start" | "pay" | "done" | "end";
/** Покупка в форме настоящей шины (сюжет 2): поручение подписано клиентом (обращение эмулятора банка `stand` и событие)
 *  → корзина → подпись корзины → заказ → шаг `payment.started` (до вызова) → обращение агента к витрине `agent_merchant`
 *  (пишется после ответа) → «оплачено» и шаг итога. `at` — записи перед фазой; `skip` — фазы, которых нет. */
function purchase(n: string, o: { at?: Partial<Record<Phase, () => Interpretation[]>>; skip?: Phase[]; intent?: () => Interpretation[] } = {}) {
  const [c, i, ord, op] = [`C${n}`, `I${n}`, `O${n}`, `P${n}`];
  const out: Interpretation[] = [];
  const phase = (p: Phase, make: () => Interpretation[]) => {
    out.push(...(o.at?.[p]?.() ?? []));
    if (!o.skip?.includes(p)) out.push(...make());
  };
  out.push(...(o.intent ?? (() => [step("intent.awaiting_signature", { mandate_id: i }, { stage: "mandate" }), call(SIGN, { mandate_id: i }, "stand"), event("mandate.signed", { mandate_id: i })]))());
  phase("cart", () => [step("cart.created", { mandate_id: c, intent_id: i }, { stage: "cart" })]);
  phase("signed", () => [call(SIGN, { mandate_id: c }, "stand"), event("mandate.signed", { mandate_id: c }), step("cart.signed", { mandate_id: c })]);
  phase("order", () => [step("order.placed", { order_id: ord, mandate_id: c, merchant_id: "MER-1" })]);
  phase("start", () => [step("payment.started", { order_id: ord })]);
  phase("pay", () => [call(PAY, { shop_id: "SHOP-1", order_id: ord }, "agent_merchant")]);
  phase("done", () => [event("operation.authorized", { op_ref: op, order_id: ord }, { stage: "outcome" }), step("outcome", { op_ref: op, order_id: ord, mandate_id: c }, { stage: "outcome" })]);
  phase("end", () => []);
  return out;
}
const run = (items: Interpretation[]) => evaluate(buildTxModel(items), items);
const tx = (items: Interpretation[]): CondResults => run(items).objs.find((o) => o.kind === "tx")!.conds;
const statuses = (c: CondResults) => Object.fromEntries(CHECKABLE_CONDITIONS.map((k) => [k, c[k].status]));
const seqOf = (items: Interpretation[], ref: string) => items.find((x) => x.ref === ref)!.seq;

describe("движок условий пульта (П-3.2б)", () => {
  it("обычная покупка: соблюдены R08, R09, R18, R26, R28, R30, R41, R46; R21, R37 не применяются; R17 и журнал сбоев — «на стенде не проверяется» с пометкой", () => {
    const c = tx(purchase("1"));
    expect(statuses(c)).toEqual({
      R08: "ok", R09: "ok", R17: "none", R18: "ok", R20: "none", R21: "na", R23: "none", R25: "none", R26: "ok",
      R27: "none", R28: "ok", R30: "ok", R31: "none", R32: "none", R37: "na", R41: "ok", R46: "ok", R47: "none",
    });
    expect(c.R17.note).toBe("amounts_after_mvp");
    expect(c.R27.note).toBe("stand_log");
  });

  it("R08: подпись поручения не эмулятором банка (агент, открытый адрес, сеть) — «нарушено»; покупка без подписи — «нарушено»; до подписи — «ждёт»", () => {
    for (const src of ["agent_platform", "agent_platform_open", "network_platform"] as const) {
      let sign = 0;
      const items = purchase(`2${src}`, {
        intent: () => {
          const l = [step("intent.awaiting_signature", { mandate_id: `I2${src}` }, { stage: "mandate" }), call(SIGN, { mandate_id: `I2${src}` }, src), event("mandate.signed", { mandate_id: `I2${src}` })];
          sign = l[1]!.seq;
          return l;
        },
      });
      expect(tx(items).R08, src).toMatchObject({ status: "bad", seqs: [sign] });
    }
    const unsigned = () => [step("intent.awaiting_signature", { mandate_id: "I2b" }, { stage: "mandate" })];
    expect(tx(purchase("2b", { intent: unsigned })).R08.status).toBe("bad");
    expect(tx(purchase("2c", { intent: () => [step("intent.awaiting_signature", { mandate_id: "I2c" }, { stage: "mandate" })], skip: ["signed", "order", "start", "pay", "done"] })).R08.status).toBe("wait");
  });

  it("R18: согласие — только событие Платформы; шаг агента даёт время: шаг раньше события, оплата между ними — «соблюдено»; шаг без события — «ждёт»; без подписи или подпись после оплаты — «нарушено»", () => {
    const early = purchase("3", { skip: ["signed"] });
    expect(tx(early).R18).toMatchObject({ status: "bad", seqs: [seqOf(early, "payment.started")] });
    // Подпись клиента пришла уже после оплаты — согласие не «до операции».
    const late = purchase("3b", { skip: ["signed"], at: { done: () => [event("mandate.signed", { mandate_id: "C3b" })] } });
    expect(tx(late).R18.status).toBe("bad");
    // Законный путь живой шины: агент увидел подпись (шаг), оплатил, событие ленты пришло позже — согласие по времени шага.
    const lagging = purchase("3s", { skip: ["signed"], at: { order: () => [call(SIGN, { mandate_id: "C3s" }, "stand"), step("cart.signed", { mandate_id: "C3s" })], done: () => [event("mandate.signed", { mandate_id: "C3s" })] } });
    expect(tx(lagging).R18.status).toBe("ok");
    // Тот же путь, событие ещё не пришло — не «соблюдено» по словам агента: «ждёт» с пометкой.
    const noEvent = purchase("3t", { skip: ["signed", "done"], at: { order: () => [step("cart.signed", { mandate_id: "C3t" })] } });
    expect(tx(noEvent).R18).toMatchObject({ status: "wait", note: "event_pending" });
    for (const src of ["agent_platform", "agent_platform_open", "network_platform"] as const) {
      const signed = purchase(`3c${src}`, { at: { order: () => [call(SIGN, { mandate_id: `C3c${src}` }, src)] } });
      expect(tx(signed).R18.status, src).toBe("bad");
    }
    expect(tx(purchase("3d", { skip: ["signed", "order", "start", "pay", "done"], at: { end: () => [event("mandate.rejected", { mandate_id: "C3d" })] } })).R18.status).toBe("na");
    expect(tx(purchase("3e", { skip: ["signed", "order", "start", "pay", "done"] })).R18.status).toBe("wait");
  });

  it("В5, ревью П-3.2б № 1: R37 — «нарушено», только если оплата начата после того, как агент узнал об отзыве; между событием и записью агента — гонка С-28", () => {
    const rv = (c: string) => event("mandate.revoked", { mandate_id: c }, { stage: "revoke" });
    const knows = (c: string) => rec("console", "mandate.revoked", { mandate_id: c }, { stage: "revoke" });
    // «Оплачено» после отзыва, оплата начата до него — R09 «нарушено», R37 — гонка.
    const race = tx(purchase("4", { at: { done: () => [rv("C4")] } }));
    expect(race.R09.status).toBe("bad");
    expect(race.R37).toMatchObject({ status: "wait", note: "race_c28" });
    // Живой порядок: payment.started → событие отзыва → запись обращения к витрине (после ответа) → «оплачено»: гонка.
    expect(tx(purchase("4b", { at: { pay: () => [rv("C4b")] } })).R37).toMatchObject({ status: "wait", note: "race_c28" });
    // Событие отзыва, затем оплата начата, а агент ещё не записал, что узнал, — гонка, не «нарушено».
    expect(tx(purchase("4c", { at: { start: () => [rv("C4c")] } })).R37.status).toBe("wait");
    // Агент узнал об отзыве и после этого начал оплату — «нарушено».
    const after = purchase("5", { at: { start: () => [rv("C5"), knows("C5")] } });
    const r37 = tx(after).R37;
    expect(r37.status).toBe("bad");
    expect(r37.seqs).toEqual(expect.arrayContaining([seqOf(after, "payment.started")]));
    // Агент узнал и остановился — «соблюдено».
    // Событие отзыва → начало оплаты → запись агента «узнал» → обращение к витрине: оплата начата до «узнал» — гонка.
    expect(tx(purchase("5r", { at: { start: () => [rv("C5r")], pay: () => [knows("C5r")] } })).R37).toMatchObject({ status: "wait", note: "race_c28" });
    expect(tx(purchase("5s", { skip: ["start", "pay", "done"], at: { end: () => [rv("C5s"), knows("C5s")] } })).R37.status).toBe("ok");
    // Обращение к витрине чужого клиента (network_merchant) после отзыва — не действие агента.
    const foreign = purchase("5f", { skip: ["start", "pay", "done"], at: { end: () => [rv("C5f"), knows("C5f"), call(PAY, { shop_id: "SHOP-1", order_id: "O5f" }, "network_merchant")] } });
    expect(tx(foreign).R37.status).toBe("ok");
    // Отзыв поручения-намерения после покупки — агент ничего после него не делал: «соблюдено».
    expect(tx(purchase("5b", { at: { end: () => [rv("I5b")] } })).R37.status).toBe("ok");
    // Отказ «поручение не действует» — защита сработала (R09).
    const refused = tx(purchase("6", { skip: ["start", "pay", "done"], at: { end: () => [step("failed", { order_id: "O6", mandate_id: "C6" }, { code: "MANDATE_NOT_ACTIVE" })] } }));
    expect(refused.R09.status).toBe("fired");
    // Отказ операции по лимиту — поручение действовало (R09 соблюдено), «оплачено» нет — R46 не применяется; отзыв без
    // операции — R09 не применяется.
    const declined = tx(
      purchase("6b", {
        skip: ["done"],
        at: { end: () => [event("operation.declined", { op_ref: "P6b" }, { code: "LIMIT_EXCEEDED", detail: "CLIENT" }), step("limit.declined", { op_ref: "P6b", order_id: "O6b", mandate_id: "C6b" })] },
      }),
    );
    expect([declined.R09.status, declined.R46.status]).toEqual(["ok", "na"]);
    const revokedOnly = tx(purchase("6c", { skip: ["signed", "order", "start", "pay", "done"], at: { end: () => [event("mandate.revoked", { mandate_id: "C6c" }, { stage: "revoke" })] } }));
    expect([revokedOnly.R09.status, revokedOnly.R46.status]).toEqual(["na", "na"]);
  });

  it("R21: срок подтверждения истёк без оплаты — «сработало»; оплата после срока — «нарушено»; одобрено — «соблюдено»; ждёт ответа — «ждёт»", () => {
    const req = (n: string) => event("confirmation.required", { confirmation_id: `Q${n}`, order_id: `O${n}` }, { stage: "confirmation" });
    const fin = (n: string, ref: string) => event(ref, { confirmation_id: `Q${n}`, order_id: `O${n}` }, { stage: "confirmation" });
    expect(tx(purchase("7", { skip: ["start", "pay", "done"], at: { end: () => [req("7"), fin("7", "confirmation.expired")] } })).R21.status).toBe("fired");
    expect(tx(purchase("7b", { at: { start: () => [req("7b"), fin("7b", "confirmation.expired")] } })).R21.status).toBe("bad");
    expect(tx(purchase("7c", { at: { start: () => [req("7c"), fin("7c", "confirmation.approved")] } })).R21.status).toBe("ok");
    expect(tx(purchase("7d", { skip: ["start", "pay", "done"], at: { end: () => [req("7d")] } })).R21.status).toBe("wait");
  });

  it("R26: оплата заказа агентом у другой витрины — «нарушено»; обращение чужого клиента с тем же номером — не вменяется агенту", () => {
    const wrong = purchase("8", { at: { pay: () => [call(PAY, { shop_id: "SHOP-9", order_id: "O8" }, "agent_merchant")] } });
    expect(tx(wrong).R26.status).toBe("bad");
    const foreign = purchase("8b", { at: { pay: () => [call(PAY, { shop_id: "SHOP-9", order_id: "O8b" }, "network_merchant")] } });
    expect(tx(foreign).R26.status).toBe("ok");
  });

  it("ревью П-3.2б № 2: конфликт звеньев (витрина повторила номер заказа другой покупки) — R18, R26, R28, R30, R46 «ждёт» с пометкой, не «нарушено»", () => {
    const one = purchase("K1", { skip: ["order", "start", "pay", "done"] });
    const two = purchase("K2", { skip: ["order", "start", "pay", "done"] });
    const tail = [
      step("order.placed", { order_id: "OK", mandate_id: "CK1", merchant_id: "MER-1" }),
      step("payment.started", { order_id: "OK" }),
      call(PAY, { shop_id: "SHOP-1", order_id: "OK" }, "agent_merchant"),
      event("operation.authorized", { op_ref: "PK1", order_id: "OK" }),
      step("outcome", { op_ref: "PK1", order_id: "OK", mandate_id: "CK1" }),
      // Срок подтверждения второй покупки истёк, а первая с тем же номером оплачена — не «оплата после срока» (повт. № 2).
      event("confirmation.required", { confirmation_id: "QK", order_id: "OK" }, { stage: "confirmation" }),
      event("confirmation.expired", { confirmation_id: "QK", order_id: "OK" }, { stage: "confirmation" }),
      step("order.placed", { order_id: "OK", mandate_id: "CK2", merchant_id: "MER-2" }),
      step("payment.started", { order_id: "OK" }),
      call(PAY, { shop_id: "SHOP-2", order_id: "OK" }, "agent_merchant"),
      event("operation.authorized", { op_ref: "PK2", order_id: "OK" }),
      step("outcome", { op_ref: "PK2", order_id: "OK", mandate_id: "CK2" }),
    ];
    const items = [...one, ...two, ...tail];
    const t = buildTxModel(items).txs.find((x) => x.linkConflict)!;
    expect(t).toBeDefined();
    const c = run(items).objs.find((o) => o.id === t.id)!.conds;
    for (const k of ["R18", "R21", "R26", "R28", "R30", "R46"] as const) expect(c[k], k).toMatchObject({ status: "wait", note: "link_conflict" });
  });

  it("R46 (Р-1479): два «оплачено» по связанным операциям или две успешные оплаты агента одного заказа — «нарушено»; повтор после отказа витрины — нет; второе «оплачено» без связи — «ждёт» с пометкой", () => {
    const second = () => [event("operation.authorized", { op_ref: "P9x", order_id: "O9" }), step("outcome", { op_ref: "P9x", order_id: "O9", mandate_id: "C9" })];
    expect(tx(purchase("9", { at: { end: second } })).R46.status).toBe("bad");
    expect(tx(purchase("9b", { at: { done: () => [call(PAY, { shop_id: "SHOP-1", order_id: "O9b" }, "agent_merchant")] } })).R46.status).toBe("bad");
    const retry = purchase("9c", { at: { pay: () => [call(PAY, { shop_id: "SHOP-1", order_id: "O9c" }, "agent_merchant", { kind: "error" })] } });
    expect(tx(retry).R46.status).toBe("ok");
    // Оплата того же заказа чужим клиентом (network_merchant) — не «две оплаты агента».
    expect(tx(purchase("9e", { at: { done: () => [call(PAY, { shop_id: "SHOP-1", order_id: "O9e" }, "network_merchant")] } })).R46.status).toBe("ok");
    let loose = 0;
    const withLoose = purchase("9d", {
      at: {
        end: () => {
          const e = event("operation.authorized", { op_ref: "PX", order_id: "O9d" });
          loose = e.seq;
          return [e];
        },
      },
    });
    expect(tx(withLoose).R46).toMatchObject({ status: "wait", note: "unconfirmed_paid", seqs: [loose] });
  });

  it("R41: последовательность, похожая на номер карты, во фразе или идентификаторе — «нарушено» по записи, без значения; сводно — и вне транзакций", () => {
    // Номер строится в тесте и в файлах не пишется (CLAUDE.md, «Секреты»): первая цифра 9 — не схема карт, Луна — верная.
    const body = "9" + "1".repeat(14);
    let sum = 0;
    for (let i = 0; i < body.length; i++) {
      let d = Number(body[body.length - 1 - i]);
      if (i % 2 === 0) d = d * 2 > 9 ? d * 2 - 9 : d * 2;
      sum += d;
    }
    const pan = body + String((10 - (sum % 10)) % 10);
    expect(hasCardNumber(`карта ${pan.slice(0, 4)} ${pan.slice(4, 8)} ${pan.slice(8, 12)} ${pan.slice(12)}`)).toBe(true);
    // Ревью П-3.2б № 3: цифры рядом с номером не прячут его.
    for (const s of [`${pan.slice(0, 4)} ${pan.slice(4, 8)} ${pan.slice(8, 12)} ${pan.slice(12)} 12:00`, `шаг 3 ${pan}`, `${pan}-01`, `7${pan}`])
      expect(hasCardNumber(s), s).toBe(true);
    expect(hasCardNumber("1".repeat(12))).toBe(false);
    // Идентификатор поручения стенда — UUID: группы из одних цифр не дают ложного R41, даже если склейка проходит Луна.
    const uuidDigits = `${pan.slice(0, 8)}-${pan.slice(8, 12)}-${pan.slice(12, 16)}-a000-000000000000`;
    expect(hasCardNumber(`mnd_${uuidDigits}`)).toBe(false);
    // Хвост шестнадцатеричного идентификатора рядом с буквой — не номер.
    expect(hasCardNumber(`OPKC-x${pan}`)).toBe(false);
    expect(hasCardNumber("сумма 340,00 ₽, заказ ORD-2026-11-11, 12:00:05")).toBe(false);
    let leak = 0;
    const items = purchase("A", {
      at: {
        pay: () => {
          const x = step("order.shop_reply", { order_id: "OA" }, { phrase: { ru: `ответ ${pan}`, en: `reply ${pan}` } });
          leak = x.seq;
          return [x];
        },
      },
    });
    const v = run(items);
    expect(v.objs[0]!.conds.R41).toEqual({ status: "bad", seqs: [leak] });
    expect(JSON.stringify(v)).not.toContain(pan);
    const outside = purchase("Ab", { at: { end: () => [step("search.found", {}, { phrase: { ru: pan, en: pan } })] } });
    expect(run(outside).objs[0]!.conds.R41.status).toBe("ok");
    expect(run(outside).system.R41.status).toBe("bad");
  });

  it("R17 (В8): MANDATE_SCOPE — «сработало»; защиты: MANDATE_SCOPE, 403 AGENT_SUSPENDED, отзыв (агент остановился сам), LIMIT_EXCEEDED клиента — не банка", () => {
    const scope = () => [step("failed", { order_id: "OB", mandate_id: "CB" }, { code: "MANDATE_SCOPE" })];
    const items = purchase("B", { skip: ["start", "pay", "done"], at: { end: scope } });
    const v = run(items);
    const scopeSeq = items.at(-1)!.seq;
    expect(v.objs[0]!.conds.R17).toEqual({ status: "fired", seqs: [scopeSeq] });
    expect(v.system.R17.status).toBe("fired");
    expect(v.system.R17.note).toBeUndefined();
    const susp = step("failed", { order_id: "OB2", mandate_id: "CB2" }, { code: "AGENT_SUSPENDED" });
    const refused = step("revoke.refused", { mandate_id: "IR" }, { code: "MANDATE_REVOKED" });
    const limit = event("operation.declined", { op_ref: "PL" }, { code: "LIMIT_EXCEEDED", detail: "CLIENT" });
    const limitBank = event("operation.declined", { op_ref: "PM" }, { code: "LIMIT_EXCEEDED", detail: "ISSUER" });
    const g = run([...items, susp, refused, limit, limitBank]).guarantees;
    expect(g.map((x) => [x.kind, x.seq])).toEqual([
      ["mandate_scope", scopeSeq],
      ["agent_suspended", susp.seq],
      ["revoke", refused.seq],
      ["limit_client", limit.seq],
    ]);
    expect(g[0]!.obj).toBe("CB");
    expect(GUARANTEE_INFO.mandate_scope.guarantee).toBe("g1d");
  });

  it("поручение без покупки: подписано клиентом — R08 «соблюдено»; отозвано, агент остановился — R37 «соблюдено»; остальное — не применяется", () => {
    const items = [
      step("intent.awaiting_signature", { mandate_id: "IM" }, { stage: "mandate" }),
      event("mandate.signed", { mandate_id: "IM" }),
      event("mandate.revoked", { mandate_id: "IM" }, { stage: "revoke" }),
      step("revoke.refused", { mandate_id: "IM" }, { code: "MANDATE_REVOKED" }),
    ];
    const v = run(items);
    expect(v.objs).toHaveLength(1);
    const m = v.objs[0]!;
    expect(m).toMatchObject({ id: "IM", kind: "mandate" });
    expect(m.conds.R08.status).toBe("ok");
    expect(m.conds.R37.status).toBe("ok");
    expect(m.conds.R18.status).toBe("na");
    expect(v.guarantees.map((x) => x.kind)).toEqual(["revoke"]);
  });

  it("сводно — худший статус по объектам; правило — по его проверяемым условиям; без проверяемых — 65 «на стенде не проверяется» и 3 «вне стенда» (68)", () => {
    expect(worstStatus(["ok", "na", "wait"])).toBe("wait");
    expect(worstStatus(["ok", "fired", "bad"])).toBe("bad");
    expect(worstStatus([])).toBe("na");
    const v = run([...purchase("C"), ...purchase("D", { skip: ["signed"] })]);
    expect(v.objs.map((o) => o.conds.R18.status)).toEqual(["ok", "bad"]);
    expect(v.system.R18.status).toBe("bad");
    const unchecked = RULES89.filter((r) => !isCheckable(r));
    expect(unchecked.filter((r) => ruleStatus(r, v.system) === "none")).toHaveLength(65);
    expect(unchecked.filter((r) => ruleStatus(r, v.system) === "out").map((r) => r.id)).toEqual(["А08", "М02", "П03"]);
    // Г03 (R18) — нарушено; Г06 и Ж02 (R17) — «на стенде не проверяется» (суммы — после MVP); Б04 (R08) — соблюдено.
    const rule = (id: string) => ruleStatus(RULES89.find((r) => r.id === id)!, v.system);
    expect([rule("Г03"), rule("Г06"), rule("Ж02"), rule("Б04")]).toEqual(["bad", "none", "none", "ok"]);
  });

  it("подписи статусов, пометок и защит — ru и en", () => {
    for (const s of STATUSES) expect(STATUS_LABEL[s].ru.length * STATUS_LABEL[s].en.length, s).toBeGreaterThan(0);
    for (const x of [...Object.values(NOTE_LABEL), ...Object.values(GUARANTEE_INFO).map((g) => g.name)]) {
      expect(x.ru.length).toBeGreaterThan(0);
      expect(x.en).not.toMatch(/[А-Яа-яЁё]/);
    }
  });
});
