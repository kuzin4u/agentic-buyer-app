// ИН-П1, кирпич К1 — данные экранов знакомства П1 и П3 (решение **П34**; Р-1675, Р-1676, Р-1678).
//
// Что здесь есть: закрытые перечни кодов (виды агента, строки таблицы сравнения, обязательные согласия, коды ошибок)
// и разбор файла данных `config/onboarding.default.json`. Приём — тот же, что у профиля предпочтений (П32,
// `src/principles/model.ts`): **коды живут в коде, тексты живут в данных**.
//
// Почему так, а не наоборот:
// - тексты банка и формулировки условий меняются настройкой, и инвариант 7 читается для них так же, как для бренда:
//   литералом в коде их нет, оба языка — с первого коммита (правило планов № 3);
// - коды, наоборот, в данных жить не могут: по ним ветвится сервер, и опечатка в файле тихо лишила бы правило его
//   пункта. Перечень берётся из источника (Р-1511), а источник кодов здесь — решение П34 и § 5.17–§ 5.19 контракта,
//   а не файл настройки.
//
// Чего здесь нет: ни одного решения о том, что человеку доступно (это сервер — правило 3 К-Б, инвариант 2), ни
// арифметики над суммой (инвариант 2: цена агента приходит парой и только показывается), ни платёжных реквизитов
// (инвариант 1 — в данных экранов им не место, и это держит тест кирпича).
import type { CurrencyCode, UiLang, UiMoney, UiPathStep } from "../contract/ui-v1/index.js";
import { ISO4217_MINOR_UNITS } from "../iso4217.js";

/** Текст человеку — на обоих языках, парой (правило планов № 3, инвариант 7). Своя пара, а не импорт из
 *  `src/principles/` и не из `src/ui-server/`: сервер сам опирается на эти данные, и обратная зависимость замкнула бы
 *  модули в кольцо. */
export type OnboardingText = { readonly [L in UiLang]: string };

/**
 * Вид агента (§ 5.17, решение **Р-1675**).
 *
 * Перечень **закрытый и в коде**: по `id` ветвятся § 5.18 и § 5.19, и значение, которого сервер не знает, не должно
 * появляться из файла настройки. Какие из них выбираются — **не** свойство кода: это данные (`selectable`), потому что
 * М3 станет рабочим путём после 30.11 правкой файла, а не правкой перечня.
 */
export const AGENT_MODELS = ["M1", "M2", "M3"] as const;

export type AgentModelId = (typeof AGENT_MODELS)[number];

export const isAgentModelId = (s: unknown): s is AgentModelId =>
  typeof s === "string" && (AGENT_MODELS as readonly string[]).includes(s);

/**
 * Строки таблицы «чем они отличаются для вас» (§ 5.17, канва П1 — `svod`).
 *
 * Закрытый перечень: строка без значения хотя бы у одного вида агента — дыра в сравнении, по которой человек выбирает
 * агента, и ловиться она должна на разборе файла, а не глазами.
 */
export const COMPARE_ROWS = ["LIABILITY", "DISPUTE", "ALL_MERCHANTS", "MANDATES_ON_BANK_CHANGE"] as const;

export type CompareRow = (typeof COMPARE_ROWS)[number];

/**
 * Обязательные согласия П3 (§ 5.18, § 5.19).
 *
 * Оба **обязательны** и оба по умолчанию пусты (П26, Р-1676 п. 2): умолчания у согласия нет, а предотмеченная галочка
 * согласием не является. Перечень закрыт: появись третий пункт — он должен появиться решением, а не строкой в файле,
 * иначе человек подписывал бы согласие, которого никто не решал.
 */
export const CONSENT_IDS = ["TERMS", "DATA"] as const;

export type ConsentId = (typeof CONSENT_IDS)[number];

export const isConsentId = (s: unknown): s is ConsentId =>
  typeof s === "string" && (CONSENT_IDS as readonly string[]).includes(s);

/** Экраны задачи: П1 «какой агент» и П3 «условия и согласия». П2 и П4–П6 — не в ИН-П1 (**П4 — ИН-П2, П6 — ИН-ВМ**
 *  по решению владельца 22.11.2026, **Р-1705**; П5 — И-2), поэтому в перечне их нет: место под них появится вместе
 *  с ними. */
export const ONBOARDING_SCREENS = ["P1", "P3"] as const;

export type OnboardingScreenId = (typeof ONBOARDING_SCREENS)[number];

