// Движок условий пульта DEMO-2 (П-3.2б; модель пульта 1.23 — `COND`, `st89`, `JOINTS`; Р-1426, Р-1476, Р-1478, Р-1479).
// Чистая функция над моделью транзакций (`tx.ts`) и записями шины: статус каждого из 18 проверяемых условий по каждой
// транзакции и поручению без покупки, сводный статус по системе, сработавшие гарантии, статус правила справочника.
// Условия — контроль по событиям, а не решение (инвариант 2): пределы и остатки не считаются, итог — только событие
// Платформы (инвариант 6, `tx.ts`). Номера карт не выводятся: R41 только отмечает запись, где найдена похожая на номер
// последовательность (инвариант 1).
// Здесь — условия по записям шины: R08, R09, R17 (по MANDATE_SCOPE, В8), R18, R21, R26, R28, R30, R37, R41, R46.
// R20, R23, R25, R27, R31, R32, R47 — по журналу сбоев стенда (П-3.2в, В9); до него — «на стенде не проверяется».
import type { Interpretation } from "../dashboards/interpret.js";
import type { Phrase } from "./phrases.js";
import { CHECKABLE_CONDITIONS, isCheckable, type CheckableCondition, type Rule89 } from "./rules89.js";
import type { PultMandate, PultTx, TxModel } from "./tx.js";

const p = (ru: string, en: string): Phrase => ({ ru, en });

/** Статусы модели (`ST89`). Порядок — от худшего: сводный статус — худший из статусов объектов. */
export const STATUSES = ["bad", "fired", "wait", "ok", "na", "none", "out"] as const;
export type CondStatus = (typeof STATUSES)[number];
export const STATUS_LABEL: Readonly<Record<CondStatus, Phrase>> = {
  bad: p("нарушено", "violated"),
  fired: p("сработало — остановило процесс", "triggered — stopped the process"),
  wait: p("ещё не дошло", "not reached yet"),
  ok: p("соблюдено", "met"),
  na: p("не применяется", "not applicable"),
  none: p("на стенде не проверяется", "not checked on the stand"),
  out: p("проверяется вне стенда", "checked outside the stand"),
};
const RANK: Readonly<Record<CondStatus, number>> = { bad: 0, fired: 1, wait: 2, ok: 3, na: 4, none: 5, out: 6 };
export const worstStatus = (list: readonly CondStatus[], empty: CondStatus = "na"): CondStatus =>
  list.reduce<CondStatus | undefined>((a, s) => (a === undefined || RANK[s] < RANK[a] ? s : a), undefined) ?? empty;

/** Пометка к статусу: почему он такой. */
export const NOTES = ["race_c28", "unconfirmed_paid", "amounts_after_mvp", "stand_log", "link_conflict", "event_pending"] as const;
export type Note = (typeof NOTES)[number];
export const NOTE_LABEL: Readonly<Record<Note, Phrase>> = {
  race_c28: p(
    "«оплачено» после отзыва, но запрос агента — до отзыва: гонка С-28, фрод или дефект; вердикт — владелец",
    "“paid” after revocation, but the agent's request came before it: race C-28, fraud or defect; the owner decides",
  ),
  unconfirmed_paid: p("второе «оплачено» связано с корзиной только номером заказа — связь не подтверждена", "a second “paid” is linked to the cart only by the order number — link not confirmed"),
  amounts_after_mvp: p("сравнение сумм — после MVP; на стенде сумму первой проверяет Платформа (MANDATE_SCOPE)", "amount comparison — after MVP; on the stand the Platform checks the amount first (MANDATE_SCOPE)"),
  stand_log: p("проверяется по журналу сбоев стенда — подключается в П-3.2в", "checked from the stand fault log — connected in P-3.2c"),
  link_conflict: p("конфликт звеньев — две покупки с одним номером заказа; решает человек", "link conflict — two purchases share an order number; a human decides"),
  event_pending: p("агент сообщил о подписи корзины — ждём событие Платформы", "the agent reported the cart signature — waiting for the Platform event"),
};

