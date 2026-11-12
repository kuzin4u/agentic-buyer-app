// Движок условий пульта DEMO-2 (П-3.2б; модель пульта 1.23 — `COND`, `st89`, `JOINTS`; Р-1426, Р-1476, Р-1478, Р-1479).
// Чистая функция над моделью транзакций (`tx.ts`) и записями шины: статус каждого из 18 проверяемых условий по каждой
// транзакции и поручению без покупки, сводный статус по системе, сработавшие гарантии, статус правила справочника.
// Условия — контроль по событиям, а не решение (инвариант 2): пределы и остатки не считаются, итог — только событие
// Платформы (инвариант 6, `tx.ts`). Номера карт не выводятся: R41 только отмечает запись, где найдена похожая на номер
// последовательность (инвариант 1).
// Здесь — условия по записям шины: R08, R09, R17 (по MANDATE_SCOPE, В8), R18, R21, R26, R28, R30, R37, R41, R46.
// R20, R23, R25, R27, R31, R32, R47 — по журналу сбоев стенда (П-3.2в, В9); до него — «на стенде не проверяется».
// П-3.2в: R20, R23, R25, R27, R31, R32, R47 — по журналу сбоев стенда (`standlog.ts`, В9), пометки «ПР» (`MARKED`) —
// к R17, R18, R26, R37, R46, R47 (В8; решение владельца — PR #9 #pullrequestreview-5861020062); срок R31 — от «сейчас»,
// переданного аргументом.
import type { Interpretation } from "../dashboards/interpret.js";
import type { Phrase } from "./phrases.js";
import { CHECKABLE_CONDITIONS, isCheckable, type CheckableCondition, type Party, type Rule89 } from "./rules89.js";
import { STAND_DELAY_MAX_MS, type StandLogEntry, type StandLogWhat, type StandTest } from "./standlog.js";

/** Срок позднего итога R31 по умолчанию: наибольшая задержка стенда (60 с) + запас 15 с — законно задержанное событие
 *  «нарушено» не даёт (ревью П-3.2в № 2; срок контролёра паспортов, 15 с, к позднему событию отношения не имеет). */
export const LATE_MS = STAND_DELAY_MAX_MS + 15_000;
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
export const NOTES = ["race_c28", "unconfirmed_paid", "amounts_after_mvp", "stand_log", "link_conflict", "event_pending", "preempted_by_reaction"] as const;
export type Note = (typeof NOTES)[number];
export const NOTE_LABEL: Readonly<Record<Note, Phrase>> = {
  race_c28: p(
    "«оплачено» после отзыва, но запрос агента — до отзыва: гонка С-28, фрод или дефект; вердикт — владелец",
    "“paid” after revocation, but the agent's request came before it: race C-28, fraud or defect; the owner decides",
  ),
  unconfirmed_paid: p("второе «оплачено» связано с корзиной только номером заказа — связь не подтверждена", "a second “paid” is linked to the cart only by the order number — link not confirmed"),
  amounts_after_mvp: p("сравнение сумм — после MVP; на стенде сумму первой проверяет Платформа (MANDATE_SCOPE)", "amount comparison — after MVP; on the stand the Platform checks the amount first (MANDATE_SCOPE)"),
  // Без внутренних кодов задач на экране (ревью П-4.1 № 10; ревью П-3.2б № 14): пометка видна в плитке узла «Условий» (П-4.2).
  // Журнал стенда — только в режиме сбоев (Р-1514; подключён в П-8.2, Р-1531).
  stand_log: p("проверяется по журналу сбоев стенда — журнал есть только в режиме сбоев", "checked from the stand fault log — the log exists in fault mode only"),
  link_conflict: p("конфликт звеньев — две покупки с одним номером заказа; решает человек", "link conflict — two purchases share an order number; a human decides"),
  event_pending: p("агент сообщил о подписи корзины — ждём событие Платформы", "the agent reported the cart signature — waiting for the Platform event"),
  // У-04 (П-8.2, Р-1531): без причинности — пульт не знает, успел ли клиент благодаря продлению.
  preempted_by_reaction: p(
    "упреждено реакцией: напоминание было до подтверждения — нарушения нет",
    "pre-empted by a reaction: the reminder came before the confirmation — no breach",
  ),
};
/** Записи журнала стенда о напоминании клиенту (кнопка «Напомнить клиенту», `remindClient`): первое — с продлением срока,
 *  повтор — без него; оба — напоминание. */
export const REMIND_LOG: readonly StandLogWhat[] = ["CLIENT_REMINDED", "REMIND_REPEATED"];

export interface CondResult {
  readonly status: CondStatus;
  /** seq записей-доказательств (для «Причин» и журнала). */
  readonly seqs: readonly number[];
  readonly note?: Note;
  /** Номера записей журнала сбоев стенда (свой счёт стенда, не seq шины) — доказательства из журнала (П-3.2в). */
  readonly log?: readonly number[];
  /** Причина «нарушено» или «сработало» — закрытый перечень (П-3.3): по ней субъект вердикта (`verdict.ts`). */
  readonly cause?: Cause;
}

