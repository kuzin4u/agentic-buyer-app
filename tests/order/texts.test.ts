// Н-3, К1 — источник и время сверки у записи итога (§ 5.8, решение П36, Р-1690, Р-1693).
// Источник перечней — код и файл `config/order.default.json`, литералов перечней в тесте нет (Р-1511): тест сверяет,
// что они совпадают — **ключи файла** с перечнем кода, а не собственный вывод разбора (находка ревью К1 № 6).
// Фикстура — **разные значения у разных сущностей и у разных сумм** (правило владельца 16.11; находка ревью К1 № 1):
// операция, заказ, запись об исполнении, поручение и акт различимы, и сумма авторизации, сумма списания, положение по
// поручению и остаток — четыре разных числа. Иначе сборка, взявшая не то поле, осталась бы зелёной, а человек прочитал
// бы сумму авторизации под подписью «запись об исполнении».
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  OUTCOME_CODES,
  parseOrderTexts,
  SCOPE_CORE_CODES,
  scopeTextOf,
  sourceCodeOf,
  sourceOf,
  SOURCE_CODES,
  type Bilingual,
  type OrderTexts,
  type SourceCode,
} from "../../src/order/texts.js";
import { ORDER_ABSENCE_REASONS } from "../../src/contract/ui-v1/methods.js";
import { AGENT_DIAG } from "agentic-buyer-ref/src/agent/declines/registry.js";
import type { ShellText } from "../../src/order/port.js";
import { hitsForbidden } from "../support/forbidden-fields.js";
import { CHECKED_AT, FULFILLED_AT, operation, read, unsettled, VERIFIED_AT } from "./fixture.js";

const CONFIG = new URL("../../config/order.default.json", import.meta.url);
const raw: unknown = JSON.parse(readFileSync(CONFIG, "utf8"));
const texts: OrderTexts = parseOrderTexts(raw);

// Фикстура — **общая** (`./fixture.js`), а не своя копия: две копии одной фикстуры расходятся молча (находка ревью
// К2 № 7). Моменты и суммы там все разные, и `unsettled()` даёт операцию без записи об исполнении — такую, какую ядро
// отдаёт до расчёта.

