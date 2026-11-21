// Н-3 — общая фикстура модуля итога (находка ревью К2 № 7).
//
// До неё операция, запись об исполнении и чтение были объявлены **дважды** — в случаях К1 и К2 почти буквально, с теми
// же `op_5512` и `ful_7731`. Два источника одной фикстуры расходятся молча: правка в одном файле разводит случаи, и
// это не краснеет.
//
// Правило 16.11 «в фикстуре разные сущности — разные значения» держится здесь: **у каждой суммы и у каждого момента
// своё значение**, поэтому сборка, взявшая не то поле, не может остаться зелёной.
import { readFileSync } from "node:fs";
import type { Fulfilment, Operation } from "agentic-buyer-ref/src/shared/domain.js";
import type { OrderRead, ShellText } from "../../src/order/port.js";
import type { OrderBodyDeps } from "../../src/order/response.js";
import { parseOrderTexts, type OrderTexts } from "../../src/order/texts.js";

/** Моменты: чтение у Платформы, запись об исполнении, `verify` и вердикт остановки — четыре разных значения. */
export const CHECKED_AT = "2026-11-21T20:15:00.000Z";
export const FULFILLED_AT = "2026-11-21T18:05:00.000Z";
export const VERIFIED_AT = "2026-11-21T20:14:30.000Z";
export const STOPPED_AT = "2026-11-21T17:40:00.000Z";

/** Суммы: одобрено 36 800, списано при клиринге 36 150, положение по поручению 41 200, остаток поручения 63 200. */
export const AUTHORIZED = { amount: 36_800, currency: "RUB" } as const;
export const FINAL = { amount: 36_150, currency: "RUB" } as const;
export const SPENT = { amount: 41_200, currency: "RUB" } as const;
export const LEFT = { amount: 63_200, currency: "RUB" } as const;

export const fulfilment = (over: Partial<Fulfilment> = {}): Fulfilment => ({
  ref: "ful_7731",
  finalAmount: FINAL,
  scopeCheck: "WITHIN_LIMITS",
  spentPosition: SPENT,
  at: FULFILLED_AT,
  ...over,
});

export const operation = (over: Partial<Operation> = {}): Operation => ({
  opRef: "op_5512",
  orderRef: "ord_8840",
  channel: "CARD",
  amount: AUTHORIZED,
  merchantId: "MER-3307",
  indicator: { agentCode: "AG-0042", mandateId: "mnd_cart_9103" },
  status: "SETTLED",
  declineReason: null,
  fulfilment: fulfilment(),
  ...over,
});

/**
 * Операция в том виде, в каком её отдаёт ядро **до расчёта и при отказе**: записи об исполнении нет (`fulfilment`
 * равен `null`, «до SETTLED — null» у ядра). Отдельная заготовка нужна, чтобы случаи отказа и ожидания расчёта не
 * собирались из `SETTLED`-операции с чужой записью об исполнении — такой операции у ядра не бывает, и зелёный случай
 * на ней подтверждал бы не то, что написано в его названии (находка ревью К2 № 2).
 */
export const unsettled = (over: Partial<Operation> = {}): Operation =>
  operation({ status: "AUTHORIZED", fulfilment: null, ...over });

export const read = (over: Partial<OrderRead> = {}): OrderRead => ({
  purchase_id: "pur_2255",
  operation: operation(),
  checked_at: CHECKED_AT,
  state: "DONE",
  intent: {
    id: "mnd_intent_6620",
    status: "ACTIVE",
    amount_left: LEFT,
    valid_to: "2026-11-28T09:00:00.000Z",
    as_of: VERIFIED_AT,
    revocation_order: null,
  },
  stops: [],
  agent_fee: { amount: { amount: 1, currency: "RUB" }, text: "Цена агента — 1 копейка" },
  act: { id: "act_4471", card_url: "/ui/v1/act/act_4471?view=card" },
  ...over,
});

/** Тексты — из **того же файла**, что в работе (Р-1511), один разбор на все случаи модуля. */
export const texts: OrderTexts = parseOrderTexts(
  JSON.parse(readFileSync(new URL("../../config/order.default.json", import.meta.url), "utf8")),
);

/**
 * Каркас портом (Р-1693) — **одна заглушка на все случаи модуля** (находка ревью К4 № 6: две копии уже разошлись, и в
 * одной сумма печаталась без валюты).
 *
 * Нарочно **метки**, а не формат: проверяется, что в строку уходит остаток `verify` и состояние прочитанного, а не
 * форматирование суммы — у него свой тест там, где он объявлен. Сумма печатается **парой** (число и код валюты), как
 * требует правило планов № 2: заглушка без валюты прятала бы ошибку масштаба.
 */
export const shell: ShellText = {
  notSpent: (intent, lang) =>
    `«не списано ${String(intent.amount_left.amount)} ${intent.amount_left.currency} на ${lang}»`,
  done: (r, lang) => `«сделано ${r.state} на ${lang}»`,
};

export const deps = (over: Partial<OrderBodyDeps> = {}): OrderBodyDeps => ({ lang: "ru", texts, shell, ...over });
