// Н-3, К4 — тесты по пунктам постановки: приёмка задачи целиком.
//
// Кирпичи К1–К3в проверяли каждый свою правку; здесь проверяются **обещания постановки** — на матрице состояний,
// исходов операции и **двух языков**, а не на одном удобном случае (находка ревью К4 № 12). Шесть пунктов постановки:
// источник и `checked_at` у каждой записи итога; итог не собирается из события; неопознанное значение даёт `other` и
// текст, а не ближайшее известное; `spent_position` не пересчитывается; деньги только парой; инвариант 1 по именам
// полей ответа.
//
// Перечни и фильтры берутся **из источника** (Р-1511): состояния шага У7 — из `PURCHASE_STATES` ядра через
// `stepOfState`, запрещённые имена — из `tests/support/forbidden-fields.ts`, похожее на номер карты — фильтром
// приложения `hasCardNumber` (R41), строка, похожая на номер, — генератором `tests/support/card-like.ts` (в файлы не
// пишется; хук `guard.py` без оговорок, Р-1699). Своих вторых перечней и своих регулярок здесь нет.
import { describe, expect, it } from "vitest";
import { PURCHASE_STATES } from "agentic-buyer-ref/src/agent/pipeline/machine.js";
import { AGENT_DIAG } from "agentic-buyer-ref/src/agent/declines/registry.js";
import { orderBody } from "../../src/order/response.js";
import { recordOrderShown, type OrderJournalEntry } from "../../src/order/journal.js";
import { SCOPE_CORE_CODES, scopeTextOf, SOURCE_CODES } from "../../src/order/texts.js";
import { stepOfState } from "../../src/contract/ui-v1/steps.js";
import type { UiFeedEvent, UiFeedKind } from "../../src/contract/ui-v1/methods.js";
import type { UiLang, UiMoney } from "../../src/contract/ui-v1/common.js";
import { ALLOWED_EXAMPLES, FORBIDDEN_EXAMPLES, hitsForbidden } from "../support/forbidden-fields.js";
import { hasCardNumber } from "../../src/pult/engine.js";
import { cardLikeNumber } from "../support/card-like.js";
import { deps, fulfilment, operation, read, texts, unsettled } from "./fixture.js";

/** Состояния, которые приводят человека на шаг итога У7: именно на них метод § 5.8 и вызывается. */
const U7_STATES = PURCHASE_STATES.filter((s) => stepOfState(s) === "U7");

/** Исходы операции в том виде, в каком их отдаёт ядро: с записью об исполнении, без неё, отказ без неё, без суммы. */
const OPERATIONS = [
  operation(),
  unsettled(),
  unsettled({ status: "DECLINED", declineReason: "INSUFFICIENT_FUNDS" }),
  // Сумма не пришла, но запись об исполнении есть — такое у ядра бывает (ПАО 1.4.0).
  operation({ amount: null }),
] as const;

const LANGS: readonly UiLang[] = ["ru", "en"];

/** Все пары «ключ → значение» тела, включая вложенные и внутри массивов. */
const walk = (
  value: unknown,
  path: string,
  out: { key: string; path: string; value: unknown }[] = [],
): readonly { key: string; path: string; value: unknown }[] => {
  if (value === null || typeof value !== "object") return out;
  if (Array.isArray(value)) {
    value.forEach((v, i) => walk(v, `${path}[${String(i)}]`, out));
    return out;
  }
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out.push({ key: k, path: `${path}.${k}`, value: v });
    walk(v, `${path}.${k}`, out);
  }
  return out;
};

/** Просев имён полей: та же функция, которой проверяется тело, — её же показывают красной на подложном теле
 *  (находка ревью К4 № 4; приём `tests/onboarding/invariant1.test.ts`). */
const sieveNames = (body: unknown, where: string): void => {
  for (const e of walk(body, where))
    if (hitsForbidden(e.key)) throw new Error(`${e.path}: имя поля похоже на реквизит (${e.key})`);
};

