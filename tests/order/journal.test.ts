// Н-3, К3 — исход итога в журнал покупки (постановка Н-3, П36).
// Фикстура общая (`./fixture.js`): моменты и суммы разные, поэтому подмена поля в записи не может остаться зелёной.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { orderBody, type OrderBodyDeps } from "../../src/order/response.js";
import { recordOrderShown, scopeDetailOf, type OrderJournalEntry } from "../../src/order/journal.js";
import { parseOrderTexts, scopeTextOf, type OrderTexts } from "../../src/order/texts.js";
import type { OrderRead, ShellText } from "../../src/order/port.js";
import { hitsForbidden } from "../support/forbidden-fields.js";
import { CHECKED_AT, fulfilment, operation, read, unsettled } from "./fixture.js";

const texts: OrderTexts = parseOrderTexts(
  JSON.parse(readFileSync(new URL("../../config/order.default.json", import.meta.url), "utf8")),
);

const shell: ShellText = { notSpent: () => "не списано", done: () => "сделано" };
const deps: OrderBodyDeps = { lang: "ru", texts, shell };

/** Время записи — **своё**, не равное ни времени чтения, ни времени записи Платформы, ни времени `verify`. */
const WRITTEN_AT = "2026-11-21T20:15:03.000Z";

const written = (r: OrderRead = read()): readonly OrderJournalEntry[] => {
  const log: OrderJournalEntry[] = [];
  recordOrderShown(r, orderBody(r, deps), { journal: { write: (e) => log.push(e) }, now: () => WRITTEN_AT });
  return log;
};

const one = (r: OrderRead = read()): OrderJournalEntry => {
  const log = written(r);
  expect(log.length).toBe(1);
  return log[0] as OrderJournalEntry;
};

/** Все ключи записи, включая вложенные: страж инварианта 1 должен переживать появление вложенного поля (находка
 *  ревью К3 № 10). */
const allKeys = (value: unknown, out: string[] = []): readonly string[] => {
  if (value === null || typeof value !== "object") return out;
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out.push(k);
    allKeys(v, out);
  }
  return out;
};

