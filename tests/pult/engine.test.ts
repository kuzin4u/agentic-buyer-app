// П-3.2б (Р-1476, Р-1478, Р-1479; В5, В8): движок условий пульта на записях в форме шины. «Соблюдено», «не применяется» и
// «сработало» на настоящей шине (сюжеты 1–5 с агентом) — tests/demo/interpret-live.test.ts; «нарушено» — здесь, на
// записях той же формы. Номер seq выдаётся при создании записи — записи создаются в порядке шины.
import { describe, expect, it } from "vitest";
import type { Interpretation, TxIds, Who } from "../../src/dashboards/interpret.js";
import { evaluate, GUARANTEE_INFO, hasCardNumber, LATE_MS, NOTE_LABEL, ruleStatus, STATUS_LABEL, STATUSES, worstStatus, type CondResults } from "../../src/pult/engine.js";
import { CHECKABLE_CONDITIONS, isCheckable, RULES89 } from "../../src/pult/rules89.js";
import { STAND_DELAY_MAX_MS, STAND_TESTS, type StandFaultForm, type StandFaultIds, type StandLogEntry, type StandLogWhat, type StandTest } from "../../src/pult/standlog.js";
import { buildTxModel } from "../../src/pult/tx.js";
import { subjectsOf, verdicts, type Verdict } from "../../src/pult/verdict.js";
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
    const scope = () => [step("failed", { order_id: "OB", mandate_id: "CB" }, { code: "MANDATE_SCOPE" })];
    const items = purchase("B", { skip: ["start", "pay", "done"], at: { end: scope } });
    const v = run(items);
    const scopeSeq = items.at(-1)!.seq;
    expect(v.objs[0]!.conds.R17).toEqual({ status: "fired", seqs: [scopeSeq], cause: { kind: "rule", rule: "mandate_scope" } });
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
    // Без «сейчас» срок не считается — «ждёт», не «нарушено»; без op_ref в записи (стенд пишет пустые ids) — тоже «ждёт».
    expect(withLog(pending, [late8]).system.R31.status).toBe("wait");
    expect(withLog(pending, [entry("OUTCOME_EVENT_DELAYED", {}, { test: "Н-12", atMs: T0 })], { now: T0 + LATE_MS + 1 }).system.R31.status).toBe("wait");
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
    const scope = purchase("M8s", { skip: ["start", "pay", "done"], at: { end: () => [step("failed", { order_id: "OM8s", mandate_id: "CM8s" }, { code: "MANDATE_SCOPE" })] } });
    expect(txOf(withLog(scope, [mk("Н-08", "M8s")])).R17).toMatchObject({ status: "fired", cause: { kind: "mark", test: "Н-08", bus: "mandate_scope" } });
    // Повторное ревью П-3.3 № 1: две пометки Н-08 при отказе Платформы — вторая не теряет отказ, остаётся «сработало».
    expect(txOf(withLog(scope, [mk("Н-08", "M8s"), mk("Н-08", "M8s")])).R17).toMatchObject({ status: "fired", cause: { kind: "mark", test: "Н-08", bus: "mandate_scope" } });
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
  const intentOnly = (id: string, tail: () => Interpretation[]) => [step("intent.awaiting_signature", { mandate_id: id }, { stage: "mandate" }), event("mandate.signed", { mandate_id: id }), ...tail()];
  type Want = Partial<Pick<Verdict, "kind" | "violator" | "protector" | "node" | "cond" | "guarantee">>;
  type Row = { readonly test: string; readonly items: () => Interpretation[]; readonly log?: () => StandLogEntry[]; readonly now?: number; readonly want: readonly Want[] };
  const rows: readonly Row[] = [
    {
      test: "П-03 клиент отказался от корзины — решение клиента",
      items: () => purchase("V3", { skip: ["signed", "order", "start", "pay", "done"], at: { end: () => [event("mandate.rejected", { mandate_id: "CV3" })] } }),
      want: [{ kind: "client_decision", violator: "client_decision" }],
    },
    {
      test: "П-04 клиент не подтвердил код — решение клиента, защитила Платформа (R21)",
      items: () => purchase("V4", { skip: ["start", "pay", "done"], at: { end: () => [req("V4"), event("confirmation.expired", { confirmation_id: "QV4", order_id: "OV4" }, { stage: "confirmation" })] } }),
      want: [{ cond: "R21", kind: "client_decision", violator: "client_decision", protector: "platform" }],
    },
    // П-05, П-07 — вердикты по сработавшим защитам (`guarantees`) — П-5.1 (Р-1484, решение владельца по П-3.3).
    {
      test: "П-06 агент вне поручения — не нарушение, защитила Платформа",
      items: () => purchase("V6", { skip: ["start", "pay", "done"], at: { end: () => [step("failed", { order_id: "OV6", mandate_id: "CV6" }, { code: "MANDATE_SCOPE" })] } }),
      want: [{ cond: "R17", kind: "protection", protector: "platform" }],
    },
    {
      // Ревью П-3.3 № 3: внутри транзакции — один вердикт R09, без противоречия «защитила Платформа / защитил агент».
      test: "П-08 клиент отозвал поручение (в транзакции) — нарушил: решение клиента, защитил: агент",
      items: () =>
        purchase("V8", {
          skip: ["start", "pay", "done"],
          at: { end: () => [event("mandate.revoked", { mandate_id: "CV8" }, { stage: "revoke" }), step("failed", { order_id: "OV8", mandate_id: "CV8" }, { code: "MANDATE_REVOKED" })] },
        }),
      want: [{ cond: "R09", kind: "client_decision", violator: "client_decision", protector: "agent" }],
    },
    {
      // Форма после передачи агенту: ядро 4a4ee7c на истёкшем поручении даёт MANDATE_NOT_ACTIVE (строка ниже —
      // «не определён»), код MANDATE_EXPIRED появится после неё (расхождение № 7).
      test: "срок поручения в транзакции — форма после передачи агенту (MANDATE_EXPIRED): нарушителя нет, защитил агент",
      items: () => purchase("V9", { skip: ["start", "pay", "done"], at: { end: () => [step("failed", { order_id: "OV9", mandate_id: "CV9" }, { code: "MANDATE_EXPIRED" })] } }),
      want: [{ cond: "R09", kind: "protection", protector: "agent" }],
    },
    {
      // Настоящая форма П-09 стенда (сюжет 10 окна Б): поручение без покупки, отказ MANDATE_OUT_OF_SCOPE до корзины —
      // R09 у поручения без покупки не считается, вердикта нет, паспорта нет.
      test: "П-09 срок поручения истёк (форма стенда: поручение без покупки, MANDATE_OUT_OF_SCOPE) — вердиктов нет",
      items: () => intentOnly("IV9", () => [step("failed", { mandate_id: "IV9" }, { code: "MANDATE_OUT_OF_SCOPE" })]),
      want: [],
    },
    {
      // Ревью П-3.3 № 1: без положительного признака отзыва или срока — не «П-09 по умолчанию».
      test: "MANDATE_NOT_ACTIVE без признака отзыва или срока — защитил агент, нарушитель не определён",
      items: () => purchase("VA", { skip: ["start", "pay", "done"], at: { end: () => [step("failed", { order_id: "OVA", mandate_id: "CVA" }, { code: "MANDATE_NOT_ACTIVE" })] } }),
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
      items: () => purchase("W8", { skip: ["start", "pay", "done"], at: { end: () => [step("failed", { order_id: "OW8", mandate_id: "CW8" }, { code: "MANDATE_SCOPE" })] } }),
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
