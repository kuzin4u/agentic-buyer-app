// Шина монитора операций (К1.3, П2). Источников три:
//  1) журнал обращений стенда stand.calls() — метод, путь, статус, код; тел нет (РП25 дополнение STAND-69);
//  2) журнал обращений агента к витринам эмулятора — та же форма, пишет сборка демо-стенда (src/demo/stand.ts);
//  3) события ПАО, которые получает агент из своей ленты (agent.events.listen), и журнал ядра агента для консоли.
// Каждая запись приводится к классу: поручение, проверка, реквизит, оплата, итог, отказ (или «прочее»).
//
// Инвариант 1: в ленту попадают только поля из перечней ниже. Путь показывается шаблоном маршрута, а не как есть: из пути
// берутся только mandate_id, op_ref, confirmation_id и id витрины. Ссылка реквизита (`/credentials/:ref`) не выводится.
// Инвариант 2: класс — подпись для человека, а не решение. Шина ничего не проверяет и не меняет: она только читает.
// Сумма — только из записи подтверждения стенда (П6, чтение), в минимальных единицах и с валютой.
import type { StandCall } from "agentic-ps-platform/stand";
import type { JournalEntry } from "agentic-buyer-ref/src/agent/journal/index.js";
import type { FeedItem } from "agentic-buyer-ref/src/agent/ports/events.js";
import { moneyView, type MoneyView } from "./money.js";

export const MONITOR_CLASSES = ["mandate", "check", "credential", "payment", "outcome", "decline", "other"] as const;
export type MonitorClass = (typeof MONITOR_CLASSES)[number];

/** Источник записи. «Агент» — только если keyid обращения — ключ нашего агента (isAgentKid): браузер человека и любой
 *  другой клиент тоже ходят по сети, и их обращения агенту не приписываются (ревью К1.3 № 5, повторное — находка 2).
 *  Подпись монитор не проверяет: её проверяет Платформа или витрина, отказ виден в ленте кодом. */
export type MonitorSource = "agent_platform" | "network_platform" | "stand" | "agent_merchant" | "network_merchant" | "pao_event";

/** Идентификаторы, которые разрешено показывать (инвариант 1). */
export interface MonitorIds {
  readonly mandate_id?: string;
  readonly op_ref?: string;
  readonly confirmation_id?: string;
  readonly shop_id?: string;
  readonly order_id?: string;
}

export interface MonitorEvent {
  readonly seq: number;
  readonly at: string;
  readonly source: MonitorSource;
  readonly cls: MonitorClass;
  /** Шаблон маршрута (`POST /pao/v1/mandates/{mandate_id}/verify`) или тип события ПАО (`operation.declined`). */
  readonly what: string;
  readonly status?: number;
  readonly code?: string;
  readonly amount?: MoneyView;
  readonly ids: MonitorIds;
}

/** Запись консоли агента: только поля журнала ядра из перечня; прочие поля записи отбрасываются. */
export interface ConsoleLine {
  readonly seq: number;
  readonly at: string;
  readonly kind: string;
  readonly reason?: string;
  readonly detail?: string;
  readonly ref?: string;
  readonly mandate?: string;
  readonly merchant?: string;
  readonly method?: string;
  readonly result?: string;
  readonly status?: string;
  readonly check?: string;
}

const CONSOLE_FIELDS = ["reason", "detail", "ref", "mandate", "merchant", "method", "result", "status", "check"] as const;

export type BusItem = { readonly stream: "monitor"; readonly event: MonitorEvent } | { readonly stream: "console"; readonly line: ConsoleLine };

/** Обращение без тела: форма журнала стенда, общая для ПАО и витрин. kid — только как признак подписи, в ленту не идёт. */
export type CallRecord = Pick<StandCall, "method" | "path" | "status" | "code" | "source" | "kid">;

/** Код отказа — только машинный код (`MANDATE_REVOKED`). Иное (текст продавца) не выводится (инварианты 1, 4). */
const CODE = /^[A-Z][A-Z0-9_]{0,63}$/;
const safeCode = (c: string | undefined) => (c !== undefined && CODE.test(c) ? { code: c } : {});

/** Сегмент пути как идентификатор: битый «%» — сегмент не выводится, шина не падает (ревью К1.3 № 2). */
function segment(v: string): string | undefined {
  try {
    return decodeURIComponent(v);
  } catch {
    return undefined;
  }
}

