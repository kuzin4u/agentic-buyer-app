// Н-3, К1 — тексты итога: **данными** в `config/order.default.json`, парами ru/en, с первого коммита (правило планов
// № 3, инвариант 7, решение П36 п. 7 и Р-1693).
//
// Приём тот же, что у текстов ошибок К1.5 П-К1 и строк карточки К3 П-К4: перечень кодов закрыт **на компиляции**, а
// не на словах. Разбор файла требует **ровно** кодов перечня: пропал код — ошибка разбора, появился лишний — тоже.
// Расхождение перечня в коде и в файле ловится сборкой (`satisfies`) и тестом сверки, а не ревью.
//
// Чего здесь **нет**: строк `line.not_spent` и `DONE_TEXT`. Они живут в словаре каркаса окна Б и приходят портом
// `ShellText` (Р-1693) — своя копия дала бы два источника одной строки.
import { bilingual, obj, type Bilingual } from "../config-parse.js";
import type { UiLang } from "../contract/ui-v1/common.js";
import type { OrderResponse } from "../contract/ui-v1/methods.js";
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

export interface OrderTexts {
  readonly sources: Readonly<Record<SourceCode, Bilingual>>;
}

/** Разбор `config/order.default.json`. Ключи — ровно перечень кодов: ни пропуска, ни лишнего (Р-1511, приём К1.5). */
export function parseOrderTexts(raw: unknown): OrderTexts {
  const r = obj(raw, "order");
  for (const key of Object.keys(r)) if (key !== "sources") throw new Error(`order.${key}: лишнее поле`);

  const rawSources = obj(r["sources"], "order.sources");
  for (const key of Object.keys(rawSources))
    if (!(SOURCE_CODES as readonly string[]).includes(key)) throw new Error(`order.sources.${key}: кода нет в перечне`);
  const sources = {} as Record<SourceCode, Bilingual>;
  // Подстановок у текста источника нет: это название источника, а не строка с величинами.
  for (const code of SOURCE_CODES) sources[code] = bilingual(rawSources[code], `order.sources.${code}`, []);

  return { sources };
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
