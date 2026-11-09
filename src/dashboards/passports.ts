// Паспорта пяти сюжетов приёмки демо-стенда (К2.1 DEMO-2; Р-1244, Р-1245, Р-1344): ожидаемый исход, статусы поручения,
// операции, агента и его ключа, ожидаемая квалификация интерпретатора. Паспорт — данные: что должно быть в ленте
// интерпретаций сюжета («ожидается») и чего быть не должно («запрещено»). Сверку сюжета целиком делает контролёр (К2.2);
// здесь — только сопоставление одной интерпретации с одним признаком. Паспорта переиспользуются в П-11 пульта — пять из
// 25 тестов приёмки (Р-1344). Код агента и Платформы не импортируется (Р-1246 п. 3): факты — только из интерпретаций.
import type { Interpretation, Kind, Role, Verdict } from "./interpret.js";
import type { DiagSource, WireLang, WireMonitorEvent } from "./wire.js";

export type Texts = Readonly<Record<WireLang, string>>;
const t = (ru: string, en: string): Texts => ({ ru, en });

/** Номер сюжета на мониторе демо-стенда и имя кнопки (`/scenario/<имя>`). */
export const SCENARIOS = [
  { no: 1, name: "intent" },
  { no: 2, name: "purchase" },
  { no: 3, name: "limit" },
  { no: 4, name: "upk" },
  { no: 5, name: "revoke" },
] as const;
export type ScenarioNo = (typeof SCENARIOS)[number]["no"];

/** Признаки интерпретации; все заданные должны совпасть. `side` — все перечисленные стороны есть у «кто ошибся»;
 *  `code` и `source` — одно из перечисленных. Пустой набор признаков совпадает со всем — в паспортах не допускается (тест). */
export interface Match {
  readonly stream?: Interpretation["stream"];
  readonly ref?: string;
  readonly status?: string;
  readonly actor?: Role;
  /** Кто прислал обращение на шине (`Interpretation.source`): участник ставится по маршруту, а кто прислал — только здесь. */
  readonly source?: readonly WireMonitorEvent["source"][];
  readonly kind?: Kind;
  readonly code?: string | readonly string[];
  readonly codeDetail?: string;
  readonly side?: readonly (DiagSource | "network")[];
  readonly verdict?: Verdict;
  readonly situation?: string;
  readonly training?: boolean;
}

/** Что запрещено: признаки и описание простыми словами (для экрана «Контроль» и выгрузки ACC-1). */
export interface Forbid {
  readonly id: string;
  readonly what: Texts;
  readonly match: Match;
}

/** Что ожидается; `times` — сколько раз ровно (например, «оплачено» — одно событие Платформы), нет — хотя бы один раз.
 *  `after` — id другого ожидания этого паспорта, которое должно случиться раньше (по seq шины): например, итог оплаты
 *  в сюжете — только после события Платформы «оплачено» (инвариант 6; ревью К2.2 № 5). */
export interface Expectation extends Forbid {
  readonly times?: number;
  readonly after?: string;
}

/** Исход сюжета. */
export type Outcome = "signed" | "paid" | "declined" | "confirmed_paid" | "stopped";

export interface Passport {
  readonly no: ScenarioNo;
  readonly name: (typeof SCENARIOS)[number]["name"];
  readonly title: Texts;
  readonly outcome: { readonly kind: Outcome; readonly text: Texts };
  /** Статусы, которые сюжет оставляет: поручение (и корзина), операция, агент, ключ агента. */
  readonly statuses: { readonly mandate: Texts; readonly operation: Texts; readonly agent: Texts; readonly key: Texts };
  /** Должно быть в ленте сюжета. Шаги сюжета (stream scenario) — в этом порядке (контролёр, К2.2). */
  readonly expect: readonly Expectation[];
  /** Не должно быть в ленте сюжета. */
  readonly forbid: readonly Forbid[];
}

const oneOf = <T>(want: T | readonly T[], v: T): boolean => (Array.isArray(want) ? (want as readonly T[]).includes(v) : want === v);

