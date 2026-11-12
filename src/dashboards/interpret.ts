// Правила интерпретатора-квалификатора DEMO-2 ч. 1 (Р-1244 п. 4, Р-1245 п. 1, Р-1273 п. 5): запись шины → фраза простыми
// словами (ru/en) и квалификация — стадия, роль, тип (норма / конфликт / ошибка / фрод), «кто ошибся» по реестрам из
// снимка `/api/diag`, карточка ситуации С-xx. Чистые функции: факты — только из записи линии и снимка (Р-1245 п. 1),
// код агента и Платформы не импортируется (Р-1246 п. 3). Фразы — данные для `textContent` (инвариант 4).
// Таблицы читаются только по собственным ключам (`own`): имя из записи — данные, не ключ прототипа (ревью К1.3 Б1).
import type { DiagAction, DiagComponent, DiagEntryWire, DiagRegistryId, DiagSnapshot, DiagSource, DiagTexts, WireItem, WireLang, WireMoney, WireMonitorEvent } from "./wire.js";
import { WIRE_ID_KEYS } from "./wire.js";
import { CODE_WORDS, PHRASES, type Phrase } from "./phrases.js";

export const STAGES = ["mandate", "search", "cart", "payment", "confirmation", "outcome", "revoke", "service"] as const;
export type Stage = (typeof STAGES)[number];

/** Роли участников (Р-1244 п. 4); `network` — отправитель без признаков нашего агента. */
export const ROLES = ["client", "agent", "platform", "bank", "merchant", "network"] as const;
export type Role = (typeof ROLES)[number];

export const KINDS = ["norm", "conflict", "error", "fraud"] as const;
export type Kind = (typeof KINDS)[number];

/** «Так и должно быть» — правило сработало; «сбой» — у участника или среды что-то сломано; «неизвестно» — кода нет в
 *  реестрах; «решает владелец» — по линии не отличить умысел от дефекта (нарушение поручения агентом). */
export type Verdict = "expected" | "failure" | "unknown" | "owner";

export type Texts = Readonly<Record<WireLang, string>>;

export interface Who {
  readonly code: string;
  readonly codeDetail?: string;
  /** found — запись реестра есть; pending — отказала Платформа, а её реестр ждёт передачи (Р-1275 п. 1); unknown — нет. */
  readonly status: "found" | "pending" | "unknown";
  readonly registry?: DiagRegistryId;
  readonly component?: DiagComponent;
  readonly action?: DiagAction;
  /** Сторона: у кого причина (источники записи реестра или правило квалификации). */
  readonly side: readonly (DiagSource | "network")[];
  /** Текст для оператора из реестра; `en` нет в реестре — английский не выдумывается. */
  readonly operator?: DiagTexts;
  readonly verdict: Verdict;
}

export interface Interpretation {
  readonly seq: number;
  readonly at: string;
  readonly stream: WireItem["stream"];
  /** key — шаг сделки; detail — служебное обращение (экран может свернуть). */
  readonly level: "key" | "detail";
  readonly stage: Stage;
  readonly actor: Role;
  /** Действующая сторона на стенде — эмулятор (Р-1244 п. 4: эмуляторы помечены). */
  readonly emulated: boolean;
  readonly kind: Kind;
  readonly phrase: Texts;
  readonly who?: Who;
  /** Карточка библиотеки ситуаций `docs/reference/situations.md`. */
  readonly situation?: string;
  /** Конфликт или ошибка у витрины с учебным поведением стенда — «учебный сбой витрины», так задумано (З10, Р-1361). */
  readonly training?: true;
  /** Что это за запись у источника: шаблон обращения или тип события (`what`), шаг сюжета, тип записи журнала агента.
   *  Для контролёра (К2.2) — сверка с паспортом сюжета; экран не показывает. */
  readonly ref: string;
  /** Машинный статус шага сюжета, если он код: `params.status` (статус итога, `AUTHORIZED`), а если его нет — `params.reply`
   *  (ответ витрины, `PAID`). Шагов с обоими полями нет; появится такой — поле разделить. Для контролёра. */
  readonly status?: string;
  /** Кто прислал обращение на шине (только записи монитора): `agent_platform` — наш агент своим ключом, `stand` — участник
   *  стенда (эмулятор банка — действия клиента), `network_*` — без подписи агента, `pao_event` — событие Платформы.
   *  Участник (`actor`) ставится по маршруту; кто на самом деле прислал запрос клиента — только отсюда (ревью К2.1 № 1). */
  readonly source?: WireMonitorEvent["source"];
  /** Идентификаторы записи (П-1.2): по ним пульт собирает транзакцию. Нет идентификаторов — поля нет. */
  readonly ids?: TxIds;
  /** Код теста задания (`Н-NN`) у шага сюжета — из поля шага `test` (драйвер нарушителя «ПР»: `run.fault`, `fault.*`), не из
   *  текста фразы; другая форма не берётся (П-4.1а). */
  readonly test?: string;
  /** Код из поля шага `code` целиком, у шага с кодом теста (`test`): составной — через запятую (`PREP_FAILED,NO_RESPONSE`);
   *  каждая часть — по форме кода (П-4.1а, ревью № 2: в `who.code` — только первая часть). */
  readonly testCode?: string;
  /** Срок поручения (ISO) — только у шага `intent.created`, из поля `valid_to` (данные поручения ядра, П-11.5б окна Б);
   *  по нему пульт различает «вне пределов» и «срок» у отказа `MANDATE_OUT_OF_SCOPE` (П-5.1а, Р-1524, Р-1525, Р-1536).
   *  Другие шаги (`expiry.wait` — рассказ сюжета) признаком не служат. */
  readonly validTo?: string;
}

