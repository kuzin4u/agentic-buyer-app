// П-К1 «принципы как подписываемый объект», К1.2 — модель профиля предпочтений клиента (решение П32, Р-1615).
// Профиль живёт в приложении: клиент подтверждает порядок жестом на нашем экране (хэш показанного — правило 1
// контракта К-Б, провенанс нажатия — П26), подписанные версии неизменяемы, веса наружу не выходят (правка 6 канвы,
// правило 3 К-Б). Банк профиль не подписывает; на Платформу и продавцу он не уходит.
// Здесь только модель: подпись — `signature.ts` (К1.3), чтение для выбора — К1.4, сервис `/ui/v1/principles` — К1.5.
// Маршрут и экран И-2 — ИН-0 окна Б.
import type { ShownHash, UiInstant, UiLang, UiPress } from "../contract/ui-v1/common.js";

/** Опознаватель принципа, который уходит на экран (§ 5.14 К-Б, поле `items[].id`). */
export type PrincipleId = string;

/** Код принципа для машины: `EXECUTION`, `LOCAL`, `NEAR`, `PRICE` (перечень по умолчанию — `config/`).
 *  Перечень **открыт**: это стартовые установки, а не закрытый справочник (решение владельца 19.11). */
export type PrincipleCode = string;

/** Текст принципа человеку — на обоих языках с первого коммита (правило планов № 3, инвариант 7). */
export type PrincipleText = { readonly [L in UiLang]: string };

/** Параметры пункта: порог срабатывания и сила. **Пока пустые** — форма и проверка есть, смысла ещё нет: он
 *  появится с решателями ВР-5 и журналом предпочтений И-7. Непустое значение сегодня — ошибка формы, а не
 *  молчаливое «на будущее»: иначе профиль нёс бы число, которого никто не считает.
 *  **Нюанс для КТ1:** оба поля — **безразмерные** величины (доля и сила влияния), и денежного порога здесь нет.
 *  Окажется, что порог у принципа «дешевле» денежный, — форма станет парой «минимальные единицы + ISO 4217»
 *  (правило планов № 2, тип `UiMoney`), и это правка типа. Сегодня данных в полях нет, поэтому править нечего;
 *  вопрос «денежный ли порог» вынесен на КТ1, а не решён здесь молча. */
export interface PrincipleParams {
  readonly threshold: number | null;
  readonly strength: number | null;
}

/** Область пункта: категория товара и тип ситуации. **Пока пустая** — по той же причине, что параметры. */
export interface PrincipleScope {
  readonly category: string | null;
  readonly situation: string | null;
}

/** Роль пункта в правилах системы. Роль — **поле файла**, а не угаданный код: правила (ст. 19 и «надёжное исполнение
 *  не выключается») ищут пункты **по роли**, поэтому переименование кода в `config/` правило не снимет. Настройка не
 *  должна снимать норму (решение владельца 19.11, П32 дополнение 1). У остальных пунктов роли нет — `null`. */
export const PRINCIPLE_ROLES = ["execution", "price"] as const;

export type PrincipleRole = (typeof PRINCIPLE_ROLES)[number];

/** Пункт профиля. Веса здесь **нет** и быть не может: карта «ранг → вес» лежит в `weights.ts` и наружу не выходит. */
export interface Principle {
  readonly id: PrincipleId;
  readonly code: PrincipleCode;
  readonly role: PrincipleRole | null;
  readonly text: PrincipleText;
  readonly params: PrincipleParams;
  readonly scope: PrincipleScope;
}

/** Строки-пояснения под списком — **данными**, как и сами принципы (правило планов № 3: оба языка с первого
 *  коммита). Это тексты правил системы, а не тексты клиента:
 *  - `execution_always` — «надёжность исполнения учитывается всегда»: человеку сказано, почему пункт не выключается
 *    (решение владельца 19.11);
 *  - `price_capped` — «цена учитывается не выше надёжности исполнения»: показывается, когда ст. 19 опустила вес цены.
 *    Правило не прячется: порядок клиента принят, но что сделал сервер — сказано. */
export const NOTE_KEYS = ["execution_always", "price_capped"] as const;

export type NoteKey = (typeof NOTE_KEYS)[number];

export type PrinciplesNotes = { readonly [K in NoteKey]: PrincipleText };

/** Перечень по умолчанию с версией текстов: `text_version` входит в хэш показанного (правило 1 К-Б). */
export interface PrinciplesCatalog {
  readonly text_version: string;
  readonly notes: PrinciplesNotes;
  readonly items: readonly Principle[];
}

