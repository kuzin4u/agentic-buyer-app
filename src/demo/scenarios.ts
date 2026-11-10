// Сюжеты демо-стенда (К2.1, П2 п. 5). Ведёт их настоящее ядро агента (createAgentCore → purchase): приложение только
// вызывает стадии конвейера и сообщает шаги в консоль. Решений за ядро и человека здесь нет:
//  - подпись INTENT и CART — человек на экране мандатов банка стенда (ссылка входа /bank-login); сюжет ждёт события;
//  - выбор товара на стадии 3 в продукте делает человек; в демо — правило, и консоль его называет: категория = предмет
//    поручения, без сигналов A5, самая низкая цена. Пределы мандата приложение не проверяет (инвариант 2) — это делают
//    ядро и Платформа, отказ виден в ленте кодом;
//  - итог — только по событию operation.* (authorize ядра ждёт события, инвариант 6), не по ответу продавца.
import { MERCHANT_FIXTURES } from "agentic-ps-platform/fixtures";
import type { Purchase } from "agentic-buyer-ref/src/agent/pipeline/index.js";
import { cartTotal } from "agentic-buyer-ref/src/agent/policy/index.js";
import type { Mandate, MandateDraft, Money, Operation } from "agentic-buyer-ref/src/shared/domain.js";
import { ISO4217_MINOR_UNITS } from "./money.js";
import { PLATFORM_VERSION } from "./platform.js";
import type { MoreScenario } from "./server.js";
import { MASSA_MADRE } from "./shops.js";
import type { DemoStand } from "./stand.js";

/** Шаг сюжета для консоли: код и параметры. Текст — на странице по словарю (step.<код>). */
export interface ScenarioStep {
  readonly step: string;
  readonly params: Readonly<Record<string, string | number | Money>>;
}

export type StepSink = (s: ScenarioStep) => void;

/** intent — сюжет 1; purchase — сюжет 2; limit — сюжет 3 «отказ: превышен лимит клиента в банке»; upk — сюжет 4
 *  «подтверждение человеком через УПК» (своё поручение); revoke — сюжет 5. Сюжеты 6–10 — правильные тесты задания на
 *  тестирование пульта (П-11.1, Р-1457): reject — 6 «клиент отказался от корзины» (П-03); unconfirmed — 7 «клиент не
 *  подтвердил покупку» (П-04); scope — 8 «продавец вне поручения» (П-06). */
export type ScenarioName = "intent" | "purchase" | "limit" | "upk" | "revoke" | "reject" | "unconfirmed" | "scope";

/** Метка начала прогона сюжета — шаг `run.<имя>` (К2.3а). Литералами — чтобы словари сверялись с шагами по тексту. */
export const RUN_STEP: Readonly<Record<ScenarioName, string>> = {
  intent: "run.intent",
  purchase: "run.purchase",
  limit: "run.limit",
  upk: "run.upk",
  revoke: "run.revoke",
  reject: "run.reject",
  unconfirmed: "run.unconfirmed",
  scope: "run.scope",
};

/** Сюжеты, которым нужно действующее поручение сюжета 1. */
const NEEDS_INTENT: ReadonlySet<ScenarioName> = new Set(["purchase", "limit", "revoke", "reject"]);

export type ScenarioStart = { ok: true } | { ok: false; code: "BUSY" | "NEED_INTENT" | "NOT_AWAITING" | "PAYING" };

const OPS_KEPT = 50;
/** Валюта рыночного порога подтверждения Платформы: параметр confirm_above_kop — в копейках рубля (ISO 4217). */
const THRESHOLD_CURRENCY = "RUB";

/** Что монитору нужно об операции: сумма, причина отказа и номер заказа, как их вернула Платформа ядру. Номер заказа —
 *  связка «операция → заказ» для модели транзакций пульта (П-1.2, Р-1442): идентификатор, не реквизит (инвариант 1). */
export interface OperationInfo {
  readonly amount?: Money;
  readonly declineReason?: string;
  readonly orderRef?: string;
}

const infoOf = (op: Operation): OperationInfo => ({
  ...(op.amount && { amount: op.amount }),
  ...(op.declineReason && { declineReason: op.declineReason }),
  ...(op.orderRef && { orderRef: op.orderRef }),
});
const CLOSE_WAIT_MS = 3000;
/** Сколько сюжет ждёт события «корзина отклонена», если ядро остановилось раньше него (сюжет 6). */
const REJECT_WAIT_MS = 3000;

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
  /** Продавцы поручения (merchant_id); нет — все продавцы стенда. */
  readonly scope?: readonly string[];
  /** Подписи продавцов поручения для карточки — имя витрины и merchant_id (данные стенда). */
  readonly scopeLabels?: readonly string[];
}

