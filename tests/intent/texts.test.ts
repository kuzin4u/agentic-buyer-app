// П-К4, К3 — строки-пояснения карточки и тексты вопросов данными в `config/` на двух языках (§ 5.1, правило планов
// № 3). Источник перечней — код и файл, литералов перечней в тесте нет (Р-1511): тест сверяет, что они совпадают.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { formatInstant } from "../../src/format.js";
import { DRAFT_KEYS, type IntentDraft } from "../../src/intent/model.js";
import {
  LINE_CODES,
  LINE_SLOTS,
  linesFor,
  parseIntentTexts,
  questionTextFor,
  type IntentTexts,
  type LinesDeps,
} from "../../src/intent/texts.js";
import { hitsForbidden } from "../support/forbidden-fields.js";

const CONFIG = new URL("../../config/intent.default.json", import.meta.url);
const raw: unknown = JSON.parse(readFileSync(CONFIG, "utf8"));
const texts: IntentTexts = parseIntentTexts(raw);

/** Показ суммы — порт (`MoneyText`): его заполняет сборка сервера, а в приложении он один и живёт у окна Б
 *  (`formatUiMoney`, `src/ui-server/money.ts`). Здесь нарочно **не формат, а метка**: проверяется подстановка строки,
 *  а не форматирование суммы — у форматирования свой тест там, где он объявлен. Второй копии формулы в окне А нет. */
const money = (m: { readonly amount: number; readonly currency: string }, lang: string): string =>
  `«сумма ${m.amount} ${m.currency} на ${lang}»`;

const draft = (over: Partial<IntentDraft> = {}): IntentDraft => ({
  subject: "хлеб",
  limit: { amount: 100_000, currency: "RUB" },
  valid_to: "2026-11-27T09:00:00.000Z",
  merchants: ["MER-1", "MER-2"],
  confirmation_mode: "IMMEDIATE",
  ...over,
});

/** Пояс назван — он часть показанного; у сюжетов стенда это пояс процесса, здесь — явный. */
const ZONE = "Europe/Moscow";

const deps = (over: Partial<LinesDeps> = {}): LinesDeps => ({
  lang: "ru",
  texts,
  money,
  timeZone: ZONE,
  ...over,
});

