// Доска «Ход по стадиям» пульта DEMO-2 (П-2.1, модель пульта 1.23 v1.20): колонки стадий, карточка транзакции стоит в
// колонке, пока не придёт событие, и перескакивает в следующую в момент события. Чистые функции над моделью транзакций
// (`tx.ts`): что на карточке и в какой она колонке. Тексты карточки — фразы интерпретатора ru/en (данные для textContent,
// инвариант 4); «завершена» — только по итогу из события Платформы (инвариант 6, модель транзакций).
import type { Interpretation, Kind, Stage, Texts } from "../dashboards/interpret.js";
import type { PultMandate, PultTx, TxModel, TxOutcomeKind } from "./tx.js";

/** Колонки доски — как в модели 1.23 (`BOARD_COLS`). «После операции» — расчёт и возврат после итога (после MVP на стенде
 *  событий расчёта нет: колонка пустая, но остаётся — структура экранов модели сохраняется, Р-1426). */
// Ключ колонки «Подтверждение» — `confirmation` (в модели — `confirm`): слово `confirm` в скриптах страницы пульта
// запрещено тестом границы П5 п. 5 — там это вызов подтверждения за клиента.
export const BOARD_COLUMNS = ["mandate", "select", "cart", "confirmation", "pay", "result", "post", "done"] as const;
export type BoardColumn = (typeof BOARD_COLUMNS)[number];

/** Стадия интерпретатора → колонка доски. `service` колонки не меняет. Общая для доски и «Графика» (П-2.2). */
export const STAGE_COLUMN: Readonly<Record<Stage, BoardColumn | undefined>> = {
  mandate: "mandate",
  search: "select",
  cart: "cart",
  confirmation: "confirmation",
  payment: "pay",
  outcome: "result",
  revoke: "result",
  service: undefined,
};

export interface BoardCard {
  /** Номер транзакции (поручение корзины) или поручения-намерения, пока покупки нет. */
  readonly id: string;
  readonly kind: "tx" | "mandate";
  readonly column: BoardColumn;
  readonly intentId?: string;
  readonly outcome?: TxOutcomeKind;
  /** seq события итога — порядок «Завершены»: последние итоги сначала (повторное ревью П-2.1 № 4). */
  readonly outcomeSeq?: number;
  readonly code?: string;
  readonly worst: Kind;
  /** Конфликт звеньев — итога нет, решает человек (модель транзакций, Р-1444). */
  readonly linkConflict?: true;
  /** Есть операции или итоговые события подтверждения, связанные с корзиной только номером заказа (Р-1458, Р-1460). */
  readonly unconfirmed?: true;
  /** Последняя ключевая запись: время и фраза ru/en. */
  readonly last?: { readonly at: string; readonly phrase: Texts };
  /** seq первой записи — порядок карточек в колонке. */
  readonly order: number;
}

export interface BoardView {
  readonly cards: readonly BoardCard[];
}

/** Колонка транзакции: итог по событию — «Завершены»; иначе — по стадии последней ключевой записи. */
export function txColumn(t: PultTx): BoardColumn {
  if (t.outcome) return "done";
  return STAGE_COLUMN[t.stage] ?? "mandate";
}

/** Колонка поручения без покупки: отозвано — «Завершены»; конвейер в поиске — «Подбор»; иначе — «Поручение». */
export function mandateColumn(m: PultMandate): BoardColumn {
  if (m.status === "revoked") return "done";
  return m.stage === "search" || m.stage === "cart" ? "select" : "mandate";
}

function lastKey(seqs: readonly number[], bySeq: ReadonlyMap<number, Interpretation>): BoardCard["last"] {
  for (let i = seqs.length - 1; i >= 0; i--) {
    const r = bySeq.get(seqs[i]!);
    if (r && r.level === "key") return { at: r.at, phrase: r.phrase };
  }
  return undefined;
}

/** Карточки доски: транзакции и поручения-намерения без покупки. Поручение с покупкой показывает его транзакция. */
export function boardView(model: TxModel, items: readonly Interpretation[]): BoardView {
  const bySeq = new Map(items.map((r) => [r.seq, r] as const));
  const cards: BoardCard[] = [];
  for (const t of model.txs) {
    const last = lastKey(t.seqs, bySeq);
    cards.push({
      id: t.id,
      kind: "tx",
      column: txColumn(t),
      ...(t.intentId !== undefined && { intentId: t.intentId }),
      ...(t.outcome && { outcome: t.outcome.kind, outcomeSeq: t.outcome.seq }),
      ...(t.outcome?.code !== undefined && { code: t.outcome.code }),
      worst: t.worst,
      ...(t.linkConflict && { linkConflict: true as const }),
      ...((t.unconfirmedOps || t.unconfirmedConfirmations) && { unconfirmed: true as const }),
      ...(last && { last }),
      order: t.seqs[0]!,
    });
  }
  for (const m of model.mandates) {
    if (m.txIds.length > 0) continue;
    const last = lastKey(m.seqs, bySeq);
    cards.push({ id: m.id, kind: "mandate", column: mandateColumn(m), worst: m.worst, ...(last && { last }), order: m.seqs[0]! });
  }
  cards.sort((a, b) => a.order - b.order);
  return { cards };
}
