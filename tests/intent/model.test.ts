// П-К4, К1 — модель черновика поручения и проверка формы (К-Б § 5.1, решение П33).
// Фикстура: продавцы — из набора витрин стенда, не литералом (Р-1511). Разные сущности — разные значения (решение
// владельца 16.11): предмет, валюта, срок и продавцы у случаев различимы, чтобы подмена поля не прошла зелёной.
import { readFileSync } from "node:fs";
import { MERCHANT_FIXTURES } from "agentic-ps-platform/fixtures";
import { missingTerms } from "agentic-buyer-ref/src/agent/mandates/client.js";
import type { MandateDraft } from "agentic-buyer-ref/src/shared/domain.js";
import { describe, expect, it } from "vitest";
import { ALLOWED_EXAMPLES, FORBIDDEN_EXAMPLES, hitsForbidden } from "../support/forbidden-fields.js";
import {
  CONFIRMATION_MODES,
  DRAFT_KEYS,
  checkDraft,
  isConfirmationMode,
  type IntentDraft,
} from "../../src/intent/model.js";

const NOW = "2026-11-19T21:00:00.000Z";
const SHOPS = MERCHANT_FIXTURES.map((f) => f.merchant_id);
const TWO_SHOPS = SHOPS.slice(0, 2);

const draft = (over: Partial<IntentDraft> = {}): IntentDraft => ({
  subject: "хлеб",
  limit: { amount: 100_000, currency: "RUB" },
  valid_to: "2026-11-26T12:00:00.000Z",
  merchants: TWO_SHOPS,
  confirmation_mode: "IMMEDIATE",
  ...over,
});

/** Черновик в доменных именах ядра — чтобы тот же случай проверил и ядро (`missingTerms`, A7 п. 2.2). Поля, которых у
 *  черновика нет (вид, родитель, клиент, показ карточки, корзина), берутся годными: сверяется **совпадение условий**
 *  по пяти полям § 5.1, а не полнота проекта мандата. */
const asCore = (d: IntentDraft): MandateDraft => ({
  kind: "INTENT",
  parentId: null,
  subject: d.subject,
  amountLimit: { amount: d.limit.amount, currency: d.limit.currency },
  validTo: d.valid_to,
  merchantScope: [...d.merchants],
  principalRef: "pr_test_intent",
  confirmationMode: d.confirmation_mode,
  keyTermsShown: true,
  cart: null,
});

describe("К1: черновик поручения — годная форма", () => {
  it("годный черновик принят; ядро у того же черновика тоже не находит пустых реквизитов", () => {
    expect(checkDraft(draft(), NOW)).toEqual({ ok: true });
    expect(missingTerms(asCore(draft()), new Date(NOW))).toEqual([]);
  });

  it("поля черновика — ровно пять; имена совпадают с `card` § 5.1 по четырём, `merchants` у черновика — список", () => {
    expect(DRAFT_KEYS).toEqual(["subject", "limit", "valid_to", "merchants", "confirmation_mode"]);
    expect(Object.keys(draft())).toEqual([...DRAFT_KEYS]);
    // У `card` § 5.1 шесть полей: те же четыре, `merchants` объектом `{count, labels}` и `lines`. Черновик — не
    // карточка: перевод в форму карточки делает К2, строки-пояснения — К3.
    expect((draft() as unknown as Record<string, unknown>)["lines"]).toBeUndefined();
    expect(Array.isArray(draft().merchants)).toBe(true);
  });

  /** Инвариант 1 — по **объявленным полям модуля**, а не по ключам одного экземпляра: иначе реквизит, добавленный
   *  позже в `DraftProblem` или в соседний тип, не поймался бы. Приём тот же, что в `tests/contract/ui-v1.test.ts`
   *  (К2.4 п. 4). `instrument_token` инвариантом 1 разрешён, поэтому слова `token` в запретном перечне нет. */
  describe("инвариант 1: реквизитов в модели нет", () => {
    // Перечень — один на все тесты (`tests/support/forbidden-fields.ts`): до ревью К2 он лежал тремя копиями, и
    // копия К2 была уже сужена (ревью К2 Б1).
    const text = readFileSync(new URL("../../src/intent/model.ts", import.meta.url), "utf8");
    // Имена ищутся **по всему тексту**, а не по началу строки: в этом модуле поля причин объявлены внутри строки
    // (`| { readonly reason: …; readonly field: string }`), и разбор по началу строки их пропускал бы — ровно та
    // ошибка, которую нашло ревью К1.2 в П-К1 (внутристрочное `items[].weight`).
    const declaredKeys = [...new Set([...text.matchAll(/\b([a-z_][a-z0-9_]*)\??\s*:/gi)].map((m) => m[1] as string))];

    it("поля в модуле объявлены — иначе проверка ничего не проверяет", () => {
      expect(declaredKeys).toContain("confirmation_mode");
      expect(declaredKeys).toContain("field");
      expect(declaredKeys.length).toBeGreaterThan(10);
    });

    it("ни одно объявленное поле не несёт реквизита, номера карты, криптограммы или `kid`", () => {
      for (const key of declaredKeys) expect(hitsForbidden(key), key).toBe(false);
    });

    it("проверка ловит подделку: запретные имена красные, идентификаторы инварианта 1 — нет", () => {
      for (const bad of FORBIDDEN_EXAMPLES) expect(hitsForbidden(bad), bad).toBe(true);
      for (const ok of ALLOWED_EXAMPLES) expect(hitsForbidden(ok), ok).toBe(false);
    });
  });

  it("режимы подтверждения — перечень ядра, своего приложение не придумывает", () => {
    expect(CONFIRMATION_MODES).toEqual(["IMMEDIATE", "AUTONOMOUS"]);
    expect(isConfirmationMode("AUTONOMOUS")).toBe(true);
    expect(isConfirmationMode("ASK_ALWAYS")).toBe(false);
    expect(isConfirmationMode("toString")).toBe(false);
  });

  it("время сервера не из тела: не время — ошибка сборки, а не отказ человеку", () => {
    expect(() => checkDraft(draft(), "вчера")).toThrow(/не время/);
    expect(() => checkDraft(draft(), "")).toThrow(/не время/);
  });
});