/** Причины по записям шины (П-3.3) — закрытый перечень. */
export const RULE_CAUSES = [
  "card_number_agent", // R41: похожее на номер карты в записи агента (журнал агента, обращение его ключом)
  "card_number_other", // R41: то же в записи не агента (шаг сюжета, сеть, событие) — субъект не определён
  "sign_by_agent", // R08, R18: подпись поручения обращением агента
  "sign_by_other", // R08, R18: подпись поручения не эмулятором банка и не агентом (сеть) — субъект не определён
  "no_signature", // R08: покупка без подписи поручения
  "pay_before_consent", // R18: оплата раньше подписи корзины клиентом
  "paid_after_revoke", // R09: «оплачено» после события отзыва (гонка С-28 — В5)
  "revoked_agent_stop", // R09: поручение отозвано (MANDATE_REVOKED или событие отзыва) — агент остановился сам
  "revoked_platform_decline", // R09: поручение отозвано — отказала Платформа
  "expired_agent_stop", // R09: срок поручения истёк (MANDATE_EXPIRED) — агент остановился сам
  "expired_platform_decline", // R09: срок поручения истёк — отказала Платформа
  "inactive_agent_stop", // R09: MANDATE_NOT_ACTIVE без признака отзыва или срока — агент остановился сам
  "inactive_platform_decline", // R09: то же — отказала Платформа
  // R09: остановка видна только в шаге сюжета (рассказ стенда) — кто остановил, не доказано (П-5.1, Р-1519)
  "revoked_undetermined",
  "expired_undetermined",
  "inactive_undetermined",
  // R17: остановка вне пределов поручения (MANDATE_SCOPE); кто остановил — `stoppedBy` (П-5.1, ревью П-5.1 № 1, Р-1519)
  "mandate_scope_platform", // отказ Платформы на запрос
  "mandate_scope_agent", // журнал агента
  "mandate_scope_undetermined", // только шаг сюжета
  "agent_pay_after_expiry", // R21: агент начал оплату после истечения срока подтверждения
  "operation_after_expiry", // R21: операция Платформы после истечения срока подтверждения
  "confirmation_expired", // R21: срок подтверждения истёк без оплаты
  "wrong_shop", // R26: оплата заказа у другой витрины
  "agent_after_revoke", // R37: агент начал оплату, узнав об отзыве
  "double_debit", // R46: два «оплачено» по связанным операциям
  "double_pay", // R46: две успешные оплаты одного заказа
  "idempotency", // R23, R25: повтор отклонён (IDEMPOTENCY_CONFLICT)
  "late_lost", // R31: поздний итог потерян после срока
  "instruction_excluded", // R47: агент исключил предложение с инструкцией
] as const;
export type RuleCause = (typeof RULE_CAUSES)[number];
export type Cause =
  | { readonly kind: "rule"; readonly rule: RuleCause }
  | { readonly kind: "fault"; readonly what: StandLogWhat }
  // Пометка «ПР» доказывает попытку нарушения; `bus` — причина по шине того же условия, если была (Н-08: защитник
  // «Платформа» — только при отказе MANDATE_SCOPE на шине; решение владельца по П-3.3, 1).
  | { readonly kind: "mark"; readonly test: StandTest; readonly bus?: RuleCause };

export interface EngineOptions {
  /** Журнал сбоев и действий стенда — только в режиме сбоев (Р-1514; в ленту пульта — П-8.2, Р-1531). Нет — журнал
   *  недоступен: условия журнала «на стенде не проверяется»; есть (даже пустой) — считаются. */
  readonly standLog?: readonly StandLogEntry[];
  /** «Сейчас» для срока позднего итога R31 — аргументом, не системными часами: модель без часов, тесты детерминированы. */
  readonly now?: string;
  /** Срок позднего итога R31, мс; по умолчанию `LATE_MS` (75 с: задержка стенда до 60 с + запас). */
  readonly lateMs?: number;
}
export type CondResults = Readonly<Record<CheckableCondition, CondResult>>;

/** Сработавшие защиты: вне пределов поручения, приостановленный агент, поручение отозвано или не действует, лимит клиента в
 *  банке. `guarantee` — гарантия стыка модели (`JOINTS`), если она есть. Кто защитил — не в названии, а в `protector`
 *  остановки (по источнику, П-5.1). */
export const GUARANTEES = ["mandate_scope", "agent_suspended", "revoke", "limit_client", "pay_refused"] as const;
export type Guarantee = (typeof GUARANTEES)[number];
export const GUARANTEE_INFO: Readonly<Record<Guarantee, { readonly name: Phrase; readonly guarantee?: string }>> = {
  mandate_scope: { name: p("Покупка вне пределов поручения остановлена (MANDATE_SCOPE)", "A purchase outside the mandate was stopped (MANDATE_SCOPE)"), guarantee: "g1d" },
  agent_suspended: { name: p("Приостановленный агент остановлен (403)", "The suspended agent was stopped (403)") },
  revoke: { name: p("Покупка по отозванному или недействующему поручению остановлена", "A purchase under a revoked or inactive mandate was stopped"), guarantee: "g3c" },
  limit_client: { name: p("Оплата сверх лимита клиента в банке отклонена", "A payment above the client's bank limit was declined") },
  // Р-1524: отказ витрины на запрос оплаты (повтор оплаченного заказа, Н-01) — «защитил продавец».
  pay_refused: { name: p("Повторная оплата заказа отклонена продавцом", "A repeated payment for the order was declined by the merchant") },
};

