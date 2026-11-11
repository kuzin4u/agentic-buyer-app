// Справочник 89 правил пульта DEMO-2 (П-3.1; П6 и П6 дополнение 1; Р-1426 В4).
// Источник — модель пульта 1.23 (https://claude.ai/artifact/SATr8uc54yZhf2BBYT1c6Q, версия 1794075570-0309, 06.11.2026):
//   `R89` (89 правил: группа, формулировка, кто обеспечивает, как проверить, контроль, уязвимость × критичность, зона,
//   почему уязвимо / критично, условия, покрытие, узел, сектор), `OWN89` (обязанность), `KIND89` (вид), `PT89` (точка
//   контроля), `SAFE89`, `PARTS`, точки Т1–Т9, `GRP89` / `gn` (группы), `COND` (47 условий; перенесены коды всех и тексты
//   18 проверяемых), `GRP` (группы условий), `NODES` (узлы У1–У5), `SECTS` (сектора), `JOINTS` (стыки J0–J3 и 13 гарантий).
// Перенесено данными без изменений, кроме: (1) коды значений — английские (зона, участник, вид, контроль, покрытие,
// сектор), подписи — ru/en; идентификаторы модели (А01, R08, Т1, У1, J0, g0a) — как в модели; (2) в R21 убрано
// «(30 с)» — срок подтверждения на стенде свой (параметр стенда), а не модели; (3) `sc` не хранится — это `v × c` у всех
// 89 правил модели (`score`); (4) `model` (заметка модели о собственном покрытии) не перенесено — пульт показывает статус
// на стенде (П-3.2), а не покрытие модели; (5) тексты 29 непроверяемых условий `COND` (R01…R07, R10…R16, R19, R22, R24,
// R29, R33…R36, R38…R40, R42…R45) не перенесены — у правил, узлов и секторов они видны кодом; тексты — после MVP, вместе
// с проверкой 68 правил (п. 7 списка «после MVP», STATUS «Открыто»); (6) участник `platform` подписан, как в `PARTS`
// модели, — «Платёжная система», а в текстах правил — «Платформа».
// en (П6 доп. 1): у 21 правила, связанного с 18 проверяемыми условиями, у текстов 18 условий и у 13 гарантий; у
// остальных 68 правил en нет — экран показывает ru с пометкой «en — после MVP». Пределы и решения здесь не считаются
// (инвариант 2): справочник — только данные.
import type { Phrase } from "./phrases.js";

const p = (ru: string, en: string): Phrase => ({ ru, en });

/** 18 проверяемых условий — условия 25 тестов задания (П6 п. 2, план PR #9). */
export const CHECKABLE_CONDITIONS = [
  "R08", "R09", "R17", "R18", "R20", "R21", "R23", "R25", "R26",
  "R27", "R28", "R30", "R31", "R32", "R37", "R41", "R46", "R47",
] as const;
export type CheckableCondition = (typeof CHECKABLE_CONDITIONS)[number];

/** Коды всех условий модели 1.23 (`COND`: R01…R45 и R46, R47; тексты — только у 18 проверяемых, шапка п. 5) — на них
 *  ссылаются правила (`conds`), узлы и сектора; тип — точный (ревью П-3.1 № 7): опечатку в коде условия ловит `tsc`. */
export const CONDITION_IDS = [
  "R01", "R02", "R03", "R04", "R05", "R06", "R07", "R08", "R09", "R10", "R11", "R12", "R13", "R14", "R15", "R16",
  "R17", "R18", "R19", "R20", "R21", "R22", "R23", "R24", "R25", "R26", "R27", "R28", "R29", "R30", "R31", "R32",
  "R33", "R34", "R35", "R36", "R37", "R38", "R39", "R40", "R41", "R42", "R43", "R44", "R45", "R46", "R47",
] as const;
export type ConditionId = (typeof CONDITION_IDS)[number];

export const ZONES = ["red", "orange", "yellow", "background"] as const;
export type Zone = (typeof ZONES)[number];
export const ZONE_LABEL: Readonly<Record<Zone, Phrase>> = {
  red: p("красная", "red"),
  orange: p("оранжевая", "orange"),
  yellow: p("жёлтая", "yellow"),
  background: p("фон", "background"),
};

/** Участники модели (`PARTS`): обязанность правила и концы точек контроля. */
export const PARTIES = ["client", "agent", "merchant", "bank", "platform", "operator"] as const;
export type Party = (typeof PARTIES)[number];
export const PARTY_LABEL: Readonly<Record<Party, Phrase>> = {
  client: p("Клиенты", "Clients"),
  agent: p("Агенты", "Agents"),
  merchant: p("Магазины", "Merchants"),
  bank: p("Банки", "Banks"),
  platform: p("Платёжная система", "Payment system"),
  operator: p("Оператор", "Operator"),
};

export type RuleKind = "prep" | "action";
export const KIND_LABEL: Readonly<Record<RuleKind, Phrase>> = {
  prep: p("подготовка", "preparation"),
  action: p("действие", "action"),
};

/** Контроль модели: «У» — упреждается, «В» — выявляется. */
export type Control = "prevent" | "detect";
export const CONTROL_LABEL: Readonly<Record<Control, Phrase>> = {
  prevent: p("упреждается", "prevented"),
  detect: p("выявляется", "detected"),
};

/** Покрытие правила в самой модели 1.23 (не статус на стенде — его даёт движок условий П-3.2). */
export type Coverage = "yes" | "partial" | "no" | "outside";
export const COVERAGE_LABEL: Readonly<Record<Coverage, Phrase>> = {
  yes: p("в модели проверяется", "checked in the model"),
  partial: p("в модели — частично", "partly checked in the model"),
  no: p("в модели не проверяется", "not checked in the model"),
  outside: p("вне стенда — банк или процессы разработки", "outside the stand — bank or development processes"),
};

/** Группы правил (буквы модели, названия — `gn` правил `R89`). */
export const RULE_GROUPS = {
  А: p("Участники и допуск (стык 0)", "Participants and admission (joint 0)"),
  Б: p("Поручение", "Mandate"),
  В: p("Подбор предложения", "Offer selection"),
  Г: p("Корзина и согласие (стык 1)", "Cart and consent (joint 1)"),
  Д: p("Подтверждение клиентом", "Client confirmation"),
  Е: p("Авторизация и реквизит", "Authorization and credential"),
  Ж: p("Оплата у продавца", "Payment at the merchant"),
  З: p("Итог операции", "Operation outcome"),
  И: p("Исполнение и расчёты (стык 2)", "Fulfilment and settlement (joint 2)"),
  К: p("Отмены, возвраты, споры", "Cancellations, refunds, disputes"),
  Л: p("Отзыв, приостановка, срок во время операции (стык 3)", "Revocation, suspension, expiry during an operation (joint 3)"),
  М: p("Защита данных и безопасность", "Data protection and security"),
  Н: p("Журналы и доказательность", "Logs and evidence"),
  О: p("Устойчивость и порядок событий", "Resilience and event order"),
  П: p("Антифрод и ПОД/ФТ", "Anti-fraud and AML/CFT"),
  Р: p("Информирование клиента", "Client information"),
} as const satisfies Readonly<Record<string, Phrase>>;
export type RuleGroup = keyof typeof RULE_GROUPS;

