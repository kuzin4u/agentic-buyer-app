// Эмулятор клиента «Решения людей: Авто» (П5, дополнение 1; П-11.4б) — только для прогона 25 тестов пульта на стенде с
// эмуляторами (`DEMO_FAULTS=1`). Без флага модуль не создаётся (`run.ts`), маршрута нет (П5 п. 4).
//
// Что делает в «Авто» — решения человека по сценарию теста, а не по ответу ядра (П5 п. 2, доп. 1 п. 2): сценарий — последняя
// метка прогона на шине (`run.<имя>` сюжета или `run.fault` драйвера с тестом), действие — по закрытой таблице `decide`:
//  - «согласен» на карточку корзины (`cart.card`) — как кнопка человека на мониторе;
//  - подпись поручения и корзины в банке (`issuer.sign`); П-03 (`run.reject`) — отказ от корзины (`REJECT`);
//  - подтверждение запроса в банке (`issuer.confirm`); П-04 (`run.unconfirmed`) — отклонение (`REJECT`);
//  - отзыв поручения в банке (`issuer.revoke`) — П-05 (`run.revoke`) и Н-06 драйвера (`fault.note.revoke_ask`).
// Где сценарий решения не требует (Н-07 `cart_keep_unsigned`, незнакомая метка), — ничего. В «Вручную» (по умолчанию) — ни
// одного действия: пять сюжетов ACC-1 и У-01…У-04 идут только руками (П5 п. 6, доп. 1 п. 5).
//
// Пометка (П5 п. 3, Р-1497): каждое действие — шаг `client.*` на шине с `source: "client-emulator"` и идентификатором объекта
// (`mandate_id` поручения или корзины, `confirmation_id`; у «согласен» — `mandate_id` поручения-намерения из `intent_id`
// карточки, Р-1506, и `merchant_id`). В шаге — только `code` / `status` и идентификаторы: ни кода УПК, ни ссылки
// подтверждения, ни тел ответов банка (инвариант 1; уточнение 1). Запись стенда о подписи остаётся `stand` — это факт подписи,
// его читает движок пульта. Шаг о совершённом действии выходит и после `close()`: действие без пометки — нарушение П5 п. 3.
// Гарантия — в пределах срока ожидания `close()` (CLOSE_WAIT_MS): вызов банка, не закончившийся за срок, бывает только при
// закрытии сборки — шина и стенд уже остановлены, пометка не гарантирована.
//
// Нажатие человека в «Авто» (кнопка карточки или «прервать» до ответа эмулятора) даёт `client.cart_failed` NOT_AWAITING —
// «конфликт»: прогон уже не чисто «Авто».
//
// Режим прогона для таблицы тестирования — по последнему `client.auto_*` до метки `run.*` прогона (Р-1507, «Контроль» —
// окно А, П-4.3): шаги `client.auto_*` идут вне прогона.
//
// Граница (П5 п. 5, доп. 1 п. 4): `issuer.sign`, `issuer.confirm`, `issuer.revoke` и ответ на карточку за человека в `src/`
// вызывает только этот модуль (сборка `run.ts` лишь передаёт порты); пульт его не импортирует. Тест границы — П-11.4в.
import type { StandIssuer } from "agentic-ps-platform/stand";
import type { BusItem, ScenarioLine } from "./bus.js";
import type { StepSink } from "./scenarios.js";

/** Источник шага на шине (П5 п. 3). */
export const CLIENT_EMULATOR_SOURCE = "client-emulator";

/** Шаги эмулятора на шине — закрытый перечень; у каждого — текст ru/en в словарях монитора и интерпретатора. */
export const CLIENT_STEPS = [
  "client.auto_on",
  "client.auto_off",
  "client.cart_agreed",
  "client.cart_failed",
  "client.signed",
  "client.cart_rejected",
  "client.sign_failed",
  "client.confirmed",
  "client.confirm_rejected",
  "client.confirm_failed",
  "client.revoked",
  "client.revoke_failed",
] as const;
export type ClientStep = (typeof CLIENT_STEPS)[number];

/** Действие эмулятора по шагу ожидания клиента. */
export type ClientAction =
  | { readonly kind: "cart_agree"; readonly intentId?: string; readonly merchantId?: string }
  | { readonly kind: "sign"; readonly mandateId: string; readonly reject: boolean }
  | { readonly kind: "confirm"; readonly confirmationId: string; readonly reject: boolean }
  | { readonly kind: "revoke"; readonly mandateId: string };