/** Кто остановил: Платформа, агент, банк или «не определён» (П-5.1; ревью П-3.2б № 4, П-3.3 № 3; Р-1519). */
export type Stopper = Party | "undetermined";
/** Коды остановки «поручение не действует». */
export const STOP_CODES_NOT_ACTIVE: readonly string[] = ["MANDATE_NOT_ACTIVE", "MANDATE_REVOKED", "MANDATE_EXPIRED"];
/** Коды остановки по виду защиты — один перечень для `guaranteesOf` и сверки с реестрами (Р-1511; ревью П-5.1 № 15). */
export const GUARANTEE_CODE_BY_KIND: Readonly<Record<Guarantee, readonly string[]>> = {
  mandate_scope: ["MANDATE_SCOPE"],
  agent_suspended: ["AGENT_SUSPENDED"],
  revoke: STOP_CODES_NOT_ACTIVE,
  limit_client: ["LIMIT_EXCEEDED"],
  pay_refused: ["ORDER_NOT_PAYABLE"],
};
/** Коды отказа продавца (реестр продавца, `MERCHANT_DIAG`) — по ним, и только по ответу витрины, «защитил продавец». */
export const MERCHANT_STOP_CODES: readonly string[] = GUARANTEE_CODE_BY_KIND.pay_refused;
/** Все коды, по которым пульт засчитывает сработавшую защиту, — сверяются с реестрами агента и ПАО (Р-1511). */
export const GUARANTEE_CODES: readonly string[] = Object.values(GUARANTEE_CODE_BY_KIND).flat();

/** Ответ Платформы с отказом: запись монитора от нашего агента к Платформе с кодом (интерпретатор ставит код записи
 *  монитора только при `status ≥ 400` или `cls: decline`). */
const platformAnswer = (x: Interpretation, codes: ReadonlySet<string>) =>
  x.stream === "monitor" && (x.source === "agent_platform" || x.source === "agent_platform_open") && x.who?.code !== undefined && codes.has(x.who.code);
/** Журнал агента с кодом остановки. */
const agentJournal = (x: Interpretation, codes: ReadonlySet<string>) => x.stream === "console" && x.who?.code !== undefined && codes.has(x.who.code);

/** Кто остановил по записям одной остановки — правило «кто защитил» (П-5.1; ревью П-3.2б № 4, П-3.3 № 3; Р-1519):
 *  ответ Платформы с кодом — Платформа (и тогда, когда агент тоже записал отказ: он лишь узнал о нём); иначе журнал агента
 *  с кодом — агент; иначе (только шаг сюжета — рассказ стенда, не доказательство) — «не определён». */
export function stoppedBy(recs: readonly Interpretation[], codes: readonly string[]): Stopper {
  const set = new Set(codes);
  if (recs.some((x) => platformAnswer(x, set))) return "platform";
  // Продавец — только по кодам отказа продавца (`ORDER_NOT_PAYABLE`): ответ витрины с кодом другого участника защитой
  // продавца не считается.
  if (codes.every((c) => MERCHANT_STOP_CODES.includes(c)) && recs.some((x) => merchantAnswer(x, set))) return "merchant";
  if (recs.some((x) => agentJournal(x, set))) return "agent";
  return "undetermined";
}
/** Ответ витрины с отказом на запрос нашего агента (≥ 400 с кодом; Р-1524, как у Платформы в Р-1522). */
const merchantAnswer = (x: Interpretation, codes: ReadonlySet<string>) =>
  x.stream === "monitor" && x.source === "agent_merchant" && x.who?.code !== undefined && codes.has(x.who.code);

