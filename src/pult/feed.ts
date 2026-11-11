// Лента пульта DEMO-2 (П-2.1): поверх ленты интерпретатора (адаптер источника, Р-1246) — модель транзакций (`tx.ts`) и
// доска (`board.ts`). Пересчёт — с паузой после записи, а не на каждую (шина пишет пачками); переходы карточек между
// колонками — «скачком, по событию» (модель 1.23 v1.20): время перехода — время записи, которая его вызвала (`enteredAt`
// карточки; переходы внутри одной паузы пересчёта схлопываются в один). Перезапуск
// источника (`reset`) сбрасывает всё. Лента только читает.
import type { FeedEvent, InterpretFeed } from "../dashboards/feed.js";
import type { Interpretation } from "../dashboards/interpret.js";
import type { SourceStatus } from "../dashboards/source.js";
import { boardView, type BoardCard, type BoardColumn } from "./board.js";
import { controlView, WAIT_MS, type ControlState } from "./control.js";
import { evaluate } from "./engine.js";
import { graphView, type GraphView } from "./graph.js";
import { buildTxModel } from "./tx.js";
import { verdicts } from "./verdict.js";

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
  /** «Контроль» (П-4.1): паспорта по правилу паспорта, «Идёт к нарушению», «В работе сейчас». */
  readonly control: ControlState;
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
  /** Порог «Идёт к нарушению», мс. По умолчанию `WAIT_MS` (15 с — модель 1.23, тесты задания У-01…У-03). */
  readonly waitMs?: number;
  /** Движок условий — подмена только для теста отказа (ревью П-4.1 № 5). По умолчанию `evaluate`. */
  readonly evaluate?: typeof evaluate;
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
  const emptyControl: ControlState = { passports: [], waits: [], waitMs: o.waitMs ?? WAIT_MS, active: [], counts: { txs: 0, wrong: 0 } };
  let state: PultBoardState = { now: o.now().toISOString(), cards: [], jumps: [], graph: { rows: [] }, control: emptyControl };
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
    let model: ReturnType<typeof buildTxModel>;
    const now = o.now().toISOString();
    try {
      model = buildTxModel(items);
      view = boardView(model, items);
      graph = graphView(model, items);
    } catch {
      return;
    }
    // Время перехода — время записи, которая перевела карточку в колонку (`enteredAt`, начало последнего отрезка — тот же
    // код, что у «Графика»; для «Завершены» — событие итога), а не последняя запись на момент пересчёта (ревью П-2.1 № 6).
    // Переходы внутри одной пачки (пауза пересчёта) в журнал переходов попадают одним — из прежней колонки в новую.
    const cards: PultCard[] = view.cards.map((c) => {
      const at = c.enteredAt ?? c.last?.at ?? now;
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
    // Карточки, ушедшие с доски (окно записей, перезапуск сюжета), из словаря колонок — вон (ревью П-2.1 № 7).
    const live = new Set(view.cards.map((c) => c.id));
    for (const id of [...column.keys()]) if (!live.has(id)) column.delete(id);
    if (jumps.length > kept) jumps = jumps.slice(-kept);
    const active = cards.filter((c) => c.kind === "tx" && c.column !== "done").map((c) => ({ id: c.id, column: c.column, since: c.since }));
    // Движок условий и вердикты — в своём блоке: ошибка в условии оставляет прежний «Контроль», доска обновляется (ревью
    // П-4.1 № 5 — иначе одна ошибка гасит доску, и на прогоне это выглядит как зависание стенда). Журнал сбоев стенда на
    // шину выводит П-11.2 (после PR #11): до него условия журнала — «на стенде не проверяется».
    // Прежними при сбое — только паспорта и число транзакций с паспортом (они от движка); ожидания, «В работе сейчас» и
    // число транзакций — свежие: показывать устаревшее там, где доступно свежее, нельзя (ревью П-4.1 № 16).
    let control: ControlState;
    try {
      const vs = verdicts((o.evaluate ?? evaluate)(model, items, { now }), model, items);
      control = controlView(model, items, vs, active, o.waitMs);
    } catch {
      try {
        const fresh = controlView(model, items, [], active, o.waitMs);
        control = { ...fresh, passports: state.control.passports, counts: { ...fresh.counts, wrong: state.control.counts.wrong } };
      } catch {
        control = state.control;
      }
    }
    state = { now, cards, jumps: [...jumps], graph, control };
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
