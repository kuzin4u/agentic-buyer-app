// Сервер `/ui/v1` — пользовательская граница приложения (контракт К-Б, решение П4 п. 4; ИН-0, кирпичи К1 и К2).
//
// Живёт в том же процессе, что монитор и пульт (`src/demo/server.ts`, К-Б § 1), но **своим** модулем: `src/demo/` —
// тестовый интерфейс (П2), а `/ui/v1` — пользовательский, и смешивать их границы нельзя. Отсюда и граница импортов:
// только `node:*`, свои модули, типы контракта КТ-0 и общая таблица ISO 4217 — ни стенда Платформы, ни адаптера ПАО
// (правило планов № 1 «только через порт»).
//
// Что делает общий слой (§ 3): требует ключ повтора у каждого POST (правило 2), отдаёт одно тело ошибки, выбирает язык
// по `?lang=`, на чужую, неизвестную и не по форме покупку отвечает **одним** `PURCHASE_NOT_FOUND`, а без действующей
// сессии — **одним** `SESSION_REQUIRED` 401 на любой адрес (кирпич К7).
// Чего он не делает: не считает суммы и пределы и не решает за ядро (инвариант 2), не отдаёт реквизитов, `kid` и
// криптограммы (инвариант 1), не рисует итог по событию потока (правило 4, П31).
//
// В ИН-0 зарегистрированы ровно два метода — `GET /ui/v1/purchase/{id}` и `GET /ui/v1/feed`; остальные методы контракта
// появятся своими кирпичами. Поэтому любой другой адрес под `/ui/v1` — 404, а не «метод есть, но пока молчит».
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { IDEMPOTENCY_HEADER, UI_CONTRACT_VERSION, UI_V1_BASE, type UiLang } from "../contract/ui-v1/index.js";
import { uiError } from "./errors.js";
import { feedChunk } from "./feed.js";
import { langOf, t } from "./lang.js";
import { RepeatStore } from "./idempotency.js";
import type { UiCorePort } from "./port.js";
import { claimsSignedBy, createProvenance, type Provenance, type ProvenanceOptions } from "./provenance.js";
import { purchaseResponse } from "./purchase.js";
import { createShellHandler, type ShellHandler, type ShellOptions } from "./shell.js";

export { UI_CONTRACT_VERSION, UI_V1_BASE };
export * from "./boot-text.js";
export * from "./errors.js";
export * from "./feed.js";
export * from "./idempotency.js";
export * from "./lang.js";
export * from "./money.js";
export * from "./port.js";
export * from "./provenance.js";
export * from "./purchase.js";
export * from "./session.js";
export * from "./shell.js";

/** Политика безопасности страницы — только `'self'`, без исключений (П4 п. 3): скрипт и стили каркаса отдаются
 *  файлами, inline на странице нет. Раздача самого экрана — кирпич К3. */
export const UI_CSP =
  "default-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

/** Предел тела запроса: экран присылает карточку и провенанс, это килобайты. Больше — запрос не разбирается, и это
 *  400, а не молча прочитанный поток без конца. */
const BODY_LIMIT = 64 * 1024;

/** Покупка в адресе: безопасный опознаватель (`pur_…`). Всё, что не по форме, **не** отличается в ответе от чужой и
 *  неизвестной покупки — один `PURCHASE_NOT_FOUND` (§ 6). */
const PURCHASE_ID = /^[A-Za-z0-9_-]{1,64}$/;

