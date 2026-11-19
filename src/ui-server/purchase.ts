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
        enabled: p.stoppable,
        label: t(lang, "action.stop"),
        why_disabled: p.stoppable ? null : t(lang, "action.stop.why_disabled"),
      },
    },
  };
}
