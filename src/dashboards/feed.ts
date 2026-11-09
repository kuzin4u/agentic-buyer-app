// Лента экрана «Интерпретация» (К1.4 DEMO-2 ч. 1): записи шины из сменного адаптера источника (Р-1246 п. 3) →
// интерпретации по правилам К1.3. Снимок реестров читается у того же источника; пока его нет, записи ждут в очереди.
// Перезапуск источника (`reset`) сбрасывает накопленное: номера seq начались заново. Лента только читает.
import { interpret, type Interpretation, type InterpretEnv, type Role } from "./interpret.js";
import type { DashboardSource, SourceStatus } from "./source.js";
import { SourceError } from "./source.js";
import type { DiagSnapshot, WireItem } from "./wire.js";

/** Состояние снимка реестров: ждём, есть, не получен (тогда коды — «неизвестно», код ошибки адаптера — для экрана). */
export type DiagState = { readonly state: "loading" } | { readonly state: "ready" } | { readonly state: "failed"; readonly code: string };

export type FeedEvent =
  | { readonly type: "item"; readonly item: Interpretation }
  | { readonly type: "reset" }
  | { readonly type: "status"; readonly status: SourceStatus }
  | { readonly type: "diag"; readonly diag: DiagState };

export interface InterpretFeed {
  /** Накопленные интерпретации по возрастанию seq. */
  list(): readonly Interpretation[];
  status(): SourceStatus;
  diag(): DiagState;
  /** Вернуть — отписка. Слушатель получает только новые события; накопленное — через list(). */
  subscribe(l: (e: FeedEvent) => void): () => void;
  close(): Promise<void>;
}

export interface InterpretFeedOptions {
  readonly emulated: readonly Role[];
  readonly rogueAgent?: boolean;
  /** Учебные витрины источника: merchant_id → префиксы кодов учебного сбоя (З10). */
  readonly training?: Readonly<Record<string, readonly string[]>>;
  /** Сколько интерпретаций помнить; старшие по seq вытесняют младшие. */
  readonly limit?: number;
}

const EMPTY: DiagSnapshot = { v: 1, registries: [] };

export function createInterpretFeed(source: DashboardSource, o: InterpretFeedOptions): InterpretFeed {
  const limit = o.limit ?? 2000;
  const items: Interpretation[] = [];
  const listeners = new Set<(e: FeedEvent) => void>();
  let status: SourceStatus = "connecting";
  let diag: DiagState = { state: "loading" };
  let env: InterpretEnv | undefined;
  let queue: WireItem[] = [];

  const emit = (e: FeedEvent) => {
    for (const l of listeners) {
      try {
        l(e);
      } catch {
        // Слушатель (соединение экрана) упал — ленту и других слушателей это не останавливает.
      }
    }
  };

  const add = (w: WireItem) => {
    if (!env) {
      queue.push(w);
      return;
    }
    const r = interpret(w, env);
    // Вставка по seq: событие Платформы может прийти после записей с большим номером.
    let i = items.length;
    while (i > 0 && items[i - 1]!.seq > r.seq) i--;
    // Лента полна, а запись младше всех — она сразу вытеснилась бы: экрану её не отправляем (ревью К1.4 № 8).
    if (items.length >= limit && i === 0) return;
    items.splice(i, 0, r);
    if (items.length > limit) items.splice(0, items.length - limit);
    emit({ type: "item", item: r });
  };

  // Снимок реестров — у текущего экземпляра источника; после перезапуска (reset) — заново: у нового экземпляра
  // реестры могут быть другими (песочница новой версии для ACC-2). Ответ прежнего запроса отбрасывается (ревью К1.4 № 1).
  let generation = 0;
  const loadDiag = () => {
    const g = ++generation;
    env = undefined;
    diag = { state: "loading" };
    const ready = (snapshot: DiagSnapshot, d: DiagState) => {
      if (g !== generation) return;
      env = {
        snapshot,
        emulated: o.emulated,
        ...(o.rogueAgent !== undefined && { rogueAgent: o.rogueAgent }),
        ...(o.training !== undefined && { training: o.training }),
      };
      diag = d;
      emit({ type: "diag", diag });
      const q = queue;
      queue = [];
      for (const w of q) add(w);
    };
    source.diag().then(
      (s) => ready(s, { state: "ready" }),
      (e: unknown) => ready(EMPTY, { state: "failed", code: e instanceof SourceError ? e.code : "SOURCE_UNAVAILABLE" }),
    );
  };
  loadDiag();

  const offStatus = source.onStatus((s) => {
    if (s === "reset") {
      items.length = 0;
      queue = [];
      emit({ type: "reset" });
      loadDiag();
      emit({ type: "diag", diag });
    }
    status = s;
    emit({ type: "status", status: s });
  });
  const offItems = source.subscribe(add);

  return {
    list: () => [...items],
    status: () => status,
    diag: () => diag,
    subscribe(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    async close() {
      offItems();
      offStatus();
      listeners.clear();
      await source.close();
    },
  };
}
