// П-К4, К2 — сборка карточки поручения из шаблона и уточняющие вопросы (К-Б § 5.1, решение П33).
// Шаблон фикстуры — **из сборки стенда** (`src/demo/scenarios.ts` и набор витрин), не литералом (Р-1511): так тест
// ловит расхождение с шаблоном, из которого карточка собирается на самом деле. Разные сущности — разные значения
// (решение владельца 16.11): идентификатор черновика, подписи продавцов и предмет различимы.
import { readFileSync } from "node:fs";
import { MERCHANT_FIXTURES } from "agentic-ps-platform/fixtures";
import { describe, expect, it } from "vitest";
// Шаблон стенда и контрактная карточка — **разные типы с одним именем** (КТ0, нюанс 1): здесь псевдоним, чтобы
// совпадение имён не прочиталось как один тип.
import {
  INTENT_CARD as DEMO_TEMPLATE_CARD,
  INTENT_CARD_SCOPE,
  demoIntent,
  intentCardLabels,
  merchantLabel,
} from "../../src/demo/scenarios.js";
import { cardLikeNumber } from "../support/card-like.js";
import { ALLOWED_EXAMPLES, FORBIDDEN_EXAMPLES, hitsForbidden } from "../support/forbidden-fields.js";
import {
  QUESTION_CODES,
  REDACTED,
  buildIntentDraft,
  createIntentDraftStore,
  redactPhrase,
  type DraftDeps,
  type IntentDraftEntry,
  type IntentQuestionCode,
  type IntentTemplate,
} from "../../src/intent/draft.js";
import { DRAFT_KEYS, type IntentDraft } from "../../src/intent/model.js";
// Строки-пояснения — те же, что на стенде: разбор `config/intent.default.json` (К3), не фикстура в тесте.
import { linesFor, parseIntentTexts } from "../../src/intent/texts.js";

const TEXTS = parseIntentTexts(JSON.parse(readFileSync(new URL("../../config/intent.default.json", import.meta.url), "utf8")));

/** Показ суммы — порт К3 (`MoneyText`): в приложении он один и живёт у окна Б (`formatUiMoney`,
 *  `src/ui-server/money.ts`), поэтому здесь метка, а не формат. */
const MONEY_TEXT = (m: { readonly amount: number; readonly currency: string }, lang: string): string =>
  `«сумма ${m.amount} ${m.currency} на ${lang}»`;

const NOW = "2026-11-20T09:00:00.000Z";
const PHRASE = "хлеб на выходные, до 1000 ₽, один раз";

/** Тексты вопросов на двух языках: до К3 они живут в фикстуре, после — данными `config/`. Перечень ключей — это
 *  `QUESTION_CODES`, поэтому забытый вопрос здесь не соберётся. */
const QUESTION_TEXTS: Record<"ru" | "en", Record<IntentQuestionCode, string>> = {
  ru: {
    subject: "Что покупаем?",
    limit: "Сколько денег не больше?",
    valid_to: "До какого срока?",
    merchants: "У кого покупаем?",
    confirmation_mode: "Подтверждать каждую покупку?",
  },
  en: {
    subject: "What are we buying?",
    limit: "What is the spending limit?",
    valid_to: "Until when?",
    merchants: "Which merchants?",
    confirmation_mode: "Confirm every purchase?",
  },
};

/** Шаблон стенда в форме порта: предмет, предел и продавцы — из сюжета 1, срок — момент времени (перевод «7 дней» в
 *  момент делает тот, кто подаёт шаблон), режим подтверждения — из `demoIntent`, где его и держит стенд. */
function standTemplate(card = DEMO_TEMPLATE_CARD): IntentTemplate {
  const core = demoIntent(new Date(NOW), card);
  // Подписи — из **источника стенда** (`intentCardLabels`), формула здесь не повторяется (ревью К2 В3).
  const labels = intentCardLabels(card);
  return {
    subject: card.subject,
    limit: card.limit,
    valid_to: core.validTo,
    merchants: core.merchantScope.map((id, i) => ({ id, label: labels[i] as string })),
    confirmation_mode: core.confirmationMode,
  };
}

