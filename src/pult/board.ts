// Доска «Ход по стадиям» пульта DEMO-2 (П-2.1, модель пульта 1.23 v1.20): колонки стадий, карточка транзакции стоит в
// колонке, пока не придёт событие, и перескакивает в следующую в момент события. Чистые функции над моделью транзакций
// (`tx.ts`): что на карточке и в какой она колонке. Тексты карточки — фразы интерпретатора ru/en (данные для textContent,
// инвариант 4); «завершена» — только по итогу из события Платформы (инвариант 6, модель транзакций).
import type { Interpretation, Kind, Stage, Texts } from "../dashboards/interpret.js";
// Отрезки колонок (`segments`) — здесь, а не в `graph.ts`: «График» импортирует доску, обратный импорт дал бы цикл.
import type { PultMandate, PultTx, TxModel, TxOpKind, TxOutcomeKind } from "./tx.js";
import { safePhrase } from "./engine.js";

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
  /** Поручение корзины, если оно известно: «Остановить покупку» — только при нём (ревью П-8.1 № 2); номер транзакции
   *  `cart:…` (конфликт звеньев — корзин две, единственной нет), `order:…`, `op:…`, `confirmation:…` — не корзина. */
  readonly cartMandateId?: string;
  /** Продавцы покупки — для разреза «продавец» (П-2.3): все, не первый встреченный; у транзакции с конфликтом звеньев их
   *  несколько — она видна в разрезе любого своего продавца (ревью П-2.3 № 4). */
  readonly merchantIds?: readonly string[];
  /** Время входа в текущую колонку — время записи, которая её туда перевела (для «Завершены» — событие итога): начало
   *  последнего отрезка `segments`, тем же кодом, что у «Графика» (ревью П-2.1 № 6). */
  readonly enteredAt?: string;
  readonly outcome?: TxOutcomeKind;
  /** seq события итога — порядок «Завершены»: последние итоги сначала (повторное ревью П-2.1 № 4). */
  readonly outcomeSeq?: number;
  readonly code?: string;
  readonly worst: Kind;
  /** Конфликт звеньев — итога нет, решает человек (модель транзакций, Р-1444). */
  readonly linkConflict?: true;
  /** Есть операции или итоговые события подтверждения, связанные с корзиной только номером заказа, а шаг итога агента уже
   *  пришёл (Р-1458, Р-1460, П-3.2а). */
  readonly unconfirmed?: true;
  /** Событие операции пришло, шага итога агента ещё нет — «ждём шаг агента» (повторное ревью П-2.1 № 1, П-3.2а). */
  readonly pending?: true;
  /** «Оплачено» после отзыва поручения корзины (В5). */
  readonly afterRevoke?: true;
  /** Два «оплачено» по одной корзине (R46). */
  readonly doubleDebit?: true;
  /** Операции транзакции с итогом каждой — когда их больше одной (повтор после отказа, В6). */
  readonly ops?: readonly { readonly opRef: string; readonly kind?: TxOpKind }[];
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

/** Колонка поручения без покупки по стадии: конвейер в поиске или корзине — «Подбор»; иначе — «Поручение». */
const mandateStageColumn = (s: Stage): BoardColumn => (s === "search" || s === "cart" ? "select" : "mandate");

/** Колонка поручения без покупки: отозвано — «Завершены»; иначе — по стадии (`mandateStageColumn`). */
export function mandateColumn(m: PultMandate): BoardColumn {
  if (m.status === "revoked") return "done";
  return mandateStageColumn(m.stage);
}

export interface Segment {
  readonly col: BoardColumn;
  readonly from: string;
  /** Конец отрезка — начало следующего; у последнего нет (идёт до «сейчас»). */
  readonly to?: string;
}

/** Колонка записи: транзакция — по стадии (`STAGE_COLUMN`), поручение без покупки — по `mandateStageColumn`. */
export const recordColumn = (kind: "tx" | "mandate", r: Interpretation): BoardColumn | undefined =>
  kind === "tx" ? STAGE_COLUMN[r.stage] : r.stage === "service" ? undefined : mandateStageColumn(r.stage);

/** Отрезки колонок по записям — один код для доски (время входа в колонку, П-2.1 № 6) и «Графика» (П-2.2): смена колонки —
 *  новая ключевая запись другой колонки, итог — отрезок «Завершены» с его времени. Время монотонно: записи идут по seq, а у
 *  событий Платформы `at` — по часам Платформы; начало отрезка не раньше начала предыдущего (ревью П-2.2 № 3). */