/** Ключи идентификаторов транзакции: ids линии и `intent_id` — поручение-намерение корзины (шаги `cart.created`, `cart.card`
 *  (Р-1506), `scope.refused`). */
export const TX_ID_KEYS = [...WIRE_ID_KEYS, "intent_id"] as const;
export type TxIds = Partial<Record<(typeof TX_ID_KEYS)[number], string>>;

export interface InterpretEnv {
  readonly snapshot: DiagSnapshot;
  /** Роли, которые у источника — эмуляторы. Локальный стенд: банк и продавцы (П2 п. 2). */
  readonly emulated: readonly Role[];
  /** Агент на линии — подставной (синтетика ч. 1, сюжет подставного агента ч. 3). Только тогда нарушение поручения — «фрод»;
   *  иначе — «фрод или дефект, вердикт — владелец»: честный агент с дефектом или гонка с отзывом (С-28) дают ту же запись. */
  readonly rogueAgent?: boolean;
  /** Учебные витрины источника: merchant_id → префиксы кодов их учебного сбоя (демо-стенд: по поведению витрины фикстуры).
   *  Конфликт или ошибка со стороной «продавец» с таким кодом — «учебный сбой витрины» (З10). Таблицу даёт сборка
   *  источника: интерпретатор код Платформы не импортирует (Р-1246 п. 3). */
  readonly training?: Readonly<Record<string, readonly string[]>>;
}

export const LOCAL_STAND_EMULATED: readonly Role[] = ["bank", "merchant"];

/** Значение таблицы только по собственному ключу. */
const own = <T>(map: Readonly<Record<string, T>>, key: string): T | undefined => (Object.hasOwn(map, key) ? map[key] : undefined);

const CODE_RE = /^[A-Z][A-Z0-9_]{0,63}$/;
/** Код теста задания: кириллическая «Н», дефис, две цифры (Н-01…Н-12; П-4.1а). */
const TEST_RE = /^Н-\d{2}$/;

// --- Правила квалификации по коду ---

/** Агент, который сам вышел за поручение, — его останавливает Платформа (Р-1255 п. 1, Р-1273 п. 5). Честный агент
 *  ловит эти случаи сам, до Платформы, — тогда это конфликт в журнале агента, не фрод. Только коды пределов и
 *  состояния поручения; дефекты повтора и подписи сюда не входят (ревью К1.3 № 3). */
const AGENT_OVERREACH = new Set([
  "MANDATE_REVOKED",
  "MANDATE_SCOPE",
  "MANDATE_EXPIRED",
  "DECLINED_MANDATE_REVOKED",
  "DECLINED_MANDATE_SCOPE",
  "DECLINED_MANDATE_EXPIRED",
]);
/** Запрос «я агент» без верной подписи или с неизвестным, отозванным ключом — от отправителя, который не наш агент (С-08). */
const IMPERSONATION = new Set(["SIGNATURE_INVALID", "AGENT_UNKNOWN", "KEY_UNKNOWN", "AGENT_UNIDENTIFIED", "AGENT_KEY_REVOKED", "KEY_REVOKED", "KEY_EXPIRED"]);
/** Коды передачи решения человеку (инвариант 3): это норма, не отказ. */
export const TO_HUMAN_CODES = new Set(["CONFIRMATION_REQUIRED", "CONFIRMATION_PENDING"]);
/** Коды сюжета демо-стенда (не реестров): агент не остановился после отзыва — ошибка агента (ревью К1.3 № 7). */
const SCENARIO_FAILURES: Readonly<Record<string, readonly DiagSource[]>> = {
  REVOKED_NOT_ENFORCED: ["agent"],
  // Сюжет 10: ядро дошло до выдачи по истёкшему поручению (ревью П-11.1д № 2).
  EXPIRED_NOT_ENFORCED: ["agent"],
};

