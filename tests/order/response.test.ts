// Н-3, К2 и К2а — тело итога § 5.8 собирается по исходу чтения покупки (правило 4 К-Б, П31, П36; К-Б v1.4, Р-1695).
// Тексты — из `config/order.default.json`, того же файла, что в работе (Р-1511); русский текст класса проверки
// клиринга — **у ядра** (Р-1696), и тест берёт его оттуда же, откуда берёт код.
// Фикстура — общая (`./fixture.js`), одна на случаи К1 и К2 (находка ревью К2 № 7).
import { describe, expect, it } from "vitest";
import { absenceReasonOf, absenceTextOf, orderBody, scopeCodeOfNotice, type OrderBodyDeps } from "../../src/order/response.js";
import { scopeTextOf } from "../../src/order/texts.js";
import type { OrderRead } from "../../src/order/port.js";
import {
  ORDER_ABSENCE_REASONS,
  type OrderAbsenceReason,
  type UiFeedEvent,
} from "../../src/contract/ui-v1/methods.js";
// Тексты, заглушка каркаса и зависимости — из **общей** фикстуры модуля (находка ревью К4 № 6: две копии уже
// разошлись, и в одной сумма печаталась без валюты).
import { CHECKED_AT, deps, fulfilment, operation, read, STOPPED_AT, texts, unsettled } from "./fixture.js";
import { AGENT_DIAG } from "agentic-buyer-ref/src/agent/declines/registry.js";
import type { PurchaseNotice } from "agentic-buyer-ref/src/agent/ports/shop.js";

const body = (r = read(), d: OrderBodyDeps = deps()) => orderBody(r, d);

