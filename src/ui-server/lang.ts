// Язык и тексты сервера `/ui/v1` (ИН-0, К2; контракт К-Б § 3 «Деньги, время, тексты»).
//
// Тексты человеку отдаёт **сервер** вместе с кодом: экран своих строк не держит и ничего не формулирует сам (правило 3).
// Строки живут **парами** `{ ru, en }` одним объектом, а не двумя словарями: пара держится типом, и язык не может
// появиться с одной стороны (правило планов № 3 — язык ru и en с первого коммита экрана). Бренд в тексты не вшивается:
// название и цвета берутся из конфигурации (инвариант 7), и ни одной строки с именем банка здесь нет.
import type { UiLang, UiState } from "../contract/ui-v1/index.js";

/** Языки запроса — закрытый перечень контракта (`?lang=ru|en`). Константа, а не только тип: тип в рантайме не
 *  существует, и `?lang=robot` без перечня молча прошёл бы как язык. */
export const UI_LANGS = ["ru", "en"] as const satisfies readonly UiLang[];

export const isUiLang = (s: unknown): s is UiLang => typeof s === "string" && (UI_LANGS as readonly string[]).includes(s);

/** Язык запроса: `?lang=` или язык по умолчанию. Неизвестное значение — **не ошибка** запроса: человек получает ответ
 *  на языке по умолчанию, а не 400 (как у монитора демо-стенда, П2 п. 2). */
export const langOf = (raw: string | null, fallback: UiLang): UiLang => (isUiLang(raw) ? raw : fallback);

/** Строка на двух языках. */
export type Phrase = Readonly<Record<UiLang, string>>;

/** Тексты сервера. Ключ — машинное имя, значение — пара строк человеку.
 *  `error.*` — поле `text` тела ошибки § 3; `done.*` — строка «что уже сделано» § 5.3 по состоянию ядра;
 *  `action.*` — подпись кнопки и объяснение недоступного (§ 3, правило 3). */
export const UI_TEXT = {
  // ── Ошибки (§ 3 «Ошибки», § 6) ──
  /** правило 2: у POST нет заголовка `Idempotency-Key` или он не по форме UUID v4 */
  "error.IDEMPOTENCY_REQUIRED": {
    ru: "Повторите действие: запрос пришёл без ключа повтора.",
    en: "Please repeat the action: the request arrived without a repeat key.",
  },
  /** правило 2: тот же ключ, другое тело — второго действия не будет */
  "error.IDEMPOTENCY_CONFLICT": {
    ru: "Это действие уже выполнялось с другими данными. Начните заново.",
    en: "This action has already run with different data. Please start again.",
  },
  /** один ответ на чужую, неизвестную и не по форме покупку: экрану не видно, что покупка чужая */
  "error.PURCHASE_NOT_FOUND": {
    ru: "Покупка не найдена.",
    en: "Purchase not found.",
  },
  /** код отказа ядра без своего текста: код экран показывает как есть, текст — общий */
  "error.unknown": {
    ru: "Действие не выполнено. Подробности — в коде ответа.",
    en: "The action did not complete. See the response code for details.",
  },
  /** служебные ответы, которые человек может увидеть в браузере */
  "http.not_found": { ru: "Адрес не найден.", en: "Address not found." },
  "http.method_not_allowed": { ru: "Метод не поддерживается.", en: "Method not supported." },
  "http.misdirected": { ru: "Запрос пришёл не на тот адрес.", en: "The request arrived at the wrong address." },
  "http.bad_request": { ru: "Запрос не разобран.", en: "The request could not be parsed." },
  /** сбой на нашей стороне: ответ обязателен, иначе человек видит обрыв, а процесс — незамеченное исключение */
  "http.internal": { ru: "Сбой на нашей стороне. Попробуйте ещё раз.", en: "Something went wrong on our side. Please try again." },

  /** вторая половина строки § 5.3: `{money}` подставляется форматом суммы по валюте и языку, знак валюты литералом
   *  не пишется (правило планов № 2) */
  "line.not_spent": { ru: "Не списано: {money}", en: "Not spent: {money}" },

  // ── Действия (§ 3, правило 3: доступность решает сервер) ──
  "action.stop": { ru: "Стоп", en: "Stop" },
  "action.stop.why_disabled": {
    ru: "Останавливать уже нечего: покупка завершена или остановлена.",
    en: "There is nothing left to stop: the purchase is completed or stopped.",
  },
  /** ядро остановку разрешает, но метода остановки у `/ui/v1` в ИН-0 ещё нет: доступность объявляет **сервер**
   *  (правило 3), а не экран своей подписью под живой кнопкой (находка ревью К3 № 4) */
  "action.stop.not_yet": {
    ru: "Остановить можно будет с экраном покупки — метод ещё не включён.",
    en: "Stopping will be available with the purchase screen — the method is not enabled yet.",
  },
} as const satisfies Readonly<Record<string, Phrase>>;

export type UiTextKey = keyof typeof UI_TEXT;

/**
 * Строка «что уже сделано» (§ 5.3, правка 2 канвы) — **по каждому** состоянию машины ядра.
 *
 * Отдельным словарём с типом `Record<UiState, Phrase>`, а не ключами общего словаря: перечень состояний закрыт и живёт
 * у ядра (`PURCHASE_STATES`, Р-1511 «закрытые перечни — из кода источника»). При ключах вида `done.<состояние>` связь
 * держалась бы приведением типа: появись у ядра новое состояние — `tsc` молчал бы, а строка вышла бы `undefined`
 * (находка ревью К2 № 6). Теперь новое состояние краснеет здесь, рядом с `STEP_OF_STATE` КТ-0.
 */
export const DONE_TEXT: Readonly<Record<UiState, Phrase>> = {
  NEW: { ru: "Покупка начата", en: "Purchase started" },
  INTENT_PENDING: { ru: "Поручение ждёт вашей подписи в банке", en: "The mandate is awaiting your signature in the bank" },
  INTENT_ACTIVE: { ru: "Поручение подписано, идёт поиск", en: "Mandate signed, search in progress" },
  OFFERS: { ru: "Варианты найдены", en: "Options found" },
  CART_PENDING: { ru: "Идёт живая проверка у продавца", en: "Live check with the seller in progress" },
  CART_ACTIVE: { ru: "Корзина собрана", en: "Cart assembled" },
  ORDERED: { ru: "Заказ у продавца создан", en: "Order created with the seller" },
  CONFIRMING: { ru: "Ждём вашего подтверждения", en: "Awaiting your confirmation" },
  AUTHORIZING: { ru: "Идёт оплата", en: "Payment in progress" },
  SETTLING: { ru: "Оплата прошла, ждём итога расчёта", en: "Payment authorised, awaiting settlement" },
  DONE: { ru: "Покупка завершена", en: "Purchase completed" },
  STOPPED: { ru: "Покупка остановлена", en: "Purchase stopped" },
};

export const t = (lang: UiLang, key: UiTextKey): string => UI_TEXT[key][lang];

/** Строка с подстановкой: `{имя}` заменяется значением. Подстановка — только величины, уже оформленные сервером
 *  (сумма, время); незаполненное имя остаётся в строке видимым — пустое место в тексте человеку хуже, чем заметная
 *  скобка в прогоне. */
export const fill = (lang: UiLang, key: UiTextKey, values: Readonly<Record<string, string>>): string =>
  t(lang, key).replace(/\{(\w+)\}/g, (whole, name: string) => values[name] ?? whole);