/** Кто отказал: Платформа, продавец или сам агент (журнал агента). */
export type Origin = "platform" | "merchant" | "agent";
/** Кто прислал отказанный запрос: наш агент, отправитель без признаков нашего агента, или это событие самой Платформы. */
export type Sender = "agent" | "network" | "platform";

/** Карточка по коду и стороне отказа; где соответствие неочевидно — не ставится (ревью К1.3 № 11, № 12). */
function codeSituation(code: string, origin: Origin, codeDetail: string | undefined): string | undefined {
  if (code === "MANDATE_REVOKED" || code === "DECLINED_MANDATE_REVOKED") return "С-28";
  if (code === "LIMIT_EXCEEDED" && codeDetail === "CLIENT") return "С-26";
  if (code === "PACKAGE_AGENT_MISMATCH") return origin === "merchant" ? "С-07" : "С-15";
  if (code === "SPLIT_WINDOW") return "С-05";
  if (code === "AGENT_UNKNOWN" && origin === "platform") return "С-14";
  if (code === "REQUEST_INVALID") return origin === "platform" ? "С-16" : "С-13";
  return undefined;
}

/** Компоненты кодов, которые возвращает Платформа (ПАО, ПИ, сама Платформа). */
const PLATFORM_COMPONENTS: ReadonlySet<DiagComponent> = new Set(["pao", "pi", "platform"]);

/** Запись реестра: отказ Платформы — только коды ПАО/ПИ/Платформы из реестра агента; отказ продавца — только реестр
 *  продавца (ревью К1.3 № 5, № 6). Журнал агента пересказывает и свои отказы, и отказы продавца: реестр агента, затем
 *  реестр продавца — оба реестра у агента, это его журнал (повторное ревью К1.3 Б3). */
function lookup(snapshot: DiagSnapshot, code: string, origin: Origin): { entry: DiagEntryWire; registry: DiagRegistryId } | undefined {
  const order: readonly DiagRegistryId[] = origin === "merchant" ? ["merchant"] : origin === "platform" ? ["agent"] : ["agent", "merchant"];
  for (const id of order) {
    const r = snapshot.registries.find((x) => x.id === id && x.status === "ready");
    const entry = r?.entries.find((e) => e.code === code && (origin !== "platform" || PLATFORM_COMPONENTS.has(e.component)));
    if (entry) return { entry, registry: id };
  }
  return undefined;
}

/** Тип и вердикт по записи реестра (когда явного правила нет). */
function byRegistry(e: DiagEntryWire): { kind: Kind; verdict: Verdict } {
  if (e.action === "retry_same_key" || e.action === "after_fix" || e.action === "new_key" || e.source.includes("environment"))
    return { kind: "error", verdict: "failure" };
  return { kind: "conflict", verdict: "expected" };
}

/** Квалификация кода отказа. */
export function qualifyCode(
  env: InterpretEnv,
  code: string,
  o: { origin: Origin; sender: Sender; status?: number; codeDetail?: string },
): { kind: Kind; who: Who; situation?: string } {
  const found = lookup(env.snapshot, code, o.origin);
  const platformPending = env.snapshot.registries.some((r) => r.id === "platform" && r.status === "pending");
  const base = {
    code,
    ...(o.codeDetail !== undefined && { codeDetail: o.codeDetail }),
    ...(found
      ? { status: "found" as const, registry: found.registry, component: found.entry.component, action: found.entry.action, operator: found.entry.operator }
      : { status: o.origin === "platform" && platformPending ? ("pending" as const) : ("unknown" as const) }),
  };
  const situation = codeSituation(code, o.origin, o.codeDetail);
  const sit = situation !== undefined ? { situation } : {};

  // Фрод: попытку остановила другая сторона — «так и должно быть».
  if (o.origin === "platform" && o.sender === "agent" && AGENT_OVERREACH.has(code))
    return env.rogueAgent === true
      ? { kind: "fraud", who: { ...base, side: ["agent"], verdict: "expected" }, ...sit }
      : { kind: "error", who: { ...base, side: ["agent"], verdict: "owner" }, ...sit };
  if (o.sender === "network" && o.origin !== "agent" && IMPERSONATION.has(code))
    return { kind: "fraud", who: { ...base, side: ["network"], verdict: "expected" }, situation: "С-08" };
  const scenarioSide = own(SCENARIO_FAILURES, code);
  if (scenarioSide && !found) return { kind: "error", who: { ...base, side: scenarioSide, verdict: "failure" }, ...sit };
  // Сигнал A5 у предложения витрины: предложение исключено, покупка идёт дальше (Р-1244 п. 4).
  if (code.startsWith("A5_") && found) return { kind: "conflict", who: { ...base, side: found.entry.source, verdict: "expected" }, ...sit };
  if (found) {
    const q = byRegistry(found.entry);
    return { kind: q.kind, who: { ...base, side: found.entry.source, verdict: q.verdict }, ...sit };
  }
  return { kind: o.status !== undefined && o.status >= 500 ? "error" : "conflict", who: { ...base, side: [], verdict: "unknown" }, ...sit };
}