export interface GuaranteeHit {
  readonly kind: Guarantee;
  /** Первая запись остановки. */
  readonly seq: number;
  /** Все записи одной остановки (ответ Платформы, журнал агента, шаг сюжета): одна остановка — одна защита. */
  readonly seqs: readonly number[];
  /** Кто остановил — по источнику (`stoppedBy`); лимит клиента — банк. */
  readonly protector: Stopper;
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
const NOT_ACTIVE: ReadonlySet<string> = new Set(STOP_CODES_NOT_ACTIVE);
/** Запись нашего агента: журнал агента или обращение его ключом. */
const byOurAgent = (x: Interpretation) =>
  x.stream === "console" || x.source === "agent_platform" || x.source === "agent_platform_open" || x.source === "agent_merchant";
/** Подпись поручения не клиентом: обращением агента — агент; иначе (сеть) — субъект не определён (ревью П-3.3 № 6). */
const signCause = (xs: readonly Interpretation[]): RuleCause => (xs.some(byOurAgent) ? "sign_by_agent" : "sign_by_other");
/** Оплата заказа нашим агентом: обращение к витрине с его ключом (`agent_merchant`, шина); чужой клиент — `network_merchant`
 *  (ревью П-3.2б № 8). */
const isAgentPay = (x: Interpretation) => x.ref === PAY_CALL && x.source === "agent_merchant";
/** Подпись поручения клиентом на стенде — обращение эмулятора банка (`stand`); любой другой источник — не клиент (№ 6). */
const notByClient = (x: Interpretation, mandate: string) => x.ref === SIGN_CALL && mid(x) === mandate && x.source !== "stand";

const r = (status: CondStatus, seqs: readonly number[] = [], note?: Note, log?: readonly number[], cause?: Cause): CondResult => ({
  status,
  seqs,
  ...(note && { note }),
  ...(log && log.length > 0 && { log }),
  ...(cause && { cause }),
});
/** «Нарушено» или «сработало» с причиной по записям шины. */
const rc = (status: "bad" | "fired", rule: RuleCause, seqs: readonly number[] = [], log?: readonly number[]): CondResult =>
  r(status, seqs, undefined, log, { kind: "rule", rule });
const causeOf = (e: StandLogEntry): Cause | undefined =>
  e.what === "MARKED" ? (e.test !== undefined ? { kind: "mark", test: e.test } : undefined) : { kind: "fault", what: e.what };

/** Сбой стенда или пометка «ПР» → условия и статус. Срок R31 — отдельно (`r31`): «итог есть» — «соблюдено». */
const FAULT_EFFECT: Partial<Record<StandLogWhat, readonly (readonly [CheckableCondition, CondStatus])[]>> = {
  UPK_CODE_LEAKED: [["R20", "bad"]],
  SECOND_CREDENTIAL_ISSUED: [["R23", "bad"], ["R25", "bad"]],
  // В7: витрина ответила «оплачено» до итога — нарушила витрина, защитил пульт (итог — только по событию).
  PAID_BEFORE_OUTCOME: [["R27", "fired"]],
  FULFILLED_BEFORE_OUTCOME: [["R32", "bad"]],
};
const MARK_EFFECT: Partial<Record<StandTest, readonly [CheckableCondition, CondStatus]>> = {
  "Н-01": ["R46", "bad"],
  "Н-05": ["R47", "bad"],
  "Н-06": ["R37", "bad"],
  "Н-07": ["R18", "bad"],
  // В8 и решение по П-3.3, 1: сумма не та — Платформа отказала (MANDATE_SCOPE на шине) — R17 остаётся «сработало»
  // (`raise`); не отказала (операция прошла) — «нарушено», защитника нет.
  "Н-08": ["R17", "bad"],
  "Н-09": ["R26", "bad"],
};
const LATE = new Set<StandLogWhat>(["OUTCOME_EVENT_DELAYED", "OUTCOME_EVENTS_REORDERED"]);
const effectsOf = (e: StandLogEntry): readonly (readonly [CheckableCondition, CondStatus])[] =>
  e.what === "MARKED" ? (e.test !== undefined && MARK_EFFECT[e.test] ? [MARK_EFFECT[e.test]!] : []) : (FAULT_EFFECT[e.what] ?? []);

/** Поднять статус условия до более тяжёлого по записи журнала; доказательства шины сохраняются. Неточная привязка записи
 *  (`weak`, `objsOfEntry`) поднимает не выше «ждёт» — с пометкой «конфликт звеньев» (ревью П-3.2в № 4). */
function raise(out: Partial<Record<CheckableCondition, CondResult>>, c: CheckableCondition, status: CondStatus, e: StandLogEntry, weak = false): void {
  const cur = out[c] ?? r("na");
  // Н-08 при отказе Платформы MANDATE_SCOPE на шине: защита сработала — статус остаётся «сработало», пометка хранится
  // вместе с причиной по шине (решение владельца по П-3.3, 1).
  // Причина по шине — и у уже стоящей пометки (вторая пометка Н-08 не теряет отказ Платформы; повторное ревью П-3.3 № 1).
  const bus = cur.cause?.kind === "rule" ? cur.cause.rule : cur.cause?.kind === "mark" ? cur.cause.bus : undefined;
  const stopped = e.what === "MARKED" && e.test === "Н-08" && c === "R17" && cur.status === "fired" && bus?.startsWith("mandate_scope_") === true;
  const want: CondStatus = stopped ? "fired" : status;
  const st: CondStatus = weak && RANK[want] < RANK.wait ? "wait" : want;
  const own = st === "bad" || st === "fired" ? causeOf(e) : undefined;
  const cause: Cause | undefined = own?.kind === "mark" && bus !== undefined ? { ...own, bus } : own;
  if (RANK[st] < RANK[cur.status]) out[c] = r(st, cur.seqs, weak ? "link_conflict" : undefined, [e.seq], cause);
  // При равном статусе пометка «ПР» главнее причины по шине: это явное заявление приложения о нарушении (Н-08 при уже
  // «сработавшем» MANDATE_SCOPE — нарушил агент; без пометки — П-06, нарушения нет).
  else if (st === cur.status)
    out[c] = r(cur.status, cur.seqs, cur.note ?? (weak ? "link_conflict" : undefined), [...(cur.log ?? []), e.seq], cause?.kind === "mark" ? cause : (cur.cause ?? cause));
}
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

/** Фраза записи, похожей на номер карты (инвариант 1; ревью П-5.1 № 5). */
export const HIDDEN_RECORD: Phrase = p("запись скрыта: в ней похожее на номер карты", "record hidden: it contains something like a card number");
/** Фраза записи для экрана и ленты пульта: запись с похожим на номер карты — скрыта здесь, на сервере, — номер не уходит ни
 *  в доску, ни в «Причины», ни в SSE (инвариант 1). Нарушение R41 при этом остаётся — по записи шины. */
export const safePhrase = (x: Interpretation): Phrase => (leaks(x) ? HIDDEN_RECORD : x.phrase);

/** R41 по записям: есть похожее на номер карты — «нарушено»; записи есть — «соблюдено». */
function r41(recs: readonly Interpretation[]): CondResult {
  const bad = recs.filter(leaks).map((x) => x.seq);
  if (bad.length === 0) return recs.length > 0 ? r("ok") : r("na");
  // Субъект — по источнику записи: запись нашего агента — агент; иначе — не определён (ревью П-3.3 № 6).
  const agentOwn = recs.filter((x) => leaks(x) && byOurAgent(x)).length > 0;
  return rc("bad", agentOwn ? "card_number_agent" : "card_number_other", bad);
}

/** R08: поручение-намерение подписывает клиент — событие Платформы `mandate.signed`; подпись обращением агента — нарушение. */
function r08(intent: string | undefined, recs: readonly Interpretation[], started: boolean): CondResult {
  if (intent === undefined) return r("na");
  const byAgent = recs.filter((x) => notByClient(x, intent));
  if (byAgent.length > 0) return rc("bad", signCause(byAgent), byAgent.map((x) => x.seq));
  const signed = recs.find((x) => isEvent(x, "mandate.signed") && mid(x) === intent);
  if (signed) return r("ok", [signed.seq]);
  // Покупка пошла, а подписи поручения нет — нарушение; иначе ещё ждём подписи (У-01 — «Идёт к нарушению», П-4.1).
  return started ? rc("bad", "no_signature") : r("wait");
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
  if (bad.length > 0) return rc("bad", "agent_after_revoke", [rv.seq, learned!.seq, ...bad]);
  if (afterRevoke || acts.some((x) => x.seq > rv.seq)) return r("wait", [rv.seq], "race_c28");
  return r("ok", [rv.seq, ...(learned ? [learned.seq] : [])]);
}

/** Условия журнала сбоев по транзакции: база — по записям шины, затем сбои и пометки, привязанные к транзакции. */
function standConds(
  t: PultTx,
  recs: readonly Interpretation[],
  log: readonly StandLogEntry[],
  s: { started: boolean; paid: boolean },
  o: EngineOptions,
): Partial<Record<CheckableCondition, CondResult>> {
  const out: Partial<Record<CheckableCondition, CondResult>> = {};
  const done = t.outcome !== undefined;
  const progress = (okSeq?: number) => (okSeq !== undefined ? r("ok", [okSeq]) : s.started ? r("wait") : r("na"));
  const asked = recs.filter((x) => isEvent(x, "confirmation.required")).map((x) => x.seq);
  out.R20 = asked.length > 0 ? r("ok", asked) : r("na");
  // R23, R25: повтор отклонён Платформой (IDEMPOTENCY_CONFLICT) — защита сработала; иначе — по ходу покупки.
  const idem = recs.filter((x) => x.who?.code === "IDEMPOTENCY_CONFLICT").map((x) => x.seq);
  out.R23 = idem.length > 0 ? rc("fired", "idempotency", idem) : progress(t.outcome?.seq);
  out.R25 = out.R23;
  out.R27 = progress(t.outcome?.seq);
  out.R32 = s.paid ? r("ok", [t.outcome!.seq]) : done ? r("na") : progress();
  out.R47 = r("na");
  // R31 (В7): поздний или переставленный итог — итог у транзакции есть: «соблюдено, позднее событие учтено»; итога нет и
  // срок от записи стенда прошёл — «нарушено» (пульт потерял итог); иначе — «ждёт».
  const late = log.filter((e) => LATE.has(e.what));
  if (late.length === 0) out.R31 = progress(t.outcome?.seq);
  else {
    const ls = late.map((e) => e.seq);
    const first = Math.min(...late.map((e) => Date.parse(e.at)));
    const overdue = o.now !== undefined && Date.parse(o.now) - first > (o.lateMs ?? LATE_MS);
    out.R31 = done ? r("ok", [t.outcome!.seq], undefined, ls) : overdue ? rc("bad", "late_lost", [], ls) : r("wait", [], undefined, ls);
  }
  return out;
}

function txConds(
  t: PultTx,
  recs: readonly Interpretation[],
  intentRecs: readonly Interpretation[],
  log: readonly StandLogEntry[] | undefined,
  o: EngineOptions,
  weak?: ReadonlySet<number>,
): CondResults {
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
  const notActiveRecs = recs.filter((x) => x.who?.code !== undefined && NOT_ACTIVE.has(x.who.code));
  const notActive = notActiveRecs.map((x) => x.seq);
  // Почему поручение не действует — по положительному признаку (ревью П-3.3 № 1): отзыв — код MANDATE_REVOKED или событие
  // отзыва корзины или намерения; срок — MANDATE_EXPIRED; иначе (один MANDATE_NOT_ACTIVE) — не определён. Кто остановил —
  // то же правило, что у сработавших защит (`stoppedBy`, П-5.1): ответ Платформы — Платформа, иначе журнал агента — агент,
  // иначе (только шаг сюжета) — не определён (ревью П-3.3 № 3; Р-1519).
  const stopCause = (): RuleCause => {
    const codes = new Set(notActiveRecs.map((x) => x.who!.code));
    const revokedEv = all.some((x) => isEvent(x, "mandate.revoked") && [t.cartMandateId, t.intentId].includes(mid(x)));
    // По всем записям транзакции и её намерения: журнал агента может сослаться на поручение-намерение (ревью П-5.1 № 2).
    const s = stoppedBy(all.filter((x) => x.who?.code !== undefined && NOT_ACTIVE.has(x.who.code)), STOP_CODES_NOT_ACTIVE);
    const by = s === "platform" ? "platform_decline" : s === "agent" ? "agent_stop" : "undetermined";
    const why = codes.has("MANDATE_REVOKED") || revokedEv ? "revoked" : codes.has("MANDATE_EXPIRED") ? "expired" : "inactive";
    return `${why}_${by}` as RuleCause;
  };
  out.R09 = t.afterRevoke
    ? rc("bad", "paid_after_revoke", t.outcome ? [t.outcome.seq] : [])
    : notActive.length > 0
      ? rc("fired", stopCause(), notActive)
      : paid || t.outcome?.kind === "declined"
        ? r("ok", [t.outcome!.seq])
        : t.outcome
          ? r("na")
          : started
            ? r("wait")
            : r("na");

  // R17 (В8): до MVP — только «сработало» по MANDATE_SCOPE; сравнение сумм — после MVP.
  // Кто остановил — то же правило «кто защитил», что у защит и R09 (`stoppedBy`; ревью П-5.1 № 1, Р-1519).
  const scope = codes("MANDATE_SCOPE");
  // По записям транзакции и её намерения — как у R09 (ревью П-5.1 повторное № 5).
  const scopeBy = stoppedBy(all.filter((x) => x.who?.code === "MANDATE_SCOPE"), ["MANDATE_SCOPE"]);
  out.R17 = scope.length > 0 ? rc("fired", `mandate_scope_${scopeBy === "platform" || scopeBy === "agent" ? scopeBy : "undetermined"}`, scope) : r("none", [], "amounts_after_mvp");

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
        ? rc("bad", signCause(byAgent), byAgent.map((x) => x.seq))
        : consentSeq !== undefined
          ? first !== undefined && consentSeq > first.seq
            ? rc("bad", "pay_before_consent", [first.seq])
            : r("ok", [signedEv!.seq, ...(signedStep ? [signedStep.seq] : [])])
          : signedStep && (first === undefined || signedStep.seq < first.seq)
            ? r("wait", [signedStep.seq], "event_pending")
            : first !== undefined
              ? rc("bad", "pay_before_consent", [first.seq])
              : refused
                ? r("na")
                : r("wait");
  }

