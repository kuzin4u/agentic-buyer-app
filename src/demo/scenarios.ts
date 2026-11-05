// Сюжеты демо-стенда (К2.1, П2 п. 5). Ведёт их настоящее ядро агента (createAgentCore → purchase): приложение только
// вызывает стадии конвейера и сообщает шаги в консоль. Решений за ядро и человека здесь нет:
//  - подпись INTENT и CART — человек на экране мандатов банка стенда (ссылка входа /bank-login); сюжет ждёт события;
//  - выбор товара на стадии 3 в продукте делает человек; в демо — правило, и консоль его называет: категория = предмет
//    поручения, без сигналов A5, самая низкая цена. Пределы мандата приложение не проверяет (инвариант 2) — это делают
//    ядро и Платформа, отказ виден в ленте кодом;
//  - итог — только по событию operation.* (authorize ядра ждёт события, инвариант 6), не по ответу продавца.
import { MERCHANT_FIXTURES } from "agentic-ps-platform/fixtures";
import type { Purchase } from "agentic-buyer-ref/src/agent/pipeline/index.js";
import type { MandateDraft, Money, Operation } from "agentic-buyer-ref/src/shared/domain.js";
import type { DemoStand } from "./stand.js";

/** Шаг сюжета для консоли: код и параметры. Текст — на странице по словарю (step.<код>). */
export interface ScenarioStep {
  readonly step: string;
  readonly params: Readonly<Record<string, string | number | Money>>;
}

export type StepSink = (s: ScenarioStep) => void;

export type ScenarioName = "intent" | "purchase";

export type ScenarioStart = { ok: true } | { ok: false; code: "BUSY" | "NEED_INTENT" };

const OPS_KEPT = 50;
const CLOSE_WAIT_MS = 3000;

/** Клиент банка стенда, от имени которого агент действует. Идентификатор клиента, не реквизит. */
export const DEMO_PRINCIPAL = "pr_demo";

/** Карточка ключевых условий поручения (Т3а): её видит человек на странице монитора до нажатия кнопки сюжета 1, поэтому
 *  запрос мандата несёт keyTermsShown: true по факту показа (ревью К2.1 № 1). Предмет — категория товаров витрин стенда
 *  (данные мандата, а не строка интерфейса). */
export interface IntentCard {
  readonly subject: string;
  readonly limit: Money;
  readonly validDays: number;
  readonly merchants: number;
}

/** Условия поручения сюжета 1 (Р-1235: «хлеб на выходные, до 1 000 ₽, один раз»): разовое, на всех продавцов стенда. */
export const INTENT_CARD: IntentCard = {
  subject: "хлеб",
  limit: { amount: 100000, currency: "RUB" },
  validDays: 7,
  merchants: MERCHANT_FIXTURES.length,
};

export function demoIntent(now: Date, card: IntentCard = INTENT_CARD): MandateDraft {
  return {
    kind: "INTENT",
    parentId: null,
    subject: card.subject,
    amountLimit: card.limit,
    validTo: new Date(now.getTime() + card.validDays * 86_400_000).toISOString(),
    merchantScope: MERCHANT_FIXTURES.map((f) => f.merchant_id),
    principalRef: DEMO_PRINCIPAL,
    confirmationMode: "IMMEDIATE",
    keyTermsShown: true,
    cart: null,
  };
}

/** Регион человека — общий регион доставки полных витрин стенда (из фикстур, не литералом). */
function standRegion(): string | undefined {
  const full = MERCHANT_FIXTURES.filter((f) => f.returns !== undefined);
  return full[0]?.delivery_regions.find((r) => full.every((f) => f.delivery_regions.includes(r)));
}

export class DemoScenarios {
  readonly #d: DemoStand;
  readonly #emit: StepSink;
  readonly #ac = new AbortController();
  readonly #ops = new Map<string, Operation>();
  readonly #opWaiters = new Map<string, ((m: Money | undefined) => void)[]>();
  #purchase: Purchase | null = null;
  #intentActive = false;
  #running: Promise<void> | null = null;
  #seq = 0;

  constructor(d: DemoStand, emit: StepSink) {
    this.#d = d;
    this.#emit = emit;
  }

