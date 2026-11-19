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
  type UiErrorBody,
  type UiErrorCode,
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

/** Класс повтора по умолчанию для каждого кода `/ui` (§ 6). Назван по коду, а не одним значением на всех: `retry` — это
 *  инструкция человеку, и «начните заново» вместо «повторите» меняет его действие.
 *  Перечень полный по типу `UiErrorCode`: появится в § 6 новый код — здесь покраснеет, а не отдастся молча с чужим
 *  классом повтора. */
const UI_RETRY: Readonly<Record<UiErrorCode, UiRetryClass>> = {
  /** человек смотрит новую карточку из `error.view` и решает заново */
  SHOWN_STALE: "after_human",
  PRICE_CHANGED: "after_human",
  /** сумма заказа ≠ сумме CART: сам по себе повтор ничего не исправит, нужно решение человека */
  ORDER_TOTAL_MISMATCH: "after_human",
  A5_NEEDS_HUMAN: "after_human",
  /** основы метода на стенде нет — повтор не поможет никогда */
  NOT_ON_STAND: "never",
  /** экран добавит ключ и повторит сам */
  IDEMPOTENCY_REQUIRED: "after_fix",
  /** тем же ключом с другим телом повторять нельзя: новое действие — новый ключ */
  IDEMPOTENCY_CONFLICT: "after_fix",
  /** повтор того же запроса ответа не изменит */
  PURCHASE_NOT_FOUND: "never",
  STEP_NOT_ALLOWED: "never",
  /** экран поправит порядок и пошлёт снова */
  PRINCIPLES_ORDER_INVALID: "after_fix",
};

/** Статус для кода отказа **ядра**: таблицы «код ядра → статус HTTP» нет ни у ядра, ни в контракте К-Б v1.0, и
 *  домысливать её нельзя. 409 — «состояние не позволяет», и это верно для отказа ядра на границе `/ui/v1`: запрос
 *  разобран, авторизован и адресован живой покупке, но ядро действие не выполнило. Отсутствие такой таблицы в
 *  контракте — **вопрос к К-Б v1.1**, строка в STATUS «Открыто»; до ответа статус один и назван здесь, а не
 *  раскидан по маршрутам. */
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
