// Н-3, К2 — тело итога § 5.8 собирается по исходу чтения покупки (правило 4 К-Б, П31, решение П36).
// Тексты — из `config/order.default.json`, того же файла, что в работе (Р-1511), а не из копии в тесте.
// Фикстура — разные значения у разных сущностей и у разных сумм (правило владельца 16.11): сумма операции, сумма
// записи об исполнении, положение по поручению и остаток — четыре разных числа, и подмена поля не может остаться
// зелёной.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { orderBody, scopeCodeOfNotice, type OrderBodyDeps } from "../../src/order/response.js";
import { parseOrderTexts, type OrderTexts } from "../../src/order/texts.js";
import type { OrderRead, ShellText } from "../../src/order/port.js";
import type { UiFeedEvent } from "../../src/contract/ui-v1/methods.js";
import { CHECKED_AT, fulfilment, operation, read, STOPPED_AT, unsettled } from "./fixture.js";
import type { PurchaseNotice } from "agentic-buyer-ref/src/agent/ports/shop.js";

const texts: OrderTexts = parseOrderTexts(
  JSON.parse(readFileSync(new URL("../../config/order.default.json", import.meta.url), "utf8")),
);

// Фикстура — общая (`./fixture.js`), одна на случаи К1 и К2 (находка ревью К2 № 7).

/** Каркас портом (Р-1693): здесь нарочно **метки**, а не формат — проверяется, что в строку уходит остаток `verify` и
 *  состояние прочитанного, а не форматирование суммы (у него свой тест там, где он объявлен). */
const shell: ShellText = {
  notSpent: (intent, lang) => `«не списано ${String(intent.amount_left.amount)} ${intent.amount_left.currency} на ${lang}»`,
  done: (r, lang) => `«сделано ${r.state} на ${lang}»`,
};

const deps = (over: Partial<OrderBodyDeps> = {}): OrderBodyDeps => ({ lang: "ru", texts, shell, ...over });

const ok = (r: OrderRead = read(), d: OrderBodyDeps = deps()) => {
  const body = orderBody(r, d);
  if (!body.ok) throw new Error(`ожидалось тело, пришла причина ${body.reason}`);
  return body.response;
};

describe("К2: тело § 5.8 — из прочитанного", () => {
  it("величины переложены как есть: три суммы остаются тремя", () => {
    const res = ok();
    expect(res.operation.amount).toEqual({ amount: 36_800, currency: "RUB" });
    expect(res.fulfilment.final).toEqual({ amount: 36_150, currency: "RUB" });
    expect(res.fulfilment.spent_position).toEqual({ amount: 41_200, currency: "RUB" });
    expect(res.fulfilment.at).toBe("2026-11-21T18:05:00.000Z");
    expect(res.source.checked_at).toBe("2026-11-21T20:15:00.000Z");
  });

  it("`spent_position` не пересчитывается: это не сумма операции и не сумма списания и не их сложение", () => {
    const res = ok();
    expect(res.fulfilment.spent_position.amount).toBe(41_200);
    expect(res.fulfilment.spent_position.amount).not.toBe(res.operation.amount.amount);
    expect(res.fulfilment.spent_position.amount).not.toBe(res.fulfilment.final.amount);
    // Сложение дало бы 72 950 — своего сложения в сборке нет (инвариант 6 ядра).
    expect(res.fulfilment.spent_position.amount).not.toBe(res.operation.amount.amount + res.fulfilment.final.amount);
  });

  it("`not_spent` — остаток поручения из `verify`, а не разница «поручение − списано»", () => {
    const res = ok();
    expect(res.done_line.not_spent).toBe("«не списано 63200 RUB на ru»");
    // Разница одобренного и списанного — 650; её в строке нет и быть не может.
    expect(res.done_line.not_spent).not.toContain("650");
  });

  it("`done` — по состоянию **прочитанного**: другое чтение даёт другую строку", () => {
    expect(ok().done_line.done).toBe("«сделано DONE на ru»");
    expect(ok(read({ state: "SETTLING" })).done_line.done).toBe("«сделано SETTLING на ru»");
  });

  it("шаг экрана — таблицей контракта по состоянию прочитанного", () => {
    expect(ok().step).toBe("U7");
    expect(ok().state).toBe("DONE");
  });

  it("цена агента и акт переложены из прочитанного, а не придуманы (Р-1691)", () => {
    const res = ok();
    expect(res.agent_fee).toEqual({ amount: { amount: 1, currency: "RUB" }, text: "Цена агента — 1 копейка" });
    expect(res.act).toEqual({ id: "act_4471", card_url: "/ui/v1/act/act_4471?view=card" });
    const other = ok(
      read({
        agent_fee: { amount: { amount: 2, currency: "RUB" }, text: "другая цена" },
        act: { id: "act_9999", card_url: "/ui/v1/act/act_9999?view=card" },
      }),
    );
    expect(other.agent_fee.amount.amount).toBe(2);
    expect(other.act.id).toBe("act_9999");
  });

  it("вердикты по остановке переложены из прочитанного", () => {
    // Своё время у вердикта: равное `checked_at` оставило бы зелёной сборку, подставляющую время чтения в `stops[].at`
    // (находка ревью К2 № 6).
    const stop = { class: "BUS", binding: "EXACT", code: "R17", text: "Платформа отказала", at: STOPPED_AT } as const;
    expect(ok(read({ stops: [stop] })).stops).toEqual([stop]);
    expect(ok().stops).toEqual([]);
  });
});