  // R21: срок подтверждения — истёк без оплаты: защита сработала; оплата после срока — нарушено; одобрено — соблюдено.
  const conf = recs.filter((x) => x.source === "pao_event" && x.ref.startsWith("confirmation."));
  const expired = conf.find((x) => x.ref === "confirmation.expired");
  const payAfter = expired ? [...payStarts, ...pays, ...opEvents.filter((x) => x.ref !== "operation.declined")].filter((x) => x.seq > expired.seq) : [];
  // Кто после срока: операция Платформы — Платформа должна была отказать; только оплата агента — агент (ревью П-3.3 № 5).
  const opAfter = payAfter.some((x) => x.source === "pao_event");
  // «Упреждено реакцией» (У-04; П-8.2, Р-1531): в журнале стенда — напоминание по ТОМУ ЖЕ запросу подтверждения раньше
  // события одобрения Платформы (часы стенда). Доказательство — только запись протокола стенда, не нажатие пульта (запись
  // пульта о себе, Р-1519); журнала нет (`log === undefined`, режим показа) — не определяется, просто «соблюдено».
  const approved = conf.filter((x) => x.ref === "confirmation.approved");
  const preempted = [
    ...new Set(
      approved.flatMap((a) =>
        (log ?? []).filter((e) => REMIND_LOG.includes(e.what) && e.ids.confirmation_id !== undefined && e.ids.confirmation_id === a.ids?.confirmation_id && Date.parse(e.at) < Date.parse(a.at)).map((e) => e.seq),
      ),
    ),
  ];
  out.R21 = expired
    ? payAfter.length > 0
      ? rc("bad", opAfter ? "operation_after_expiry" : "agent_pay_after_expiry", [expired.seq, ...payAfter.map((x) => x.seq)])
      : rc("fired", "confirmation_expired", [expired.seq])
    : approved.length > 0
      ? preempted.length > 0
        ? r("ok", approved.map((x) => x.seq), "preempted_by_reaction", preempted)
        : r("ok", approved.map((x) => x.seq))
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
    out.R26 = split ? rc("bad", "wrong_shop", pays.map((x) => x.seq)) : r("ok", pays.map((x) => x.seq));
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
    ? rc("bad", "double_debit", t.ops.filter((o) => o.kind === "paid" || o.kind === "settled").map((o) => o.seq!))
    : dupPays.length > 0
      ? rc("bad", "double_pay", dupPays)
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