// --- Фразы ---

const fmt = (v: unknown, lang: WireLang): string => {
  if (typeof v === "string" || typeof v === "number") return String(v);
  if (typeof v === "object" && v !== null && "text" in v) return (v as WireMoney).text[lang];
  return "";
};

/** Подстановки, в которых приходят коды и статусы: в тексте человека — словами (З2). */
const CODE_PARAMS = new Set(["code", "codes", "reply", "status"]);

/** Код или список кодов через запятую — словами по словарю; кода нет в словаре — как есть. */
export function codeWords(v: string, lang: WireLang): string {
  return v
    .split(",")
    .map((c) => c.trim())
    .filter((c) => c !== "")
    .map((c) => own(CODE_WORDS, c)?.[lang] ?? c)
    .join(", ");
}

/** Подстановка `{ключ}`. Необязательная часть шаблона — в `[…]`: выпадает целиком, если подставить в ней нечего
 *  (сумма или код не пришли — ревью К1.3 № 9, № 10). Скобки разбираются в шаблоне до подстановки данных. */
function fill(p: Phrase, params: Readonly<Record<string, unknown>>): Texts {
  const value = (k: string, lang: WireLang) => {
    if (!Object.hasOwn(params, k)) return "";
    const v = params[k];
    return CODE_PARAMS.has(k) && typeof v === "string" ? codeWords(v, lang) : fmt(v, lang);
  };
  const one = (lang: WireLang) =>
    p[lang]
      .replace(/\[([^[\]]*)\]/g, (_, inner: string) => ([...inner.matchAll(/\{([a-z_]+)\}/g)].every((m) => value(m[1]!, lang) !== "") ? inner : ""))
      .replace(/\{([a-z_]+)\}/g, (_, k: string) => value(k, lang) || "—");
  return { ru: one("ru"), en: one("en") };
}

const fallback = (ru: string, en: string, what: string): Texts => ({ ru: `${ru}: ${what}`, en: `${en}: ${what}` });

// --- Записи монитора ---

interface MonitorRule {
  readonly stage: Stage;
  readonly actor: Role;
  readonly level: "key" | "detail";
  readonly situation?: string;
}

/** Обращения по шаблону `what` (те же шаблоны, что у шины демо-стенда). */
const CALLS: Readonly<Record<string, MonitorRule>> = {
  "POST /pao/v1/mandates": { stage: "mandate", actor: "agent", level: "key", situation: "С-01" },
  "GET /pao/v1/mandates/{mandate_id}": { stage: "mandate", actor: "agent", level: "detail" },
  "GET /pao/v1/mandates/{mandate_id}/verify": { stage: "cart", actor: "agent", level: "detail" },
  "POST /pao/v1/mandates/{mandate_id}/relinquish": { stage: "cart", actor: "agent", level: "detail" },
  "POST /participants/v1/mandates/{mandate_id}/sign": { stage: "mandate", actor: "client", level: "key" },
  "POST /participants/v1/mandates/{mandate_id}/revoke": { stage: "revoke", actor: "client", level: "key", situation: "С-28" },
  "PUT /participants/v1/principals/{principal_ref}/limits": { stage: "payment", actor: "bank", level: "key", situation: "С-26" },
  "GET /pao/v1/merchants/{merchant_id}/readiness": { stage: "search", actor: "agent", level: "detail" },
  "GET /v1/shops": { stage: "search", actor: "agent", level: "detail" },
  "GET /v1/shops/{shop_id}/catalog": { stage: "search", actor: "agent", level: "detail" },
  "POST /v1/shops/{shop_id}/orders": { stage: "payment", actor: "agent", level: "key" },
  "POST /pao/v1/credentials": { stage: "payment", actor: "agent", level: "key" },
  "POST /adp/v1/decide": { stage: "payment", actor: "platform", level: "key" },
  "POST /adp/v1/events": { stage: "payment", actor: "platform", level: "detail" },
  "POST /participants/v1/merchants/{merchant_id}/payments": { stage: "payment", actor: "merchant", level: "detail" },
  "POST /v1/shops/{shop_id}/orders/{order_id}/payment": { stage: "payment", actor: "agent", level: "key" },
  "POST /v1/shops/{shop_id}/orders/{order_id}/confirmation": { stage: "confirmation", actor: "agent", level: "detail" },
  "GET /pao/v1/confirmations/{confirmation_id}": { stage: "confirmation", actor: "agent", level: "detail" },
  "POST /participants/v1/confirmations/{confirmation_id}": { stage: "confirmation", actor: "client", level: "key" },
  "GET /pao/v1/operations/{op_ref}": { stage: "outcome", actor: "agent", level: "detail" },
};