describe("К2: тело § 5.8 — из прочитанного", () => {
  it("ответ собран из прочитанного целиком — сверка с готовым телом, а не со второй сборкой", () => {
    // Ожидание — **готовый объект**, а не повторный вызов той же сборки (находка ревью К2 № 3): повторный вызов был бы
    // зелёным у любой чистой функции, в том числе у той, которая читает событие из общего места.
    expect(body()).toEqual({
      state: "DONE",
      step: "U7",
      operation: { status: "SETTLED", amount: { amount: 36_800, currency: "RUB" }, decline_text: null },
      fulfilment: {
        final: { amount: 36_150, currency: "RUB" },
        scope_check: "WITHIN_LIMITS",
        scope_text: "В пределах поручения",
        // Значение показано — пары непоказа нет (Р-1707, кирпич К4а).
        withheld: null,
        withheld_text: null,
        spent_position: { amount: 41_200, currency: "RUB" },
        at: "2026-11-21T18:05:00.000Z",
      },
      reason: null,
      reason_text: null,
      source: { text: texts.sources.PLATFORM_FULFILMENT.ru, checked_at: "2026-11-21T20:15:00.000Z" },
      done_line: { done: "«сделано DONE на ru»", not_spent: "«не списано 63200 RUB на ru»" },
      refund: null,
      stops: [],
      agent_fee: { amount: { amount: 1, currency: "RUB" }, text: "Цена агента — 1 копейка" },
      act: { id: "act_4471", card_url: "/ui/v1/act/act_4471?view=card" },
    });
  });

  it("`spent_position` не пересчитывается: это не сумма операции и не сумма списания и не их сложение", () => {
    const res = body();
    expect(res.fulfilment?.spent_position.amount).toBe(41_200);
    expect(res.fulfilment?.spent_position.amount).not.toBe(res.operation.amount?.amount);
    expect(res.fulfilment?.spent_position.amount).not.toBe(res.fulfilment?.final.amount);
    // Сложение дало бы 72 950 — своего сложения в сборке нет (инвариант 6 ядра).
    expect(res.fulfilment?.spent_position.amount).not.toBe(36_800 + 36_150);
  });

  it("`not_spent` — остаток поручения из `verify`, а не разница «поручение − списано»", () => {
    expect(body().done_line.not_spent).toBe("«не списано 63200 RUB на ru»");
    // Разница одобренного и списанного — 650; её в строке нет и быть не может.
    expect(body().done_line.not_spent).not.toContain("650");
  });

  it("`done` — по состоянию **прочитанного**: другое чтение даёт другую строку", () => {
    expect(body().done_line.done).toBe("«сделано DONE на ru»");
    expect(body(read({ state: "SETTLING" })).done_line.done).toBe("«сделано SETTLING на ru»");
  });

  it("шаг экрана — таблицей контракта по состоянию прочитанного, и линии пути числами в теле нет", () => {
    expect(body().step).toBe("U7");
    expect(body(read({ state: "SETTLING" })).step).toBe("U7");
    // Обёртки `path` в теле нет (решение владельца 22.11.2026): числа для шагов использования не из источника
    // (Р-1601, Р-1511), документ правится выпуском v1.5. Случай держит отсутствие: вернётся выдуманное число —
    // покраснеет и он, и полная сверка тела выше.
    expect(Object.keys(body())).not.toContain("path");
  });

  it("цена агента и акт переложены из прочитанного, а не придуманы (Р-1691)", () => {
    expect(body().agent_fee).toEqual({ amount: { amount: 1, currency: "RUB" }, text: "Цена агента — 1 копейка" });
    const other = body(
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
    expect(body(read({ stops: [stop] })).stops).toEqual([stop]);
    expect(body().stops).toEqual([]);
  });
});

describe("К2: событие потока — только сигнал", () => {
  it("события в сборке нет вовсе: подменить ответ событием нечем", () => {
    // Проверку держит **компилятор** (`tsc` в `npm run check` и в CI): третьего параметра у сборки нет (правило 4 К-Б,
    // П31). Заполняющих `expect` здесь нет намеренно (находка ревью К2 № 10).
    const event: UiFeedEvent = { event_id: "evt_3091", purchase_id: "pur_2255", kind: "STATE", at: "2026-11-21T20:16:00.000Z" };
    const compileOnly = (): void => {
      // @ts-expect-error — событие в сборку тела не передаётся: истина берётся чтением
      void orderBody(read(), deps(), event);
    };
    void compileOnly;
    expect(body().reason).toBeNull();
  });

  it("другое чтение — другое тело: ответ идёт за чтением, а не за сигналом", () => {
    const later = body(
      read({
        checked_at: "2026-11-22T06:00:00.000Z",
        operation: operation({ fulfilment: fulfilment({ finalAmount: { amount: 36_000, currency: "RUB" } }) }),
      }),
    );
    expect(later.source.checked_at).toBe("2026-11-22T06:00:00.000Z");
    expect(later.fulfilment?.final.amount).toBe(36_000);
  });
});

describe("К2а: класс проверки клиринга — у ядра, и текст того же класса тоже (Р-1696)", () => {
  it("`WITHIN_LIMITS` — свой текст парами ru/en: кода у ядра для этого случая нет", () => {
    expect(body().fulfilment?.scope_text).toBe(texts.scope_within.ru);
    expect(body(read(), deps({ lang: "en" })).fulfilment?.scope_text).toBe(texts.scope_within.en);
  });

  it("русский текст класса — **строка реестра ядра**, а не своя копия в `config/`", () => {
    const res = body(read({ operation: operation({ fulfilment: fulfilment({ scopeCheck: "EXCEEDS_AUTHORIZATION" }) }) }));
    expect(res.fulfilment?.scope_check).toBe("EXCEEDS_AUTHORIZATION");
    expect(res.fulfilment?.scope_text).toBe(AGENT_DIAG.SCOPE_EXCEEDS_AUTHORIZATION.human.ru);
    // И это не текст «в пределах»: класс читается, а не подменяется.
    expect(res.fulfilment?.scope_text).not.toBe(texts.scope_within.ru);
  });

  it("английский текст класса — своя пара из `config/`, у реестра ядра её нет", () => {
    const res = body(
      read({ operation: operation({ fulfilment: fulfilment({ scopeCheck: "NOT_RESERVED" }) }) }),
      deps({ lang: "en" }),
    );
    expect(res.fulfilment?.scope_text).toBe(texts.scope_en.SCOPE_NOT_RESERVED);
    expect(res.fulfilment?.scope_text).not.toBe(AGENT_DIAG.SCOPE_NOT_RESERVED.human.ru);
  });

  it("значение Платформы вне перечня — текст «не распознал» от ядра, а само значение уходит как есть", () => {
    // Ветвь, которая без этого случая была принята без единого красного (находка ревью К2 № 4).
    const res = body(read({ operation: operation({ fulfilment: fulfilment({ scopeCheck: { other: "WEIRD_CODE" } }) }) }));
    expect(res.fulfilment?.scope_check).toEqual({ other: "WEIRD_CODE" });
    expect(res.fulfilment?.scope_text).toBe(AGENT_DIAG.SCOPE_CHECK_UNRECOGNIZED.human.ru);
    expect(res.fulfilment?.scope_text).not.toBe(texts.scope_within.ru);
    // Значение не по форме кода (`null` у ядра) — тот же класс: ближайшее известное не подставляется.
    const nulled = body(read({ operation: operation({ fulfilment: fulfilment({ scopeCheck: { other: null } }) }) }));
    expect(nulled.fulfilment?.scope_check).toEqual({ other: null });
    expect(nulled.fulfilment?.scope_text).toBe(AGENT_DIAG.SCOPE_CHECK_UNRECOGNIZED.human.ru);
  });

  it("класс уведомления ядра не из перечня классов проверки — «не опознано», а не «в пределах»", () => {
    // Ветвь недостижима через `scopeNotice`, поэтому проверяется **названная функция** сопоставления (находка ревью
    // К2 № 4): иначе подлог запасного кода на `WITHIN_LIMITS` остаётся зелёным.
    expect(scopeCodeOfNotice(null)).toBe("WITHIN_LIMITS");
    expect(scopeCodeOfNotice("SCOPE_EXCEEDS_AUTHORIZATION")).toBe("SCOPE_EXCEEDS_AUTHORIZATION");
    expect(scopeCodeOfNotice("SCOPE_CHECK_UNRECOGNIZED")).toBe("SCOPE_CHECK_UNRECOGNIZED");
    const alien: PurchaseNotice = "OPERATION_SETTLED_LATE";
    expect(scopeCodeOfNotice(alien)).toBe("SCOPE_CHECK_UNRECOGNIZED");
    expect(scopeCodeOfNotice(alien)).not.toBe("WITHIN_LIMITS");
    // И текст у этого класса — тоже ядра, на ru.
    expect(scopeTextOf(scopeCodeOfNotice(alien), texts, "ru")).toBe(AGENT_DIAG.SCOPE_CHECK_UNRECOGNIZED.human.ru);
  });
});

describe("К2: исход операции — текст человеку свой, причина Платформы наружу не идёт", () => {
  it("отказ достижим: тело собирается и без записи об исполнении, с текстом отказа (Р-1695)", () => {
    // До Р-1695 этот случай был недостижим вовсе: у ядра `fulfilment` равен `null` при `DECLINED`, а тело § 5.8
    // требовало записи — тексты отказа лежали в `config/` без пути к человеку (находка ревью К2 № 1).
    const res = body(
      read({ operation: unsettled({ status: "DECLINED", declineReason: "INSUFFICIENT_FUNDS: no money" }), state: "STOPPED" }),
    );
    expect(res.operation.decline_text).toBe(texts.outcomes.DECLINED.ru);
    expect(res.fulfilment).toBeNull();
    expect(res.reason).toBe("FULFILMENT_ABSENT");
    // Строка Платформы не уходит наружу ни в каком виде (инвариант 4, правило 3).
    expect(JSON.stringify(res)).not.toContain("INSUFFICIENT_FUNDS");
  });

  it("отмена оплаты показывается тем же полем и своим текстом, не текстом отказа", () => {
    const res = body(read({ operation: unsettled({ status: "REVERSED" }), state: "STOPPED" }));
    expect(res.operation.decline_text).toBe(texts.outcomes.REVERSED.ru);
    expect(res.operation.decline_text).not.toBe(texts.outcomes.DECLINED.ru);
  });

  it("расчёт прошёл — `decline_text` пуст, возврата нет", () => {
    expect(body().operation.decline_text).toBeNull();
    expect(body().refund).toBeNull();
  });

  it("возврат — текст говорит, что предел поручения не восстановлен (РП71 п. 6)", () => {
    const res = body(read({ operation: operation({ status: "REFUNDED" }) }));
    expect(res.refund).toEqual({ status: "REFUNDED", text: texts.outcomes.REFUNDED.ru });
    expect(res.refund?.text).toMatch(/не восстановлен/);
  });
});

describe("К2а: итога ещё нет — это состояние, а не отказ (Р-1695)", () => {
  it("записи об исполнении нет — `fulfilment` нулевой, рядом причина, источник и время сверки на месте", () => {
    const res = body(read({ operation: unsettled(), state: "SETTLING" }));
    expect(res.fulfilment).toBeNull();
    expect(res.reason).toBe("FULFILMENT_ABSENT");
    expect(res.source.text).toBe(texts.sources.PLATFORM_OPERATION.ru);
    expect(res.source.checked_at).toBe(CHECKED_AT);
    // Человеку говорят не «ничего нет», а что именно: текст причины — из `config/` парами ru/en.
    expect(absenceTextOf(res.reason, deps())).toBe(texts.reasons.FULFILMENT_ABSENT.ru);
    expect(absenceTextOf(res.reason, deps({ lang: "en" }))).toBe(texts.reasons.FULFILMENT_ABSENT.en);
    // Строка «что уже сделано» есть и здесь — по состоянию прочитанного.
    expect(res.done_line.done).toBe("«сделано SETTLING на ru»");
  });

  it("запись об исполнении не придумывается: нулей и подстановок вместо неё нет", () => {
    const res = body(read({ operation: unsettled(), state: "SETTLING" }));
    // Ни пустой записи, ни суммы операции вместо суммы списания, ни «в пределах поручения» по умолчанию.
    expect(res.fulfilment).toBeNull();
    expect(JSON.stringify(res)).not.toContain("36150");
    expect(JSON.stringify(res)).not.toContain(texts.scope_within.ru);
  });

  it("суммы операции нет — `amount` нулевой, причина своя, сумма записи об исполнении не подставляется", () => {
    const res = body(read({ operation: operation({ amount: null }) }));
    expect(res.operation.amount).toBeNull();
    expect(res.reason).toBe("OPERATION_AMOUNT_ABSENT");
    expect(absenceTextOf(res.reason, deps())).toBe(texts.reasons.OPERATION_AMOUNT_ABSENT.ru);
    // Запись об исполнении при этом прочитана и показывается как есть.
    expect(res.fulfilment?.final).toEqual({ amount: 36_150, currency: "RUB" });
  });

  it("причина — закрытый перечень и порядок проверки назван: нет записи важнее, чем нет суммы", () => {
    expect(absenceReasonOf(operation())).toBeNull();
    expect(absenceReasonOf(unsettled())).toBe("FULFILMENT_ABSENT");
    expect(absenceReasonOf(operation({ amount: null }))).toBe("OPERATION_AMOUNT_ABSENT");
    // Нет ни записи, ни суммы — причина о записи: без неё итога нет вовсе.
    expect(absenceReasonOf(unsettled({ amount: null }))).toBe("FULFILMENT_ABSENT");
  });

  it("при полном теле причины нет — ни кода, ни текста", () => {
    expect(body().reason).toBeNull();
    expect(body().reason_text).toBeNull();
    expect(absenceTextOf(body().reason, deps())).toBeNull();
  });
});

describe("К3а: текст причины лежит в том же теле, рядом с кодом (Р-1697)", () => {
  it("записи об исполнении нет — в теле и код, и непустой готовый текст", () => {
    const res = body(read({ operation: unsettled(), state: "SETTLING" }));
    expect(res.reason).toBe("FULFILMENT_ABSENT");
    expect(res.reason_text).toBeTruthy();
    // Текст сверяется **с источником** (`config/order.default.json` через разбор), а не с литералом в тесте (Р-1511).
    expect(res.reason_text).toBe(texts.reasons.FULFILMENT_ABSENT.ru);
    // И это именно готовый текст, а не код: экрану склеивать нечего (правило 3).
    expect(res.reason_text).not.toBe(res.reason);
  });

  it("суммы операции нет — свой текст, не текст про запись об исполнении", () => {
    const res = body(read({ operation: operation({ amount: null }) }));
    expect(res.reason).toBe("OPERATION_AMOUNT_ABSENT");
    expect(res.reason_text).toBe(texts.reasons.OPERATION_AMOUNT_ABSENT.ru);
    expect(res.reason_text).not.toBe(texts.reasons.FULFILMENT_ABSENT.ru);
  });

  it("текст причины — на языке запроса", () => {
    const res = body(read({ operation: unsettled(), state: "SETTLING" }), deps({ lang: "en" }));
    expect(res.reason_text).toBe(texts.reasons.FULFILMENT_ABSENT.en);
  });

  it("код и текст согласованы на **всём** закрытом перечне причин: текст есть ровно тогда, когда есть код", () => {
    // Перебор идёт по перечню из источника (`ORDER_ABSENCE_REASONS`), а не по рукописному списку чтений (находка
    // ревью К3а № 4): добавится причина — таблица чтений станет неполной, и это покраснеет здесь, а не останется
    // зелёным под прежним названием.
    const readingFor: Readonly<Record<OrderAbsenceReason, OrderRead>> = {
      FULFILMENT_ABSENT: read({ operation: unsettled(), state: "SETTLING" }),
      OPERATION_AMOUNT_ABSENT: read({ operation: operation({ amount: null }) }),
    };
    expect(Object.keys(readingFor).slice().sort()).toEqual([...ORDER_ABSENCE_REASONS].slice().sort());
    for (const reason of ORDER_ABSENCE_REASONS) {
      const res = body(readingFor[reason]);
      expect(res.reason, reason).toBe(reason);
      expect(res.reason_text, reason).toBe(texts.reasons[reason].ru);
    }
    // И обратная сторона согласия: нет кода — нет и текста.
    const full = body();
    expect(full.reason).toBeNull();
    expect(full.reason_text).toBeNull();
  });
});