describe("К2: событие потока — только сигнал", () => {
  it("события в сборке нет вовсе: подменить ответ событием нечем", () => {
    // Проверку держит **компилятор** (`tsc` в `npm run check` и в CI): третьего параметра у сборки нет (правило 4 К-Б,
    // П31). Заполняющих `expect` здесь нет намеренно — они сделали бы счёт случаев больше, чем проверок по существу
    // (находка ревью К2 № 10).
    const event: UiFeedEvent = { event_id: "evt_3091", purchase_id: "pur_2255", kind: "STATE", at: "2026-11-21T20:16:00.000Z" };
    const compileOnly = (): void => {
      // @ts-expect-error — событие в сборку тела не передаётся: истина берётся чтением
      void orderBody(read(), deps(), event);
    };
    void compileOnly;
    expect(orderBody(read(), deps()).ok).toBe(true);
  });

  it("ответ собран из прочитанного целиком — сверка с готовым телом, а не со второй сборкой", () => {
    // Ожидание — **готовый объект**, а не повторный вызов той же сборки (находка ревью К2 № 3; постановка Н-3,
    // «Что проверяем на каждом кирпиче»). Повторный вызов был бы зелёным у любой чистой функции, в том числе у той,
    // которая читает событие из общего места.
    expect(ok()).toEqual({
      state: "DONE",
      step: "U7",
      operation: { status: "SETTLED", amount: { amount: 36_800, currency: "RUB" }, decline_text: null },
      fulfilment: {
        final: { amount: 36_150, currency: "RUB" },
        scope_check: "WITHIN_LIMITS",
        scope_text: texts.scope.WITHIN_LIMITS.ru,
        spent_position: { amount: 41_200, currency: "RUB" },
        at: "2026-11-21T18:05:00.000Z",
      },
      source: { text: texts.sources.PLATFORM_FULFILMENT.ru, checked_at: "2026-11-21T20:15:00.000Z" },
      done_line: { done: "«сделано DONE на ru»", not_spent: "«не списано 63200 RUB на ru»" },
      refund: null,
      stops: [],
      agent_fee: { amount: { amount: 1, currency: "RUB" }, text: "Цена агента — 1 копейка" },
      act: { id: "act_4471", card_url: "/ui/v1/act/act_4471?view=card" },
    });
  });

  it("другое чтение — другое тело: ответ идёт за чтением, а не за сигналом", () => {
    const later = ok(
      read({ checked_at: "2026-11-22T06:00:00.000Z", operation: operation({ fulfilment: fulfilment({ finalAmount: { amount: 36_000, currency: "RUB" } }) }) }),
    );
    expect(later.source.checked_at).toBe("2026-11-22T06:00:00.000Z");
    expect(later.fulfilment.final.amount).toBe(36_000);
  });
});