const isMoney = (v: unknown): v is UiMoney => typeof v === "object" && v !== null && "amount" in v && "currency" in v;

describe("К4, пункт 1: источник и время сверки есть у каждой записи итога", () => {
  it("на **всех** состояниях шага У7, всех исходах операции и обоих языках", () => {
    expect(U7_STATES.length).toBeGreaterThan(1);
    for (const state of U7_STATES)
      for (const op of OPERATIONS)
        for (const lang of LANGS) {
          const body = orderBody(read({ state, operation: op }), deps({ lang }));
          const where = `${state}/${op.status}/${lang}`;
          expect(body.source.text, where).toBeTruthy();
          expect(body.source.checked_at, where).toBe("2026-11-21T20:15:00.000Z");
          // Текст источника — из закрытого перечня на языке запроса, а не произвольная строка.
          expect(SOURCE_CODES.map((c) => texts.sources[c][lang]), where).toContain(body.source.text);
        }
  });

  it("время сверки — из прочитанного: своё чтение даёт своё время на любом состоянии", () => {
    for (const state of U7_STATES) {
      const body = orderBody(read({ state, checked_at: "2026-11-22T07:30:00.000Z" }), deps());
      expect(body.source.checked_at, state).toBe("2026-11-22T07:30:00.000Z");
    }
  });
});

describe("К4, пункт 2: итог не собирается из события потока", () => {
  it("события в сборку передать нельзя — гарантию даёт компилятор", () => {
    // Прежняя редакция этого случая была зелёной **по построению** (находка ревью К4 № 1, блокер): она утверждала
    // что-то о самой фикстуре и сверяла сборку повторным её же вызовом, что постановка прямо запрещает. Проверку
    // держит `tsc` (в `npm run check` и в CI): у сборки два параметра, третьего нет, и событие остаётся снаружи.
    // Перечень `kind` закрыт компиляцией и применён там, где он что-то решает — в теле события ниже.
    const kinds: Readonly<Record<UiFeedKind, true>> = { STATE: true, STOP: true, VERDICT: true, MANDATE: true, CONFIRMATION: true };
    const compileOnly = (): void => {
      for (const kind of Object.keys(kinds) as UiFeedKind[]) {
        const event: UiFeedEvent = { event_id: `evt_${kind}`, purchase_id: "pur_2255", kind, at: "2026-11-21T20:16:00.000Z" };
        // @ts-expect-error — событие в сборку тела не передаётся: истина берётся чтением (правило 4 К-Б, П31)
        void orderBody(read(), deps(), event);
      }
    };
    void compileOnly;
    expect(Object.keys(kinds).length).toBe(5);
  });

  it("ответ идёт за **чтением**: новое чтение меняет тело целиком", () => {
    const before = orderBody(read(), deps());
    const after = orderBody(read({ operation: unsettled(), state: "SETTLING" }), deps());
    expect(after).not.toStrictEqual(before);
    expect(after.reason).toBe("FULFILMENT_ABSENT");
    expect(before.reason).toBeNull();
  });
});