/** Сценарий теста — по последней метке прогона: имя сюжета (`run.<имя>`) или тест драйвера (`run.fault`). */
export type RunLabel = { readonly scenario: string } | { readonly fault: string };

/** Метки сюжетов, где эмулятор действует (`src/demo/scenarios.ts`, RUN_STEP). Иная метка — ничего. */
const SCENARIOS: ReadonlySet<string> = new Set(["intent", "purchase", "limit", "upk", "revoke", "reject", "unconfirmed", "scope", "suspended", "expired"]);

const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);

/** Закрытая таблица «сценарий × шаг ожидания → действие» (П5 п. 2, доп. 1). Нет строки — эмулятор ничего не делает. */
export function decide(label: RunLabel | undefined, line: Pick<ScenarioLine, "step" | "params">): ClientAction | undefined {
  if (!label) return undefined;
  const mandateId = str(line.params.mandate_id);
  if ("scenario" in label) {
    if (!SCENARIOS.has(label.scenario)) return undefined;
    switch (line.step) {
      case "cart.card": {
        const intentId = str(line.params.intent_id);
        const merchantId = str(line.params.merchant_id);
        return { kind: "cart_agree", ...(intentId !== undefined && { intentId }), ...(merchantId !== undefined && { merchantId }) };
      }
      case "intent.awaiting_signature":
        return mandateId ? { kind: "sign", mandateId, reject: false } : undefined;
      case "cart.awaiting_signature":
        // П-03 (сюжет 6): клиент отказывается от корзины в банке.
        return mandateId ? { kind: "sign", mandateId, reject: label.scenario === "reject" } : undefined;
      case "upk.required": {
        const confirmationId = str(line.params.confirmation_id);
        // П-04 (сюжет 7): клиент не подтверждает покупку.
        return confirmationId ? { kind: "confirm", confirmationId, reject: label.scenario === "unconfirmed" } : undefined;
      }
      case "revoke.ask":
        return label.scenario === "revoke" && mandateId ? { kind: "revoke", mandateId } : undefined;
      default:
        return undefined;
    }
  }
  switch (line.step) {
    case "fault.note.intent_requested":
    case "fault.note.cart_sign_ask":
    case "fault.note.cart_sign_ask_scope":
      return mandateId ? { kind: "sign", mandateId, reject: false } : undefined;
    case "fault.note.revoke_ask":
      // Н-06: полномочие действовало и отозвано клиентом в банке (П7 доп. 2).
      return label.fault === "Н-06" && mandateId ? { kind: "revoke", mandateId } : undefined;
    default:
      // Н-07 `cart_keep_unsigned` — корзину клиент не подписывает: действия нет.
      return undefined;
  }
}

/** Порты эмулятора — только то, что ему нужно; сборка демо-стенда (`run.ts`) передаёт их из стенда, сюжетов и шины. */
export interface ClientEmulatorPorts {
  readonly issuer: Pick<StandIssuer, "sign" | "confirm" | "revoke">;
  /** Ответ «согласен» на карточку корзины — тот же путь, что у кнопки человека (`DemoScenarios.answerCart`). */
  readonly answerCart: (agree: boolean) => { ok: true } | { ok: false; code: string };
  readonly subscribe: (fn: (i: BusItem) => void) => () => void;
  readonly emit: StepSink;
}

const CODE = /^[A-Z][A-Z0-9_]{0,63}$/;
/** Сколько `close()` ждёт начатых действий: зависший вызов банка не вешает закрытие сборки. */
const CLOSE_WAIT_MS = 5_000;
/** Код отказа банка — только машинный код из тела ответа; тело целиком на шину не идёт (инвариант 1). */
const codeOf = (body: unknown): string | undefined => {
  const c = body !== null && typeof body === "object" ? (body as { code?: unknown }).code : undefined;
  return typeof c === "string" && CODE.test(c) ? c : undefined;
};

export class ClientEmulator {
  readonly #p: ClientEmulatorPorts;
  #auto = false;
  /** Номер включения «Авто»: действие в очереди выполняется, только если с его постановки режим не переключали (ревью
   *  П-11.4б № 4) — «выкл → вкл» посреди длинного вызова не оживляет шаги, пришедшие до выключения. */
  #epoch = 0;
  #label: RunLabel | undefined;
  #off: (() => void) | undefined;
  /** Действия — по очереди: подпись и ответ на карточку не обгоняют друг друга. */
  #queue: Promise<void> = Promise.resolve();
  #closed = false;