describe("К2: класс проверки клиринга — у ядра, текст человеку — свой", () => {
  it("`WITHIN_LIMITS` — текст «в пределах поручения» из `config/`", () => {
    expect(ok().fulfilment.scope_check).toBe("WITHIN_LIMITS");
    expect(ok().fulfilment.scope_text).toBe(texts.scope.WITHIN_LIMITS.ru);
  });

  it("выход за пределы разрешённого — свой текст, а не текст «в пределах»", () => {
    const res = ok(read({ operation: operation({ fulfilment: fulfilment({ scopeCheck: "EXCEEDS_AUTHORIZATION" }) }) }));
    expect(res.fulfilment.scope_check).toBe("EXCEEDS_AUTHORIZATION");
    expect(res.fulfilment.scope_text).toBe(texts.scope.SCOPE_EXCEEDS_AUTHORIZATION.ru);
    expect(res.fulfilment.scope_text).not.toBe(texts.scope.WITHIN_LIMITS.ru);
  });

  it("значение Платформы вне перечня — текст «не опознано», а само значение уходит как есть", () => {
    // Ветвь, которая без этого случая была принята без единого красного (находка ревью К2 № 4): подлог запасного кода
    // на `WITHIN_LIMITS` остался бы зелёным, а человек по неопознанному значению читал бы «в пределах поручения» —
    // ровно догадку, которую запрещают инвариант 6 и П36 п. 5.
    const res = ok(read({ operation: operation({ fulfilment: fulfilment({ scopeCheck: { other: "WEIRD_CODE" } }) }) }));
    expect(res.fulfilment.scope_check).toEqual({ other: "WEIRD_CODE" });
    expect(res.fulfilment.scope_text).toBe(texts.scope.SCOPE_CHECK_UNRECOGNIZED.ru);
    expect(res.fulfilment.scope_text).not.toBe(texts.scope.WITHIN_LIMITS.ru);
    // Значение Платформы не по форме кода (`null` у ядра) — тот же текст: ближайшее известное не подставляется.
    const nulled = ok(read({ operation: operation({ fulfilment: fulfilment({ scopeCheck: { other: null } }) }) }));
    expect(nulled.fulfilment.scope_check).toEqual({ other: null });
    expect(nulled.fulfilment.scope_text).toBe(texts.scope.SCOPE_CHECK_UNRECOGNIZED.ru);
  });

  it("класс уведомления ядра не из перечня классов проверки — «не опознано», а не «в пределах»", () => {
    // Ветвь недостижима через `scopeNotice` (ядро по записи об исполнении отвечает только кодами `SCOPE_*`), поэтому
    // проверяется **названная функция** сопоставления, а не сборка текста целиком (находка ревью К2 № 4): иначе подлог
    // запасного кода на `WITHIN_LIMITS` остаётся зелёным.
    expect(scopeCodeOfNotice(null)).toBe("WITHIN_LIMITS");
    expect(scopeCodeOfNotice("SCOPE_EXCEEDS_AUTHORIZATION")).toBe("SCOPE_EXCEEDS_AUTHORIZATION");
    expect(scopeCodeOfNotice("SCOPE_CHECK_UNRECOGNIZED")).toBe("SCOPE_CHECK_UNRECOGNIZED");
    const alien: PurchaseNotice = "OPERATION_SETTLED_LATE";
    expect(scopeCodeOfNotice(alien)).toBe("SCOPE_CHECK_UNRECOGNIZED");
    expect(scopeCodeOfNotice(alien)).not.toBe("WITHIN_LIMITS");
  });

  it("сумма не зарезервирована — свой текст; на языке запроса", () => {
    const res = ok(read({ operation: operation({ fulfilment: fulfilment({ scopeCheck: "NOT_RESERVED" }) }) }), deps({ lang: "en" }));
    expect(res.fulfilment.scope_text).toBe(texts.scope.SCOPE_NOT_RESERVED.en);
  });
});