/** Готовые подписи экрана, которые сервер отдаёт человеку (§ 5.18, правило 3: экран своих слов не придумывает). */
export const SCREEN_TEXT_KEYS = ["accept", "why_disabled_until_all_required"] as const;

export type ScreenTextKey = (typeof SCREEN_TEXT_KEYS)[number];

/**
 * Коды ошибок, у которых в данных есть текст человеку (§ 3 «Ошибки»: `text` приходит на языке запроса).
 *
 * Перечень закрыт здесь, а в кирпиче К4 он сверяется **на компиляции** с кодами, которыми отвечает `POST
 * /ui/v1/consent` — тем же приёмом, что `ERROR_TEXT_KEYS` профиля предпочтений (`src/principles/service.ts`): новый
 * код без текста не пройдёт сборку, а лишний текст, которого никто не покажет, не пройдёт разбор файла.
 */
export const ONBOARDING_ERROR_KEYS = ["CONSENT_INVALID", "MODEL_NOT_AVAILABLE", "SHOWN_STALE"] as const;

// `IDEMPOTENCY_REQUIRED` и `IDEMPOTENCY_CONFLICT` здесь **намеренно нет** (находка ревью К4 № 5). Правило 2 исполняет
// общий слой сервера, и текст человеку на эти два кода отдаёт его словарь (`UI_TEXT`, `src/ui-server/lang.ts`). Пока
// они лежали ещё и здесь, копии не читал никто — и они уже разошлись пунктуацией: правка в `config/` ничего не
// меняла на экране. Один код — один текст.

export type OnboardingErrorKey = (typeof ONBOARDING_ERROR_KEYS)[number];

/** Шаг пути приобретения — **числами данных**, без перечня имён (решение **Р-1678**, П34 п. 7).
 *
 *  Сам тип живёт **в контракте, рядом с `UiWhere`** (`src/contract/ui-v1/methods.ts`): он уходит экрану полями
 *  § 5.17 и § 5.18, и второй его копии в прикладном модуле быть не должно — иначе К3 выбирал бы между обратным
 *  импортом контракта из `src/onboarding/` и второй копией типа (находка ревью К1 № 4). Здесь — только реэкспорт,
 *  чтобы потребителям модуля не приходилось брать его из двух мест. */
export type { UiPathStep };

/** Один вид агента с его текстами. */
export interface AgentModel {
  readonly id: AgentModelId;
  readonly name: OnboardingText;
  readonly text: OnboardingText;
  /** можно ли его выбрать (Р-1675: М1 и М2 — да, М3 — нет) */
  readonly selectable: boolean;
  /** почему нельзя — **готовым текстом**; у выбираемого `null` (§ 3 `UiAction.why_disabled`, правило 3) */
  readonly why_not: OnboardingText | null;
  /** подпись кнопки «подключить»; у невыбираемого `null` — кнопки у него нет вовсе */
  readonly action_label: OnboardingText | null;
  /** «что может агент» — свой набор у каждого выбираемого вида (Р-1675); у невыбираемого пусто */
  readonly can: readonly OnboardingText[];
}

/** Строка таблицы сравнения: подпись и значение у каждого вида агента. */
export interface CompareLine {
  readonly row: CompareRow;
  readonly label: OnboardingText;
  readonly values: Readonly<Record<AgentModelId, OnboardingText>>;
}

/** Один пункт согласия. */
export interface ConsentItem {
  readonly id: ConsentId;
  readonly text: OnboardingText;
}

/** Подписи одного экрана. */
export interface ScreenTexts {
  readonly n: number;
  readonly title: OnboardingText;
  readonly subtitle: OnboardingText;
  readonly footer: OnboardingText;
}