/** Точки контроля Т1–Т9 модели: между кем и что проходит. `all` — «все» (итог Платформы). */
export const POINTS = {
  Т1: { a: "client", b: "bank", name: p("Клиент ↔ Банк", "Client ↔ Bank"), what: p("экран поручения, страница УПК, уведомления", "mandate screen, bank confirmation page, notifications") },
  Т2: { a: "client", b: "agent", name: p("Клиент ↔ Агент", "Client ↔ Agent"), what: p("корзина и согласие, сообщение итога", "cart and consent, outcome message") },
  Т3: { a: "agent", b: "platform", name: p("Агент ↔ Платформа (шлюз ПАО)", "Agent ↔ Platform (agent gateway, PAO)"), what: p("допуск, поручение, реквизит, отказы, повторы", "admission, mandate, credential, declines, repeats") },
  Т4: { a: "agent", b: "merchant", name: p("Агент ↔ Магазин", "Agent ↔ Merchant"), what: p("витрины, подбор, оплата, ответ продавца", "storefronts, selection, payment, merchant reply") },
  Т5: { a: "platform", b: "bank", name: p("Платформа ↔ Банк", "Platform ↔ Bank"), what: p("подтверждение, реквизит, лимит, расчёт", "confirmation, credential, limit, settlement") },
  Т6: { a: "platform", b: "all", name: p("Платформа → все (итог)", "Platform → everyone (outcome)"), what: p("подписанный итог, статус поручения", "signed outcome, mandate status") },
  Т7: { a: "merchant", b: "client", name: p("Магазин → Клиент", "Merchant → Client"), what: p("исполнение заказа, чек, возврат", "order fulfilment, receipt, refund") },
  Т8: { a: "platform", b: "operator", name: p("Шина → пульт", "Bus → console"), what: p("что и в каком порядке видит оператор", "what the operator sees and in what order") },
  Т9: { a: "operator", b: "platform", name: p("Оператор → система", "Operator → system"), what: p("реакции, вердикты, журнал", "reactions, verdicts, log") },
} as const satisfies Readonly<Record<string, { a: Party; b: Party | "all"; name: Phrase; what: Phrase }>>;
export type Point = keyof typeof POINTS;

/** Реакция на нарушение условия или узла в модели: остановить, на разбор, напомнить, повторить уведомление. */
export type Reaction = "stop" | "review" | "remind" | "notify";

/** Красные узлы У1–У5 модели (`NODES`): условия, реакция, признак. */
export const NODES = {
  У1: { name: p("Данные продавца", "Merchant data"), conds: ["R14", "R47"], act: "stop", sign: p("сигналы A5 и ловушки в карточках", "A5 signals and traps in cards") },
  У2: { name: p("Повтор = двойное списание", "Repeat = double debit"), conds: ["R23", "R25", "R46"], act: "stop", sign: p("повтор запроса по операции", "a repeated request for an operation") },
  У3: { name: p("Итог — только от Платформы", "Outcome — only from the Platform"), conds: ["R27", "R28", "R30", "R32"], act: "review", sign: p("реквизит выдан, итога нет", "credential issued, no outcome") },
  У4: { name: p("Порядок и поздние события", "Order and late events"), conds: ["R31"], act: "review", sign: p("итог задерживается", "the outcome is delayed") },
  У5: { name: p("Отзыв во время покупки", "Revocation during a purchase"), conds: ["R09", "R37", "R38"], act: "stop", sign: p("поручение отозвано или истекло, покупки идут", "mandate revoked or expired, purchases go on") },
} as const satisfies Readonly<Record<string, { name: Phrase; conds: readonly ConditionId[]; act: Reaction; sign: Phrase }>>;
export type NodeId = keyof typeof NODES;

/** Сектора «Приоритета» модели (`SECTS`); «Гонки и устойчивость» в модели без условий. */
export const SECTORS = {
  mandate: { name: p("Поручение и его границы", "Mandate and its limits"), conds: ["R08", "R10", "R11"] },
  cart: { name: p("Корзина и согласие", "Cart and consent"), conds: ["R17", "R18"] },
  confirmation: { name: p("Подтверждение клиентом", "Client confirmation"), conds: ["R19", "R21"] },
  credential: { name: p("Реквизит и оплата", "Credential and payment"), conds: ["R22", "R24", "R26"] },
  outcome: { name: p("Итог и после операции", "Outcome and after the operation"), conds: ["R33", "R35", "R43"] },
  access: { name: p("Агент и доступ", "Agent and access"), conds: ["R04", "R05", "R40"] },
  races: { name: p("Гонки и устойчивость", "Races and resilience"), conds: [] },
  antifraud: { name: p("Антифрод", "Anti-fraud"), conds: ["R13", "R42"] },
} as const satisfies Readonly<Record<string, { name: Phrase; conds: readonly ConditionId[] }>>;
export type Sector = keyof typeof SECTORS;

/** Тексты правила: формулировка, кто обеспечивает, как проверить, почему уязвимо, почему критично. */
export interface RuleText {
  readonly rule: string;
  readonly who: string;
  readonly evidence: string;
  readonly whyVuln: string;
  readonly whyCrit: string;
}

export interface Rule89 {
  readonly id: string;
  readonly group: RuleGroup;
  readonly zone: Zone;
  /** Уязвимость и критичность модели, 1–3. */
  readonly v: number;
  readonly c: number;
  readonly owner: Party;
  readonly owner2?: Party;
  readonly kind: RuleKind;
  readonly point: Point;
  readonly coverage: Coverage;
  readonly control: Control;
  /** Условия модели, которыми правило проверяется (`R`). */
  readonly conds: readonly ConditionId[];
  readonly node?: NodeId;
  readonly sector?: Sector;
  /** Правило защиты (`SAFE89`): на «Приоритете» — вместе с красной зоной. */
  readonly safe: boolean;
  readonly ru: RuleText;
  /** Только у правил с проверяемым условием (П6 доп. 1); у остальных — «en — после MVP». */
  readonly en?: RuleText;
}

/** Балл модели `sc` = уязвимость × критичность. */
export const score = (r: Rule89): number => r.v * r.c;

/** Правило проверяемое на стенде, если среди его условий есть одно из 18 (П6 доп. 1). */
export const isCheckable = (r: Pick<Rule89, "conds">): boolean =>
  r.conds.some((c) => (CHECKABLE_CONDITIONS as readonly string[]).includes(c));

const SAFE = new Set(["А04", "Д04", "М01", "Н02"]);
type T = readonly [rule: string, who: string, evidence: string, whyVuln: string, whyCrit: string];
const text = ([rule, who, evidence, whyVuln, whyCrit]: T): RuleText => ({ rule, who, evidence, whyVuln, whyCrit });

/** Строка правила в порядке полей модели: id, группа, зона, v, c, обязанность, обязанность 2, вид, точка, покрытие, контроль,
 *  условия, узел, сектор, тексты ru, тексты en. */
function rule(
  id: string, group: RuleGroup, zone: Zone, v: number, c: number, owner: Party, owner2: Party | null, kind: RuleKind,
  point: Point, coverage: Coverage, control: Control, conds: readonly ConditionId[], node: NodeId | null, sector: Sector | null,
  ru: T, en?: T,
): Rule89 {
  return {
    id, group, zone, v, c, owner,
    ...(owner2 !== null && { owner2 }),
    kind, point, coverage, control, conds,
    ...(node !== null && { node }),
    ...(sector !== null && { sector }),
    safe: SAFE.has(id),
    ru: text(ru),
    ...(en !== undefined && { en: text(en) }),
  };
}