export interface CondResult {
  readonly status: CondStatus;
  /** seq записей-доказательств (для «Причин» и журнала). */
  readonly seqs: readonly number[];
  readonly note?: Note;
}
export type CondResults = Readonly<Record<CheckableCondition, CondResult>>;

/** Сработавшие защиты: отказ Платформы по пределам поручения, приостановленный агент, остановка агента по отзыву, отказ
 *  банка по лимиту клиента. `guarantee` — гарантия стыка модели (`JOINTS`), если она есть. */
export const GUARANTEES = ["mandate_scope", "agent_suspended", "revoke", "limit_client"] as const;
export type Guarantee = (typeof GUARANTEES)[number];
export const GUARANTEE_INFO: Readonly<Record<Guarantee, { readonly name: Phrase; readonly guarantee?: string }>> = {
  mandate_scope: { name: p("Платформа отказала: вне пределов поручения (MANDATE_SCOPE)", "The Platform declined: outside the mandate (MANDATE_SCOPE)"), guarantee: "g1d" },
  agent_suspended: { name: p("Платформа отказала: агент приостановлен (403)", "The Platform declined: the agent is suspended (403)") },
  revoke: { name: p("Агент остановил покупку сам после отзыва поручения", "The agent stopped the purchase itself after the mandate was revoked"), guarantee: "g3c" },
  limit_client: { name: p("Банк отказал: превышен лимит клиента", "The bank declined: the client's limit was exceeded") },
};
export interface GuaranteeHit {
  readonly kind: Guarantee;
  readonly seq: number;
  /** Транзакция или поручение, где сработала защита; нет — запись вне транзакций. */
  readonly obj?: string;
}

export interface ObjCheck {
  readonly id: string;
  readonly kind: "tx" | "mandate";
  readonly conds: CondResults;
}
export interface EngineView {
  readonly objs: readonly ObjCheck[];
  /** Сводно по системе: худший статус по объектам; R41 — по всем записям, включая записи вне транзакций. */
  readonly system: CondResults;
  readonly guarantees: readonly GuaranteeHit[];
}

const PAY_CALL = "POST /v1/shops/{shop_id}/orders/{order_id}/payment";
const SIGN_CALL = "POST /participants/v1/mandates/{mandate_id}/sign";
const STAND_LOG: readonly CheckableCondition[] = ["R20", "R23", "R25", "R27", "R31", "R32", "R47"];
const NOT_ACTIVE = new Set(["MANDATE_NOT_ACTIVE", "MANDATE_REVOKED"]);
/** Оплата заказа нашим агентом: обращение к витрине с его ключом (`agent_merchant`, шина); чужой клиент — `network_merchant`
 *  (ревью П-3.2б № 8). */
const isAgentPay = (x: Interpretation) => x.ref === PAY_CALL && x.source === "agent_merchant";
/** Подпись поручения клиентом на стенде — обращение эмулятора банка (`stand`); любой другой источник — не клиент (№ 6). */
const notByClient = (x: Interpretation, mandate: string) => x.ref === SIGN_CALL && mid(x) === mandate && x.source !== "stand";

const r = (status: CondStatus, seqs: readonly number[] = [], note?: Note): CondResult => ({ status, seqs, ...(note && { note }) });
const isEvent = (x: Interpretation, ref: string) => x.source === "pao_event" && x.ref === ref;
const mid = (x: Interpretation) => x.ids?.mandate_id;

const luhn = (d: string): boolean => {
  let sum = 0;
  for (let i = 0; i < d.length; i++) {
    let n = d.charCodeAt(d.length - 1 - i) - 48;
    if (i % 2 === 1) n = n * 2 > 9 ? n * 2 - 9 : n * 2;
    sum += n;
  }
  return sum % 10 === 0;
};

/** Канонический UUID (8-4-4-4-12 hex) — идентификатор поручения стенда (`mnd_…`), не номер карты: группы из одних цифр,
 *  склеенные дефисом, иначе давали бы ложное R41 на настоящей шине (П-3.2б; ревью № 16). */
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** Номер карты: 13–19 цифр подряд (через пробел или дефис) с верной контрольной цифрой Луна. В каждом отрезке цифр
 *  проверяются все окна 13–19 цифр — номер рядом с другими цифрами («… 12:00», «шаг 3 …») не теряется (ревью П-3.2б № 3).
 *  Отрезок не начинается и не кончается рядом с буквой (хвосты шестнадцатеричных идентификаторов); UUID вырезаются.
 *  Значение не возвращается. */
