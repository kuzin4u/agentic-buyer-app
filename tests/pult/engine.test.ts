// П-3.2б (Р-1476, Р-1478, Р-1479; В5, В8): движок условий пульта на записях в форме шины. «Соблюдено», «не применяется» и
// «сработало» на настоящей шине (сюжеты 1–5 с агентом) — tests/demo/interpret-live.test.ts; «нарушено» — здесь, на
// записях той же формы. Номер seq выдаётся при создании записи — записи создаются в порядке шины.
import { describe, expect, it } from "vitest";
import type { Interpretation, TxIds, Who } from "../../src/dashboards/interpret.js";
import { evaluate, GUARANTEE_CODES, GUARANTEE_INFO, hasCardNumber, HIDDEN_RECORD, MERCHANT_STOP_CODES, stoppedBy, LATE_MS, NOTE_LABEL, ruleStatus, STATUS_LABEL, STATUSES, worstStatus, type CondResults } from "../../src/pult/engine.js";
import { PULT } from "../../src/pult/phrases.js";
import { CHECKABLE_CONDITIONS, CONDITIONS, isCheckable, PARTIES, RULES89, ruleText } from "../../src/pult/rules89.js";
import { STAND_DELAY_MAX_MS, STAND_TESTS, type StandFaultForm, type StandFaultIds, type StandLogEntry, type StandLogWhat, type StandTest } from "../../src/pult/standlog.js";
import { buildTxModel } from "../../src/pult/tx.js";
import { subjectsOf, verdicts, type Verdict } from "../../src/pult/verdict.js";
import { controlView, dueWaits, hasPassport, passports, WAIT_MS, waits } from "../../src/pult/control.js";
import { conditionsView } from "../../src/pult/conditions.js";
import { buildDiagSnapshot } from "../../src/demo/diag.js";
import { causesView, DECISION_TODO, GUARANTEE_TODO, KIND_CONSEQUENCES, NO_GUARD_NEEDED, NODE_CONSEQUENCES, SCOPE_NO_CART_TITLE, SCOPE_NO_CART_TODO, STOPPED_CONSEQUENCES, type CauseItem } from "../../src/pult/causes.js";
import { DEMO_TESTS, type DemoLogEntry } from "agentic-ps-platform/stand";

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
/** Запись журнала агента с кодом (`agent.refused`: причина — код, как в интерпретаторе). */
const journal = (ref: string, ids: TxIds, code: string) => rec("console", ref, ids, { code, kind: "conflict" });
/** Отказ Платформы MANDATE_SCOPE на запрос реквизита (как на живой шине) и шаг сюжета (ревью П-5.1 № 1). */
const scopeRefused = (cart: string, order: string) => [
  rec("monitor", "POST /pao/v1/credentials", { mandate_id: cart }, { source: "agent_platform", code: "MANDATE_SCOPE", kind: "conflict" }),
  step("failed", { order_id: order, mandate_id: cart }, { code: "MANDATE_SCOPE" }),
];
const event = (ref: string, ids: TxIds, o: O = {}) => rec("monitor", ref, ids, { ...o, source: "pao_event" });
const call = (ref: string, ids: TxIds, source: Interpretation["source"], o: O = {}) => rec("monitor", ref, ids, { ...o, source });
const PAY = "POST /v1/shops/{shop_id}/orders/{order_id}/payment";
const SIGN = "POST /participants/v1/mandates/{mandate_id}/sign";

type Phase = "cart" | "signed" | "order" | "start" | "pay" | "done" | "end";
/** Покупка в форме настоящей шины (сюжет 2): поручение подписано клиентом (обращение эмулятора банка `stand` и событие)
 *  → корзина → подпись корзины → заказ → шаг `payment.started` (до вызова) → обращение агента к витрине `agent_merchant`
 *  (пишется после ответа) → «оплачено» и шаг итога. `at` — записи перед фазой; `skip` — фазы, которых нет. */