/** Шаблон без одного поля — так проверяется правило «чего шаблон не заявил, то и спрашивается». Поле убирается по
 *  коду вопроса, а не переписыванием шаблона целиком: иначе случай перестал бы отличаться от «другого шаблона». */
function withoutField(t: IntentTemplate, code: IntentQuestionCode): IntentTemplate {
  const copy: Record<string, unknown> = { ...t };
  delete copy[code];
  return copy as IntentTemplate;
}

function deps(over: Partial<DraftDeps> = {}): DraftDeps & { readonly entries: IntentDraftEntry[] } {
  const entries: IntentDraftEntry[] = [];
  let no = 0;
  return {
    lang: "ru",
    template: standTemplate(),
    questionText: (code) => QUESTION_TEXTS.ru[code],
    lines: (d) => linesFor(d, { lang: "ru", texts: TEXTS, money: MONEY_TEXT, timeZone: "Europe/Moscow" }),
    store: createIntentDraftStore(),
    journal: { write: (entry) => entries.push(entry) },
    newDraftId: () => `drf_k2_${++no}`,
    now: () => NOW,
    entries,
    ...over,
  };
}

describe("К2: карточка из шаблона", () => {
  it("полный шаблон — карточка собрана, вопросов нет, черновик лежит в хранилище под выданным `draft_id`", () => {
    const d = deps();
    const out = buildIntentDraft(PHRASE, d);
    expect(out.kind).toBe("card");
    if (out.kind !== "card") return;

    expect(out.draft_id).toBe("drf_k2_1");
    expect(out.questions).toEqual([]);
    // Предмет, предел и продавцы — из условий сюжета стенда, не литералом (Р-1511; ревью К2 З2). Срок — число:
    // «семь дней сюжета от времени сервера», посчитанное здесь, а не вызовом того же кода (постановка, п. 67).
    expect(out.card).toEqual({
      subject: DEMO_TEMPLATE_CARD.subject,
      limit: DEMO_TEMPLATE_CARD.limit,
      valid_to: "2026-11-27T09:00:00.000Z",
      merchants: {
        count: MERCHANT_FIXTURES.length,
        labels: MERCHANT_FIXTURES.map(merchantLabel),
      },
      confirmation_mode: "IMMEDIATE",
      // Строки-пояснения приходят портом (К3). Ожидание записано **кодами по § 5.1**, а не вызовом того же
      // `linesFor`: сравнение функции с собой зелено при любой её правке (ревью К3 З1; постановка, п. 67).
      lines: [
        { code: "SUBJECT", text: expect.stringContaining(DEMO_TEMPLATE_CARD.subject) as unknown as string },
        { code: "LIMIT", text: expect.any(String) as unknown as string },
        { code: "VALID_TO", text: expect.any(String) as unknown as string },
        { code: "MERCHANTS", text: `Продавцов: ${MERCHANT_FIXTURES.length}` },
        { code: "CONFIRMATION_IMMEDIATE", text: expect.any(String) as unknown as string },
      ],
    });
    // Черновик — не карточка: продавцы списком идентификаторов, `lines` у него нет (К1).
    expect(d.store.get(out.draft_id)).toEqual({
      subject: DEMO_TEMPLATE_CARD.subject,
      limit: DEMO_TEMPLATE_CARD.limit,
      valid_to: "2026-11-27T09:00:00.000Z",
      merchants: MERCHANT_FIXTURES.map((f) => f.merchant_id),
      confirmation_mode: "IMMEDIATE",
    } satisfies IntentDraft);
  });

  it("число продавцов на карточке равно длине перечня в поручении — у поручения с одним продавцом тоже", () => {
    const out = buildIntentDraft(PHRASE, deps({ template: standTemplate(INTENT_CARD_SCOPE) }));
    expect(out.kind).toBe("card");
    if (out.kind !== "card") return;
    expect(out.card.merchants.count).toBe(1);
    // Подписи — те, что заявил сюжет 8 в своём `scopeLabels`, а не собранные заново.
    expect(out.card.merchants.labels).toEqual(INTENT_CARD_SCOPE.scopeLabels);
    expect(out.draft.merchants).toEqual(INTENT_CARD_SCOPE.scope);
  });

  /** Строки К2 не выдумывает: он их не составляет и не правит, а берёт у порта. Проверяется подменой порта — так
   *  видно, что на карточку уехало именно отданное, в том же порядке. */
  it("строки-пояснения карточка берёт у порта, своих не добавляет", () => {
    const given = [{ code: "LIMIT", text: "строка порта" }];
    const out = buildIntentDraft(PHRASE, deps({ lines: () => given }));
    expect(out.kind === "card" && out.card.lines).toEqual(given);
  });

  it("строки собираются по тому же черновику, который уехал в хранилище", () => {
    let seen: unknown = null;
    const d = deps({
      lines: (draft) => {
        seen = draft;
        return [];
      },
    });
    const out = buildIntentDraft(PHRASE, d);
    expect(out.kind === "card" && out.draft).toBe(seen);
    expect(out.kind === "card" && d.store.get(out.draft_id)).toBe(seen);
  });
});