/** Пункт с этой ролью, или `null`, если такого в перечне нет. Проверка формы требует по одному пункту на каждую
 *  роль, так что у разобранного перечня обе роли есть; `null` остаётся для перечня, собранного в обход разбора. */
export function byRole(catalog: PrinciplesCatalog, role: PrincipleRole): Principle | null {
  return catalog.items.find((p) => p.role === role) ?? null;
}

/** Откуда взялось изменение версии. Перечень **открытый**: сегодня профиль меняет клиент, с обучением У10 (И-8)
 *  добавится принятый совет, дальше — то, чего мы ещё не знаем. Поэтому тип — строка, а не замкнутое объединение:
 *  неизвестное значение читается, а не ломает чтение прежних версий. */
export type ChangeSource = string;

/** Значения, которые известны сегодня. `LEARNING_ACCEPTED` заведён заранее: он нужен И-8, и без него источник
 *  изменения пришлось бы расширять правкой типа. */
export const KNOWN_CHANGE_SOURCES = ["CLIENT", "LEARNING_ACCEPTED"] as const;

export type KnownChangeSource = (typeof KNOWN_CHANGE_SOURCES)[number];

export function isKnownChangeSource(source: ChangeSource): source is KnownChangeSource {
  return (KNOWN_CHANGE_SOURCES as readonly string[]).includes(source);
}

/** Порядок важности — **перестановка подмножества** известных `id`: клиент переставляет пункты и выключает их —
 *  **кроме пункта с ролью «исполнение»** (решение владельца 19.11, П32 дополнение 1: ст. 19 это норма системы, а не
 *  настройка клиента). Пустой порядок — «без принципов», и он выражается `signed: null`, а не подписанной версией
 *  без пунктов (см. `checkOrder`). */
export type PrinciplesOrder = readonly PrincipleId[];

/** Что в карточке видел человек, когда подтверждал: хэш показанного и версия текстов (правило 1 К-Б).
 *  Хэш считает `showingHash` (`src/contract/ui-v1/shown-hash.ts`, канонизация ядра — Р-1613), а не экран. */
export interface PrinciplesView {
  readonly hash: ShownHash;
  readonly text_version: string;
}

/** Подписанная версия профиля. **Неизменяема:** новая подпись прежнюю не стирает и не правит, `no` растёт на единицу.
 *  `received_at` — время **получения сервером**; время устройства живёт в `press.at` и им не заменяется (П26). */
export interface SignedPrinciples {
  readonly no: number;
  readonly order: PrinciplesOrder;
  readonly view: PrinciplesView;
  readonly press: UiPress;
  readonly received_at: UiInstant;
  readonly source: ChangeSource;
}

/** Первый номер версии: нумерация человеческая, с единицы. */
export const FIRST_VERSION_NO = 1;

/** Следующая версия профиля. Прежнюю **не трогает**: возвращается новый объект, номер — предыдущий плюс один, а
 *  `prev` остаётся как был (и заморожен). Хранение — порт `PrinciplesStore` (К1.3); здесь только правило номера и
 *  неизменяемости, потому что именно оно делает версию «подписанной», а не записью в хранилище.
 *  `received_at` — время **получения сервером**; время устройства живёт в `press.at`, и сервер им не заменяет своё
 *  и не подменяет чужое (П26).
 *  **Копируются и замораживаются все слои, а не только верхний:** `view` и `press` вставленные ссылкой остались бы
 *  изменяемыми, и тогда у подписанной версии можно было бы задним числом поправить хэш показанного (правило 1 К-Б)
 *  и провенанс нажатия (П26) — то самое, на чём держится «версия неизменяема» (П32).
 *  **Сверку `view.text_version` с `press.text_version`** (подпись под теми же текстами, что человек видел) делает
 *  `signPrinciples` (К1.3) вместе со сверкой хэша: расхождение — `SHOWN_STALE` с новой карточкой. Здесь сверять
 *  нечего — сюда приходит уже проверенное тело. */
export function nextVersion(
  prev: SignedPrinciples | null,
  built: {
    readonly order: PrinciplesOrder;
    readonly view: PrinciplesView;
    readonly press: UiPress;
    readonly received_at: UiInstant;
    readonly source: ChangeSource;
  },
): SignedPrinciples {
  return Object.freeze({
    no: prev === null ? FIRST_VERSION_NO : prev.no + 1,
    order: Object.freeze([...built.order]),
    view: Object.freeze({ hash: built.view.hash, text_version: built.view.text_version }),
    press: Object.freeze({
      at: built.press.at,
      device: built.press.device,
      text_version: built.press.text_version,
      gesture: built.press.gesture,
    }),
    received_at: built.received_at,
    source: built.source,
  });
}