/** События ленты ПАО — только с источником `pao_event` (инвариант 6: «оплачено» — только по событию Платформы). */
const EVENTS: Readonly<Record<string, MonitorRule>> = {
  "mandate.signed": { stage: "mandate", actor: "platform", level: "key" },
  "mandate.rejected": { stage: "mandate", actor: "platform", level: "key" },
  "mandate.revoked": { stage: "revoke", actor: "platform", level: "key", situation: "С-28" },
  "mandate.exhausted": { stage: "outcome", actor: "platform", level: "key" },
  "confirmation.required": { stage: "confirmation", actor: "platform", level: "key" },
  "confirmation.approved": { stage: "confirmation", actor: "platform", level: "key" },
  "confirmation.rejected": { stage: "confirmation", actor: "platform", level: "key" },
  "confirmation.expired": { stage: "confirmation", actor: "platform", level: "key" },
  "operation.authorized": { stage: "outcome", actor: "platform", level: "key", situation: "С-27" },
  "operation.declined": { stage: "outcome", actor: "platform", level: "key" },
  "operation.settled": { stage: "outcome", actor: "platform", level: "key" },
  "operation.refunded": { stage: "outcome", actor: "platform", level: "key" },
  // Статус допуска агента (РП54, сюжет 9): служебная стадия — не стадия покупки.
  "agent.suspended": { stage: "service", actor: "platform", level: "key" },
  "agent.reinstated": { stage: "service", actor: "platform", level: "key" },
};

/** Событие ленты ПАО — отказ (норма у остальных); код — если пришёл. */
const DECLINE_EVENTS = new Set(["mandate.rejected", "confirmation.rejected", "confirmation.expired", "operation.declined"]);

function interpretMonitor(item: Extract<WireItem, { stream: "monitor" }>, env: InterpretEnv): Interpretation {
  const e = item.event;
  const isEvent = e.source === "pao_event";
  const rule = isEvent ? own(EVENTS, e.what) : own(CALLS, e.what);
  const fromAgent = e.source === "agent_platform" || e.source === "agent_platform_open" || e.source === "agent_merchant";
  const fromNetwork = e.source === "network_platform" || e.source === "network_merchant";
  const toMerchant = e.source === "agent_merchant" || e.source === "network_merchant";
  const sender: Sender = fromAgent ? "agent" : fromNetwork ? "network" : "platform";
  const actor: Role = fromNetwork ? "network" : rule?.actor ?? (fromAgent ? "agent" : "platform");
  const p = rule ? own(PHRASES.monitor, e.what) : undefined;
  const params = { ...e.ids, amount: e.amount, code: e.code ?? "" };
  let phrase = p ? fill(p, params) : isEvent ? fallback("Событие Платформы", "Platform event", e.what) : fallback("Обращение", "Call", e.what);
  let kind: Kind = "norm";
  let who: Who | undefined;
  let situation = rule?.situation;

  const failed = (e.status !== undefined && e.status >= 400) || e.cls === "decline" || (isEvent && DECLINE_EVENTS.has(e.what));
  if (e.code !== undefined && TO_HUMAN_CODES.has(e.code)) {
    // Передача решения человеку (инвариант 3) — норма.
    phrase = fill(PHRASES.toHuman, params);
  } else if (e.code !== undefined && failed) {
    const q = qualifyCode(env, e.code, {
      origin: toMerchant ? "merchant" : "platform",
      sender,
      ...(e.status !== undefined && { status: e.status }),
      ...(e.codeDetail !== undefined && { codeDetail: e.codeDetail }),
    });
    kind = q.kind;
    who = q.who;
    situation = q.situation ?? situation;
    if (kind === "fraud") phrase = fill(who.side.includes("network") ? PHRASES.fraud.network : PHRASES.fraud.agent, params);
    else if (who.verdict === "owner") phrase = fill(PHRASES.overreach, params);
    else if (e.code === "LIMIT_EXCEEDED" && e.codeDetail === "CLIENT") phrase = fill(PHRASES.limitClient, params);
  } else if (failed) {
    // Отказ без кода (на локальном стенде operation.declined кода может не нести — П2, дополнение 2): «кто ошибся» не заполняется.
    kind = e.status !== undefined && e.status >= 500 ? "error" : "conflict";
  }
  return {
    seq: e.seq,
    at: e.at,
    stream: "monitor",
    ref: e.what,
    source: e.source,
    level: kind === "norm" ? rule?.level ?? "detail" : "key",
    stage: rule?.stage ?? "service",
    actor,
    emulated: env.emulated.includes(actor),
    kind,
    phrase,
    ...(who && { who }),
    ...(situation !== undefined && { situation }),
  };
}

