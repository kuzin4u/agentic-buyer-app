// «Ленты» пульта (П-5.2; модель пульта 1.23, панель «Интерпретатор»; Р-1329, Р-1330 — на основе экрана К1.4): «Лента
// простыми словами» — фраза интерпретатора, участник, вид записи; «Лента шины» — поток, что пришло, идентификаторы. У каждой
// строки — транзакция пульта (модель П-1.2), по ней — сводка транзакции в фокусе (К1.4 № 6: одна строка на запись, сводки
// по транзакции не было).
//
// Только чтение: модуль берёт интерпретации ленты экранов (`InterpretFeed.list` / `subscribe`) — журнал стенда (событие
// `stand`, П-11.2а) и записи вне интерпретатора сюда не попадают, в `interpret` ничего нового не идёт. На экран — только
// идентификаторы, коды и фразы интерпретатора (инвариант 1). Текст продавца (название товара, ответ витрины) попадает во фразы
// как данные и на странице выводится только текстом (инвариант 4).
// Логику ленты пульта окна А (`feed.ts`) модуль не трогает: своя лента `/pult/feeds` (Р-1523, В17 (а)).
import type { FeedEvent, InterpretFeed } from "../dashboards/feed.js";
import type { Interpretation, Kind, Role, Stage, Texts, TxIds } from "../dashboards/interpret.js";
import { LABELS } from "../dashboards/phrases.js";
import type { WireLang } from "../dashboards/wire.js";
import { buildTxModel, type TxOutcomeKind } from "./tx.js";

/** Сколько последних записей показывают ленты (страница и так листает; модель транзакций — по всем записям ленты экранов). */
export const FEEDS_ROWS = 200;
/** Пересчёт не чаще раза в N мс: пачка шины (200 мс) — одно сообщение странице. */
export const FEEDS_DEBOUNCE_MS = 200;

export interface PlainRow {
  readonly seq: number;
  readonly at: string;
  readonly actor: Role;
  readonly emulated: boolean;
  readonly kind: Kind;
  readonly stage: Stage;
  readonly phrase: Texts;
  readonly tx?: string;
}

export interface BusRow {
  readonly seq: number;
  readonly at: string;
  readonly stream: Interpretation["stream"];
  /** Что пришло: шаблон маршрута, тип события, код шага или записи журнала агента. */
  readonly ref: string;
  readonly source?: string;
  readonly status?: string;
  readonly ids?: TxIds;
  readonly tx?: string;
}

/** Сводка транзакции (К1.4 № 6): стадия, итог по событию Платформы, худший вид, продавцы, число записей, время. */
export interface TxSummary {
  readonly id: string;
  readonly stage: Stage;
  readonly outcome?: TxOutcomeKind;
  readonly worst: Kind;
  readonly merchantIds: readonly string[];
  readonly records: number;
  readonly firstAt: string;
  readonly lastAt: string;
  readonly linkConflict: boolean;
}

export interface FeedsView {
  readonly plain: readonly PlainRow[];
  readonly bus: readonly BusRow[];
  /** Сводки всех транзакций модели (по всей ленте экранов, а не только по окну строк) — по номеру транзакции: фокус на
   *  транзакцию из начала долгого прогона показывает её сводку (ревью П-5.2 № 1). */
  readonly txs: Readonly<Record<string, TxSummary>>;
}

/** «Ленты» по интерпретациям ленты экранов: последние `rows` записей и сводки их транзакций. */
export function feedsView(items: readonly Interpretation[], rows = FEEDS_ROWS): FeedsView {
  const model = buildTxModel(items);
  const txOf = new Map<number, string>();
  for (const t of model.txs) for (const s of t.seqs) txOf.set(s, t.id);
  const last = [...items].sort((a, b) => a.seq - b.seq).slice(-rows);
  const plain: PlainRow[] = [];
  const bus: BusRow[] = [];
  for (const r of last) {
    const tx = txOf.get(r.seq);
    plain.push({ seq: r.seq, at: r.at, actor: r.actor, emulated: r.emulated, kind: r.kind, stage: r.stage, phrase: r.phrase, ...(tx !== undefined && { tx }) });
    bus.push({
      seq: r.seq,
      at: r.at,
      stream: r.stream,
      ref: r.ref,
      ...(r.source !== undefined && { source: r.source }),
      ...(r.status !== undefined && { status: r.status }),
      ...(r.ids !== undefined && Object.keys(r.ids).length > 0 && { ids: r.ids }),
      ...(tx !== undefined && { tx }),
    });
  }
  const txs: Record<string, TxSummary> = {};
  for (const t of model.txs) {
    txs[t.id] = {
      id: t.id,
      stage: t.stage,
      ...(t.outcome && { outcome: t.outcome.kind }),
      worst: t.worst,
      merchantIds: t.merchantIds,
      records: t.seqs.length,
      firstAt: t.firstAt,
      lastAt: t.lastAt,
      linkConflict: t.linkConflict !== undefined,
    };
  }
  return { plain, bus, txs };
}

export type FeedsEvent = { readonly type: "feeds"; readonly view: FeedsView } | { readonly type: "reset" };