  if (log === undefined) for (const c of STAND_LOG) out[c] = r("none", [], "stand_log");
  else {
    Object.assign(out, standConds(t, recs, log, { started, paid }, o));
    if (t.linkConflict) for (const c of ["R27", "R31", "R32"] as const) out[c] = r("wait", out[c]!.seqs, "link_conflict", out[c]!.log);
    // Сбои стенда и пометки «ПР», привязанные к транзакции, — поднимают статус (R31 — выше, по сроку). Запись с неточной
    // привязкой (несколько кандидатов или только номер заказа у транзакции с конфликтом звеньев) — не выше «ждёт».
    for (const e of log) for (const [c, st] of effectsOf(e)) raise(out, c, st, e, weak?.has(e.seq));
  }
  return out as CondResults;
}

function mandateConds(m: PultMandate, recs: readonly Interpretation[], log: readonly StandLogEntry[] | undefined): CondResults {
  const out: Partial<Record<CheckableCondition, CondResult>> = {};
  for (const c of CHECKABLE_CONDITIONS) out[c] = r("na");
  out.R08 = r08(m.id, recs, false);
  out.R37 = r37([m.id], recs, false);
  out.R41 = r41(recs);
  out.R17 = r("none", [], "amounts_after_mvp");
  if (log === undefined) for (const c of STAND_LOG) out[c] = r("none", [], "stand_log");
  else for (const e of log) for (const [c, st] of effectsOf(e)) raise(out, c, st, e);
  return out as CondResults;
}

/** Привязка записи журнала стенда к объектам (П-3.2г; ревью П-3.2в № 3, 4) — правило вердикта, записано в STATUS
 *  «Открыто». Уровни по старшинству, решает первый, на котором нашёлся кандидат: операция (`op_ref`) → запрос
 *  подтверждения (`confirmation_id`) → заказ (`order_id`, `order_ref` — номер заказа в запросе реквизита; при `shop_id` в
 *  записи — только транзакции, где заказ с этим номером был у этой витрины) → поручение корзины → поручение-намерение →
 *  поручение без покупки. Неточная привязка (`weak`): кандидатов несколько — запись ко всем, но статус не выше «ждёт»;
 *  привязка только номером заказа к транзакции с конфликтом звеньев — тоже. Не нашлось — запись системы. */