/** Данные экранов знакомства целиком — то, что лежит в `config/onboarding.default.json`. */
export interface OnboardingCatalog {
  /** версия текстов: входит в хэш показанного (правило 1 К-Б) — сменились тексты, сменился хэш */
  readonly text_version: string;
  /** сколько шагов в пути приобретения (Р-1678) */
  readonly of: number;
  /**
   * Цена своего агента — **парой** «целое в минимальных единицах + ISO 4217» (правило планов № 2, П8).
   *
   * Словом «копейка» её писать нельзя: в английской строке вышел бы неверный знак валюты, а масштаб держался бы на
   * словах. В текстах стоит `{money}`, и подставляет сумму **сервер** общим показом суммы (`src/money.ts`).
   *
   * Связь с текстами проверяется **в обе стороны** (находка ревью К1 № 2): `null` и `{money}` в каком-нибудь тексте —
   * человек увидел бы скобку вместо цены; цена задана, а подстановки нет ни в одном тексте — цена своего агента
   * (Р-1661) нигде не названа, хотя настройка её объявляет.
   */
  readonly agent_fee: UiMoney | null;
  readonly screens: Readonly<Record<OnboardingScreenId, ScreenTexts>>;
  readonly compare_title: OnboardingText;
  readonly compare: readonly CompareLine[];
  readonly models: readonly AgentModel[];
  /** «Условия демо-стенда, не оферта» (Р-1676 п. 4): пометка обязательна, пока оферты нет (Р-1657) */
  readonly demo_note: OnboardingText;
  readonly consents: readonly ConsentItem[];
  readonly texts: Readonly<Record<ScreenTextKey, OnboardingText>>;
  readonly errors: Readonly<Record<OnboardingErrorKey, OnboardingText>>;
}

/** Вид агента по опознавателю, или `null`. Решение «показывать ли» принимает сервер, не это место. */
export const modelById = (catalog: OnboardingCatalog, id: AgentModelId): AgentModel | null =>
  catalog.models.find((m) => m.id === id) ?? null;

/** Шаг экрана из данных (Р-1678). Номер берётся из файла, `of` — общий. */
export const pathStepOf = (catalog: OnboardingCatalog, screen: OnboardingScreenId): UiPathStep => ({
  n: catalog.screens[screen].n,
  of: catalog.of,
});

/** Пометка подстановки суммы в тексте. Одно имя на весь модуль: два написания разошлись бы молча, и в одном из текстов
 *  осталась бы видимая скобка вместо цены. */
export const MONEY_PLACEHOLDER = "{money}";

// ── Разбор файла данных ──────────────────────────────────────────────────────────────────────────────────────────────

function obj(raw: unknown, where: string): Record<string, unknown> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new Error(`${where}: ожидается объект`);
  return raw as Record<string, unknown>;
}

function str(raw: Record<string, unknown>, key: string, where: string): string {
  const v = raw[key];
  if (typeof v !== "string" || v.trim() === "") throw new Error(`${where}.${key}: пустая строка`);
  return v;
}

/** Пара ru/en: оба языка непустыми. Язык, появившийся с одной стороны, — ошибка формы, а не «перевод добавим потом»:
 *  правило планов № 3 требует оба с первого коммита экрана. */
function text(raw: unknown, where: string): OnboardingText {
  const t = obj(raw, where);
  for (const key of Object.keys(t)) if (key !== "ru" && key !== "en") throw new Error(`${where}.${key}: лишний язык`);
  return { ru: str(t, "ru", where), en: str(t, "en", where) };
}

/** Набор текстов с закрытым перечнем ключей: ровно известные ключи, у каждого оба языка. Лишний ключ — ошибка формы:
 *  строка, которую никто не показывает, хуже отсутствующей (приём `parseTexts` профиля предпочтений). */
function texts<K extends string>(raw: unknown, where: string, keys: readonly K[]): Readonly<Record<K, OnboardingText>> {
  const n = obj(raw, where);
  for (const key of Object.keys(n))
    if (!(keys as readonly string[]).includes(key)) throw new Error(`${where}.${key}: лишняя строка`);
  const out = {} as { -readonly [P in K]: OnboardingText };
  for (const key of keys) out[key] = text(n[key], `${where}.${key}`);
  return out;
}

/** Перечень текстов — «что может агент». Пустой перечень здесь **проходит**: пустым он законен у невыбираемого вида
 *  агента, а у выбираемого непустоту требует отдельная проверка ниже (находка ревью К1 № 8 — прежний комментарий
 *  обещал проверку, которой здесь нет). */
function textList(raw: unknown, where: string): readonly OnboardingText[] {
  if (!Array.isArray(raw)) throw new Error(`${where}: ожидается перечень`);
  return raw.map((item, i) => text(item, `${where}[${i}]`));
}

/** Целое число в заданных границах. Нецелое и вне границ — ошибка формы: номер шага «2,5 из 8» ничего не означает. */
function int(raw: Record<string, unknown>, key: string, where: string, min: number, max: number): number {
  const v = raw[key];
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < min || v > max)
    throw new Error(`${where}.${key}: ожидается целое от ${min} до ${max}`);
  return v;
}

/** Цена агента парой. Валюта вне таблицы ISO 4217 и нецелое число минимальных единиц — ошибка формы, а не тихий показ
 *  с неверным масштабом: та же строгость, что у показа суммы (`src/money.ts`). */