export interface FeedsFeed {
  view(): FeedsView;
  /** Вернуть — отписка. Слушатель получает новые виды; текущий — через `view()`. */
  subscribe(l: (e: FeedsEvent) => void): () => void;
  close(): void;
}

/** Лента «Лент» поверх ленты экранов: пересчёт на новую интерпретацию — не чаще `debounceMs`; `reset` — сразу пусто. Событие
 *  `stand` ленты экранов не учитывается (журнал стенда — для движка, П-11.2а). */
export function createFeedsFeed(feed: InterpretFeed, o: { readonly rows?: number; readonly debounceMs?: number } = {}): FeedsFeed {
  const rows = o.rows ?? FEEDS_ROWS;
  const debounceMs = o.debounceMs ?? FEEDS_DEBOUNCE_MS;
  const listeners = new Set<(e: FeedsEvent) => void>();
  /** Отпечаток ленты экранов: число записей и наибольший номер — без изменений пересчёт не шлёт вид (ревью П-5.2 № 2). */
  const stamp = (list: readonly Interpretation[]) => `${list.length}:${list.reduce((m, r) => Math.max(m, r.seq), 0)}`;
  let view = feedsView(feed.list(), rows);
  let last = stamp(feed.list());
  let timer: NodeJS.Timeout | undefined;
  let closed = false;
  const emit = (e: FeedsEvent) => {
    for (const l of [...listeners])
      try {
        l(e);
      } catch {
        // Сбой слушателя (соединение страницы) ленту не останавливает.
      }
  };
  const recompute = () => {
    timer = undefined;
    if (closed) return;
    const list = feed.list();
    const s = stamp(list);
    if (s === last) return;
    try {
      view = feedsView(list, rows);
      last = s;
    } catch {
      return; // сбой пересчёта — прежний вид остаётся
    }
    emit({ type: "feeds", view });
  };
  const off = feed.subscribe((e: FeedEvent) => {
    if (closed) return;
    if (e.type === "item") {
      if (timer === undefined) {
        timer = setTimeout(recompute, debounceMs);
        timer.unref();
      }
    } else if (e.type === "reset") {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      view = { plain: [], bus: [], txs: {} };
      last = stamp([]);
      emit({ type: "reset" });
    }
  });
  return {
    view: () => view,
    subscribe(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    close() {
      closed = true;
      if (timer !== undefined) clearTimeout(timer);
      off();
      listeners.clear();
    },
  };
}

const p = (ru: string, en: string): Texts => ({ ru, en });

/** Подписи «Лент» на странице (ru/en): страница получает их в первом сообщении ленты на языке страницы. */
export const FEEDS_LABELS = {
  "feeds.view.plain": p("Простыми словами", "In plain words"),
  "feeds.view.bus": p("Шина", "Bus"),
  "feeds.views": p("Ленты", "Feeds"),
  "feeds.empty": p("Записей пока нет", "No records yet"),
  "feeds.paused": p("лента на паузе", "feed paused"),
  "feeds.tx": p("Транзакция", "Transaction"),
  "feeds.tx.none": p("Сводка — при транзакции в фокусе; ленты — по всей системе", "Summary — with a transaction in focus; feeds — for the whole system"),
  "feeds.tx.stage": p("стадия", "stage"),
  "feeds.tx.outcome": p("итог по событию Платформы", "outcome from the Platform event"),
  "feeds.tx.outcome.none": p("итога нет", "no outcome"),
  "feeds.tx.worst": p("худшее", "worst"),
  "feeds.tx.merchants": p("продавцы", "merchants"),
  "feeds.tx.records": p("записей", "records"),
  "feeds.tx.conflict": p("конфликт звеньев — решает человек", "link conflict — a person decides"),
  "feeds.tx.missing": p("транзакции в ленте экранов нет", "the transaction is not in the screens feed"),
  "outcome.paid": p("оплачено", "paid"),
  "outcome.settled": p("расчёт", "settled"),
  "outcome.declined": p("отказ", "declined"),
  "outcome.rejected": p("подтверждение отклонено", "confirmation rejected"),
  "outcome.revoked": p("отозвано", "revoked"),
  "stream.monitor": p("монитор", "monitor"),
  "stream.console": p("журнал агента", "agent log"),
  "stream.scenario": p("сюжет", "scenario"),
} as const satisfies Readonly<Record<string, Texts>>;

/** Подписи на одном языке — для первого сообщения ленты. Участники, виды записей, стадии и «эмулятор» — из словаря экрана
 *  «Интерпретация» (`LABELS`, К1.4): «Ленты» построены на нём (Р-1329, Р-1330), и один участник на двух экранах называется
 *  одинаково (ревью П-5.2 № 3). */
export const feedsLabels = (lang: WireLang): Readonly<Record<string, string>> => {
  const out: Record<string, string> = Object.fromEntries(Object.entries(FEEDS_LABELS).map(([k, v]) => [k, v[lang]]));
  for (const [k, v] of Object.entries(LABELS.role)) out[`actor.${k}`] = v[lang];
  for (const [k, v] of Object.entries(LABELS.kind)) out[`kind.${k}`] = v[lang];
  for (const [k, v] of Object.entries(LABELS.stage)) out[`stage.${k}`] = v[lang];
  out["feeds.emulated"] = LABELS.emulated[lang];
  return out;
};
