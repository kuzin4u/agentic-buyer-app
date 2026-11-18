// КТ-0, К2.4 (контракт К-Б; П30): контрактные тесты модуля `/ui/v1`.
// Четыре вещи, каждая — своим случаем:
//   1) деньги только парой: суммы без валюты тип не допускает;
//   2) перечень кодов `/ui` и их статусы совпадают с § 6 **документа** (источник — документ, не копия в STATUS);
//   3) правило идемпотентности: имя заголовка и формат ключа;
//   4) инвариант 1 — в типах контракта нет полей реквизитов, номера карты, криптограммы и `kid`.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  IDEMPOTENCY_HEADER,
  isIdempotencyKey,
  isUiErrorCode,
  UI_CONTRACT_VERSION,
  UI_ERROR_CODES,
  UI_ERROR_STATUS,
  UI_V1_BASE,
  type UiMoney,
  type UiRetryClass,
} from "../../src/contract/ui-v1/index.js";

const CONTRACT_DOC = new URL("../../docs/reference/2026-11-18-kontrakt-K-B-ui-v1-v1.0.md", import.meta.url);
const doc = readFileSync(CONTRACT_DOC, "utf8");

/** Файлы модуля контракта: по их тексту проверяется инвариант 1 (п. 4) — типы в рантайме не существуют. */
const MODULE_FILES = ["common.ts", "errors.ts", "idempotency.ts", "methods.ts", "steps.ts", "index.ts"] as const;
const sources = MODULE_FILES.map((f) => ({ file: f, text: readFileSync(new URL(`../../src/contract/ui-v1/${f}`, import.meta.url), "utf8") }));

describe("К2.4 п. 1: деньги — только парой (§ 3 «Деньги», правило планов № 2)", () => {
  it("сумма с валютой — годится", () => {
    const m: UiMoney = { amount: 36800, currency: "RUB" };
    expect(m).toEqual({ amount: 36800, currency: "RUB" });
  });

  it("сумма без валюты типом не допускается", () => {
    // @ts-expect-error — число минимальных единиц без кода валюты это не сумма
    const bad: UiMoney = { amount: 36800 };
    expect(bad.amount).toBe(36800);
  });

  it("одно число вместо пары типом не допускается", () => {
    // @ts-expect-error — «36800» без валюты на границе `/ui/v1` не бывает ни в одном поле
    const bad: UiMoney = 36800;
    expect(bad).toBe(36800);
  });

  it("класс повтора `new_key` экрану не отдаётся (§ 3 «Ошибки»)", () => {
    const ok: UiRetryClass[] = ["never", "after_fix", "same_key", "after_human"];
    expect(ok).toHaveLength(4);
    // @ts-expect-error — смена ключа подписи агента принадлежит серверу, не экрану
    const bad: UiRetryClass = "new_key";
    expect(bad).toBe("new_key");
  });
});

describe("К2.4 п. 2: коды `/ui` совпадают с § 6 документа", () => {
  /** Строки таблицы § 6: `| `КОД` | 409 | когда |`. Перечень берётся из документа — источника, а не из копии. */
  const fromDoc = (() => {
    const section = doc.slice(doc.indexOf("# 6. Коды `/ui`"), doc.indexOf("# 7. Что работает"));
    const rows = [...section.matchAll(/^\|\s*`([A-Z0-9_]+)`\s*\|\s*(\d{3})\s*\|/gm)];
    return rows.map((m) => [m[1] as string, Number(m[2])] as const);
  })();

  it("таблица § 6 прочитана — девять строк", () => {
    expect(fromDoc).toHaveLength(9);
  });

  it("перечень кодов и порядок — ровно как в § 6", () => {
    expect(UI_ERROR_CODES).toEqual(fromDoc.map(([code]) => code));
  });

  it("HTTP-статус каждого кода — как в § 6", () => {
    for (const [code, status] of fromDoc) expect(UI_ERROR_STATUS[code as keyof typeof UI_ERROR_STATUS], code).toBe(status);
  });

  it("код вне перечня не опознаётся как код `/ui` (это код ядра)", () => {
    expect(isUiErrorCode("SHOWN_STALE")).toBe(true);
    expect(isUiErrorCode("LIMIT_EXCEEDED")).toBe(false);
    expect(isUiErrorCode("toString")).toBe(false);
  });

  it("путь и версия контракта — как в документе", () => {
    expect(UI_V1_BASE).toBe("/ui/v1");
    expect(UI_CONTRACT_VERSION).toBe("1.0");
    expect(doc).toContain("`/ui/v1`");
  });
});

