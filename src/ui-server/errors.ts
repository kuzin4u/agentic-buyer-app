// Одно тело ошибки на все методы `/ui/v1` (ИН-0, К2; контракт К-Б § 3 «Ошибки», § 6).
//
// Тело собирается **одной** функцией, а не по месту вызова: иначе один маршрут отдавал бы `retry`, другой — нет, и экран
// не смог бы показывать «что делать» единообразно. Статус берётся из таблицы § 6 (`UI_ERROR_STATUS`) — своей копии
// статусов здесь нет. Код отказа ядра проходит **как есть** (§ 6, последняя строка): перечень кодов ядра не
// переписывается, иначе он разошёлся бы с ядром на первом же новом коде.
// В теле нет сумм, реквизитов, `kid` и криптограммы (инвариант 1); `new_key` в `retry` невозможен типом `UiRetryClass`
// (§ 3: смена ключа подписи агента экрану не принадлежит — её делает сервер).
//
// Класс повтора у кода **ядра** берётся **у ядра** (`ruleForFailure`, таблица `FAILURE_RULES`), а не придумывается здесь
// (находка ревью К2 № 3; инвариант 2 «решения — у ядра»): у `STATE_UNAVAILABLE`, `RATE_LIMITED` и
// `UPSTREAM_UNAVAILABLE` ядро говорит «повторим тем же ключом», и своё умолчание «нужно решение человека» посылало бы
// человека делать то, что сделает агент сам.
import { ruleForFailure } from "agentic-buyer-ref/src/agent/declines/table.js";
import type { FailureCode } from "agentic-buyer-ref/src/shared/domain.js";
import {
  isUiErrorCode,
  UI_ERROR_STATUS,
  UI_RETRY,
  type UiErrorBody,
  type UiFailureCode,
  type UiLang,
  type UiRetryClass,
  type UiView,
} from "../contract/ui-v1/index.js";
import { t, UI_TEXT, type UiTextKey } from "./lang.js";

/** Ответ об отказе: статус HTTP и тело § 3. */
export interface UiErrorOut {
  readonly status: number;
  readonly body: UiErrorBody;
}

// Своей таблицы классов повтора у сервера больше нет: она переехала в контракт (`UI_RETRY`,
// `src/contract/ui-v1/errors.ts`) кирпичом К7 ИН-П1 по решениям **Р-1681** и **Р-1685**. Класс повтора — одна норма
// на приложение, и с К-Б v1.3 он назван в § 6 документа вместе с источником, поэтому сервер его не решает, а берёт.
// Прежняя таблица стояла здесь и однажды разошлась с таблицей принципов на `IDEMPOTENCY_REQUIRED` — это и был довод.
/** Статус для кода отказа **ядра**: таблицы «код ядра → статус HTTP» нет ни у ядра, ни в контракте К-Б v1.0, и
 *  домысливать её нельзя. 409 — «состояние не позволяет», и это верно для отказа ядра на границе `/ui/v1`: запрос
 *  разобран, авторизован и адресован живой покупке, но ядро действие не выполнило. Отсутствие такой таблицы в
 *  контракте — **вопрос к следующей версии документа** (в v1.3 такой таблицы по-прежнему нет), строка в STATUS
 *  «Открыто»; до ответа статус один и назван здесь, а не раскидан по маршрутам. */
const CORE_STATUS = 409;

/** Класс повтора кода ядра — из таблицы ядра. `new_key` экрану не отдаётся (§ 3): смену ключа подписи агента делает
 *  сервер, а экран повторяет то же действие **тем же** своим ключом — то есть `same_key`. Подмена названа здесь, а не
 *  спрятана: для экрана это «повторите тем же ключом», для сервера — «смени ключ подписи и повтори». */
const coreRetry = (code: FailureCode): UiRetryClass => {
  const retry = ruleForFailure(code).retry;
  return retry === "new_key" ? "same_key" : retry;
};

const hasOwn = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

/** Текст человеку: свой, если он есть в словаре под ключом `error.<код>`, иначе общий. Величину в строке («Сумма больше
 *  остатка: 632 ₽») передаёт вызывающий через `text` — её сервер считает по данным ядра, а не словарь. */
function textOf(code: UiFailureCode, lang: UiLang): string {
  const key = `error.${code}`;
  return hasOwn(UI_TEXT, key) ? t(lang, key as UiTextKey) : t(lang, "error.unknown");
}

export function uiError(
  code: UiFailureCode,
  lang: UiLang,
  o: { readonly retry?: UiRetryClass; readonly text?: string; readonly view?: UiView | null } = {},
): UiErrorOut {
  const ui = isUiErrorCode(code);
  return {
    status: ui ? UI_ERROR_STATUS[code] : CORE_STATUS,
    body: {
      error: {
        code,
        retry: o.retry ?? (ui ? UI_RETRY[code] : coreRetry(code)),
        text: o.text ?? textOf(code, lang),
        view: o.view ?? null,
      },
    },
  };
}