interface Route {
  readonly re: RegExp;
  readonly template: string;
  readonly cls: MonitorClass;
  /** Имена групп регулярного выражения, которые можно показать. Остальные сегменты пути не выводятся. */
  readonly ids?: readonly (keyof MonitorIds)[];
}

const SEG = "([^/]+)";
const r = (path: string, template: string, cls: MonitorClass, ids?: readonly (keyof MonitorIds)[]): Route => ({
  re: new RegExp(`^${path.replaceAll(":x", SEG)}$`),
  template,
  cls,
  ...(ids && { ids }),
});

// Порядок важен: более длинный путь раньше короткого.
const PAO_ROUTES: readonly Route[] = [
  r("/pao/v1/mandates/:x/verify", "/pao/v1/mandates/{mandate_id}/verify", "check", ["mandate_id"]),
  r("/pao/v1/mandates/:x/evidence", "/pao/v1/mandates/{mandate_id}/evidence", "mandate", ["mandate_id"]),
  r("/pao/v1/mandates/:x/relinquish", "/pao/v1/mandates/{mandate_id}/relinquish", "mandate", ["mandate_id"]),
  r("/pao/v1/mandates/:x", "/pao/v1/mandates/{mandate_id}", "mandate", ["mandate_id"]),
  r("/pao/v1/mandates", "/pao/v1/mandates", "mandate"),
  r("/pao/v1/agent", "/pao/v1/agent", "check"),
  r("/pao/v1/agent/keys/:x/revoke", "/pao/v1/agent/keys/{kid}/revoke", "other"),
  r("/pao/v1/agent/keys", "/pao/v1/agent/keys", "other"),
  r("/pao/v1/confirmations/:x", "/pao/v1/confirmations/{confirmation_id}", "check", ["confirmation_id"]),
  r("/pao/v1/confirmations", "/pao/v1/confirmations", "check"),
  r("/pao/v1/credentials/:x", "/pao/v1/credentials/{credential_ref}", "credential"),
  r("/pao/v1/credentials", "/pao/v1/credentials", "credential"),
  // Чтение операции — «проверка»: итог показывается только по событию ленты operation.* (инвариант 6, ревью К1.3 № 4).
  r("/pao/v1/operations/:x", "/pao/v1/operations/{op_ref}", "check", ["op_ref"]),
  r("/pao/v1/operations", "/pao/v1/operations", "check"),
  r("/pao/v1/merchants/:x/readiness", "/pao/v1/merchants/{merchant_id}/readiness", "check"),
  r("/pao/v1/events", "/pao/v1/events", "other"),
  r("/pao/v1/subscription", "/pao/v1/subscription", "other"),
  r("/participants/v1/notifications", "/participants/v1/notifications", "other"),
  r("/participants/v1/agents/:x/status", "/participants/v1/agents/{agent_code}/status", "check"),
  r("/participants/v1/merchants/:x/readiness", "/participants/v1/merchants/{merchant_id}/readiness", "check"),
  r("/adp/v1/decide", "/adp/v1/decide", "payment"),
  r("/adp/v1/events", "/adp/v1/events", "payment"),
  r("/participants/v1/mandates/:x/sign", "/participants/v1/mandates/{mandate_id}/sign", "mandate", ["mandate_id"]),
  r("/participants/v1/mandates/:x/revoke", "/participants/v1/mandates/{mandate_id}/revoke", "mandate", ["mandate_id"]),
  r("/participants/v1/principals/:x/revoke-all", "/participants/v1/principals/{principal_ref}/revoke-all", "mandate"),
  r("/participants/v1/principals/:x/limits", "/participants/v1/principals/{principal_ref}/limits", "mandate"),
  r("/participants/v1/confirmations/:x", "/participants/v1/confirmations/{confirmation_id}", "check", ["confirmation_id"]),
  r("/participants/v1/merchants/:x/payments/:x", "/participants/v1/merchants/{merchant_id}/payments/{credential_ref}", "payment"),
  r("/participants/v1/merchants/:x/payments", "/participants/v1/merchants/{merchant_id}/payments", "payment"),
];

const MERCHANT_ROUTES: readonly Route[] = [
  r("/v1/shops/:x/orders/:x/confirmation", "/v1/shops/{shop_id}/orders/{order_id}/confirmation", "check", ["shop_id", "order_id"]),
  r("/v1/shops/:x/orders/:x/payment", "/v1/shops/{shop_id}/orders/{order_id}/payment", "payment", ["shop_id", "order_id"]),
  r("/v1/shops/:x/orders/:x", "/v1/shops/{shop_id}/orders/{order_id}", "payment", ["shop_id", "order_id"]),
  r("/v1/shops/:x/orders", "/v1/shops/{shop_id}/orders", "payment", ["shop_id"]),
  r("/v1/shops/:x/catalog", "/v1/shops/{shop_id}/catalog", "other", ["shop_id"]),
  r("/v1/shops", "/v1/shops", "other"),
];

