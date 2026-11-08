// Сменный адаптер источника данных дашбордов DEMO-2 (Р-1246 п. 3, Р-1275 п. 2). Экраны «Интерпретация» и «Контроль»
// получают записи шины и снимок реестров диагностики только через DashboardSource: сейчас — локальный стенд по HTTP
// (`localStandSource`), для ACC-2 — песочница только на чтение, через Платформу. Код агента и Платформы не импортируется.
// Источник только читает: методов, которые что-то меняют на стенде, у него нет.
import { INSTANCE_HEADER, isHiddenScenarioItem, parseDiagSnapshot, parseWireItem, seqOfItem, type DiagSnapshot, type WireItem } from "./wire.js";

/** `reset` — источник начал ленту заново (перезапуск стенда): потребитель сбрасывает то, что накопил. */
export type SourceStatus = "connecting" | "open" | "reset" | "closed";

/** Машинные коды ошибок адаптера; текст — словарями экрана (инвариант 7, языки). */
export type SourceErrorCode =
  | "SOURCE_NOT_LOCAL"
  | "SOURCE_UNAVAILABLE"
  | "SOURCE_DIAG_TIMEOUT"
  | "SOURCE_DIAG_STATUS"
  | "SOURCE_DIAG_TYPE"
  | "SOURCE_DIAG_TOO_LARGE"
  | "SOURCE_DIAG_FORM"
  | "SOURCE_CLOSED";

export class SourceError extends Error {
  constructor(readonly code: SourceErrorCode) {
    super(code);
  }
}

export interface DashboardSource {
  /** Записи шины без повторов. Номера seq могут прийти не по возрастанию: строка события Платформы получает номер при
   *  приёме, а уходит после ожидания суммы (шина демо-стенда, ревью К2.2б Н3). Вернуть — отписка; линию закрывает
   *  только `close()`, отписка последнего слушателя её не останавливает. */
  subscribe(onItem: (item: WireItem) => void): () => void;
  /** Состояние линии; слушатель сразу получает текущее. Вернуть — отписка. */
  onStatus(listener: (s: SourceStatus) => void): () => void;
  /** Снимок реестров диагностики источника. */
  diag(): Promise<DiagSnapshot>;
  /** Сколько записей отброшено как записи не по форме (линия и снимок). */
  readonly rejected: number;
  close(): Promise<void>;
}

export interface LocalStandSourceOptions {
  /** Пауза перед переподключением после обрыва ленты, мс. */
  retryMs?: number;
  /** Предел одной записи ленты, символов: длиннее — запись отброшена, линия переподключается (fail-closed). */
  maxEventChars?: number;
  /** Предел снимка реестров, символов. */
  maxDiagChars?: number;
  /** Тайм-аут чтения снимка, мс. */
  diagTimeoutMs?: number;
  /** Сколько номеров помнить для отсечения повторов — по каждому потоку отдельно, как шина ведёт историю (по 1000 на
   *  поток): предел потока не меньше его истории, поэтому вытесненный номер в истории уже не встретится (ревью К1.2 Н1). */
  seenLimit?: number;
  /** Сколько close() ждёт выхода линии, мс (страховка К1.4г, Р-1339): по истечении — выход, линия дорывается сама. */
  closeWaitMs?: number;
}

/** Только 127.0.0.1 (П2 п. 2): `localhost` может разрешиться в другой адрес. */
const LOCAL_HOST = "127.0.0.1";