/** Сопоставление одной интерпретации с признаками. */
export function matches(r: Interpretation, m: Match): boolean {
  if (m.stream !== undefined && r.stream !== m.stream) return false;
  if (m.ref !== undefined && r.ref !== m.ref) return false;
  if (m.status !== undefined && r.status !== m.status) return false;
  if (m.actor !== undefined && r.actor !== m.actor) return false;
  if (m.source !== undefined && (r.source === undefined || !m.source.includes(r.source))) return false;
  if (m.kind !== undefined && r.kind !== m.kind) return false;
  if (m.situation !== undefined && r.situation !== m.situation) return false;
  if (m.training !== undefined && (r.training === true) !== m.training) return false;
  if (m.code !== undefined || m.codeDetail !== undefined || m.side !== undefined || m.verdict !== undefined) {
    const w = r.who;
    if (!w) return false;
    if (m.code !== undefined && !oneOf(m.code, w.code)) return false;
    if (m.codeDetail !== undefined && w.codeDetail !== m.codeDetail) return false;
    if (m.verdict !== undefined && w.verdict !== m.verdict) return false;
    if (m.side !== undefined && !m.side.every((s) => w.side.includes(s))) return false;
  }
  return true;
}

const step = (id: string, ref: string, what: Texts, extra: Omit<Match, "stream" | "ref"> = {}, times?: number): Expectation => ({
  id,
  what,
  match: { stream: "scenario", ref, ...extra },
  ...(times !== undefined && { times }),
});
const event = (id: string, ref: string, what: Texts, extra: Omit<Match, "stream" | "ref"> = {}, times?: number): Expectation => ({
  id,
  what,
  match: { stream: "monitor", ref, actor: "platform", source: ["pao_event"], ...extra },
  ...(times !== undefined && { times }),
});

// --- Действия клиента: только из банка (эмулятор банка внутри стенда, source stand), не от агента и не по сети ---

const SIGN = "POST /participants/v1/mandates/{mandate_id}/sign";
const CONFIRM = "POST /participants/v1/confirmations/{confirmation_id}";
const REVOKE = "POST /participants/v1/mandates/{mandate_id}/revoke";
const BY_BANK: Pick<Match, "stream" | "actor" | "source"> = { stream: "monitor", actor: "client", source: ["stand"] };
const NOT_BANK: readonly WireMonitorEvent["source"][] = ["agent_platform", "agent_platform_open", "network_platform"];

/** Подписи клиента в банке за прогон с монитора (Р-1391): сюжет 1 — поручение; 2 и 3 — корзина (поручение — из сюжета 1);
 *  4 — своё поручение и корзина; 5 — подписей нет (отзыв поручения из сюжета 1). */
const SIGNS = {
  mandate: { times: 1, what: t("Подписывает клиент в банке, не агент: одна подпись — поручение", "The client signs in the bank, not the agent: one signature — the mandate") },
  cart: { times: 1, what: t("Подписывает клиент в банке, не агент: одна подпись — корзина", "The client signs in the bank, not the agent: one signature — the cart") },
  both: { times: 2, what: t("Подписывает клиент в банке, не агент: две подписи — поручение и корзина", "The client signs in the bank, not the agent: two signatures — the mandate and the cart") },
} as const;
const clientSigns = (s: keyof typeof SIGNS): Expectation => ({ id: "client-signs", what: SIGNS[s].what, match: { ...BY_BANK, ref: SIGN }, times: SIGNS[s].times });

// --- Общие запреты всех сюжетов: честный агент, честный стенд ---

/** Агент допущен Платформой (статус агента — активен). Все коды реестров об отказе в допуске агента. */
export const AGENT_CODES = [
  "AGENT_SUSPENDED",
  "DECLINED_AGENT_SUSPENDED",
  "AGENT_UNKNOWN",
  "AGENT_UNIDENTIFIED",
  "AGENT_EXCLUDED",
  "AGENT_MISMATCH",
  "AGENT_SELF_UNKNOWN",
  "AGENT_CLASS_MISMATCH",
] as const;
/** Ключ агента действует. Все коды реестров о подписи, ключе и хранилище ключей. */
export const KEY_CODES = [
  "SIGNATURE_INVALID",
  "AGENT_KEY_REVOKED",
  "KEY_UNKNOWN",
  "KEY_REVOKED",
  "KEY_EXPIRED",
  "KEY_NOT_ACTIVE",
  "KEY_INVALID",
  "KEY_MISMATCH",
  "KEY_AMBIGUOUS",
  "KEY_REJECTED",
  "NO_ACTIVE_KEY",
  "NO_KEY",
  "KEYSTORE_LOCKED",
  "KEYSTORE_WRITE_FAILED",
] as const;