export const RULES89: readonly Rule89[] = [
  // А. Участники и допуск (стык 0)
  rule("А01", "А", "background", 1, 3, "platform", null, "prep", "Т3", "partial", "prevent", ["R01"], null, null,
    ["Платформа работает, шлюз ПАО доступен, время участников синхронизировано", "Платформа", "platform.started; сверка времени", "редкий отказ инфраструктуры", "без Платформы ничего не идёт"]),
  rule("А02", "А", "background", 1, 3, "bank", null, "prep", "Т5", "yes", "prevent", ["R02"], null, null,
    ["Банк-эмитент — участник с действующим подключением: экран поручений, УПК, выдача реквизита", "банк", "issuer.connected", "редкий отказ подключения", "без банка нет поручений и реквизита"]),
  rule("А03", "А", "yellow", 2, 2, "merchant", null, "prep", "Т4", "yes", "prevent", ["R03", "R12"], null, null,
    ["Продавец — участник с договором эквайринга и знаком готовности; вне контура агент к нему не обращается", "продавец, эквайрер", "shops.connected, знак готовности", "продавцы подключаются и отключаются", "покупка у неготового продавца"]),
  rule("А04", "А", "background", 1, 3, "agent", "platform", "prep", "Т3", "yes", "prevent", ["R04"], null, null,
    ["Агент допущен: заявка подписана, ключ зарегистрирован Платформой, статус ACTIVE", "Платформа", "agent.admitted", "допуск — разовая процедура", "чужой агент действует от имени клиента"]),
  rule("А05", "А", "orange", 2, 3, "agent", "platform", "prep", "Т3", "no", "prevent", [], null, "access",
    ["Ключ агента действует: не истёк, не отозван; после смены ключа старый не принимается", "Платформа", "реестр ключей", "ключи меняются и истекают", "старый или отозванный ключ — подмена агента"]),
  rule("А06", "А", "orange", 2, 3, "agent", "platform", "action", "Т3", "yes", "prevent", ["R05"], null, "access",
    ["Приостановленный агент не выполняет операций, читает только свой статус", "Платформа", "403 AGENT_SUSPENDED", "приостановка приходит посреди покупки", "агент продолжает после запрета"]),
  rule("А07", "А", "background", 1, 3, "agent", "platform", "prep", "Т3", "yes", "prevent", ["R40"], null, null,
    ["Агент определяется по коду из реестра допуска, не по заголовку запроса", "шлюз", "код агента у допущенного обращения", "закрыто #90: код из реестра", "подмена кода агента"]),
  rule("А08", "А", "background", 1, 3, "client", "bank", "prep", "Т1", "outside", "prevent", [], null, null,
    ["Клиент идентифицирован банком и входит в приложение банка с его аутентификацией", "банк", "сессия приложения банка", "проверяет банк", "чужой клиент"]),
  rule("А09", "А", "background", 1, 1, "operator", null, "prep", "Т8", "yes", "detect", ["R06"], null, null,
    ["Реестры диагностики загружены для разбора «кто ошибся»", "стенд", "diag.registries.loaded", "разовая загрузка", "разбор без расшифровки"]),
  rule("А10", "А", "background", 1, 2, "platform", null, "prep", "Т3", "yes", "prevent", ["R44"], null, null,
    ["Процессы начинаются только после готовности системы и допуска агента", "Платформа", "порядок событий", "порядок запуска стабилен", "процессы до готовности"]),
  // Б. Поручение
  rule("Б01", "Б", "background", 1, 3, "agent", null, "prep", "Т3", "yes", "prevent", ["R07"], null, null,
    ["Поручение запрашивает допущенный агент подписанным запросом", "агент, шлюз", "POST /pao/v1/mandates", "подпись проверяется шлюзом", "поручение от чужого агента"]),
  rule("Б02", "Б", "yellow", 2, 2, "agent", "client", "prep", "Т1", "partial", "prevent", ["R10"], null, null,
    ["Заданы параметры: категория, сумма за одну покупку, сумма всего, продавцы, срок, вид (разовое или многоразовое), валюта", "агент, клиент", "mandate.requested", "параметры заполняет агент", "поручение без границ — спор"]),
  rule("Б03", "Б", "orange", 2, 3, "bank", "client", "prep", "Т1", "no", "prevent", [], null, "mandate",
    ["Клиент видит параметры поручения на экране банка полностью и понятно до подписи", "банк", "экран поручений банка", "клиент читает быстро, текст сложный", "клиент подписал не то, что понял — спор о деньгах"]),
  rule("Б04", "Б", "background", 1, 3, "client", "bank", "prep", "Т1", "yes", "prevent", ["R08"], null, null,
    ["Поручение подписывает сам клиент в приложении банка; агент подписать не может", "клиент, банк", "mandate.signed", "подпись в приложении банка", "поручение без воли клиента"],
    ["The client signs the mandate personally in the bank app; the agent cannot sign it", "client, bank", "mandate.signed", "signing happens in the bank app", "a mandate without the client's will"]),
  rule("Б05", "Б", "orange", 2, 3, "platform", null, "prep", "Т6", "no", "prevent", [], null, "mandate",
    ["Подписанное поручение неизменно; изменение — новое поручение с новой подписью", "Платформа", "отпечаток поручения", "поручение хранится и передаётся", "подмена поручения после подписи"]),
  rule("Б06", "Б", "orange", 2, 3, "platform", null, "action", "Т6", "yes", "prevent", ["R09"], null, "mandate",
    ["Поручение действует от подписи до срока, исчерпания, отзыва или приостановки", "Платформа", "mandate.active / expired / revoked", "срок, отзыв и приостановка во времени", "операция по недействующему поручению"],
    ["The mandate is in force from signing until it expires, is exhausted, revoked or suspended", "Platform", "mandate.active / expired / revoked", "term, revocation and suspension happen over time", "an operation under a mandate no longer in force"]),
  rule("Б07", "Б", "orange", 2, 3, "agent", "platform", "action", "Т3", "yes", "prevent", ["R11", "R13"], null, "mandate",
    ["Покупки не выходят за параметры поручения: категория, продавцы, сумма за раз, сумма всего", "агент, Платформа", "проверка при выдаче реквизита", "агент сам выбирает продавца и сумму", "покупка вне разрешённого клиентом"]),
  rule("Б08", "Б", "orange", 2, 3, "client", "platform", "action", "Т1", "yes", "prevent", ["R36"], null, "mandate",
    ["Клиент может отозвать поручение в любой момент в приложении банка; отзыв действует сразу", "клиент, Платформа", "mandate.revoked", "отзыв приходит асинхронно", "покупка после отзыва"]),
  rule("Б09", "Б", "background", 2, 1, "bank", "agent", "action", "Т1", "no", "detect", [], null, null,
    ["Клиент уведомлён о создании поручения, смене его статуса, отзыве и истечении", "банк, агент", "уведомления клиенту", "уведомления могут теряться", "клиент не в курсе"]),
  // В. Подбор предложения
  rule("В01", "В", "yellow", 2, 2, "agent", null, "action", "Т4", "yes", "prevent", ["R12", "R13"], null, null,
    ["Предложения берутся только у продавцов в контуре и в пределах поручения", "агент", "offer.selected", "контур меняется", "покупка у неготового продавца"]),
  rule("В02", "В", "red", 3, 3, "agent", "merchant", "action", "Т4", "yes", "prevent", ["R14"], "У1", null,
    ["Предложения с сигналами A5 исключаются: противоречивые цены, двойная цена, инструкции агенту в описании", "агент", "offer.excluded A5_*", "данные продавца внешние и неподконтрольны", "переплата, обман клиента"]),
  rule("В03", "В", "yellow", 2, 2, "merchant", null, "prep", "Т4", "yes", "prevent", ["R15"], null, null,
    ["Карточка полная: цена, количество, продавец, доставка, условия возврата", "агент", "offer.excluded REQUIRED", "неполные карточки часты", "неверная покупка"]),
  rule("В04", "В", "orange", 3, 2, "merchant", null, "prep", "Т4", "no", "prevent", [], null, "cart",
    ["Цена и наличие актуальны; возраст карточки — в пределах нормы", "агент, продавец", "возраст карточки", "цены и наличие меняются постоянно", "клиент платит не ту цену"]),
  rule("В05", "В", "background", 2, 1, "agent", null, "action", "Т4", "yes", "detect", ["R16"], null, null,
    ["Выбор — по правилу поручения (например, самое дешёвое в пределах продавцов) и объясним клиенту", "агент", "offer.selected", "правило выбора формально", "неоптимальный выбор"]),
  rule("В06", "В", "red", 3, 3, "agent", "merchant", "action", "Т4", "yes", "prevent", ["R14", "R47"], "У1", null,
    ["Текст карточки — данные, а не команды: инструкции продавца агенту не выполняются", "агент", "сигнал A5", "инструкции агенту можно спрятать в любой текст продавца", "агент выполняет чужую команду — обман, кража"],
    ["Card text is data, not commands: merchant instructions to the agent are not executed", "agent", "A5 signal", "instructions to the agent can be hidden in any merchant text", "the agent runs someone else's command — fraud, theft"]),
  // Г. Корзина и согласие (стык 1)
  rule("Г01", "Г", "yellow", 2, 2, "agent", null, "action", "Т2", "no", "prevent", [], null, null,
    ["Корзина показывает клиенту товары, количество, цену за единицу, доставку, продавца, итог, условия возврата", "агент", "cart.shown", "агент собирает корзину сам", "клиент видит не всё"]),
  rule("Г02", "Г", "orange", 2, 3, "agent", null, "action", "Т2", "yes", "prevent", ["R11"], null, "mandate",
    ["Итог корзины не больше суммы за одну покупку и остатка поручения", "агент", "cart.shown", "остаток меняется между покупками", "сумма сверх разрешённого"]),
  rule("Г03", "Г", "orange", 2, 3, "client", "agent", "action", "Т2", "yes", "prevent", ["R18"], null, "cart",
    ["Согласие клиента явное и привязано к этой корзине (её отпечатку)", "клиент", "cart.accepted", "согласие и корзина — разные шаги", "согласие не на ту корзину"],
    ["The client's consent is explicit and bound to this cart (its fingerprint)", "client", "cart.accepted", "consent and cart are separate steps", "consent to a different cart"]),
  rule("Г04", "Г", "orange", 2, 3, "agent", "client", "action", "Т2", "no", "prevent", [], null, "cart",
    ["Изменение корзины после согласия требует нового согласия", "агент", "новая cart.shown", "корзина может пересобираться", "оплата изменённой корзины без согласия"]),
  rule("Г05", "Г", "yellow", 2, 2, "client", "agent", "action", "Т2", "no", "prevent", [], null, null,
    ["Согласие имеет срок; просроченное не используется", "агент", "время согласия", "клиент отвечает с задержкой", "устаревшее согласие"]),
  rule("Г06", "Г", "orange", 2, 3, "platform", "agent", "action", "Т3", "yes", "detect", ["R17"], null, "cart",
    ["Сумма операции равна итогу корзины", "Платформа", "реквизит ↔ корзина", "сумма передаётся через несколько сторон", "списание не той суммы"],
    ["The operation amount equals the cart total", "Platform", "credential ↔ cart", "the amount passes through several parties", "the wrong amount is debited"]),
  // Д. Подтверждение клиентом
  rule("Д01", "Д", "orange", 2, 3, "client", "bank", "action", "Т5", "yes", "prevent", ["R19"], null, "confirmation",
    ["Выше порога — подтверждение клиентом в банке (УПК) до реквизита и оплаты", "Платформа, банк", "confirmation.confirmed", "порог и подтверждение — разные системы", "крупная покупка без подтверждения"]),
  rule("Д02", "Д", "orange", 2, 3, "bank", null, "action", "Т1", "no", "prevent", [], null, "confirmation",
    ["Подтверждение привязано к сумме и продавцу: что клиент подтвердил, то и оплачивается", "банк", "текст подтверждения", "текст подтверждения формирует банк", "клиент подтвердил одно, оплачено другое"]),
  rule("Д03", "Д", "yellow", 2, 2, "bank", null, "prep", "Т1", "no", "prevent", [], null, null,
    ["Код одноразовый, число попыток ограничено", "банк", "счётчик попыток", "перебор кода", "подбор кода"]),
  rule("Д04", "Д", "background", 1, 3, "bank", null, "prep", "Т8", "yes", "prevent", ["R20"], null, null,
    ["Код виден только клиенту: его нет в шине, журналах, на экранах", "банк", "поиск по шине", "код живёт только у банка", "утечка кода — подтверждение за клиента"],
    ["Only the client sees the code: it is not on the bus, in logs or on screens", "bank", "search across the bus", "the code lives only at the bank", "a leaked code — confirmation on the client's behalf"]),
  rule("Д05", "Д", "orange", 3, 2, "client", "platform", "action", "Т1", "yes", "prevent", ["R21"], null, "confirmation",
    ["Подтверждение имеет срок; просроченное — отказ", "Платформа", "confirmation.expired", "клиент не успевает ответить", "отказ, раздражение клиента"],
    ["Confirmation has a time limit; an expired one means a decline", "Platform", "confirmation.expired", "the client does not answer in time", "a decline, an annoyed client"]),
  // Е. Авторизация и реквизит
  rule("Е01", "Е", "background", 1, 3, "agent", null, "action", "Т3", "yes", "prevent", ["R22"], null, null,
    ["Запрос реквизита подписан ключом допущенного агента и проверен шлюзом", "агент, шлюз", "POST /pao/v1/credentials", "подпись проверяется шлюзом", "реквизит чужому агенту"]),
  rule("Е02", "Е", "orange", 2, 3, "platform", null, "action", "Т3", "yes", "prevent", ["R24"], null, "credential",
    ["Перед выдачей Платформа проверяет: поручение действует, продавец и сумма в пределах, остатка хватает, подтверждение есть", "Платформа", "отказы MANDATE_*", "много условий в одной проверке", "реквизит вне поручения"]),
  rule("Е03", "Е", "orange", 2, 3, "bank", null, "action", "Т5", "yes", "prevent", ["R23"], null, "credential",
    ["Реквизит одноразовый: одна операция, одна сумма, один продавец", "банк, Платформа", "credential.issued — один раз", "реквизит выдаёт банк по запросу", "повторное использование реквизита"],
    ["The credential is single-use: one operation, one amount, one merchant", "bank, Platform", "credential.issued — once", "the bank issues the credential on request", "the credential is reused"]),
  rule("Е04", "Е", "yellow", 2, 2, "bank", null, "prep", "Т5", "no", "prevent", [], null, null,
    ["Реквизит имеет короткий срок жизни; неиспользованный аннулируется", "банк", "срок реквизита", "реквизит может «висеть»", "неиспользованный реквизит используют позже"]),
  rule("Е05", "Е", "red", 3, 3, "platform", "agent", "action", "Т3", "yes", "prevent", ["R25"], "У2", null,
    ["Повтор запроса не создаёт второй реквизит (идемпотентность по ключу операции)", "Платформа", "IDEMPOTENCY_CONFLICT", "сбои сети вызывают повторы постоянно", "второй реквизит — двойное списание"],
    ["A repeated request does not create a second credential (idempotency by operation key)", "Platform", "IDEMPOTENCY_CONFLICT", "network failures cause repeats all the time", "a second credential — a double debit"]),
  rule("Е06", "Е", "yellow", 2, 2, "bank", null, "action", "Т5", "yes", "detect", ["R29"], null, null,
    ["Лимиты и достаточность средств проверяет банк; отказ — с кодом причины", "банк", "LIMIT_EXCEEDED", "лимиты клиента разные", "отказ — норма, но клиент недоволен"]),
  rule("Е07", "Е", "orange", 2, 3, "platform", "bank", "action", "Т3", "partial", "detect", ["R42"], null, "antifraud",
    ["Антифрод банка и Платформы проверяет аномалии: частота, суммы, новые продавцы, подставной агент", "банк, Платформа", "сигналы антифрода", "мошенники ищут слабые места", "фрод проходит"]),
  // Ж. Оплата у продавца
  rule("Ж01", "Ж", "orange", 2, 3, "agent", null, "action", "Т4", "yes", "detect", ["R26"], null, "credential",
    ["Оплата идёт тому продавцу, что в корзине и реквизите", "агент", "POST …/payment", "адрес продавца — данные агента", "деньги не тому продавцу"],
    ["Payment goes to the merchant in the cart and the credential", "agent", "POST …/payment", "the merchant address is agent data", "money goes to the wrong merchant"]),
  rule("Ж02", "Ж", "orange", 2, 3, "merchant", null, "action", "Т4", "partial", "detect", ["R17"], null, "credential",
    ["Сумма и валюта оплаты равны итогу корзины", "агент, продавец", "оплата ↔ корзина", "сумма и валюта на стороне продавца", "списание не той суммы"],
    ["Payment amount and currency equal the cart total", "agent, merchant", "payment ↔ cart", "amount and currency are on the merchant's side", "the wrong amount is debited"]),
  rule("Ж03", "Ж", "red", 3, 3, "merchant", "agent", "action", "Т4", "yes", "prevent", ["R46"], "У2", null,
    ["Один заказ — одна оплата; повтор не создаёт второго списания", "продавец, Платформа", "номер заказа", "повторы оплаты при сбоях часты", "двойное списание за один заказ"],
    ["One order — one payment; a repeat does not create a second debit", "merchant, Platform", "order number", "payment repeats on failures are common", "a double debit for one order"]),
  rule("Ж04", "Ж", "red", 3, 3, "operator", "merchant", "action", "Т8", "yes", "prevent", ["R27"], "У3", null,
    ["Ответ продавца PAID — не итог операции", "агент, дашборд", "shop.reply PAID", "ответ продавца приходит раньше итога — соблазн принять его", "выдача без оплаты, «оплачено» без денег"],
    ["The merchant's PAID reply is not the operation outcome", "agent, dashboard", "shop.reply PAID", "the merchant's reply arrives before the outcome — tempting to accept it", "goods released without payment, “paid” without money"]),
  rule("Ж05", "Ж", "orange", 3, 2, "agent", "merchant", "action", "Т4", "no", "prevent", [], null, "credential",
    ["Ожидание ответа продавца ограничено; без ответа — «не определён» до итога Платформы, не «оплачено»", "агент", "тайм-аут", "продавец не отвечает вовремя", "зависшая покупка, неясный статус"]),
  // З. Итог операции
  rule("З01", "З", "orange", 2, 3, "platform", null, "action", "Т6", "yes", "prevent", ["R28"], null, "outcome",
    ["Итог — только событие, подписанное Платформой: «оплачено» или «отказ с кодом»", "Платформа", "operation.authorized / declined", "итог идёт по цепочке систем", "итог без подписи — подмена"],
    ["The outcome is only an event signed by the Platform: “paid” or “declined with a code”", "Platform", "operation.authorized / declined", "the outcome travels through a chain of systems", "an unsigned outcome — substitution"]),
  rule("З02", "З", "orange", 2, 3, "platform", null, "action", "Т6", "no", "prevent", [], null, "outcome",
    ["У операции один окончательный итог; повторное событие итога его не меняет", "Платформа", "номер операции", "повторная доставка событий", "смена итога задним числом"]),
  rule("З03", "З", "orange", 2, 3, "operator", null, "action", "Т8", "yes", "prevent", ["R30"], null, "outcome",
    ["«Оплачено» показывается и сообщается только по событию Платформы", "дашборд, агент", "—", "экраны и уведомления строят разные системы", "«оплачено» без оплаты"],
    ["“Paid” is shown and reported only on a Platform event", "dashboard, agent", "—", "screens and notifications are built by different systems", "“paid” without payment"]),
  rule("З04", "З", "red", 3, 3, "platform", "operator", "action", "Т6", "yes", "prevent", ["R31"], "У4", null,
    ["Итог доставляется всем сторонам; позднее событие не теряется", "Платформа, адаптер", "номер события", "события приходят не по порядку — найдено в К1.2 (Б3)", "потеря итога: ложное «не оплачено»"],
    ["The outcome reaches all parties; a late event is not lost", "Platform, adapter", "event number", "events arrive out of order — found in a demo stand run", "a lost outcome: a false “not paid”"]),
  rule("З05", "З", "background", 2, 1, "platform", null, "action", "Т6", "partial", "detect", ["R06"], null, null,
    ["Отказ содержит код причины и сторону («кто ошибся»)", "Платформа, реестры", "код и сторона", "реестры неполны", "разбор без причины"]),
  // И. Исполнение и расчёты (стык 2)
  rule("И01", "И", "orange", 2, 3, "merchant", null, "action", "Т7", "yes", "prevent", ["R32"], null, "outcome",
    ["Продавец исполняет заказ только после «оплачено»", "продавец", "order.confirmed", "продавцу выгодно отгружать быстрее", "выдача без оплаты"],
    ["The merchant fulfils the order only after “paid”", "merchant", "order.confirmed", "the merchant gains from shipping sooner", "goods released without payment"]),
  rule("И02", "И", "yellow", 2, 2, "merchant", null, "action", "Т7", "no", "detect", [], null, null,
    ["Продавец выдаёт клиенту кассовый чек (закон о ККТ, 54-ФЗ)", "продавец", "чек через ОФД", "чек — система продавца", "нарушение 54-ФЗ"]),
  rule("И03", "И", "background", 1, 3, "platform", null, "action", "Т5", "yes", "prevent", ["R33"], null, null,
    ["Операция включается в расчёты только по «оплачено»; сумма расчёта равна сумме операции", "Платформа", "operation.settlement_registered", "расчёт по событию Платформы", "расчёт без оплаты"]),
  rule("И04", "И", "orange", 2, 3, "platform", "bank", "action", "Т5", "no", "detect", [], null, "outcome",
    ["Сверка итогов: Платформа ↔ банк ↔ продавец без расхождений; расхождение — на разбор", "все", "реестр сверки", "три стороны, три учёта", "потерянные или лишние деньги"]),
  rule("И05", "И", "background", 1, 2, "platform", null, "prep", "Т5", "no", "detect", [], null, null,
    ["Комиссии сторон считаются по тарифам и видны в отчётности", "Платформа", "тарифы", "тарифы стабильны", "неверные комиссии"]),
  rule("И06", "И", "yellow", 2, 2, "agent", "bank", "action", "Т2", "yes", "detect", ["R34"], null, null,
    ["Клиенту сообщается итог Платформы и детали покупки", "агент, банк", "client.notified", "уведомления могут теряться", "клиент не знает итога"]),
  rule("И07", "И", "yellow", 2, 2, "platform", null, "action", "Т6", "yes", "detect", ["R35"], null, null,
    ["Статус поручения обновлён: израсходовано, остаток, исполнено", "Платформа", "mandate.completed / still_active", "статус обновляется асинхронно", "неверный остаток для следующей покупки"]),
  // К. Отмены, возвраты, споры
  rule("К01", "К", "orange", 2, 3, "platform", "bank", "action", "Т5", "no", "prevent", [], null, "outcome",
    ["Отмена до расчёта — полная, без списания; после расчёта — только возврат", "Платформа, банк", "статус операции", "отмена и расчёт — гонка", "списание после отмены"]),
  rule("К02", "К", "orange", 2, 3, "merchant", "bank", "action", "Т7", "no", "prevent", [], null, "outcome",
    ["Возврат — на тот же источник и не больше суммы операции; частичный — с учётом остатка", "продавец, банк", "операция возврата", "возвраты ручные и частичные", "возврат не туда или больше суммы"]),
  rule("К03", "К", "yellow", 2, 2, "merchant", null, "action", "Т7", "no", "detect", [], null, null,
    ["Возврат товара — по закону о защите прав потребителей и условиям продавца (для пищевых — ограничения)", "продавец", "условия возврата", "правила возврата сложны", "спор с клиентом"]),
  rule("К04", "К", "yellow", 2, 2, "bank", "platform", "action", "Т1", "no", "detect", [], null, null,
    ["Спор клиента решается по доказательствам: поручение, согласие, подтверждение, итог, чек", "банк, Платформа", "журнал событий", "доказательства разбросаны", "проигранный спор"]),
  rule("К05", "К", "yellow", 2, 2, "bank", null, "action", "Т1", "no", "detect", [], null, null,
    ["Сроки рассмотрения споров и возвратов соблюдаются", "банк", "даты обращения и ответа", "сроки зависят от людей", "нарушение сроков"]),
  // Л. Отзыв, приостановка, срок во время операции (стык 3)
  rule("Л01", "Л", "red", 3, 3, "agent", null, "action", "Т3", "yes", "prevent", ["R37"], "У5", null,
    ["Отзыв доходит до агента; он сам останавливает незавершённые покупки", "агент", "purchase.stopped MANDATE_NOT_ACTIVE", "отзыв приходит во время покупки — гонка", "покупка после отзыва, деньги клиента"],
    ["Revocation reaches the agent; it stops unfinished purchases itself", "agent", "purchase.stopped MANDATE_NOT_ACTIVE", "revocation arrives during a purchase — a race", "a purchase after revocation, the client's money"]),
  rule("Л02", "Л", "orange", 2, 3, "platform", null, "action", "Т3", "yes", "prevent", ["R38", "R24"], null, "races",
    ["После отзыва или истечения Платформа не выдаёт реквизит", "Платформа", "отказ MANDATE_NOT_ACTIVE", "вторая линия — Платформа", "реквизит после отзыва"]),
  rule("Л03", "Л", "orange", 3, 2, "platform", null, "action", "Т6", "no", "detect", [], null, "races",
    ["Операция, подтверждённая Платформой до отзыва, завершается; клиент видит, что она прошла до отзыва", "Платформа", "порядок событий", "отзыв и итог почти одновременно", "спор «я отозвал раньше»"]),
  rule("Л04", "Л", "yellow", 2, 2, "agent", "platform", "action", "Т3", "yes", "prevent", ["R05"], null, null,
    ["Приостановка агента останавливает его новые запросы; о начатых покупках сообщается клиенту", "Платформа, агент", "403 AGENT_SUSPENDED", "приостановка асинхронна", "клиент не знает о застрявшей покупке"]),
  // М. Защита данных и безопасность
  rule("М01", "М", "background", 1, 3, "platform", null, "prep", "Т8", "yes", "prevent", ["R41"], null, null,
    ["Данных карт нет в событиях, журналах, на экранах; используются токены и одноразовые реквизиты", "все", "поиск по шине", "данные карт в шину не попадают", "утечка данных карт"],
    ["Card data is absent from events, logs and screens; tokens and single-use credentials are used", "everyone", "search across the bus", "card data does not reach the bus", "a card data leak"]),
  rule("М02", "М", "background", 1, 3, "operator", null, "prep", "Т9", "outside", "prevent", [], null, null,
    ["Ключи и секреты не появляются в событиях, журналах, коммитах", "все", "проверка секретов", "проверка секретов в разработке", "утечка ключей"]),
  rule("М03", "М", "yellow", 2, 2, "platform", null, "prep", "Т8", "no", "prevent", [], null, null,
    ["Персональные данные — только необходимые (152-ФЗ); на экранах — идентификаторы", "все", "состав полей", "поля событий растут", "лишние персональные данные"]),
  rule("М04", "М", "background", 1, 3, "platform", null, "prep", "Т3", "no", "prevent", [], null, null,
    ["Каналы между участниками защищены, запросы подписаны", "все", "подпись, защищённый канал", "каналы защищены", "перехват"]),
  rule("М05", "М", "orange", 2, 3, "operator", null, "prep", "Т9", "no", "prevent", [], null, "access",
    ["Доступ к пульту — по ролям; кнопки реакции — по правам", "дашборд", "роли", "права настраивают люди", "оператор нажимает чужую кнопку"]),
  // Н. Журналы и доказательность
  rule("Н01", "Н", "yellow", 2, 2, "platform", null, "prep", "Т8", "yes", "detect", ["R39"], null, null,
    ["Каждое событие имеет источник, время, номер и связи: транзакция, поручение, агент", "все", "поля события", "поля заполняют разные системы", "разбор без связей"]),
  rule("Н02", "Н", "background", 1, 3, "platform", null, "prep", "Т6", "no", "prevent", [], null, null,
    ["Журнал неизменяем: событие не правится и не удаляется", "Платформа", "—", "журнал на Платформе", "подделка истории"]),
  rule("Н03", "Н", "yellow", 2, 2, "operator", null, "action", "Т9", "yes", "detect", ["R45"], null, null,
    ["Решения и вмешательства людей фиксируются: кто, когда, что, по какому условию", "дашборд", "журнал решений", "люди забывают записывать", "решение без следа"]),
  rule("Н04", "Н", "background", 1, 2, "platform", null, "prep", "Т6", "no", "detect", [], null, null,
    ["Сроки хранения журналов и доказательств соблюдаются", "Платформа, банк", "—", "сроки хранения — настройка", "потеря доказательств"]),
  rule("Н05", "Н", "yellow", 2, 2, "operator", null, "action", "Т9", "yes", "detect", ["R43"], null, null,
    ["Факт Платформы совпадает с паспортом ожиданий; расхождение — на разбор", "дашборд", "итог ↔ паспорт", "паспорт пишется заранее", "расхождение без разбора"]),
  // О. Устойчивость и порядок событий
  rule("О01", "О", "orange", 3, 2, "platform", null, "prep", "Т3", "no", "prevent", [], null, "races",
    ["У каждого шага есть тайм-аут; по истечении — определённый исход, а не «зависание»", "все", "время шага", "сети и люди медлят", "зависшие операции"]),
  rule("О02", "О", "red", 3, 3, "platform", null, "prep", "Т3", "partial", "prevent", ["R25"], "У2", null,
    ["Повторы безопасны на всех изменяющих шагах (идемпотентность)", "все", "ключ операции", "повторы на всех шагах", "двойные действия и списания"],
    ["Repeats are safe at every mutating step (idempotency)", "everyone", "operation key", "repeats at every step", "double actions and debits"]),
  rule("О03", "О", "red", 3, 3, "platform", "operator", "prep", "Т8", "yes", "prevent", ["R31"], "У4", null,
    ["Порядок событий восстанавливается по номерам; позднее и повторное события обрабатываются правильно", "адаптер", "номер события", "порядок событий не гарантирован сетью", "неверный итог на экране"],
    ["Event order is restored by numbers; late and repeated events are handled correctly", "adapter", "event number", "the network does not guarantee event order", "a wrong outcome on screen"]),
  rule("О04", "О", "background", 2, 1, "operator", null, "prep", "Т8", "no", "prevent", [], null, null,
    ["Недоступность вспомогательного сервиса (языковая модель, реестр) не меняет итога; экран работает с пометкой", "дашборд", "пометка «без модели»", "сервисы недоступны", "экран без пояснений"]),
  // П. Антифрод и ПОД/ФТ
  rule("П01", "П", "yellow", 2, 2, "operator", null, "action", "Т9", "yes", "detect", ["R42"], null, null,
    ["«Фрод» ставится только при помеченном источнике; иначе «фрод или дефект; вердикт — владелец»", "дашборд", "тип события", "ярлык ставят правила", "обвинение честного агента"]),
  rule("П02", "П", "orange", 2, 3, "platform", "bank", "action", "Т3", "no", "prevent", [], null, "antifraud",
    ["Аномалии (частота, суммы, новые продавцы, необычное время) — сигнал до операции", "банк, Платформа", "сигнал антифрода", "мошенники меняют приёмы", "фрод проходит до операции"]),
  rule("П03", "П", "background", 1, 3, "bank", null, "prep", "Т5", "outside", "detect", [], null, null,
    ["Операции проходят проверки банка по ПОД/ФТ (115-ФЗ)", "банк", "решение банка", "проверяет банк", "нарушение ПОД/ФТ"]),
  // Р. Информирование клиента
  rule("Р01", "Р", "yellow", 2, 2, "bank", "agent", "action", "Т1", "no", "detect", [], null, null,
    ["Клиент получает уведомление о каждой покупке агента: что, у кого, сколько", "банк, агент", "уведомление", "уведомления теряются", "клиент не знает о покупке"]),
  rule("Р02", "Р", "yellow", 2, 2, "agent", null, "action", "Т2", "partial", "detect", ["R34"], null, null,
    ["Отказ сообщается клиенту с понятной причиной и тем, что делать", "агент, банк", "client.notified", "причины отказов непонятны", "клиент не понимает, что делать"]),
  rule("Р03", "Р", "background", 1, 1, "bank", null, "prep", "Т1", "no", "detect", [], null, null,
    ["Клиент в любой момент видит свои поручения, покупки и остатки в приложении банка", "банк", "экран банка", "экран банка", "—"]),
];