// --- Шаги сюжета ---

const STEP_STAGE: Readonly<Record<string, Stage>> = {
  intent: "mandate",
  purchase: "search",
  search: "search",
  cart: "cart",
  order: "payment",
  payment: "payment",
  outcome: "outcome",
  bank: "payment",
  limit: "outcome",
  upk: "confirmation",
  notice: "confirmation",
  revoke: "revoke",
  reject: "cart",
  unconfirmed: "confirmation",
  scope: "cart",
  // Сюжет 9: действия оператора Системы и возобновление агента — служебная стадия; остановка покупки — по state ядра.
  operator: "service",
  suspend: "service",
  // Сюжет 10: ожидание срока поручения — стадия поручения; остановка — по state ядра.
  expiry: "mandate",
  // Драйвер нарушителя «ПР» (П7): служебная стадия — нарушение не стадия покупки эталонного агента.
  fault: "service",
  // Эмулятор клиента «Авто» (П5, доп. 1): пометка действия за клиента; сам факт (подпись, решение) — запись стенда.
  client: "service",
  // Сбой стенда «П», взведённый человеком (П-11.2б): настройка стенда, не стадия покупки.
  stand_fault: "service",
  failed: "outcome",
  aborted: "service",
};
const STEP_ACTOR: Readonly<Record<string, Role>> = {
  "intent.signed": "client",
  "cart.agreed": "client",
  "cart.declined": "client",
  "cart.signed": "client",
  "order.shop_reply": "merchant",
  "bank.limit_set": "bank",
  "bank.limit_reset": "bank",
  "bank.limit_reset_failed": "bank",
  "upk.required": "bank",
  "limit.declined": "platform",
  outcome: "platform",
  "revoke.ask": "client",
  "reject.ask": "client",
  "reject.signed": "client",
  "unconfirmed.ask": "client",
  // Оператор Системы — сторона Платформы (эмулятор стенда).
  "operator.suspended": "platform",
  "operator.reinstated": "platform",
  "operator.reinstate_failed": "platform",
  "suspend.by_platform": "platform",
};
const STEP_SITUATION: Readonly<Record<string, string>> = {
  "intent.created": "С-01",
  "intent.awaiting_signature": "С-01",
  "cart.card": "С-25",
  "cart.agreed": "С-25",
  "cart.declined": "С-25",
  "order.shop_reply": "С-27",
  outcome: "С-27",
  "bank.limit_set": "С-26",
  "bank.limit_reset": "С-26",
  "bank.limit_reset_failed": "С-26",
  "limit.declined": "С-26",
  "revoke.ask": "С-28",
  "revoke.seen": "С-28",
  "revoke.attempt": "С-28",
  "revoke.refused": "С-28",
};

/** Шаги остановки покупки ядром: стадия — по стадии конвейера (state), STOPPED — «Итог», а не стадия, где шаг возник
 *  (ревью П-11.1б № 3: остановленная покупка не остаётся в «Подтверждении» или «Корзине»). */
/** Шаги остановки сюжета. Второй потребитель — R26 пульта (`src/pult/engine.ts`, Р-1537): шаг, добавленный сюда не как
 *  остановка, изменит и R26. */
export const STOP_STEPS: ReadonlySet<string> = new Set(["failed", "cart.rejected", "upk.declined", "scope.refused", "suspend.stopped", "expiry.refused"]);