describe("К3: тексты карточки — данными в `config/`", () => {
  it("файл разбирается, и его ключи — ровно перечни кодов из кода", () => {
    expect(Object.keys(texts.lines)).toEqual([...LINE_CODES]);
    expect(Object.keys(texts.questions)).toEqual([...DRAFT_KEYS]);
    expect(texts.text_version).toBe("u1-card@1.0");
  });

  it("каждая строка есть на двух языках, и ru по-русски, en по-английски — перестановка языков красная", () => {
    for (const code of LINE_CODES) {
      expect(texts.lines[code].ru, code).not.toBe(texts.lines[code].en);
      // Алфавит — у строк тоже, не только у вопросов: без этого перестановка ru↔en осталась бы зелёной
      // (ревью К3 В5). Подстановки из проверки убираются: `{limit}` латиницей есть и в русской строке.
      const bare = (s: string): string => s.replace(/\{[a-z_]+\}/g, "");
      expect(bare(texts.lines[code].ru), code).toMatch(/[А-Яа-яЁё]/);
      expect(bare(texts.lines[code].en), code).toMatch(/[A-Za-z]/);
      expect(bare(texts.lines[code].en), code).not.toMatch(/[А-Яа-яЁё]/);
    }
    for (const field of DRAFT_KEYS) {
      expect(texts.questions[field].en, field).not.toBe(texts.questions[field].ru);
      expect(texts.questions[field].en, field).toMatch(/[A-Za-z]/);
      expect(texts.questions[field].ru, field).toMatch(/[А-Яа-яЁё]/);
    }
  });

  describe("разбор отвергает негодный файл", () => {
    const broken = (fix: (r: Record<string, unknown>) => void): unknown => {
      const copy = JSON.parse(JSON.stringify(raw)) as Record<string, unknown>;
      fix(copy);
      return copy;
    };

    it("пропавший код строки", () => {
      expect(() =>
        parseIntentTexts(broken((r) => delete (r["lines"] as Record<string, unknown>)["LIMIT"])),
      ).toThrow(/intent\.lines\.LIMIT/);
    });

    it("лишний код строки", () => {
      expect(() =>
        parseIntentTexts(broken((r) => ((r["lines"] as Record<string, unknown>)["TOTAL"] = { ru: "и", en: "and" }))),
      ).toThrow(/кода нет в перечне/);
    });

    /** Пара ru/en одного кода в разобранной копии файла. */
    const lineOf = (r: Record<string, unknown>, code: string): Record<string, unknown> =>
      (r["lines"] as Record<string, unknown>)[code] as Record<string, unknown>;

    it("пропавший язык", () => {
      expect(() => parseIntentTexts(broken((r) => delete lineOf(r, "SUBJECT")["en"]))).toThrow(
        /intent\.lines\.SUBJECT\.en/,
      );
    });

    it("забытая подстановка: `{limit}` пропал из английской строки", () => {
      expect(() =>
        parseIntentTexts(
          broken((r) => {
            lineOf(r, "LIMIT")["en"] = "No more than the limit";
          }),
        ),
      ).toThrow(/нет подстановки \{limit\}/);
    });

    it("чужая подстановка: `{count}` в строке предела", () => {
      expect(() =>
        parseIntentTexts(
          broken((r) => {
            lineOf(r, "LIMIT")["ru"] = "Не больше {count}";
          }),
        ),
      ).toThrow(/подстановка \{count\} здесь не бывает/);
    });

    it("вопрос на поле, которого нет в § 5.1", () => {
      expect(() =>
        parseIntentTexts(
          broken((r) => ((r["questions"] as Record<string, unknown>)["budget"] = { ru: "Сколько?", en: "How much?" })),
        ),
      ).toThrow(/поля нет в § 5\.1/);
    });

    it("лишний язык", () => {
      expect(() =>
        parseIntentTexts(
          broken((r) => {
            lineOf(r, "SUBJECT")["de"] = "Kaufen: {subject}";
          }),
        ),
      ).toThrow(/лишний язык/);
    });

    it("лишнее поле верхнего уровня", () => {
      // `actions` — законный раздел с К4, поэтому «лишнее» проверяется на разделе, которого в файле нет.
      expect(() => parseIntentTexts(broken((r) => (r["brand"] = {})))).toThrow(/intent\.brand: лишнее поле/);
    });

    it("лишний ключ действия и пропавший ключ действия", () => {
      expect(() =>
        parseIntentTexts(broken((r) => ((r["actions"] as Record<string, unknown>)["cancel_label"] = { ru: "и", en: "and" }))),
      ).toThrow(/ключа нет в перечне/);
      // Сверяется **текст своей** ошибки разбора, а не любой с этим путём: иначе случай прошёл бы и при падении по
      // другой причине (ревью К4 № 7).
      expect(() =>
        parseIntentTexts(broken((r) => delete (r["actions"] as Record<string, unknown>)["submit_label"])),
      ).toThrow("intent.actions.submit_label: ожидается объект");
    });

    it("пустой или пропавший `text_version`", () => {
      expect(() => parseIntentTexts(broken((r) => (r["text_version"] = "  ")))).toThrow(/text_version/);
      expect(() => parseIntentTexts(broken((r) => delete r["text_version"]))).toThrow(/text_version/);
    });

    it("у вопроса пропал язык", () => {
      expect(() =>
        parseIntentTexts(
          broken((r) => delete ((r["questions"] as Record<string, unknown>)["limit"] as Record<string, unknown>)["en"]),
        ),
      ).toThrow(/intent\.questions\.limit/);
    });
  });

  /** Инвариант 1 — и по объявленным полям модуля, и по **самим текстам**: вопрос «введите номер карты» в файле
   *  настройки нарушил бы инвариант 1, а до этой проверки ничего бы не покраснело (ревью К3 З7). */
  describe("инвариант 1: ни в модуле, ни в текстах настройки реквизитов нет", () => {
    it("объявленные поля модуля чисты", () => {
      const text = readFileSync(new URL("../../src/intent/texts.ts", import.meta.url), "utf8");
      const keys = [...new Set([...text.matchAll(/\b([a-z_][a-z0-9_]*)\??\s*:/gi)].map((m) => m[1] as string))];
      expect(keys.length).toBeGreaterThan(5);
      for (const key of keys) expect(hitsForbidden(key), key).toBe(false);
    });

    it("ни одна строка и ни один вопрос не просят реквизит", () => {
      const all = [
        ...LINE_CODES.flatMap((c) => [texts.lines[c].ru, texts.lines[c].en]),
        ...DRAFT_KEYS.flatMap((f) => [texts.questions[f].ru, texts.questions[f].en]),
      ];
      expect(all.length).toBe((LINE_CODES.length + DRAFT_KEYS.length) * 2);
      for (const s of all) {
        expect(hitsForbidden(s), s).toBe(false);
        expect(s, s).not.toMatch(/номер карты|CVV|CVC|реквизит/i);
      }
    });
  });

  it("у каждого кода назван перечень подстановок", () => {
    expect(Object.keys(LINE_SLOTS)).toEqual([...LINE_CODES]);
  });
});

