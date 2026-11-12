// Взвод и снятие сбоев стенда «П» человеком (П-11.2б; план П-11.2, В8, В10; ответ владельца на вопрос № 12 (б)): маршрут
// монитора `POST /stand-fault/<Н-xx>/arm|disarm` — только при режиме сбоев (`DEMO_FAULTS=1`), модуль создаёт только сборка
// `run.ts`. Сбой взводит функция стенда `stand.demo.arm` (РП75 п. 3) — приложение само ничего не ломает.
//
// Витрина (В8, решение владельца 12.11): Н-03, Н-04, Н-05 взводятся только на конкретную витрину — `shop_id` или `merchant_id`
// явно (пульт), иначе продавец последней карточки корзины (`cart.card`) идущего прогона, иначе 409 SHOP_REQUIRED. «На все
// витрины» не взводятся ни при каких условиях: сбой срабатывал бы и на заказах чужих клиентов (вопрос № 12).
//
// Настройки — только из перечня стенда для этого теста (`OPTIONS_BY_TEST`, `dist/stand/demo.js` v0.48.0): иное — 400
// BAD_OPTION до обращения к стенду. Отказ стенда (неизвестная витрина, срок вне 1…60 000) — 409 ARM_REJECTED: текст исключения
// стенда наружу не идёт. Каждый взвод и снятие — шаг на шине `stand_fault.*` с пометкой «человеком».
//
// Человек и драйвер «ПР» (П-11.2в, П7 доп. 2): у стенда один взвод на тест. Пока ветка драйвера держит взвод своего теста,
// взвод и снятие этого теста человеком — 409 HELD_BY_DRIVER (иначе взвод человека перезаписал бы витрину нарушителя, а снятие
// драйвером в конце ветки сняло бы и сбой человека). Взвод человека до ветки драйвер не трогает и не «держит».
import type { StandDemo } from "agentic-ps-platform/stand";
import type { BusItem } from "./bus.js";
import type { StepSink } from "./scenarios.js";

/** Тесты со сбоем стенда «П» (`ARMABLE` стенда v0.48.0). */
export const STAND_FAULT_TESTS = ["Н-02", "Н-03", "Н-04", "Н-05", "Н-11", "Н-12"] as const;
export type StandFaultTest = (typeof STAND_FAULT_TESTS)[number];
export const isStandFaultTest = (s: string): s is StandFaultTest => (STAND_FAULT_TESTS as readonly string[]).includes(s);

export const STAND_FAULT_OPTIONS = ["merchant_id", "shop_id", "delay_ms", "reorder"] as const;
type OptionKey = (typeof STAND_FAULT_OPTIONS)[number];

/** Какие настройки принимает сбой — копия `OPTIONS_BY_TEST` стенда; равенство со стендом проверяет живой тест. */
export const OPTIONS_BY_TEST: Readonly<Record<StandFaultTest, readonly OptionKey[]>> = {
  "Н-02": [],
  "Н-03": ["merchant_id", "shop_id"],
  "Н-04": ["merchant_id", "shop_id"],
  "Н-05": ["merchant_id", "shop_id"],
  "Н-11": [],
  "Н-12": ["delay_ms", "reorder"],
};

/** Сбои витрин — только на конкретную витрину (В8). */
const SHOP_REQUIRED: ReadonlySet<StandFaultTest> = new Set(["Н-03", "Н-04", "Н-05"]);

export interface StandFaultOptions {
  readonly merchant_id?: string;
  readonly shop_id?: string;
  readonly delay_ms?: number;
  readonly reorder?: boolean;
}

export type StandFaultCode = "BAD_OPTION" | "SHOP_REQUIRED" | "ARM_REJECTED" | "NOT_ARMED" | "HELD_BY_DRIVER";
export type StandFaultResult = { readonly ok: true; readonly test: StandFaultTest; readonly options: StandFaultOptions } | { readonly ok: false; readonly code: StandFaultCode };

const ID = /^[A-Za-z0-9_-]{1,64}$/;