describe("К1: тексты источников — данными в `config/`", () => {
  it("ключи **файла** — ровно перечень кодов из кода", () => {
    // Сверяется файл, а не вывод разбора: `parseOrderTexts` строит ключи из `SOURCE_CODES`, поэтому проверка его
    // результата была бы верна при любом содержимом файла (находка ревью К1 № 6).
    const fileCodes = Object.keys((raw as { sources: Record<string, unknown> }).sources);
    expect(fileCodes.slice().sort()).toEqual([...SOURCE_CODES].slice().sort());
  });

  it("ключи **файла** в разделах исхода, причины и английских пар — ровно перечни кода", () => {
    const file = raw as {
      scope_en: Record<string, unknown>;
      outcomes: Record<string, unknown>;
      reasons: Record<string, unknown>;
    };
    expect(Object.keys(file.scope_en).slice().sort()).toEqual([...SCOPE_CORE_CODES].slice().sort());
    expect(Object.keys(file.outcomes).slice().sort()).toEqual([...OUTCOME_CODES].slice().sort());
    expect(Object.keys(file.reasons).slice().sort()).toEqual([...ORDER_ABSENCE_REASONS].slice().sort());
  });

  it("каждый двуязычный текст есть на двух языках, и ru по-русски, en по-английски", () => {
    const all: Bilingual[] = [
      ...SOURCE_CODES.map((c) => texts.sources[c]),
      texts.scope_within,
      ...OUTCOME_CODES.map((c) => texts.outcomes[c]),
      ...ORDER_ABSENCE_REASONS.map((c) => texts.reasons[c]),
    ];
    for (const pair of all) {
      expect(pair.ru).not.toBe(pair.en);
      expect(pair.ru).toMatch(/[А-Яа-яЁё]/);
      expect(pair.en).toMatch(/[A-Za-z]/);
      expect(pair.en, pair.en).not.toMatch(/[А-Яа-яЁё]/);
    }
    // Перечни не пустые — иначе цикл ничего не проверяет.
    expect(all.length).toBe(SOURCE_CODES.length + 1 + OUTCOME_CODES.length + ORDER_ABSENCE_REASONS.length);
  });

  it("у классов с кодом ядра в `config/` только английская пара: русского текста там нет (Р-1696)", () => {
    const file = raw as { scope_en: Record<string, Record<string, unknown> | undefined> };
    for (const code of SCOPE_CORE_CODES) expect(Object.keys(file.scope_en[code] ?? {})).toEqual(["en"]);
    // А русский берётся у ядра — у того же источника, откуда взят класс (Р-1694).
    for (const code of SCOPE_CORE_CODES) expect(scopeTextOf(code, texts, "ru")).toBe(AGENT_DIAG[code].human.ru);
    // Английский — свой, и он не равен русскому ядра.
    for (const code of SCOPE_CORE_CODES) expect(scopeTextOf(code, texts, "en")).toBe(texts.scope_en[code]);
  });

  it("русский текст ядра зафиксирован **значением**: правка у ядра краснеет здесь, и en правят тем же кирпичом", () => {
    // Без этого ожидания расхождение ru (от ядра) и en (своего) не ловилось ничем: ядро правит строку — на экране
    // меняется только русский, и два языка говорят разное (находка ревью К2а № 6).
    expect(scopeTextOf("SCOPE_EXCEEDS_AUTHORIZATION", texts, "ru")).toBe(
      "Списано больше одобренной суммы. Покупка завершена; итог проверьте в приложении банка — по этой оплате можно открыть спор.",
    );
    expect(scopeTextOf("SCOPE_CHECK_UNRECOGNIZED", texts, "ru")).toBe(
      "Банк сообщил о проверке списания, которую помощник не распознал. Покупка завершена; итог проверьте в приложении банка.",
    );
  });

  it("английские строки — по-английски и без подстановок, как у ядра (К17 п. 6)", () => {
    for (const code of SCOPE_CORE_CODES) {
      expect(texts.scope_en[code], code).toMatch(/[A-Za-z]/);
      expect(texts.scope_en[code], code).not.toMatch(/[А-Яа-яЁё]/);
      expect(texts.scope_en[code], code).not.toMatch(/\{[a-z_]+\}/);
    }
  });

  it("разбор отвергает подстановку в английской строке класса", () => {
    const copy = JSON.parse(JSON.stringify(raw)) as Record<string, unknown>;
    const en = copy["scope_en"] as Record<string, Record<string, unknown> | undefined>;
    en["SCOPE_EXCEEDS_AUTHORIZATION"] = { en: "More was charged than approved: {money}" };
    expect(() => parseOrderTexts(copy)).toThrow(/order\.scope_en\.SCOPE_EXCEEDS_AUTHORIZATION\.en: подстановка \{money\}/);
  });

  it("разбор отвергает русский текст у класса с кодом ядра — вторую копию строки", () => {
    const copy = JSON.parse(JSON.stringify(raw)) as Record<string, unknown>;
    const en = copy["scope_en"] as Record<string, Record<string, unknown> | undefined>;
    const one = en["SCOPE_NOT_RESERVED"] ?? {};
    one["ru"] = "своя копия текста ядра";
    en["SCOPE_NOT_RESERVED"] = one;
    expect(() => parseOrderTexts(copy)).toThrow(/order\.scope_en\.SCOPE_NOT_RESERVED\.ru: русский текст берётся у ядра/);
  });

  it("у разных источников разные тексты — один текст на оба случая был бы красным", () => {
    const ru = SOURCE_CODES.map((code) => texts.sources[code].ru);
    expect(new Set(ru).size).toBe(SOURCE_CODES.length);
  });

  it("ни в текстах `config/`, ни в прочитанном нет реквизитов (инвариант 1)", () => {
    // Прежний случай перебирал ключи результата `sourceOf` — а они зафиксированы типом контракта и покраснеть не могли
    // ни при какой правке (находка ревью К1 № 7). Проверяется то, что действительно может измениться: имена полей
    // прочитанного и **сами тексты**, которые человек увидит. Имена полей ответа § 5.8 целиком — случай К4.
    for (const name of Object.keys(read())) expect(hitsForbidden(name), name).toBe(false);
    for (const code of SOURCE_CODES)
      for (const lang of ["ru", "en"] as const)
        expect(texts.sources[code][lang], `${code}.${lang}`).not.toMatch(/\b\d{12,19}\b|cvv|cvc|pan\b/i);
  });

  describe("разбор отвергает негодный файл", () => {
    const broken = (fix: (r: Record<string, unknown>) => void): unknown => {
      const copy = JSON.parse(JSON.stringify(raw)) as Record<string, unknown>;
      fix(copy);
      return copy;
    };
    const sources = (r: Record<string, unknown>): Record<string, unknown> =>
      r["sources"] as Record<string, unknown>;

    it("пропавший код источника", () => {
      expect(() => parseOrderTexts(broken((r) => delete sources(r)["PLATFORM_OPERATION"]))).toThrow(
        /order\.sources\.PLATFORM_OPERATION: ожидается объект/,
      );
    });

    it("лишний код источника — в перечне его нет", () => {
      expect(() =>
        parseOrderTexts(broken((r) => ((sources(r)["SHOP_REPLY"] = { ru: "по данным продавца", en: "per shop" }) as unknown))),
      ).toThrow(/order\.sources\.SHOP_REPLY: кода нет в перечне/);
    });

    it("пропавший язык", () => {
      expect(() =>
        parseOrderTexts(broken((r) => delete (sources(r)["PLATFORM_FULFILMENT"] as Record<string, unknown>)["en"])),
      ).toThrow(/order\.sources\.PLATFORM_FULFILMENT\.en: пустая строка/);
    });

    it("лишний язык", () => {
      expect(() =>
        parseOrderTexts(
          broken((r) => ((sources(r)["PLATFORM_FULFILMENT"] as Record<string, unknown>)["de"] = "Plattform")),
        ),
      ).toThrow(/лишний язык/);
    });

    it("подстановка в тексте источника — её здесь не бывает", () => {
      expect(() =>
        parseOrderTexts(
          broken((r) => ((sources(r)["PLATFORM_FULFILMENT"] as Record<string, unknown>)["ru"] = "Запись {money}")),
        ),
      ).toThrow(/подстановка \{money\} здесь не бывает/);
    });

    it("лишнее поле файла", () => {
      // Раздел `scope` появился в К2 и лишним быть перестал — берём поле, которого в перечне разделов нет.
      expect(() => parseOrderTexts(broken((r) => (r["brand"] = {})))).toThrow(/order\.brand: лишнее поле/);
    });

    it("пропавший раздел файла", () => {
      expect(() => parseOrderTexts(broken((r) => delete r["outcomes"]))).toThrow(/order\.outcomes: ожидается объект/);
    });
  });
});

