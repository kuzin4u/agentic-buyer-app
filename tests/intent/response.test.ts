// П-К4, К4 — тело § 5.1: `view` по правилу 1 и `actions.submit` с объяснением недоступности (решение П33; Р-1666).
// Тексты — из `config/intent.default.json`, не фикстурой: ожидания берут их оттуда же, откуда берёт код (Р-1511).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isUiErrorCode } from "../../src/contract/ui-v1/errors.js";
import { isShownHash, showingHash } from "../../src/contract/ui-v1/shown-hash.js";
import type { IntentCard } from "../../src/contract/ui-v1/methods.js";
import { buildIntentDraft, createIntentDraftStore, type DraftDeps, type DraftOutcome } from "../../src/intent/draft.js";
import { draftBody, shownOf, type ResponseDeps } from "../../src/intent/response.js";
import { linesFor, parseIntentTexts } from "../../src/intent/texts.js";

const texts = parseIntentTexts(
  JSON.parse(readFileSync(new URL("../../config/intent.default.json", import.meta.url), "utf8")),
);

const NOW = "2026-11-20T09:00:00.000Z";
const PHRASE = "хлеб на выходные, до 1000 ₽, один раз";
const MONEY = (m: { readonly amount: number; readonly currency: string }, lang: string): string =>
  `«сумма ${m.amount} ${m.currency} на ${lang}»`;

/** Шаблон — полный (пять полей), чтобы собралась карточка; продавцы — две различимые витрины. */
const FULL = {
  subject: "хлеб",
  limit: { amount: 100_000, currency: "RUB" },
  valid_to: "2026-11-27T09:00:00.000Z",
  merchants: [
    { id: "MER-7001", label: "Масса Мадре (MER-7001)" },
    { id: "MER-7002", label: "Хлебный дом (MER-7002)" },
  ],
  confirmation_mode: "IMMEDIATE",
} as const;

function draftDeps(over: Partial<DraftDeps> = {}): DraftDeps {
  return {
    lang: "ru",
    template: FULL,
    questionText: (code) => texts.questions[code].ru,
    lines: (d) => linesFor(d, { lang: "ru", texts, money: MONEY, timeZone: "Europe/Moscow" }),
    store: createIntentDraftStore(),
    journal: { write: () => undefined },
    newDraftId: () => "drf_k4",
    now: () => NOW,
    ...over,
  };
}

/** Идентификатор показанного — **своё** значение, не производное от `draft_id`: разные сущности — разные значения
 *  (решение владельца 16.11; ревью К4 № 9), иначе подстановка одного вместо другого прошла бы незамеченной. */
const VIEW_ID = "vw_k4_show";

const deps = (over: Partial<ResponseDeps> = {}): ResponseDeps => ({
  lang: "ru",
  texts,
  viewId: () => VIEW_ID,
  ...over,
});

const outcomeWithCard = (): DraftOutcome => buildIntentDraft(PHRASE, draftDeps());
const outcomeWithQuestions = (): DraftOutcome =>
  buildIntentDraft(PHRASE, draftDeps({ template: { subject: FULL.subject } }));

