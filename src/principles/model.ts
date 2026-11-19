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

/** Пункт профиля. Веса здесь **нет** и быть не может: карта «ранг → вес» лежит в `weights.ts` и наружу не выходит. */
export interface Principle {
  readonly id: PrincipleId;
  readonly code: PrincipleCode;
  readonly text: PrincipleText;
  readonly params: PrincipleParams;
  readonly scope: PrincipleScope;
}

/** Перечень по умолчанию с версией текстов: `text_version` входит в хэш показанного (правило 1 К-Б). */
export interface PrinciplesCatalog {
  readonly text_version: string;
  readonly items: readonly Principle[];
}

/** Код принципа «надёжное исполнение» и код «цена» — те два, между которыми стоит ст. 19 правил («вес исполнения
 *  не ниже веса цены»). Живут в модели, а не в `weights.ts`: от их присутствия зависит **проверка формы** перечня. */
export const EXECUTION_CODE: PrincipleCode = "EXECUTION";
export const PRICE_CODE: PrincipleCode = "PRICE";

/** Коды, без которых перечень не принимается. Перечень принципов **открыт** — состав установок меняется настройкой, —
 *  но ст. 19 по П32 держит сервер «ни на какой перестановке и ни на каком подмножестве». Если бы роли «исполнение» и
 *  «цена» просто искались по коду, переименование кода в `config/` **молча снимало бы правило**: веса считались бы,
 *  ст. 19 возвращала бы «не о чем», и никто бы не узнал. Обход правила настройкой — это не исполнение правила,
 *  поэтому отсутствие любого из двух кодов — ошибка формы, как неполная конфигурация бренда.
 *  **Нюанс для КТ1:** роль пункта сейчас **угадывается по коду**. Правильнее разметить её в файле отдельным полем
 *  (`role: "execution" | "price"`), и тогда код станет свободным. Это правка формы перечня, и она ждёт КТ1. */
export const REQUIRED_CODES: readonly PrincipleCode[] = [EXECUTION_CODE, PRICE_CODE];

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

/** Порядок важности — **перестановка подмножества** известных `id`: клиент переставляет пункты и любой из них
 *  выключает (решение владельца 19.11). Пустой порядок — «без принципов», и он выражается `signed: null`, а не
 *  подписанной версией без пунктов (см. `checkOrder`). */
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
 *  **К1.3** вместе со сверкой хэша: здесь сверять нечего — сюда приходит уже проверенное тело. */
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
  | { readonly reason: "DUPLICATE_ID"; readonly id: PrincipleId };

export type OrderCheck = { readonly ok: true } | ({ readonly ok: false } & OrderProblem);

/** Проверка порядка против перечня: известные `id`, без повторов, включённых — не меньше одного. Пропуски
 *  разрешены: выключенный пункт это и есть пропуск (перестановка **подмножества**). */
export function checkOrder(order: PrinciplesOrder, catalog: PrinciplesCatalog): OrderCheck {
  if (order.length === 0) return { ok: false, reason: "EMPTY" };
  const known = new Set(catalog.items.map((p) => p.id));
  const seen = new Set<PrincipleId>();
  for (const id of order) {
    if (!known.has(id)) return { ok: false, reason: "UNKNOWN_ID", id };
    if (seen.has(id)) return { ok: false, reason: "DUPLICATE_ID", id };
    seen.add(id);
  }
  return { ok: true };
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
const ITEM_KEYS: readonly string[] = ["id", "code", "text", "params", "scope"];

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
 *  Проверяется: непустой перечень, `id` и `code` по форме и **без повторов**, непустые тексты ru и en, присутствие
 *  кодов `REQUIRED_CODES` (иначе ст. 19 снималась бы настройкой — см. там). Повтор кода при разных `id` прятал бы
 *  два пункта под одним весом, поэтому красный — и то, и другое. */
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
      text: { ru: str(text, "ru", `${where}.text`), en: str(text, "en", `${where}.text`) },
      params: parseParams(it["params"], where),
      scope: parseScope(it["scope"], where),
    };
  });
  for (const code of REQUIRED_CODES)
    if (!codes.has(code)) throw new Error(`principles.items: нет пункта ${code} — ст. 19 проверять нечем`);
  return { text_version, items };
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

function parseScope(raw: unknown, where: string): PrincipleScope {
  if (raw === undefined) return { category: null, situation: null };
  const s = obj(raw, `${where}.scope`);
  for (const key of ["category", "situation"]) {
    const v = s[key];
    if (v !== undefined && v !== null) throw new Error(`${where}.scope.${key}: пока не заполняется (ВР-5, И-7)`);
  }
  return { category: null, situation: null };
}