export function segments(
  kind: "tx" | "mandate",
  seqs: readonly number[],
  bySeq: ReadonlyMap<number, Interpretation>,
  done?: { at: string; seq: number },
): Segment[] {
  const segs: { col: BoardColumn; from: string; to?: string }[] = [];
  const open = (col: BoardColumn, at: string) => {
    const last = segs[segs.length - 1];
    if (last && last.col === col) return;
    const from = last && Date.parse(at) < Date.parse(last.from) ? last.from : at;
    if (last) last.to = from;
    segs.push({ col, from });
  };
  for (const s of seqs) {
    if (done && s >= done.seq) break;
    const r = bySeq.get(s);
    if (!r || r.level !== "key") continue;
    const col = recordColumn(kind, r);
    if (col) open(col, r.at);
  }
  if (done) open("done", done.at);
  return segs;
}

/** Итог строки: транзакция — событие итога Платформы; поручение без покупки — событие отзыва `mandate.revoked`. */
export function doneOf(
  kind: "tx" | "mandate",
  x: PultTx | PultMandate,
  bySeq: ReadonlyMap<number, Interpretation>,
): { at: string; seq: number } | undefined {
  if (kind === "tx") {
    const o = (x as PultTx).outcome;
    return o ? { at: o.at, seq: o.seq } : undefined;
  }
  if ((x as PultMandate).status !== "revoked") return undefined;
  const r = x.seqs.map((s) => bySeq.get(s)).find((y) => y?.source === "pao_event" && y.ref === "mandate.revoked");
  return r ? { at: r.at, seq: r.seq } : undefined;
}

function lastKey(seqs: readonly number[], bySeq: ReadonlyMap<number, Interpretation>): BoardCard["last"] {
  for (let i = seqs.length - 1; i >= 0; i--) {
    const r = bySeq.get(seqs[i]!);
    // Запись с похожим на номер карты — скрыта (инвариант 1; ревью П-5.1 № 5): номер не уходит в SSE пульта.
    if (r && r.level === "key") return { at: r.at, phrase: safePhrase(r) };
  }
  return undefined;
}

/** Карточки доски: транзакции и поручения-намерения без покупки. Поручение с покупкой показывает его транзакция. */
export function boardView(model: TxModel, items: readonly Interpretation[]): BoardView {
  const bySeq = new Map(items.map((r) => [r.seq, r] as const));
  const cards: BoardCard[] = [];
  // Время входа в колонку — начало последнего отрезка, если он той же колонки (иначе записей колонки нет — без времени).
  const entered = (kind: "tx" | "mandate", x: PultTx | PultMandate, column: BoardColumn) => {
    const last = segments(kind, x.seqs, bySeq, doneOf(kind, x, bySeq)).at(-1);
    return last && last.col === column ? last.from : undefined;
  };
  for (const t of model.txs) {
    const last = lastKey(t.seqs, bySeq);
    const column = txColumn(t);
    const enteredAt = entered("tx", t, column);
    cards.push({
      id: t.id,
      kind: "tx",
      column,
      ...(enteredAt !== undefined && { enteredAt }),
      ...(t.intentId !== undefined && { intentId: t.intentId }),
      ...(t.cartMandateId !== undefined && { cartMandateId: t.cartMandateId }),
      ...(t.merchantIds.length > 0 && { merchantIds: t.merchantIds }),
      ...(t.outcome && { outcome: t.outcome.kind, outcomeSeq: t.outcome.seq }),
      ...(t.outcome?.code !== undefined && { code: t.outcome.code }),
      worst: t.worst,
      ...(t.linkConflict && { linkConflict: true as const }),
      ...((t.unconfirmedOps || t.unconfirmedConfirmations) && { unconfirmed: true as const }),
      ...(t.pendingOps && { pending: true as const }),
      ...(t.afterRevoke && { afterRevoke: true as const }),
      ...(t.doubleDebit && { doubleDebit: true as const }),
      ...(t.ops.length > 1 && { ops: t.ops.map((o) => ({ opRef: o.opRef, ...(o.kind !== undefined && { kind: o.kind }) })) }),
      ...(last && { last }),
      order: t.seqs[0]!,
    });
  }
  for (const m of model.mandates) {
    if (m.txIds.length > 0) continue;
    const last = lastKey(m.seqs, bySeq);
    const column = mandateColumn(m);
    const enteredAt = entered("mandate", m, column);
    cards.push({ id: m.id, kind: "mandate", column, ...(enteredAt !== undefined && { enteredAt }), worst: m.worst, ...(last && { last }), order: m.seqs[0]! });
  }
  cards.sort((a, b) => a.order - b.order);
  return { cards };
}