const COMMON_FORBID: readonly Forbid[] = [
  { id: "no-fraud", what: t("Фрода нет: ни подставного агента, ни запроса от чужого имени", "No fraud: no rogue agent, no request posing as the agent"), match: { kind: "fraud" } },
  {
    id: "no-owner-verdict",
    what: t("Нет нарушения поручения нашим агентом («решает владелец»)", "No mandate violation by our agent (“the owner decides”)"),
    match: { verdict: "owner" },
  },
  { id: "agent-admitted", what: t("Агент допущен Платформой: отказов в допуске нет", "The agent is admitted by the Platform: no admission refusals"), match: { code: AGENT_CODES } },
  { id: "agent-key-valid", what: t("Ключ агента действует: отказов по подписи и ключу нет", "The agent key is valid: no signature or key refusals"), match: { code: KEY_CODES } },
  ...[
    ["client-sign-only", SIGN, t("Поручение и корзину подписывает только клиент в банке — не агент и не посторонний", "Only the client signs the mandate and cart in the bank — not the agent, not a stranger")],
    ["client-confirm-only", CONFIRM, t("Покупку подтверждает только клиент в банке — не агент и не посторонний", "Only the client confirms the purchase in the bank — not the agent, not a stranger")],
    ["client-revoke-only", REVOKE, t("Поручение отзывает только клиент в банке — не агент и не посторонний", "Only the client revokes the mandate in the bank — not the agent, not a stranger")],
  ].map(([id, ref, what]) => ({ id: id as string, what: what as Texts, match: { stream: "monitor" as const, ref: ref as string, source: NOT_BANK } })),
];

const ACTIVE = { agent: t("агент активен", "agent active"), key: t("ключ агента действует", "agent key valid") };
const PAID_EVENT = (times: number) =>
  event("paid", "operation.authorized", t("Оплачено — по событию Платформы, один раз (С-27)", "Paid — from the Platform event, once (С-27)"), { kind: "norm", situation: "С-27" }, times);
/** Без оплаты: ни события «оплачено», ни шага итога — «оплачено» без события Платформы нарушало бы инвариант 6. */
const NO_PAID: readonly Forbid[] = [
  { id: "no-paid", what: t("Оплаты нет: события «оплачено» не было", "No payment: no “paid” event"), match: { stream: "monitor", ref: "operation.authorized" } },
  { id: "no-outcome", what: t("Шага итога оплаты нет", "No payment outcome step"), match: { stream: "scenario", ref: "outcome" } },
];