/** Почему порядок не принят. Код ответа `/ui` у неверного порядка в § 6 контракта **не назван** — это вопрос КТ1,
 *  и придумывать его здесь нельзя (постановка v1.1, К1.3). Поэтому модель говорит причину, а не код ошибки. */
export type OrderProblem =
  | { readonly reason: "EMPTY" }
  | { readonly reason: "UNKNOWN_ID"; readonly id: PrincipleId }
  | { readonly reason: "DUPLICATE_ID"; readonly id: PrincipleId }
  | { readonly reason: "EXECUTION_MISSING"; readonly id: PrincipleId };

export type OrderCheck = { readonly ok: true } | ({ readonly ok: false } & OrderProblem);

/** Проверка порядка против перечня: известные `id`, без повторов, включённых — не меньше одного, и **пункт с ролью
 *  «исполнение» на месте**. Прочие пропуски разрешены: выключенный пункт это и есть пропуск (перестановка
 *  **подмножества**).
 *  Экрану все четыре причины уходят **одним** кодом `PRINCIPLES_ORDER_INVALID` (400); причина остаётся внутри
 *  уточнением (решение владельца 19.11, П32 дополнение 1). */
export function checkOrder(order: PrinciplesOrder, catalog: PrinciplesCatalog): OrderCheck {
  if (order.length === 0) return { ok: false, reason: "EMPTY" };
  const known = new Set(catalog.items.map((p) => p.id));
  const seen = new Set<PrincipleId>();
  for (const id of order) {
    if (!known.has(id)) return { ok: false, reason: "UNKNOWN_ID", id };
    if (seen.has(id)) return { ok: false, reason: "DUPLICATE_ID", id };
    seen.add(id);
  }
  const execution = byRole(catalog, "execution");
  if (execution !== null && !seen.has(execution.id))
    return { ok: false, reason: "EXECUTION_MISSING", id: execution.id };
  return { ok: true };
}

/** Порядок, приведённый к нынешнему перечню: пункт, которого в перечне больше нет, из него выпадает.
 *  Перечень — **данные** и меняется настройкой (П32), а подписанные версии неизменяемы, поэтому пункт могли убрать
 *  из `config/` уже после подписи. Приведение делается **в одном месте** и для рангов, и для весов: иначе человек
 *  видел бы ранги одного набора, а ранжирование шло бы по другому (находка ревью К1.4 № 7). */
export function knownOrder(order: PrinciplesOrder, catalog: PrinciplesCatalog): PrinciplesOrder {
  const known = new Set(catalog.items.map((p) => p.id));
  return order.filter((id) => known.has(id));
}

/** Порядок по умолчанию — порядок пунктов в файле перечня. Подписанным он **не считается**: пока клиент не
 *  подтвердил свой порядок жестом, у профиля `signed: null` (К1.4). */
export function defaultOrder(catalog: PrinciplesCatalog): PrinciplesOrder {
  return catalog.items.map((p) => p.id);
}

const ID = /^prn_[a-z0-9_]+$/;
const CODE = /^[A-Z][A-Z0-9_]*$/;

/** Поля пункта, и только они. Лишний ключ — ошибка формы, а не молчаливо пропущенные данные: иначе в перечень можно
 *  было бы положить `"weight": 99` и ждать, что его кто-нибудь прочитает. Веса в перечне нет (П32, правка 6 канвы). */
const ITEM_KEYS: readonly string[] = ["id", "code", "role", "text", "params", "scope"];

function str(raw: Record<string, unknown>, key: string, where: string): string {
  const v = raw[key];
  if (typeof v !== "string" || v.trim() === "") throw new Error(`${where}.${key}: пустая строка`);
  return v;
}

function obj(raw: unknown, where: string): Record<string, unknown> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new Error(`${where}: ожидается объект`);
  return raw as Record<string, unknown>;
}

/** Разбор перечня по умолчанию (`config/principles.default.json`). Перечень — **данные**, не код: тексты банка и
 *  состав установок меняются настройкой (инвариант 7 читается так же, как для бренда). Неверная форма — ошибка:
 *  профиль без перечня не стартует, как интерфейс без бренда.
 *  Проверяется: непустой перечень, `id` и `code` по форме и **без повторов**, непустые тексты ru и en, **ровно один
 *  пункт на каждую роль** (`execution`, `price`) — иначе ст. 19 и правило «исполнение не выключается» снимались бы
 *  настройкой. Повтор кода при разных `id` прятал бы два пункта под одним весом, поэтому красный — и то, и другое. */