describe("К3: исход отданного итога уходит в журнал покупки", () => {
  it("запись — ровно та, что описана: строгая сверка с готовым объектом целиком", () => {
    // `toStrictEqual`, а не `toEqual` (находка ревью К3 № 9): иначе пропавшее поле и поле со значением `undefined`
    // считаются равными, и находка № 3 про `undefined` осталась бы непроверяемой.
    expect(one()).toStrictEqual({
      event: "order.answered",
      purchase_id: "pur_2255",
      op_ref: "op_5512",
      state: "DONE",
      status: "SETTLED",
      scope: "WITHIN_LIMITS",
      reason: null,
      source: "PLATFORM_FULFILMENT",
      shown: one().shown,
      checked_at: "2026-11-21T20:15:00.000Z",
      at: "2026-11-21T20:15:03.000Z",
    });
  });

  it("покупка и операция — разные идентификаторы, и покупка берётся из прочитанного", () => {
    const e = one();
    expect(e.purchase_id).toBe("pur_2255");
    expect(e.op_ref).toBe("op_5512");
    expect(e.op_ref).not.toBe(e.purchase_id);
    // Другое чтение — другая покупка: подстановка чужого идентификатора краснеет здесь (находка ревью К3 № 7).
    expect(one(read({ purchase_id: "pur_9077" })).purchase_id).toBe("pur_9077");
  });

  it("состояние в записи — **показанное**: по нему человеку сказали «оплачено» или «ждём итога»", () => {
    const r = read({ operation: unsettled(), state: "SETTLING" });
    expect(one(r).state).toBe(orderBody(r, deps).state);
    expect(one(r).state).toBe("SETTLING");
    expect(one().state).toBe("DONE");
  });

  it("хэш показанного привязывает запись к величинам ответа: другое тело — другой хэш", () => {
    const other = read({ operation: operation({ fulfilment: fulfilment({ finalAmount: { amount: 36_000, currency: "RUB" } }) }) });
    expect(one().shown).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(one(other).shown).not.toBe(one().shown);
  });

  it("время записи — своё: это не время чтения и не время записи Платформы", () => {
    const e = one();
    expect(e.at).toBe(WRITTEN_AT);
    expect(e.checked_at).toBe(CHECKED_AT);
    expect(e.at).not.toBe(e.checked_at);
    expect(e.at).not.toBe("2026-11-21T18:05:00.000Z");
  });

  it("время сверки в записи — то же, что человек увидел в «проверено»", () => {
    const r = read({ checked_at: "2026-11-22T06:00:00.000Z" });
    expect(one(r).checked_at).toBe(orderBody(r, deps).source.checked_at);
  });

  it("причина и статус берутся из собранного ответа, а не выводятся заново", () => {
    const r = read({ operation: unsettled(), state: "SETTLING" });
    const body = orderBody(r, deps);
    const e = one(r);
    expect(e.reason).toBe(body.reason);
    expect(e.reason).toBe("FULFILMENT_ABSENT");
    expect(e.status).toBe(body.operation.status);
    expect(e.scope).toBeNull();
  });

  it("код источника в записи согласован с **показанным текстом** источника", () => {
    // Связь записи с показанным: текст в теле обязан быть текстом того кода, который лёг в журнал (находка ревью
    // К3 № 2). Иначе человек видел бы один источник, а журнал писал другой, и это не краснело бы.
    for (const r of [read(), read({ operation: unsettled(), state: "SETTLING" })]) {
      const e = one(r);
      expect(orderBody(r, deps).source.text).toBe(texts.sources[e.source].ru);
    }
    expect(one(read({ operation: unsettled(), state: "SETTLING" })).source).toBe("PLATFORM_OPERATION");
  });

  it("класс проверки в записи согласован с **показанным текстом** класса", () => {
    const r = read({ operation: operation({ fulfilment: fulfilment({ scopeCheck: "NOT_RESERVED" }) }) });
    const e = one(r);
    expect(e.scope).toBe("NOT_RESERVED");
    // Текст на экране — текст того же класса, через `scopeTextOf` (ru у ядра, Р-1696).
    expect(orderBody(r, deps).fulfilment?.scope_text).toBe(scopeTextOf("SCOPE_NOT_RESERVED", texts, "ru"));
  });

  it("значение Платформы вне перечня идёт в журнал классом `OTHER`, а не самим значением", () => {
    // Так пишет ядро (`operation.settled`): значение показывается человеку как есть, а в журнал — класс (инвариант 5
    // ядра). Само значение в записи искать нечего — иначе в журнале появился бы текст внешней стороны.
    const e = one(read({ operation: operation({ fulfilment: fulfilment({ scopeCheck: { other: "WEIRD_CODE" } }) }) }));
    expect(e.scope).toBe("OTHER");
    expect(JSON.stringify(e)).not.toContain("WEIRD_CODE");
  });

  it("к компиляции не сводится: объектное значение даёт `OTHER`, известная строка — свой класс", () => {
    // Случай закрывает то, чего не держит ветвь `never` (кирпич К3в, **Р-1702**): разбор формы значения в рантайме.
    // Постоянной фикстуры-поломки с подменой перечня в ядре здесь **нет намеренно** — она не воспроизводится у
    // другого и сносится при `npm ci`; гарантию на расширение перечня даёт компиляция, шаг воспроизведения назван в
    // строке кирпича.
    const other = read({ operation: operation({ fulfilment: fulfilment({ scopeCheck: { other: "WEIRD_CODE" } }) }) });
    expect(scopeDetailOf(other)).toBe("OTHER");
    const known = read({ operation: operation({ fulfilment: fulfilment({ scopeCheck: "EXCEEDS_AUTHORIZATION" }) }) });
    expect(scopeDetailOf(known)).toBe("EXCEEDS_AUTHORIZATION");
    expect(scopeDetailOf(known)).not.toBe("OTHER");
  });

  it("значение не по форме кода и пропавшее значение — тот же класс `OTHER`, а не пустое поле", () => {
    expect(scopeDetailOf(read({ operation: operation({ fulfilment: fulfilment({ scopeCheck: { other: null } }) }) }))).toBe("OTHER");
    // Ключа `scopeCheck` может не быть вовсе: порт собирает операцию из разобранного ответа ПАО (находка ревью
    // К3 № 3). Ядро в этом случае пишет `OTHER`, и приложение повторяет форму целиком.
    const broken = read({
      operation: operation({ fulfilment: { ...fulfilment(), scopeCheck: undefined as unknown as "WITHIN_LIMITS" } }),
    });
    expect(scopeDetailOf(broken)).toBe("OTHER");
  });

  it("известные классы идут в журнал как есть", () => {
    for (const scopeCheck of ["WITHIN_LIMITS", "EXCEEDS_AUTHORIZATION", "NOT_RESERVED"] as const) {
      const e = one(read({ operation: operation({ fulfilment: fulfilment({ scopeCheck }) }) }));
      expect(e.scope, scopeCheck).toBe(scopeCheck);
    }
  });

  it("текстов человеку в записи нет: по коду они восстановимы, а два источника расходятся", () => {
    const e = one(read({ operation: unsettled(), state: "SETTLING" }));
    const json = JSON.stringify(e);
    expect(json).not.toContain(texts.reasons.FULFILMENT_ABSENT.ru);
    expect(json).not.toContain(texts.sources.PLATFORM_OPERATION.ru);
    expect(json).not.toContain(texts.scope_within.ru);
  });

  it("имена полей записи — включая вложенные — не похожи на реквизиты (инвариант 1)", () => {
    const keys = allKeys(one());
    expect(keys.length).toBeGreaterThan(5);
    for (const name of keys) expect(hitsForbidden(name), name).toBe(false);
  });

  it("на один отданный итог — одна запись", () => {
    expect(written().length).toBe(1);
  });
});