/** Группы условий модели (`GRP`) — у условий своя разбивка, не группы правил. */
export const CONDITION_GROUPS = {
  А: p("Готовность системы (стык 0)", "System readiness (joint 0)"),
  Б: p("Поручение", "Mandate"),
  В: p("Подбор", "Selection"),
  Г: p("Корзина и согласие (стык 1)", "Cart and consent (joint 1)"),
  Д: p("Подтверждение", "Confirmation"),
  Е: p("Реквизит", "Credential"),
  Ж: p("Оплата", "Payment"),
  З: p("Итог", "Outcome"),
  И: p("После операции (стык 2)", "After the operation (joint 2)"),
  К: p("Отзыв и срок (стык 3)", "Revocation and expiry (joint 3)"),
  Л: p("Сквозные", "Cross-cutting"),
} as const satisfies Readonly<Record<string, Phrase>>;
export type ConditionGroup = keyof typeof CONDITION_GROUPS;

export interface Condition {
  readonly id: CheckableCondition;
  readonly group: ConditionGroup;
  readonly control: Control;
  /** Реакция модели на нарушение; нет — модель реакции не предлагает. */
  readonly act?: Reaction;
  readonly rule: Phrase;
  readonly who: Phrase;
  readonly evidence: Phrase;
  /** Что делать при нарушении. */
  readonly todo: Phrase;
}