describe("К4, пункт 3: неопознанное значение даёт `other` и текст, а не ближайшее известное", () => {
  it("текст — «не распознал» **строкой реестра ядра**, ближайшее известное не подставляется", () => {
    for (const other of ["WEIRD_CODE", "", "ОЧЕНЬ-ДЛИННОЕ-ЗНАЧЕНИЕ-ПЛАТФОРМЫ", null])
      for (const lang of LANGS) {
        const r = read({ operation: operation({ fulfilment: fulfilment({ scopeCheck: { other } }) }) });
        const body = orderBody(r, deps({ lang }));
        const where = `${String(other)}/${lang}`;
        expect(body.fulfilment?.scope_check, where).toEqual({ other });
        // Ожидание — значением из источника, а не повторным вызовом той же сборки (находка ревью К4 № 9): для ru это
        // строка реестра ядра, для en — своя пара из `config/` (Р-1696).
        const expected = lang === "ru" ? AGENT_DIAG.SCOPE_CHECK_UNRECOGNIZED.human.ru : texts.scope_en.SCOPE_CHECK_UNRECOGNIZED;
        expect(body.fulfilment?.scope_text, where).toBe(expected);
        for (const code of SCOPE_CORE_CODES.filter((c) => c !== "SCOPE_CHECK_UNRECOGNIZED"))
          expect(body.fulfilment?.scope_text, `${where}/${code}`).not.toBe(scopeTextOf(code, texts, lang));
        expect(body.fulfilment?.scope_text, where).not.toBe(texts.scope_within[lang]);
      }
  });

  it("значение, **похожее на номер карты**, в журнал не идёт: там класс `OTHER`", () => {
    // Показ такого значения человеку — **вопрос владельцу**, заданный в PR (§ 5.8 требует «как есть», инвариант 1
    // запрещает реквизиты на экране): до ответа тестом он не закрепляется. Здесь проверяется то, что от ответа не
    // зависит — журнал. Похожее на номер ищет фильтр приложения `hasCardNumber` (R41), своего второго фильтра нет
    // (находка ревью К4 № 5).
    const like = cardLikeNumber("7");
    expect(hasCardNumber(like)).toBe(true);
    const r = read({ operation: operation({ fulfilment: fulfilment({ scopeCheck: { other: like } }) }) });
    const log: OrderJournalEntry[] = [];
    recordOrderShown(r, orderBody(r, deps()), { journal: { write: (e) => log.push(e) }, now: () => "2026-11-21T20:15:03.000Z" });
    expect(log[0]?.scope).toBe("OTHER");
    expect(hasCardNumber(JSON.stringify(log[0]))).toBe(false);
  });
});

describe("К4, пункт 4: `spent_position` не пересчитывается", () => {
  it("на любых суммах положение по поручению равно прочитанному и не выводится из других величин", () => {
    // Четыре разных числа в каждом наборе (правило 16.11; находка ревью К4 № 8 — в одном наборе сумма операции и
    // сумма списания совпадали, и подмена одного поля другим не краснела).
    const cases: readonly { amount: number; final: number; spent: number }[] = [
      { amount: 36_800, final: 36_150, spent: 41_200 },
      { amount: 2, final: 1, spent: 999_999 },
      { amount: 500_000, final: 499_999, spent: 7 },
    ];
    for (const c of cases) {
      const r = read({
        operation: operation({
          amount: { amount: c.amount, currency: "RUB" },
          fulfilment: fulfilment({
            finalAmount: { amount: c.final, currency: "RUB" },
            spentPosition: { amount: c.spent, currency: "RUB" },
          }),
        }),
      });
      const body = orderBody(r, deps());
      expect(body.fulfilment?.spent_position).toEqual({ amount: c.spent, currency: "RUB" });
      for (const derived of [c.amount + c.final, c.amount - c.final, c.final, c.amount])
        if (derived !== c.spent) expect(body.fulfilment?.spent_position.amount).not.toBe(derived);
    }
  });

  it("остаток поручения в строке «не списано» тоже не считается: он из `verify`", () => {
    const body = orderBody(read({ intent: { ...read().intent, amount_left: { amount: 7_777, currency: "RUB" } } }), deps());
    expect(body.done_line.not_spent).toContain("7777");
  });
});

