// Н-3, К2 — тело итога § 5.8 **по исходу чтения покупки** (правило 4 К-Б, П31, решение П36 п. 2).
//
// Три правила, которые эта сборка держит собой, а не комментарием:
//
// 1. **Событие потока в сборку не приходит вовсе.** Поток — только сигнал (правило 4): он говорит «что-то
//    изменилось», и после него экран перечитывает § 5.8. Поэтому у сборки один вход — прочитанное (`OrderRead`), и
//    подменить ответ событием нечем: параметра для события нет (проверяется компиляцией в тесте К2).
// 2. **Ничего не складывается.** `spent_position` переносится как есть (инвариант 6 ядра, инвариант 2 приложения),
//    `final` — сумма записи об исполнении, `amount` — сумма операции; три величины остаются тремя, и ни одна не
//    выводится из других.
// 3. **Цена агента и акт не придумываются** (Р-1691): оба приходят прочитанными и перекладываются как есть.
//
// Чего сборка **не делает**: не решает, окончателен ли расчёт (это `fulfilment` ядра), не судит класс проверки
// клиринга (это `scopeNotice` ядра, Р-1694) и не печатает суммы в строку «не списано» (это каркас портом, Р-1693).
import { scopeNotice } from "agentic-buyer-ref/src/agent/operations/notice.js";
import type { PurchaseNotice } from "agentic-buyer-ref/src/agent/ports/shop.js";
import type { Fulfilment, Operation } from "agentic-buyer-ref/src/shared/domain.js";
import { hasCardNumber } from "../card-guard.js";
import type { UiLang } from "../contract/ui-v1/common.js";
import type { OrderAbsenceReason, OrderResponse, ScopeWithheldReason } from "../contract/ui-v1/methods.js";
import { stepOfState } from "../contract/ui-v1/steps.js";
import type { OrderRead, ShellText } from "./port.js";
import { isScopeCode, scopeTextOf, sourceOf, type OrderTexts, type ScopeCode } from "./texts.js";

/** Чем заполняется тело: язык запроса, тексты из `config/` и строки словаря каркаса портом (Р-1693). */
export interface OrderBodyDeps {
  readonly lang: UiLang;
  readonly texts: OrderTexts;
  readonly shell: ShellText;
}

/**
 * Итога ещё нет — это **состояние, а не отказ** (решение владельца 21.11.2026, 23:55 — **Р-1695**; К-Б v1.4 § 5.8).
 *
 * `fulfilment` у Платформы появляется только с расчётом: до `SETTLED` его нет, а у `REVERSED` и у возврата без
 * клиринга записи может не быть вовсе; сумма операции в ПАО 1.4.0 тоже приходит не всегда. Приложение записи **не
 * придумывает и ближайшего известного не подставляет**: поле становится нулевым, рядом встаёт `reason` из закрытого
 * перечня, а источник и время сверки есть **всегда** — человеку говорят не «ничего нет», а «итога ещё нет, проверено
 * во столько».
 *
 * Прежняя форма кирпича К2 (`ok: false` вместо тела) отменена: по § 4 состояние `SETTLING` — это шаг У7, то есть
 * покупка на своём шаге и метод вызван верно; кода отказа у случая нет и класс повтора не нужен.
 */
export const absenceReasonOf = (operation: Operation): OrderAbsenceReason | null => {
  if ((operation.fulfilment ?? null) === null) return "FULFILMENT_ABSENT";
  if ((operation.amount ?? null) === null) return "OPERATION_AMOUNT_ABSENT";
  return null;
};

/**
 * Код класса по уведомлению ядра. Класс — **у ядра** (Р-1694): `scopeNotice` молчит при `WITHIN_LIMITS` и отвечает
 * своим кодом во всех прочих случаях, включая значение вне перечня. Своей ветви `typeof scope_check === "object"`
 * здесь нет: она была бы вторым правилом рядом с правилом ядра. Русский текст того же класса — тоже ядра (Р-1696,
 * `scopeTextOf`). Функция **названа и вывезена** нарочно (находка ревью К2 № 4): запасная ветвь через
 * `scopeNotice` недостижима — ядро по записи об исполнении отвечает только кодами `SCOPE_*`, — и пока ветвь была
 * внутри сборки текста, подлог запасного кода на `WITHIN_LIMITS` оставался зелёным. Отдельная функция проверяется
 * прямо, приведением чужого кода уведомления.
 *
 * Тип уведомлений ядра шире классов проверки клиринга (в нём есть и `CONFIRMATION_PENDING`, и `OPERATION_REFUNDED`).
 * Ответит ядро по записи об исполнении иным кодом — приложение берёт **самое слабое** утверждение «значение не
 * опознано», а не «в пределах поручения»: сказать человеку «всё в порядке» по коду, которого мы не знаем, значит
 * догадаться (инвариант 6, П36 п. 5).
 */
export const scopeCodeOfNotice = (notice: PurchaseNotice | null): ScopeCode =>
  notice === null ? "WITHIN_LIMITS" : isScopeCode(notice) ? notice : "SCOPE_CHECK_UNRECOGNIZED";