describe("К2: уточняющие вопросы — чего шаблон не заявил, то и спрашивается", () => {
  it("шаблон без режима подтверждения — один вопрос, карточки нет, умолчание не подставлено", () => {
    const d = deps({ template: withoutField(standTemplate(), "confirmation_mode") });
    const out = buildIntentDraft(PHRASE, d);

    expect(out).toEqual({
      kind: "questions",
      draft_id: "drf_k2_1",
      questions: [{ id: "confirmation_mode", text: "Подтверждать каждую покупку?" }],
      // Язык показа назван в исходе: тело § 5.1 не собирается из русской карточки и английской кнопки (ревью К4 № 3).
      lang: "ru",
    });
    // Ни карточки, ни черновика: нечего подписывать, пока человек не ответил.
    expect(d.store.get("drf_k2_1")).toBeNull();
  });

  /** Пять кодов записаны здесь **ожиданием по § 5.1**, а не взяты у `DRAFT_KEYS`: сверка `QUESTION_CODES` с
   *  `DRAFT_KEYS` была бы сравнением перечня с самим собой — в коде это один и тот же объект, и покраснеть такое
   *  ожидание не может ни при какой правке (ревью К2 В2; постановка, п. 67). Совпадение кодов с полями черновика
   *  держится компиляцией в `src/intent/draft.ts` (`CodesAreDraftFields`). */
  const FIVE = ["subject", "limit", "valid_to", "merchants", "confirmation_mode"];

  it("пустой шаблон — пять вопросов в порядке полей § 5.1, и спросить можно только их", () => {
    const out = buildIntentDraft(PHRASE, deps({ template: {} }));
    expect(out.kind === "questions" && out.questions.map((q) => q.id)).toEqual(FIVE);
    expect(QUESTION_CODES).toEqual(FIVE);
    expect(DRAFT_KEYS).toEqual(FIVE);
  });

  it("`null` в шаблоне — это вопрос, а не негодное поле: сказать нечего и подставить нечего", () => {
    const template = { ...standTemplate(), subject: null as unknown as string };
    const out = buildIntentDraft(PHRASE, deps({ template }));
    expect(out.kind === "questions" && out.questions.map((q) => q.id)).toEqual(["subject"]);
  });

  it("вопросы приходят на языке запроса — английский даёт те же коды и другие тексты", () => {
    const out = buildIntentDraft(PHRASE, deps({ template: {}, questionText: (c) => QUESTION_TEXTS.en[c] }));
    expect(out.kind === "questions" && out.questions).toEqual([
      { id: "subject", text: "What are we buying?" },
      { id: "limit", text: "What is the spending limit?" },
      { id: "valid_to", text: "Until when?" },
      { id: "merchants", text: "Which merchants?" },
      { id: "confirmation_mode", text: "Confirm every purchase?" },
    ]);
  });

  it("вопрос без текста — ошибка сборки, а не вопрос без слов", () => {
    expect(() => buildIntentDraft(PHRASE, deps({ template: {}, questionText: () => "  " }))).toThrow(/нет текста/);
  });
});

