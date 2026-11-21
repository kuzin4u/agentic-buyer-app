// Н-3, К3 — исход итога в журнал покупки (постановка Н-3, кирпич К3; решение П36).
//
// Зачем запись: итог обещан **проверяемым** (П36). Человеку отдали «куплено за столько, проверено во столько» — и это
// должно остаться в журнале покупки: по какому прочитанному собран ответ, в каком состоянии покупка, какой класс
// проверки у Платформы, была ли причина отсутствия и то же ли это тело, что ушло на экран.
//
// Главное правило записи: **пишется показанное, а не пересчитанное заново** (приём К4а П-К4 — запись показанного
// копируется целиком). Состояние, статус, причина и хэш берутся **из собранного ответа**; из прочитанного — только
// идентификаторы покупки и операции, которых в ответе нет.
//
// **Класс проверки для журнала — форма записи ядра, а не второе правило показа.** Ядро пишет в свой журнал
// (`operation.settled`) известные значения как есть, а значение вне перечня и значение не по форме кода — классом
// `OTHER`; тип этого класса ядро отдаёт (`ScopeCheckDetail`), а функции не отдаёт. Поэтому форма повторяется здесь —
// по условию владельца 22.11.2026: **исчерпывающим разбором по типу ядра с ветвью `never`**, без своего перечня, так
// что расширение перечня в ядре роняет компиляцию здесь (кирпич К3в). Класс **показа** при этом по-прежнему берёт
// `scopeNotice` ядра (Р-1694, П36 п. 5) — своей ветви показа в приложении нет. Чтобы источник класса жил в ядре и у
// приложения, передача агенту открыта (номер — в `/finish` и в строке STATUS).
//
// Чего в записи **нет**: платёжных реквизитов, криптограммы, `kid` (инвариант 1) — только идентификаторы покупки и
// операции; **текстов человеку** — они восстановимы по коду, а два источника одного текста расходятся; **значения
// `scope_check` вне перечня** — в журнал идёт класс, значение человеку показывается как есть (инвариант 5 ядра).
//
// Журнал и часы приходят **зависимостями**, как у поручения (`IntentServiceJournal`, К5 П-К4): модуль итога не знает,
// куда пишут, и своего хранилища не держит.
import type { ScopeCheckDetail } from "agentic-buyer-ref/src/agent/operations/index.js";
import type { OperationStatus } from "agentic-buyer-ref/src/shared/domain.js";
import type { ShownHash, UiInstant } from "../contract/ui-v1/common.js";
import type { OrderAbsenceReason, OrderResponse, UiState } from "../contract/ui-v1/methods.js";
import { showingHash } from "../contract/ui-v1/shown-hash.js";
import type { OrderRead } from "./port.js";
import { sourceCodeOf, type SourceCode } from "./texts.js";

/** Версия формы записи: входит в хэш показанного вместе с телом, как `text_version` карточки (правило 1 К-Б). */
export const ORDER_SHOWN_VERSION = "u7-order@1.0";

/**
 * Запись «итог отдан человеку по прочитанному».
 *
 * `state` — состояние **показанного** ответа: именно по нему человеку сказали «оплачено» или «ждём итога расчёта»
 * (находка ревью К3 № 4). Без него запись не отвечает на вопрос «по какому чтению сказали „Оплачено“».
 * `shown` — хэш показанного тела: он привязывает запись к **величинам**, которые человек видел, не копируя суммы в
 * журнал второй раз (находка ревью К3 № 8). Выбран хэш, а не суммы: приём в приложении уже есть (правило 1 К-Б,
 * `showingHash`), и хэш нельзя подправить задним числом по частям.
 * `scope` равен `null`, когда записи об исполнении нет вовсе — классу проверки взяться негде.
 */
export interface OrderShownEntry {
  /** Событие названо по тому, что приложение **знает**: ответ собран и отдан. «Показан» оно утверждать не может —
   *  соединение могло оборваться (находка ревью К3 № 6; образец рядом — `intent.sent`). */
  readonly event: "order.answered";
  readonly purchase_id: string;
  /** идентификатор операции Платформы; реквизитов, криптограммы и `kid` здесь нет и быть не может (инвариант 1) */
  readonly op_ref: string;
  readonly state: UiState;
  readonly status: OperationStatus;
  readonly scope: ScopeCheckDetail | null;
  /** причина отсутствия записи или суммы; при полном теле — `null` */
  readonly reason: OrderAbsenceReason | null;
  /** откуда взят итог — код источника, не текст (текст собирается из `config/` по коду) */
  readonly source: SourceCode;
  readonly shown: ShownHash;
  /** время **чтения** у Платформы: то же, что человек увидел в «проверено» (Р-1690) */
  readonly checked_at: UiInstant;
  /** время самой записи, по часам места сборки — **не** время чтения и не время записи Платформы */
  readonly at: UiInstant;
}

export type OrderJournalEntry = OrderShownEntry;

export interface OrderJournal {
  write(entry: OrderJournalEntry): void;
}

export interface OrderJournalDeps {
  readonly journal: OrderJournal;
  /** часы места сборки: время записи ставит оно, и своего `Date.now()` здесь нет (приём К5 П-К4) */
  readonly now: () => UiInstant;
}

/**
 * Класс проверки для журнала — форма записи ядра (`operation.settled`).
 *
 * Повторяет ядро **целиком**: значение не по форме кода (`undefined` у ядра) и значение вне перечня (`{ other }`) —
 * класс `OTHER`, известные значения — как есть. Ветвь `undefined` названа по находке ревью К3 № 3: без неё в запись
 * уходило бы пропавшее поле там, где ядро пишет `OTHER`.
 */
export const scopeDetailOf = (read: OrderRead): ScopeCheckDetail | null => {
  const fulfilment = read.operation.fulfilment ?? null;
  if (fulfilment === null) return null;
  const s: unknown = fulfilment.scopeCheck;
  if (s === undefined || s === null || typeof s === "object") return "OTHER";
  return s as ScopeCheckDetail;
};

/**
 * Записать исход отданного итога.
 *
 * Берёт **собранный ответ** и пишет то, что в нём: состояние, статус, причину и хэш показанного; класс проверки — по
 * прочитанному той же формой, что у ядра; идентификаторы — из прочитанного.
 */
export function recordOrderShown(read: OrderRead, response: OrderResponse, deps: OrderJournalDeps): void {
  deps.journal.write({
    event: "order.answered",
    purchase_id: read.purchase_id,
    op_ref: read.operation.opRef,
    state: response.state,
    status: response.operation.status,
    scope: scopeDetailOf(read),
    reason: response.reason,
    source: sourceCodeOf(read),
    shown: showingHash({ text_version: ORDER_SHOWN_VERSION, card: response }),
    checked_at: response.source.checked_at,
    at: deps.now(),
  });
}
