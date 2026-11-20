// П-К4, К7 (решение владельца 20.11.2026, 20:58 — **Р-1681**): класс повтора у кода `/ui` — **совет человеку**, и он
// один на приложение. До этого кирпича таблиц было две: `RETRY_BY_CODE` сервиса поручения (`src/intent/service.ts`,
// К5) и `UI_RETRY` сервера `/ui/v1` (`src/ui-server/errors.ts`, ИН-0), и три строки в них расходились — один и тот же
// отказ советовал человеку разное.
//
// Здесь сверяется **с решениями**, а не одна таблица с другой: перечень «код → класс и основание» записан ожиданием
// по источникам, и обе таблицы сверяются с ним. Сведение самой таблицы в контракт — кирпич окна Б в ИН-П1 (одна
// норма в одном месте, как канонизация по Р-1613); до него тест держит их согласие.
import { describe, expect, it } from "vitest";
import { uiError } from "../../src/ui-server/errors.js";
import { RETRY_BY_CODE } from "../../src/intent/service.js";

/** Класс и **основание** у каждого кода, которым отвечает отправка поручения. Основание — не украшение: правило
 *  «ни один класс не выведен по смыслу» (строка STATUS о классах повтора) проверяется тем, что в перечне у каждого
 *  значения назван источник. */
const DECIDED = [
  { code: "INTENT_DRAFT_INVALID", retry: "after_fix", source: "Р-1650 и Р-1670 (решения владельца 20.11)" },
  { code: "SHOWN_STALE", retry: "after_human", source: "решение владельца 19.11, 18:20" },
  { code: "PURCHASE_NOT_FOUND", retry: "after_human", source: "таблица отказов ядра: MANDATE_NOT_FOUND" },
  { code: "STEP_NOT_ALLOWED", retry: "after_human", source: "Р-1677 (решение владельца 20.11, 20:08)" },
  { code: "IDEMPOTENCY_REQUIRED", retry: "same_key", source: "таблица кодов ПАО 1.4.0, решение владельца 19.11" },
  { code: "IDEMPOTENCY_CONFLICT", retry: "after_fix", source: "таблица кодов ПАО 1.4.0" },
] as const;

describe("К7: класс повтора — один на приложение и по решению", () => {
  it("у каждого решённого класса назван источник", () => {
    for (const { code, source } of DECIDED) expect(source.length, code).toBeGreaterThan(10);
  });

  it("сервис поручения (К5) отвечает решёнными классами", () => {
    for (const { code, retry } of DECIDED) expect(RETRY_BY_CODE[code], code).toBe(retry);
  });

  /** Сервер `/ui/v1` окна Б отдаёт класс в теле ответа — проверяется **через ответ**, а не чтением его таблицы:
   *  экран видит именно тело. */
  it("сервер `/ui/v1` отдаёт те же классы в теле отказа", () => {
    for (const { code, retry } of DECIDED) expect(uiError(code, "ru").body.error.retry, code).toBe(retry);
  });

  it("`never` не отдаётся ни одному из этих кодов: ни один из отказов не значит «невозможно совсем»", () => {
    for (const { code } of DECIDED) expect(uiError(code, "ru").body.error.retry, code).not.toBe("never");
  });

  it("класс не зависит от языка запроса — это инструкция, а не текст", () => {
    for (const { code } of DECIDED)
      expect(uiError(code, "en").body.error.retry, code).toBe(uiError(code, "ru").body.error.retry);
  });
});