const RAW: readonly Passport[] = [
  {
    no: 1,
    name: "intent",
    title: t("1. Подпись поручения", "1. Mandate signature"),
    outcome: { kind: "signed", text: t("Поручение подписано клиентом в банке и действует", "The mandate is signed by the client in the bank and active") },
    statuses: { mandate: t("поручение подписано", "mandate signed"), operation: t("операции нет", "no operation"), ...ACTIVE },
    expect: [
      step("created", "intent.created", t("Агент просит поручение (С-01)", "The agent asks for a mandate (С-01)"), { situation: "С-01" }),
      step("awaiting", "intent.awaiting_signature", t("Поручение ждёт подписи клиента", "The mandate awaits the client's signature")),
      clientSigns("mandate"),
      event("signed-event", "mandate.signed", t("Платформа: поручение подписано", "Platform: mandate signed")),
      step("signed", "intent.signed", t("Поручение действует", "The mandate is active"), { status: "ACTIVE" }),
    ],
    forbid: [
      ...COMMON_FORBID,
      ...NO_PAID,
      { id: "no-conflict", what: t("Конфликтов нет", "No conflicts"), match: { kind: "conflict" } },
      { id: "no-error", what: t("Ошибок нет", "No errors"), match: { kind: "error" } },
    ],
  },
  {
    no: 2,
    name: "purchase",
    title: t("2. Покупка в рамках поручения", "2. Purchase within the mandate"),
    outcome: { kind: "paid", text: t("Оплачено по событию Платформы; ответ витрины — слова продавца", "Paid per the Platform event; the shop reply is the merchant's words") },
    statuses: { mandate: t("корзина подписана, поручение использовано", "cart signed, mandate used"), operation: t("операция авторизована", "operation authorized"), ...ACTIVE },
    expect: [
      step("mode", "purchase.mode_note", t("Немедленный режим: корзину подписывает клиент", "Immediate mode: the client signs the cart")),
      step("found", "search.found", t("Агент нашёл предложения в контуре и вне его", "The agent found offers inside and outside the contour")),
      {
        id: "a5",
        what: t("Сигнал A5 у витрины — конфликт у продавца, «так и должно быть», учебный сбой", "A5 signal at a shop — merchant conflict, works as intended, training fault"),
        match: { code: "A5_PRICE_MISMATCH", kind: "conflict", side: ["merchant"], verdict: "expected", training: true },
      },
      {
        id: "incomplete",
        what: t("Неполная карточка витрины — ошибка продавца, учебный сбой", "Incomplete shop card — merchant error, training fault"),
        match: { code: "REQUIRED", kind: "error", side: ["merchant"], verdict: "failure", training: true },
      },
      step("card", "cart.card", t("Клиенту показана карточка корзины (С-25)", "The client sees the cart card (С-25)"), { situation: "С-25" }),
      step("agreed", "cart.agreed", t("Клиент согласился с корзиной", "The client agreed to the cart")),
      clientSigns("cart"),
      step("cart-signed", "cart.signed", t("Корзина подписана", "The cart is signed")),
      step("order", "order.placed", t("Заказ у продавца", "Order at the merchant")),
      step("reply", "order.shop_reply", t("Ответ витрины «оплачен» — слова продавца, не итог", "Shop reply “paid” — merchant's words, not the outcome"), { status: "PAID" }),
      PAID_EVENT(1),
      { ...step("outcome", "outcome", t("Итог — после события Платформы «оплачено»: авторизовано", "Outcome — after the Platform “paid” event: authorized"), { status: "AUTHORIZED" }), after: "paid" },
    ],
    forbid: [...COMMON_FORBID],
  },
  {
    no: 3,
    name: "limit",
    title: t("3. Отказ: превышен лимит клиента в банке", "3. Declined: the client's bank limit exceeded"),
    outcome: { kind: "declined", text: t("Отказ Платформы по лимиту клиента в банке; оплаты нет", "Platform decline on the client's bank limit; no payment") },
    statuses: { mandate: t("корзина подписана, оплаты нет", "cart signed, no payment"), operation: t("операция отклонена", "operation declined"), ...ACTIVE },
    expect: [
      step("limit-set", "bank.limit_set", t("Эмулятор банка поставил лимит ниже покупки (С-26)", "The bank emulator set a limit below the purchase (С-26)")),
      clientSigns("cart"),
      {
        id: "declined",
        what: t("Платформа отказала: лимит клиента — конфликт, сторона клиент и банк, «так и должно быть» (С-26)", "Platform declined: client limit — conflict, client and bank side, works as intended (С-26)"),
        match: { stream: "monitor", ref: "operation.declined", source: ["pao_event"], code: "LIMIT_EXCEEDED", codeDetail: "CLIENT", kind: "conflict", side: ["client", "bank"], verdict: "expected", situation: "С-26" },
      },
      step("cart-signed", "cart.signed", t("Корзина подписана", "The cart is signed")),
      step("limit-declined", "limit.declined", t("Отказ: превышен лимит клиента в банке", "Declined: the client's bank limit exceeded")),
      step("limit-reset", "bank.limit_reset", t("Эмулятор банка снял лимит", "The bank emulator removed the limit")),
    ],
    forbid: [...COMMON_FORBID, ...NO_PAID],
  },
  {
    no: 4,
    name: "upk",
    title: t("4. Подтверждение человеком через УПК", "4. Human confirmation via UPK"),
    outcome: { kind: "confirmed_paid", text: t("Клиент подтвердил покупку выше порога; оплачено по событию Платформы", "The client confirmed the purchase above the threshold; paid per the Platform event") },
    statuses: { mandate: t("корзина подписана, покупка подтверждена", "cart signed, purchase confirmed"), operation: t("операция авторизована", "operation authorized"), ...ACTIVE },
    expect: [
      step("qty", "upk.qty", t("Сумма выше порога подтверждения", "The amount is above the confirmation threshold")),
      clientSigns("both"),
      // Сумма не дробится: один заказ и один реквизит на всю покупку (ревью К2.1 № 5).
      { id: "one-order", what: t("Один заказ на всю сумму — покупка не дробится", "One order for the whole amount — the purchase is not split"), match: { stream: "monitor", ref: "POST /v1/shops/{shop_id}/orders" }, times: 1 },
      { id: "one-credential", what: t("Один платёжный реквизит на покупку", "One payment credential for the purchase"), match: { stream: "monitor", ref: "POST /pao/v1/credentials" }, times: 1 },
      event("required", "confirmation.required", t("Платформа: нужно подтверждение человека", "Platform: human confirmation required"), { kind: "norm" }),
      step("upk-required", "upk.required", t("Банк просит клиента подтвердить на странице УПК", "The bank asks the client to confirm on the UPK page")),
      { id: "client-confirms", what: t("Подтверждает клиент на странице банка, не агент", "The client confirms on the bank page, not the agent"), match: { ...BY_BANK, ref: CONFIRM }, times: 1 },
      event("approved", "confirmation.approved", t("Платформа: клиент подтвердил покупку", "Platform: the client confirmed the purchase")),
      PAID_EVENT(1),
      { ...step("outcome", "outcome", t("Итог — после события Платформы «оплачено»: авторизовано", "Outcome — after the Platform “paid” event: authorized"), { status: "AUTHORIZED" }), after: "paid" },
    ],
    forbid: [...COMMON_FORBID, { id: "no-split", what: t("Попытки разбить покупку под порог нет", "No attempt to split the purchase below the threshold"), match: { code: "SPLIT_WINDOW" } }],
  },
  {
    no: 5,
    name: "revoke",
    title: t("5. Отзыв поручения — следующая попытка отклонена", "5. Mandate revocation — the next attempt is refused"),
    outcome: { kind: "stopped", text: t("Клиент отозвал поручение; агент остановил попытку сам — до витрин и оплаты", "The client revoked the mandate; the agent stopped the attempt itself — before shops and payment") },
    statuses: { mandate: t("поручение отозвано", "mandate revoked"), operation: t("операции нет", "no operation"), ...ACTIVE },
    expect: [
      step("ask", "revoke.ask", t("Сюжет просит клиента отозвать поручение в банке (С-28)", "The scenario asks the client to revoke the mandate in the bank (С-28)")),
      { id: "client-revokes", what: t("Отзывает клиент в банке", "The client revokes in the bank"), match: { ...BY_BANK, ref: REVOKE }, times: 1 },
      event("revoked-event", "mandate.revoked", t("Платформа: поручение отозвано (С-28)", "Platform: mandate revoked (С-28)"), { situation: "С-28" }),
      step("seen", "revoke.seen", t("Агент получил событие отзыва", "The agent received the revocation")),
      step("attempt", "revoke.attempt", t("Агент пробует покупку", "The agent tries a purchase")),
      step(
        "refused",
        "revoke.refused",
        t("Агент остановил попытку сам — конфликт, «так и должно быть» (С-28)", "The agent stopped the attempt itself — conflict, works as intended (С-28)"),
        { code: "MANDATE_REVOKED", kind: "conflict", verdict: "expected", situation: "С-28" },
      ),
    ],
    forbid: [
      ...COMMON_FORBID,
      ...NO_PAID,
      { id: "no-sign", what: t("Новых подписей нет: отзывается поручение сюжета 1", "No new signatures: the mandate of scenario 1 is revoked"), match: { stream: "monitor", ref: SIGN } },
      { id: "no-order", what: t("Заказа у витрин нет", "No order at shops"), match: { stream: "monitor", ref: "POST /v1/shops/{shop_id}/orders" } },
      { id: "no-credential", what: t("Реквизита под покупку агент не получал", "The agent did not obtain a payment credential"), match: { stream: "monitor", ref: "POST /pao/v1/credentials" } },
    ],
  },
];

/** Паспорта прогонов с монитора: первым ожиданием — метка начала `run.<имя>` (К2.3а, Р-1391). */
export const PASSPORTS: readonly Passport[] = RAW.map((p) => ({
  ...p,
  expect: [step("start", `run.${p.name}`, t(`Начат сюжет ${p.no} — метка прогона`, `Scenario ${p.no} started — run marker`), {}, 1), ...p.expect],
}));