  constructor(p: ClientEmulatorPorts) {
    this.#p = p;
    // Метку прогона эмулятор помнит и в «Вручную»: включённое посреди прогона «Авто» действует по сценарию этого прогона, но
    // только на шаги, пришедшие после включения (задним числом — ничего).
    this.#off = p.subscribe((i) => this.#onItem(i));
  }

  get auto(): boolean {
    return this.#auto;
  }

  /** Включить / выключить «Авто» (порт для маршрута пульта, П-11.4в). Смена — шаг на шине; повтор — без шага. */
  setAuto(on: boolean): boolean {
    if (this.#closed || on === this.#auto) return this.#auto;
    this.#auto = on;
    this.#epoch++;
    this.#step(on ? "client.auto_on" : "client.auto_off", {});
    return this.#auto;
  }

  /** Дождаться начатых действий (тесты и закрытие сборки). */
  settled(): Promise<void> {
    return this.#queue;
  }

  /** Новые действия больше не начинаются; начатые дописывают свой шаг (пометка, П5 п. 3), ожидание — не дольше CLOSE_WAIT_MS. */
  async close(): Promise<void> {
    this.#closed = true;
    this.#off?.();
    this.#off = undefined;
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([this.#queue, new Promise<void>((ok) => (timer = setTimeout(ok, CLOSE_WAIT_MS)))]);
    clearTimeout(timer);
  }

  #onItem(i: BusItem): void {
    if (this.#closed || i.stream !== "scenario") return;
    const l = i.line;
    if (l.step.startsWith("run.")) {
      this.#label = l.step === "run.fault" ? { fault: String(l.params.test ?? "") } : { scenario: l.step.slice("run.".length) };
      return;
    }
    if (!this.#auto) return;
    const a = decide(this.#label, l);
    if (!a) return;
    // Шина зовёт подписчиков синхронно из `emit` сюжета: действие — микрозадачей после него, иначе шаг эмулятора встал бы внутри
    // чужого. На этом же держится «согласен»: сюжет выставляет ожидание ответа (`#consent()`) синхронно сразу после
    // `cart.card` (`scenarios.ts`), и к микрозадаче оно уже есть.
    const epoch = this.#epoch;
    this.#queue = this.#queue.then(() => this.#act(a, epoch)).catch(() => undefined);
  }

  async #act(a: ClientAction, epoch: number): Promise<void> {
    if (this.#closed || !this.#auto || epoch !== this.#epoch) return;
    switch (a.kind) {
      case "cart_agree": {
        const r = this.#p.answerCart(true);
        const ids: Record<string, string> = {
          ...(a.intentId !== undefined && { mandate_id: a.intentId }),
          ...(a.merchantId !== undefined && { merchant_id: a.merchantId }),
        };
        if (r.ok) this.#step("client.cart_agreed", ids);
        else this.#step("client.cart_failed", { ...ids, code: CODE.test(r.code) ? r.code : "CART_ANSWER_FAILED" });
        return;
      }
      case "sign":
        return this.#call(
          () => this.#p.issuer.sign(a.mandateId, a.reject ? { decision: "REJECT" } : {}),
          { mandate_id: a.mandateId },
          a.reject ? "client.cart_rejected" : "client.signed",
          "client.sign_failed",
        );
      case "confirm":
        return this.#call(
          () => this.#p.issuer.confirm(a.confirmationId, { decision: a.reject ? "REJECT" : "APPROVE" }),
          { confirmation_id: a.confirmationId },
          a.reject ? "client.confirm_rejected" : "client.confirmed",
          "client.confirm_failed",
        );
      case "revoke":
        return this.#call(() => this.#p.issuer.revoke(a.mandateId), { mandate_id: a.mandateId }, "client.revoked", "client.revoke_failed");
    }
  }

  async #call(
    f: () => Promise<{ readonly statusCode: number; readonly body: unknown }>,
    ids: Readonly<Record<string, string>>,
    ok: ClientStep,
    failed: ClientStep,
  ): Promise<void> {
    let r: { readonly statusCode: number; readonly body: unknown };
    try {
      r = await f();
    } catch {
      this.#step(failed, { ...ids, code: "CLIENT_CALL_FAILED" });
      return;
    }
    if (r.statusCode === 200) this.#step(ok, ids);
    else {
      const code = codeOf(r.body);
      this.#step(failed, { ...ids, status: r.statusCode, ...(code !== undefined && { code }) });
    }
  }

  #step(step: ClientStep, params: Readonly<Record<string, string | number>>): void {
    this.#p.emit({ step, params: { ...params, source: CLIENT_EMULATOR_SOURCE } });
  }
}