type CT = readonly [ru: string, en: string];
function cond(
  id: CheckableCondition, group: ConditionGroup, control: Control, act: Reaction | null,
  rule: CT, who: CT, evidence: CT, todo: CT,
): Condition {
  return { id, group, control, ...(act !== null && { act }), rule: p(...rule), who: p(...who), evidence: p(...evidence), todo: p(...todo) };
}

/** Тексты 18 проверяемых условий (`COND` модели 1.23), ru/en (П6 п. 2). */
export const CONDITIONS: readonly Condition[] = [
  cond("R08", "Б", "prevent", null,
    ["Поручение подписывает сам клиент в приложении банка", "The client signs the mandate personally in the bank app"],
    ["клиент, банк", "client, bank"], ["mandate.signed", "mandate.signed"],
    ["без подписи поручение не действует", "without a signature the mandate is not in force"]),
  cond("R09", "Б", "prevent", null,
    ["Поручение действует на момент операции: не отклонено, не отозвано, не истекло", "The mandate is in force at the time of the operation: not rejected, revoked or expired"],
    ["Платформа", "Platform"], ["mandate.active; нет revoked / expired", "mandate.active; no revoked / expired"],
    ["остановить покупку; клиенту — новое поручение", "stop the purchase; a new mandate for the client"]),
  cond("R17", "Г", "detect", "stop",
    ["Сумма операции совпадает с итогом корзины", "The operation amount matches the cart total"],
    ["агент, Платформа", "agent, Platform"], ["cart.shown ↔ реквизит", "cart.shown ↔ credential"],
    ["остановить покупку, разбор", "stop the purchase, review"]),
  cond("R18", "Г", "prevent", "stop",
    ["Согласие клиента получено до операции", "The client's consent is obtained before the operation"],
    ["клиент", "client"], ["cart.accepted", "cart.accepted"],
    ["остановить покупку; спросить клиента", "stop the purchase; ask the client"]),
  cond("R20", "Д", "prevent", "review",
    ["Код подтверждения виден только клиенту", "Only the client sees the confirmation code"],
    ["банк", "bank"], ["нет кода в шине", "no code on the bus"],
    ["немедленный разбор утечки", "immediate leak review"]),
  // Модель: «Подтверждение имеет срок (30 с)» — срок на стенде свой, «(30 с)» убрано (шапка файла, п. 2).
  cond("R21", "Д", "prevent", "remind",
    ["Подтверждение имеет срок; просроченное — отказ", "Confirmation has a time limit; an expired one means a decline"],
    ["Платформа", "Platform"], ["confirmation.expired", "confirmation.expired"],
    ["напомнить клиенту до истечения", "remind the client before it expires"]),
  cond("R23", "Е", "prevent", "review",
    ["Реквизит одноразовый: один на транзакцию", "The credential is single-use: one per transaction"],
    ["банк, Платформа", "bank, Platform"], ["credential.issued × 1", "credential.issued × 1"],
    ["отозвать лишний реквизит, разбор", "revoke the extra credential, review"]),
  cond("R25", "Е", "prevent", "review",
    ["Повтор запроса не даёт второй реквизит", "A repeated request does not yield a second credential"],
    ["Платформа", "Platform"], ["IDEMPOTENCY_CONFLICT", "IDEMPOTENCY_CONFLICT"],
    ["повтор отклоняется", "the repeat is rejected"]),
  cond("R26", "Ж", "detect", "review",
    ["Оплата идёт тому продавцу, что в корзине", "Payment goes to the merchant in the cart"],
    ["агент, продавец", "agent, merchant"], ["POST …/payment", "POST …/payment"],
    ["остановить, вернуть деньги, разбор агента", "stop, return the money, review the agent"]),
  cond("R27", "Ж", "prevent", "review",
    ["Ответ продавца PAID — не итог", "The merchant's PAID reply is not the outcome"],
    ["дашборд", "dashboard"], ["shop.reply PAID", "shop.reply PAID"],
    ["не показывать «оплачено» по нему", "do not show “paid” on it"]),
  cond("R28", "З", "prevent", null,
    ["Итог — только подписанное событие Платформы", "The outcome is only a signed Platform event"],
    ["Платформа", "Platform"], ["operation.authorized / declined", "operation.authorized / declined"],
    ["итог без подписи не принимать", "do not accept an unsigned outcome"]),
  cond("R30", "З", "prevent", null,
    ["«Оплачено» на экранах — только по событию Платформы", "“Paid” on screens — only on a Platform event"],
    ["дашборд", "dashboard"], ["operation.authorized", "operation.authorized"],
    ["—", "—"]),
  cond("R31", "З", "prevent", "review",
    ["Позднее событие итога не теряется на экранах", "A late outcome event is not lost on screens"],
    ["адаптер дашборда", "dashboard adapter"], ["номер события, отсечка по множеству", "event number, de-duplication by the set of seen numbers"],
    ["проверить адаптер", "check the adapter"]),
  cond("R32", "И", "prevent", "review",
    ["Заказ исполняется только после «оплачено»", "The order is fulfilled only after “paid”"],
    ["продавец", "merchant"], ["order.confirmed", "order.confirmed"],
    ["остановить выдачу до итога", "hold fulfilment until the outcome"]),
  cond("R37", "К", "prevent", "review",
    ["Агент сам останавливает покупки после отзыва или истечения", "The agent stops purchases itself after revocation or expiry"],
    ["агент", "agent"], ["purchase.stopped MANDATE_NOT_ACTIVE", "purchase.stopped MANDATE_NOT_ACTIVE"],
    ["сигнал о дефекте агента", "an agent defect signal"]),
  cond("R41", "Л", "prevent", "review",
    ["Данных карт нет в событиях и на экранах", "No card data in events or on screens"],
    ["все", "everyone"], ["поиск по шине", "search across the bus"],
    ["немедленный разбор утечки", "immediate leak review"]),
  cond("R46", "Ж", "prevent", "stop",
    ["Один заказ — одна оплата; повтор не создаёт второго списания", "One order — one payment; a repeat does not create a second debit"],
    ["продавец, Платформа", "merchant, Platform"], ["POST …/payment — один раз на заказ", "POST …/payment — once per order"],
    ["остановить; аннулировать вторую оплату; на разбор", "stop; cancel the second payment; send for review"]),
  cond("R47", "В", "prevent", "stop",
    ["Инструкции в тексте продавца агенту не выполняются", "Instructions in merchant text are not executed by the agent"],
    ["агент", "agent"], ["offer.excluded A5_INSTRUCTION", "offer.excluded A5_INSTRUCTION"],
    ["остановить покупку; продавца — в карантин; на разбор агента", "stop the purchase; quarantine the merchant; review the agent"]),
];

