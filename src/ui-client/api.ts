// Обращения каркаса к серверу приложения (ИН-0, кирпич К3; контракт К-Б § 3, § 5.3, § 5.9).
//
// Весь разговор с сервером — здесь, а не в разметке: так видно, что экран **читает** и ничего не решает (правило 3).
// Чего в этом файле нет и быть не должно:
// - арифметики над деньгами (инвариант 2; проверяется тестом К4 по исходнику);
// - перечня языков, шагов и текстов: язык приходит атрибутом страницы и уходит обратно как есть — проверяет его
//   **сервер** (`langOf`), а подписи и перечни приходят с `GET /ui/shell`. Своей копии перечня у экрана нет
//   (Р-1511 «закрытые перечни — из кода источника»);
// - чтения статусов и сумм из события потока: событие — только сигнал (правило 4, П31), из него берётся один
//   `purchase_id`, чтобы знать, **что перечитать**.
import type { PurchaseResponse, UiErrorBody } from "../contract/ui-v1/index.js";
import type { ShellData } from "../ui-server/shell.js";

/** Тело ошибки § 3 без обёртки. */
export type UiFailure = UiErrorBody["error"];

/** Исход чтения: `error === null` — связи нет или ответ не разобран, и показывать нечего (правило 4). */
export type Read<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: UiFailure | null };

/** Язык страницы — тот, который **выбрал сервер** (атрибут `data-lang` точки монтирования). Экран его не разбирает и
 *  не сверяет с перечнем: негодное значение отбросит сервер и ответит на языке по умолчанию. */
export function mountLang(host: HTMLElement): string {
  return host.dataset["lang"] ?? "";
}

/** Опознаватель покупки из адреса страницы. Нет — каркас показывает шаги без данных. */
export function purchaseIdOf(): string | null {
  return new URLSearchParams(window.location.search).get("purchase");
}

/** Адрес той же страницы на другом языке; опознаватель покупки сохраняется. */
export function langHref(lang: string): string {
  const u = new URL(window.location.href);
  u.searchParams.set("lang", lang);
  return `${u.pathname}${u.search}`;
}

const query = (lang: string): string => `?lang=${encodeURIComponent(lang)}`;

/** Общее чтение JSON: тело ошибки § 3 разбирается тем же путём, что удачный ответ, — одна форма на все методы. */
async function read<T>(url: string): Promise<Read<T>> {
  let res: Response;
  try {
    res = await fetch(url, { credentials: "same-origin", headers: { accept: "application/json" } });
  } catch {
    // Сети нет — это «нет связи», а не ошибка контракта: кода у неё не существует, и выдумывать его нельзя.
    return { ok: false, error: null };
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { ok: false, error: null };
  }
  if (res.ok) return { ok: true, value: body as T };
  const failure = (body as UiErrorBody | null)?.error;
  return { ok: false, error: failure ?? null };
}

/** Данные каркаса: подписи, перечни, тексты (`GET /ui/shell`). */
export const loadShell = (lang: string): Promise<Read<ShellData>> => read<ShellData>(`/ui/shell${query(lang)}`);

/** Состояние покупки (§ 5.3). Шаг экрана приходит полем `step` — своей таблицы у экрана нет. */
export const loadPurchase = (id: string, lang: string): Promise<Read<PurchaseResponse>> =>
  read<PurchaseResponse>(`/ui/v1/purchase/${encodeURIComponent(id)}${query(lang)}`);

/**
 * Поток сигналов (§ 5.9). Обработчик получает `purchase_id` сигнала — и больше ничего: ни статуса, ни сумм в событии
 * нет, а если источник их однажды пришлёт, они здесь не читаются (правило 4 — поток только сигнал).
 *
 * Повторную доставку («не менее одного раза») браузер отбрасывает сам по `id:` строки SSE; пауза перед повторным
 * подключением приходит с сервера полем `retry:`.
 */
export function openFeed(onSignal: (purchaseId: string) => void, onBreak: () => void): EventSource {
  const feed = new EventSource("/ui/v1/feed");
  feed.addEventListener("purchase", (e: MessageEvent<string>) => {
    let signal: unknown;
    try {
      signal = JSON.parse(e.data);
    } catch {
      return;
    }
    const id = (signal as { purchase_id?: unknown } | null)?.purchase_id;
    if (typeof id === "string") onSignal(id);
  });
  feed.addEventListener("error", onBreak);
  return feed;
}