export function hasCardNumber(text: string): boolean {
  const s = text.replace(UUID, " ");
  for (const m of s.matchAll(/(?<![0-9A-Za-z])\d(?:[ -]?\d)+(?![0-9A-Za-z])/g)) {
    const d = m[0].replace(/[ -]/g, "");
    for (let len = 13; len <= Math.min(19, d.length); len++)
      for (let from = 0; from + len <= d.length; from++) if (luhn(d.slice(from, from + len))) return true;
  }
  return false;
}
const leaks = (x: Interpretation) => [x.phrase.ru, x.phrase.en, ...Object.values(x.ids ?? {})].some((s) => typeof s === "string" && hasCardNumber(s));

/** R41 по записям: есть похожее на номер карты — «нарушено»; записи есть — «соблюдено». */
function r41(recs: readonly Interpretation[]): CondResult {
  const bad = recs.filter(leaks).map((x) => x.seq);
  return bad.length > 0 ? r("bad", bad) : recs.length > 0 ? r("ok") : r("na");
}

/** R08: поручение-намерение подписывает клиент — событие Платформы `mandate.signed`; подпись обращением агента — нарушение. */
function r08(intent: string | undefined, recs: readonly Interpretation[], started: boolean): CondResult {
  if (intent === undefined) return r("na");
  const byAgent = recs.filter((x) => notByClient(x, intent));
  if (byAgent.length > 0) return r("bad", byAgent.map((x) => x.seq));
  const signed = recs.find((x) => isEvent(x, "mandate.signed") && mid(x) === intent);
  if (signed) return r("ok", [signed.seq]);
  // Покупка пошла, а подписи поручения нет — нарушение; иначе ещё ждём подписи (У-01 — «Идёт к нарушению», П-4.1).
  return started ? r("bad") : r("wait");
}

/** R37 по поручениям `ids`: агент, узнавший об отзыве, не начинает оплату. Время действия — шаг `payment.started`
 *  (выпускается до вызова; запись обращения к витрине пишется после ответа, `onSend`), без шагов — оплата агента;
 *  «узнал» — запись журнала агента `mandate.revoked`. Нарушение — оплата начата после того, как агент узнал. Оплата начата
 *  после события отзыва, но до записи агента, или «оплачено» после отзыва — гонка С-28 (В5): «ждёт», вердикт владельца
 *  (ревью П-3.2б № 1). */
function r37(ids: readonly string[], recs: readonly Interpretation[], afterRevoke: boolean): CondResult {
  const rv = recs.filter((x) => isEvent(x, "mandate.revoked") && ids.includes(mid(x) ?? "")).sort((a, b) => a.seq - b.seq)[0];
  if (!rv) return r("na");
  const learned = recs
    .filter((x) => x.stream === "console" && x.ref === "mandate.revoked" && ids.includes(mid(x) ?? ""))
    .sort((a, b) => a.seq - b.seq)[0];
  const starts = recs.filter((x) => x.stream === "scenario" && x.ref === "payment.started");
  const acts = starts.length > 0 ? starts : recs.filter(isAgentPay);
  const bad = learned ? acts.filter((x) => x.seq > learned.seq).map((x) => x.seq) : [];
  if (bad.length > 0) return r("bad", [rv.seq, learned!.seq, ...bad]);
  if (afterRevoke || acts.some((x) => x.seq > rv.seq)) return r("wait", [rv.seq], "race_c28");
  return r("ok", [rv.seq, ...(learned ? [learned.seq] : [])]);
}