/**
 * Просеять значение `scope_check`, пришедшее от Платформы (решение владельца 22.11.2026, **Р-1707**).
 *
 * Просеивает **сервер**, а не экран: экран, который сам решает, что прятать, — это экран, который считает (правило 3
 * К-Б). Похожее на номер ищет общий фильтр приложения `hasCardNumber` (R41, `src/card-guard.ts`) — своей регулярки и
 * своего перечня здесь нет (Р-1511). Значение наружу не возвращается: функция отвечает только кодом непоказа.
 *
 * Просеивается **только** значение вне перечня (`{ other }`): известные классы — это коды ядра, в них цифр нет.
 */
export function withheldScope(fulfilment: Fulfilment | null): ScopeWithheldReason | null {
  if (fulfilment === null) return null;
  const s = fulfilment.scopeCheck;
  if (typeof s !== "object" || s === null) return null;
  const value = s.other;
  return typeof value === "string" && hasCardNumber(value) ? "LOOKS_LIKE_CARD" : null;
}

/** Текст исхода операции человеку: отказ и отмена оплаты — в `operation.decline_text`, возврат — в `refund.text`.
 *  Причина Платформы (`declineReason`) наружу не идёт (см. `OUTCOME_CODES`). */
const outcomeText = (operation: Operation, deps: OrderBodyDeps): string | null =>
  operation.status === "DECLINED" || operation.status === "REVERSED"
    ? deps.texts.outcomes[operation.status][deps.lang]
    : null;

/**
 * Тело § 5.8 из прочитанного.
 *
 * Тело собирается **всегда** (Р-1695): нулевые поля и причина рядом с ними, источник и время сверки — в каждом ответе.
 * Ни одного `now()`, ни одного сложения, ни одной проверки «а итог ли это» — такой проверки больше нет и быть не
 * должно: итога ещё нет это состояние, а не повод не отвечать.
 */
export function orderBody(read: OrderRead, deps: OrderBodyDeps): OrderResponse {
  const operation = read.operation;
  const fulfilment = operation.fulfilment ?? null;
  const reason = absenceReasonOf(operation);
  const withheld = withheldScope(fulfilment);
  // Шаг экрана — таблицей контракта (КТ-0), а не своим правилом: у приложения таблицы шагов нет (правило 3).
  // Линии пути числами в теле нет: см. комментарий у `OrderResponse` — числа для шагов использования не из источника.
  const step = stepOfState(read.state);

  return {
    state: read.state,
    step,
    operation: {
      status: operation.status,
      // Суммы может не быть (ПАО 1.4.0) — тогда `null`, а не сумма записи об исполнении вместо неё.
      amount: operation.amount ?? null,
      decline_text: outcomeText(operation, deps),
    },
    fulfilment:
      fulfilment === null
        ? null
        : {
            final: fulfilment.finalAmount,
            // Значение Платформы переносится как есть, в том числе `{ other }`: догадки нет (П36 п. 5). Исключение
            // одно — значение, похожее на номер карты: его просеивает **сервер** (Р-1707), см. `withheldScope`.
            scope_check: withheld === null ? fulfilment.scopeCheck : { other: null },
            scope_text: scopeTextOf(scopeCodeOfNotice(scopeNotice(operation)), deps.texts, deps.lang),
            withheld,
            withheld_text: withheld === null ? null : deps.texts.withheld[withheld][deps.lang],
            // `spent_position` — величина Платформы: ни сложения, ни пересчёта (инвариант 6 ядра).
            spent_position: fulfilment.spentPosition,
            at: fulfilment.at,
          },
    reason,
    // Готовый текст причины — рядом с кодом (Р-1697): экран его не собирает и своего словаря причин не держит.
    reason_text: absenceTextOf(reason, deps),
    // Источник и время сверки есть **всегда**, в том числе когда итога ещё нет (Р-1695, П36).
    source: sourceOf(read, deps.texts, deps.lang),
    done_line: {
      done: deps.shell.done(read, deps.lang),
      // «Не списано» — остаток поручения из `verify`, а не разница (Р-1692): в порт уходит `verify` целиком, и
      // разницу передать нечем.
      not_spent: deps.shell.notSpent(read.intent, deps.lang),
    },
    refund:
      operation.status === "REFUNDED" ? { status: "REFUNDED", text: deps.texts.outcomes.REFUNDED[deps.lang] } : null,
    stops: read.stops,
    agent_fee: read.agent_fee,
    act: read.act,
  };
}

/**
 * Текст причины отсутствия человеку — из `config/` по коду закрытого перечня; причины нет — текста тоже нет.
 *
 * Берёт **код**, а не собранное тело (кирпич К3а): текст нужен самой сборке, чтобы положить его в тело рядом с кодом
 * (Р-1697), и считать его по уже собранному ответу значило бы собирать тело дважды.
 */
export const absenceTextOf = (reason: OrderAbsenceReason | null, deps: OrderBodyDeps): string | null =>
  reason === null ? null : deps.texts.reasons[reason][deps.lang];