function objsOfEntry(e: StandLogEntry, model: TxModel): { readonly ids: readonly string[]; readonly weak: boolean } {
  const { op_ref: p, confirmation_id: q, mandate_id: md, shop_id: sh } = e.ids;
  const ord = e.ids.order_id ?? e.ids.order_ref;
  const pack = (c: readonly PultTx[], weak = c.length > 1) => ({ ids: c.map((t) => t.id), weak });
  const levels: (readonly PultTx[])[] = [
    p !== undefined ? model.txs.filter((t) => t.opRefs.includes(p)) : [],
    q !== undefined ? model.txs.filter((t) => t.confirmationIds.includes(q)) : [],
  ];
  for (const c of levels) if (c.length > 0) return pack(c);
  if (ord !== undefined) {
    // Номера заказов разных витрин могут совпасть: при `shop_id` — только транзакции, где этот заказ был у этой витрины
    // (обращений к витрине по заказу нет — судить не по чему, транзакция остаётся кандидатом).
    const c = model.txs.filter((t) => t.orderIds.includes(ord) && (sh === undefined || !t.shopsByOrder[ord] || t.shopsByOrder[ord]!.includes(sh)));
    if (c.length > 0) return pack(c, c.length > 1 || c.some((t) => t.linkConflict !== undefined));
  }
  if (md !== undefined) {
    // У транзакции с конфликтом звеньев корзина и намерение не заданы — её поручения в `linkConflict`; такая привязка неточна
    // (иначе запись уходила бы в систему без ограничения «не выше „ждёт“»; повторное ревью П-3.2г № 1).
    const levelCart = model.txs.filter((t) => t.cartMandateId === md || t.linkConflict?.carts.includes(md));
    const levelIntent = model.txs.filter((t) => t.intentId === md || t.linkConflict?.intents.includes(md));
    for (const c of [levelCart, levelIntent]) if (c.length > 0) return pack(c, c.length > 1 || c.some((t) => t.linkConflict !== undefined));
    if (model.mandates.some((m) => m.id === md && m.txIds.length === 0)) return { ids: [md], weak: false };
  }
  return { ids: [], weak: false };
}

/** Сработавшие защиты: записи одной остановки — один вид защиты в одном объекте — склеиваются в одну (ревью П-3.2б № 4:
 *  ответ 403, журнал агента и шаг `failed` иначе дали бы тройной счёт в «Журнале» и «Отчёте»). Кто остановил — `stoppedBy`;
 *  лимит клиента — банк (отказ банка, о котором сообщает событие Платформы). */
function guaranteesOf(items: readonly Interpretation[], objOf: ReadonlyMap<number, string>): GuaranteeHit[] {
  const groups = new Map<string, { kind: Guarantee; obj?: string; recs: Interpretation[] }>();
  const add = (kind: Guarantee, x: Interpretation) => {
    const obj = objOf.get(x.seq);
    const key = `${kind}|${obj ?? ""}`;
    const g = groups.get(key) ?? { kind, ...(obj !== undefined && { obj }), recs: [] };
    g.recs.push(x);
    groups.set(key, g);
  };
  const CODES = GUARANTEE_CODE_BY_KIND;
  const has = (k: Guarantee, code: string | undefined) => code !== undefined && CODES[k].includes(code);
  for (const x of items) {
    const code = x.who?.code;
    if (has("mandate_scope", code)) add("mandate_scope", x);
    else if (has("agent_suspended", code)) add("agent_suspended", x);
    else if (x.ref === "revoke.refused" || has("revoke", code)) add("revoke", x);
    else if (isEvent(x, "operation.declined") && has("limit_client", code) && x.who?.codeDetail === "CLIENT") add("limit_client", x);
    // Р-1524: только ответ витрины на запрос оплаты нашего агента — запись сюжета или пометка «ПР» защиты не дают.
    else if (x.ref === PAY_CALL && merchantAnswer(x, new Set(CODES.pay_refused))) add("pay_refused", x);
  }
  return [...groups.values()]
    .map((g): GuaranteeHit => ({
      kind: g.kind,
      seq: g.recs[0]!.seq,
      seqs: g.recs.map((x) => x.seq),
      protector: g.kind === "limit_client" ? "bank" : stoppedBy(g.recs, CODES[g.kind]),
      ...(g.obj !== undefined && { obj: g.obj }),
    }))
    .sort((a, b) => a.seq - b.seq);
}

/** Условия по транзакциям и поручениям без покупки, сводно по системе, сработавшие защиты. Журнал сбоев стенда и
 *  «сейчас» для срока R31 — аргументами (`EngineOptions`). */