describe("К2: фраза и журнал", () => {
  it("фраза пишется в журнал с идентификатором черновика и перечнем вопросов", () => {
    const d = deps();
    buildIntentDraft(PHRASE, d);
    expect(d.entries).toEqual([
      { event: "intent.draft", draft_id: "drf_k2_1", phrase: PHRASE, redacted: false, questions: [], at: NOW },
    ]);
  });

  it("неполный шаблон — в журнале те же вопросы, что ушли экрану", () => {
    const d = deps({ template: withoutField(standTemplate(), "limit") });
    buildIntentDraft(PHRASE, d);
    expect(d.entries[0]?.questions).toEqual(["limit"]);
  });

  it("фразы нет — ни журнала, ни идентификатора: это негодное тело запроса", () => {
    for (const phrase of ["", "   ", undefined, null, 42]) {
      const d = deps();
      expect(buildIntentDraft(phrase, d)).toEqual({ kind: "phrase_empty" });
      expect(d.entries).toEqual([]);
    }
  });

  /** Инвариант 1 сильнее контракта: фраза — свободный текст человека, и платёжных реквизитов в журнале быть не может,
   *  даже если их вписал сам человек. Строка в проверке — **не номер карты и не секрет**: её собирает во время теста
   *  общий генератор `cardLikeNumber` (префикс 9 и одинаковые цифры — вне диапазонов выпуска схем), в файлах её нет. */
  it("длинный цифровой ряд во фразе в журнал не попадает, и подмена текста названа", () => {
    const d = deps();
    const out = buildIntentDraft(`хлеб, оплата ${cardLikeNumber("7")}, до 1000 ₽`, d);
    expect(out.kind).toBe("card");
    expect(d.entries[0]?.phrase).toBe(`хлеб, оплата ${REDACTED}, до 1000 ₽`);
    expect(d.entries[0]?.redacted).toBe(true);
  });

  /** Ряд разрывают только значащие знаки, а не разделители: точка, слэш, неразрывный пробел и перевод строки
   *  приезжают при вставке из буфера, и до правки по ревью (К2 Б2) такой ряд уходил в журнал дословно. */
  it("разделители внутри ряда не спасают: точка, слэш, неразрывный пробел, перевод строки, дефис", () => {
    const groups = (sep: string) => {
      const n = cardLikeNumber("3");
      return [n.slice(0, 4), n.slice(4, 8), n.slice(8, 12), n.slice(12)].join(sep);
    };
    for (const sep of [".", "/", " ", "\n", "-", " ", "–"]) {
      const d = deps();
      buildIntentDraft(`хлеб, ${groups(sep)}`, d);
      expect(d.entries[0]?.redacted, sep).toBe(true);
      expect(d.entries[0]?.phrase, sep).toBe(`хлеб, ${REDACTED}`);
    }
  });

  it("ряд без разделителей и ряд длиннее карты тоже уходят", () => {
    for (const run of [cardLikeNumber("5"), `${cardLikeNumber("5")}00`, "123456789012"]) {
      expect(redactPhrase(`счёт ${run}`)).toEqual({ phrase: `счёт ${REDACTED}`, redacted: true });
    }
  });

  it("короткие числа фразы остаются: предел и количество — это условия поручения, а не реквизит", () => {
    for (const phrase of ["до 1000 ₽, 2 буханки, 7 дней", "до 12:00 25.11, не больше 3 заказов"])
      expect(redactPhrase(phrase)).toEqual({ phrase, redacted: false });
  });
});