/** Условия поручения сюжета 1 (Р-1235: «хлеб на выходные, до 1 000 ₽, один раз»): разовое, на всех продавцов стенда. */
export const INTENT_CARD: IntentCard = {
  subject: "хлеб",
  limit: { amount: 100000, currency: "RUB" },
  validDays: 7,
  merchants: MERCHANT_FIXTURES.length,
};

/** Поручение сюжета 4 (Р-1255 п. 2): своё, до 5 000 ₽ — выше порога подтверждения банка; карточка — у кнопки 4. */
export const INTENT_CARD_UPK: IntentCard = { ...INTENT_CARD, limit: { amount: 500000, currency: "RUB" } };

/** Поручение сюжета 8 (П-06): только один продавец — «Масса Мадре» (merchant_id — из набора витрин стенда, не литералом).
 *  Демо-правило выбора (самый дешёвый хлеб в контуре без A5) выбирает товар другого продавца — вне поручения. */
const SCOPE_SHOPS = [MASSA_MADRE];
export const INTENT_CARD_SCOPE: IntentCard = {
  ...INTENT_CARD,
  merchants: SCOPE_SHOPS.length,
  scope: SCOPE_SHOPS.map((s) => s.merchant_id),
  scopeLabels: SCOPE_SHOPS.map((s) => `${s.name} (${s.merchant_id})`),
};

/** Сюжеты 6–10 на мониторе — по порядку кнопок (П-11.1); карточка — у сюжета со своим поручением (видна до кнопки).
 *  Сюжет 7 — то же поручение, что у сюжета 4: выше порога подтверждения банка. */
export const MORE_SCENARIOS: readonly MoreScenario[] = [
  { name: "reject" },
  { name: "unconfirmed", card: INTENT_CARD_UPK },
  { name: "scope", card: INTENT_CARD_SCOPE },
];

