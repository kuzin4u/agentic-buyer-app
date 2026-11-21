// Н-3, К1 — тексты итога: **данными** в `config/order.default.json`, парами ru/en, с первого коммита (правило планов
// № 3, инвариант 7, решение П36 п. 7 и Р-1693).
//
// Приём тот же, что у текстов ошибок К1.5 П-К1 и строк карточки К3 П-К4: перечень кодов закрыт **на компиляции**, а
// не на словах. Разбор файла требует **ровно** кодов перечня: пропал код — ошибка разбора, появился лишний — тоже.
// Расхождение перечня в коде и в файле ловится сборкой (`satisfies`) и тестом сверки, а не ревью.
//
// Чего здесь **нет**: строк `line.not_spent` и `DONE_TEXT`. Они живут в словаре каркаса окна Б и приходят портом
// `ShellText` (Р-1693) — своя копия дала бы два источника одной строки.
import { AGENT_DIAG } from "agentic-buyer-ref/src/agent/declines/registry.js";
import type { OperationStatus } from "agentic-buyer-ref/src/shared/domain.js";
import type { PurchaseNotice } from "agentic-buyer-ref/src/agent/ports/shop.js";
import { bilingual, obj, slotRe, str, type Bilingual } from "../config-parse.js";
import type { UiLang } from "../contract/ui-v1/common.js";
import {
  ORDER_ABSENCE_REASONS,
  SCOPE_WITHHELD_REASONS,
  type OrderAbsenceReason,
  type OrderResponse,
  type ScopeWithheldReason,
} from "../contract/ui-v1/methods.js";
import type { OrderRead } from "./port.js";

export type { Bilingual };

/**
 * Откуда взяты числа итога. Перечень **закрытый** (тип на компиляции): источник у строки итога — не свободный текст,
 * иначе человеку можно было бы написать что угодно, в том числе «по данным продавца», чего инвариант 6 не допускает.
 *
 * - `PLATFORM_FULFILMENT` — **запись об исполнении Платформы**: расчёт прошёл, у операции есть `fulfilment`;
 * - `PLATFORM_OPERATION` — **состояние операции у Платформы**: записи об исполнении ещё нет (`fulfilment` равен
 *   `null` — так у ядра до `SETTLED`), и числа итога взяты из самой операции.
 *
 * Разница названа, потому что она видна человеку: «запись об исполнении» — это окончательный расчёт, а «состояние
 * операции» ещё может измениться. Один текст на оба случая сказал бы о незавершённом расчёте то же, что об
 * окончательном.
 */
export const SOURCE_CODES = ["PLATFORM_FULFILMENT", "PLATFORM_OPERATION"] as const;

export type SourceCode = (typeof SOURCE_CODES)[number];

/**
 * Класс проверки клиринга — **код ядра**, а не своё перечисление (Р-1694, К2).
 *
 * Классы берутся у ядра двумя путями, и оба названы здесь: `WITHIN_LIMITS` — это «уведомления нет» (`scopeNotice`
 * возвращает `null`), остальные три — коды уведомлений ядра. Перечень кодов уведомлений **выводится из типа ядра**
 * (`PurchaseNotice`), поэтому новый класс у ядра делает этот модуль красным на компиляции, а не остаётся строкой,
 * которой никто не показал.
 */
export type ScopeNoticeCode = Extract<PurchaseNotice, `SCOPE_${string}`>;

export const SCOPE_CODES = [
  "WITHIN_LIMITS",
  "SCOPE_EXCEEDS_AUTHORIZATION",
  "SCOPE_NOT_RESERVED",
  "SCOPE_CHECK_UNRECOGNIZED",
] as const;

export type ScopeCode = (typeof SCOPE_CODES)[number];

/** Страж **чтения**: тип уведомлений ядра шире классов проверки клиринга, и сборка текста должна уметь спросить, её
 *  ли это код (`src/order/response.ts`). Перечень в рантайме существует только константой — тип бы не помог. */
export const isScopeCode = (s: unknown): s is ScopeCode =>
  typeof s === "string" && (SCOPE_CODES as readonly string[]).includes(s);

/** Перечень покрывает **все** классы уведомлений ядра: добавится класс у ядра — здесь станет красным. */
type ScopeCodesCoverCore = ScopeNoticeCode extends ScopeCode ? true : never;
const _scopeCodesCoverCore: ScopeCodesCoverCore = true;
void _scopeCodesCoverCore;