describe("К2: негодный шаблон — ошибка сборки, а не отказ человеку", () => {
  /** Приём К1.3 П-К1: отказ не пишет ничего. Запись о запросе, кончившемся исключением, да ещё с `questions: []`,
   *  читалась бы на разборе как собравшаяся карточка (ревью К2 В4). */
  it("исключение не оставляет записи в журнале — ни о шаблоне, ни о вопросе без текста", () => {
    const bad = deps({ template: { ...standTemplate(), valid_to: "2026-11-19T09:00:00.000Z" } });
    expect(() => buildIntentDraft(PHRASE, bad)).toThrow();
    expect(bad.entries).toEqual([]);

    const noText = deps({ template: {}, questionText: () => "" });
    expect(() => buildIntentDraft(PHRASE, noText)).toThrow();
    expect(noText.entries).toEqual([]);
  });

  /** Порт строк бросает по замыслу К3 (валюта вне таблицы ISO 4217, срок не по форме, неизвестный пояс). Тогда ни
   *  записи, ни черновика быть не должно: иначе в журнале осталась бы «карточка собралась целиком», а в хранилище —
   *  черновик под выданным `draft_id` (ревью К3 Б1). */
  it("порт строк бросил — ни записи в журнале, ни черновика в хранилище", () => {
    const d = deps({
      lines: () => {
        throw new RangeError("сумма /ui/v1: валюты XXX нет в таблице ISO 4217");
      },
    });
    expect(() => buildIntentDraft(PHRASE, d)).toThrow(/ISO 4217/);
    expect(d.entries).toEqual([]);
    expect(d.store.get("drf_k2_1")).toBeNull();
  });

  it("срок шаблона в прошлом — исключение с причиной от `checkDraft`", () => {
    const template = { ...standTemplate(), valid_to: "2026-11-19T09:00:00.000Z" };
    expect(() => buildIntentDraft(PHRASE, deps({ template }))).toThrow(/VALID_TO_PAST/);
  });

  it("продавец назван в шаблоне дважды — исключение: карточка показала бы продавцов больше, чем в поручении", () => {
    const t = standTemplate(INTENT_CARD_SCOPE);
    const template = { ...t, merchants: [...(t.merchants ?? []), ...(t.merchants ?? [])] };
    expect(() => buildIntentDraft(PHRASE, deps({ template }))).toThrow(/MERCHANT_DUPLICATE/);
  });

  it("идентификатор черновика не в форме `drf_…` — исключение: по нему К5 будет искать черновик", () => {
    expect(() => buildIntentDraft(PHRASE, deps({ newDraftId: () => "pur_1" }))).toThrow(/drf_/);
  });

  it("хранилище черновиков замены не умеет: тот же `draft_id` второй раз — исключение", () => {
    const store = createIntentDraftStore();
    const d = deps({ store, newDraftId: () => "drf_same" });
    buildIntentDraft(PHRASE, d);
    expect(() => buildIntentDraft(PHRASE, d)).toThrow(/замены/);
  });
});

/** Инвариант 1 — по **объявленным полям модуля**, как в тесте К1 (а не по всему тексту: в комментариях слово
 *  «реквизит» законно). Перечень запретных имён — один на все тесты, `tests/support/forbidden-fields.ts`: своя копия
 *  в К2 была сужена и пропускала `expiry`, `kid`, `track2`, `credentials` (ревью К2 Б1, З1). */
describe("К2: инвариант 1 — реквизитов в модуле нет", () => {
  const text = readFileSync(new URL("../../src/intent/draft.ts", import.meta.url), "utf8");
  const declaredKeys = [...new Set([...text.matchAll(/\b([a-z_][a-z0-9_]*)\??\s*:/gi)].map((m) => m[1] as string))];

  it("поля в модуле объявлены — иначе проверка ничего не проверяет", () => {
    expect(declaredKeys).toContain("draft_id");
    expect(declaredKeys).toContain("redacted");
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