describe("К1: проверка формы — лишнее поле и недостающее", () => {
  it("лишнее поле в черновике — отказ с именем поля", () => {
    const over = { ...draft(), note: "на выходные" } as unknown as IntentDraft;
    expect(checkDraft(over, NOW)).toEqual({ ok: false, reason: "UNKNOWN_FIELD", field: "note" });
  });

  it("лишнее поле внутри суммы — тоже отказ: у суммы ровно пара полей (§ 3 «Деньги»)", () => {
    const over = draft({ limit: { amount: 100_000, currency: "RUB", minor: 2 } as unknown as IntentDraft["limit"] });
    expect(checkDraft(over, NOW)).toEqual({ ok: false, reason: "UNKNOWN_FIELD", field: "minor" });
  });

  it("каждое из пяти полей обязательно — и названо по имени", () => {
    for (const field of DRAFT_KEYS) {
      const без = { ...draft() } as Record<string, unknown>;
      delete без[field];
      expect(checkDraft(без as unknown as IntentDraft, NOW), field).toEqual({ ok: false, reason: "MISSING", field });
    }
  });

  it("черновика нет вовсе — `NOT_OBJECT`, а не исключение", () => {
    for (const bad of [undefined, null, "хлеб до 1000", 5])
      expect(checkDraft(bad as unknown as IntentDraft, NOW), String(bad)).toEqual({ ok: false, reason: "NOT_OBJECT" });
  });
});