export function demoIntent(now: Date, card: IntentCard = INTENT_CARD): MandateDraft {
  return {
    kind: "INTENT",
    parentId: null,
    subject: card.subject,
    amountLimit: card.limit,
    validTo: new Date(now.getTime() + card.validDays * 86_400_000).toISOString(),
    merchantScope: card.scope ? [...card.scope] : MERCHANT_FIXTURES.map((f) => f.merchant_id),
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
  readonly #opWaiters = new Map<string, ((m: OperationInfo | undefined) => void)[]>();
  #purchase: Purchase | null = null;
  #intentActive = false;
  #running: Promise<void> | null = null;
  #consentWaiter: ((agree: boolean) => void) | null = null;
  /** Отмена текущего сюжета (кнопка «прервать»); сигнал сюжета — общий и свой вместе. */
  #runAc: AbortController | null = null;
  #signal: AbortSignal = this.#ac.signal;
  /** Сюжет на стадии оплаты: прерывание не принимается (итог — по событию). */
  #paying = false;
  /** Версия лимитов клиента в банке стенда (ПИ-8): каждая запись — следующая. */
  #limitsVersion = 0;
  /** Длина журнала ядра в начале оплаты этой покупки: запись об отказе ищется только после неё (ревью К2.2б, Н1). */
  #payJournalFrom = -1;
  /** Заказ текущего сюжета — для связи шагов отказа с панелью витрины. */
  #orderId: string | null = null;
  #seq = 0;

  constructor(d: DemoStand, emit: StepSink) {
    this.#d = d;
    this.#emit = emit;
  }

  /** Сумма и причина отказа операции, как их вернуло ядро (GET операции после события), — для строки события в мониторе:
   *  событие operation.* само причины не несёт. */
  operationInfo(opRef: string, waitMs = 3000): Promise<OperationInfo | undefined> {
    const known = this.#ops.get(opRef);
    if (known) return Promise.resolve(infoOf(known));
    return new Promise((ok) => {
      // По ответу — таймер снимается; по сроку — ожидающий удаляется из списка (ревью К2.1 № 4).
      const waiter = (m: OperationInfo | undefined) => {
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
    for (const w of this.#opWaiters.get(op.opRef) ?? []) w(infoOf(op));
    this.#opWaiters.delete(op.opRef);
  }

  get busy(): boolean {
    return this.#running !== null;
  }

  /** Ответ человека на карточку корзины с демо-экрана. Не ждём карточки — NOT_AWAITING. */
  answerCart(agree: boolean): ScenarioStart {
    const w = this.#consentWaiter;
    if (!w) return { ok: false, code: "NOT_AWAITING" };
    this.#consentWaiter = null;
    w(agree);
    return { ok: true };
  }

  /** Ожидание ответа человека на карточку корзины; отмена сюжета (кнопка «прервать» или close) — отказ. */
  #consent(): Promise<boolean> {
    const signal = this.#signal;
    return new Promise((ok, fail) => {
      if (signal.aborted) return fail(new Error("сюжет отменён"));
      const onAbort = () => {
        // После отмены ответ человека — NOT_AWAITING, а не «принято» (ревью К2.1а № 3).
        this.#consentWaiter = null;
        fail(new Error("сюжет отменён"));
      };
      signal.addEventListener("abort", onAbort, { once: true });
      this.#consentWaiter = (v) => {
        signal.removeEventListener("abort", onAbort);
        ok(v);
      };
    });
  }

  /** Запустить сюжет; ход — в консоль шагами. Возвращает сразу: подпись человека может занять минуты. */
  start(name: ScenarioName): ScenarioStart {
    if (this.#running) return { ok: false, code: "BUSY" };
    if (NEEDS_INTENT.has(name) && (!this.#purchase || !this.#intentActive)) return { ok: false, code: "NEED_INTENT" };
    // У каждого сюжета — свой сигнал отмены (кнопка «прервать»), вместе с общим (close).
    const run = new AbortController();
    this.#runAc = run;
    this.#signal = AbortSignal.any([this.#ac.signal, run.signal]);
    this.#paying = false;
    this.#payJournalFrom = -1;
    this.#orderId = null;
    // Метка начала прогона — первым шагом (К2.3а, Р-1391): по ней экран «Контроль» режет ленту на прогоны и знает, какой
    // это сюжет. Угадывать сюжет по шагам нельзя: 1 и 4, 2 и 3 начинаются одинаково.
    this.#step(RUN_STEP[name]);
    const work =
      name === "intent"
        ? this.#intent()
        : name === "limit"
          ? this.#overLimit()
          : name === "upk" || name === "unconfirmed"
            ? this.#upk(name === "unconfirmed")
            : name === "revoke"
              ? this.#revoke()
              : name === "reject"
                ? this.#buy({ expectReject: true })
                : name === "scope"
                  ? this.#outOfScope()
                  : this.#buy();
    this.#running = work
      .catch((e: unknown) => this.#fail(e))
      .finally(() => {
        this.#running = null;
        this.#runAc = null;
        this.#paying = false;
      });
    return { ok: true };
  }

  /** Прервать текущий сюжет (ревью К2.1 № 6): снимается ожидание подписи поручения или корзины и карточки; ядро прерывает
   *  ожидание ленты на следующем чтении. До запроса корзины поручение не использовано; после — нужен новый сюжет 1.
   *  На оплате — PAYING: пакет передан продавцу, итог придёт по событию Платформы, оплату на полпути не рвём. */
  abort(): ScenarioStart {
    if (!this.#runAc || this.#runAc.signal.aborted) return { ok: false, code: "NOT_AWAITING" };
    // Ожидание подтверждения человека (сюжет 4) прерывать можно: ядро снимает его с CONFIRMATION_ABORTED, запрос в банке
    // остаётся (Р69 п. 3).
    // Состояние — у ядра: только пока оно ждёт решения человека (CONFIRMING); после решения — PAYING (ревью К2.2в № 2).
    if (this.#paying && this.#purchase?.state !== "CONFIRMING") return { ok: false, code: "PAYING" };
    this.#runAc.abort();
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
    // Операция отказа известна ядру (GET после operation.declined) — её сумма нужна строке события в мониторе.
    const op = this.#purchase?.operation;
    if (op) this.#remember(op);
    const opRef = op ? op.opRef : this.#rememberDecline();
    // Прервано человеком — только если у покупки нет своей причины остановки: отказ Платформы или ядра не подменяется
    // словом «прервано» (ревью К2.2а № 1).
    if (this.#signal.aborted && !reason) {
      const state = this.#purchase?.state;
      this.#step("aborted", { ...(state !== undefined && { state }) });
      return;
    }
    const order: Record<string, string> = this.#orderId ? { order_id: this.#orderId } : {};
    if (reason === "CONFIRMATION_ABORTED") {
      // Прервано человеком во время ожидания подтверждения: запрос в банке остаётся открытым до срока (Р69 п. 3; ревью
      // К2.2в № 3).
      this.#step("upk.aborted", { code: reason, ...order });
      return;
    }
    const code = reason ?? (e as { code?: unknown } | null)?.code;
    const state = this.#purchase?.state;
    // op_ref и mandate_id корзины — связки «операция → заказ → корзина» для модели транзакций пульта (П-1.2, Р-1444), если
    // покупка дошла до корзины и операции.
    const cartId = this.#purchase?.cartMandate?.id;
    this.#step("failed", {
      code: typeof code === "string" ? code : "UNKNOWN",
      ...(state !== undefined && { state }),
      ...order,
      ...(opRef && { op_ref: opRef }),
      ...(cartId !== undefined && { mandate_id: cartId }),
    });
  }

  /** Сюжет 4 (Р-1255 п. 2): своё поручение до 5 000 ₽ (карточка у кнопки 4), подпись человеком; затем покупка с суммой
   *  выше порога подтверждения банка. ADP отвечает CONFIRMATION_REQUIRED — ядро ждёт решения человека (инвариант 3):
   *  на мониторе — ссылка на страницу УПК и панель «эмулятор SMS банка» с кодом; код вводит человек на странице УПК. */
  async #upk(expectDecline = false): Promise<void> {
    await this.#intent(INTENT_CARD_UPK);
    if (!this.#intentActive) return;
    // Рыночный порог подтверждения Платформы стенда (confirm_above_kop — в копейках рубля); количество — чтобы сумма была
    // выше него (не дробление, наоборот). Решает о подтверждении ADP, приложение только подбирает сумму сюжета.
    const threshold: Money = { amount: this.#d.stand.params.confirm_above_kop, currency: THRESHOLD_CURRENCY };
    await this.#buy({
      qtyFor: (price) => {
        if (price.currency !== threshold.currency) return { code: "CURRENCY_MISMATCH" };
        if (price.amount <= 0) return { code: "PRICE_INVALID" };
        const qty = Math.floor(threshold.amount / price.amount) + 1;
        this.#step("upk.qty", { qty, threshold });
        return qty;
      },
      confirmation: true,
      expectDecline,
    });
  }

  /** Сюжет 8 (П-06, Р-1459 В5): своё поручение на одного продавца, подпись человеком; выбор демо-правилом — товар другого
   *  продавца. Ядро само отказывает до запроса корзины (политика: продавец вне области поручения — MANDATE_OUT_OF_SCOPE);
   *  Платформа до отказа не доходит. Приложение продавца с поручением не сравнивает (инвариант 2) — только называет причину
   *  остановки ядра. Защита Платформы (MANDATE_SCOPE) — драйвер нарушителя П-11.3. */
  async #outOfScope(): Promise<void> {
    await this.#intent(INTENT_CARD_SCOPE);
    if (!this.#intentActive) return;
    await this.#buy({ expectScope: true });
  }

  /** Сюжет 5 (Р-1255 п. 3): на действующем поручении человек сам отзывает его на экране мандатов банка — кнопки
   *  «отозвать» на демо-экране нет (П2 п. 5). По событию mandate.revoked ядро перечитывает поручение у Платформы (GET
   *  мандата) — «отозвано»; затем агент пытается купить, и ядро останавливает попытку своей проверкой (MANDATE_REVOKED) —
   *  до витрин, корзины и оплаты, к Платформе при попытке не обращаясь (ревью К2.2г № 1). Отказ Платформы на запрос оплаты по отозванному поручению — сюжет подставного агента
   *  (DEMO-2), не этот. */
  async #revoke(): Promise<void> {
    const p = this.#purchase!;
    const id = p.intentMandate?.id;
    if (!id) {
      this.#step("failed", { code: "NO_INTENT", state: p.state });
      return;
    }
    this.#step("revoke.ask", { mandate_id: id });
    // Ядро уже знает об отзыве (событие прочитано раньше) — не ждать (ревью К2.2г № 3).
    if (!this.#d.agent.mandates.revoked(id)) await this.#waitRevoked(id);
    // Поручение отозвано: дальше покупок по нему нет.
    this.#intentActive = false;
    this.#step("revoke.seen", { mandate_id: id });
    this.#step("revoke.attempt", { mandate_id: id });
    try {
      await p.search();
    } catch (e) {
      // Шаг «отклонена из-за отзыва» — только при этой причине; иначе — общий отказ с кодом (ревью К2.2г № 5).
      if (p.reason === "MANDATE_REVOKED") this.#step("revoke.refused", { mandate_id: id, code: p.reason, state: p.state });
      else this.#fail(e);
      return;
    }
    // Ядро дошло до выдачи по отозванному поручению — так быть не должно: видно человеку как сбой.
    this.#step("failed", { code: "REVOKED_NOT_ENFORCED", state: p.state });
  }

  /** Ожидание события mandate.revoked по поручению — из ленты ПАО агента; отмена сюжета снимает ожидание. Пока ждём,
   *  лента будится с периодом опроса ленты агента (event_poll_interval_ms) — как опрос оболочки (Р34): сама лента читает
   *  только по сигналу. Слушатель ядра зарегистрирован раньше нашего, поэтому к нашему ok() поручение уже перечитано. */
  #waitRevoked(mandateId: string): Promise<void> {
    const signal = this.#signal;
    const events = this.#d.agent.events;
    return new Promise((ok, fail) => {
      if (signal.aborted) return fail(new Error("сюжет отменён"));
      let off: () => void = () => undefined;
      const done = () => {
        clearInterval(poll);
        off();
        signal.removeEventListener("abort", onAbort);
      };
      // Лента остановлена (агент остановлен) — ожидание завершается с ошибкой, а не вечно (ревью К2.2г № 4).
      const poll = setInterval(
        () =>
          void events.signal().catch((e: unknown) => {
            done();
            fail(e);
          }),
        this.#d.agent.params.event_poll_interval_ms,
      );
      poll.unref();
      const onAbort = () => {
        done();
        fail(new Error("сюжет отменён"));
      };
      signal.addEventListener("abort", onAbort, { once: true });
      off = events.listen((item) => {
        if (item.kind === "event" && item.event.type === "mandate.revoked" && item.event.mandateId === mandateId) {
          done();
          ok();
        }
      });
    });
  }

  /** Запрос подтверждения по корзине этой покупки — из ленты ПАО агента: ссылка на страницу УПК стенда и код из банка
   *  (эмулятор SMS). Ссылка страницы от ядра приходит только для https: (Р69 п. 5); у локального стенда — http:, поэтому
   *  ссылку строит сборка демо по confirmation_id. Решения здесь нет: подтверждает человек на странице. */
  #watchConfirmation(cartId: string, askDecline = false): { off(): void; approved(): boolean } {
    const seen = new Set<string>();
    let approved = false;
    const off = this.#d.agent.events.listen(async (item) => {
      if (item.kind !== "event") return;
      // Клиент подтвердил запрос этой покупки — событие Платформы (запрос уже показан этим сюжетом).
      if (item.event.type === "confirmation.approved" && item.event.confirmationId !== null && seen.has(item.event.confirmationId)) {
        approved = true;
        return;
      }
      if (item.event.type !== "confirmation.required") return;
      const id = item.event.confirmationId;
      if (!id || seen.has(id) || (item.event.mandateId !== null && item.event.mandateId !== cartId)) return;
      seen.add(id);
      this.#step("upk.required", { confirmation_id: id, upk_url: `${this.#d.urls.upk}/c/${encodeURIComponent(id)}` });
      // Сюжет 7: просьба не подтверждать — решает человек на странице УПК; сюжет за него ничего не нажимает (инвариант 3).
      if (askDecline) this.#step("unconfirmed.ask", { confirmation_id: id });
      const code = await this.#d.stand.issuer.upkCode(id).catch(() => undefined);
      if (code) this.#step("upk.sms", { code });
    });
    return { off, approved: () => approved };
  }

  /** Событие Платформы mandate.rejected по мандату — из ленты ПАО агента (сюжет 6): клиент отклонил подпись в банке.
   *  wait(ms) — дождаться события, если ядро остановилось раньше него (прочитало отказ своим GET до ленты; ревью П-11.1а
   *  № 2): лента будится с периодом опроса агента, как в #waitRevoked; нет события за срок — false. */
  #watchRejected(mandateId: string): { wait(ms: number): Promise<boolean>; off(): void } {
    const events = this.#d.agent.events;
    let seen = false;
    let wake: (() => void) | null = null;
    const off = events.listen((item) => {
      if (item.kind === "event" && item.event.type === "mandate.rejected" && item.event.mandateId === mandateId) {
        seen = true;
        wake?.();
      }
    });
    const wait = (ms: number): Promise<boolean> =>
      seen
        ? Promise.resolve(true)
        : new Promise((ok) => {
            const poll = setInterval(() => void events.signal().catch(() => undefined), this.#d.agent.params.event_poll_interval_ms);
            poll.unref();
            const timer = setTimeout(() => done(false), ms);
            timer.unref();
            function done(v: boolean): void {
              clearInterval(poll);
              clearTimeout(timer);
              wake = null;
              ok(v);
            }
            wake = () => done(true);
          });
    return { wait, off };
  }

  async #intent(card: IntentCard = INTENT_CARD): Promise<void> {
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
    const draft = demoIntent(new Date(), card);
    const intent = await p.intent(draft, this.#key("intent"));
    this.#step("intent.created", { mandate_id: intent.id, subject: draft.subject, limit: draft.amountLimit });
    this.#step("intent.awaiting_signature", { mandate_id: intent.id });
    const signed = await p.awaitIntent(this.#signal);
    this.#intentActive = signed.status === "ACTIVE";
    this.#step("intent.signed", { mandate_id: signed.id, status: signed.status });
  }

  /** Сюжет 3 (Р-1255 п. 1): покупка как в сюжете 2, но перед запросом корзины эмулятор банка ставит клиенту лимит на
   *  операцию ниже итога корзины. Отказ даёт ADP Платформы (LIMIT_EXCEEDED), приложение пределы не сравнивает
   *  (инвариант 2). После сюжета — при любом исходе — лимит снимается. */
  async #overLimit(): Promise<void> {
    let set = false;
    try {
      await this.#buy({
        beforeCart: async (total) => {
          // Лимит — половина итога корзины, округлённая вниз до целой единицы валюты: заведомо ниже суммы операции. Это
          // настройка банка (эмулятор), а не решение приложения о платеже. Валюты нет в таблице ISO 4217 — сюжет не идёт.
          const digits = ISO4217_MINOR_UNITS[total.currency];
          if (digits === undefined) throw Object.assign(new Error(`валюты ${total.currency} нет в таблице`), { code: "CURRENCY_UNKNOWN" });
          const unit = 10 ** digits;
          const limit: Money = { amount: Math.floor(total.amount / 2 / unit) * unit, currency: total.currency };
          await this.#setLimits({ per_operation: limit.amount, currency: limit.currency });
          set = true;
          this.#step("bank.limit_set", { limit });
        },
      });
    } catch (e) {
      // Отказ — в консоль до снятия лимита: шаги идут в порядке событий. «Превышен лимит клиента в банке» — только если
      // уведомление банку говорит CLIENT; иначе общий «failed» с кодом (ревью К2.2б № 2, повторное — Н4).
      const opRef = this.#purchase?.reason === "DECLINED_LIMIT_EXCEEDED" ? this.#rememberDecline() : undefined;
      const source = opRef ? await this.#d.limitSource(opRef) : undefined;
      // op_ref — из журнала ядра (operation.status DECLINED): ядро операцию отказа не отдаёт (расхождение № 1), а событие
      // operation.declined несёт только op_ref; шаг связывает операцию с заказом для модели транзакций пульта (П-1.2).
      const cartId = this.#purchase?.cartMandate?.id;
      if (source === "CLIENT")
        this.#step("limit.declined", {
          code: this.#purchase!.reason!,
          ...(this.#orderId && { order_id: this.#orderId }),
          ...(opRef && { op_ref: opRef }),
          ...(cartId !== undefined && { mandate_id: cartId }),
        });
      else this.#fail(e);
    } finally {
      if (set) {
        // Снятие — со своим исходом: сбой не маскируется прежней причиной отказа (ревью К2.2б № 3).
        try {
          await this.#setLimits({});
          this.#step("bank.limit_reset");
        } catch (e) {
          const code = (e as { code?: unknown } | null)?.code;
          this.#step("bank.limit_reset_failed", { code: typeof code === "string" ? code : "UNKNOWN" });
        }
      }
    }
  }

  /** Отказ операции: ядро операцию не запоминает (только одобрение), поэтому для строки события монитора — op_ref из
   *  журнала ядра (operation.status DECLINED) и сумма — итог корзины CART ядра, не со слов продавца (ревью К2.2б № 1). */
  #rememberDecline(): string | undefined {
    // Только отказ на оплате этой покупки: запись журнала — после начала её оплаты (ревью К2.2б, Н1).
    if (this.#payJournalFrom < 0 || !this.#purchase?.reason?.startsWith("DECLINED_")) return undefined;
    const total = this.#purchase.cartMandate?.cart?.total;
    const entries = this.#d.journal.entries;
    for (let i = entries.length - 1; i >= this.#payJournalFrom; i--) {
      const e = entries[i]!;
      if (e.kind === "operation.status" && e.detail === "DECLINED" && typeof e.ref === "string") {
        if (!this.#ops.has(e.ref)) this.#remember({ opRef: e.ref, orderRef: null, channel: null, amount: total ?? null, merchantId: null, indicator: null, status: "DECLINED", declineReason: null, fulfilment: null });
        return e.ref;
      }
    }
    return undefined;
  }

  /** Лимиты клиента в приложении банка стенда (ПИ-8): версия растёт с каждой записью. */
  async #setLimits(limits: Record<string, unknown>): Promise<void> {
    const r = await this.#d.stand.issuer.setLimits(DEMO_PRINCIPAL, limits, ++this.#limitsVersion);
    if (r.statusCode !== 200) throw Object.assign(new Error(`лимиты клиента не приняты: ${r.statusCode}`), { code: "BANK_LIMITS_REJECTED" });
  }

  async #buy(
    o: {
      beforeCart?: (total: Money) => Promise<void>;
      /** Количество по цене товара (сюжет 4); нет — 1. { code } — сюжет не идёт, с этим кодом. */
      qtyFor?: (price: Money) => number | { code: string };
      /** Сюжет 4: показывать запрос подтверждения (ссылка УПК, эмулятор SMS). */
      confirmation?: boolean;
      /** Сюжет 6 (П-03): человек отклоняет корзину в банке; подписанная корзина дальше заказа не идёт. */
      expectReject?: boolean;
      /** Сюжет 7 (П-04): человек не подтверждает покупку — «Отклонить» на странице УПК или конец срока запроса. */
      expectDecline?: boolean;
      /** Сюжет 8 (П-06): ядро отказывает в корзине у продавца вне поручения; принятая корзина дальше подписи не идёт. */
      expectScope?: boolean;
    } = {},
  ): Promise<void> {
    const p = this.#purchase!;
    // Поручение считается использованным с запроса корзины (ниже), а не с начала сюжета: прерванный или отклонённый до
    // корзины сюжет его не тратит (ревью К2.2а № 3). Второго сюжета, пока этот идёт, нет — start() отвечает BUSY.
    // Р-1251 п. 2: первая волна — немедленный режим (подпись корзины клиентом); автономный — второй этап.
    this.#step("purchase.mode_note", { platform: PLATFORM_VERSION }); // версия — из пакета стенда, не литералом (З8)
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
    // Карточка корзины (Т3а, Р-1248 п. 1): сюжет стоит, пока человек не ответит на демо-экране. Только после «согласен»
    // запрашивается корзина, и keyTermsShown: true — правда. Итог корзины считает ядро (шаг «корзина создана»), не
    // приложение (инвариант 2); на карточке — цена, количество и доставка из выдачи продавца.
    // Итог — функцией ядра cartTotal (Σ цена × количество, как у CART; ревью К2.1а № 1): приложение его не считает.
    // Доставка — условие продавца из выдачи; в итог корзины ядра она не входит, и карточка это говорит.
    const q = o.qtyFor ? o.qtyFor(pick.product.price) : 1;
    if (typeof q !== "number") {
      this.#step("failed", { code: q.code, state: p.state });
      return;
    }
    const qty = q;
    const total = cartTotal([{ price: pick.product.price, qty }]);
    const delivery = pick.product.delivery.find((d) => d.region === undefined || d.region === standRegion()) ?? pick.product.delivery[0];
    this.#step("cart.card", {
      title: pick.product.title,
      merchant_id: pick.merchantId,
      sku: pick.sku,
      price: pick.product.price,
      qty,
      ...(total && { total }),
      ...(delivery && {
        delivery_method: delivery.method,
        delivery_days: delivery.minDays === delivery.maxDays ? delivery.minDays : `${delivery.minDays}–${delivery.maxDays}`,
        delivery_cost: delivery.cost,
      }),
    });
    const agreed = await this.#consent();
    if (!agreed) {
      // Корзина не запрошена: поручение не использовано — сюжет 2 можно повторить.
      this.#step("cart.declined", { merchant_id: pick.merchantId, sku: pick.sku });
      return;
    }
    this.#step("cart.agreed", { merchant_id: pick.merchantId, sku: pick.sku });
    // Прервано между «согласен» и запросом — корзину не запрашивать (ревью К2.2а № 4).
    this.#signal.throwIfAborted();
    if (o.beforeCart && total) await o.beforeCart(total);
    this.#signal.throwIfAborted();
    // С этого запроса поручение использовано (разовое): следующая покупка — через новый сюжет 1.
    this.#intentActive = false;
    // Связка «корзина → поручение-намерение» (П-1.2, Р-1442): транзакция пульта собирается по идентификаторам; и у отказа
    // сюжета 8 — остановка привязана к поручению (ревью П-11.1в № 8).
    const intentId = p.intentMandate?.id;
    let cart: Mandate;
    try {
      cart = await p.cart({ merchantId: pick.merchantId, lines: [{ sku: pick.sku, qty }], keyTermsShown: true }, this.#key("cart"));
    } catch (e) {
      // Продавец выбора вне области поручения (сюжет 8, П-06): ядро остановилось до обращений — своя политика, запись
      // agent.refused в журнале агента. Только в сюжете 8: тот же код ядро даёт, если Платформа не подтвердила поручение
      // при сверке (ревью П-11.1в № 1), — в других сюжетах это обычный шаг failed. Сюжет только называет причину ядра.
      if (o.expectScope && p.reason === "MANDATE_OUT_OF_SCOPE" && !this.#ac.signal.aborted) {
        this.#step("scope.refused", { merchant_id: pick.merchantId, code: p.reason, state: p.state, ...(intentId !== undefined && { intent_id: intentId }) });
        return;
      }
      throw e;
    }
    if (o.expectScope) {
      // Выбор оказался в области поручения (зависит от витрин стенда; ревью П-11.1в № 3): проверять нечего — сюжет
      // останавливается до подписи корзины, чтобы на мониторе не дойти до оплаты в сюжете «вне поручения».
      this.#step("scope.not_refused", { merchant_id: pick.merchantId, mandate_id: cart.id });
      return;
    }
    this.#step("cart.created", { mandate_id: cart.id, ...(intentId !== undefined && { intent_id: intentId }), ...(cart.cart ? { total: cart.cart.total } : {}) });
    this.#step("cart.awaiting_signature", { mandate_id: cart.id });
    if (o.expectReject) this.#step("reject.ask", { mandate_id: cart.id });
    // Отказ подписи корзины клиентом (сюжет 6, П-03) — событие Платформы mandate.rejected по этой корзине: ядро по нему
    // перечитывает корзину и останавливается само (MANDATE_NOT_ACTIVE). Решения здесь нет — сюжет только называет причину.
    // Ядро может прочитать отказ своим GET раньше, чем событие дойдёт по ленте (ревью П-11.1а № 2): тогда сюжет ждёт
    // событие не дольше REJECT_WAIT_MS; без события — обычный шаг failed с кодом ядра.
    const rejection = this.#watchRejected(cart.id);
    let signed: Mandate;
    try {
      signed = await p.awaitCart(this.#signal);
    } catch (e) {
      if (p.reason === "MANDATE_NOT_ACTIVE" && !this.#signal.aborted && (await rejection.wait(REJECT_WAIT_MS))) {
        this.#step("cart.rejected", { mandate_id: cart.id, code: p.reason, state: p.state });
        return;
      }
      throw e;
    } finally {
      rejection.off();
    }
    this.#step("cart.signed", { mandate_id: signed.id, status: signed.status });
    if (o.expectReject) {
      // Сюжет 6 ждал отказа, а человек подписал: заказ не делается — сюжет оплату не показывает (паспорт 6 запрещает).
      this.#step("reject.signed", { mandate_id: signed.id });
      return;
    }
    this.#signal.throwIfAborted();
    const order = await p.placeOrder(this.#key("order"));
    // Заказ в витрине продавца (К2.3, п. 5 задачи): номер и сумма — ответ витрины агенту (слова продавца), товар — выбор.
    // Номер — в поле сюжета для шагов отказа; объект ошибки ядра не трогаем (ревью К2.3 № 3).
    this.#orderId = order.orderId;
    // mandate_id — поручение корзины этого заказа: связка «заказ → корзина» (П-1.2, Р-1442).
    this.#step("order.placed", { order_id: order.orderId, mandate_id: cart.id, merchant_id: pick.merchantId, total: order.total, title: pick.product.title, sku: pick.sku, qty });
    this.#step("payment.started", { order_id: order.orderId });
    // С оплаты прерывание не принимается: пакет передан продавцу, итог придёт по событию Платформы (ревью К2.2а № 1–2).
    this.#paying = true;
    this.#payJournalFrom = this.#d.journal.entries.length;
    const confirm = o.confirmation ? this.#watchConfirmation(cart.id, o.expectDecline === true) : undefined;
    let op: Operation;
    try {
      op = await p.authorize(this.#key("pay"), this.#signal);
    } catch (e) {
      this.#shopReplies(order.orderId);
      // Покупку не подтвердили (сюжет 7, П-04; и сюжет 4, если человек отклонил): ядро остановилось по решению или сроку
      // запроса Платформы — CONFIRMATION_REJECTED или CONFIRMATION_EXPIRED. Сюжет только называет причину ядра. Если клиент
      // подтвердил (confirmation.approved), а срок ссылки истёк до передачи продавцу, ядро тоже даёт CONFIRMATION_EXPIRED —
      // это не «не подтверждено», а обычный шаг остановки (ревью П-11.1б № 1). После close() шагов нет (№ 6).
      const reason = p.reason;
      if ((reason === "CONFIRMATION_REJECTED" || reason === "CONFIRMATION_EXPIRED") && !confirm?.approved() && !this.#ac.signal.aborted) {
        this.#step("upk.declined", { code: reason, order_id: order.orderId, mandate_id: cart.id, state: p.state });
        return;
      }
      throw e;
    } finally {
      confirm?.off();
    }
    this.#shopReplies(order.orderId);
    this.#remember(op);
    // mandate_id корзины — связка «операция → корзина» без номера заказа от витрины (П-1.2, блокер ревью № 1, Р-1444).
    this.#step("outcome", {
      op_ref: op.opRef,
      order_id: order.orderId,
      mandate_id: cart.id,
      status: op.status,
      ...(op.amount ? { amount: op.amount } : {}),
      ...(op.declineReason ? { code: op.declineReason } : {}),
      state: p.state,
    });
  }

  /** Ответы витрины агенту на оплату и подтверждение этого заказа — из журнала ядра (shop.call, деталь — ответ продавца:
   *  PAID, AWAITING_CONFIRMATION, DECLINED). Это слова продавца, а не итог: итог — только по событию Платформы. */
  #shopReplies(orderId: string): void {
    const entries = this.#d.journal.entries;
    for (let i = Math.max(this.#payJournalFrom, 0); i < entries.length; i++) {
      const e = entries[i]!;
      if (e.kind !== "shop.call" || typeof e.method !== "string" || typeof e.detail !== "string") continue;
      if (!/\/(payment|confirmation)$/.test(e.method) || !/^[A-Z_]+$/.test(e.detail)) continue;
      this.#step("order.shop_reply", { order_id: orderId, reply: e.detail });
    }
  }
}