describe("К1: источник и время сверки у записи итога", () => {
  it("есть запись об исполнении — источник «запись об исполнении Платформы»", () => {
    expect(sourceCodeOf(read())).toBe<SourceCode>("PLATFORM_FULFILMENT");
    expect(sourceOf(read(), texts, "ru").text).toBe(texts.sources["PLATFORM_FULFILMENT"].ru);
  });

  it("записи об исполнении ещё нет — источник «состояние операции», а не та же строка", () => {
    const r = read({ operation: unsettled(), state: "SETTLING" });
    expect(sourceCodeOf(r)).toBe<SourceCode>("PLATFORM_OPERATION");
    expect(sourceOf(r, texts, "ru").text).toBe(texts.sources["PLATFORM_OPERATION"].ru);
    expect(sourceOf(r, texts, "ru").text).not.toBe(texts.sources["PLATFORM_FULFILMENT"].ru);
  });

  it("ключа записи об исполнении нет вовсе — источник выбирается **слабее**, а не сильнее", () => {
    // Негодные данные от реализации порта: ответ ПАО разобран без ключа `fulfilment` (находка ревью К1 № 4). Тип этого
    // не допускает, поэтому случай строится приведением — он и описывает то, от чего защищает `?? null`.
    const broken = read({ operation: { ...operation(), fulfilment: undefined as unknown as null } });
    expect(sourceCodeOf(broken)).toBe<SourceCode>("PLATFORM_OPERATION");
    expect(sourceOf(broken, texts, "ru").text).toBe(texts.sources["PLATFORM_OPERATION"].ru);
  });

  it("текст источника — на языке запроса", () => {
    expect(sourceOf(read(), texts, "en").text).toBe(texts.sources["PLATFORM_FULFILMENT"].en);
  });

  it("`checked_at` — время чтения у Платформы: не время записи Платформы и не время `verify`", () => {
    const s = sourceOf(read(), texts, "ru");
    // Ожидание — значением, а не повторным вызовом той же сборки.
    expect(s.checked_at).toBe("2026-11-21T20:15:00.000Z");
    expect(s.checked_at).not.toBe(FULFILLED_AT);
    expect(s.checked_at).not.toBe(VERIFIED_AT);
  });

  it("время сверки идёт из прочитанного целиком: другое чтение — другое время", () => {
    expect(sourceOf(read({ checked_at: "2026-11-22T06:00:00.000Z" }), texts, "ru").checked_at).toBe(
      "2026-11-22T06:00:00.000Z",
    );
  });

  it("форма порта держит два правила компиляцией: сумма — только из `verify`, состояние — только из прочитанного", () => {
    // Правки по находкам ревью К1 № 2 и № 3. Проверка **компиляцией** (`tsc` в `npm run check` и в CI), а не прогоном:
    // в рантайме типов нет, и в оба места прошла бы любая величина.
    const shell: ShellText = {
      notSpent: (intent, lang) => `${String(intent.amount_left.amount)} ${lang}`,
      done: (r, lang) => `${r.state} ${lang}`,
    };
    expect(shell.notSpent(read().intent, "ru")).toContain("63200");
    expect(shell.done(read(), "ru")).toContain("DONE");
    // Эти два вызова **не исполняются**: проверку держит компилятор, а аргументы нарочно негодные — исполнение
    // упало бы на них по другой причине и ничего бы не доказало.
    const compileOnly = (): void => {
      // @ts-expect-error — произвольную сумму в строку «не списано» передать нельзя: только остаток `verify` (Р-1692)
      void shell.notSpent({ amount: 10, currency: "RUB" }, "ru");
      // @ts-expect-error — состояние мимо прочитанного в строку «что уже сделано» передать нельзя (П36 п. 1, П31)
      void shell.done("DONE", "ru");
    };
    expect(typeof compileOnly).toBe("function");
  });

  it("часов у сборки нет: время показа подставить нечем — два вызова подряд дают одно и то же", () => {
    const first = sourceOf(read(), texts, "ru").checked_at;
    const second = sourceOf(read(), texts, "ru").checked_at;
    expect(first).toBe(second);
    expect(first).toBe(CHECKED_AT);
  });
});