export function evaluate(model: TxModel, items: readonly Interpretation[], o: EngineOptions = {}): EngineView {
  const bySeq = new Map(items.map((x) => [x.seq, x] as const));
  const recsOf = (seqs: readonly number[]) => seqs.map((s) => bySeq.get(s)).filter((x): x is Interpretation => x !== undefined);
  const mandateById = new Map(model.mandates.map((m) => [m.id, m] as const));
  // Записи журнала по объектам; без объекта — к системе.
  const logOf = new Map<string, StandLogEntry[]>();
  // Записи с неточной привязкой — по объекту: номер записи журнала стенда.
  const weakOf = new Map<string, Set<number>>();
  const systemLog: StandLogEntry[] = [];
  for (const e of o.standLog ?? []) {
    const { ids, weak } = objsOfEntry(e, model);
    if (ids.length === 0) systemLog.push(e);
    for (const id of ids) {
      logOf.set(id, [...(logOf.get(id) ?? []), e]);
      if (weak) weakOf.set(id, (weakOf.get(id) ?? new Set()).add(e.seq));
    }
  }
  const own = (id: string) => (o.standLog === undefined ? undefined : (logOf.get(id) ?? []));
  const objOf = new Map<number, string>();
  const objs: ObjCheck[] = [];
  for (const t of model.txs) {
    const intent = t.intentId !== undefined ? mandateById.get(t.intentId) : undefined;
    objs.push({ id: t.id, kind: "tx", conds: txConds(t, recsOf(t.seqs), intent ? recsOf(intent.seqs) : [], own(t.id), o, weakOf.get(t.id)) });
    for (const s of t.seqs) objOf.set(s, t.id);
  }
  for (const m of model.mandates) {
    for (const s of m.seqs) if (!objOf.has(s)) objOf.set(s, m.id);
    if (m.txIds.length > 0) continue;
    objs.push({ id: m.id, kind: "mandate", conds: mandateConds(m, recsOf(m.seqs), own(m.id)) });
  }
  const logOn = o.standLog !== undefined;
  const system: Partial<Record<CheckableCondition, CondResult>> = {};
  for (const c of CHECKABLE_CONDITIONS) {
    const res = objs.map((x) => x.conds[c]);
    const stand = STAND_LOG.includes(c) && !logOn;
    const status = worstStatus(res.map((x) => x.status), c === "R17" || stand ? "none" : "na");
    const same = res.filter((x) => x.status === status);
    const fallback: Note | undefined = status !== "none" ? undefined : c === "R17" ? "amounts_after_mvp" : stand ? "stand_log" : undefined;
    const note = same.find((x) => x.note !== undefined)?.note ?? fallback;
    const log = same.flatMap((x) => x.log ?? []);
    system[c] = r(status, same.flatMap((x) => x.seqs), note, log);
  }
  // R41 сводно — по всем записям: записи вне транзакций (служебные, поиск) тоже не должны нести номера карт.
  system.R41 = r41(items);
  if (logOn) {
    // R47 (В7, решение владельца): каталог с инструкцией агенту отдан (`INSTRUCTION_SERVED`) и агент исключил предложение
    // (`A5_INSTRUCTION`) — защита сработала; исключения ещё нет — «ждёт». Подбор — до корзины, поэтому сводно.
    const served = (o.standLog ?? []).filter((e) => e.what === "INSTRUCTION_SERVED").map((e) => e.seq);
    if (served.length > 0) {
      const excluded = items.filter((x) => x.who?.code === "A5_INSTRUCTION").map((x) => x.seq);
      const st = excluded.length > 0 ? rc("fired", "instruction_excluded", excluded, served) : r("wait", [], undefined, served);
      if (RANK[st.status] < RANK[system.R47!.status]) system.R47 = st;
    }
    // Записи журнала без объекта — к системе: сбои и пометки. Поздний итог без объекта (ревью П-3.2в № 1): стенд пишет
    // только `op_ref`, а пока событие задержано, операции на шине нет. Срок прошёл, а записи с этим `op_ref` на шине так
    // и нет — пульт потерял итог: «нарушено»; до срока или без `op_ref` (судить не по чему) — «ждёт».
    const seenOps = new Set(items.map((x) => x.ids?.op_ref).filter((x): x is string => x !== undefined));
    // Окно записей конечно (лента пульта, шина), журнал стенда — нет: запись старше первой записи окна не судится — её
    // транзакция могла уйти из окна, «нет на шине» тогда ложно (повторное ревью П-3.2в № A).
    const windowFrom = items.length > 0 ? Math.min(...items.map((x) => Date.parse(x.at))) : undefined;
    for (const e of systemLog) {
      for (const [c, st] of effectsOf(e)) raise(system, c, st, e);
      if (!LATE.has(e.what) || (windowFrom !== undefined && Date.parse(e.at) < windowFrom)) continue;
      const p = e.ids.op_ref;
      const overdue = o.now !== undefined && Date.parse(o.now) - Date.parse(e.at) > (o.lateMs ?? LATE_MS);
      const lost = p !== undefined && overdue && !seenOps.has(p);
      raise(system, "R31", lost ? "bad" : "wait", e);
      // Причина R31 «нарушено» — потерянный итог (пульт), а не сам сбой задержки стенда.
      if (lost && system.R31!.status === "bad") system.R31 = { ...system.R31!, cause: { kind: "rule", rule: "late_lost" } };
    }
  }
  // Остановка, записанная по поручению-намерению с одной покупкой, — остановка этой покупки: одна остановка — одна защита
  // (ревью П-5.1 № 2).
  const viaTx = new Map(model.mandates.filter((m) => m.txIds.length === 1).map((m) => [m.id, m.txIds[0]!] as const));
  const guaranteeObj = new Map([...objOf].map(([s, o]) => [s, viaTx.get(o) ?? o] as const));
  return { objs, system: system as CondResults, guarantees: guaranteesOf(items, guaranteeObj) };
}

/** Статус правила справочника по статусам его проверяемых условий; без проверяемых — «на стенде не проверяется», а
 *  правило «вне стенда» — «проверяется вне стенда» (модель `st89`; П6 доп. 1). */
export function ruleStatus(rule: Rule89, conds: CondResults): CondStatus {
  if (!isCheckable(rule)) return rule.coverage === "outside" ? "out" : "none";
  const own = rule.conds.filter((c): c is CheckableCondition => (CHECKABLE_CONDITIONS as readonly string[]).includes(c));
  return worstStatus(own.map((c) => conds[c].status), "none");
}