export interface UiServerOptions {
  /** Порт к ядру: состояние покупки и сигналы потока (правило планов № 1). */
  readonly core: UiCorePort;
  /**
   * Кто спрашивает. Сессия приложения — cookie same-origin (§ 3 «Авторизация», кирпич К2а): обычно это
   * `(req) => sessions.ownerOf(req)` у `Sessions` (`session.ts`).
   *
   * Зависимость, а не умолчание: умолчание «хозяин неизвестен — покажем» открыло бы чужие покупки, и ни один тест этого
   * бы не заметил. `null` — действующей сессии нет: данных маршруты не отдают, ответ — единый `SESSION_REQUIRED` 401
   * на любой адрес (кирпич К7, Р-1665), и по нему не видно ни покупки, ни перечня методов.
   */
  readonly owner: (req: IncomingMessage) => string | null;
  /** Язык, если в запросе его нет. */
  readonly defaultLang?: UiLang;
  /** Допустимые значения заголовка `Host`: чужая страница через подмену DNS (DNS rebinding) ответа не получит.
   *  Пусто — проверки нет (так ставятся тесты на обработчик без сокета). */
  readonly hosts?: readonly string[];
  /** Память повторов (правило 2); не передана — своя. */
  readonly repeats?: RepeatStore;
  /**
   * Раздача каркаса экрана (кирпич К3): страница, `/ui.js`, `/ui.css`, бренд, `GET /ui/shell`.
   *
   * Не передана — обработчик отвечает только под `/ui/v1`, как в К2: сервер контракта и раздача экрана соединяются
   * **настройкой**, а не тем, что страница вшита в маршрутизатор. Так же проверяются тесты контракта — им страница
   * не нужна, и нечитаемой зависимости от каталога сборки у них нет.
   */
  readonly shell?: ShellOptions;
  /**
   * Признак «кто нажал» (П26, кирпич К5): вне режима прогона тестов сервер ставит `human`, в режиме признак
   * обязателен. Не передан — режима нет, то есть `human`.
   *
   * Настройкой, а не выводом по месту: признак уходит в журнал покупки и в акт, и решать его должен тот, кто поднял
   * стенд, а не маршрут.
   */
  readonly provenance?: ProvenanceOptions;
}

/** Готовый ответ маршрутизатора. */
interface Answer {
  readonly status: number;
  readonly type: string;
  readonly body: string;
}

const JSON_TYPE = "application/json; charset=utf-8";
const TEXT_TYPE = "text/plain; charset=utf-8";

const json = (status: number, body: unknown): Answer => ({ status, type: JSON_TYPE, body: JSON.stringify(body) });

/** Заголовки каждого ответа — одним местом: политика `'self'` без исключений (П4 п. 3), запрет угадывания типа,
 *  пустой `Referer`, без кэша. Один помощник на обработчик и на ответ 421 сервера: расхождение в наборе заголовков
 *  между двумя местами было находкой ревью К2 № 9. */
const HEADERS: Readonly<Record<string, string>> = {
  "content-security-policy": UI_CSP,
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "cache-control": "no-store",
};

/** Тело запроса целиком, с пределом. `null` — предел превышен. */
async function readBody(req: IncomingMessage): Promise<string | null> {
  let size = 0;
  const parts: Buffer[] = [];
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > BODY_LIMIT) return null;
    parts.push(buf);
  }
  return Buffer.concat(parts).toString("utf8");
}

/**
 * Обработчик `/ui/v1`. Возвращается функция для `node:http` — её же берут тесты, без сокета.
 *
 * Порядок проверок у POST (правило 2): тело → разбор → ключ повтора → маршрут. Ключ требуется **до** маршрута
 * сознательно: общий слой на то и общий, чтобы ни один будущий POST не смог появиться без ключа — защита не зависит от
 * того, вспомнил ли о ней автор метода.
 */
