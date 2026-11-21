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
import type { Operation } from "agentic-buyer-ref/src/shared/domain.js";
import type { UiLang } from "../contract/ui-v1/common.js";
import type { OrderResponse } from "../contract/ui-v1/methods.js";
import { stepOfState } from "../contract/ui-v1/steps.js";
import type { OrderRead, ShellText } from "./port.js";
import { isScopeCode, sourceOf, type OrderTexts, type ScopeCode } from "./texts.js";

/** Чем заполняется тело: язык запроса, тексты из `config/` и строки словаря каркаса портом (Р-1693). */
export interface OrderBodyDeps {
  readonly lang: UiLang;
  readonly texts: OrderTexts;
  readonly shell: ShellText;
}

/**
 * Почему тела § 5.8 нет.
 *
 * Тело § 5.8 **требует** записи об исполнении (`fulfilment`) и суммы операции, а у Платформы их может не быть:
 * `fulfilment` равен `null`, пока расчёта нет, а у операции ПАО 1.4.0 сумма приходит не всегда. Приложение в этом
 * случае **не придумывает запись** и не подставляет одну сумму вместо другой (инвариант 6, П36): наружу идёт причина,
 * а вместе с ней — **источник и время сверки**, чтобы человеку можно было сказать «итога ещё нет, проверено во
 * столько», а не промолчать.
 *
 * Какой код `/ui` отвечает на эту причину — **вопрос владельцу** (назван в PR): назначать код и его класс повтора
 * самовольно нельзя (П35, Р-1681). Маршрут метода — ИН-К6 окна Б.
 */
export type OrderBodyProblem = {
  readonly reason: "FULFILMENT_ABSENT" | "OPERATION_AMOUNT_ABSENT";
  readonly source: OrderResponse["source"];
};

export type OrderBody = { readonly ok: true; readonly response: OrderResponse } | ({ readonly ok: false } & OrderBodyProblem);

/** Класс проверки клиринга — **у ядра** (Р-1694): `scopeNotice` возвращает `null` при `WITHIN_LIMITS` и свой код во
 *  всех прочих случаях, включая значение вне перечня. Своей ветви `typeof scope_check === "object"` здесь нет: она
 *  была бы вторым правилом рядом с правилом ядра. Текст человеку — свой, парами ru/en (Р-1693). */
/**
 * Код класса по уведомлению ядра. Функция **названа и вывезена** нарочно (находка ревью К2 № 4): запасная ветвь через
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

function scopeText(operation: Operation, deps: OrderBodyDeps): string {
  return deps.texts.scope[scopeCodeOfNotice(scopeNotice(operation))][deps.lang];
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
 * Порядок сборки: сначала источник и время сверки (они есть всегда — даже когда тела нет), затем проверка, что
 * прочитанное вообще описывает итог, и только потом перекладывание величин. Ни одного `now()`, ни одного сложения.
 */
export function orderBody(read: OrderRead, deps: OrderBodyDeps): OrderBody {
  const source = sourceOf(read, deps.texts, deps.lang);
  const operation = read.operation;
  const fulfilment = operation.fulfilment ?? null;
  if (fulfilment === null) return { ok: false, reason: "FULFILMENT_ABSENT", source };
  const amount = operation.amount ?? null;
  if (amount === null) return { ok: false, reason: "OPERATION_AMOUNT_ABSENT", source };

  return {
    ok: true,
    response: {
      state: read.state,
      // Шаг экрана — таблицей контракта (КТ-0), а не своим правилом: у приложения таблицы шагов нет (правило 3).
      step: stepOfState(read.state),
      operation: { status: operation.status, amount, decline_text: outcomeText(operation, deps) },
      fulfilment: {
        final: fulfilment.finalAmount,
        // Значение Платформы переносится как есть, в том числе `{ other }`: догадки нет (П36 п. 5).
        scope_check: fulfilment.scopeCheck,
        scope_text: scopeText(operation, deps),
        // `spent_position` — величина Платформы: ни сложения, ни пересчёта (инвариант 6 ядра).
        spent_position: fulfilment.spentPosition,
        at: fulfilment.at,
      },
      source,
      done_line: {
        done: deps.shell.done(read, deps.lang),
        // «Не списано» — остаток поручения из `verify`, а не разница (Р-1692): в порт уходит `verify` целиком, и
        // разницу передать нечем.
        not_spent: deps.shell.notSpent(read.intent, deps.lang),
      },
      refund:
        operation.status === "REFUNDED"
          ? { status: "REFUNDED", text: deps.texts.outcomes.REFUNDED[deps.lang] }
          : null,
      stops: read.stops,
      agent_fee: read.agent_fee,
      act: read.act,
    },
  };
}