describe("К2.4 п. 3: идемпотентность (§ 3, правило 2)", () => {
  it("имя заголовка — то же, что у ПАО, и названо в документе", () => {
    expect(IDEMPOTENCY_HEADER).toBe("Idempotency-Key");
    expect(doc).toContain("`Idempotency-Key`");
  });

  it("ключ — UUID v4", () => {
    expect(isIdempotencyKey("9f1c3b7e-5a24-4d8f-9b31-2c6f0ab4e7d5")).toBe(true);
    expect(isIdempotencyKey("9F1C3B7E-5A24-4D8F-9B31-2C6F0AB4E7D5")).toBe(true);
  });

  it("не UUID v4 — не ключ: версия 1, негодный вариант, короткая строка, пусто", () => {
    expect(isIdempotencyKey("9f1c3b7e-5a24-1d8f-9b31-2c6f0ab4e7d5")).toBe(false);
    expect(isIdempotencyKey("9f1c3b7e-5a24-4d8f-7b31-2c6f0ab4e7d5")).toBe(false);
    expect(isIdempotencyKey("9f1c3b7e5a244d8f9b312c6f0ab4e7d5")).toBe(false);
    expect(isIdempotencyKey("")).toBe(false);
  });
});

describe("К2.4 п. 4: инвариант 1 — реквизитов в типах контракта нет", () => {
  /** Запрещённые имена полей: реквизит, номер карты и его части, криптограмма, ключ подписи агента.
   *  Разрешены только идентификаторы (`order_id`, `mandate_id`, `instrument_token` — CLAUDE.md, инвариант 1). */
  const FORBIDDEN = [
    /\bpan\b/i,
    /card_?number/i,
    /\bcvv\b/i,
    /\bcvc\b/i,
    /cryptogram|криптограмм/i,
    /\bkid\b/i,
    /expiry|exp_?month|exp_?year/i,
    /\btrack2?\b/i,
    /\bcredential(s)?\b/i,
  ];

  /** Имена полей, объявленных в модуле: `readonly x: …` и `x: …` в интерфейсах и типах. */
  const declaredKeys = sources.flatMap(({ file, text }) =>
    [...text.matchAll(/^\s*(?:readonly\s+)?([a-z_][a-z0-9_]*)\??:/gim)].map((m) => ({ file, key: m[1] as string })),
  );

  it("поля в модуле объявлены — иначе проверка ничего не проверяет", () => {
    expect(declaredKeys.length).toBeGreaterThan(60);
  });

  it("ни одно объявленное поле не несёт реквизита, номера карты, криптограммы или `kid`", () => {
    for (const { file, key } of declaredKeys)
      for (const re of FORBIDDEN) expect(re.test(key), `${file}: ${key}`).toBe(false);
  });

  it("проверка ловит подделку: поле `card_number` было бы красным", () => {
    expect(FORBIDDEN.some((re) => re.test("card_number"))).toBe(true);
    expect(FORBIDDEN.some((re) => re.test("kid"))).toBe(true);
    expect(FORBIDDEN.some((re) => re.test("pan"))).toBe(true);
  });

  it("разрешённые идентификаторы проверкой не задеты", () => {
    for (const ok of ["order_id", "mandate_id", "instrument_token", "purchase_id", "merchant_id", "view_id"])
      expect(FORBIDDEN.some((re) => re.test(ok)), ok).toBe(false);
  });

  it("документ контракта говорит то же: у экрана нет ключа агента, `kid`, криптограммы и номера карты", () => {
    expect(doc).toContain("У экрана нет ключа агента");
    expect(doc).toContain("инвариант 1");
  });
});