function txConds(t: PultTx, recs: readonly Interpretation[], intentRecs: readonly Interpretation[]): CondResults {
  const all = [...recs, ...intentRecs].sort((a, b) => a.seq - b.seq);
  const pays = recs.filter(isAgentPay);
  const opEvents = recs.filter((x) => x.source === "pao_event" && x.ref.startsWith("operation."));
  // Начало оплаты — шаг `payment.started` (до вызова); обращение к витрине пишется после ответа (`onSend`).
  const payStarts = recs.filter((x) => x.stream === "scenario" && x.ref === "payment.started");
  const first = [...payStarts, ...pays, ...opEvents].sort((a, b) => a.seq - b.seq)[0];
  const started = first !== undefined || t.ops.length > 0;
  const paid = t.outcome?.kind === "paid" || t.outcome?.kind === "settled";
  const codes = (code: string) => recs.filter((x) => x.who?.code === code).map((x) => x.seq);
  const out: Partial<Record<CheckableCondition, CondResult>> = {};

  out.R08 = r08(t.intentId, all, started);

  // R09: «оплачено» после отзыва — нарушено (В5); отказ Платформы «поручение не действует» — защита сработала. Операция
  // прошла или отказана по другой причине (лимит) — поручение действовало; итог без операции (отзыв, отклонённое
  // подтверждение) — не применяется.
  const notActive = recs.filter((x) => x.who?.code !== undefined && NOT_ACTIVE.has(x.who.code)).map((x) => x.seq);
  out.R09 = t.afterRevoke
    ? r("bad", t.outcome ? [t.outcome.seq] : [])
    : notActive.length > 0
      ? r("fired", notActive)
      : paid || t.outcome?.kind === "declined"
        ? r("ok", [t.outcome!.seq])
        : t.outcome
          ? r("na")
          : started
            ? r("wait")
            : r("na");

  // R17 (В8): до MVP — только «сработало» по MANDATE_SCOPE; сравнение сумм — после MVP.
  const scope = codes("MANDATE_SCOPE");
  out.R17 = scope.length > 0 ? r("fired", scope) : r("none", [], "amounts_after_mvp");

  // R18: согласие клиента с корзиной на стенде — подпись поручения корзины клиентом в банке. Доказательство — только
  // событие Платформы `mandate.signed` корзины; шаг агента «корзина подписана» даёт только время (событие ленты может прийти
  // позже шага, Нюансы STATUS): согласие — раньше из двух (ревью П-3.2б № 5). Шаг есть, события ещё нет — «ждёт» с
  // пометкой. Подпись не эмулятором банка — нарушение (№ 6).
  const cart = t.cartMandateId;
  if (cart === undefined) out.R18 = r("na");
  else {
    const byAgent = all.filter((x) => notByClient(x, cart));
    const signedEv = all.find((x) => isEvent(x, "mandate.signed") && mid(x) === cart);
    const signedStep = all.find((x) => x.stream === "scenario" && x.ref === "cart.signed" && mid(x) === cart);
    const consentSeq = signedEv ? Math.min(signedEv.seq, signedStep?.seq ?? signedEv.seq) : undefined;
    const refused = all.some((x) => isEvent(x, "mandate.rejected") && mid(x) === cart);
    out.R18 =
      byAgent.length > 0
        ? r("bad", byAgent.map((x) => x.seq))
        : consentSeq !== undefined
          ? first !== undefined && consentSeq > first.seq
            ? r("bad", [first.seq])
            : r("ok", [signedEv!.seq, ...(signedStep ? [signedStep.seq] : [])])
          : signedStep && (first === undefined || signedStep.seq < first.seq)
            ? r("wait", [signedStep.seq], "event_pending")
            : first !== undefined
              ? r("bad", [first.seq])
              : refused
                ? r("na")
                : r("wait");
  }

  // R21: срок подтверждения — истёк без оплаты: защита сработала; оплата после срока — нарушено; одобрено — соблюдено.
  const conf = recs.filter((x) => x.source === "pao_event" && x.ref.startsWith("confirmation."));
  const expired = conf.find((x) => x.ref === "confirmation.expired");
  const payAfter = expired ? [...pays, ...opEvents.filter((x) => x.ref !== "operation.declined")].filter((x) => x.seq > expired.seq) : [];
  out.R21 = expired
    ? payAfter.length > 0
      ? r("bad", [expired.seq, ...payAfter.map((x) => x.seq)])
      : r("fired", [expired.seq])
    : conf.some((x) => x.ref === "confirmation.approved")
      ? r("ok", conf.filter((x) => x.ref === "confirmation.approved").map((x) => x.seq))
      : conf.some((x) => x.ref === "confirmation.required") && !conf.some((x) => x.ref === "confirmation.rejected")
        ? r("wait")
        : r("na");

  // R26: оплата — тому продавцу, у которого заказ: все обращения к витрине по заказу (номер в пути) — одна витрина.
  // Номер витрины в шаге заказа — merchant_id (другое пространство номеров), поэтому сверка — по shop_id обращений.
  if (pays.length === 0) out.R26 = t.orderIds.length > 0 ? r("wait") : r("na");
  else {
    const byOrder = new Map<string, Set<string>>();
    for (const x of recs) {
      const o = x.ids?.order_id;
      const s = x.ids?.shop_id;
      // Только обращения нашего агента: чужой клиент с тем же номером заказа агенту не вменяется (№ 8).
      if (o !== undefined && s !== undefined && x.source === "agent_merchant") byOrder.set(o, (byOrder.get(o) ?? new Set()).add(s));
    }
    const split = [...byOrder.values()].some((s) => s.size > 1);
    out.R26 = split ? r("bad", pays.map((x) => x.seq)) : r("ok", pays.map((x) => x.seq));
  }

  // R28, R30: итог и «оплачено» на пульте — только по событию Платформы (модель транзакций, инвариант 6).
  out.R28 = t.outcome ? r("ok", [t.outcome.seq]) : started ? r("wait") : r("na");
  out.R30 = paid ? r("ok", [t.outcome!.seq]) : t.outcome ? r("na") : started ? r("wait") : r("na");

  out.R37 = r37([cart, t.intentId].filter((x): x is string => x !== undefined), all, t.afterRevoke === true);
  out.R41 = r41(all);

  // R46 (Р-1479): «нарушено» — два «оплачено» по операциям, связанным шагом агента, или два успешных вызова оплаты на
  // один номер заказа; второе «оплачено», связанное только номером заказа, — «ждёт» с пометкой.
  const paysPerOrder = new Map<string, number[]>();
  for (const x of pays) if (x.kind === "norm" && x.ids?.order_id) paysPerOrder.set(x.ids.order_id, [...(paysPerOrder.get(x.ids.order_id) ?? []), x.seq]);
  const dupPays = [...paysPerOrder.values()].filter((s) => s.length > 1).flat();
  const loose = new Set([...(t.unconfirmedOps ?? []), ...(t.pendingOps ?? [])]);
  const loosePaid = opEvents.filter((x) => (x.ref === "operation.authorized" || x.ref === "operation.settled") && loose.has(x.ids?.op_ref ?? ""));
  out.R46 = t.doubleDebit
    ? r("bad", t.ops.filter((o) => o.kind === "paid" || o.kind === "settled").map((o) => o.seq!))
    : dupPays.length > 0
      ? r("bad", dupPays)
      : paid && loosePaid.length > 0
        ? r("wait", loosePaid.map((x) => x.seq), "unconfirmed_paid")
        : paid
          ? r("ok", [t.outcome!.seq])
          : started && !t.outcome
            ? r("wait")
            : r("na");

  // Конфликт звеньев (витрина повторила номер заказа другой покупки, `tx.ts`): условия по заказу и итогу не выносят
  // «нарушено» — две законные покупки дали бы ложное R26 и R46; «ждёт» с пометкой, решает человек (ревью П-3.2б № 2).
  if (t.linkConflict) for (const c of ["R18", "R21", "R26", "R28", "R30", "R46"] as const) out[c] = r("wait", out[c]!.seqs, "link_conflict");

  for (const c of STAND_LOG) out[c] = r("none", [], "stand_log");
  return out as CondResults;
}