/** Опрос ленты событий и подписка — служебные обращения, в ленте монитора их нет (иначе шум каждые полсекунды). */
const NOISE = new Set(["GET /pao/v1/events", "PUT /pao/v1/subscription", "GET /participants/v1/notifications"]);

/** Ответ 4xx с этим кодом — не отказ, а передача решения человеку (инвариант 3): класс «проверка». */
const TO_HUMAN = new Set(["CONFIRMATION_REQUIRED"]);

export type Classified = Pick<MonitorEvent, "cls" | "what" | "ids" | "status" | "code">;

/** Обращение → класс, шаблон и идентификаторы. Неизвестный путь — «прочее» без пути (только метод): лишнее не выводится. */
export function classifyCall(c: CallRecord, routes: "pao" | "merchants"): Classified | null {
  const table = routes === "pao" ? PAO_ROUTES : MERCHANT_ROUTES;
  for (const route of table) {
    const m = route.re.exec(c.path);
    if (!m) continue;
    const what = `${c.method} ${route.template}`;
    if (NOISE.has(what)) return null;
    const ids: Record<string, string> = {};
    // Номера групп совпадают с порядком :x в пути, а имена ids — с порядком выводимых сегментов в шаблоне.
    const names = [...route.template.matchAll(/\{([a-z_]+)\}/g)].map((x) => x[1]!);
    names.forEach((name, i) => {
      const v = m[i + 1];
      if (v === undefined || !(route.ids as readonly string[] | undefined)?.includes(name)) return;
      const s = segment(v);
      if (s !== undefined) ids[name] = s;
    });
    let cls = route.cls;
    if (c.status >= 400) cls = c.code !== undefined && TO_HUMAN.has(c.code) ? "check" : "decline";
    return { cls, what, ids, status: c.status, ...safeCode(c.code) };
  }
  return { cls: c.status >= 400 ? "decline" : "other", what: `${c.method} (${routes})`, ids: {}, status: c.status, ...safeCode(c.code) };
}

const EVENT_CLASS: Readonly<Record<string, MonitorClass>> = {
  "mandate.signed": "mandate",
  "mandate.rejected": "decline",
  "mandate.revoked": "mandate",
  "mandate.exhausted": "mandate",
  "confirmation.required": "check",
  "confirmation.approved": "check",
  "confirmation.rejected": "decline",
  "confirmation.expired": "decline",
  "operation.authorized": "outcome",
  "operation.declined": "decline",
  "operation.settled": "outcome",
  "operation.refunded": "outcome",
};

/** Событие ленты ПАО → класс; поля — только из события ядра (исходное тело Платформы в ядро не передаётся). */
export function classifyFeedItem(item: FeedItem): Classified & { at?: string } {
  if (item.kind !== "event") return { cls: "other", what: item.kind === "ignored" && "type" in item ? item.type : "event.ignored", ids: {} };
  const e = item.event;
  const ids: Record<string, string> = {};
  if (e.mandateId) ids.mandate_id = e.mandateId;
  if (e.opRef) ids.op_ref = e.opRef;
  if (e.confirmationId) ids.confirmation_id = e.confirmationId;
  return { cls: EVENT_CLASS[e.type] ?? "other", what: e.type, ids, at: e.at, ...safeCode(e.declineReason ?? undefined) };
}

export function consoleLine(seq: number, e: JournalEntry): ConsoleLine {
  const out: Record<string, unknown> = { seq, at: e.at, kind: e.kind };
  const src = e as unknown as Record<string, unknown>;
  for (const f of CONSOLE_FIELDS) {
    const v = src[f];
    if (typeof v === "string" || typeof v === "number") out[f] = String(v);
  }
  return out as unknown as ConsoleLine;
}

/** Записи журнала агента, которые консоли не нужны: подпись каждого запроса — шум. */
const CONSOLE_NOISE = new Set(["request.signed"]);

export interface BusSources {
  calls(): readonly CallRecord[];
  merchantCalls(): readonly CallRecord[];
  journal(): readonly JournalEntry[];
  /** Подписка на ленту ПАО агента; вернуть — отписка. */
  listenFeed(l: (item: FeedItem) => void): () => void;
  /** keyid принадлежит нашему агенту. */
  isAgentKid(kid: string): boolean;
  /** Запись подтверждения стенда только для чтения — источник суммы. */
  confirmation(id: string): Promise<{ amount: number; currency: string; order_ref: string } | undefined>;
  now(): Date;
}