describe("К1: проверка формы — значения", () => {
  it("предмет пустой или из пробелов — `SUBJECT_EMPTY`; ядро судит так же", () => {
    for (const subject of ["", "   ", "\n"]) {
      expect(checkDraft(draft({ subject }), NOW), JSON.stringify(subject)).toEqual({ ok: false, reason: "SUBJECT_EMPTY" });
      expect(missingTerms(asCore(draft({ subject })), new Date(NOW)), JSON.stringify(subject)).toContain("subject");
    }
  });

  it("предел — целое число минимальных единиц больше нуля; ядро судит так же", () => {
    for (const amount of [0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 2]) {
      const d = draft({ limit: { amount, currency: "KZT" } });
      expect(checkDraft(d, NOW), String(amount)).toEqual({ ok: false, reason: "LIMIT_NOT_POSITIVE" });
      expect(missingTerms(asCore(d), new Date(NOW)), String(amount)).toContain("amountLimit");
    }
    expect(checkDraft(draft({ limit: { amount: 1, currency: "KZT" } }), NOW)).toEqual({ ok: true });
  });

  it("сумма — всегда пара; негодная **форма** суммы — свой код, не «не больше нуля»", () => {
    // Без валюты — вопрос к валюте.
    expect(checkDraft(draft({ limit: { amount: 100_000 } as unknown as IntentDraft["limit"] }), NOW)).toEqual({
      ok: false,
      reason: "CURRENCY_NOT_ISO",
    });
    // Без суммы, не числом, не объектом — это форма, а не величина: человеку говорится «поправьте форму суммы».
    for (const limit of [{ currency: "RUB" }, { amount: "много", currency: "RUB" }, 100_000, "1000 ₽", null])
      expect(checkDraft(draft({ limit: limit as unknown as IntentDraft["limit"] }), NOW), JSON.stringify(limit)).toEqual(
        { ok: false, reason: "LIMIT_NOT_MONEY" },
      );
  });

  it("валюта — код ISO 4217 по форме; слова и регистр не принимаются", () => {
    for (const currency of ["рубли", "rub", "RUBLE", "RU", "R U B", "840"])
      expect(checkDraft(draft({ limit: { amount: 100_000, currency } }), NOW), currency).toEqual({
        ok: false,
        reason: "CURRENCY_NOT_ISO",
      });
    // Другая валюта той же формы принимается: допустимое множество заявляет адаптер платформы, не приложение.
    expect(checkDraft(draft({ limit: { amount: 7_500, currency: "JPY" } }), NOW)).toEqual({ ok: true });
  });

  it("срок — время ISO 8601 в будущем; «сейчас» уже истекло, и ядро судит так же", () => {
    expect(checkDraft(draft({ valid_to: "на выходные" }), NOW)).toEqual({ ok: false, reason: "VALID_TO_NOT_TIME" });
    expect(checkDraft(draft({ valid_to: "" }), NOW)).toEqual({ ok: false, reason: "VALID_TO_NOT_TIME" });
    for (const valid_to of ["2026-11-19T20:59:59.999Z", NOW]) {
      expect(checkDraft(draft({ valid_to }), NOW), valid_to).toEqual({ ok: false, reason: "VALID_TO_PAST" });
      expect(missingTerms(asCore(draft({ valid_to })), new Date(NOW)), valid_to).toContain("validTo");
    }
    expect(checkDraft(draft({ valid_to: "2026-11-19T21:00:00.001Z" }), NOW)).toEqual({ ok: true });
  });

  it("продавцы — непустой список непустых строк; ядро судит так же", () => {
    expect(checkDraft(draft({ merchants: SHOPS[0]! as unknown as readonly string[] }), NOW)).toEqual({
      ok: false,
      reason: "MERCHANTS_NOT_LIST",
    });
    expect(checkDraft(draft({ merchants: [SHOPS[0]!, ""] }), NOW)).toEqual({ ok: false, reason: "MERCHANTS_NOT_LIST" });
    const empty = draft({ merchants: [] });
    expect(checkDraft(empty, NOW)).toEqual({ ok: false, reason: "MERCHANTS_EMPTY" });
    expect(missingTerms(asCore(empty), new Date(NOW))).toContain("merchantScope");
  });

  it("повтор продавца — отказ с его идентификатором, и **этого ядро не ловит** (своя часть проверки)", () => {
    const twice = draft({ merchants: [SHOPS[0]!, SHOPS[1]!, SHOPS[0]!] });
    expect(checkDraft(twice, NOW)).toEqual({ ok: false, reason: "MERCHANT_DUPLICATE", id: SHOPS[0] });
    // Ровно за этим проверка и существует: ядру такой черновик годен, и карточка показала бы «продавцов: 3» при двух.
    expect(missingTerms(asCore(twice), new Date(NOW))).toEqual([]);
  });

  it("лишнее поле ядро тоже не ловит — вторая своя часть проверки", () => {
    const over = { ...draft(), note: "на выходные" } as unknown as IntentDraft;
    expect(checkDraft(over, NOW).ok).toBe(false);
    // Ядру тело отдаётся **с тем же лишним полем** (в обход типа): через `asCore` поле отбрасывалось бы ещё до
    // вызова, и тест говорил бы о годном черновике, а не о лишнем поле (находка ревью К1 № 2).
    const coreOver = { ...asCore(draft()), note: "на выходные" } as unknown as MandateDraft;
    expect(missingTerms(coreOver, new Date(NOW))).toEqual([]);
  });

  it("режим вне перечня ядра — `MODE_UNKNOWN`; ядро судит так же", () => {
    const d = draft({ confirmation_mode: "ASK_ALWAYS" as unknown as IntentDraft["confirmation_mode"] });
    expect(checkDraft(d, NOW)).toEqual({ ok: false, reason: "MODE_UNKNOWN" });
    expect(missingTerms(asCore(d), new Date(NOW))).toContain("confirmationMode");
    expect(checkDraft(draft({ confirmation_mode: "AUTONOMOUS" }), NOW)).toEqual({ ok: true });
  });

  it("порядок отказов — форма раньше значений: лишнее поле перекрывает негодный предел", () => {
    const both = { ...draft({ limit: { amount: 0, currency: "рубли" } }), note: 1 } as unknown as IntentDraft;
    expect(checkDraft(both, NOW)).toEqual({ ok: false, reason: "UNKNOWN_FIELD", field: "note" });
  });
});
