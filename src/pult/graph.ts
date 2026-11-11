// «График» пульта DEMO-2 (П-2.2, модель пульта 1.23 — `renderGraph`): строки — транзакции и поручения без покупки, по
// времени — отрезки стадий (колонки доски), «сейчас», метки записей с ошибкой, конфликтом или фродом. Чистые функции над
// моделью транзакций и записями: отрезок начинается записью, которая перевела транзакцию в стадию; «Завершены» — с
// события итога Платформы (инвариант 6). Красные метки узлов У1–У5 — с движком условий (П-3); здесь — тип записи.
import type { Interpretation, Kind } from "../dashboards/interpret.js";
import { doneOf, segments, type Segment } from "./board.js";
import type { TxModel } from "./tx.js";

/** Отрезок стадии — тот же, что у доски (`board.ts`, `segments`): доска и «График» считают одним кодом (П-2.1 № 6). */
export type GraphSeg = Segment;

export interface GraphMark {
  readonly at: string;
  readonly kind: Exclude<Kind, "norm">;
}

export interface GraphRow {
  readonly id: string;
  readonly kind: "tx" | "mandate";
  readonly segs: readonly GraphSeg[];
  readonly marks: readonly GraphMark[];
  /** «Оплачено» после отзыва поручения (В5) и два списания по корзине (R46) — пометки строки (П-3.2а). */
  readonly afterRevoke?: true;
  readonly doubleDebit?: true;
  /** seq первой записи — порядок строк. */
  readonly order: number;
}

export interface GraphView {
  readonly rows: readonly GraphRow[];
}

function marks(seqs: readonly number[], bySeq: ReadonlyMap<number, Interpretation>): GraphMark[] {
  const out: GraphMark[] = [];
  for (const s of seqs) {
    const r = bySeq.get(s);
    if (r && r.level === "key" && r.kind !== "norm") out.push({ at: r.at, kind: r.kind });
  }
  return out;
}

/** Строки «Графика»: последние `limit` по началу (по умолчанию 20) — транзакции и поручения без покупки. */
export function graphView(model: TxModel, items: readonly Interpretation[], limit = 20): GraphView {
  const bySeq = new Map(items.map((r) => [r.seq, r] as const));
  const rows: GraphRow[] = [];
  for (const t of model.txs) {
    rows.push({
      id: t.id,
      kind: "tx",
      segs: segments("tx", t.seqs, bySeq, doneOf("tx", t, bySeq)),
      marks: marks(t.seqs, bySeq),
      ...(t.afterRevoke && { afterRevoke: true as const }),
      ...(t.doubleDebit && { doubleDebit: true as const }),
      order: t.seqs[0]!,
    });
  }
  for (const m of model.mandates) {
    if (m.txIds.length > 0) continue;
    // Отзыв поручения без покупки — «Завершены» с события mandate.revoked; колонки — как у карточки поручения на доске.
    rows.push({
      id: m.id,
      kind: "mandate",
      segs: segments("mandate", m.seqs, bySeq, doneOf("mandate", m, bySeq)),
      marks: marks(m.seqs, bySeq),
      order: m.seqs[0]!,
    });
  }
  // Строка без отрезков (только служебные обращения) места из limit не занимает (ревью П-2.2 № 5).
  const shown = rows.filter((r) => r.segs.length > 0);
  shown.sort((a, b) => a.order - b.order);
  return { rows: shown.slice(-limit) };
}