function money(raw: unknown, where: string): UiMoney {
  const m = obj(raw, where);
  for (const key of Object.keys(m))
    if (key !== "amount" && key !== "currency") throw new Error(`${where}.${key}: лишнее поле у суммы`);
  const amount = m["amount"];
  if (typeof amount !== "number" || !Number.isSafeInteger(amount) || amount < 0)
    throw new Error(`${where}.amount: ожидается целое число минимальных единиц`);
  const currency = str(m, "currency", where);
  if (ISO4217_MINOR_UNITS[currency as CurrencyCode] === undefined)
    throw new Error(`${where}.currency: валюты ${currency} нет в таблице ISO 4217`);
  return { amount, currency: currency as CurrencyCode };
}

const MODEL_KEYS: readonly string[] = ["id", "name", "text", "selectable", "why_not", "action_label", "can"];

/**
 * Белые списки полей **каждого** уровня файла (находка ревью К1 № 1).
 *
 * Без них лишнее поле проходило молча в трёх местах, и каждое — свой тихий дефект: `screens.P3.step` рядом с `n` —
 * второй номер шага, который никто не читает; `demo_notes` опечаткой рядом с верным `demo_note` — правленый текст не
 * показывается, а разбор зелёный; имя платёжного поля в корне файла проходило разбор, который сам же объявляет
 * «строка, которую никто не показывает, хуже отсутствующей».
 *
 * Перечни — здесь, а не в разборе по месту: проверка «ровно эти поля» должна читаться рядом с типом, которому они
 * соответствуют.
 */
const CATALOG_KEYS: readonly string[] = [
  "text_version",
  "path",
  "agent_fee",
  "screens",
  "compare_title",
  "compare",
  "models",
  "demo_note",
  "consents",
  "texts",
  "errors",
];
const PATH_KEYS: readonly string[] = ["of"];
const SCREEN_KEYS: readonly string[] = ["n", "title", "subtitle", "footer"];
const COMPARE_KEYS: readonly string[] = ["row", "label", "values"];

/** Поля уровня: ровно известные, лишнее — ошибка формы. Один помощник на все уровни, чтобы третий уровень не завёлся
 *  без проверки, как завелись эти. */
function onlyKeys(raw: Record<string, unknown>, keys: readonly string[], where: string, what: string): void {
  for (const key of Object.keys(raw)) if (!keys.includes(key)) throw new Error(`${where}.${key}: лишнее поле ${what}`);
}

/**
 * Разбор данных экранов (`config/onboarding.default.json`).
 *
 * Негодная форма — исключение при сборке сервера, а не отказ на запросе: экраны знакомства без текстов не стартуют,
 * как интерфейс без бренда. Проверяется то, чего глазами не видно:
 * 1. **все** виды агента перечня `AGENT_MODELS` на месте, без повторов и без лишних;
 * 2. **все** строки таблицы сравнения, у каждой значение у **каждого** вида агента — дыра в сравнении красная;
 * 3. **оба** согласия, без повторов и без лишних (третье согласие — решением, не файлом);
 * 4. у выбираемого вида есть подпись кнопки и непустой набор «что может агент», а причины «нельзя» нет;
 *    у невыбираемого — ровно наоборот. Иначе человек получил бы либо кнопку в тупик, либо отказ без причины;
 * 5. номер шага каждого экрана — целое от 1 до `of`;
 * 6. если в каком-нибудь тексте стоит `{money}` — цена агента в файле есть. Иначе человек увидел бы скобку вместо
 *    цены, а правило планов № 2 оказалось бы обойдено словом.
 */