/**
 * Исходы операции, у которых человеку есть что сказать текстом: отказ, отмена оплаты и возврат. Перечень — **значения
 * `OperationStatus` ядра** (`satisfies`), а не свои строки.
 *
 * Причина отказа, как её прислала Платформа (`declineReason`), в ответ **не идёт**: это данные витрины внешней
 * стороны, а не готовый текст человеку (инвариант 4; § 3 «Ошибки» — код машине, текст человеку). Сопоставление «код
 * отказа ПАО → текст человеку» живёт у ядра (реестр `DIAG`), и подключает его место сборки — адрес **ИН-К6**.
 */
export const OUTCOME_CODES = ["DECLINED", "REVERSED", "REFUNDED"] as const satisfies readonly OperationStatus[];

export type OutcomeCode = (typeof OUTCOME_CODES)[number];

/** Классы, у которых **есть код у ядра**: их русский текст живёт в реестре `AGENT_DIAG`, и второй копии ему здесь не
 *  бывает (Р-1696). `WITHIN_LIMITS` в этот перечень не входит: кода у него нет — `scopeNotice` при нём молчит. */
export const SCOPE_CORE_CODES = SCOPE_CODES.filter((c): c is ScopeNoticeCode => c !== "WITHIN_LIMITS");

export interface OrderTexts {
  readonly sources: Readonly<Record<SourceCode, Bilingual>>;
  /** «в пределах поручения» — **свой** текст парами ru/en: кода у ядра для этого случая нет */
  readonly scope_within: Bilingual;
  /** английская пара к текстам ядра (Р-1696): `ru` берётся у ядра, в `config/` его нет и быть не может */
  readonly scope_en: Readonly<Record<ScopeNoticeCode, string>>;
  readonly outcomes: Readonly<Record<OutcomeCode, Bilingual>>;
  /** почему записи об исполнении или суммы нет — тексты закрытого перечня § 5.8 (Р-1695) */
  readonly reasons: Readonly<Record<OrderAbsenceReason, Bilingual>>;
  /** почему значение Платформы не показано — тексты закрытого перечня (Р-1707) */
  readonly withheld: Readonly<Record<ScopeWithheldReason, Bilingual>>;
}

/**
 * Текст класса проверки клиринга человеку (**Р-1696**, решение владельца 22.11.2026).
 *
 * Русский текст берётся **у ядра** — из реестра `AGENT_DIAG`, того же источника, откуда взят класс (Р-1694): класс и
 * текст одного класса не живут в двух местах. Так уже сделано у сервера `/ui/v1` для класса повтора
 * (`ruleForFailure`). Английская пара — своя, в `config/`: у реестра ядра обязателен только `ru` (правило
 * совместимости № 3 ядра), а интерфейс приложения двуязычный с первого коммита.
 *
 * Отменяет слова «текст человеку свой» в П36 п. 5 — см. дополнение 1 карточки. Прежние русские строки приложения
 * («выход за пределы разрешённого поручением», «сумма не была зарезервирована») были **толкованием** кода ядра и
 * расходились с ним по смыслу: у ядра сказано «списано больше одобренной суммы» — про одобренную сумму, а не про
 * предел поручения (находка ревью К2 № 5).
 */
export function scopeTextOf(code: ScopeCode, texts: OrderTexts, lang: UiLang): string {
  if (code === "WITHIN_LIMITS") return texts.scope_within[lang];
  // Язык запроса у реестра ядра может появиться позже (`DiagTexts` допускает любые языки) — тогда он берётся **раньше**
  // своей пары: источник текста один, и своя пара нужна лишь пока у ядра языка нет (находка ревью К2а № 6 — прежде
  // ветка `en` до реестра не доходила никогда, и обещание в комментарии не исполнялось).
  const human = AGENT_DIAG[code].human;
  const fromCore = human[lang];
  if (fromCore !== undefined) return fromCore;
  if (lang === "en") return texts.scope_en[code];
  return human.ru;
}

const SECTIONS = ["sources", "scope_within", "scope_en", "outcomes", "reasons", "withheld"] as const;

/** Раздел файла: ключи — ровно перечень кодов, ни пропуска, ни лишнего (Р-1511, приём К1.5 П-К1). Подстановок у этих
 *  текстов нет: это названия источника, класса и исхода, а не строки с величинами — величины показывает каркас. */