export function parsePrinciplesCatalog(raw: unknown): PrinciplesCatalog {
  const r = obj(raw, "principles");
  const text_version = str(r, "text_version", "principles");
  const rawItems = r["items"];
  if (!Array.isArray(rawItems) || rawItems.length === 0) throw new Error("principles.items: пустой перечень");
  const ids = new Set<string>();
  const codes = new Set<string>();
  const items = rawItems.map((rawItem, i): Principle => {
    const where = `principles.items[${i}]`;
    const it = obj(rawItem, where);
    const id = str(it, "id", where);
    if (!ID.test(id)) throw new Error(`${where}.id: ожидается prn_<латиница>`);
    if (ids.has(id)) throw new Error(`${where}.id: повтор ${id}`);
    ids.add(id);
    const code = str(it, "code", where);
    if (!CODE.test(code)) throw new Error(`${where}.code: ожидается ПРОПИСНЫМИ`);
    if (codes.has(code)) throw new Error(`${where}.code: повтор ${code}`);
    codes.add(code);
    for (const key of Object.keys(it))
      if (!ITEM_KEYS.includes(key)) throw new Error(`${where}.${key}: лишнее поле у пункта`);
    const text = obj(it["text"], `${where}.text`);
    return {
      id,
      code,
      role: parseRole(it["role"], where),
      text: { ru: str(text, "ru", `${where}.text`), en: str(text, "en", `${where}.text`) },
      params: parseParams(it["params"], where),
      scope: parseScope(it["scope"], where),
    };
  });
  const notes = parseNotes(r["notes"]);
  for (const role of PRINCIPLE_ROLES) {
    const withRole = items.filter((p) => p.role === role);
    if (withRole.length !== 1)
      throw new Error(`principles.items: роль ${role} у ${withRole.length} пунктов, нужен ровно один`);
  }
  return { text_version, notes, items };
}

/** Строки-пояснения: ровно известные ключи, у каждого оба языка непустыми. Лишний ключ — ошибка формы: строка,
 *  которую никто не показывает, хуже отсутствующей. */
function parseNotes(raw: unknown): PrinciplesNotes {
  const n = obj(raw, "principles.notes");
  for (const key of Object.keys(n))
    if (!(NOTE_KEYS as readonly string[]).includes(key)) throw new Error(`principles.notes.${key}: лишняя строка`);
  const out = {} as { -readonly [K in NoteKey]: PrincipleText };
  for (const key of NOTE_KEYS) {
    const where = `principles.notes.${key}`;
    const t = obj(n[key], where);
    out[key] = { ru: str(t, "ru", where), en: str(t, "en", where) };
  }
  return out;
}

/** Параметры и область **пока пусты**: поля в файле можно не писать совсем, но непустое значение — ошибка формы.
 *  Так форма готова к ВР-5, а смысла, которого ещё нет, в профиле не завелось. */
function parseParams(raw: unknown, where: string): PrincipleParams {
  if (raw === undefined) return { threshold: null, strength: null };
  const p = obj(raw, `${where}.params`);
  for (const key of ["threshold", "strength"]) {
    const v = p[key];
    if (v !== undefined && v !== null) throw new Error(`${where}.params.${key}: пока не заполняется (ВР-5)`);
  }
  return { threshold: null, strength: null };
}

/** Роль пункта: `execution`, `price` или ничего. Незнакомая роль — ошибка формы, а не «без роли»: иначе опечатка в
 *  `config/` тихо лишала бы правило его пункта. */
function parseRole(raw: unknown, where: string): PrincipleRole | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "string" || !(PRINCIPLE_ROLES as readonly string[]).includes(raw))
    throw new Error(`${where}.role: ожидается ${PRINCIPLE_ROLES.join(" | ")} или ничего`);
  return raw as PrincipleRole;
}

function parseScope(raw: unknown, where: string): PrincipleScope {
  if (raw === undefined) return { category: null, situation: null };
  const s = obj(raw, `${where}.scope`);
  for (const key of ["category", "situation"]) {
    const v = s[key];
    if (v !== undefined && v !== null) throw new Error(`${where}.scope.${key}: пока не заполняется (ВР-5, И-7)`);
  }
  return { category: null, situation: null };
}