export type Phase = "start" | "pre" | "op" | "post";

export interface Joint {
  readonly id: "J0" | "J1" | "J2" | "J3";
  readonly from: Phase;
  readonly to: Phase;
  readonly name: Phrase;
  /** Что передаётся на стыке. */
  readonly hand: Phrase;
  readonly guarantees: readonly { readonly id: string; readonly name: Phrase }[];
}

/** Стыки фаз и 13 гарантий доверия (`JOINTS` модели 1.23), ru/en (П6 п. 2). Проверки гарантий — движок, П-3.2. */
export const JOINTS: readonly Joint[] = [
  {
    id: "J0", from: "start", to: "pre",
    name: p("Стык 0 · запуск → подготовка", "Joint 0 · start → preparation"),
    hand: p("допуск агента: ключ зарегистрирован Платформой; банк и продавцы подключены", "agent admission: key registered by the Platform; bank and merchants connected"),
    guarantees: [
      { id: "g0a", name: p("Агент допущен до первого запроса", "The agent is admitted before its first request") },
      { id: "g0b", name: p("Банк и продавцы подключены до начала", "Bank and merchants are connected before the start") },
    ],
  },
  {
    id: "J1", from: "pre", to: "op",
    name: p("Стык 1 · подготовка → транзакция", "Joint 1 · preparation → transaction"),
    hand: p("поручение, подписанное клиентом; корзина с согласием клиента; запрос агента, подписанный его ключом", "a mandate signed by the client; a cart with the client's consent; an agent request signed with its key"),
    guarantees: [
      { id: "g1a", name: p("Поручение подписано клиентом и действует", "The mandate is signed by the client and in force") },
      { id: "g1b", name: p("Согласие клиента с корзиной", "The client's consent to the cart") },
      { id: "g1c", name: p("Запрос агента подписан и проверен шлюзом", "The agent request is signed and checked by the gateway") },
      { id: "g1d", name: p("Продавец и сумма — в пределах поручения (проверка Платформы)", "Merchant and amount within the mandate (Platform check)") },
      { id: "g1e", name: p("Выше порога — подтверждение клиента до оплаты", "Above the threshold — client confirmation before payment") },
    ],
  },
  {
    id: "J2", from: "op", to: "post",
    name: p("Стык 2 · транзакция → посттранзакционные", "Joint 2 · transaction → post-transaction"),
    hand: p("итог операции — событие, подписанное Платформой; реквизит использован один раз", "the operation outcome is an event signed by the Platform; the credential is used once"),
    guarantees: [
      { id: "g2a", name: p("Итог — только подписанное событие Платформы", "Outcome — only a signed Platform event") },
      { id: "g2b", name: p("Заказ и расчёт — только после итога «оплачено»", "Order and settlement — only after the “paid” outcome") },
      { id: "g2c", name: p("Реквизит одноразовый", "The credential is single-use") },
    ],
  },
  {
    id: "J3", from: "post", to: "pre",
    name: p("Стык 3 · посттранзакционные → подготовка следующей покупки", "Joint 3 · post-transaction → preparing the next purchase"),
    hand: p("статус поручения: израсходовано, остаток, исполнено или отозвано", "mandate status: spent, remaining, fulfilled or revoked"),
    guarantees: [
      { id: "g3a", name: p("Статус поручения обновлён после итога", "Mandate status updated after the outcome") },
      { id: "g3b", name: p("Остаток поручения учтён следующей покупкой", "The mandate balance is accounted for by the next purchase") },
      { id: "g3c", name: p("Отзыв доходит до агента и останавливает покупки", "Revocation reaches the agent and stops purchases") },
    ],
  },
];

/** Пометка у правила без en в английском интерфейсе (П6 п. 2). */
export const EN_LATER = p("en — после MVP", "en — after MVP");

/** Тексты правила на языке экрана: en нет — ru и пометка «en — после MVP». */
export function ruleText(r: Rule89, lang: keyof Phrase): { readonly text: RuleText; readonly enLater: boolean } {
  if (lang === "en" && r.en !== undefined) return { text: r.en, enLater: false };
  return { text: r.ru, enLater: lang === "en" };
}