/** Настройки из параметров адреса: только перечень теста, по форме; иное — undefined (BAD_OPTION). */
export function parseOptions(test: StandFaultTest, q: URLSearchParams): StandFaultOptions | undefined {
  const allowed = OPTIONS_BY_TEST[test];
  const out: { -readonly [K in OptionKey]?: StandFaultOptions[K] } = {};
  for (const [k, v] of q) {
    if (k === "lang") continue; // язык ответа сервера — не настройка сбоя
    if (!(allowed as readonly string[]).includes(k) || Object.hasOwn(out, k)) return undefined;
    if (k === "merchant_id" || k === "shop_id") {
      if (!ID.test(v)) return undefined;
      out[k] = v;
    } else if (k === "delay_ms") {
      if (!/^[0-9]{1,9}$/.test(v)) return undefined;
      out.delay_ms = Number(v);
    } else if (k === "reorder") {
      if (v !== "true" && v !== "false") return undefined;
      out.reorder = v === "true";
    }
  }
  return out;
}

/** Продавец последней карточки корзины прогона: после последней метки `run.*` — `merchant_id` последней `cart.card`. Метки
 *  нет или карточки после неё нет — undefined. Идёт ли прогон, решает сборка (`run.ts`: только пока сюжет занят). */
export function lastCardMerchant(history: readonly BusItem[]): string | undefined {
  let merchant: string | undefined;
  for (const i of history) {
    if (i.stream !== "scenario") continue;
    if (i.line.step.startsWith("run.")) merchant = undefined;
    else if (i.line.step === "cart.card" && typeof i.line.params.merchant_id === "string") merchant = i.line.params.merchant_id;
  }
  return merchant;
}

export interface StandFaultPorts {
  readonly demo: Pick<StandDemo, "arm" | "disarm">;
  /** Продавец карточки идущего прогона (по умолчанию для Н-03, Н-04, Н-05). */
  readonly currentMerchant: () => string | undefined;
  readonly emit: StepSink;
  /** Держит ли ветка драйвера «ПР» взвод этого теста (П-11.2в, П7 доп. 2): тогда взвод и снятие человеком — 409
   *  HELD_BY_DRIVER. Нет драйвера — не держит. */
  readonly held?: (test: StandFaultTest) => boolean;
}

export class StandFaults {
  readonly #p: StandFaultPorts;

  constructor(p: StandFaultPorts) {
    this.#p = p;
  }

  arm(test: StandFaultTest, q: URLSearchParams): StandFaultResult {
    if (this.#p.held?.(test)) return { ok: false, code: "HELD_BY_DRIVER" };
    const parsed = parseOptions(test, q);
    if (!parsed) return { ok: false, code: "BAD_OPTION" };
    let options = parsed;
    if (SHOP_REQUIRED.has(test) && options.shop_id === undefined && options.merchant_id === undefined) {
      const m = this.#p.currentMerchant();
      if (m === undefined) return { ok: false, code: "SHOP_REQUIRED" };
      options = { merchant_id: m };
    }
    try {
      this.#p.demo.arm(test, options);
    } catch {
      return { ok: false, code: "ARM_REJECTED" };
    }
    this.#p.emit({
      step: "stand_fault.armed",
      params: {
        test,
        ...(options.shop_id !== undefined && { shop_id: options.shop_id }),
        ...(options.merchant_id !== undefined && { merchant_id: options.merchant_id }),
        ...(options.delay_ms !== undefined && { delay_ms: options.delay_ms }),
        ...(options.reorder !== undefined && { reorder: String(options.reorder) }),
      },
    });
    return { ok: true, test, options };
  }

  disarm(test: StandFaultTest): StandFaultResult {
    if (this.#p.held?.(test)) return { ok: false, code: "HELD_BY_DRIVER" };
    let removed: boolean;
    try {
      removed = this.#p.demo.disarm(test);
    } catch {
      return { ok: false, code: "ARM_REJECTED" };
    }
    if (!removed) return { ok: false, code: "NOT_ARMED" };
    this.#p.emit({ step: "stand_fault.disarmed", params: { test } });
    return { ok: true, test, options: {} };
  }
}