describe("К3: строки-пояснения карточки", () => {
  it("пять строк в порядке полей § 5.1; сумма — от порта, срок — текстом по языку и поясу", () => {
    expect(linesFor(draft(), deps())).toEqual([
      { code: "SUBJECT", text: "Покупаем: хлеб" },
      // Сумма — ровно то, что отдал порт: своего формата у строк нет.
      { code: "LIMIT", text: "Не больше «сумма 100000 RUB на ru» за всё поручение" },
      { code: "VALID_TO", text: `Действует до ${formatInstant("2026-11-27T09:00:00.000Z", "ru", ZONE)}` },
      { code: "MERCHANTS", text: "Продавцов: 2" },
      { code: "CONFIRMATION_IMMEDIATE", text: texts.lines.CONFIRMATION_IMMEDIATE.ru },
    ]);
  });

  it("срок показан датой и временем до минут, а не строкой ISO 8601", () => {
    const line = linesFor(draft(), deps())[2]?.text ?? "";
    expect(line).not.toContain("2026-11-27T09:00:00.000Z");
    expect(line).toMatch(/\d{2}\.\d{2}\.2026, \d{2}:\d{2}/);
  });

  /** Пояс — часть показанного: в двух поясах один и тот же срок читается по-разному, и человек подписывает именно
   *  прочитанное. Поэтому пояс назван, а не взят у процесса (ревью К3 В4). */
  it("названный пояс меняет текст срока: Москва и Токио дают разное время", () => {
    const moscow = linesFor(draft(), deps())[2]?.text;
    const tokyo = linesFor(draft(), deps({ timeZone: "Asia/Tokyo" }))[2]?.text;
    expect(moscow).not.toBe(tokyo);
    expect(moscow).toContain("12:00");
    expect(tokyo).toContain("18:00");
  });

  it("неизвестный пояс — исключение, а не срок в чужом поясе", () => {
    expect(() => linesFor(draft(), deps({ timeZone: "Europe/Атлантида" }))).toThrow();
  });

  it("английские строки — те же коды и порядок, текст другой", () => {
    const ru = linesFor(draft(), deps());
    const en = linesFor(draft(), deps({ lang: "en" }));
    expect(en.map((l) => l.code)).toEqual(ru.map((l) => l.code));
    for (let i = 0; i < en.length; i++) expect(en[i]?.text, en[i]?.code).not.toBe(ru[i]?.text);
    expect(en[0]).toEqual({ code: "SUBJECT", text: "Buying: хлеб" });
  });

  /** Два текста режима привязаны к своему значению по смыслу, а не только по коду: перестановка самих текстов между
   *  кодами оставила бы человека с карточкой `IMMEDIATE` и словами «без отдельного подтверждения» (ревью К3 В5). */
  it("режим подтверждения — своя строка у каждого значения, и текст про своё", () => {
    const immediate = linesFor(draft(), deps()).at(-1);
    expect(immediate?.code).toBe("CONFIRMATION_IMMEDIATE");
    expect(immediate?.text).toContain("подтверждаете вы");

    const autonomous = linesFor(draft({ confirmation_mode: "AUTONOMOUS" }), deps()).at(-1);
    expect(autonomous?.code).toBe("CONFIRMATION_AUTONOMOUS");
    expect(autonomous?.text).toContain("без отдельного подтверждения");
  });

  /** Закрытый перечень не молчит: каждый код `LINE_CODES` попадает на карточку хотя бы при одном режиме
   *  подтверждения. Иначе код, заведённый в перечне и в `config/`, остался бы строкой, которую никто не видит
   *  (ревью К3 В1). */
  it("каждый код перечня показывается: объединение по двум режимам — ровно `LINE_CODES`", () => {
    const shown = new Set([
      ...linesFor(draft(), deps()).map((l) => l.code),
      ...linesFor(draft({ confirmation_mode: "AUTONOMOUS" }), deps()).map((l) => l.code),
    ]);
    expect([...shown].sort()).toEqual([...LINE_CODES].sort());
  });

  /** Число продавцов берётся у черновика: поданное отдельно разошлось бы с перечнем поручения (ревью К3 В2). */
  it("число продавцов — длина перечня этого же черновика", () => {
    expect(linesFor(draft(), deps())[3]).toEqual({ code: "MERCHANTS", text: "Продавцов: 2" });
    expect(linesFor(draft({ merchants: ["MER-7"] }), deps())[3]).toEqual({
      code: "MERCHANTS",
      text: "Продавцов: 1",
    });
  });

  /** Отказ показа суммы наружу не гасится: лучше не показать карточку, чем показать предел не в том масштабе
   *  (шапка `src/iso4217.ts`). Порт здесь — тот, что бросает, как это делает `formatUiMoney` окна Б. */
  it("отказ показа суммы проходит наружу, а не превращается в пустое место на карточке", () => {
    const throwing = (): string => {
      throw new RangeError("сумма /ui/v1: валюты XXX нет в таблице ISO 4217");
    };
    expect(() =>
      linesFor(draft({ limit: { amount: 100, currency: "XXX" } }), deps({ money: throwing })),
    ).toThrow(/ISO 4217/);
  });

  it("срок не по форме — исключение, а не «Invalid Date» на карточке", () => {
    expect(() => linesFor(draft({ valid_to: "когда-нибудь" }), deps())).toThrow(/время не по форме/);
  });

  it("тексты вопросов отдаются на языке запроса — у всех пяти полей § 5.1", () => {
    for (const field of DRAFT_KEYS) {
      expect(questionTextFor(texts, "ru")(field)).toBe(texts.questions[field].ru);
      expect(questionTextFor(texts, "en")(field)).toBe(texts.questions[field].en);
    }
  });
});