function purchase(n: string, o: { at?: Partial<Record<Phase, () => Interpretation[]>>; skip?: Phase[]; intent?: () => Interpretation[]; intentId?: string } = {}) {
  const [c, i, ord, op] = [`C${n}`, o.intentId ?? `I${n}`, `O${n}`, `P${n}`];
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

/** Стендовая форма П-06 / П-09 (сюжеты 8 и 10; П-5.1а, Р-1536): поручение без покупки, срок — в шаге `intent.created`
 *  (`validTo`, П-11.5б окна Б), отказ ядра `MANDATE_OUT_OF_SCOPE` — запись журнала агента и шаг сюжета. Шаг сюжета 8
 *  (`scope.refused`) несёт только `intent_id`, сюжета 10 (`expiry.refused`) — `mandate_id`, как на живой шине. `term` —
 *  срок относительно записи журнала агента: `later` — срок позже отказа (П-06), `same` — ровно в момент отказа,
 *  `earlier` — срок раньше отказа (П-09), `none` — срока нет. `journal: false` — остановка только в шаге сюжета. */
function coreRefusal(id: string, term: "later" | "same" | "earlier" | "none", o: { journal?: boolean; kind?: "scope" | "expiry" } = {}): Interpretation[] {
  const created = step("intent.created", { mandate_id: id }, { stage: "mandate" });
  const head = [step("intent.awaiting_signature", { mandate_id: id }, { stage: "mandate" }), call(SIGN, { mandate_id: id }, "stand"), event("mandate.signed", { mandate_id: id })];
  const j = o.journal === false ? [] : [journal("agent.refused", { mandate_id: id }, "MANDATE_OUT_OF_SCOPE")];
  const tail =
    o.kind === "expiry"
      ? step("expiry.refused", { mandate_id: id }, { code: "MANDATE_OUT_OF_SCOPE", stage: "mandate" })
      : step("scope.refused", { intent_id: id, merchant_id: "MER-2" }, { code: "MANDATE_OUT_OF_SCOPE", stage: "outcome" });
  // Момент отказа — запись журнала агента; её нет — первая запись с кодом (шаг сюжета).
  const t = Date.parse((j[0] ?? tail).at);
  const validTo = term === "later" ? t + 1 : term === "same" ? t : term === "earlier" ? t - 1 : undefined;
  return [{ ...created, ...(validTo !== undefined && { validTo: new Date(validTo).toISOString() }) }, ...head, ...j, tail];
}

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
    // Номер — в ответе продавца (шаг сюжета), не в записи агента: причина «не агент» (П-3.3, ревью № 6).
    expect(v.objs[0]!.conds.R41).toEqual({ status: "bad", seqs: [leak], cause: { kind: "rule", rule: "card_number_other" } });
    expect(JSON.stringify(v)).not.toContain(pan);
    const outside = purchase("Ab", { at: { end: () => [step("search.found", {}, { phrase: { ru: pan, en: pan } })] } });
    expect(run(outside).objs[0]!.conds.R41.status).toBe("ok");
    expect(run(outside).system.R41.status).toBe("bad");
  });

  it("R17 (В8): MANDATE_SCOPE — «сработало»; защиты: MANDATE_SCOPE, 403 AGENT_SUSPENDED, отзыв (агент остановился сам), LIMIT_EXCEEDED клиента — не банка", () => {
    const items = purchase("B", { skip: ["start", "pay", "done"], at: { end: () => scopeRefused("CB", "OB") } });
    const v = run(items);
    const scopeSeq = items.at(-2)!.seq;
    expect(v.objs[0]!.conds.R17).toEqual({ status: "fired", seqs: [scopeSeq, items.at(-1)!.seq], cause: { kind: "rule", rule: "mandate_scope_platform" } });
    // Ревью П-5.1 № 1 (Р-1519): только шаг сюжета — защитник не определён.
    const stepOnly = purchase("B9", { skip: ["start", "pay", "done"], at: { end: () => [step("failed", { order_id: "OB9", mandate_id: "CB9" }, { code: "MANDATE_SCOPE" })] } });
    expect(run(stepOnly).objs[0]!.conds.R17.cause).toEqual({ kind: "rule", rule: "mandate_scope_undetermined" });
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

  it("П-5.1 (ревью П-3.2б № 4, П-3.3 № 3; Р-1519): одна остановка — одна защита; кто остановил — ответ Платформы, иначе журнал агента, иначе «не определён»", () => {
    const base = purchase("S1", { skip: ["start", "pay", "done"] });
    const plat = call("POST /pao/v1/credentials", { mandate_id: "CS1" }, "agent_platform", { code: "AGENT_SUSPENDED", kind: "conflict" });
    const jr = journal("agent.refused", { mandate_id: "CS1" }, "AGENT_SUSPENDED");
    const st = step("failed", { order_id: "OS1", mandate_id: "CS1" }, { code: "AGENT_SUSPENDED" });
    const all = run([...base, plat, jr, st]).guarantees;
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ kind: "agent_suspended", protector: "platform", seqs: [plat.seq, jr.seq, st.seq], seq: plat.seq });
    // Только журнал агента — агент; только шаг сюжета — «не определён» (рассказ стенда, не доказательство).
    const b2 = purchase("S2", { skip: ["start", "pay", "done"] });
    expect(run([...b2, journal("agent.refused", { mandate_id: "CS2" }, "AGENT_SUSPENDED"), step("failed", { order_id: "OS2", mandate_id: "CS2" }, { code: "AGENT_SUSPENDED" })]).guarantees[0]!.protector).toBe("agent");
    const b3 = purchase("S3", { skip: ["start", "pay", "done"] });
    expect(run([...b3, step("failed", { order_id: "OS3", mandate_id: "CS3" }, { code: "AGENT_SUSPENDED" })]).guarantees[0]!.protector).toBe("undetermined");
    // Ответ витрины (не Платформы) с тем же кодом — не «защитила Платформа».
    const b4 = purchase("S4", { skip: ["start", "pay", "done"] });
    expect(run([...b4, call(PAY, { shop_id: "SHOP-1", order_id: "OS4" }, "agent_merchant", { code: "AGENT_SUSPENDED", kind: "conflict" })]).guarantees[0]!.protector).toBe("undetermined");
    expect(stoppedBy([], ["AGENT_SUSPENDED"])).toBe("undetermined");
  });

  it("П-5.1 (Р-1511): коды сработавших защит — из реестра агента и ПАО (`DIAG` ядра), а не выдуманы пультом", () => {
    const snap = buildDiagSnapshot();
    const agent = snap.registries.find((r) => r.id === "agent")!;
    const merchant = snap.registries.find((r) => r.id === "merchant")!;
    // Р-1524: коды отказа продавца — из реестра продавца; остальные — из реестра агента и ПАО.
    const merchantKnown = new Set(merchant.entries.map((e) => e.code));
    expect(MERCHANT_STOP_CODES.filter((c) => !merchantKnown.has(c))).toEqual([]);
    const known = new Set(agent.entries.map((e) => e.code));
    const own = GUARANTEE_CODES.filter((c) => !MERCHANT_STOP_CODES.includes(c));
    expect(own.filter((c) => !known.has(c))).toEqual([]);
    // Ревью П-5.1 № 15: коды ответов Платформы — в компоненте ПАО; MANDATE_NOT_ACTIVE — собственная остановка агента.
    const comp = (c: string) => agent.entries.filter((e) => e.code === c).map((e) => e.component);
    for (const c of own.filter((x) => x !== "MANDATE_NOT_ACTIVE")) expect(comp(c), c).toContain("pao");
    // Перечень защитников (Р-1511, Р-1524): у каждого — подпись ru/en.
    for (const s of ["platform", "agent", "bank", "merchant", "undetermined"] as const) for (const lang of ["ru", "en"] as const) expect(PULT[`subj.${s}`][lang].length, s).toBeGreaterThan(0);
    expect(comp("MANDATE_NOT_ACTIVE")).toContain("agent");
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

// П-3.2в (В7, В8, В9; решение владельца — PR #9 #pullrequestreview-5861020062): журнал сбоев стенда в форме
// `stand.demo.log()` и пометки «ПР». Контракт записи — тип стенда v0.48.0: равенство проверяет tsc (тесты — в tsconfig).
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const contractWhat: Same<StandLogWhat, DemoLogEntry["what"]> = true;
const contractIds: Same<keyof StandLogEntry["ids"], keyof DemoLogEntry["ids"]> = true;
const fromStand = (e: DemoLogEntry): StandLogEntry => e;

let logSeq = 0;
const T0 = Date.UTC(2026, 10, 11, 15, 0, 0);
const entry = (what: StandLogEntry["what"], ids: StandLogEntry["ids"], o: { test?: StandTest; atMs?: number } = {}): StandLogEntry => ({
  seq: ++logSeq,
  at: new Date(o.atMs ?? T0).toISOString(),
  kind: what === "MARKED" || what.startsWith("CLIENT_") ? "action" : "fault",
  ...(o.test !== undefined && { test: o.test }),
  what,
  ids,
});
/** Сбой «П» в точной форме записи стенда v0.48.0 (`StandFaultForm`): лишний или недостающий идентификатор — ошибка tsc. */
const fault = <W extends keyof StandFaultForm>(what: W, ids: StandFaultIds<W>, test: StandTest, atMs?: number): StandLogEntry =>
  entry(what, ids, { test, ...(atMs !== undefined && { atMs }) });
const withLog = (items: Interpretation[], standLog: StandLogEntry[], o: { now?: number } = {}) =>
  evaluate(buildTxModel(items), items, { standLog, ...(o.now !== undefined && { now: new Date(o.now).toISOString() }) });
const txOf = (v: ReturnType<typeof withLog>) => v.objs.find((x) => x.kind === "tx")!.conds;

describe("«упреждено реакцией» у R21 (П-8.2, У-04, Р-1531)", () => {
  // Запрос подтверждения и одобрение Платформы; время напоминания — относительно события одобрения (часы стенда).
  const conf = (n: string) => {
    const req = event("confirmation.required", { confirmation_id: `Q${n}`, order_id: `O${n}` }, { stage: "confirmation" });
    const ok = event("confirmation.approved", { confirmation_id: `Q${n}`, order_id: `O${n}` }, { stage: "confirmation" });
    return { items: purchase(n, { at: { start: () => [req, ok] } }), okAt: Date.parse(ok.at) };
  };
  const remind = (q: string, atMs: number, what: StandLogEntry["what"] = "CLIENT_REMINDED") => entry(what, { confirmation_id: q }, { atMs });

  it("напоминание по тому же запросу до одобрения — «соблюдено» с пометкой «упреждено реакцией», запись стенда — в доказательствах; паспорта нет", () => {
    const { items, okAt } = conf("U1");
    const e = remind("QU1", okAt - 5_000);
    const view = withLog(items, [e]);
    expect(txOf(view).R21).toMatchObject({ status: "ok", note: "preempted_by_reaction", log: [e.seq] });
    expect(verdicts(view, buildTxModel(items), items).filter((v) => v.cond === "R21")).toEqual([]);
    // Ревью П-8.2 № 4: пометка одной покупки — у объекта; в сводный R21 и в плитки узлов «Условий» не поднимается.
    expect(view.system.R21.note).toBeUndefined();
    expect(conditionsView(view).nodes.flatMap((nd) => nd.notes)).not.toContain("preempted_by_reaction");
    // Повтор напоминания (без продления) — тоже напоминание.
    const again = remind("QU1", okAt - 1_000, "REMIND_REPEATED");
    expect(txOf(withLog(items, [again])).R21).toMatchObject({ status: "ok", note: "preempted_by_reaction", log: [again.seq] });
  });

  it("напоминание после одобрения, по другому запросу, без журнала (режим показа) — просто «соблюдено», без пометки", () => {
    const { items, okAt } = conf("U2");
    const plain = (c: CondResults) => expect([c.R21.status, c.R21.note]).toEqual(["ok", undefined]);
    plain(txOf(withLog(items, [remind("QU2", okAt + 1_000)])));
    plain(tx(items));
    // Другой запрос той же покупки (повтор после отказа): напоминание по первому, одобрен второй — не «упреждено».
    const ev = (ref: string, q: string) => event(ref, { confirmation_id: q, order_id: "OU2b" }, { stage: "confirmation" });
    const retry = [ev("confirmation.required", "QA"), ev("confirmation.rejected", "QA"), ev("confirmation.required", "QB"), ev("confirmation.approved", "QB")];
    const two = purchase("U2b", { at: { start: () => retry } });
    const okB = Date.parse(retry[3]!.at);
    plain(txOf(withLog(two, [remind("QA", okB - 5_000)])));
    expect(txOf(withLog(two, [remind("QB", okB - 5_000)])).R21.note).toBe("preempted_by_reaction");
    // Сбой стенда по тому же запросу — не напоминание.
    plain(txOf(withLog(items, [fault("UPK_CODE_LEAKED", { confirmation_id: "QU2" }, "Н-11", okAt - 5_000)])));
  });

  it("срок истёк после напоминания — «сработало», не «упреждено»", () => {
    const req = event("confirmation.required", { confirmation_id: "QU3", order_id: "OU3" }, { stage: "confirmation" });
    const exp = event("confirmation.expired", { confirmation_id: "QU3", order_id: "OU3" }, { stage: "confirmation" });
    const items = purchase("U3", { skip: ["start", "pay", "done"], at: { end: () => [req, exp] } });
    expect(txOf(withLog(items, [remind("QU3", Date.parse(exp.at) - 5_000)])).R21).toMatchObject({ status: "fired", cause: { kind: "rule", rule: "confirmation_expired" } });
  });

  it("текст пометки — без причинности, ru/en (Р-1531); экран пишет тот же текст в журнале реакций", () => {
    expect(NOTE_LABEL.preempted_by_reaction.ru).toContain("напоминание было до подтверждения — нарушения нет");
    expect(NOTE_LABEL.preempted_by_reaction.en).toContain("no breach");
    expect(PULT["act.preempted"]).toEqual(NOTE_LABEL.preempted_by_reaction);
  });
});

describe("журнал сбоев стенда и пометки «ПР» (П-3.2в)", () => {
  it("контракт записи — как у стенда v0.48.0: перечень тестов, коды и идентификаторы", () => {
    expect([...STAND_TESTS]).toEqual([...DEMO_TESTS]);
    expect([contractWhat, contractIds, typeof fromStand]).toEqual([true, true, "function"]);
  });

  it("журнал подключён и пуст — условия журнала считаются: обычная покупка — R23, R25, R27, R31, R32 соблюдены, R20 и R47 не применяются; без журнала — «на стенде не проверяется»", () => {
    const items = purchase("L1");
    expect(statuses(withLog(items, []).objs[0]!.conds)).toMatchObject({ R20: "na", R23: "ok", R25: "ok", R27: "ok", R31: "ok", R32: "ok", R47: "na" });
    expect(withLog(items, []).system.R47.status).toBe("na");
    expect(run(items).objs[0]!.conds.R31).toMatchObject({ status: "none", note: "stand_log" });
  });

  it("сбои «П»: утечка кода УПК — R20; второй реквизит — R23 и R25; витрина исполнила заказ до итога — R32 «нарушено»; запись журнала — в доказательствах", () => {
    const q = (n: string) => [
      event("confirmation.required", { confirmation_id: `Q${n}`, order_id: `O${n}` }, { stage: "confirmation" }),
      event("confirmation.approved", { confirmation_id: `Q${n}`, order_id: `O${n}` }, { stage: "confirmation" }),
    ];
    const leak = fault("UPK_CODE_LEAKED", { confirmation_id: "QL2" }, "Н-11");
    expect(txOf(withLog(purchase("L2", { at: { start: () => q("L2") } }), [leak])).R20).toMatchObject({ status: "bad", log: [leak.seq] });
    expect(txOf(withLog(purchase("L2b", { at: { start: () => q("L2b") } }), [])).R20.status).toBe("ok");
    // Н-02 — форма стенда: поручение корзины, продавец, номер заказа в запросе реквизита (`order_ref`).
    const second = fault("SECOND_CREDENTIAL_ISSUED", { mandate_id: "CL3", merchant_id: "MER-1", order_ref: "OL3" }, "Н-02");
    const c3 = txOf(withLog(purchase("L3"), [second]));
    expect([c3.R23.status, c3.R25.status]).toEqual(["bad", "bad"]);
    // Привязка по `order_ref` — и без поручения корзины в записи.
    const byRef = entry("SECOND_CREDENTIAL_ISSUED", { merchant_id: "MER-1", order_ref: "OL3b" }, { test: "Н-02" });
    expect(txOf(withLog(purchase("L3b"), [byRef])).R23.status).toBe("bad");
    const fulfilled = fault("FULFILLED_BEFORE_OUTCOME", { shop_id: "SHOP-1", merchant_id: "MER-1", order_id: "OL4" }, "Н-04");
    expect(txOf(withLog(purchase("L4"), [fulfilled])).R32).toMatchObject({ status: "bad", log: [fulfilled.seq] });
  });

  it("Н-02 (Р-1537; ревью П-3.2г № 3): номер заказа нашей покупки с чужим поручением в записи — не к нашей, а по поручению", () => {
    const ours = purchase("N1");
    const theirs = purchase("N2");
    const items = [...ours, ...theirs];
    const model = buildTxModel(items);
    const id = (cart: string) => model.txs.find((t) => t.cartMandateId === cart)!.id;
    const e = fault("SECOND_CREDENTIAL_ISSUED", { mandate_id: "CN2", merchant_id: "MER-1", order_ref: "ON1" }, "Н-02");
    const v = withLog(items, [e]);
    const st = (cart: string) => v.objs.find((o) => o.id === id(cart))!.conds;
    expect([st("CN1").R23.status, st("CN1").R25.status]).toEqual(["ok", "ok"]);
    expect(st("CN1").R23.log).toBeUndefined();
    expect(st("CN2").R23).toMatchObject({ status: "bad", log: [e.seq] });
    // Поручение записи совпадает с нашим — по-прежнему к нашей (уровень заказа).
    const same = fault("SECOND_CREDENTIAL_ISSUED", { mandate_id: "CN1", merchant_id: "MER-1", order_ref: "ON1" }, "Н-02");
    expect(withLog(items, [same]).objs.find((o) => o.id === id("CN1"))!.conds.R23).toMatchObject({ status: "bad", log: [same.seq] });
    // Чужое поручение ни к одной транзакции — запись системы, у нашей «нарушено» нет.
    const stray = fault("SECOND_CREDENTIAL_ISSUED", { mandate_id: "C-чужая", merchant_id: "MER-1", order_ref: "ON1" }, "Н-02");
    const w = withLog(items, [stray]);
    expect(w.objs.find((o) => o.id === id("CN1"))!.conds.R23.status).toBe("ok");
    expect(w.system.R23.status).toBe("bad");
  });

  it("повтор запроса отклонён Платформой (IDEMPOTENCY_CONFLICT) — R23 и R25 «сработало»", () => {
    const items = purchase("L5", { at: { done: () => [step("failed", { order_id: "OL5", mandate_id: "CL5" }, { code: "IDEMPOTENCY_CONFLICT" })] } });
    const c = txOf(withLog(items, []));
    expect([c.R23.status, c.R25.status]).toEqual(["fired", "fired"]);
  });

  it("В7, Н-03: витрина ответила «оплачено» до итога — R27 «сработало» (нарушила витрина, защитил пульт), R28 и R30 «соблюдено»", () => {
    const paid = fault("PAID_BEFORE_OUTCOME", { shop_id: "SHOP-1", merchant_id: "MER-1", order_id: "OL6" }, "Н-03");
    const c = txOf(withLog(purchase("L6"), [paid]));
    expect([c.R27.status, c.R28.status, c.R30.status]).toEqual(["fired", "ok", "ok"]);
    expect(c.R27.log).toEqual([paid.seq]);
  });

  it("В7, Н-12: поздний итог пришёл — R31 «соблюдено»; итога нет — «ждёт» до срока (75 с: задержка стенда до 60 с + запас), после — «нарушено»; «сейчас» — аргументом", () => {
    const late = fault("OUTCOME_EVENT_DELAYED", { op_ref: "PL7" }, "Н-12", T0);
    expect(txOf(withLog(purchase("L7"), [late], { now: T0 + 120_000 })).R31).toMatchObject({ status: "ok", log: [late.seq] });
    expect(LATE_MS).toBe(STAND_DELAY_MAX_MS + 15_000);
    // Живая форма (ревью П-3.2в № 1): событие задержано — операции на шине ещё нет, запись стенда несёт только op_ref и
    // остаётся без объекта; судить — сводно по шине.
    const pending = purchase("L8", { skip: ["done"] });
    const late8 = fault("OUTCOME_EVENTS_REORDERED", { op_ref: "PL8" }, "Н-12", T0);
    // Законная задержка 30 с — не «нарушено» (ревью П-3.2в № 2: срок контролёра 15 с дал бы ложное).
    expect(withLog(pending, [late8], { now: T0 + 30_000 }).system.R31).toMatchObject({ status: "wait", log: [late8.seq] });
    expect(withLog(pending, [late8], { now: T0 + LATE_MS + 1 }).system.R31).toMatchObject({ status: "bad", log: [late8.seq] });
    // Без «сейчас» срок не считается — «ждёт», не «нарушено».
    expect(withLog(pending, [late8]).system.R31.status).toBe("wait");
    // Без op_ref в записи (стенд пишет пустые ids; Р-1537, повторное ревью П-3.2в № D): до срока — «ждёт»; после — не
    // «ждёт» навсегда: статус — от объектов (покупка завершена — «соблюдено»; покупок нет — «не применяется») с пометкой.
    const blank = entry("OUTCOME_EVENT_DELAYED", {}, { test: "Н-12", atMs: T0 });
    const done9 = purchase("L9");
    expect(withLog(done9, [blank], { now: T0 + 30_000 }).system.R31).toMatchObject({ status: "wait", log: [blank.seq] });
    const after = withLog(done9, [blank], { now: T0 + LATE_MS + 1 }).system.R31;
    expect(after).toMatchObject({ status: "ok", note: "late_unlinked" });
    expect(after.log).toContain(blank.seq);
    expect(withLog([], [blank], { now: T0 + LATE_MS + 1 }).system.R31).toMatchObject({ status: "na", note: "late_unlinked", log: [blank.seq] });
    // Покупка ещё идёт — «ждёт» от самой покупки, а не от записи; запись — в доказательствах, пометки нет (ревью блока № 6).
    const going = withLog(pending, [blank], { now: T0 + LATE_MS + 1 }).system.R31;
    expect(going.status).toBe("wait");
    expect(going.log).toContain(blank.seq);
    expect(going.note).toBeUndefined();
    expect([NOTE_LABEL.late_unlinked.ru, NOTE_LABEL.late_unlinked.en].every((s) => s !== "")).toBe(true);
    // Долгий прогон (повторное ревью № A): запись стенда старше первой записи в окне — её покупка ушла из окна, «нет на
    // шине» ложно: не судится.
    const old = fault("OUTCOME_EVENT_DELAYED", { op_ref: "PGONE" }, "Н-12", Date.parse(pending[0]!.at) - 1);
    const aged = withLog(pending, [old], { now: T0 + 10 * LATE_MS }).system.R31;
    expect(aged).toEqual(withLog(pending, [], { now: T0 + 10 * LATE_MS }).system.R31);
    expect(aged.status).not.toBe("bad");
    // Событие пришло — запись привязывается к транзакции по op_ref: «соблюдено» и после срока.
    const arrived = [...pending, event("operation.authorized", { op_ref: "PL8", order_id: "OL8" }), step("outcome", { op_ref: "PL8", order_id: "OL8", mandate_id: "CL8" })];
    const v = withLog(arrived, [late8], { now: T0 + LATE_MS + 1 });
    expect([txOf(v).R31.status, v.system.R31.status]).toEqual(["ok", "ok"]);
  });

  it("R47: каталог с инструкцией агенту отдан, агент исключил предложение (A5_INSTRUCTION) — «сработало»; не исключил — «ждёт»; Н-05 — «нарушено»", () => {
    const served = fault("INSTRUCTION_SERVED", { shop_id: "SHOP-6", merchant_id: "MER-6" }, "Н-05");
    const excluded = rec("console", "offer.excluded", { merchant_id: "MER-6" }, { stage: "search", code: "A5_INSTRUCTION" });
    const items = purchase("L9");
    expect(withLog([excluded, ...items], [served]).system.R47).toMatchObject({ status: "fired", seqs: [excluded.seq], log: [served.seq] });
    expect(withLog(items, [served]).system.R47.status).toBe("wait");
    const mark = entry("MARKED", { order_id: "OL9" }, { test: "Н-05" });
    const v = withLog(items, [served, mark]);
    expect(txOf(v).R47).toMatchObject({ status: "bad", log: [mark.seq] });
    expect(v.system.R47.status).toBe("bad");
  });

  it("пометки «ПР»: Н-08 → R17 «сработало» при отказе Платформы, «нарушено» без него; Н-06 → R37, Н-01 → R46, Н-07 → R18, Н-09 → R26 «нарушено»; пометка без объекта — к системе", () => {
    const mk = (test: StandTest, n: string) => entry("MARKED", { order_id: `O${n}` }, { test });
    // Решение по П-3.3, 1: Платформа не отказала (операция оплачена) — «нарушено»; отказала (MANDATE_SCOPE) — «сработало».
    expect(txOf(withLog(purchase("M8"), [mk("Н-08", "M8")])).R17.status).toBe("bad");
    const scope = purchase("M8s", { skip: ["start", "pay", "done"], at: { end: () => scopeRefused("CM8s", "OM8s") } });
    expect(txOf(withLog(scope, [mk("Н-08", "M8s")])).R17).toMatchObject({ status: "fired", cause: { kind: "mark", test: "Н-08", bus: "mandate_scope_platform" } });
    // Повторное ревью П-3.3 № 1: две пометки Н-08 при отказе Платформы — вторая не теряет отказ, остаётся «сработало».
    expect(txOf(withLog(scope, [mk("Н-08", "M8s"), mk("Н-08", "M8s")])).R17).toMatchObject({ status: "fired", cause: { kind: "mark", test: "Н-08", bus: "mandate_scope_platform" } });
    // Н-06: агент не записал «узнал об отзыве» — по шине гонка С-28 («ждёт»); пометка приложения — «нарушено».
    const ignore = purchase("M6", { at: { start: () => [event("mandate.revoked", { mandate_id: "CM6" }, { stage: "revoke" })] } });
    expect(txOf(withLog(ignore, [])).R37.status).toBe("wait");
    expect(txOf(withLog(ignore, [mk("Н-06", "M6")])).R37.status).toBe("bad");
    expect(txOf(withLog(purchase("M1"), [mk("Н-01", "M1")])).R46.status).toBe("bad");
    expect(txOf(withLog(purchase("M7"), [mk("Н-07", "M7")])).R18.status).toBe("bad");
    expect(txOf(withLog(purchase("M9"), [mk("Н-09", "M9")])).R26.status).toBe("bad");
    // Пометка по поручению без покупки — у поручения; без объекта — сводно.
    const intentOnly = [step("intent.awaiting_signature", { mandate_id: "IMX" }, { stage: "mandate" }), event("mandate.signed", { mandate_id: "IMX" })];
    const v = withLog(intentOnly, [entry("MARKED", { mandate_id: "IMX" }, { test: "Н-06" }), entry("UPK_CODE_LEAKED", { confirmation_id: "Q-нет" })]);
    expect(v.objs[0]!.conds.R37.status).toBe("bad");
    expect(v.system.R20.status).toBe("bad");
  });
});

// П-3.2г (ревью П-3.2в № 3, 4; решение владельца — отзыв PR #9 «(чат, 11.11) — ответ на план П-3.2г»): привязка записи
// журнала стенда по старшинству полей; неточная привязка — не выше «ждёт».
describe("привязка записей журнала стенда (П-3.2г)", () => {
  const statusOf = (v: ReturnType<typeof withLog>, id: string, c: keyof CondResults) => v.objs.find((x) => x.id === id)!.conds[c];

  it("две покупки — запись одной не трогает другую", () => {
    const items = [...purchase("G1"), ...purchase("G2")];
    const v = withLog(items, [fault("FULFILLED_BEFORE_OUTCOME", { shop_id: "SHOP-1", merchant_id: "MER-1", order_id: "OG1" }, "Н-04")]);
    expect([statusOf(v, "CG1", "R32").status, statusOf(v, "CG2", "R32").status]).toEqual(["bad", "ok"]);
  });

  it("смешанные идентификаторы: операция одной покупки и заказ другой — решает старший уровень (операция)", () => {
    const items = [...purchase("G3"), ...purchase("G4")];
    const v = withLog(items, [entry("MARKED", { op_ref: "PG4", order_id: "OG3" }, { test: "Н-01" })]);
    expect([statusOf(v, "CG3", "R46").status, statusOf(v, "CG4", "R46").status]).toEqual(["ok", "bad"]);
    // Запрос подтверждения старше заказа.
    const q = [event("confirmation.required", { confirmation_id: "QG6", order_id: "OG6" }, { stage: "confirmation" })];
    const items2 = [...purchase("G5"), ...purchase("G6", { at: { start: () => q } })];
    const v2 = withLog(items2, [entry("MARKED", { confirmation_id: "QG6", order_id: "OG5" }, { test: "Н-07" })]);
    expect([statusOf(v2, "CG5", "R18").status, statusOf(v2, "CG6", "R18").status]).toEqual(["ok", "bad"]);
  });

  it("номер заказа с витриной: заказ этого номера был у другой витрины — запись к покупке не привязывается", () => {
    const v = withLog(purchase("G7"), [fault("FULFILLED_BEFORE_OUTCOME", { shop_id: "SHOP-9", merchant_id: "MER-9", order_id: "OG7" }, "Н-04")]);
    expect(statusOf(v, "CG7", "R32").status).toBe("ok");
  });

  it("несколько кандидатов (намерение с двумя корзинами) — запись ко всем, статус не выше «ждёт» с пометкой", () => {
    // Две корзины одного намерения IGX (вторая — без своих записей намерения).
    const items = [...purchase("G8", { intentId: "IGX" }), ...purchase("G9", { intentId: "IGX", intent: () => [] })];
    const mark = entry("MARKED", { mandate_id: "IGX" }, { test: "Н-07" });
    const v = withLog(items, [mark]);
    for (const id of ["CG8", "CG9"]) expect(statusOf(v, id, "R18"), id).toMatchObject({ status: "wait", note: "link_conflict", log: [mark.seq] });
  });

  it("ревью П-3.2в № 4, Н-04: конфликт звеньев (две покупки с одним номером заказа) — сбой по номеру заказа поднимает R32 не выше «ждёт», пометка сохраняется", () => {
    const one = purchase("K1", { skip: ["order", "start", "pay", "done"] });
    const two = purchase("K2", { skip: ["order", "start", "pay", "done"] });
    const tail = [
      step("order.placed", { order_id: "OKX", mandate_id: "CK1", merchant_id: "MER-1" }),
      step("payment.started", { order_id: "OKX" }),
      call(PAY, { shop_id: "SHOP-1", order_id: "OKX" }, "agent_merchant"),
      step("order.placed", { order_id: "OKX", mandate_id: "CK2", merchant_id: "MER-2" }),
    ];
    const items = [...one, ...two, ...tail];
    const t = buildTxModel(items).txs.find((x) => x.linkConflict)!;
    const n04 = fault("FULFILLED_BEFORE_OUTCOME", { shop_id: "SHOP-1", merchant_id: "MER-1", order_id: "OKX" }, "Н-04");
    expect(statusOf(withLog(items, [n04]), t.id, "R32")).toMatchObject({ status: "wait", note: "link_conflict", log: [n04.seq] });
    // Повторное ревью № 1: пометка только с поручением одной из конфликтующих корзин — к той же транзакции, не выше «ждёт»;
    // в систему без ограничения не уходит.
    const mark = entry("MARKED", { mandate_id: "CK1" }, { test: "Н-07" });
    const v = withLog(items, [mark]);
    expect(statusOf(v, t.id, "R18")).toMatchObject({ status: "wait", note: "link_conflict", log: [mark.seq] });
    expect(v.system.R18.status).not.toBe("bad");
  });
});

// П-3.3 (решение владельца — отзыв PR #9 «(чат, 11.11) — ответ на план П-3.3»): «кто нарушил / кто защитил» — субъект по
// причине явной таблицей; ожидания — задание на тестирование v1.0 (колонка «Что ожидать в „Контроле“», sha256 0096499d…),
// отступления В7 (Н-03, Н-12), В8 (Н-08), Н-06 — R37 по пометке (STATUS «Открыто»). Субъект проверяется тестом, а не
// выводится из текста правила.
describe("кто нарушил / кто защитил (П-3.3)", () => {
  const panDigits = (() => {
    const body = "9" + "1".repeat(14);
    let sum = 0;
    for (let i = 0; i < body.length; i++) {
      let d = Number(body[body.length - 1 - i]);
      if (i % 2 === 0) d = d * 2 > 9 ? d * 2 - 9 : d * 2;
      sum += d;
    }
    return body + String((10 - (sum % 10)) % 10);
  })();
  const mk = (test: StandTest, ids: StandLogEntry["ids"]) => entry("MARKED", ids, { test });
  const req = (n: string) => event("confirmation.required", { confirmation_id: `Q${n}`, order_id: `O${n}` }, { stage: "confirmation" });
  type Want = Partial<Pick<Verdict, "kind" | "violator" | "protector" | "node" | "cond" | "guarantee">>;
  type Row = { readonly test: string; readonly items: () => Interpretation[]; readonly log?: () => StandLogEntry[]; readonly now?: number; readonly want: readonly Want[] };
  const rows: readonly Row[] = [
    {
      test: "П-03 клиент отказался от корзины — решение клиента",
      items: () => purchase("V3", { skip: ["signed", "order", "start", "pay", "done"], at: { end: () => [event("mandate.rejected", { mandate_id: "CV3" })] } }),
      want: [{ kind: "client_decision", violator: "client_decision" }],
    },
    {
      // Р-1538 (находка окна Б, PR #15): живая форма сюжета 6 — после отказа клиента агент остановился с
      // MANDATE_NOT_ACTIVE (журнал): решение клиента, защитил агент, одна запись — не «не определён» с паспортом.
      test: "П-03 на стенде: отказ от корзины, затем MANDATE_NOT_ACTIVE в журнале агента — решение клиента, защитил агент",
      items: () =>
        purchase("V3s", {
          skip: ["signed", "order", "start", "pay", "done"],
          at: {
            end: () => [
              event("mandate.rejected", { mandate_id: "CV3s" }),
              journal("agent.refused", { mandate_id: "CV3s" }, "MANDATE_NOT_ACTIVE"),
              step("cart.rejected", { mandate_id: "CV3s" }, { code: "MANDATE_NOT_ACTIVE", stage: "outcome" }),
            ],
          },
        }),
      want: [{ cond: "R09", kind: "client_decision", violator: "client_decision", protector: "agent" }],
    },
    {
      test: "П-04 клиент не подтвердил код — решение клиента, защитила Платформа (R21)",
      items: () => purchase("V4", { skip: ["start", "pay", "done"], at: { end: () => [req("V4"), event("confirmation.expired", { confirmation_id: "QV4", order_id: "OV4" }, { stage: "confirmation" })] } }),
      want: [{ cond: "R21", kind: "client_decision", violator: "client_decision", protector: "platform" }],
    },
    {
      test: "П-06 агент вне поручения — не нарушение, защитила Платформа",
      items: () => purchase("V6", { skip: ["start", "pay", "done"], at: { end: () => scopeRefused("CV6", "OV6") } }),
      want: [{ cond: "R17", kind: "protection", protector: "platform" }],
    },
    {
      // Ревью П-3.3 № 3: внутри транзакции — один вердикт R09, без противоречия «защитила Платформа / защитил агент».
      test: "П-08 клиент отозвал поручение (в транзакции) — нарушил: решение клиента, защитил: агент",
      items: () =>
        purchase("V8", {
          skip: ["start", "pay", "done"],
          // Как на живом сюжете 5: агент записал отказ в журнал (Р-1519).
          at: {
            end: () => [
              event("mandate.revoked", { mandate_id: "CV8" }, { stage: "revoke" }),
              journal("agent.refused", { mandate_id: "CV8" }, "MANDATE_REVOKED"),
              step("failed", { order_id: "OV8", mandate_id: "CV8" }, { code: "MANDATE_REVOKED" }),
            ],
          },
        }),
      want: [{ cond: "R09", kind: "client_decision", violator: "client_decision", protector: "agent" }],
    },
    {
      // Ревью П-5.1 № 16: срок и один MANDATE_NOT_ACTIVE — только шаг сюжета — защитник не определён.
      test: "срок поручения, остановка только в шаге сюжета — защитник не определён",
      items: () => purchase("VE", { skip: ["start", "pay", "done"], at: { end: () => [step("failed", { order_id: "OVE", mandate_id: "CVE" }, { code: "MANDATE_EXPIRED" })] } }),
      want: [{ cond: "R09", kind: "protection", protector: "undetermined" }],
    },
    {
      test: "MANDATE_NOT_ACTIVE, остановка только в шаге сюжета — нарушитель и защитник не определены",
      items: () => purchase("VG", { skip: ["start", "pay", "done"], at: { end: () => [step("failed", { order_id: "OVG", mandate_id: "CVG" }, { code: "MANDATE_NOT_ACTIVE" })] } }),
      want: [{ cond: "R09", kind: "protection", violator: "undetermined", protector: "undetermined", node: "У5" }],
    },
    {
      // Р-1519: остановка только в шаге сюжета — рассказ стенда, не доказательство: защитник «не определён».
      test: "отзыв в транзакции, остановка видна только в шаге сюжета — защитник не определён",
      items: () =>
        purchase("VC", {
          skip: ["start", "pay", "done"],
          at: { end: () => [event("mandate.revoked", { mandate_id: "CVC" }, { stage: "revoke" }), step("failed", { order_id: "OVC", mandate_id: "CVC" }, { code: "MANDATE_REVOKED" })] },
        }),
      want: [{ cond: "R09", kind: "client_decision", violator: "client_decision", protector: "undetermined" }],
    },
    {
      // Ревью П-3.3 № 3, уточнение Р-1519: ответ Платформы MANDATE_REVOKED и запись агента об отказе — защитила Платформа
      // (агент лишь узнал об отказе).
      test: "отзыв в транзакции: ответ Платформы MANDATE_REVOKED и журнал агента — защитила Платформа",
      items: () =>
        purchase("VD", {
          skip: ["start", "pay", "done"],
          at: {
            end: () => [
              event("mandate.revoked", { mandate_id: "CVD" }, { stage: "revoke" }),
              call("POST /pao/v1/credentials", { mandate_id: "CVD" }, "agent_platform", { code: "MANDATE_REVOKED", kind: "conflict" }),
              journal("agent.refused", { mandate_id: "CVD" }, "MANDATE_REVOKED"),
              step("failed", { order_id: "OVD", mandate_id: "CVD" }, { code: "MANDATE_REVOKED" }),
            ],
          },
        }),
      want: [{ cond: "R09", kind: "client_decision", violator: "client_decision", protector: "platform" }],
    },
    {
      // П-05 (задание v1.0): отказ банка по лимиту клиента — решение клиента, защитил банк; вердикт — по сработавшей защите.
      test: "П-05 превышен лимит клиента в банке — решение клиента, защитил банк",
      items: () => purchase("V5", { skip: ["done"], at: { end: () => [event("operation.declined", { op_ref: "PV5", order_id: "OV5" }, { stage: "outcome", code: "LIMIT_EXCEEDED", detail: "CLIENT" }), step("limit.declined", { op_ref: "PV5", order_id: "OV5", mandate_id: "CV5" }, { stage: "outcome" })] } }),
      want: [{ guarantee: "limit_client", kind: "client_decision", violator: "client_decision", protector: "bank" }],
    },
    {
      // П-07 (задание v1.0): приостановленный агент — защитила Платформа (403); ответ 403, журнал и шаг — одна защита.
      test: "П-07 агент приостановлен — защитила Платформа (403), одна защита",
      items: () =>
        purchase("V7", {
          skip: ["start", "pay", "done"],
          at: {
            end: () => [
              call("POST /pao/v1/credentials", { mandate_id: "CV7" }, "agent_platform", { code: "AGENT_SUSPENDED", kind: "conflict" }),
              journal("agent.refused", { mandate_id: "CV7" }, "AGENT_SUSPENDED"),
              step("failed", { order_id: "OV7", mandate_id: "CV7" }, { code: "AGENT_SUSPENDED" }),
            ],
          },
        }),
      want: [{ guarantee: "agent_suspended", kind: "protection", protector: "platform" }],
    },
    {
      // Форма после передачи агенту: ядро 4a4ee7c на истёкшем поручении даёт MANDATE_NOT_ACTIVE (строка ниже —
      // «не определён»), код MANDATE_EXPIRED появится после неё (расхождение № 7).
      test: "срок поручения в транзакции — форма после передачи агенту (MANDATE_EXPIRED): нарушителя нет, защитил агент",
      // Остановку агента доказывает его журнал (П-5.1, Р-1519): шаг сюжета — только рассказ стенда.
      items: () => purchase("V9", { skip: ["start", "pay", "done"], at: { end: () => [journal("agent.refused", { mandate_id: "CV9" }, "MANDATE_EXPIRED"), step("failed", { order_id: "OV9", mandate_id: "CV9" }, { code: "MANDATE_EXPIRED" })] } }),
      want: [{ cond: "R09", kind: "protection", protector: "agent" }],
    },
    {
      // Настоящая форма П-09 стенда (сюжет 10 окна Б): поручение без покупки, отказ ядра MANDATE_OUT_OF_SCOPE не раньше
      // срока поручения из его данных — срок: R09 «сработало», защитил агент (журнал), нарушителя нет (П-5.1а, Р-1536;
      // было — «вердиктов нет»).
      test: "П-09 срок поручения истёк (форма стенда: MANDATE_OUT_OF_SCOPE после valid_to) — R09 сработало, защитил агент",
      items: () => coreRefusal("IV9", "earlier", { kind: "expiry" }),
      want: [{ cond: "R09", kind: "protection", protector: "agent" }],
    },
    {
      // Р-1536 п. 2: поручение действует строго до valid_to, как у Платформы — отказ в момент срока — срок.
      test: "П-09 отказ ровно в момент valid_to — срок: R09 сработало, защитил агент",
      items: () => coreRefusal("IV9s", "same", { kind: "expiry" }),
      want: [{ cond: "R09", kind: "protection", protector: "agent" }],
    },
    {
      // Настоящая форма П-06 стенда (сюжет 8): отказ ядра раньше срока поручения — вне пределов, защитил агент (Р-1524).
      test: "П-06 на стенде (MANDATE_OUT_OF_SCOPE раньше valid_to) — R17 сработало, защитил агент",
      items: () => coreRefusal("IV6", "later"),
      want: [{ cond: "R17", kind: "protection", protector: "agent" }],
    },
    {
      // Р-1519: без журнала агента — только рассказ стенда: защитник «не определён». Форма шага сюжета 10 (`mandate_id`);
      // у шага сюжета 8 (`scope.refused`) поручения нет — строка ниже (ревью П-5.1а № 1).
      test: "отказ ядра только в шаге сюжета с поручением, раньше срока — R17 сработало, защитник не определён",
      items: () => coreRefusal("IV6s", "later", { journal: false, kind: "expiry" }),
      want: [{ cond: "R17", kind: "protection", protector: "undetermined" }],
    },
    {
      // Ревью П-5.1а № 1: шаг `scope.refused` несёт только `intent_id` — модель транзакций его к поручению не привязывает;
      // без журнала агента отказ пульту не виден — вердикта нет (не ложный «вне пределов»).
      test: "П-06 на стенде без журнала агента (шаг scope.refused только с intent_id) — вердиктов нет",
      items: () => coreRefusal("IV6n", "later", { journal: false }),
      want: [],
    },
    {
      // Р-1524: срока поручения нет — признак не определить — не «вне пределов» и не «срок»: вердикта нет.
      test: "П-06 / П-09 без срока поручения на шине — вердиктов нет",
      items: () => coreRefusal("IV0", "none"),
      want: [],
    },
    {
      // Ревью П-3.3 № 1: без положительного признака отзыва или срока — не «П-09 по умолчанию».
      test: "MANDATE_NOT_ACTIVE без признака отзыва или срока — защитил агент, нарушитель не определён",
      items: () => purchase("VA", { skip: ["start", "pay", "done"], at: { end: () => [journal("agent.refused", { mandate_id: "CVA" }, "MANDATE_NOT_ACTIVE"), step("failed", { order_id: "OVA", mandate_id: "CVA" }, { code: "MANDATE_NOT_ACTIVE" })] } }),
      want: [{ cond: "R09", kind: "protection", violator: "undetermined", protector: "agent", node: "У5" }],
    },
    {
      // Решение по П-3.3, 2 (В5): «оплачено» после отзыва — гонка С-28, субъект не определён (расхождение № 7).
      test: "R09 «оплачено» после отзыва — нарушитель не определён, гонка С-28",
      items: () => purchase("VB", { at: { done: () => [event("mandate.revoked", { mandate_id: "CVB" }, { stage: "revoke" })] } }),
      want: [{ cond: "R09", kind: "violation", violator: "undetermined", node: "У5" }],
    },
    {
      test: "R21: агент начал оплату после срока подтверждения — нарушил агент",
      items: () => [
        ...purchase("VC", { skip: ["pay", "done"], at: { start: () => [req("VC"), event("confirmation.expired", { confirmation_id: "QVC", order_id: "OVC" }, { stage: "confirmation" })] } }),
      ],
      want: [{ cond: "R21", kind: "violation", violator: "agent" }],
    },
    {
      test: "R21: операция Платформы после срока подтверждения — нарушила Платформа",
      items: () => purchase("VD", { at: { start: () => [req("VD"), event("confirmation.expired", { confirmation_id: "QVD", order_id: "OVD" }, { stage: "confirmation" })] } }),
      want: [{ cond: "R21", kind: "violation", violator: "platform" }],
    },
    {
      test: "R08: подпись поручения сетью (не эмулятором банка и не агентом) — нарушитель не определён",
      items: () =>
        purchase("VE", { intent: () => [step("intent.awaiting_signature", { mandate_id: "IVE" }, { stage: "mandate" }), call(SIGN, { mandate_id: "IVE" }, "network_platform"), event("mandate.signed", { mandate_id: "IVE" })] }),
      want: [{ cond: "R08", kind: "violation", violator: "undetermined" }],
    },
    { test: "Н-01 повторная оплата — R46, У2, агент", items: () => purchase("W1"), log: () => [mk("Н-01", { order_id: "OW1" })], want: [{ cond: "R46", kind: "violation", violator: "agent", node: "У2" }] },
    {
      test: "Н-02 второй реквизит на повтор — R23, R25, У2, платёжная система",
      items: () => purchase("W2"),
      log: () => [fault("SECOND_CREDENTIAL_ISSUED", { mandate_id: "CW2", merchant_id: "MER-1", order_ref: "OW2" }, "Н-02")],
      want: [
        { cond: "R23", kind: "violation", violator: "platform", node: "У2" },
        { cond: "R25", kind: "violation", violator: "platform", node: "У2" },
      ],
    },
    {
      test: "Н-03 итог по словам продавца (В7) — R27 сработало: нарушил продавец, защитил пульт, У3",
      items: () => purchase("W3"),
      log: () => [fault("PAID_BEFORE_OUTCOME", { shop_id: "SHOP-1", merchant_id: "MER-1", order_id: "OW3" }, "Н-03")],
      want: [{ cond: "R27", kind: "protection", violator: "merchant", protector: "operator", node: "У3" }],
    },
    {
      test: "Н-04 заказ по словам продавца — R32, У3, магазин",
      items: () => purchase("W4"),
      log: () => [fault("FULFILLED_BEFORE_OUTCOME", { shop_id: "SHOP-1", merchant_id: "MER-1", order_id: "OW4" }, "Н-04")],
      want: [{ cond: "R32", kind: "violation", violator: "merchant", node: "У3" }],
    },
    { test: "Н-05 агент выполнил инструкцию продавца — R47, У1, агент", items: () => purchase("W5"), log: () => [mk("Н-05", { order_id: "OW5" })], want: [{ cond: "R47", kind: "violation", violator: "agent", node: "У1" }] },
    {
      test: "Н-06 агент не видит отзыв — R37, У5, агент",
      items: () => purchase("W6", { at: { start: () => [event("mandate.revoked", { mandate_id: "CW6" }, { stage: "revoke" })] } }),
      log: () => [mk("Н-06", { order_id: "OW6" })],
      want: [{ cond: "R37", kind: "violation", violator: "agent", node: "У5" }],
    },
    { test: "Н-07 без согласия клиента — R18, агент, узла нет", items: () => purchase("W7"), log: () => [mk("Н-07", { order_id: "OW7" })], want: [{ cond: "R18", kind: "violation", violator: "agent", node: undefined }] },
    {
      test: "Н-08 сумма ≠ корзине (В8) — R17 сработало: нарушил агент, защитила Платформа",
      items: () => purchase("W8", { skip: ["start", "pay", "done"], at: { end: () => scopeRefused("CW8", "OW8") } }),
      log: () => [mk("Н-08", { order_id: "OW8" })],
      want: [{ cond: "R17", kind: "protection", violator: "agent", protector: "platform", node: undefined }],
    },
    {
      // Решение по П-3.3, 1: Платформа не отказала, операция оплачена — «нарушено», защитника нет (пометка доказывает
      // только попытку; «сработало» по одной пометке — ложный зелёный).
      test: "Н-08 без отказа Платформы, операция оплачена — R17 нарушено, нарушил агент, защитника нет",
      items: () => purchase("W8b"),
      log: () => [mk("Н-08", { order_id: "OW8b" })],
      want: [{ cond: "R17", kind: "violation", violator: "agent", node: undefined }],
    },
    { test: "Н-09 оплата другому продавцу — R26, агент", items: () => purchase("W9"), log: () => [mk("Н-09", { order_id: "OW9" })], want: [{ cond: "R26", kind: "violation", violator: "agent" }] },
    {
      test: "Н-10 данные карты в записи агента — R41, агент (на стенде не воспроизводится — инвариант 1)",
      items: () => purchase("WA", { at: { done: () => [rec("console", "shop.call", { order_id: "OWA" }, { phrase: { ru: panDigits, en: panDigits } })] } }),
      want: [{ cond: "R41", kind: "violation", violator: "agent" }],
    },
    {
      // Ревью П-3.3 № 6: номер в ответе продавца (шаг сюжета), а не в записи агента — нарушитель по источнику не определён.
      test: "R41: номер карты не в записи агента — нарушитель не определён",
      items: () => purchase("WAb", { at: { done: () => [step("order.shop_reply", { order_id: "OWAb" }, { phrase: { ru: panDigits, en: panDigits } })] } }),
      want: [{ cond: "R41", kind: "violation", violator: "undetermined" }],
    },
    {
      test: "Н-11 код SMS в шине — R20, банк",
      items: () => purchase("WB", { at: { start: () => [req("WB")] } }),
      log: () => [fault("UPK_CODE_LEAKED", { confirmation_id: "QWB" }, "Н-11")],
      want: [{ cond: "R20", kind: "violation", violator: "bank" }],
    },
    {
      test: "Н-12 потеря позднего события (В7) — R31, У4, оператор",
      items: () => purchase("WC", { skip: ["done"] }),
      log: () => [fault("OUTCOME_EVENT_DELAYED", { op_ref: "PWC" }, "Н-12", T0)],
      now: T0 + LATE_MS + 1,
      want: [{ cond: "R31", kind: "violation", violator: "operator", node: "У4" }],
    },
  ];

  for (const row of rows)
    it(row.test, () => {
      const items = row.items();
      const model = buildTxModel(items);
      const view = evaluate(model, items, { standLog: row.log?.() ?? [], ...(row.now !== undefined && { now: new Date(row.now).toISOString() }) });
      const vs = verdicts(view, model, items);
      for (const w of row.want) {
        const found = vs.find((v) => (w.cond === undefined || v.cond === w.cond) && (w.guarantee === undefined || v.guarantee === w.guarantee) && v.kind === w.kind);
        expect(found, JSON.stringify(w)).toBeDefined();
        expect({ violator: found!.violator, protector: found!.protector, node: found!.node }).toEqual({ violator: w.violator, protector: w.protector, node: w.node });
      }
      // Строка без ожиданий — вердиктов нет совсем.
      if (row.want.length === 0) expect(vs).toEqual([]);
      // «Правильные» (П-xx) — без нарушений: паспорт не появляется.
      if (row.test.startsWith("П-")) expect(vs.filter((v) => v.kind === "violation")).toEqual([]);
    });

  it("П-03 (Р-1538): MANDATE_NOT_ACTIVE после mandate.rejected этой корзины — одна запись «решение клиента», паспорта нет; без события или событие позже остановки — «не определён»", () => {
    const shape = (n: string, ev: "before" | "after" | "none" | "other") => {
      // Время записи — по порядку создания: событие «после» создаётся после остановки.
      const rejOf = () => event("mandate.rejected", { mandate_id: ev === "other" ? "C-чужая" : `C${n}` });
      const stopOf = () => [journal("agent.refused", { mandate_id: `C${n}` }, "MANDATE_NOT_ACTIVE"), step("cart.rejected", { mandate_id: `C${n}` }, { code: "MANDATE_NOT_ACTIVE", stage: "outcome" })];
      const tail = () => {
        if (ev === "none") return stopOf();
        if (ev === "after") return [...stopOf(), rejOf()];
        const rej = rejOf();
        return [rej, ...stopOf()];
      };
      return purchase(n, { skip: ["signed", "order", "start", "pay", "done"], at: { end: tail } });
    };
    const judge = (items: Interpretation[]) => {
      const model = buildTxModel(items);
      return verdicts(evaluate(model, items, { standLog: [] }), model, items);
    };
    const ok = judge(shape("P3a", "before"));
    expect(ok.map((v) => [v.cond, v.kind, v.violator, v.protector, v.node])).toEqual([["R09", "client_decision", "client_decision", "agent", undefined]]);
    expect(passports(ok)).toEqual([]);
    // Без события отказа, с отказом другой корзины или с событием позже остановки — как раньше: «не определён», паспорт.
    for (const ev of ["none", "other", "after"] as const) {
      const vs = judge(shape(`P3${ev}`, ev));
      expect(vs.find((v) => v.cond === "R09"), ev).toMatchObject({ kind: "protection", violator: "undetermined", protector: "agent" });
      expect(passports(vs).length, ev).toBeGreaterThan(0);
    }
    // Ревью блока № 3: время — по `at`, не по порядку шины: событие на шине после остановки, но по времени раньше или
    // одновременно — «решение клиента».
    for (const lag of [-1, 0]) {
      const items = shape(`P3lag${lag}`, "after");
      const stopAt = Date.parse(items.find((x) => x.ref === "agent.refused")!.at);
      const fixed = items.map((x) => (x.ref === "mandate.rejected" ? { ...x, at: new Date(stopAt + lag).toISOString() } : x));
      expect(judge(fixed).map((v) => [v.cond, v.kind]), String(lag)).toEqual([["R09", "client_decision"]]);
    }
    // Ревью блока № 1 (блокер): отказ, остановка, затем оплата — не «решение клиента»: след нарушения остаётся (паспорт).
    const paidAfter = purchase("P3pay", {
      skip: ["signed"],
      at: {
        order: () => [event("mandate.rejected", { mandate_id: "CP3pay" }), journal("agent.refused", { mandate_id: "CP3pay" }, "MANDATE_NOT_ACTIVE")],
      },
    });
    const pv = judge(paidAfter);
    expect(pv.some((v) => v.cause?.kind === "rule" && v.cause.rule.startsWith("rejected_"))).toBe(false);
    // Паспорт — именно у R09 (повторное ревью блока № 2: R18 дал бы паспорт и без R09).
    const r09 = (vs: Verdict[]) => vs.find((v) => v.cond === "R09");
    expect(r09(pv)).toMatchObject({ kind: "protection", violator: "undetermined", cause: { kind: "rule", rule: "inactive_agent_stop" } });
    // Оплата начата, но «оплачено» нет (отказ операции) — тоже не «решение клиента».
    const startedOnly = purchase("P3st", {
      skip: ["signed", "pay", "done"],
      at: { start: () => [event("mandate.rejected", { mandate_id: "CP3st" }), journal("agent.refused", { mandate_id: "CP3st" }, "MANDATE_NOT_ACTIVE")] },
    });
    expect(r09(judge(startedOnly))).toMatchObject({ violator: "undetermined", cause: { kind: "rule", rule: "inactive_agent_stop" } });
  });

  it("Р-1541: обращение агента к Платформе после записи журнала «узнал об отказе от корзины» — R09 «нарушено», агент, паспорт; до записи «узнал» или без неё — решение клиента", () => {
    const judge = (items: Interpretation[]) => {
      const model = buildTxModel(items);
      return verdicts(evaluate(model, items, { standLog: [] }), model, items);
    };
    const shape = (n: string, end: (c: string) => Interpretation[]) => purchase(n, { skip: ["signed", "order", "start", "pay", "done"], at: { end: () => end(`C${n}`) } });
    const rej = (c: string) => event("mandate.rejected", { mandate_id: c });
    const learned = (c: string) => journal("agent.refused", { mandate_id: c }, "MANDATE_NOT_ACTIVE");
    // Обращение агента к Платформе — как на живой шине (ревью Р-1541 № 1): за проход сначала запись журнала агента `pao.call`
    // (с кодом отказа и поручением), затем запись обращения стенда.
    const paoCall = (c: string, method: string, code?: string): Interpretation => ({
      ...rec("console", "pao.call", { mandate_id: c }, code ? { code, kind: "conflict" } : {}),
      method,
    });
    const cred = (c: string, code?: string) => [
      paoCall(c, "POST /pao/v1/credentials", code),
      call("POST /pao/v1/credentials", { mandate_id: c }, "agent_platform", code ? { code, kind: "conflict" } : {}),
    ];
    const r09 = (vs: Verdict[]) => vs.filter((v) => v.cond === "R09");
    // Обращение после события, но до записи «узнал»; Платформа отказала — решение клиента, защитила Платформа (П-03).
    // Запись `pao.call` с кодом MANDATE_NOT_ACTIVE — не «узнал» (блокер ревью Р-1541 № 1).
    const before = judge(shape("RJ1", (c) => [rej(c), ...cred(c, "MANDATE_NOT_ACTIVE"), learned(c)]));
    expect(r09(before).map((v) => [v.kind, v.protector, v.cause?.kind === "rule" && v.cause.rule])).toEqual([["client_decision", "platform", "rejected_platform_decline"]]);
    expect(passports(before)).toEqual([]);
    // Обращение после записи «узнал» — нарушение агента, паспорт; доказательства — событие, запись «узнал», `pao.call`.
    const items = shape("RJ2", (c) => [rej(c), learned(c), ...cred(c, "MANDATE_NOT_ACTIVE")]);
    const after = judge(items);
    // Платформа отказала на это обращение — защитила Платформа (Р-1541 № 3, по источнику: ответ на ту же операцию).
    expect(r09(after)).toMatchObject([{ kind: "violation", violator: "agent", protector: "platform", node: "У5", cause: { kind: "rule", rule: "agent_after_reject_platform" } }]);
    expect(r09(after)[0]!.seqs).toEqual([seqOf(items, "mandate.rejected"), seqOf(items, "agent.refused"), seqOf(items, "pao.call"), seqOf(items, "POST /pao/v1/credentials")]);
    expect(passports(after).length).toBeGreaterThan(0);
    // Ревью № 4: при нарушении остаётся и запись «решение клиента» без условия — отказ клиента был (две записи о разном).
    expect(after.filter((v) => v.kind === "client_decision").map((v) => v.cond)).toEqual([undefined]);
    // Условие владельца (#issuecomment-6851668369): транзакция неправильная один раз — один паспорт, счётчик «неправильных» 1.
    const am = buildTxModel(items);
    expect(passports(after).map((p) => p.obj)).toEqual(["CRJ2"]);
    expect(controlView(am, items, after, []).counts).toEqual({ txs: 1, wrong: 1 });
    // Обращение прошло (ответа с отказом нет) — защитника нет.
    const passed = judge(shape("RJ7", (c) => [rej(c), learned(c), paoCall(c, "POST /pao/v1/credentials"), call("POST /pao/v1/credentials", { mandate_id: c }, "agent_platform")]));
    expect(r09(passed)).toMatchObject([{ kind: "violation", violator: "agent", cause: { kind: "rule", rule: "agent_after_reject" } }]);
    expect(r09(passed)[0]!.protector).toBeUndefined();
    // Ревью П-6.1б № 2: пара «обращение — ответ» по порядку, а не «любой ответ позже». A — отказ до «узнал», B — прошло после;
    // ответы шина положила после обоих `pao.call`: отказ A не делает Платформу защитником B.
    const pairA = judge(
      shape("RJ8", (c) => [
        rej(c),
        paoCall(c, "POST /pao/v1/credentials", "MANDATE_NOT_ACTIVE"),
        learned(c),
        paoCall(c, "POST /pao/v1/credentials"),
        call("POST /pao/v1/credentials", { mandate_id: c }, "agent_platform", { code: "MANDATE_NOT_ACTIVE", kind: "conflict" }),
        call("POST /pao/v1/credentials", { mandate_id: c }, "agent_platform"),
      ]),
    );
    expect(r09(pairA)).toMatchObject([{ kind: "violation", cause: { kind: "rule", rule: "agent_after_reject" } }]);
    expect(r09(pairA)[0]!.protector).toBeUndefined();
    // Ответ раньше записи агента (опрос между ответом и записью `pao.call`) — пара та же: защитник не теряется.
    const early = judge(shape("RJ9", (c) => [rej(c), learned(c), call("POST /pao/v1/credentials", { mandate_id: c }, "agent_platform", { code: "MANDATE_NOT_ACTIVE", kind: "conflict" }), paoCall(c, "POST /pao/v1/credentials", "MANDATE_NOT_ACTIVE")]));
    expect(r09(early)[0]).toMatchObject({ protector: "platform", cause: { kind: "rule", rule: "agent_after_reject_platform" } });
    // № 1: код ответа не «поручение не действует» (передача решения человеку) — не защита.
    const human = judge(shape("RJ10", (c) => [rej(c), learned(c), paoCall(c, "POST /pao/v1/credentials", "CONFIRMATION_REQUIRED"), call("POST /pao/v1/credentials", { mandate_id: c }, "agent_platform", { code: "CONFIRMATION_REQUIRED", kind: "conflict" })]));
    expect(r09(human)[0]!.protector).toBeUndefined();
    // № 12: два обращения после «узнал» — реквизит выдан, подтверждение отказано: защиты нет (одно прошло — вред возможен).
    const mixed = judge(
      shape("RJ11", (c) => [
        rej(c),
        learned(c),
        paoCall(c, "POST /pao/v1/credentials"),
        call("POST /pao/v1/credentials", { mandate_id: c }, "agent_platform"),
        paoCall(c, "POST /pao/v1/confirmations", "MANDATE_NOT_ACTIVE"),
        call("POST /pao/v1/confirmations", { mandate_id: c }, "agent_platform", { code: "MANDATE_NOT_ACTIVE", kind: "conflict" }),
      ]),
    );
    expect(r09(mixed)[0]).toMatchObject({ cause: { kind: "rule", rule: "agent_after_reject" } });
    expect(r09(mixed)[0]!.protector).toBeUndefined();
    // № 13: попытка без ответа (`pao.call` есть, записи монитора нет) сдвигает пару; прошедшее B не получает отказ C.
    const shifted = judge(
      shape("RJ12", (c) => [
        rej(c),
        learned(c),
        paoCall(c, "POST /pao/v1/credentials", "NO_RESPONSE"),
        paoCall(c, "POST /pao/v1/credentials"),
        call("POST /pao/v1/credentials", { mandate_id: c }, "agent_platform"),
        paoCall(c, "POST /pao/v1/credentials", "MANDATE_NOT_ACTIVE"),
        call("POST /pao/v1/credentials", { mandate_id: c }, "agent_platform", { code: "MANDATE_NOT_ACTIVE", kind: "conflict" }),
      ]),
    );
    expect(r09(shifted)[0]!.protector).toBeUndefined();
    // Запись монитора без `pao.call` (обращение драйвера своим клиентом) сдвигает пару: прошедшему B досталась бы чужая
    // «не действует» — журнал агента (B без кода) сверку не проходит, защитника нет.
    const foreign = judge(
      shape("RJ13", (c) => [
        rej(c),
        learned(c),
        call("POST /pao/v1/credentials", { mandate_id: c }, "agent_platform", { code: "MANDATE_NOT_ACTIVE", kind: "conflict" }),
        paoCall(c, "POST /pao/v1/credentials"),
        call("POST /pao/v1/credentials", { mandate_id: c }, "agent_platform"),
      ]),
    );
    expect(r09(foreign)[0]!.protector).toBeUndefined();
    // № 3: «Причины» нарушения со своим защитником — попытка остановлена, гарантия — она сама, не «система не остановила».
    const card = causesView(am, items, after, []).find((c) => c.id === "CRJ2")!.items.find((i) => i.cond === "R09")!;
    expect(card).toMatchObject({ violator: "agent", protector: "platform", consequences: STOPPED_CONSEQUENCES });
    expect(card.guarantees).not.toContainEqual(PULT["int.guarantees.none"]);
    // Порядок — по журналу агента, не по шине (ревью № 2): запись обращения стенда после «узнал», а `pao.call` — до.
    const order = judge(shape("RJ6", (c) => [rej(c), paoCall(c, "POST /pao/v1/credentials", "MANDATE_NOT_ACTIVE"), learned(c), call("POST /pao/v1/credentials", { mandate_id: c }, "agent_platform", { code: "MANDATE_NOT_ACTIVE", kind: "conflict" })]));
    expect(r09(order).map((v) => v.kind)).toEqual(["client_decision"]);
    // Чтение (GET) и отказ от корзины (relinquish, Р63) после записи «узнал» — не нарушение (ревью № 5).
    for (const m of ["GET /pao/v1/mandates/{id}", "POST /pao/v1/mandates/{id}/relinquish"]) {
      const vs = judge(shape("RJ3", (c) => [rej(c), learned(c), paoCall(c, m)]));
      expect(r09(vs).map((v) => v.kind), m).toEqual(["client_decision"]);
      expect(passports(vs), m).toEqual([]);
    }
    // Записи «узнал» нет — нарушение недоказуемо: отказ Платформы на обращение после события — решение клиента.
    const unknown = judge(shape("RJ4", (c) => [rej(c), ...cred(c, "MANDATE_NOT_ACTIVE")]));
    expect(r09(unknown).map((v) => [v.kind, v.cause?.kind === "rule" && v.cause.rule])).toEqual([["client_decision", "rejected_platform_decline"]]);
    // Без события отказа — правило не применяется (обычный «не определён» по MANDATE_NOT_ACTIVE).
    const noRej = judge(shape("RJ5", (c) => [learned(c), ...cred(c, "MANDATE_NOT_ACTIVE")]));
    expect(r09(noRej).some((v) => v.cause?.kind === "rule" && v.cause.rule === "agent_after_reject")).toBe(false);
  });

  it("R26 (Р-1537; ревью П-3.2б № 10): заказ есть, оплаты нет, покупка остановлена — «не применяется», а не «ждёт»; без остановки — «ждёт»", () => {
    const stopped = (n: string, end: () => Interpretation[]) => tx(purchase(n, { skip: ["start", "pay", "done"], at: { end } })).R26.status;
    expect(tx(purchase("S0", { skip: ["start", "pay", "done"] })).R26.status).toBe("wait");
    // Кнопка «Остановить покупку» (`stopPurchase`): отзыв поручения корзины — итог «отозвано».
    expect(stopped("S1", () => [event("mandate.revoked", { mandate_id: "CS1" }, { stage: "revoke" })])).toBe("na");
    // Отказ подтверждения клиентом (П-04, сюжет 7) и шаг остановки сюжета.
    // Событие подтверждения несёт поручение корзины (П-11.5в окна Б) — итог «отклонено».
    const conf = (ref: string) => event(ref, { confirmation_id: "QS2", order_id: "OS2", mandate_id: "CS2" });
    expect(stopped("S2", () => [conf("confirmation.required"), conf("confirmation.rejected")])).toBe("na");
    expect(stopped("S3", () => [step("failed", { order_id: "OS3", mandate_id: "CS3" }, { code: "AGENT_SUSPENDED" })])).toBe("na");
    // Остановка в журнале агента (`purchase.unfinished`, `agent.refused`) и итог Платформы «отказано».
    expect(stopped("S4", () => [rec("console", "purchase.unfinished", { order_id: "OS4" })])).toBe("na");
    expect(stopped("S6", () => [journal("agent.refused", { order_id: "OS6", mandate_id: "CS6" }, "MANDATE_NOT_ACTIVE")])).toBe("na");
    // Форма П-05 (отказ операции и шаг агента по ней): итог «отказано» — без шага агента модель ждёт его.
    const declined = () => [
      event("operation.declined", { op_ref: "PS7", order_id: "OS7" }, { stage: "outcome", code: "LIMIT_EXCEEDED", detail: "CLIENT" }),
      rec("console", "operation.status", { op_ref: "PS7", order_id: "OS7", mandate_id: "CS7" }),
    ];
    const s7 = purchase("S7", { skip: ["start", "pay", "done"], at: { end: declined } });
    expect(buildTxModel(s7).txs[0]!.outcome?.kind).toBe("declined");
    expect(tx(s7).R26.status).toBe("na");
    // Оплата была — R26 по-прежнему судится по витринам; и после шага остановки: оплата двум витринам — «нарушено».
    expect(tx(purchase("S5")).R26.status).toBe("ok");
    const split = purchase("S8", {
      at: { pay: () => [step("failed", { order_id: "OS8", mandate_id: "CS8" }, { code: "AGENT_SUSPENDED" }), call(PAY, { shop_id: "SHOP-2", order_id: "OS8" }, "agent_merchant")] },
    });
    expect(tx(split).R26).toMatchObject({ status: "bad", cause: { kind: "rule", rule: "wrong_shop" } });
    // Повторное ревью блока № 1: шаг остановки, но «оплачено» от Платформы без обращения агента к витрине (обращение за
    // окном или чужим ключом) — не «не применяется»: оплату не прячем.
    const paidNoCall = purchase("S9", { skip: ["pay"], at: { done: () => [step("failed", { order_id: "OS9", mandate_id: "CS9" }, { code: "AGENT_SUSPENDED" })] } });
    expect(tx(paidNoCall).R26.status).toBe("wait");
  });

  it("П-5.1а: отказ ядра MANDATE_OUT_OF_SCOPE у поручения без покупки — признак по сроку из данных поручения; ровно один вердикт, без нарушителя и паспорта; срока нет — пометка", () => {
    const one = (items: Interpretation[], id: string) => {
      const model = buildTxModel(items);
      const view = evaluate(model, items, { standLog: [] });
      const vs = verdicts(view, model, items);
      return { conds: view.objs.find((o) => o.id === id)!.conds, vs };
    };
    // П-06: до срока — R17 «сработало» (вне пределов), R09 не применяется; доказательства — срок и журнал агента.
    const p06 = coreRefusal("IA6", "later");
    const a = one(p06, "IA6");
    expect(a.conds.R17).toMatchObject({ status: "fired", cause: { kind: "rule", rule: "mandate_scope_agent" } });
    expect(a.conds.R17.seqs).toEqual([seqOf(p06, "intent.created"), seqOf(p06, "agent.refused")]);
    expect(a.conds.R09.status).toBe("na");
    expect(a.vs.map((v) => [v.obj, v.cond, v.kind, v.violator, v.protector])).toEqual([["IA6", "R17", "protection", undefined, "agent"]]);
    expect(passports(a.vs)).toEqual([]);
    // Ревью П-5.1а № 7: «Причины» П-06 — без корзины: свой заголовок и «что делать», не формулировка R17 о сумме корзины.
    const c06 = causesView(buildTxModel(p06), p06, a.vs, []).find((c) => c.id === "IA6")!.items[0]!;
    expect(c06.title).toEqual(SCOPE_NO_CART_TITLE);
    expect(c06.todo).toEqual(SCOPE_NO_CART_TODO);
    expect(c06.title.ru).not.toMatch(/корзин[ыа] совпадает|итогом корзины/);
    // Ревью П-6.1б № 4: и в «Гарантиях» — без текста о корзине.
    expect(c06.guarantees.map((g) => g.ru).join(" ")).not.toMatch(/итогом корзины/);
    expect(c06.guarantees[0]!.ru.startsWith(SCOPE_NO_CART_TITLE.ru)).toBe(true);
    // Ревью П-6.1б № 14: остановил не агент (только шаг сюжета) — заголовок тот же, «что делать» не про отказ агента.
    const und: Verdict = { ...a.vs[0]!, protector: "undetermined", cause: { kind: "rule", rule: "mandate_scope_undetermined" } };
    const cu = causesView(buildTxModel(p06), p06, [und], []).find((c) => c.id === "IA6")!.items[0]!;
    expect(cu.title).toEqual(SCOPE_NO_CART_TITLE);
    expect(cu.todo).not.toEqual(SCOPE_NO_CART_TODO);
    // У покупки (транзакции) защита R17 — прежняя формулировка условия.
    const txScope = causesView(buildTxModel(p06), p06, [{ ...a.vs[0]!, obj: "CX" }], []);
    expect(txScope[0]!.items[0]!.title).not.toEqual(SCOPE_NO_CART_TITLE);
    // П-09: в момент срока и позже — R09 «сработало» (срок), R17 не «вне пределов» (поломка С3 «не смотреть признак»).
    for (const term of ["same", "earlier"] as const) {
      const b = one(coreRefusal(`IA9${term}`, term, { kind: "expiry" }), `IA9${term}`);
      expect(b.conds.R09, term).toMatchObject({ status: "fired", cause: { kind: "rule", rule: "expired_agent_stop" } });
      expect(b.conds.R17, term).toMatchObject({ status: "none", note: "amounts_after_mvp" });
      expect(b.vs.map((v) => [v.cond, v.kind, v.violator, v.protector, v.node]), term).toEqual([["R09", "protection", undefined, "agent", undefined]]);
      expect(passports(b.vs), term).toEqual([]);
    }
    // Момент отказа — запись журнала агента, а не первая запись с кодом (ревью П-5.1а № 5): шаг сюжета раньше срока,
    // журнал — в момент срока: срок, а не «вне пределов».
    const created = step("intent.created", { mandate_id: "IAJ" }, { stage: "mandate" });
    const early = step("expiry.refused", { mandate_id: "IAJ" }, { code: "MANDATE_OUT_OF_SCOPE", stage: "mandate" });
    const late = journal("agent.refused", { mandate_id: "IAJ" }, "MANDATE_OUT_OF_SCOPE");
    const j = one([{ ...created, validTo: late.at }, early, late], "IAJ");
    expect(Date.parse(early.at)).toBeLessThan(Date.parse(late.at));
    expect(j.conds.R09).toMatchObject({ status: "fired", cause: { kind: "rule", rule: "expired_agent_stop" } });
    expect(j.conds.R17.status).toBe("none");
    // Срока нет — «не определён»: ни «вне пределов», ни «срок»; пометка у R17 (ru/en).
    const c = one(coreRefusal("IA0", "none"), "IA0");
    expect(c.conds.R17).toMatchObject({ status: "none", note: "scope_or_expiry" });
    expect(c.conds.R09.status).toBe("na");
    expect(c.vs).toEqual([]);
    expect(NOTE_LABEL.scope_or_expiry.ru).not.toBe("");
    expect(NOTE_LABEL.scope_or_expiry.en).not.toBe("");
  });

  it("причина без строки в таблице субъектов — «не определён», а не субъект по умолчанию", () => {
    const cause = { kind: "mark", test: "Н-02" } as const;
    expect(subjectsOf(cause)).toBeUndefined();
    const conds = Object.fromEntries(CHECKABLE_CONDITIONS.map((c) => [c, { status: "na", seqs: [] }])) as unknown as CondResults;
    const view = {
      objs: [{ id: "TX", kind: "tx" as const, conds: { ...conds, R46: { status: "bad" as const, seqs: [1], cause }, R17: { status: "fired" as const, seqs: [2], cause } } }],
      system: conds,
      guarantees: [],
    };
    const vs = verdicts(view, { txs: [], mandates: [], unattached: [] }, []);
    expect(vs.find((v) => v.cond === "R46")).toMatchObject({ kind: "violation", violator: "undetermined" });
    expect(vs.find((v) => v.cond === "R17")).toMatchObject({ kind: "protection", protector: "undetermined" });
    expect(vs.find((v) => v.cond === "R46")!.violator).not.toBe("agent");
  });
});

// П-4.1 (решение владельца — отзыв PR #9 «(чат, 11.11) — ответ на план П-4.1»): «Контроль» пульта — паспорта по правилу
// паспорта (решение по П-3.3, 3; ревью П-3.3 № 7 — проверка по правилу, не по виду вердикта), «Идёт к нарушению» с порогом
// 15 с (У-01…У-03), «операция без шага агента — возможно, чужая операция» (условие Р-1478) — предположение, не паспорт.
describe("«Контроль» пульта (П-4.1)", () => {
  const vsOf = (items: Interpretation[], log: StandLogEntry[] = []) => {
    const model = buildTxModel(items);
    return { model, vs: verdicts(evaluate(model, items, { standLog: log }), model, items) };
  };

  it("правило паспорта: нарушитель — участник или «не определён» — паспорт есть; нарушителя нет или «решение клиента» — нет", () => {
    expect(hasPassport({ violator: "agent" })).toBe(true);
    expect(hasPassport({ violator: "undetermined" })).toBe(true);
    expect(hasPassport({ violator: "client_decision" })).toBe(false);
    expect(hasPassport({})).toBe(false);
  });

  it("паспорта по задаче: Н-03, Н-08 (защита сработала, но нарушитель есть) — с паспортом; П-06, П-08 — без; набор паспортов = вердикты с паспортом по правилу", () => {
    const cases: [string, () => { items: Interpretation[]; log?: StandLogEntry[] }, boolean][] = [
      ["Н-03", () => ({ items: purchase("X3"), log: [fault("PAID_BEFORE_OUTCOME", { shop_id: "SHOP-1", merchant_id: "MER-1", order_id: "OX3" }, "Н-03")] }), true],
      [
        "Н-08",
        () => ({
          items: purchase("X8", { skip: ["start", "pay", "done"], at: { end: () => scopeRefused("CX8", "OX8") } }),
          log: [entry("MARKED", { order_id: "OX8" }, { test: "Н-08" })],
        }),
        true,
      ],
      ["П-06", () => ({ items: purchase("X6", { skip: ["start", "pay", "done"], at: { end: () => scopeRefused("CX6", "OX6") } }) }), false],
      [
        "П-08",
        () => ({
          items: purchase("X9", {
            skip: ["start", "pay", "done"],
            at: { end: () => [event("mandate.revoked", { mandate_id: "CX9" }, { stage: "revoke" }), step("failed", { order_id: "OX9", mandate_id: "CX9" }, { code: "MANDATE_REVOKED" })] },
          }),
        }),
        false,
      ],
      // П-5.1а (Р-1536 п. 1): стендовая форма П-06 и П-09 — защита без нарушителя, паспорта нет.
      ["П-06 на стенде", () => ({ items: coreRefusal("X6s", "later") }), false],
      ["П-09 на стенде", () => ({ items: coreRefusal("X9s", "earlier", { kind: "expiry" }) }), false],
    ];
    for (const [name, make, want] of cases) {
      const { items, log } = make();
      const { vs } = vsOf(items, log ?? []);
      // Вердикты есть (пустой набор дал бы «паспорта нет» даром — ревью П-4.1 № 7).
      expect(vs.length, name).toBeGreaterThan(0);
      const ps = passports(vs);
      expect(ps.length > 0, name).toBe(want);
      // Без паспорта — нарушителя нет или это «решение клиента»; с паспортом — нарушитель задан и не клиент.
      if (!want) expect(vs.every((v) => v.violator === undefined || v.violator === "client_decision"), name).toBe(true);
      else expect(vs.some((v) => v.violator !== undefined && v.violator !== "client_decision"), name).toBe(true);
    }
    // По правилу, а не по виду вердикта: Н-03 — вид «защита сработала», нарушитель — продавец, паспорт есть.
    const n03 = vsOf(purchase("X3b"), [fault("PAID_BEFORE_OUTCOME", { shop_id: "SHOP-1", merchant_id: "MER-1", order_id: "OX3b" }, "Н-03")]).vs;
    expect(n03.find((v) => v.cond === "R27")).toMatchObject({ kind: "protection", violator: "merchant" });
    expect(passports(n03).flatMap((p) => p.findings).map((f) => f.cond)).toContain("R27");
    // П-08 — отзыв поручения клиентом: «решение клиента», не нарушение.
    const p08 = vsOf(cases[3]![1]().items).vs;
    expect(p08.some((v) => v.violator === "client_decision")).toBe(true);
  });

  it("находка паспорта: условие и его формулировка ru/en, узел, нарушитель, защитник", () => {
    const { vs } = vsOf(purchase("X4"), [fault("PAID_BEFORE_OUTCOME", { shop_id: "SHOP-1", merchant_id: "MER-1", order_id: "OX4" }, "Н-03")]);
    const f = passports(vs).find((p) => p.obj === "CX4")!.findings.find((x) => x.cond === "R27")!;
    expect(f).toMatchObject({ cond: "R27", node: "У3", violator: "merchant", protector: "operator" });
    expect(f.condText?.ru.length && f.condText?.en.length).toBeTruthy();
    expect(f.nodeText?.en).toBe("Outcome — only from the Platform");
  });

  it("«Идёт к нарушению»: поручение ждёт подписи (R08), корзина — согласия (R18), подтверждение — ответа (R21); порог 15 с; ответ снимает ожидание", () => {
    const sign = [step("intent.awaiting_signature", { mandate_id: "IY1" }, { stage: "mandate" })];
    const consent = purchase("Y2", { skip: ["signed", "order", "start", "pay", "done"], at: { end: () => [step("cart.awaiting_signature", { mandate_id: "CY2" }, { stage: "cart" })] } });
    const conf = purchase("Y3", { skip: ["pay", "done"], at: { end: () => [event("confirmation.required", { confirmation_id: "QY3", order_id: "OY3" }, { stage: "confirmation" })] } });
    const items = [...sign, ...consent, ...conf];
    const ws = waits(buildTxModel(items), items);
    expect(ws.map((w) => [w.kind, w.cond, w.obj])).toEqual([
      ["sign", "R08", "IY1"],
      ["consent", "R18", "CY2"],
      ["confirmation", "R21", "CY3"],
    ]);
    const since = Date.parse(ws[0]!.since);
    expect(dueWaits(ws.slice(0, 1), new Date(since + WAIT_MS - 1).toISOString())).toEqual([]);
    expect(dueWaits(ws.slice(0, 1), new Date(since + WAIT_MS).toISOString())).toHaveLength(1);
    expect(WAIT_MS).toBe(15_000);
    expect(ws[2]!.confirmationId).toBe("QY3");
  });

  // Ревью П-4.1 № 6: ответ и отказ снимают каждое ожидание — без фильтров.
  const wOf = (items: Interpretation[]) => waits(buildTxModel(items), items).map((w) => [w.kind, w.obj, w.confirmationId]);
  const ask = (n: string) => step("cart.awaiting_signature", { mandate_id: `C${n}` }, { stage: "cart" });
  const creq = (q: string, ord: string) => event("confirmation.required", { confirmation_id: q, order_id: ord }, { stage: "confirmation" });
  const cfin = (q: string, ord: string, ref: string) => event(ref, { confirmation_id: q, order_id: ord }, { stage: "confirmation" });

  it("ответ снимает ожидание: R08 — подпись или отказ клиента (№ 1); R18 — подпись или отказ корзины; R21 — одобрено, отклонено, истекло", () => {
    const sign = (i: string) => step("intent.awaiting_signature", { mandate_id: i }, { stage: "mandate" });
    expect(wOf([sign("IZ1"), event("mandate.signed", { mandate_id: "IZ1" })])).toEqual([]);
    // Отклонил — решение клиента, а не «идёт к нарушению» (ревью П-4.1 № 1).
    expect(wOf([sign("IZ2"), event("mandate.rejected", { mandate_id: "IZ2" })])).toEqual([]);
    for (const ref of ["mandate.signed", "mandate.rejected"]) {
      const n = `Z3${ref.length}`;
      expect(wOf(purchase(n, { skip: ["signed", "order", "start", "pay", "done"], at: { end: () => [ask(n), event(ref, { mandate_id: `C${n}` })] } })), ref).toEqual([]);
    }
    for (const ref of ["confirmation.approved", "confirmation.rejected", "confirmation.expired"]) {
      const n = `Z4${ref.length}`;
      expect(wOf(purchase(n, { skip: ["pay", "done"], at: { end: () => [creq(`Q${n}`, `O${n}`), cfin(`Q${n}`, `O${n}`, ref)] } })), ref).toEqual([]);
    }
  });

  it("ревью П-4.1 № 2: повтор после отказа — его запрос подтверждения ждёт ответа (итог «отказ» не снимает ожидание повтора)", () => {
    const items = purchase("Z5", {
      skip: ["done"],
      at: {
        end: () => [
          event("operation.declined", { op_ref: "PZ5", order_id: "OZ5" }, { stage: "outcome" }),
          step("outcome", { op_ref: "PZ5", order_id: "OZ5", mandate_id: "CZ5" }, { stage: "outcome" }),
          creq("QZ5b", "OZ5"),
        ],
      },
    });
    expect(buildTxModel(items).txs[0]!.outcome?.kind).toBe("declined");
    expect(wOf(items)).toEqual([["confirmation", "CZ5", "QZ5b"]]);
    // № 15: запрос открыт до отказа операции, закрывающего события нет, повтора нет — ожидания нет (операция уже
    // отклонена); гарантии, что Платформа закрывает запрос событием, нет.
    const stale = purchase("Z6", {
      skip: ["done"],
      at: {
        end: () => [
          creq("QZ6", "OZ6"),
          event("operation.declined", { op_ref: "PZ6", order_id: "OZ6" }, { stage: "outcome" }),
          step("outcome", { op_ref: "PZ6", order_id: "OZ6", mandate_id: "CZ6" }, { stage: "outcome" }),
        ],
      },
    });
    expect(buildTxModel(stale).txs[0]!.outcome?.kind).toBe("declined");
    expect(wOf(stale)).toEqual([]);
    // То же с повтором после отказа — виден только запрос повтора.
    expect(wOf([...stale, creq("QZ6b", "OZ6")])).toEqual([["confirmation", "CZ6", "QZ6b"]]);
    // № 20: повтор P2 тоже отклонён, его запрос не закрыт — отсечка по последнему отказу, ожидания нет; третий повтор — виден.
    const second = [
      ...stale,
      creq("QZ6b", "OZ6"),
      event("operation.declined", { op_ref: "PZ6b", order_id: "OZ6" }, { stage: "outcome" }),
      step("outcome", { op_ref: "PZ6b", order_id: "OZ6", mandate_id: "CZ6" }, { stage: "outcome" }),
    ];
    expect(wOf(second)).toEqual([]);
    expect(wOf([...second, creq("QZ6c", "OZ6")])).toEqual([["confirmation", "CZ6", "QZ6c"]]);
    // После «оплачено» ждать нечего.
    const paid = purchase("Z5p", { at: { end: () => [creq("QZ5p", "OZ5p")] } });
    expect(buildTxModel(paid).txs[0]!.outcome?.kind).toBe("paid");
    expect(wOf(paid)).toEqual([]);
  });

  it("ревью П-4.1 № 3 (правило вердикта, решение владельца): при конфликте звеньев R21 по номеру подтверждения — показывается; «шаг агента» — нет", () => {
    const one = purchase("ZK1", { skip: ["order", "start", "pay", "done"] });
    const two = purchase("ZK2", { skip: ["order", "start", "pay", "done"] });
    const tail = [
      step("order.placed", { order_id: "OZK", mandate_id: "CZK1", merchant_id: "MER-1" }),
      step("order.placed", { order_id: "OZK", mandate_id: "CZK2", merchant_id: "MER-2" }),
      creq("QZK", "OZK"),
      event("operation.authorized", { op_ref: "PZKF", order_id: "OZK" }, { stage: "outcome" }),
    ];
    const items = [...one, ...two, ...tail];
    const t = buildTxModel(items).txs.find((x) => x.linkConflict)!;
    expect(t).toBeDefined();
    expect(wOf(items)).toEqual([["confirmation", t.id, "QZK"]]);
  });

  it("ревью П-4.1 № 4: транзакция без корзины, шаг агента по операции пришёл — «операция без шага агента» не показывается", () => {
    const items = [event("operation.authorized", { op_ref: "PZN", order_id: "OZN" }, { stage: "outcome" }), step("outcome", { op_ref: "PZN", order_id: "OZN" }, { stage: "outcome" })];
    const t = buildTxModel(items).txs[0]!;
    expect(t.cartMandateId).toBeUndefined();
    expect(t.pendingOps).toEqual(["PZN"]);
    expect(wOf(items)).toEqual([]);
    // Без шага — строка есть.
    expect(wOf(items.slice(0, 1))).toEqual([["agent_step", "PZN", undefined]]);
  });

  it("ревью П-4.1 № 14: поручение-намерение отозвано — корзина согласия уже не ждёт", () => {
    const items = purchase("Z7", { skip: ["signed", "order", "start", "pay", "done"], at: { end: () => [ask("Z7"), event("mandate.revoked", { mandate_id: "IZ7" }, { stage: "revoke" })] } });
    expect(buildTxModel(items).mandates.find((m) => m.id === "IZ7")!.status).toBe("revoked");
    expect(wOf(items)).toEqual([]);
    expect(wOf(items.slice(0, -1))).toEqual([["consent", "CZ7", undefined]]);
  });

  it("ревью П-4.1 № 12: у каждого участника — подпись ru и en (новый участник без подписи не пройдёт)", () => {
    for (const s of [...PARTIES, "undetermined"] as const) {
      const ph = PULT[`subj.${s}`];
      expect(ph?.ru.length && ph?.en.length, s).toBeTruthy();
    }
  });

  it("условие Р-1478: чужая операция с тем же номером заказа — «возможно, чужая операция» в «Идёт к нарушению», паспорта не даёт", () => {
    const items = [...purchase("Y5"), event("operation.authorized", { op_ref: "PFOREIGN", order_id: "OY5" })];
    const { model, vs } = vsOf(items);
    // Итог транзакции — по своей операции P1 (связана шагом агента), чужая — «ждём шаг агента».
    expect(model.txs[0]).toMatchObject({ outcome: { kind: "paid" }, pendingOps: ["PFOREIGN"] });
    const ws = waits(model, items);
    expect(ws).toEqual([expect.objectContaining({ kind: "agent_step", obj: "PFOREIGN" })]);
    expect(ws[0]!.cond).toBeUndefined();
    expect(passports(vs)).toEqual([]);
    const c = controlView(model, items, vs, []);
    expect(c.counts).toEqual({ txs: 1, wrong: 0 });
    expect(c.waitMs).toBe(WAIT_MS);
  });
});

// П-5.1: «Причины» на записях в форме шины — разбор вердиктов, защиты по источнику, цепочка событий (Р-1519).
describe("«Причины» пульта на записях в форме шины (П-5.1)", () => {
  const causesOf = (items: Interpretation[], standLog?: StandLogEntry[]) => {
    const model = buildTxModel(items);
    const ev = evaluate(model, items, standLog ? { standLog } : {});
    return causesView(model, items, verdicts(ev, model, items), waits(model, items));
  };
  const intentOnly = (id: string, tail: () => Interpretation[]) => [step("intent.awaiting_signature", { mandate_id: id }, { stage: "mandate" }), event("mandate.signed", { mandate_id: id }), ...tail()];
  /** Похожее на номер карты — собирается во время теста (литералов номеров в тестах нет): префикс 9 — не схема карт, Луна. */
  const luhnNumber = () => {
    const body = "9" + "2".repeat(14);
    let sum = 0;
    for (let i = 0; i < body.length; i++) {
      let d = Number(body[body.length - 1 - i]);
      if (i % 2 === 0) d = d * 2 > 9 ? d * 2 - 9 : d * 2;
      sum += d;
    }
    return body + String((10 - (sum % 10)) % 10);
  };

  it("Н-01 (два «оплачено», R46): нарушение — правило Ж03, точка, почему, последствия узла У2, что делать; защит нет — «гарантий нет»", () => {
    const second = () => [event("operation.authorized", { op_ref: "PN1x", order_id: "ON1" }), step("outcome", { op_ref: "PN1x", order_id: "ON1", mandate_id: "CN1" })];
    const items = purchase("N1", { at: { end: second } });
    const [c] = causesOf(items);
    expect(c).toMatchObject({ outcome: "paid" });
    const it46 = c!.items.find((x) => x.cond === "R46")!;
    expect(it46).toMatchObject({ kind: "violation", violator: "agent", protector: "none", node: "У2", todo: CONDITIONS.find((x) => x.id === "R46")!.todo });
    expect(it46.consequences).toEqual(NODE_CONSEQUENCES.У2);
    expect(it46.rules).toContain("Ж03");
    expect(it46.where).toContain(RULES89.find((r) => r.id === "Ж03")!.point);
    expect(it46.happened.length).toBeLessThanOrEqual(4);
    // Защит нет — «система не остановила».
    expect(it46.guarantees).toEqual([PULT["int.guarantees.none"]]);
    expect(c!.items.filter((x) => x.kind !== "violation")).toEqual([]);
    filled(it46);
  });

  /** Восемь полей разбора не пустые на обоих языках (план П-5.1, указание владельца перед коммитом). */
  function filled(it: CauseItem): void {
    for (const lang of ["ru", "en"] as const) {
      expect(it.happened.length, "что случилось").toBeGreaterThan(0);
      for (const r of it.happened) expect(r.phrase[lang].length, "что случилось").toBeGreaterThan(0);
      expect([it.violator, it.protector].every((s) => typeof s === "string" && s.length > 0), "кто нарушил / кто защитил").toBe(true);
      expect(it.where.length, "где проявилось").toBeGreaterThan(0);
      expect(it.rules.length, "правило").toBeGreaterThan(0);
      for (const id of it.rules) {
        const t = ruleText(RULES89.find((r) => r.id === id)!, lang).text;
        expect([t.rule, t.whyCrit, t.whyVuln].every((s) => s.length > 0), `почему неправильно ${id}`).toBe(true);
      }
      expect(it.consequences[lang].length, "последствия").toBeGreaterThan(0);
      expect(it.todo[lang].length, "что делать").toBeGreaterThan(0);
      expect(it.guarantees.length, "гарантии").toBeGreaterThan(0);
      for (const g of it.guarantees) expect(g[lang].length, "гарантии").toBeGreaterThan(0);
    }
  }

  it("П-06 (MANDATE_SCOPE, ответ Платформы): защита — R17, защитила Платформа; П-07 — защита без условия, одна, защитила Платформа", () => {
    const scope = purchase("N6", { skip: ["start", "pay", "done"], at: { end: () => [call("POST /pao/v1/credentials", { mandate_id: "CN6" }, "agent_platform", { code: "MANDATE_SCOPE", kind: "conflict" }), step("failed", { order_id: "ON6", mandate_id: "CN6" }, { code: "MANDATE_SCOPE" })] } });
    const [c6] = causesOf(scope);
    expect(c6!.items).toEqual([expect.objectContaining({ kind: "protection", cond: "R17", protector: "platform", violator: "none" })]);
    filled(c6!.items[0]!);
    expect(c6!.items[0]!.consequences).toEqual(KIND_CONSEQUENCES.protection);
    const susp = purchase("N7", {
      skip: ["start", "pay", "done"],
      at: { end: () => [call("POST /pao/v1/credentials", { mandate_id: "CN7" }, "agent_platform", { code: "AGENT_SUSPENDED", kind: "conflict" }), journal("agent.refused", { mandate_id: "CN7" }, "AGENT_SUSPENDED"), step("failed", { order_id: "ON7", mandate_id: "CN7" }, { code: "AGENT_SUSPENDED" })] },
    });
    const [c7] = causesOf(susp);
    expect(c7!.items).toEqual([expect.objectContaining({ kind: "protection", guarantee: "agent_suspended", protector: "platform", title: GUARANTEE_INFO.agent_suspended.name })]);
    // У защиты без проверяемого условия тоже все восемь полей: правила — А06, Л04 (R05), что делать — своё.
    filled(c7!.items[0]!);
    expect(c7!.items[0]!.rules).toEqual(expect.arrayContaining(["А06", "Л04"]));
    expect(c7!.items[0]!.todo).toEqual(GUARANTEE_TODO.agent_suspended);
  });

  it("ревью П-5.1 № 2: отказ Платформы по корзине и журнал агента по намерению — одна остановка, одна защита, защитила Платформа; дубля вердикта нет", () => {
    const items = purchase("NF", {
      skip: ["start", "pay", "done"],
      at: {
        end: () => [
          event("mandate.revoked", { mandate_id: "CNF" }, { stage: "revoke" }),
          call("POST /pao/v1/credentials", { mandate_id: "CNF" }, "agent_platform", { code: "MANDATE_REVOKED", kind: "conflict" }),
          journal("agent.refused", { mandate_id: "INF" }, "MANDATE_REVOKED"),
        ],
      },
    });
    const v = run(items);
    expect(v.guarantees.filter((g) => g.kind === "revoke")).toEqual([expect.objectContaining({ protector: "platform", obj: v.objs.find((o) => o.kind === "tx")!.id })]);
    const vs = verdicts(v, buildTxModel(items), items);
    expect(vs.filter((x) => x.cond === "R09" || x.guarantee === "revoke")).toHaveLength(1);
    expect(causesOf(items)).toHaveLength(1);
  });

  it("повторное ревью П-5.1 № 1, 4, 5, 8, 10: П-03 — восемь полей; субъект защиты «отзыв / не действует» — по коду; R17 — по записи намерения; «что делать» у защиты — не «остановить»; R17 «агент»", () => {
    // № 1: П-03 (клиент отказался от корзины) — решение клиента без условия и защиты: правило R18, «защиты не требовалось».
    const p03 = purchase("NP3", { skip: ["signed", "order", "start", "pay", "done"], at: { end: () => [event("mandate.rejected", { mandate_id: "CNP3" })] } });
    const d = causesOf(p03).flatMap((c) => c.items).find((x) => x.kind === "client_decision")!;
    filled(d);
    expect(d.guarantees).toEqual([NO_GUARD_NEEDED]);
    expect(d.todo).toEqual(DECISION_TODO);
    // № 4: поручение без покупки, срок истёк по журналу агента — нарушителя нет (не «решение клиента»).
    const exp = intentOnly("IEX", () => [journal("agent.refused", { mandate_id: "IEX" }, "MANDATE_EXPIRED")]);
    const vExp = verdicts(run(exp), buildTxModel(exp), exp).find((x) => x.guarantee === "revoke")!;
    expect([vExp.kind, vExp.violator, vExp.protector]).toEqual(["protection", undefined, "agent"]);
    const ina = intentOnly("INA", () => [journal("agent.refused", { mandate_id: "INA" }, "MANDATE_NOT_ACTIVE")]);
    expect(verdicts(run(ina), buildTxModel(ina), ina).find((x) => x.guarantee === "revoke")!.violator).toBe("undetermined");
    // № 5: отказ Платформы MANDATE_SCOPE с номером намерения — R17 «Платформа».
    const viaIntent = purchase("NR5", { skip: ["start", "pay", "done"], at: { end: () => [call("POST /pao/v1/credentials", { mandate_id: "INR5" }, "agent_platform", { code: "MANDATE_SCOPE", kind: "conflict" }), step("failed", { order_id: "ONR5", mandate_id: "CNR5" }, { code: "MANDATE_SCOPE" })] } });
    expect(run(viaIntent).objs.find((o) => o.kind === "tx")!.conds.R17.cause).toEqual({ kind: "rule", rule: "mandate_scope_platform" });
    // № 10: только журнал агента — R17 «агент»; № 8: «что делать» у защиты — по виду защиты.
    const agentOnly = purchase("NR6", { skip: ["start", "pay", "done"], at: { end: () => [journal("agent.refused", { mandate_id: "CNR6" }, "MANDATE_SCOPE"), step("failed", { order_id: "ONR6", mandate_id: "CNR6" }, { code: "MANDATE_SCOPE" })] } });
    expect(run(agentOnly).objs.find((o) => o.kind === "tx")!.conds.R17.cause).toEqual({ kind: "rule", rule: "mandate_scope_agent" });
    expect(causesOf(agentOnly)[0]!.items.find((x) => x.cond === "R17")!.todo).toEqual(GUARANTEE_TODO.mandate_scope);
  });

  it("Р-1524: Н-01 на стенде — повторную оплату отклонила витрина (409 ORDER_NOT_PAYABLE): защитил продавец; у R46 — гарантия и «вред не наступил»; пометка без ответа витрины защиты не даёт", () => {
    const items = purchase("NM", { at: { end: () => [call(PAY, { shop_id: "SHOP-1", order_id: "ONM" }, "agent_merchant", { code: "ORDER_NOT_PAYABLE", kind: "conflict" })] } });
    const log = [entry("MARKED", { order_id: "ONM" }, { test: "Н-01" })];
    const [c] = causesOf(items, log);
    const it46 = c!.items.find((x) => x.cond === "R46")!;
    expect(it46).toMatchObject({ kind: "violation", violator: "agent" });
    expect(it46.consequences).toEqual(STOPPED_CONSEQUENCES);
    expect(it46.guarantees.map((g) => g.ru).join(" ")).toContain(PULT["subj.merchant"].ru);
    expect(c!.items.find((x) => x.guarantee === "pay_refused")).toMatchObject({ kind: "protection", protector: "merchant" });
    filled(it46);
    // Без ответа витрины (только пометка «ПР») — защиты нет: «система не остановила».
    const [c2] = causesOf(purchase("NM2"), [entry("MARKED", { order_id: "ONM2" }, { test: "Н-01" })]);
    expect(c2!.items.find((x) => x.cond === "R46")!.guarantees).toEqual([PULT["int.guarantees.none"]]);
  });

  it("ревью П-5.1 № 3: доказательство из записей намерения (R08 — подпись поручения агентом) — в цепочке, не только в «что случилось»", () => {
    const items = purchase("NS", { intent: () => [step("intent.awaiting_signature", { mandate_id: "INS" }, { stage: "mandate" }), call(SIGN, { mandate_id: "INS" }, "agent_platform"), event("mandate.signed", { mandate_id: "INS" })] });
    const [c] = causesOf(items);
    const it08 = c!.items.find((x) => x.cond === "R08")!;
    expect(it08).toMatchObject({ kind: "violation", violator: "agent" });
    const proof = run(items).objs.find((o) => o.kind === "tx")!.conds.R08.seqs;
    expect(proof.length).toBeGreaterThan(0);
    const chain = new Set(c!.chain.map((r) => r.seq));
    for (const s of proof) expect(chain.has(s), String(s)).toBe(true);
  });

  it("Р-1522: событие Платформы-уведомление (mandate.revoked) и журнал агента — защитил агент; ответ 409 Платформы и журнал — Платформа", () => {
    const notice = intentOnly("IQ1", () => [event("mandate.revoked", { mandate_id: "IQ1" }, { stage: "revoke" }), journal("agent.refused", { mandate_id: "IQ1" }, "MANDATE_REVOKED")]);
    expect(run(notice).guarantees.find((g) => g.kind === "revoke")!.protector).toBe("agent");
    const refusal = intentOnly("IQ2", () => [
      event("mandate.revoked", { mandate_id: "IQ2" }, { stage: "revoke" }),
      call("POST /pao/v1/mandates/{mandate_id}/cart", { mandate_id: "IQ2" }, "agent_platform", { code: "MANDATE_REVOKED", kind: "conflict" }),
      journal("agent.refused", { mandate_id: "IQ2" }, "MANDATE_REVOKED"),
    ]);
    expect(run(refusal).guarantees.find((g) => g.kind === "revoke")!.protector).toBe("platform");
  });

  it("ревью П-5.1 № 5 (инвариант 1): запись с похожим на номер карты — «скрыта» в «что случилось» и в цепочке; номера нет в «Причинах»", () => {
    const n = luhnNumber();
    const items = purchase("NK", { at: { end: () => [rec("console", "shop.call", { mandate_id: "CNK", order_id: "ONK" }, { phrase: { ru: `карта ${n}`, en: `card ${n}` } })] } });
    const cs = causesOf(items);
    const it41 = cs.flatMap((c) => c.items).find((x) => x.cond === "R41");
    expect(it41).toBeDefined();
    const json = JSON.stringify(cs);
    expect(json).not.toContain(n);
    expect(json).toContain(HIDDEN_RECORD.ru);
  });

  it("цепочка (Р-1519): последние 40 записей и все доказательства, даже старше 40-й; всего — N; транзакция без вердикта — без разбора", () => {
    // Доказательство R46 (первое «оплачено») — в начале; после него 50 записей транзакции.
    const filler = () => Array.from({ length: 50 }, () => step("order.shop_reply", { order_id: "ON8", mandate_id: "CN8" }, { stage: "service" }));
    const second = () => [...filler(), event("operation.authorized", { op_ref: "PN8x", order_id: "ON8" }), step("outcome", { op_ref: "PN8x", order_id: "ON8", mandate_id: "CN8" })];
    const items = purchase("N8", { at: { end: second } });
    const [c] = causesOf(items);
    const it46 = c!.items.find((x) => x.cond === "R46")!;
    const chainSeqs = new Set(c!.chain.map((r) => r.seq));
    const last40 = new Set(buildTxModel(items).txs[0]!.seqs.slice(-40));
    for (const s of last40) expect(chainSeqs.has(s)).toBe(true);
    // Доказательства разбора, которые старше последних 40, тоже в цepочке — и такое доказательство есть (ревью П-5.1 № 16).
    const v = run(items);
    const proof = v.objs[0]!.conds.R46.seqs;
    const older = proof.filter((s) => !last40.has(s));
    expect(older.length).toBeGreaterThan(0);
    for (const s of older) expect(chainSeqs.has(s), String(s)).toBe(true);
    expect(it46.happened.length).toBeGreaterThan(0);
    expect(c!.chainTotal).toBe(buildTxModel(items).txs[0]!.seqs.length);
    expect(c!.chain.length).toBeLessThan(c!.chainTotal);
    expect(c!.chain.length).toBeGreaterThanOrEqual(40);
    // Обычная покупка — вердиктов нет, «Причин» нет.
    expect(causesOf(purchase("N9"))).toEqual([]);
  });
});

// П-4.2: «Условия» на записях в форме шины — плитки узлов и статусы правил из того же результата движка, что вердикты.
describe("«Условия» пульта на записях в форме шины (П-4.2)", () => {
  it("два «оплачено» по связанным операциям (R46): плитка У2 «нарушено» с этой транзакцией, правило Ж03 «нарушено»", () => {
    const second = () => [event("operation.authorized", { op_ref: "PC1x", order_id: "OC1" }), step("outcome", { op_ref: "PC1x", order_id: "OC1", mandate_id: "CC1" })];
    const v = run(purchase("C1", { at: { end: second } }));
    const c = conditionsView(v);
    const t = v.objs.find((o) => o.kind === "tx")!;
    expect(c.nodes.find((n) => n.id === "У2")).toMatchObject({ status: "bad", objs: [t.id], system: false });
    expect(c.rules["Ж03"]).toBe("bad");
    expect(c.counts.bad).toBeGreaterThanOrEqual(1);
  });

  it("уточнение 1: сбой стенда без привязки (второй реквизит по чужой операции) — «нарушено» только сводно: плитка У2 «система»", () => {
    const v = withLog(purchase("C2"), [entry("SECOND_CREDENTIAL_ISSUED", { op_ref: "P-чужая" })]);
    expect(v.system.R23.status).toBe("bad");
    expect(conditionsView(v).nodes.find((n) => n.id === "У2")).toMatchObject({ status: "bad", objs: [], system: true });
  });

  it("уточнение 2: конфликт звеньев — плитка У2 «ещё не дошло» с пометкой «конфликт звеньев»", () => {
    const one = purchase("K3", { skip: ["order", "start", "pay", "done"] });
    const two = purchase("K4", { skip: ["order", "start", "pay", "done"] });
    const tail = [
      step("order.placed", { order_id: "OK3", mandate_id: "CK3", merchant_id: "MER-1" }),
      step("payment.started", { order_id: "OK3" }),
      call(PAY, { shop_id: "SHOP-1", order_id: "OK3" }, "agent_merchant"),
      event("operation.authorized", { op_ref: "PK3", order_id: "OK3" }),
      step("outcome", { op_ref: "PK3", order_id: "OK3", mandate_id: "CK3" }),
      step("order.placed", { order_id: "OK3", mandate_id: "CK4", merchant_id: "MER-2" }),
      step("payment.started", { order_id: "OK3" }),
      call(PAY, { shop_id: "SHOP-2", order_id: "OK3" }, "agent_merchant"),
      event("operation.authorized", { op_ref: "PK4", order_id: "OK3" }),
      step("outcome", { op_ref: "PK4", order_id: "OK3", mandate_id: "CK4" }),
    ];
    const c = conditionsView(run([...one, ...two, ...tail]));
    expect(c.nodes.find((n) => n.id === "У2")).toMatchObject({ status: "wait", notes: ["link_conflict"] });
  });
});
