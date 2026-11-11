// Лента пульта DEMO-2 (П-2.1): поверх ленты интерпретатора (адаптер источника, Р-1246) — модель транзакций (`tx.ts`) и
// доска (`board.ts`). Пересчёт — с паузой после записи, а не на каждую (шина пишет пачками); переходы карточек между
// колонками — «скачком, по событию» (модель 1.23 v1.20): время перехода — время записи, которая его вызвала. Перезапуск
// источника (`reset`) сбрасывает всё. Лента только читает.
import type { FeedEvent, InterpretFeed } from "../dashboards/feed.js";
import type { Interpretation } from "../dashboards/interpret.js";
import type { SourceStatus } from "../dashboards/source.js";
import { boardView, type BoardCard, type BoardColumn } from "./board.js";
import { graphView, type GraphView } from "./graph.js";
import { buildTxModel } from "./tx.js";

export interface PultCard extends BoardCard {
  /** С какого времени карточка в этой колонке (время записи, которая её туда перевела). */
  readonly since: string;
}

export interface PultJump {
  readonly at: string;
  readonly id: string;
  readonly from: BoardColumn;
  readonly to: BoardColumn;
}

export interface PultBoardState {
  /** Часы шины на момент пересчёта — от них экран считает «в стадии N с». */
  readonly now: string;
  readonly cards: readonly PultCard[];
  /** Последние переходы, новые — в конце. */
  readonly jumps: readonly PultJump[];
  /** «График» (П-2.2): отрезки стадий по времени. */
  readonly graph: GraphView;
}

export type PultFeedEvent =
  | { readonly type: "board"; readonly board: PultBoardState }
  | { readonly type: "status"; readonly status: SourceStatus };

export interface PultFeed {
  board(): PultBoardState;
  subscribe(l: (e: PultFeedEvent) => void): () => void;
  close(): void;
}

export interface PultFeedOptions {
  /** Часы шины (как у «Контроля»): `now` состояния и время карточки без записей. */
  readonly now: () => Date;
  /** Пауза пересчёта после записи, мс. По умолчанию 200. */
  readonly debounceMs?: number;
  /** Сколько переходов помнить. По умолчанию 20. */
  readonly jumpsKept?: number;
  /** Своё окно записей пульта. По умолчанию 20 000: окно ленты интерпретатора (2 000) на прогоне 25 тестов П-11 вытесняет
   *  начало покупки, и оплаченная карточка откатывалась бы из «Завершены» (ревью П-2.1 № 3, Р-1460). Хранение итога
   *  транзакции независимо от окна — после MVP. */
  readonly limit?: number;
}

export function createPultFeed(feed: InterpretFeed, o: PultFeedOptions): PultFeed {
  const debounce = o.debounceMs ?? 200;
  const kept = o.jumpsKept ?? 20;
  const limit = o.limit ?? 20_000;
  // Своё окно: записи приходят событиями ленты интерпретатора; накопленное до подписки — из её списка.
  const items: Interpretation[] = [...feed.list()];
  const add = (r: Interpretation) => {
    let i = items.length;
    while (i > 0 && items[i - 1]!.seq > r.seq) i--;
    if (i > 0 && items[i - 1]!.seq === r.seq) return;
    items.splice(i, 0, r);
    if (items.length > limit) items.splice(0, items.length - limit);
  };
  const listeners = new Set<(e: PultFeedEvent) => void>();
  const column = new Map<string, { column: BoardColumn; since: string }>();
  let jumps: PultJump[] = [];
  let state: PultBoardState = { now: o.now().toISOString(), cards: [], jumps: [], graph: { rows: [] } };
  let timer: NodeJS.Timeout | undefined;

  const emit = (e: PultFeedEvent) => {
    for (const l of listeners) {
      try {
        l(e);
      } catch {
        // Слушатель (соединение пульта) упал — ленту и других слушателей это не останавливает.
      }
    }
  };

  const recompute = () => {
    timer = undefined;
    // Сбой пересчёта не роняет процесс стенда: остаётся прежняя доска (ревью П-2.1 № 8).
    let view: ReturnType<typeof boardView>;
    let graph: GraphView;
    try {
      const model = buildTxModel(items);
      view = boardView(model, items);
      graph = graphView(model, items);
    } catch {
      return;
    }
    const now = o.now().toISOString();
    const cards: PultCard[] = view.cards.map((c) => {
      const at = c.last?.at ?? now;
      const prev = column.get(c.id);
      if (!prev) {
        column.set(c.id, { column: c.column, since: at });
        return { ...c, since: at };
      }
      if (prev.column !== c.column) {
        jumps.push({ at, id: c.id, from: prev.column, to: c.column });
        column.set(c.id, { column: c.column, since: at });
        return { ...c, since: at };
      }
      return { ...c, since: prev.since };
    });
    if (jumps.length > kept) jumps = jumps.slice(-kept);
    state = { now, cards, jumps: [...jumps], graph };
    emit({ type: "board", board: state });
  };

  const schedule = () => {
    if (timer) return;
    timer = setTimeout(recompute, debounce);
    timer.unref();
  };

  const off = feed.subscribe((e: FeedEvent) => {
    if (e.type === "item") {
      add(e.item);
      schedule();
    } else if (e.type === "reset") {
      items.length = 0;
      column.clear();
      jumps = [];
      schedule();
    } else if (e.type === "status") emit({ type: "status", status: e.status });
  });
  // Накопленное до подписки — сразу.
  recompute();

  return {
    board: () => state,
    subscribe(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    close() {
      off();
      clearTimeout(timer);
      timer = undefined;
      listeners.clear();
    },
  };
}
