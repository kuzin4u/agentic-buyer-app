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
import { bootDatasetKey, type BootKey } from "../ui-server/boot-text.js";
import type { ShellData } from "../ui-server/shell.js";

/** Тело ошибки § 3 без обёртки. */
export type UiFailure = UiErrorBody["error"];

/**
 * Почему чтение не удалось:
 * - `contract` — сервер ответил телом § 3: есть код и «что делать», их и показываем;
 * - `offline` — запрос не ушёл (сети нет): кода у этого случая не существует;
 * - `no_session` — действующей сессии приложения нет: **401** `SESSION_REQUIRED` у маршрутов контракта (кирпич К7,
 *   Р-1665) и **403** у раздачи каркаса, где кодов контракта нет. Лечится не повтором того же чтения, а открытием
 *   страницы, которая сессию выдаёт; повтор крутился бы без выхода (находка ревью К3а № 1);
 * - `broken` — ответ пришёл, но не по форме контракта (служебный `text/plain`, 500, 421).
 *
 * Разделение не формальность: «нет связи», «вход не выполнен» и «сбой на нашей стороне» это **разные причины**, и
 * показывать одну вместо другой значит говорить человеку неправду о том, что случилось (находка ревью К3 № 2).
 */
export type ReadFail =
  | { readonly reason: "contract"; readonly error: UiFailure }
  | { readonly reason: "offline" | "broken" | "no_session"; readonly error: null };

/** Неудача **без** тела § 3. Отдельным типом, чтобы выбор строки «нет связи / вход истёк / сбой» нельзя было вызвать
 *  на отказе по контракту: у того своё тело с кодом и «что делать», и общая строка скрыла бы его (находка ревью
 *  К4 № 14). Случай закрыт типом, а не договорённостью. */
export type ReadFailPlain = Extract<ReadFail, { reason: "offline" | "broken" | "no_session" }>;

/** Исход чтения. */
export type Read<T> = ({ readonly ok: true; readonly value: T }) | ({ readonly ok: false } & ReadFail);

/** Язык страницы — тот, который **выбрал сервер** (атрибут `data-lang` точки монтирования). Экран его не разбирает и
 *  не сверяет с перечнем: негодное значение отбросит сервер и ответит на языке по умолчанию. */
export function mountLang(host: HTMLElement): string {
  return host.dataset["lang"] ?? "";
}

/** Строки, которые нужны **до** словаря: пока `GET /ui/shell` не доехал, сказать «нет связи», «сбой», «вход не
 *  выполнен» и «повторить» больше нечем. Их положил на страницу сервер и на выбранном им языке — своего словаря у
 *  экрана по-прежнему нет (находка ревью К3 № 1). Читаются по именам из `boot-text.ts`: перечень один на сервер и на
 *  экран, второй копии имён нет (находка ревью К3а № 4). */
export type BootText = Readonly<Record<BootKey, string>>;

export function mountBootText(host: HTMLElement): BootText {
  // Атрибута нет (страница и сборка разошлись версиями) — показывается сам ключ: видно, чего не доехало, и кнопка
  // остаётся с подписью и нажимаемой. Пустая строка давала бы кнопку без подписи, то есть снова экран без выхода
  // (находка ревью К3б № 7); тот же приём, что у подписи раздела и класса повтора.
  const read = (key: BootKey): string => host.dataset[bootDatasetKey(key)] ?? key;
  return {
    "state.offline": read("state.offline"),
    "state.broken": read("state.broken"),
    "state.session_gone": read("state.session_gone"),
    "action.retry": read("action.retry"),
    "action.reopen": read("action.reopen"),
  };
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

/** Адрес этой же страницы. Переход по нему получает страницу заново, а страница выдаёт сессию приложения — это
 *  единственный выход из «вход не выполнен» (повтор того же чтения ничего не изменил бы). */
export const pageHref = (): string => `${window.location.pathname}${window.location.search}`;

const query = (lang: string): string => `?lang=${encodeURIComponent(lang)}`;

/** Общее чтение JSON: тело ошибки § 3 разбирается тем же путём, что удачный ответ, — одна форма на все методы. */
async function read<T>(url: string): Promise<Read<T>> {
  let res: Response;
  try {
    res = await fetch(url, { credentials: "same-origin", headers: { accept: "application/json" } });
  } catch {
    // Сети нет — это «нет связи», а не ошибка контракта: кода у неё не существует, и выдумывать его нельзя.
    return { ok: false, reason: "offline", error: null };
  }
  // Сессии нет — отдельная причина и отдельное лечение: открыть страницу заново, а не повторять то же чтение.
  // **401** — код контракта `SESSION_REQUIRED` у маршрутов `/ui/v1` (кирпич К7, Р-1665); **403** — тот же случай у
  // раздачи каркаса, где кодов контракта нет и ответ служебный (`text/plain`). Статус проверяется до разбора тела:
  // причина одна, и тело для неё не нужно.
  if (res.status === 401 || res.status === 403) return { ok: false, reason: "no_session", error: null };
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    // Ответ есть, но он не по форме контракта: служебные ответы сервера идут `text/plain` (404, 405, 421, 500).
    return { ok: false, reason: "broken", error: null };
  }
  if (res.ok) return { ok: true, value: body as T };
  // Проверяется **форма** тела, а не только наличие ключа: `{"error": null}` проходило проверку «нет поля» и уезжало
  // в ветку отказа с `error: null` — вопреки собственному типу, а на отрисовке давало исключение и пустой экран без
  // выхода (находка ревью К3а № 3). Негодное тело — это `broken`, как и неразобранное.
  const failure = (body as UiErrorBody | null)?.error;
  const looksLikeFailure =
    typeof failure === "object" &&
    failure !== null &&
    typeof failure.code === "string" &&
    typeof failure.text === "string" &&
    typeof failure.retry === "string";
  return looksLikeFailure ? { ok: false, reason: "contract", error: failure } : { ok: false, reason: "broken", error: null };
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
export function openFeed(onSignal: (purchaseId: string) => void, onBreak: (closed: boolean) => void, onBack: () => void): EventSource {
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
  // Обрыв обрыву не равен: при 403 и 404 браузер уводит поток в `CLOSED` и **не переподключается никогда** — сигналов
  // не будет вовсе, и показанное нельзя считать свежим ни сейчас, ни потом (находка ревью К3а № 2). Временный обрыв
  // браузер лечит сам, пауза приходит полем `retry:`.
  feed.addEventListener("error", () => onBreak(feed.readyState === EventSource.CLOSED));
  // Подключение восстановилось: пока поток молчал, покупка могла измениться — и об этом нам уже не сообщат, значит
  // надо перечитать (находка ревью К3 № 7). Браузер переподключается сам, пауза приходит полем `retry:`.
  feed.addEventListener("open", onBack);
  return feed;
}