export function createUiHandler(o: UiServerOptions): (req: IncomingMessage, res: ServerResponse) => void {
  const fallback: UiLang = o.defaultLang ?? "ru";
  const repeats = o.repeats ?? new RepeatStore();
  const hosts: ReadonlySet<string> = new Set(o.hosts ?? []);
  // Собирается **при создании обработчика**: негодная настройка провенанса не должна доживать до запроса (К5).
  const signedBy: Provenance = createProvenance(o.provenance ?? { faults: false });
  // Признак уходит и в словарь каркаса: человек должен видеть, что подпись здесь делает не он (К6, П5 п. 3).
  const shell: ShellHandler | null = o.shell === undefined ? null : createShellHandler(o.shell, HEADERS, signedBy);

  const send = (res: ServerResponse, a: Answer, extra: Readonly<Record<string, string>> = {}): void => {
    if (res.writableEnded || res.headersSent) return;
    res.writeHead(a.status, { "content-type": a.type, ...HEADERS, ...extra });
    res.end(a.body);
  };

  /** Один ответ на чужую, неизвестную и не по форме покупку: по разнице ответов иначе стало бы видно, что покупка
   *  есть и принадлежит другому. Отсутствие сессии сюда **не** относится — у него свой код `SESSION_REQUIRED` 401
   *  (кирпич К7), и неразличимость там держится своим тождеством ответов, а не этим. */
  const notFound = (lang: UiLang): Answer => {
    const e = uiError("PURCHASE_NOT_FOUND", lang);
    return json(e.status, e.body);
  };

  /** Разбор одного запроса. Любое исключение здесь — ответ 500, а не падение процесса: сервер `/ui/v1` живёт в одном
   *  процессе с монитором, пультом и стендом (П4 п. 4), и необработанное отклонение завершило бы их все (находки ревью
   *  К2 № 1 и № 2 — `GET /ui/v1/purchase/%E0` и тело с `1e999`). */
  const route = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
      if (hosts.size > 0 && !hosts.has(req.headers.host ?? "")) {
        return send(res, { status: 421, type: TEXT_TYPE, body: t(fallback, "http.misdirected") });
      }
      let u: URL;
      try {
        u = new URL(req.url ?? "/", "http://127.0.0.1");
      } catch {
        return send(res, { status: 400, type: TEXT_TYPE, body: t(fallback, "http.bad_request") });
      }
      const lang = langOf(u.searchParams.get("lang"), fallback);
      if (!u.pathname.startsWith(`${UI_V1_BASE}/`)) {
        // Раздача каркаса (К3) — вне контракта: страница, код, стили и бренд это **наши** адреса, а `/ui/v1` —
        // граница К-Б. Поэтому раздача пробуется только тогда, когда адрес не под `/ui/v1`: ни один адрес контракта
        // не может быть перехвачен страницей, даже если в раздаче появится новый маршрут.
        if (shell !== null && shell(req, res, u, lang)) return;
        return send(res, { status: 404, type: TEXT_TYPE, body: t(lang, "http.not_found") });
      }
      const path = u.pathname.slice(UI_V1_BASE.length);
      const method = req.method ?? "GET";

      // Авторизация — **раньше всего остального** под `/ui/v1` (§ 3 «Авторизация»; находки ревью К2 № 4 и К2а № 4):
      // без сессии запрос не получает ни данных, ни разницы в ответах — ни 405 с перечнем методов, ни 404 на неизвестный
      // адрес, ни записи в память повторов. Иначе по разнице ответов было бы видно, какие методы зарегистрированы.
      //
      // Ответ — `SESSION_REQUIRED` 401 (кирпич К7, решение владельца **Р-1665**), один и тот же на любой адрес и на
      // любую причину: сессии не было, истекла, закрыта, пришли две пары cookie с одним именем. По нему **не видно**,
      // существует ли покупка, — проверка стоит до её поиска и до памяти повторов. Прежде здесь отдавался
      // `PURCHASE_NOT_FOUND`, и человеку на истёкшем входе называлась неверная причина, а пути войти заново у него не
      // было; `PURCHASE_NOT_FOUND` остался для чужой, неизвестной и не по форме покупки — **при своей действующей
      // сессии**.
      const owner = o.owner(req);
      if (owner === null) {
        const e = uiError("SESSION_REQUIRED", lang);
        return send(res, json(e.status, e.body));
      }

      // ── Правило 2: ключ повтора у каждого POST, до маршрутизации ──
      if (method === "POST") {
        const raw = await readBody(req);
        if (raw === null) return send(res, { status: 400, type: TEXT_TYPE, body: t(lang, "http.bad_request") });
        let check;
        try {
          const body: unknown = raw.length === 0 ? null : JSON.parse(raw);
          // Экран не говорит, кто нажал (К5, П26): тело с полем `by` — негодное тело, а не тело с лишним полем.
          // Проверка стоит **до** памяти повторов: отклонённое тело не должно запоминаться как ответ на ключ.
          if (claimsSignedBy(body)) return send(res, { status: 400, type: TEXT_TYPE, body: t(lang, "http.bad_request") });
          check = repeats.check(req.headers[IDEMPOTENCY_HEADER.toLowerCase()] as string | undefined, owner, {
            method,
            path,
            body,
          });
        } catch {
          // Сломанный JSON и значение, которого нет в JSON (`1e999` → `Infinity`, на нём канонизатор ядра бросает):
          // и то и другое — негодное тело, то есть 400 на разборе, а не исключение наружу.
          return send(res, { status: 400, type: TEXT_TYPE, body: t(lang, "http.bad_request") });
        }
        if (check.outcome === "missing") {
          const e = uiError("IDEMPOTENCY_REQUIRED", lang);
          return send(res, json(e.status, e.body));
        }
        if (check.outcome === "conflict") {
          const e = uiError("IDEMPOTENCY_CONFLICT", lang);
          return send(res, json(e.status, e.body));
        }
        if (check.outcome === "replay") {
          // Тот же ключ, тот же адрес и то же тело: прежний ответ **со своим типом содержимого**, второго действия нет.
          return send(res, { status: check.answer.status, type: check.answer.type, body: check.answer.body });
        }
        // Изменяющих методов в ИН-0 нет: любой POST под `/ui/v1` — неизвестный адрес. Ответ запоминается тем же ключом,
        // поэтому повтор экрана получит ровно его, а не новый разбор.
        const answer: Answer = { status: 404, type: TEXT_TYPE, body: t(lang, "http.not_found") };
        repeats.remember(check.key, owner, check.fingerprint, answer);
        return send(res, answer);
      }

      // ── § 5.3 `GET /ui/v1/purchase/{purchase_id}` ──
      const purchase = /^\/purchase\/([^/]+)$/.exec(path);
      if (purchase) {
        if (method !== "GET") return send(res, { status: 405, type: TEXT_TYPE, body: t(lang, "http.method_not_allowed") }, { allow: "GET" });
        // Раскодирование — в `try`: `%E0` это не UTF-8, и `decodeURIComponent` на нём бросает. Негодный опознаватель —
        // тот же единый `PURCHASE_NOT_FOUND` (§ 6: «не по форме» не отличается в ответе от чужой и неизвестной).
        let id: string;
        try {
          id = decodeURIComponent(purchase[1]!);
        } catch {
          return send(res, notFound(lang));
        }
        if (!PURCHASE_ID.test(id)) return send(res, notFound(lang));
        const got = await o.core.purchase(id, owner);
        if (got === null) return send(res, notFound(lang));
        return send(res, json(200, purchaseResponse(got, lang)));
      }

      // ── § 5.9 `GET /ui/v1/feed` (SSE) ──
      if (path === "/feed") {
        if (method !== "GET") return send(res, { status: 405, type: TEXT_TYPE, body: t(lang, "http.method_not_allowed") }, { allow: "GET" });
        res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", ...HEADERS, connection: "keep-alive" });
        // Пауза перед повторным подключением — у экрана; поток сам ничего не досылает (правило 4: он только сигнал).
        res.write("retry: 3000\n\n");
        // Подписка — на сигналы **этого** владельца: поток по всем покупкам выдавал бы чужие опознаватели.
        const off = o.core.subscribe(owner, (e) => {
          if (!res.writableEnded) res.write(feedChunk(e));
        });
        res.on("close", off);
        return;
      }

      return send(res, { status: 404, type: TEXT_TYPE, body: t(lang, "http.not_found") });
  };

  return (req, res) => {
    void route(req, res).catch((e: unknown) => {
      // Сбой разбора — ответ человеку и строка в журнал процесса; тело § 3 здесь не отдаётся: кода внутренней ошибки
      // ни у ядра, ни в § 6 контракта нет, и выдумывать его в коде нельзя (вопрос к К-Б v1.1, строка в STATUS).
      console.error("/ui/v1: сбой разбора запроса", e);
      send(res, { status: 500, type: TEXT_TYPE, body: t(fallback, "http.internal") });
    });
  };
}