function mandateConds(m: PultMandate, recs: readonly Interpretation[]): CondResults {
  const out: Partial<Record<CheckableCondition, CondResult>> = {};
  for (const c of CHECKABLE_CONDITIONS) out[c] = r("na");
  out.R08 = r08(m.id, recs, false);
  out.R37 = r37([m.id], recs, false);
  out.R41 = r41(recs);
  out.R17 = r("none", [], "amounts_after_mvp");
  for (const c of STAND_LOG) out[c] = r("none", [], "stand_log");
  return out as CondResults;
}

function guaranteesOf(items: readonly Interpretation[], objOf: ReadonlyMap<number, string>): GuaranteeHit[] {
  const hits: GuaranteeHit[] = [];
  const hit = (kind: Guarantee, x: Interpretation) => hits.push({ kind, seq: x.seq, ...(objOf.has(x.seq) && { obj: objOf.get(x.seq)! }) });
  for (const x of items) {
    const code = x.who?.code;
    if (code === "MANDATE_SCOPE") hit("mandate_scope", x);
    else if (code === "AGENT_SUSPENDED") hit("agent_suspended", x);
    else if (x.ref === "revoke.refused" || (x.stream !== "monitor" && code !== undefined && NOT_ACTIVE.has(code))) hit("revoke", x);
    else if (isEvent(x, "operation.declined") && code === "LIMIT_EXCEEDED" && x.who?.codeDetail === "CLIENT") hit("limit_client", x);
  }
  return hits;
}

