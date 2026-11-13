// Лента пульта DEMO-2 (П-2.1): поверх ленты интерпретатора (адаптер источника, Р-1246) — модель транзакций (`tx.ts`) и
// доска (`board.ts`). Пересчёт — с паузой после записи, а не на каждую (шина пишет пачками); переходы карточек между
// колонками — «скачком, по событию» (модель 1.23 v1.20): время перехода — время записи, которая его вызвала (`enteredAt`
// карточки; переходы внутри одной паузы пересчёта схлопываются в один). Перезапуск
// источника (`reset`) сбрасывает всё. Лента только читает.
import { CLIENT_AUTO_OFF, CLIENT_AUTO_ON } from "../dashboards/control.js";
import type { FeedEvent, InterpretFeed } from "../dashboards/feed.js";
import type { Interpretation } from "../dashboards/interpret.js";
import type { SourceStatus } from "../dashboards/source.js";
import { boardView, type BoardCard, type BoardColumn } from "./board.js";
import type { Reaction } from "./actions.js";
import { causesView, type TxCauses } from "./causes.js";
import { conditionsView, type ConditionsView } from "./conditions.js";
import { controlView, WAIT_MS, type ControlState } from "./control.js";
import { evaluate, type EngineView } from "./engine.js";
import { graphView, type GraphView } from "./graph.js";
import { linkReactions, type LinkedReaction } from "./reactions.js";
import type { StandLogEntry } from "./standlog.js";
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
  /** «Условия» (П-4.2): статусы 89 правил, плитки узлов, сектора — из движка. Нет — движок ещё не отработал ни разу. */
  readonly conditions?: ConditionsView;
  /** «Причины» (П-5.1): разбор транзакций и поручений с вердиктом — из вердиктов движка. Нет — движок ещё не отработал. */
  readonly causes?: readonly TxCauses[];
  /** Журнал реакций (П-8.1): нажатия кнопок и ответ стенда как есть; новые — в конце, последние `REACTIONS_KEPT`. Связь с
   *  записью протокола стенда и «упреждено реакцией» — П-8.2 (`reactions.ts`). */
  readonly reactions?: readonly LinkedReaction[];
  /** Режим эмулятора клиента (видимая часть П-11.4): по последнему шагу `client.auto_on` / `client.auto_off` в окне записей;
   *  шага нет — поля нет («нет данных»: эмулятора нет или шаг ушёл из окна — «вручную» не выдумывается). */
  readonly clientAuto?: boolean;
}

/** Режим эмулятора клиента по последнему шагу режима в записях; шага нет — undefined. Пометку источника (П5 п. 3,
 *  `source: "client-emulator"`) не сверяем: шаги сюжета пишет только код приложения, а `client.auto_*` — только эмулятор
 *  (`CLIENT_STEPS`, ревью № 5); сеть шаги сюжета на шину не пишет. */
export function clientAutoOf(items: readonly Interpretation[]): boolean | undefined {
  for (let i = items.length - 1; i >= 0; i--) {
    const x = items[i]!;
    if (x.stream !== "scenario") continue;
    if (x.ref === CLIENT_AUTO_ON) return true;
    if (x.ref === CLIENT_AUTO_OFF) return false;
  }
  return undefined;
}
/** Сколько реакций помнить в ленте (журнал и протокол — П-6, П-8.2). */
export const REACTIONS_KEPT = 50;

export type PultFeedEvent =
  | { readonly type: "board"; readonly board: PultBoardState }
  | { readonly type: "status"; readonly status: SourceStatus };

export interface PultFeed {
  board(): PultBoardState;
  /** Записать реакцию (кнопку пульта) и разослать доску. Пересчёт движка не нужен: реакция — не запись шины. */
  react(r: Reaction): void;
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
  /** Журнал сбоев и действий стенда на шине есть — режим сбоев (Р-1514; подключение — П-8.2, Р-1531): движок берёт его из
   *  ленты интерпретатора (`standLog()`). Нет — журнал недоступен (`standLog === undefined` у движка): условия журнала «на
   *  стенде не проверяется», «упреждено реакцией» не ставится, а не «напоминаний не было». */
  readonly standLog?: boolean;
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
  let reactions: Reaction[] = [];
  // Журнал стенда — только при `standLog` (режим сбоев); запись шины `stand` несёт запись журнала стенда как есть.
  // Журнала у ленты нет — «недоступен» (`undefined`), а не «пуст» (ревью П-8.2 № 2): иначе условия журнала ушли бы в
  // разрешающую сторону («соблюдено» вместо «на стенде не проверяется»).
  const standLog = (): readonly StandLogEntry[] | undefined => (o.standLog && feed.standLog ? feed.standLog().map((l) => l.entry) : undefined);
  // Последний результат движка: по нему реакция узнаёт «упреждено» и между пересчётами (нажатие пересчёта не вызывает).
  let lastEv: EngineView | undefined;
  const linked = () => linkReactions(reactions, standLog(), lastEv);
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
    // П-4.1 № 5 — иначе одна ошибка гасит доску, и на прогоне это выглядит как зависание стенда). Журнал сбоев и действий
    // стенда — в режиме сбоев (`standLog`, П-8.2, Р-1531); без него условия журнала — «на стенде не проверяется».
    // Прежними при сбое — только паспорта, число транзакций с паспортом и «Условия» (они от движка); ожидания, «В работе сейчас» и
    // число транзакций — свежие: показывать устаревшее там, где доступно свежее, нельзя (ревью П-4.1 № 16).
    // «Условия» (П-4.2) — из того же результата движка; при сбое остаются прежние, как паспорта.
    let control: ControlState;
    let conditions = state.conditions;
    let causes = state.causes;
    try {
      const log = standLog();
      const ev = (o.evaluate ?? evaluate)(model, items, { now, ...(log !== undefined && { standLog: log }) });
      lastEv = ev;
      const vs = verdicts(ev, model, items);
      control = controlView(model, items, vs, active, o.waitMs);
      conditions = conditionsView(ev);
      causes = causesView(model, items, vs, control.waits);
    } catch {
      try {
        const fresh = controlView(model, items, [], active, o.waitMs);
        control = { ...fresh, passports: state.control.passports, counts: { ...fresh.counts, wrong: state.control.counts.wrong } };
      } catch {
        control = state.control;
      }
    }
    const clientAuto = clientAutoOf(items);
    state = {
      now,
      cards,
      jumps: [...jumps],
      graph,
      control,
      ...(conditions && { conditions }),
      ...(causes && { causes }),
      ...(reactions.length > 0 && { reactions: linked() }),
      ...(clientAuto !== undefined && { clientAuto }),
    };
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
    } else if (e.type === "stand") {
      // Запись журнала стенда (сбой, пометка, действие кнопки) — пересчёт: условия журнала и «упреждено» (П-8.2).
      if (o.standLog) schedule();
    } else if (e.type === "reset") {
      items.length = 0;
      reactions = [];
      lastEv = undefined;
      column.clear();
      jumps = [];
      schedule();
    } else if (e.type === "status") emit({ type: "status", status: e.status });
  });
  // Накопленное до подписки — сразу.
  recompute();

  return {
    board: () => state,
    react(r) {
      reactions = [...reactions, r].slice(-REACTIONS_KEPT);
      state = { ...state, reactions: linked() };
      emit({ type: "board", board: state });
    },
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