/** Запущенный сервер `/ui/v1`. */
export interface UiServer {
  readonly server: Server;
  readonly port: number;
  readonly url: string;
  close(): Promise<void>;
}

/** Поднять сервер на `127.0.0.1` (П2 п. 2: только петля). Свой адрес добавляется в перечень `Host` — чужая страница
 *  через подмену DNS до маршрутов не доберётся. */
export async function startUiServer(o: UiServerOptions & { readonly port?: number }): Promise<UiServer> {
  const hosts = new Set(o.hosts ?? []);
  const handler = createUiHandler({ ...o, hosts: [] });
  // Перечень `Host` известен только после `listen`, поэтому проверка живёт здесь, а не в обработчике.
  const server = createServer((req, res) => {
    if (hosts.size > 0 && !hosts.has(req.headers.host ?? "")) {
      res.writeHead(421, { "content-type": "text/plain; charset=utf-8", ...HEADERS });
      res.end(t(o.defaultLang ?? "ru", "http.misdirected"));
      return;
    }
    handler(req, res);
  });
  await new Promise<void>((done) => server.listen(o.port ?? 0, "127.0.0.1", done));
  const port = (server.address() as AddressInfo).port;
  for (const h of [`127.0.0.1:${port}`, `localhost:${port}`]) hosts.add(h);
  return {
    server,
    port,
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((done, fail) => server.close((e) => (e ? fail(e) : done()))),
  };
}