describe("К4: тело § 5.1 — карточка собралась", () => {
  it("карточка, пустые вопросы, доступное действие и `view` с хэшем показанного", () => {
    const out = outcomeWithCard();
    const res = draftBody(out, deps());
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.body.draft_id).toBe("drf_k4");
    expect(res.body.questions).toEqual([]);
    expect(res.body.card).not.toBeNull();
    expect(res.body.actions.submit).toEqual({
      enabled: true,
      label: texts.actions.submit_label.ru,
      why_disabled: null,
    });
    expect(res.body.view).toEqual({
      view_id: VIEW_ID,
      text_version: texts.text_version,
      hash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/) as unknown as string,
    });
  });

  /** Хэш — канонизацией ядра по **версии текстов и той карточке, которая уехала экрану**. Ожидание считается от
   *  `res.body.card`, а не от исхода сборки: иначе тело, где показана одна карточка, а хэш посчитан по другой,
   *  осталось бы зелёным — ровно та подмена, против которой правило 1 и введено (находка ревью К4 № 1). */
  it("хэш считается по версии текстов и показанной карточке, и показана та же карточка, что собрана", () => {
    const out = outcomeWithCard();
    const res = draftBody(out, deps());
    if (!res.ok || res.body.card === null || out.kind !== "card") throw new Error("ожидалась карточка");
    expect(res.body.card).toEqual(out.card);
    expect(res.body.view.hash).toBe(showingHash(shownOf(texts, res.body.card)));
    expect(res.body.view.text_version).toBe(texts.text_version);
    expect(isShownHash(res.body.view.hash)).toBe(true);
  });

  it("второй режим подтверждения тоже доезжает до показанного: своя строка и свой хэш", () => {
    const immediate = draftBody(outcomeWithCard(), deps());
    const autonomous = draftBody(
      buildIntentDraft(PHRASE, draftDeps({ template: { ...FULL, confirmation_mode: "AUTONOMOUS" } })),
      deps(),
    );
    if (!immediate.ok || !autonomous.ok || autonomous.body.card === null) throw new Error("ожидались тела");
    expect(autonomous.body.card.confirmation_mode).toBe("AUTONOMOUS");
    expect(autonomous.body.card.lines.at(-1)?.code).toBe("CONFIRMATION_AUTONOMOUS");
    expect(autonomous.body.view.hash).not.toBe(immediate.body.view?.hash);
  });

  it("язык карточки и язык действия разошлись — дефект сборки, а не тело на двух языках", () => {
    const ruCard = outcomeWithCard();
    expect(() => draftBody(ruCard, deps({ lang: "en" }))).toThrow(/разошлись/);
  });

  /** Строки-пояснения входят в показанное: человек читает их и подписывает прочитанное (правило 1). Подмена одной
   *  строки меняет хэш — иначе подменённый текст прошёл бы как тот же самый. */
  it("подмена строки-пояснения меняет хэш, подмена порядка строк — тоже", () => {
    const out = outcomeWithCard();
    if (out.kind !== "card") throw new Error("ожидалась карточка");
    const base = showingHash(shownOf(texts, out.card));

    const other: IntentCard = {
      ...out.card,
      lines: out.card.lines.map((l, i) => (i === 0 ? { ...l, text: `${l.text} и ещё` } : l)),
    };
    expect(showingHash(shownOf(texts, other))).not.toBe(base);

    const reordered: IntentCard = { ...out.card, lines: [...out.card.lines].reverse() };
    expect(showingHash(shownOf(texts, reordered))).not.toBe(base);
  });

  it("другой язык — другая карточка и другой хэш: подтверждают именно прочитанные тексты", () => {
    const ru = draftBody(buildIntentDraft(PHRASE, draftDeps()), deps());
    const en = draftBody(
      buildIntentDraft(
        PHRASE,
        draftDeps({
          lang: "en",
          lines: (d) => linesFor(d, { lang: "en", texts, money: MONEY, timeZone: "Europe/Moscow" }),
        }),
      ),
      deps({ lang: "en" }),
    );
    if (!ru.ok || !en.ok) throw new Error("ожидались тела");
    expect(en.body.actions.submit.label).toBe(texts.actions.submit_label.en);
    expect(en.body.actions.submit.label).not.toBe(ru.body.actions.submit.label);
    expect(en.body.view?.hash).not.toBe(ru.body.view?.hash);
  });
});

describe("К4: тело § 5.1 — остались вопросы (Р-1666)", () => {
  it("`card` и `view` — `null`, вопросы на месте, действие недоступно с объяснением", () => {
    const res = draftBody(outcomeWithQuestions(), deps());
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.body.card).toBeNull();
    expect(res.body.view).toBeNull();
    expect(res.body.questions.map((q) => q.id)).toEqual(["limit", "valid_to", "merchants", "confirmation_mode"]);
    expect(res.body.actions.submit).toEqual({
      enabled: false,
      label: texts.actions.submit_label.ru,
      why_disabled: texts.actions.submit_blocked_by_questions.ru,
    });
  });

  it("объяснение приходит на языке запроса — молчания у недоступного действия не бывает", () => {
    for (const lang of ["ru", "en"] as const) {
      const outcome = buildIntentDraft(
        PHRASE,
        draftDeps({ lang, template: { subject: FULL.subject }, questionText: (code) => texts.questions[code][lang] }),
      );
      const res = draftBody(outcome, deps({ lang }));
      if (!res.ok) throw new Error("ожидалось тело");
      expect(res.body.actions.submit.why_disabled, lang).toBe(texts.actions.submit_blocked_by_questions[lang]);
      expect(res.body.actions.submit.why_disabled?.trim(), lang).not.toBe("");
    }
  });

  it("`why_disabled` непустой ровно тогда, когда действие недоступно", () => {
    const withCard = draftBody(outcomeWithCard(), deps());
    const withQuestions = draftBody(outcomeWithQuestions(), deps());
    if (!withCard.ok || !withQuestions.ok) throw new Error("ожидались тела");
    expect(withCard.body.actions.submit.enabled).toBe(true);
    expect(withCard.body.actions.submit.why_disabled).toBeNull();
    expect(withQuestions.body.actions.submit.enabled).toBe(false);
    expect(withQuestions.body.actions.submit.why_disabled).not.toBeNull();
  });

  it("карточки нет — показанного нет: хэш по пустому месту не считается", () => {
    expect(() => shownOf(texts, null)).toThrow(/показанного нет/);
  });
});

describe("К4: фразы нет — негодное тело, код приставляет К5", () => {
  it("исход отдаётся как `phrase_empty`, тела § 5.1 нет; имя исхода — не код `/ui`", () => {
    const res = draftBody({ kind: "phrase_empty" }, deps());
    expect(res).toEqual({ ok: false, reason: "phrase_empty" });
    // Имя исхода не притворяется кодом контракта: код приставит К5 из `errors.ts` (`INTENT_DRAFT_INVALID`, Р-1650).
    expect(isUiErrorCode("phrase_empty")).toBe(false);
  });
});