  /** Сумма операции, как её вернуло ядро (GET операции после события) — для строки итога в мониторе. */
  operationAmount(opRef: string, waitMs = 3000): Promise<Money | undefined> {
    const known = this.#ops.get(opRef);
    if (known) return Promise.resolve(known.amount ?? undefined);
    return new Promise((ok) => {
      // По ответу — таймер снимается; по сроку — ожидающий удаляется из списка (ревью К2.1 № 4).
      const waiter = (m: Money | undefined) => {
        clearTimeout(timer);
        ok(m);
      };
      const timer = setTimeout(() => {
        const rest = (this.#opWaiters.get(opRef) ?? []).filter((w) => w !== waiter);
        if (rest.length > 0) this.#opWaiters.set(opRef, rest);
        else this.#opWaiters.delete(opRef);
        ok(undefined);
      }, waitMs);
      timer.unref();
      const list = this.#opWaiters.get(opRef) ?? [];
      list.push(waiter);
      this.#opWaiters.set(opRef, list);
    });
  }

  #remember(op: Operation): void {
    this.#ops.set(op.opRef, op);
    // Сумма нужна только строке события этой операции: храним последние, а не все.
    while (this.#ops.size > OPS_KEPT) this.#ops.delete(this.#ops.keys().next().value!);
    for (const w of this.#opWaiters.get(op.opRef) ?? []) w(op.amount ?? undefined);
    this.#opWaiters.delete(op.opRef);
  }

  get busy(): boolean {
    return this.#running !== null;
  }

  /** Запустить сюжет; ход — в консоль шагами. Возвращает сразу: подпись человека может занять минуты. */
  start(name: ScenarioName): ScenarioStart {
    if (this.#running) return { ok: false, code: "BUSY" };
    if (name === "purchase" && (!this.#purchase || !this.#intentActive)) return { ok: false, code: "NEED_INTENT" };
    const run = name === "intent" ? this.#intent() : this.#buy();
    this.#running = run
      .catch((e: unknown) => this.#fail(e))
      .finally(() => {
        this.#running = null;
      });
    return { ok: true };
  }

  /** Дождаться текущего сюжета (для тестов). */
  async settled(): Promise<void> {
    await this.#running;
  }

  /** Отменить сюжет и дождаться его конца — до закрытия стенда, чтобы сюжет не обращался к закрытому (ревью К2.1 № 7). */
  async close(): Promise<void> {
    this.#ac.abort();
    // Ожидание ленты ядро прерывает на следующем чтении; не дольше CLOSE_WAIT_MS, чтобы остановка не зависла.
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([this.#running, new Promise<void>((ok) => (timer = setTimeout(ok, CLOSE_WAIT_MS)))]);
    clearTimeout(timer);
  }

  #step(step: string, params: ScenarioStep["params"] = {}): void {
    this.#emit({ step, params });
  }

  #key(what: string): { idempotencyKey: string } {
    return { idempotencyKey: `demo-${what}-${Date.now()}-${++this.#seq}` };
  }

  #fail(e: unknown): void {
    if (this.#ac.signal.aborted) return;
    const reason = this.#purchase?.reason;
    const code = reason ?? (e as { code?: unknown } | null)?.code;
    const state = this.#purchase?.state;
    this.#step("failed", { code: typeof code === "string" ? code : "UNKNOWN", ...(state !== undefined && { state }) });
  }

  async #intent(): Promise<void> {
    const core = this.#d.agent;
    const shops = core.shops({ baseUrl: this.#d.urls.merchants });
    const region = standRegion();
    const p = core.purchase({
      offers: shops,
      live: shops,
      shop: shops,
      payment: core.payment(shops),
      ...(region !== undefined && { region }),
      // Ссылку страницы УПК (NoticeLink) в консоль не пишем — только код (ядро: «только оболочке»); сюжет 4 — К2.2.
      notify: (code, detail) => this.#step("notice", { code, ...(detail && "amount" in detail ? { amount: detail } : {}) }),
    });
    this.#purchase = p;
    this.#intentActive = false;
    const draft = demoIntent(new Date());
    const intent = await p.intent(draft, this.#key("intent"));
    this.#step("intent.created", { mandate_id: intent.id, subject: draft.subject, limit: draft.amountLimit });
    this.#step("intent.awaiting_signature", { mandate_id: intent.id });
    const signed = await p.awaitIntent(this.#ac.signal);
    this.#intentActive = signed.status === "ACTIVE";
    this.#step("intent.signed", { mandate_id: signed.id, status: signed.status });
  }

  async #buy(): Promise<void> {
    const p = this.#purchase!;
    // Поручение использовано этой покупкой: следующая покупка — через новый сюжет 1 (поручение разовое).
    this.#intentActive = false;
    const zones = await p.search();
    this.#step("search.found", { contour: zones.contour.length, market: zones.market.length, unavailable: zones.unavailable.length });
    for (const o of zones.contour.filter((x) => x.a5.length > 0)) {
      this.#step("search.flagged", { merchant_id: o.merchantId, sku: o.sku, codes: o.a5.join(",") });
    }
    const subject = p.intentMandate?.subject;
    const candidates = zones.contour.filter((o) => o.product.category === subject && o.a5.length === 0);
    this.#step("search.compared", { candidates: candidates.length, ...(subject !== undefined && { subject }) });
    const pick = [...candidates].sort((a, b) => a.product.price.amount - b.product.price.amount)[0];
    if (!pick) {
      this.#step("failed", { code: "NO_CANDIDATE", state: p.state });
      return;
    }
    this.#step("search.picked", { merchant_id: pick.merchantId, sku: pick.sku, title: pick.product.title, price: pick.product.price });
    const cart = await p.cart({ merchantId: pick.merchantId, lines: [{ sku: pick.sku, qty: 1 }], keyTermsShown: true }, this.#key("cart"));
    this.#step("cart.created", { mandate_id: cart.id, ...(cart.cart ? { total: cart.cart.total } : {}) });
    this.#step("cart.awaiting_signature", { mandate_id: cart.id });
    const signed = await p.awaitCart(this.#ac.signal);
    this.#step("cart.signed", { mandate_id: signed.id, status: signed.status });
    const order = await p.placeOrder(this.#key("order"));
    this.#step("order.placed", { order_id: order.orderId, merchant_id: pick.merchantId, total: order.total });
    this.#step("payment.started", { order_id: order.orderId });
    const op = await p.authorize(this.#key("pay"), this.#ac.signal);
    this.#remember(op);
    this.#step("outcome", {
      op_ref: op.opRef,
      status: op.status,
      ...(op.amount ? { amount: op.amount } : {}),
      ...(op.declineReason ? { code: op.declineReason } : {}),
      state: p.state,
    });
  }
}
