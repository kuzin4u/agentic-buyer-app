// `GET /ui/v1/purchase/{purchase_id}` — состояние покупки (ИН-0, К2; контракт К-Б § 5.3).
//
// Сервер отдаёт `state` ядра **и** `step` экрана вместе (§ 4): таблицу «состояние → шаг» держит КТ-0 (`STEP_OF_STATE`),
// экран своей не имеет (правило 3). Строку «что уже сделано и что не списано» собирает сервер — экран суммы не
// складывает и остаток не считает (инвариант 2: остаток только из `verify` ядра, он приходит портом как есть).
// Доступность «Стоп» приходит от ядра вместе с объяснением недоступного: кнопка не выводится из состояния здесь.
import { STEP_OF_STATE, type PurchaseResponse, type UiLang } from "../contract/ui-v1/index.js";
import { DONE_TEXT, fill, t } from "./lang.js";
import { formatUiMoney } from "./money.js";
import type { CorePurchase } from "./port.js";

/**
 * Включён ли метод остановки у `/ui/v1`.
 *
 * В ИН-0 зарегистрированы только `purchase` и `feed` (постановка, «Чего в задаче нет»), поэтому разрешённая ядром
 * остановка на экране всё равно недоступна — и сказать об этом обязан **сервер** (правило 3 «доступность решает
 * сервер»), а не экран своей подписью под живой кнопкой: это была находка ревью К3 № 4. Признак назван одним местом
 * и переключается одной строкой вместе с появлением метода; решение ядра (`stoppable`) при этом не подменяется —
 * оно остаётся первым условием доступности.
 */
const STOP_METHOD_READY = false;

/** Ответ § 5.3 из данных ядра. Ни одной величины здесь не вычисляется: `amount_left`, `valid_to` и `as_of` идут из
 *  `verify` как есть, а текст — это формат той же величины, а не её пересчёт. */
export function purchaseResponse(p: CorePurchase, lang: UiLang): PurchaseResponse {
  const step = STEP_OF_STATE[p.state];
  return {
    purchase_id: p.purchase_id,
    state: p.state,
    step,
    intent: p.intent,
    done_line: {
      done: DONE_TEXT[p.state][lang],
      not_spent: fill(lang, "line.not_spent", { money: formatUiMoney(p.intent.amount_left, lang) }),
    },
    stops: p.stops,
    actions: {
      stop: {
        enabled: p.stoppable && STOP_METHOD_READY,
        label: t(lang, "action.stop"),
        // Две причины недоступности — разные, и человеку они говорят разное: «останавливать нечего» (решение ядра) и
        // «метод ещё не включён» (состояние приложения). Одной строкой на оба случая вторая причина выглядела бы
        // как первая.
        why_disabled: p.stoppable ? (STOP_METHOD_READY ? null : t(lang, "action.stop.not_yet")) : t(lang, "action.stop.why_disabled"),
      },
    },
  };
}