export function parseOnboardingCatalog(raw: unknown): OnboardingCatalog {
  const r = obj(raw, "onboarding");
  onlyKeys(r, CATALOG_KEYS, "onboarding", "в данных экранов");
  const text_version = str(r, "text_version", "onboarding");

  const path = obj(r["path"], "onboarding.path");
  onlyKeys(path, PATH_KEYS, "onboarding.path", "у пути");
  const of = int(path, "of", "onboarding.path", 1, 64);

  const agent_fee =
    r["agent_fee"] === undefined || r["agent_fee"] === null ? null : money(r["agent_fee"], "onboarding.agent_fee");

  const rawScreens = obj(r["screens"], "onboarding.screens");
  for (const key of Object.keys(rawScreens))
    if (!(ONBOARDING_SCREENS as readonly string[]).includes(key))
      throw new Error(`onboarding.screens.${key}: лишний экран`);
  const screens = {} as { -readonly [K in OnboardingScreenId]: ScreenTexts };
  for (const id of ONBOARDING_SCREENS) {
    const where = `onboarding.screens.${id}`;
    const s = obj(rawScreens[id], where);
    onlyKeys(s, SCREEN_KEYS, where, "у экрана");
    screens[id] = {
      n: int(s, "n", where, 1, of),
      title: text(s["title"], `${where}.title`),
      subtitle: text(s["subtitle"], `${where}.subtitle`),
      footer: text(s["footer"], `${where}.footer`),
    };
  }

  const rawModels = r["models"];
  if (!Array.isArray(rawModels)) throw new Error("onboarding.models: ожидается перечень");
  const seenModels = new Set<string>();
  const models = rawModels.map((rawModel, i): AgentModel => {
    const where = `onboarding.models[${i}]`;
    const m = obj(rawModel, where);
    for (const key of Object.keys(m))
      if (!MODEL_KEYS.includes(key)) throw new Error(`${where}.${key}: лишнее поле у вида агента`);
    const id = str(m, "id", where);
    if (!isAgentModelId(id)) throw new Error(`${where}.id: ожидается ${AGENT_MODELS.join(" | ")}`);
    if (seenModels.has(id)) throw new Error(`${where}.id: повтор ${id}`);
    seenModels.add(id);
    const selectable = m["selectable"];
    if (typeof selectable !== "boolean") throw new Error(`${where}.selectable: ожидается true или false`);
    const can = textList(m["can"], `${where}.can`);
    const why_not = m["why_not"] === null || m["why_not"] === undefined ? null : text(m["why_not"], `${where}.why_not`);
    const action_label =
      m["action_label"] === null || m["action_label"] === undefined ? null : text(m["action_label"], `${where}.action_label`);
    // Выбираемый вид без кнопки и без «что может агент» — кнопка в тупик и пустой экран условий; невыбираемый с
    // кнопкой и без причины — тупик и отказ без объяснения (правило 3: недоступное объясняется текстом).
    if (selectable) {
      if (action_label === null) throw new Error(`${where}.action_label: у выбираемого вида агента нужна подпись кнопки`);
      if (can.length === 0) throw new Error(`${where}.can: у выбираемого вида агента нужен набор «что может агент»`);
      if (why_not !== null) throw new Error(`${where}.why_not: у выбираемого вида агента причины «нельзя» быть не должно`);
    } else {
      if (why_not === null) throw new Error(`${where}.why_not: у невыбираемого вида агента нужна причина`);
      if (action_label !== null) throw new Error(`${where}.action_label: у невыбираемого вида агента кнопки нет`);
      if (can.length > 0) throw new Error(`${where}.can: у невыбираемого вида агента набора «что может агент» нет`);
    }
    return { id, name: text(m["name"], `${where}.name`), text: text(m["text"], `${where}.text`), selectable, why_not, action_label, can };
  });
  for (const id of AGENT_MODELS) if (!seenModels.has(id)) throw new Error(`onboarding.models: вида агента ${id} нет`);

  const rawCompare = r["compare"];
  if (!Array.isArray(rawCompare)) throw new Error("onboarding.compare: ожидается перечень");
  const seenRows = new Set<string>();
  const compare = rawCompare.map((rawLine, i): CompareLine => {
    const where = `onboarding.compare[${i}]`;
    const line = obj(rawLine, where);
    onlyKeys(line, COMPARE_KEYS, where, "у строки сравнения");
    const row = str(line, "row", where);
    if (!(COMPARE_ROWS as readonly string[]).includes(row))
      throw new Error(`${where}.row: ожидается ${COMPARE_ROWS.join(" | ")}`);
    if (seenRows.has(row)) throw new Error(`${where}.row: повтор ${row}`);
    seenRows.add(row);
    const rawValues = obj(line["values"], `${where}.values`);
    for (const key of Object.keys(rawValues))
      if (!isAgentModelId(key)) throw new Error(`${where}.values.${key}: лишний вид агента`);
    const values = {} as { -readonly [K in AgentModelId]: OnboardingText };
    for (const id of AGENT_MODELS) values[id] = text(rawValues[id], `${where}.values.${id}`);
    return { row: row as CompareRow, label: text(line["label"], `${where}.label`), values };
  });
  for (const row of COMPARE_ROWS) if (!seenRows.has(row)) throw new Error(`onboarding.compare: строки ${row} нет`);

  const rawConsents = r["consents"];
  if (!Array.isArray(rawConsents)) throw new Error("onboarding.consents: ожидается перечень");
  const seenConsents = new Set<string>();
  const consents = rawConsents.map((rawItem, i): ConsentItem => {
    const where = `onboarding.consents[${i}]`;
    const it = obj(rawItem, where);
    for (const key of Object.keys(it))
      if (key !== "id" && key !== "text") throw new Error(`${where}.${key}: лишнее поле у согласия`);
    const id = str(it, "id", where);
    if (!isConsentId(id)) throw new Error(`${where}.id: ожидается ${CONSENT_IDS.join(" | ")}`);
    if (seenConsents.has(id)) throw new Error(`${where}.id: повтор ${id}`);
    seenConsents.add(id);
    return { id, text: text(it["text"], `${where}.text`) };
  });
  for (const id of CONSENT_IDS) if (!seenConsents.has(id)) throw new Error(`onboarding.consents: согласия ${id} нет`);

  const catalog: OnboardingCatalog = {
    text_version,
    of,
    agent_fee,
    screens,
    compare_title: text(r["compare_title"], "onboarding.compare_title"),
    compare,
    models,
    demo_note: text(r["demo_note"], "onboarding.demo_note"),
    consents,
    texts: texts(r["texts"], "onboarding.texts", SCREEN_TEXT_KEYS),
    errors: texts(r["errors"], "onboarding.errors", ONBOARDING_ERROR_KEYS),
  };
  // Цена и подстановка — **в обе стороны** (находка ревью К1 № 2). Проверяется по **всем** текстам разобранного
  // перечня, а не по тем, где цену ждут сегодня: пометка `{money}`, поставленная завтра в другой текст, должна
  // краснеть так же.
  const placeholderAt = withMoneyPlaceholder(catalog);
  if (catalog.agent_fee === null) {
    // Подстановка без суммы — видимая скобка вместо цены.
    if (placeholderAt !== null)
      throw new Error(`onboarding.agent_fee: в тексте ${placeholderAt} стоит ${MONEY_PLACEHOLDER}, а цены в настройке нет`);
  } else if (placeholderAt === null) {
    // Сумма без подстановки — цена своего агента (Р-1661) объявлена настройкой и не названа ни в одном тексте: ни
    // человек её не видит, ни показать её негде. Это та же дыра, что и обратная, и молчать о ней нельзя.
    throw new Error(
      `onboarding.agent_fee: цена задана, но ${MONEY_PLACEHOLDER} не стоит ни в одном тексте — человек её не увидит`,
    );
  }
  return catalog;
}

