// Контракт К-Б `/ui/v1` v1.0, § 3 «Ошибки» и § 6 «Коды `/ui` сверх кодов ядра» (КТ-0, К2.1; П30).
// Тело ошибки одно для всех методов. Коды — либо код отказа ядра (`FailureCode`), либо код `/ui` из § 6; класс повтора
// берётся у ядра (`RetryClass`), **без** `new_key`: смена ключа подписи агента экрану не принадлежит, её делает сервер.
import type { FailureCode, RetryClass } from "agentic-buyer-ref/src/shared/domain.js";
import type { UiView } from "./common.js";

/** Класс повтора, который экран может получить: `RetryClass` ядра **минус** `new_key` (§ 3 «Ошибки»).
 *  Вычитание сделано типом, а не переписанным перечнем: появится у ядра новый класс — он придёт сюда сам, и ни одного
 *  места с устаревшей копией не останется. */
export type UiRetryClass = Exclude<RetryClass, "new_key">;

/** Коды `/ui` сверх кодов ядра (§ 6) с их HTTP-статусами. Перечень закрытый: любой другой код в ответе — код ядра. */
export const UI_ERROR_STATUS = {
  /** хэш показанного не совпал или карточка устарела; новая карточка — в `error.view` (правило 1) */
  SHOWN_STALE: 409,
  /** цена изменилась при повторной проверке перед CART (§ 2 п. 3); новая карточка — в `error.view` */
  PRICE_CHANGED: 409,
  /** сумма заказа у продавца ≠ сумме CART (Т6) */
  ORDER_TOTAL_MISMATCH: 409,
  /** у позиции сигналы A5 без решения человека (`CartRefused` ядра) */
  A5_NEEDS_HUMAN: 409,
  /** метод в контракте есть, на стенде его основы нет (М2, спор, принципы, обучение) — § 7 */
  NOT_ON_STAND: 409,
  /** у POST нет заголовка `Idempotency-Key` (правило 2) */
  IDEMPOTENCY_REQUIRED: 400,
  /** тот же ключ идемпотентности, другое тело (правило 2) */
  IDEMPOTENCY_CONFLICT: 409,
  /** чужая, неизвестная или не по форме покупка — **один** ответ на все три случая (экрану не видно, что чужая) */
  PURCHASE_NOT_FOUND: 404,
  /** метод вызван не на своём шаге (`PurchaseTransitionForbidden` ядра) */
  STEP_NOT_ALLOWED: 409,
} as const satisfies Readonly<Record<string, 400 | 404 | 409>>;

/** Код `/ui` (§ 6). */
export type UiErrorCode = keyof typeof UI_ERROR_STATUS;

/** Перечень кодов `/ui` — порядок § 6 (сверяется тестом К2.4 с таблицей документа). */
export const UI_ERROR_CODES = Object.keys(UI_ERROR_STATUS) as readonly UiErrorCode[];

export const isUiErrorCode = (s: string): s is UiErrorCode => Object.prototype.hasOwnProperty.call(UI_ERROR_STATUS, s);

/** Код в ответе об отказе: код `/ui` или код отказа ядра как есть (§ 3 «Ошибки», § 6 последняя строка). */
export type UiFailureCode = UiErrorCode | FailureCode;

/** Тело ошибки — одно для всех методов (§ 3 «Ошибки»).
 *  `text` предназначен **человеку** и приходит на языке запроса; `view` заполнен, когда сервер выдаёт новую карточку
 *  (`SHOWN_STALE`, `PRICE_CHANGED`), иначе `null`. Сумм, реквизитов и `kid` в теле нет (инвариант 1). */
export interface UiErrorBody {
  readonly error: {
    readonly code: UiFailureCode;
    readonly retry: UiRetryClass;
    readonly text: string;
    readonly view: UiView | null;
  };
}