/** Условия по транзакциям и поручениям без покупки, сводно по системе, сработавшие защиты. */
export function evaluate(model: TxModel, items: readonly Interpretation[]): EngineView {
  const bySeq = new Map(items.map((x) => [x.seq, x] as const));
  const recsOf = (seqs: readonly number[]) => seqs.map((s) => bySeq.get(s)).filter((x): x is Interpretation => x !== undefined);
  const mandateById = new Map(model.mandates.map((m) => [m.id, m] as const));
  const objOf = new Map<number, string>();
  const objs: ObjCheck[] = [];
  for (const t of model.txs) {
    const intent = t.intentId !== undefined ? mandateById.get(t.intentId) : undefined;
    objs.push({ id: t.id, kind: "tx", conds: txConds(t, recsOf(t.seqs), intent ? recsOf(intent.seqs) : []) });
    for (const s of t.seqs) objOf.set(s, t.id);
  }
  for (const m of model.mandates) {
    for (const s of m.seqs) if (!objOf.has(s)) objOf.set(s, m.id);
    if (m.txIds.length > 0) continue;
    objs.push({ id: m.id, kind: "mandate", conds: mandateConds(m, recsOf(m.seqs)) });
  }
  const system: Partial<Record<CheckableCondition, CondResult>> = {};
  for (const c of CHECKABLE_CONDITIONS) {
    const res = objs.map((o) => o.conds[c]);
    const status = worstStatus(res.map((x) => x.status), c === "R17" || STAND_LOG.includes(c) ? "none" : "na");
    const same = res.filter((x) => x.status === status);
    const fallback: Note | undefined = status !== "none" ? undefined : c === "R17" ? "amounts_after_mvp" : STAND_LOG.includes(c) ? "stand_log" : undefined;
    const note = same.find((x) => x.note !== undefined)?.note ?? fallback;
    system[c] = r(status, same.flatMap((x) => x.seqs), note);
  }
  // R41 сводно — по всем записям: записи вне транзакций (служебные, поиск) тоже не должны нести номера карт.
  system.R41 = r41(items);
  return { objs, system: system as CondResults, guarantees: guaranteesOf(items, objOf) };
}

/** Статус правила справочника по статусам его проверяемых условий; без проверяемых — «на стенде не проверяется», а
 *  правило «вне стенда» — «проверяется вне стенда» (модель `st89`; П6 доп. 1). */
export function ruleStatus(rule: Rule89, conds: CondResults): CondStatus {
  if (!isCheckable(rule)) return rule.coverage === "outside" ? "out" : "none";
  const own = rule.conds.filter((c): c is CheckableCondition => (CHECKABLE_CONDITIONS as readonly string[]).includes(c));
  return worstStatus(own.map((c) => conds[c].status), "none");
}