/** Первый текст перечня, в котором стоит подстановка суммы, с его адресом — или `null`. Адресом, а не признаком:
 *  «где-то есть {money}» не говорит, какую строку править. */
function withMoneyPlaceholder(c: OnboardingCatalog): string | null {
  const has = (t: OnboardingText): boolean => t.ru.includes(MONEY_PLACEHOLDER) || t.en.includes(MONEY_PLACEHOLDER);
  for (const screen of ONBOARDING_SCREENS) {
    const s = c.screens[screen];
    for (const [key, t] of [["title", s.title], ["subtitle", s.subtitle], ["footer", s.footer]] as const)
      if (has(t)) return `screens.${screen}.${key}`;
  }
  if (has(c.compare_title)) return "compare_title";
  for (const line of c.compare) {
    if (has(line.label)) return `compare.${line.row}.label`;
    for (const id of AGENT_MODELS) if (has(line.values[id])) return `compare.${line.row}.values.${id}`;
  }
  for (const m of c.models) {
    if (has(m.name)) return `models.${m.id}.name`;
    if (has(m.text)) return `models.${m.id}.text`;
    if (m.why_not !== null && has(m.why_not)) return `models.${m.id}.why_not`;
    if (m.action_label !== null && has(m.action_label)) return `models.${m.id}.action_label`;
    for (const [i, t] of m.can.entries()) if (has(t)) return `models.${m.id}.can[${i}]`;
  }
  if (has(c.demo_note)) return "demo_note";
  for (const item of c.consents) if (has(item.text)) return `consents.${item.id}.text`;
  for (const key of SCREEN_TEXT_KEYS) if (has(c.texts[key])) return `texts.${key}`;
  for (const key of ONBOARDING_ERROR_KEYS) if (has(c.errors[key])) return `errors.${key}`;
  return null;
}
