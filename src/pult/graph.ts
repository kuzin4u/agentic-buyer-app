// «График» пульта DEMO-2 (П-2.2, модель пульта 1.23 — `renderGraph`): строки — транзакции и поручения без покупки, по
// времени — отрезки стадий (колонки доски), «сейчас», метки записей с ошибкой, конфликтом или фродом. Чистые функции над
// моделью транзакций и записями: отрезок начинается записью, которая перевела транзакцию в стадию; «Завершены» — с
// события итога Платформы (инвариант 6). Красные метки узлов У1–У5 — с движком условий (П-3); здесь — тип записи.
import type { Interpretation, Kind } from "../dashboards/interpret.js";
import { STAGE_COLUMN, type BoardColumn } from "./board.js";
import type { TxModel } from "./tx.js";

export interface GraphSeg {
  readonly col: BoardColumn;
  readonly from: string;
  /** Конец отрезка — начало следующего; у последнего нет (идёт до «сейчас»). */
  readonly to?: string;
}

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

/** Отрезки по записям: смена колонки — новая ключевая запись другой стадии; итог — отрезок «Завершены» с его времени.
 *  Время монотонно: записи идут по seq, а у событий Платформы `at` — по часам Платформы; начало отрезка не раньше начала
 *  предыдущего, иначе конец вышел бы раньше начала (ревью П-2.2 № 3). */
function segments(seqs: readonly number[], bySeq: ReadonlyMap<number, Interpretation>, done?: { at: string; seq: number }): GraphSeg[] {
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
    const col = STAGE_COLUMN[r.stage];
    if (col) open(col, r.at);
  }
  if (done) open("done", done.at);
  return segs;
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
      segs: segments(t.seqs, bySeq, t.outcome ? { at: t.outcome.at, seq: t.outcome.seq } : undefined),
      marks: marks(t.seqs, bySeq),
      ...(t.afterRevoke && { afterRevoke: true as const }),
      ...(t.doubleDebit && { doubleDebit: true as const }),
      order: t.seqs[0]!,
    });
  }
  for (const m of model.mandates) {
    if (m.txIds.length > 0) continue;
    // Отзыв поручения без покупки — «Завершены» с события mandate.revoked.
    const revoked = m.status === "revoked" ? m.seqs.map((s) => bySeq.get(s)).find((r) => r?.source === "pao_event" && r.ref === "mandate.revoked") : undefined;
    rows.push({
      id: m.id,
      kind: "mandate",
      segs: segments(m.seqs, bySeq, revoked ? { at: revoked.at, seq: revoked.seq } : undefined),
      marks: marks(m.seqs, bySeq),
      order: m.seqs[0]!,
    });
  }
  // Строка без отрезков (только служебные обращения) места из limit не занимает (ревью П-2.2 № 5).
  const shown = rows.filter((r) => r.segs.length > 0);
  shown.sort((a, b) => a.order - b.order);
  return { rows: shown.slice(-limit) };
}