function section<C extends string>(raw: unknown, name: string, codes: readonly C[]): Readonly<Record<C, Bilingual>> {
  const r = obj(raw, `order.${name}`);
  for (const key of Object.keys(r))
    if (!(codes as readonly string[]).includes(key)) throw new Error(`order.${name}.${key}: кода нет в перечне`);
  const out = {} as Record<C, Bilingual>;
  for (const code of codes) out[code] = bilingual(r[code], `order.${name}.${code}`, []);
  return out;
}

/** Разбор `config/order.default.json`. Ключи — ровно перечни кодов: ни пропуска, ни лишнего (Р-1511, приём К1.5). */
export function parseOrderTexts(raw: unknown): OrderTexts {
  const r = obj(raw, "order");
  for (const key of Object.keys(r))
    if (!(SECTIONS as readonly string[]).includes(key)) throw new Error(`order.${key}: лишнее поле`);

  // Английская пара к текстам ядра: ключи — ровно коды ядра, и **`ru` здесь запрещён** (Р-1696). Русская строка в
  // файле означала бы вторую копию текста класса рядом с реестром ядра — разбор её не пропускает.
  const rawEn = obj(r["scope_en"], "order.scope_en");
  for (const key of Object.keys(rawEn))
    if (!(SCOPE_CORE_CODES as readonly string[]).includes(key))
      throw new Error(`order.scope_en.${key}: кода нет в перечне`);
  const scope_en = {} as Record<ScopeNoticeCode, string>;
  for (const code of SCOPE_CORE_CODES) {
    const where = `order.scope_en.${code}`;
    const one = obj(rawEn[code], where);
    for (const key of Object.keys(one))
      if (key !== "en") throw new Error(`${where}.${key}: русский текст берётся у ядра (Р-1696)`);
    const s = str(one, "en", where);
    // Подстановок у этих текстов не бывает — ни у ядра (К17 п. 6), ни здесь: проверка та же, что у пар ru/en
    // (находка ревью К2а № 7), иначе `{money}` доехал бы до человека фигурными скобками.
    for (const m of s.matchAll(slotRe())) throw new Error(`${where}.en: подстановка {${m[1] ?? ""}} здесь не бывает`);
    scope_en[code] = s;
  }

  return {
    sources: section(r["sources"], "sources", SOURCE_CODES),
    scope_within: bilingual(r["scope_within"], "order.scope_within", []),
    scope_en,
    outcomes: section(r["outcomes"], "outcomes", OUTCOME_CODES),
    reasons: section(r["reasons"], "reasons", ORDER_ABSENCE_REASONS),
    withheld: section(r["withheld"], "withheld", SCOPE_WITHHELD_REASONS),
  };
}

/** Код источника по **прочитанному**, а не по состоянию покупки: есть запись об исполнении — значит числа итога из
 *  неё, нет — значит из самой операции. Своего правила «когда считать расчёт окончательным» приложение не заводит:
 *  `fulfilment` равен `null` ровно до того, как Платформа запишет исполнение (инвариант 6 приложения, П36 п. 1). */
export const sourceCodeOf = (read: OrderRead): SourceCode =>
  // `?? null` — не придирка к типу, а выбор **более слабого** утверждения при негодных данных (находка ревью К1 № 4):
  // реализация порта собирает операцию из разобранного ответа ПАО, и ключа `fulfilment` там может не быть вовсе.
  // Со строгим `=== null` такой случай дал бы человеку «Запись об исполнении Платформы» там, где записи нет.
  (read.operation.fulfilment ?? null) === null ? "PLATFORM_OPERATION" : "PLATFORM_FULFILMENT";

/**
 * Источник и время сверки у записи итога (§ 5.8 `source`, решение П36 п. 1).
 *
 * Время берётся **из прочитанного** (`read.checked_at`) и больше ниоткуда: часов у этой функции нет, поэтому
 * подменить время показа временем сверки здесь нечем — проверяется тестом К4. Текст — из `config/` на языке запроса.
 *
 * Форму момента здесь **не проверяем и не обещаем**: `UiInstant` это `string`, и `satisfies UiInstant` на значении,
 * которое уже `UiInstant`, не проверял ничего — украшение снято (находка ревью К1 № 9). Момент приходит в приложение
 * портом, и держать его форму — дело того, кто читал у Платформы; если понадобится проверка, её место там же, где
 * значение входит в приложение, а не в сборке текста.
 */
export function sourceOf(read: OrderRead, texts: OrderTexts, lang: UiLang): OrderResponse["source"] {
  return { text: texts.sources[sourceCodeOf(read)][lang], checked_at: read.checked_at };
}