export class MonitorBus {
  readonly #src: BusSources;
  /** История — по потокам отдельно: шумная консоль не вытесняет события монитора (ревью К1.3 № 13). */
  readonly #history: Record<BusItem["stream"], BusItem[]> = { monitor: [], console: [] };
  readonly #subs = new Set<(i: BusItem) => void>();
  readonly #limit: number;
  #seq = 0;
  #calls = 0;
  #merchantCalls = 0;
  #journal = 0;
  #timer: NodeJS.Timeout | undefined;
  #offFeed: (() => void) | undefined;

  constructor(src: BusSources, opts: { historyLimit?: number } = {}) {
    this.#src = src;
    this.#limit = opts.historyLimit ?? 1000;
  }

  /** Опрос журналов по индексу и подписка на ленту ПАО. */
  start(intervalMs = 200): void {
    this.#offFeed = this.#src.listenFeed((item) => void this.#onFeed(item));
    this.poll();
    this.#timer = setInterval(() => this.poll(), intervalMs);
    this.#timer.unref();
  }

  stop(): void {
    if (this.#timer) clearInterval(this.#timer);
    this.#offFeed?.();
  }

  /** Прочитать новые записи журналов (по индексу). Открыт для тестов: не ждать таймера. */
  poll(): void {
    const calls = this.#src.calls();
    for (; this.#calls < calls.length; this.#calls++) {
      const c = calls[this.#calls]!;
      const k = classifyCall(c, "pao");
      if (k) this.#monitor({ ...k, source: c.source !== "network" ? "stand" : this.#byAgent(c) ? "agent_platform" : "network_platform" });
    }
    const mc = this.#src.merchantCalls();
    for (; this.#merchantCalls < mc.length; this.#merchantCalls++) {
      const c = mc[this.#merchantCalls]!;
      const k = classifyCall(c, "merchants");
      if (k) this.#monitor({ ...k, source: this.#byAgent(c) ? "agent_merchant" : "network_merchant" });
    }
    const j = this.#src.journal();
    for (; this.#journal < j.length; this.#journal++) {
      const e = j[this.#journal]!;
      if (!CONSOLE_NOISE.has(e.kind)) this.#push({ stream: "console", line: consoleLine(++this.#seq, e) });
    }
  }

  #byAgent(c: CallRecord): boolean {
    return c.kid !== undefined && this.#src.isAgentKid(c.kid);
  }

  /** Ошибка разбора события или суммы не роняет процесс: событие показывается без суммы (ревью К1.3 № 3). */
  async #onFeed(item: FeedItem): Promise<void> {
    let k: ReturnType<typeof classifyFeedItem>;
    try {
      k = classifyFeedItem(item);
    } catch {
      return;
    }
    const { at, ...rest } = k;
    let amount: MoneyView | undefined;
    let ids = rest.ids;
    if (rest.ids.confirmation_id) {
      try {
        const rec = await this.#src.confirmation(rest.ids.confirmation_id);
        if (rec) {
          // Из записи П6 — только сумма, валюта и номер заказа; остальные поля записи не читаются.
          ids = { ...ids, order_id: rec.order_ref };
          amount = moneyView({ minor: rec.amount, currency: rec.currency });
        }
      } catch {
        amount = undefined;
      }
    }
    this.#monitor({ ...rest, ids, source: "pao_event", ...(amount && { amount }) }, at);
  }

  #monitor(k: Omit<MonitorEvent, "seq" | "at">, at?: string): void {
    this.#push({ stream: "monitor", event: { seq: ++this.#seq, at: at ?? this.#src.now().toISOString(), ...k } });
  }

  #push(i: BusItem): void {
    const h = this.#history[i.stream];
    h.push(i);
    if (h.length > this.#limit) h.shift();
    for (const s of this.#subs) s(i);
  }

  /** История обоих потоков по порядку seq. */
  history(): readonly BusItem[] {
    const seq = (i: BusItem) => (i.stream === "monitor" ? i.event.seq : i.line.seq);
    return [...this.#history.monitor, ...this.#history.console].sort((a, b) => seq(a) - seq(b));
  }

  subscribe(fn: (i: BusItem) => void): () => void {
    this.#subs.add(fn);
    return () => this.#subs.delete(fn);
  }
}