/** Адаптер «локальный стенд»: лента — SSE `GET /events`, снимок — `GET /api/diag`; без перенаправлений. */
export function localStandSource(baseUrl: string, o: LocalStandSourceOptions = {}): DashboardSource {
  const base = new URL(baseUrl);
  if (base.protocol !== "http:" || base.hostname !== LOCAL_HOST) throw new SourceError("SOURCE_NOT_LOCAL");
  const retryMs = o.retryMs ?? 1000;
  const maxEvent = o.maxEventChars ?? 256 * 1024;
  const maxDiag = o.maxDiagChars ?? 4 * 1024 * 1024;
  const diagTimeoutMs = o.diagTimeoutMs ?? 5000;
  const seenLimit = o.seenLimit ?? 10_000;
  const closeWaitMs = o.closeWaitMs ?? 1000;
  const items = new Set<(i: WireItem) => void>();
  const statuses = new Set<(s: SourceStatus) => void>();
  /** Полученные номера по потокам, в порядке получения: Set хранит порядок вставки, старые вытесняются по пределу потока.
   *  Шумная консоль не вытесняет номера монитора (ревью К1.2 Н1). */
  const seen: Record<WireItem["stream"], Set<number>> = { monitor: new Set(), console: new Set(), scenario: new Set() };
  const clearSeen = () => Object.values(seen).forEach((s) => s.clear());
  let instance: string | undefined;
  let status: SourceStatus = "closed";
  let rejected = 0;
  let closed = false;
  let abort: AbortController | undefined;
  let loop: Promise<void> | undefined;
  let retry: { timer: NodeJS.Timeout; wake: () => void } | undefined;
  const pending = new Set<AbortController>();

  const setStatus = (s: SourceStatus) => {
    if (s === status) return;
    status = s;
    for (const l of [...statuses])
      try {
        l(s);
      } catch {
        // Сбой слушателя не обрывает линию и не мешает остальным.
      }
  };

  const deliver = (data: string) => {
    if (data.length > maxEvent) {
      rejected++;
      return;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(data);
    } catch {
      rejected++;
      return;
    }
    // Шаг, скрытый по правилу (код «SMS банка»), — не испорченная запись: в счётчик не идёт (ревью К1.2 Н3).
    if (isHiddenScenarioItem(raw)) return;
    const item = parseWireItem(raw);
    if (!item) {
      rejected++;
      return;
    }
    // История приходит заново на каждом подключении: уже переданные номера не повторяются.
    const seq = seqOfItem(item);
    const s = seen[item.stream];
    if (s.has(seq)) return;
    s.add(seq);
    if (s.size > seenLimit) s.delete(s.values().next().value!);
    for (const l of [...items])
      try {
        l(item);
      } catch {
        // Сбой слушателя не обрывает линию и не мешает остальным.
      }
  };

  const readOnce = async (signal: AbortSignal) => {
    const res = await fetch(new URL("/events", base), { signal, redirect: "error", headers: { accept: "text/event-stream" } });
    if (res.status !== 200 || !res.body || !(res.headers.get("content-type") ?? "").startsWith("text/event-stream")) {
      await res.body?.cancel().catch(() => undefined);
      return;
    }
    // Другой экземпляр шины — лента начата заново: номера seq снова с 1, отсечение повторов сбрасывается.
    const inst = res.headers.get(INSTANCE_HEADER) ?? undefined;
    if (instance !== undefined && inst !== instance) {
      clearSeen();
      setStatus("reset");
    }
    instance = inst;
    setStatus("open");
    const reader = res.body.getReader();
    // Отмена fetch на Node 20 и 22 не всегда обрывает уже начатое чтение тела: read() ждал бы конца потока от сервера,
    // а сервер монитора закрывает поток только после закрытия этой ленты — взаимное ожидание (CI К1.4, К1.4г, Р-1339).
    // Поэтому при отмене чтение рвётся явно: cancel() завершает ждущий read() с done на любой версии Node.
    const onAbort = () => void reader.cancel().catch(() => undefined);
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
    try {
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        buf += dec.decode(value, { stream: true }).replace(/\r\n?/g, "\n");
        let cut: number;
        while ((cut = buf.indexOf("\n\n")) >= 0) {
          const block = buf.slice(0, cut);
          buf = buf.slice(cut + 2);
          const data = block
            .split("\n")
            .filter((l) => l.startsWith("data:"))
            .map((l) => l.slice(5).replace(/^ /, ""))
            .join("\n");
          if (data) deliver(data);
        }
        if (buf.length > maxEvent) {
          // Запись без конца длиннее предела — линия не по форме: рвётся и переподключается.
          rejected++;
          await reader.cancel().catch(() => undefined);
          return;
        }
      }
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
  };

  const run = async () => {
    while (!closed) {
      abort = new AbortController();
      setStatus("connecting");
      try {
        await readOnce(abort.signal);
      } catch {
        // Обрыв, отказ соединения или перенаправление — переподключение ниже.
      }
      if (closed) break;
      setStatus("connecting");
      await new Promise<void>((wake) => {
        retry = { timer: setTimeout(wake, retryMs), wake };
        retry.timer.unref();
      });
      retry = undefined;
    }
    setStatus("closed");
  };

  return {
    subscribe(onItem) {
      items.add(onItem);
      if (!loop && !closed) loop = run();
      return () => void items.delete(onItem);
    },
    onStatus(listener) {
      statuses.add(listener);
      listener(status);
      return () => void statuses.delete(listener);
    },
    async diag() {
      if (closed) throw new SourceError("SOURCE_CLOSED");
      const ac = new AbortController();
      pending.add(ac);
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        ac.abort();
      }, diagTimeoutMs);
      try {
        let res: Response;
        try {
          res = await fetch(new URL("/api/diag", base), { signal: ac.signal, redirect: "error", headers: { accept: "application/json" } });
        } catch {
          // Тайм-аут, отказ соединения, перенаправление, close() — каждый своим машинным кодом (ревью К1.2 Н2).
          throw new SourceError(closed ? "SOURCE_CLOSED" : timedOut ? "SOURCE_DIAG_TIMEOUT" : "SOURCE_UNAVAILABLE");
        }
        if (res.status !== 200) {
          await res.body?.cancel().catch(() => undefined);
          throw new SourceError("SOURCE_DIAG_STATUS");
        }
        if (!(res.headers.get("content-type") ?? "").startsWith("application/json")) {
          await res.body?.cancel().catch(() => undefined);
          throw new SourceError("SOURCE_DIAG_TYPE");
        }
        const declared = Number(res.headers.get("content-length") ?? "0");
        if (declared > maxDiag) {
          await res.body?.cancel().catch(() => undefined);
          throw new SourceError("SOURCE_DIAG_TOO_LARGE");
        }
        // Предел — и при чтении потока: без content-length ответ в память целиком не берётся.
        let text = "";
        try {
          const reader = res.body!.getReader();
          const dec = new TextDecoder();
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            text += dec.decode(value, { stream: true });
            if (text.length > maxDiag) {
              await reader.cancel().catch(() => undefined);
              throw new SourceError("SOURCE_DIAG_TOO_LARGE");
            }
          }
        } catch (e) {
          if (e instanceof SourceError) throw e;
          throw new SourceError(closed ? "SOURCE_CLOSED" : timedOut ? "SOURCE_DIAG_TIMEOUT" : "SOURCE_UNAVAILABLE");
        }
        let raw: unknown;
        try {
          raw = JSON.parse(text);
        } catch {
          throw new SourceError("SOURCE_DIAG_FORM");
        }
        const r = parseDiagSnapshot(raw);
        if (!r) throw new SourceError("SOURCE_DIAG_FORM");
        rejected += r.rejected;
        return r.snapshot;
      } finally {
        clearTimeout(timer);
        pending.delete(ac);
      }
    },
    get rejected() {
      return rejected;
    },
    async close() {
      closed = true;
      abort?.abort();
      for (const ac of pending) ac.abort();
      if (retry) {
        clearTimeout(retry.timer);
        retry.wake();
      }
      // Страховка (Р-1339): линию ждём не дольше closeWaitMs — закрытие не зависит от того, как платформа рвёт чтение.
      let guard: NodeJS.Timeout | undefined;
      await Promise.race([
        loop,
        new Promise<void>((ok) => {
          guard = setTimeout(ok, closeWaitMs);
          guard.unref();
        }),
      ]);
      clearTimeout(guard);
      setStatus("closed");
    },
  };
}