describe("К4, пункт 5: деньги только парой «минимальные единицы + валюта»", () => {
  it("каждая денежная величина тела — пара с целым числом и кодом ISO 4217", () => {
    for (const state of U7_STATES)
      for (const op of OPERATIONS) {
        const body = orderBody(read({ state, operation: op }), deps());
        const monies = walk(body, "body").filter((e) => isMoney(e.value));
        expect(monies.length, `${state}/${op.status}`).toBeGreaterThan(0);
        for (const m of monies) {
          const money = m.value as UiMoney;
          expect(Number.isInteger(money.amount), m.path).toBe(true);
          expect(money.amount, m.path).toBeGreaterThanOrEqual(0);
          expect(money.currency, m.path).toMatch(/^[A-Z]{3}$/);
        }
      }
  });

  it("знака валюты литералом в теле нет — на всей матрице, где тексты из `config/` не пусты", () => {
    for (const state of U7_STATES)
      for (const op of OPERATIONS)
        for (const lang of LANGS) {
          const json = JSON.stringify(orderBody(read({ state, operation: op }), deps({ lang })));
          for (const sign of ["₽", "$", "€", "руб."]) expect(json, `${state}/${op.status}/${lang}/${sign}`).not.toContain(sign);
        }
  });

  it("числа без валюты в денежных полях § 5.8 не бывает", () => {
    // Пути названы по контракту § 5.8: внутри самой пары ключ `amount` — это число, и перебор по имени ловил бы его же.
    const MONEY_PATHS = ["body.operation.amount", "body.fulfilment.final", "body.fulfilment.spent_position", "body.agent_fee.amount"];
    const all = walk(orderBody(read(), deps()), "body");
    for (const p of MONEY_PATHS) {
      const e = all.find((x) => x.path === p);
      expect(e, p).toBeDefined();
      expect(isMoney(e?.value), p).toBe(true);
    }
    // А когда сумма операции не пришла — это `null`, а не число без валюты (Р-1695).
    expect(orderBody(read({ operation: operation({ amount: null }) }), deps()).operation.amount).toBeNull();
  });
});

describe("К4, пункт 6: инвариант 1 по именам полей ответа", () => {
  it("ни одно имя поля тела — включая вложенные и в массивах — не похоже на реквизит", () => {
    for (const state of U7_STATES)
      for (const op of OPERATIONS)
        for (const lang of LANGS) {
          const body = orderBody(read({ state, operation: op }), deps({ lang }));
          expect(walk(body, "body").length, `${state}/${op.status}`).toBeGreaterThan(10);
          expect(() => sieveNames(body, "body"), `${state}/${op.status}/${lang}`).not.toThrow();
        }
  });

  it("просев показан красным: подложное тело с именем реквизита роняет **ту же** функцию", () => {
    // Иначе проверялись бы только регулярки, а сам обход оставался бы недоказанным (находка ревью К4 № 4).
    expect(() => sieveNames({ ...orderBody(read(), deps()), card_number: null }, "body")).toThrow(/card_number/);
    expect(() => sieveNames({ operation: { cvv: null } }, "body")).toThrow(/cvv/);
    // И внутри массива — обход туда заходит.
    expect(() => sieveNames({ stops: [{ pan: null }] }, "body")).toThrow(/pan/);
  });

  it("перечень запрещённых имён берётся из источника, а не сужённой копией", () => {
    // Сужённая копия уже однажды пропустила `expiry`, `kid` и `track2` (ревью К2 Б1, шапка `forbidden-fields.ts`).
    for (const bad of FORBIDDEN_EXAMPLES) expect(hitsForbidden(bad), bad).toBe(true);
    for (const ok of ALLOWED_EXAMPLES) expect(hitsForbidden(ok), ok).toBe(false);
    // Имена полей итога — из разрешённых.
    for (const name of ["spent_position", "checked_at", "reason_text", "act", "scope_text"])
      expect(hitsForbidden(name), name).toBe(false);
  });

  it("похожего на номер в **значениях** тела нет: приложение ничего не придумывает", () => {
    for (const state of U7_STATES)
      for (const op of OPERATIONS)
        for (const lang of LANGS) {
          const body = orderBody(read({ state, operation: op }), deps({ lang }));
          for (const e of walk(body, "body"))
            if (typeof e.value === "string") expect(hasCardNumber(e.value), `${e.path}: «${e.value}»`).toBe(false);
        }
  });
});