function interpretScenario(item: Extract<WireItem, { stream: "scenario" }>, env: InterpretEnv): Interpretation {
  const l = item.line;
  const head = l.step.split(".")[0]!;
  // Шаги эмулятора клиента «Авто» (П5, доп. 1) — действия за клиента: участник — клиент, всегда эмулированный. Код в таком шаге
  // (отказ банка или сбой самого эмулятора — CLIENT_CALL_FAILED, CART_ANSWER_FAILED, NOT_AWAITING) — не ошибка агента и
  // квалификации не получает. Признак — имя шага: параметр `source: "client-emulator"` есть на шине, но линия дашбордов его не
  // несёт (WIRE_SCENARIO_PARAMS), поэтому префикс `client.` закреплён за эмулятором — шагов сюжета с ним нет.
  const byEmulator = head === "client";
  // Сбой стенда «П» человеком (П-11.2б) — не действие агента: участник — Платформа (эмулятор), потому что стенд сам называет
  // сбои своего перечня «сбоем Платформы» (РП75 п. 3, `dist/stand/demo.js`); образец — шаги оператора Системы `operator.*`.
  const byStand = head === "stand_fault";
  const actor = byEmulator ? "client" : byStand ? "platform" : own(STEP_ACTOR, l.step) ?? "agent";
  const p = own(PHRASES.scenario, l.step);
  const phrase = p ? fill(p, l.params) : fallback("Шаг сюжета", "Scenario step", l.step);
  let kind: Kind = "norm";
  let who: Who | undefined;
  let situation = own(STEP_SITUATION, l.step);
  // Коды шага: отказ, который агент получил от Платформы или поймал сам (сюжет пересказывает ядро агента), и сигналы A5.
  const codes = [l.params.code, l.params.codes].filter((c): c is string => typeof c === "string").flatMap((c) => c.split(","));
  const code = codes.find((c) => CODE_RE.test(c) && !TO_HUMAN_CODES.has(c));
  if (code !== undefined && !byEmulator) {
    // Отказ Платформы (лимит) и сбой эмулятора оператора Системы (сюжет 9) — не агента (ревью П-11.1г № 8).
    const platform = l.step === "limit.declined" || head === "operator";
    const q = qualifyCode(env, code, { origin: platform ? "platform" : "agent", sender: platform ? "platform" : "agent" });
    kind = q.kind;
    who = q.who;
    situation = q.situation ?? situation;
  }
  // Действие эмулятора не прошло — «конфликт» без нарушителя (вердикта «агент» нет), чтобы сбой не выглядел нормой (ревью
  // П-11.4б № 6). Паспорт 1 («Конфликтов нет») такой прогон не примет; в паспортах 2–10 — только косвенно, по недостающим
  // шагам: общий запрет «действие эмулятора не прошло» — П-11.5 окна А.
  if (byEmulator && l.step.endsWith("_failed")) kind = "conflict";
  const raw = typeof l.params.status === "string" ? l.params.status : typeof l.params.reply === "string" ? l.params.reply : undefined;
  const test = typeof l.params.test === "string" && TEST_RE.test(l.params.test) ? l.params.test : undefined;
  const testCode = test !== undefined && typeof l.params.code === "string" && l.params.code.split(",").every((c) => CODE_RE.test(c)) ? l.params.code : undefined;
  const vt = l.step === "intent.created" ? l.params.valid_to : undefined;
  const validTo = typeof vt === "object" && vt !== null && "iso" in vt && typeof vt.iso === "string" && Number.isFinite(Date.parse(vt.iso)) ? new Date(vt.iso).toISOString() : undefined;
  return {
    ...(test !== undefined && { test }),
    ...(testCode !== undefined && { testCode }),
    ...(validTo !== undefined && { validTo }),
    seq: l.seq,
    at: l.at,
    stream: "scenario",
    ref: l.step,
    ...(raw !== undefined && CODE_RE.test(raw) && { status: raw }),
    level: "key",
    // Шаг «сюжет не дошёл до конца» — на стадии, где остановился конвейер (state), иначе «Итог» (повторное ревью № 16).
    stage: (STOP_STEPS.has(l.step) && typeof l.params.state === "string" ? own(PURCHASE_STAGE, l.params.state) : undefined) ?? own(STEP_STAGE, head) ?? "service",
    actor,
    emulated: byEmulator || byStand || env.emulated.includes(actor),
    kind,
    phrase,
    ...(who && { who }),
    ...(situation !== undefined && { situation }),
  };
}

// --- Журнал агента (консоль) ---

const CONSOLE_STAGE: Readonly<Record<string, Stage>> = {
  "offer.flagged": "search",
  "offer.excluded": "search",
  "shop.call": "search",
  "shop.readiness": "search",
  "operation.status": "outcome",
  "confirmation.status": "confirmation",
  "confirmation.unclaimed": "confirmation",
  "cart.relinquish_skipped": "cart",
  "mandate.revoked": "revoke",
  "agent.refused": "mandate",
  "purchase.unfinished": "outcome",
};

/** Стадия конвейера покупки ядра агента (`purchase.stage`, поле detail) → стадия экрана. */
const PURCHASE_STAGE: Readonly<Record<string, Stage>> = {
  INTENT_PENDING: "mandate",
  INTENT_ACTIVE: "mandate",
  SEARCH: "search",
  OFFERS: "search",
  CART_PENDING: "cart",
  CART_ACTIVE: "cart",
  ORDERED: "payment",
  AUTHORIZING: "payment",
  CONFIRMING: "confirmation",
  SETTLING: "outcome",
  STOPPED: "outcome",
};