describe("К2: исход операции — текст человеку свой, причина Платформы наружу не идёт", () => {
  it("отказ **в том виде, в каком его отдаёт ядро** (записи об исполнении нет) — причина наружу, строки Платформы нет", () => {
    // Прежний случай собирал отказ из `SETTLED`-операции с чужой записью об исполнении — такой операции у ядра не
    // бывает, и зелёный на ней подтверждал не то, что написано в названии (находка ревью К2 № 2). Текст отказа
    // человеку станет достижим кирпичом **К2а** под Р-1695: там `fulfilment` становится нулевым, и тело § 5.8
    // собирается и без записи об исполнении.
    const body = orderBody(
      read({ operation: unsettled({ status: "DECLINED", declineReason: "INSUFFICIENT_FUNDS: no money" }), state: "STOPPED" }),
      deps(),
    );
    expect(body.ok).toBe(false);
    if (body.ok) throw new Error("ожидалась причина");
    expect(body.reason).toBe("FULFILMENT_ABSENT");
    // Строка Платформы не уходит наружу ни в каком виде — ни в теле, ни в причине (инвариант 4, правило 3).
    expect(JSON.stringify(body)).not.toContain("INSUFFICIENT_FUNDS");
  });

  it("текст отказа берётся из `config/` по статусу, а не из строки Платформы", () => {
    // Пока тело § 5.8 требует записи об исполнении, достижим только текст — он и проверяется, значением из файла.
    expect(texts.outcomes.DECLINED.ru).not.toContain("INSUFFICIENT_FUNDS");
    expect(texts.outcomes.DECLINED.ru).not.toBe(texts.outcomes.REVERSED.ru);
  });

  it("расчёт прошёл — `decline_text` пуст, возврата нет", () => {
    expect(ok().operation.decline_text).toBeNull();
    expect(ok().refund).toBeNull();
  });

  it("возврат — текст говорит, что предел поручения не восстановлен (РП71 п. 6)", () => {
    const res = ok(read({ operation: operation({ status: "REFUNDED" }) }));
    expect(res.refund).toEqual({ status: "REFUNDED", text: texts.outcomes.REFUNDED.ru });
    expect(res.refund?.text).toMatch(/не восстановлен/);
  });
});

describe("К2: чего в прочитанном нет, то не придумывается", () => {
  it("записи об исполнении нет — причина наружу вместе с источником и временем сверки", () => {
    const body = orderBody(read({ operation: unsettled(), state: "SETTLING" }), deps());
    expect(body.ok).toBe(false);
    if (body.ok) throw new Error("ожидалась причина");
    expect(body.reason).toBe("FULFILMENT_ABSENT");
    expect(body.source.text).toBe(texts.sources.PLATFORM_OPERATION.ru);
    expect(body.source.checked_at).toBe(CHECKED_AT);
  });

  it("суммы операции нет — причина наружу, а не сумма записи об исполнении вместо неё", () => {
    const body = orderBody(read({ operation: operation({ amount: null }) }), deps());
    expect(body.ok).toBe(false);
    if (body.ok) throw new Error("ожидалась причина");
    expect(body.reason).toBe("OPERATION_AMOUNT_ABSENT");
    // Подстановка суммы записи об исполнении вместо суммы операции была бы догадкой — её нет.
    expect(JSON.stringify(body)).not.toContain("36150");
  });
});
