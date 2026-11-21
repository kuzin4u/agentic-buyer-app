// П-К4, К4 — тело § 5.1: `view` по правилу 1 и `actions.submit` с объяснением недоступности (решение П33; Р-1666).
// Тексты — из `config/intent.default.json`, не фикстурой: ожидания берут их оттуда же, откуда берёт код (Р-1511).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isUiErrorCode } from "../../src/contract/ui-v1/errors.js";
import { isShownHash, showingHash } from "../../src/contract/ui-v1/shown-hash.js";
import type { IntentCard } from "../../src/contract/ui-v1/methods.js";
import { buildIntentDraft, createIntentDraftStore, type DraftDeps, type DraftOutcome } from "../../src/intent/draft.js";
import { draftBody, shownOf, type ResponseDeps } from "../../src/intent/response.js";
import { parseIntentTexts } from "../../src/intent/texts.js";

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
    texts,
    money: MONEY,
    timeZone: "Europe/Moscow",
    template: FULL,
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

/** Запоминает, с каким `draft_id` сборка позвала порт: без этого чужое или пустое значение в `view_id` оставалось бы
 *  зелёным (замечание повторного ревью К4 № 4). */
function viewIdSpy(value = VIEW_ID): { readonly fn: (draftId: string) => string; readonly seen: string[] } {
  const seen: string[] = [];
  return {
    fn: (draftId) => {
      seen.push(draftId);
      return value;
    },
    seen,
  };
}

/** У сборки тела осталась **одна** зависимость — выдача `view_id`. Язык и тексты приходят с показом внутри исхода
 *  (К4а), поэтому подать подпись действия из другого перечня или на другом языке больше нечем. */
const deps = (over: Partial<ResponseDeps> = {}): ResponseDeps => ({
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
    // Ожидание считается от **показанной** карточки и версии показа — того же исхода, что уехал экрану.
    expect(res.body.view.hash).toBe(showingHash({ text_version: texts.text_version, card: res.body.card }));
    expect(res.body.view.text_version).toBe(texts.text_version);
    expect(isShownHash(res.body.view.hash)).toBe(true);
  });

  it("второй режим подтверждения тоже доезжает до показанного: своя строка и свой хэш", () => {
    const immediate = draftBody(outcomeWithCard(), deps());
    const autonomous = draftBody(
      buildIntentDraft(PHRASE, draftDeps({ template: { ...FULL, confirmation_mode: "AUTONOMOUS" } })),
      deps(),
    );
    // Оба тела сужаются до ветки карточки: с необязательной цепочкой сравнение хэшей прошло бы вхолостую, будь
    // `view` равен `null` (замечание повторного ревью К4 № 6).
    if (!immediate.ok || !autonomous.ok) throw new Error("ожидались тела");
    if (immediate.body.card === null || autonomous.body.card === null) throw new Error("ожидались карточки");
    expect(autonomous.body.card.confirmation_mode).toBe("AUTONOMOUS");
    expect(autonomous.body.card.lines.at(-1)?.code).toBe("CONFIRMATION_AUTONOMOUS");
    expect(autonomous.body.view.hash).not.toBe(immediate.body.view.hash);
  });

  /** К4а (находки № 1 и № 2): подпись действия и карточка берутся из **одного** показа, названного в исходе. Подать
   *  другой перечень текстов или другой язык сборке тела нечем — у неё осталась одна зависимость, выдача `view_id`.
   *  Проверяется и тем, что английский показ даёт английскую подпись без единого слова от сборки тела. */
  it("подпись действия — из того же показа, что карточка: второго источника текстов нет", () => {
    const ru = draftBody(outcomeWithCard(), deps());
    const en = draftBody(buildIntentDraft(PHRASE, draftDeps({ lang: "en" })), deps());
    if (!ru.ok || !en.ok) throw new Error("ожидались тела");
    expect(ru.body.actions.submit.label).toBe(texts.actions.submit_label.ru);
    expect(en.body.actions.submit.label).toBe(texts.actions.submit_label.en);
    // У зависимостей сборки тела — ровно одно поле: `viewId`. Язык и тексты подать негде.
    expect(Object.keys(deps())).toEqual(["viewId"]);
  });

  it("`view.text_version` — версия показа из исхода, и она же в хэше", () => {
    const out = outcomeWithCard();
    const res = draftBody(out, deps());
    if (!res.ok || res.body.card === null || out.kind !== "card") throw new Error("ожидалась карточка");
    expect(out.show.texts.text_version).toBe(texts.text_version);
    expect(res.body.view.text_version).toBe(out.show.texts.text_version);
    expect(res.body.view.hash).toBe(showingHash(shownOf(out)));
    // Та же карточка с другой версией текстов даёт другой хэш: «сменились тексты — сменился хэш» (правило 1).
    expect(showingHash({ text_version: "u1-card@9.9", card: res.body.card })).not.toBe(res.body.view.hash);
  });

  it("`view_id` берётся у порта по `draft_id` этого показа, и его форма проверяется", () => {
    const spy = viewIdSpy();
    const res = draftBody(outcomeWithCard(), deps({ viewId: spy.fn }));
    if (!res.ok) throw new Error("ожидалось тело");
    expect(spy.seen).toEqual(["drf_k4"]);
    expect(res.body.view?.view_id).toBe(VIEW_ID);
    expect(() => draftBody(outcomeWithCard(), deps({ viewId: () => "" }))).toThrow(/vw_/);
    expect(() => draftBody(outcomeWithCard(), deps({ viewId: () => "drf_k4" }))).toThrow(/vw_/);
  });

  /** Строки-пояснения входят в показанное: человек читает их и подписывает прочитанное (правило 1). Подмена одной
   *  строки меняет хэш — иначе подменённый текст прошёл бы как тот же самый. */
  it("подмена строки-пояснения меняет хэш, подмена порядка строк — тоже", () => {
    const out = outcomeWithCard();
    if (out.kind !== "card") throw new Error("ожидалась карточка");
    const base = showingHash(shownOf(out));
    const version = out.show.texts.text_version;

    const other: IntentCard = {
      ...out.card,
      lines: out.card.lines.map((l, i) => (i === 0 ? { ...l, text: `${l.text} и ещё` } : l)),
    };
    expect(showingHash({ text_version: version, card: other })).not.toBe(base);

    const reordered: IntentCard = { ...out.card, lines: [...out.card.lines].reverse() };
    expect(showingHash({ text_version: version, card: reordered })).not.toBe(base);
  });

  it("другой язык — другая карточка и другой хэш: подтверждают именно прочитанные тексты", () => {
    const ru = draftBody(buildIntentDraft(PHRASE, draftDeps()), deps());
    const en = draftBody(buildIntentDraft(PHRASE, draftDeps({ lang: "en" })), deps());
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
        draftDeps({ lang, template: { subject: FULL.subject } }),
      );
      const res = draftBody(outcome, deps());
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

  /** Хэш «по пустому месту» теперь невозможен **типом**: `shownOf` принимает только ветку карточки исхода, а в
   *  ветке вопросов карточки нет (К4а, находка № 2 — произвольную пару «версия + карточка» снаружи не собрать). */
  it("показанного без карточки не бывает: `shownOf` принимает только ветку карточки", () => {
    const out = outcomeWithQuestions();
    // @ts-expect-error — ветка вопросов показанного не даёт: ни карточки, ни хэша
    expect(() => shownOf(out)).toBeDefined();
    const card = outcomeWithCard();
    if (card.kind !== "card") throw new Error("ожидалась карточка");
    expect(shownOf(card).card).toBe(card.card);
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