/** Записи журнала, которые — шаг сделки (остальные — служебные). */
const CONSOLE_KEY = new Set(["offer.flagged", "offer.excluded", "agent.refused", "purchase.unfinished", "mandate.revoked"]);

function interpretConsole(item: Extract<WireItem, { stream: "console" }>, env: InterpretEnv): Interpretation {
  const l = item.line;
  const p = own(PHRASES.console, l.kind);
  const code = l.reason !== undefined && CODE_RE.test(l.reason) ? l.reason : undefined;
  let phrase = p ? fill(p, { ...l, code: code ?? "" }) : fallback("Журнал агента", "Agent journal", l.kind);
  let kind: Kind = "norm";
  let who: Who | undefined;
  let situation: string | undefined;
  if (code !== undefined && !TO_HUMAN_CODES.has(code)) {
    // Причина обращения к витрине — код продавца (реестр продавца); остальное — реестр агента (ревью К1.3 № 6).
    const q = qualifyCode(env, code, { origin: l.kind.startsWith("shop.") ? "merchant" : "agent", sender: "agent" });
    kind = q.kind;
    who = q.who;
    situation = q.situation;
    if (p === undefined) phrase = fill(PHRASES.agentReason, { code });
    else if (l.kind === "purchase.stage") phrase = fill(PHRASES.agentStopped, { code });
  }
  const stage = l.kind === "purchase.stage" ? own(PURCHASE_STAGE, l.detail ?? "") ?? "service" : own(CONSOLE_STAGE, l.kind) ?? "service";
  return {
    seq: l.seq,
    at: l.at,
    stream: "console",
    ref: l.kind,
    level: CONSOLE_KEY.has(l.kind) || kind !== "norm" ? "key" : "detail",
    stage,
    actor: "agent",
    emulated: env.emulated.includes("agent"),
    kind,
    phrase,
    ...(who && { who }),
    ...(situation !== undefined && { situation }),
  };
}

/** Запись линии → интерпретация. Не бросает на записи, прошедшей `parseWireItem`: незнакомая — нейтральная фраза с её именем. */
export function interpret(item: WireItem, env: InterpretEnv): Interpretation {
  const base = item.stream === "monitor" ? interpretMonitor(item, env) : item.stream === "scenario" ? interpretScenario(item, env) : interpretConsole(item, env);
  const ids = idsOf(item);
  const r = Object.keys(ids).length > 0 ? { ...base, ids } : base;
  return isTraining(r, merchantOf(item), env) ? { ...r, training: true } : r;
}

/** Идентификаторы записи — для модели транзакций пульта (П-1.2, Р-1442): транзакция собирается по ним, а не по времени
 *  (Р-1396 п. 2). Обращение и событие — ids линии; шаг сюжета — параметры-идентификаторы (`intent_id` — поручение-намерение
 *  у шагов `cart.created`, `cart.card` и `scope.refused`); журнал агента — поручение, витрина и операция (`operation.status`). Только идентификаторы. */
function idsOf(item: WireItem): TxIds {
  if (item.stream === "monitor") return { ...item.event.ids };
  const out: Record<string, string> = {};
  if (item.stream === "scenario") {
    for (const k of TX_ID_KEYS) {
      const v = item.line.params[k];
      if (typeof v === "string" && v !== "") out[k] = v;
    }
    return out;
  }
  const l = item.line;
  if (l.mandate) out.mandate_id = l.mandate;
  if (l.merchant) out.merchant_id = l.merchant;
  if (l.kind === "operation.status" && l.ref) out.op_ref = l.ref;
  return out;
}

/** Продавец записи: идентификатор из обращения или события, из журнала агента, из шага сюжета. */
function merchantOf(item: WireItem): string | undefined {
  if (item.stream === "monitor") return item.event.ids.merchant_id;
  if (item.stream === "console") return item.line.merchant;
  const m = item.line.params.merchant_id;
  return typeof m === "string" ? m : undefined;
}

/** Учебный сбой витрины: конфликт или ошибка со стороной «продавец» с кодом учебного поведения этой витрины (З10).
 *  Нормальные записи и другие сбои той же витрины не помечаются: настоящий сбой не прячется за «так задумано». */
function isTraining(r: Interpretation, merchant: string | undefined, env: InterpretEnv): boolean {
  if (merchant === undefined || env.training === undefined || (r.kind !== "conflict" && r.kind !== "error")) return false;
  const who = r.who;
  if (!who || !who.side.includes("merchant")) return false;
  const codes = own(env.training, merchant);
  return codes !== undefined && codes.some((c) => who.code.startsWith(c));
}

/** Подписи ролей, типов, стадий и вердиктов для экранов. */
export { LABELS } from "./phrases.js";
