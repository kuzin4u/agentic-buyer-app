// ИН-П2, кирпич К1 — данные экрана П4 и текст ПЭП (`config/passkey.default.json`). Постановка v1.1, П37 с
// дополнением 1; требования владельца 22.11.2026 по К1 (семь пунктов).
//
// Разбирается **тот же файл, что в работе** (Р-1511): своей копии данных в тестах нет, иначе проверялась бы копия.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createChallengeStore, issueChallenge, PASSKEY_REFUSAL_CODES } from "../../src/signature/webauthn.js";
import { parsePasskeyCatalog, PASSKEY_TEXT_CODES, type PasskeyTextCode } from "../../src/signature/texts.js";

const RAW: unknown = JSON.parse(readFileSync(new URL("../../config/passkey.default.json", import.meta.url), "utf8"));
const catalog = parsePasskeyCatalog(RAW);

/** Все значения текстов файла — для просева по обоим языкам. */
const values = (): readonly { readonly where: string; readonly lang: "ru" | "en"; readonly text: string }[] => {
  const out: { where: string; lang: "ru" | "en"; text: string }[] = [];
  const walk = (node: unknown, where: string): void => {
    if (node === null || typeof node !== "object") return;
    const rec = node as Record<string, unknown>;
    if (typeof rec["ru"] === "string" && typeof rec["en"] === "string") {
      out.push({ where, lang: "ru", text: rec["ru"] }, { where, lang: "en", text: rec["en"] });
      return;
    }
    for (const [k, v] of Object.entries(rec)) walk(v, `${where}.${k}`);
  };
  walk(RAW, "passkey");
  return out;
};

describe("данные экрана П4 разбираются и закрыты перечнями", () => {
  it("разбор отдаёт версию текстов, срок вызова и разделы", () => {
    expect(catalog.text_version).toBe("p4@1.0");
    // Срок вызова — **величиной данных** (П37 п. 3): в коде литерала нет, передаётся зависимостью.
    expect(catalog.challenge_ttl_ms).toBe(120_000);
    // Номера шага пути в данных **нет**: он приходит из канвы вместе с экраном (К5), и завести его раньше источника
    // значило бы поставить литерал против Р-1511 (находка ревью К1 № 1).
    expect(Object.keys(catalog.screen)).toEqual(["title", "subtitle", "footer", "register_label", "touch_label"]);
    // Версия текста ПЭП **своя**, не версия файла: юрист правит формулировку, не трогая экран (П37 п. 5).
    expect(catalog.pep.text_version).toBe("pep@1.0");
    expect(catalog.pep.text_version).not.toBe(catalog.text_version);
  });

  it("лишний раздел файла — ошибка, а не «на будущее»", () => {
    expect(() => parsePasskeyCatalog({ ...(RAW as object), levels: {} })).toThrow(/passkey.levels: лишний ключ/);
  });

  it("лишний ключ экрана и соглашения — ошибка", () => {
    const raw = RAW as { screen: object; pep: object };
    expect(() => parsePasskeyCatalog({ ...(RAW as object), screen: { ...raw.screen, hint: { ru: "а", en: "b" } } })).toThrow(/лишний ключ у экрана/);
    expect(() => parsePasskeyCatalog({ ...(RAW as object), pep: { ...raw.pep, legal: { ru: "а", en: "b" } } })).toThrow(/лишний ключ у соглашения/);
  });

  it("срок вызова вне границ не принимается", () => {
    for (const bad of [0, -1, 999, 600_001, 1.5]) {
      expect(() => parsePasskeyCatalog({ ...(RAW as object), challenge_ttl_ms: bad }), String(bad)).toThrow(/нужно целое от 1000 до 600000/);
    }
  });
});

describe("перечень кодов сверяется с источником в обе стороны", () => {
  it("текст есть у каждого кода проверки пасскея и у `SHOWN_STALE`", () => {
    // Перечень выводится из источника кодов, поэтому сравнивать его с собственным определением бессмысленно — это
    // тождество, а не сверка (находка ревью К1 № 4). Названо **число**: восемь кодов П37 с дополнением 1 плюс
    // `SHOWN_STALE`. Сам перечень-источник прибит литералом в `tests/signature/webauthn.test.ts`, и появление кода
    // без текста краснеет там и в разборе ниже.
    expect(PASSKEY_TEXT_CODES).toHaveLength(9);
    expect(PASSKEY_REFUSAL_CODES).toHaveLength(8);
    expect([...PASSKEY_TEXT_CODES].at(-1)).toBe("SHOWN_STALE");
    for (const code of PASSKEY_TEXT_CODES) {
      expect(catalog.errors[code].ru.length, code).toBeGreaterThan(10);
      expect(catalog.errors[code].en.length, code).toBeGreaterThan(10);
    }
  });

  it("восьмой код дополнения 1 получил свой текст — отказ не уходит без объяснения", () => {
    // Требование владельца 22.11.2026, п. 2: без текста `PASSKEY_USER_NOT_VERIFIED` ушёл бы человеку пустым.
    expect(catalog.errors.PASSKEY_USER_NOT_VERIFIED.ru).toContain("отпечаток");
    expect(catalog.errors.PASSKEY_USER_NOT_VERIFIED.en).toContain("fingerprint");
  });

  it("нет текста у кода — ошибка данных", () => {
    const raw = RAW as { errors: Record<string, unknown> };
    const rest = Object.fromEntries(Object.entries(raw.errors).filter(([code]) => code !== "PASSKEY_USER_NOT_VERIFIED"));
    expect(() => parsePasskeyCatalog({ ...(RAW as object), errors: rest })).toThrow(/passkey.errors.PASSKEY_USER_NOT_VERIFIED/);
  });

  it("текст у неизвестного кода — ошибка данных", () => {
    const raw = RAW as { errors: object };
    expect(() =>
      parsePasskeyCatalog({ ...(RAW as object), errors: { ...raw.errors, PASSKEY_WHATEVER: { ru: "а", en: "b" } } }),
    ).toThrow(/passkey.errors.PASSKEY_WHATEVER: неизвестный код отказа/);
  });

  it("перечень закрыт **на компиляции**: текста у неизвестного кода не завести типом", () => {
    // Гарантию даёт компиляция, и шаг воспроизведения назван (Р-1702): убери строку `@ts-expect-error` и запусти
    // `npx tsc --noEmit` — он покраснеет на неизвестном ключе. Под `vitest` этот случай зелёный независимо от типов.
    const errors: Record<PasskeyTextCode, { ru: string; en: string }> = {
      ...catalog.errors,
      // @ts-expect-error — перечень кодов закрыт: девятый код сюда не положить, не заведя его у источника
      PASSKEY_WHATEVER: { ru: "а", en: "b" },
    };
    expect(Object.keys(errors)).toContain("PASSKEY_USER_NOT_VERIFIED");
  });

  it("срок вызова из данных действительно питает проверку К3а", () => {
    // Связь «данные → код» проверяется исходом, а не обещанием: вызов, выданный с этим сроком, годен ровно до
    // `now + challenge_ttl_ms`. Литерала срока в коде нет — он пришёл из файла.
    const store = createChallengeStore();
    const issued = issueChallenge(
      { store, now: () => "2026-11-22T20:00:00.000Z", nonce: () => "nonce_k1", ttlMs: catalog.challenge_ttl_ms },
      { owner: "own_k1", purpose: "PAYMENT", purchase_id: "pur_k1", shown: { hash: `sha256:${"a".repeat(64)}`, text_version: "p4-pay@1.0" } },
    );
    expect(issued.expires_at).toBe("2026-11-22T20:02:00.000Z");
  });

  it("кодов переноса здесь нет: их текст — в словаре каркаса", () => {
    // Р-1719: в `config/` только то, чего нет у источника. `SESSION_REQUIRED` и ключи идемпотентности живут в
    // `src/ui-server/lang.ts`, и вторая копия разошлась бы молча.
    for (const code of ["SESSION_REQUIRED", "IDEMPOTENCY_REQUIRED", "IDEMPOTENCY_CONFLICT", "PURCHASE_NOT_FOUND"])
      expect(Object.keys(catalog.errors), code).not.toContain(code);
  });
});

describe("человеку не видно техники (Р-1684, Р-1715)", () => {
  it("латиницы в русских значениях нет", () => {
    for (const v of values().filter((x) => x.lang === "ru")) {
      expect(v.text, `${v.where}.ru: «${v.text}»`).not.toMatch(/[A-Za-z]/);
    }
  });

  it("ни названия протокола, ни кодов отказа — ни в одном значении", () => {
    const forbidden = [
      // техника: человеку она ничего не говорит
      "webauthn",
      "passkey",
      "fido",
      "credential",
      // обозначение уровня «с проверкой личности» — опознаватель, а не слово языка
      "gov_id",
      // коды отказа — машине, не человеку
      ...PASSKEY_TEXT_CODES.map((c) => c.toLowerCase()),
    ];
    for (const v of values())
      for (const bad of forbidden) expect(v.text.toLowerCase(), `${v.where}.${v.lang} содержит «${bad}»`).not.toContain(bad);
  });

  /**
   * Почему `simple` и `qualified` **не** ищутся подстрокой, и это названное решение, а не послабление.
   *
   * Это одновременно опознаватели уровней ядра (`SignatureLevel`) и слова английского юридического термина:
   * «простая электронная подпись» по-английски — **simple** electronic signature, «усиленная» — **qualified**
   * electronic signature. Запрет подстрокой заставил бы переписать название соглашения о ПЭП, то есть испортить
   * юридическую формулировку ради просева — ровно то, что решение П37 п. 5 запрещает (формулировку правит юрист).
   *
   * Чем закрыто то же самое по существу: в русских значениях латиницы **нет вовсе** (случай выше), поэтому
   * опознаватель уровня туда не попадёт; а требование Р-1715 — «тексты уровней на П4 не показываются» — проверяется
   * своим случаем ниже, по самим текстам Р-1704, а не по их опознавателям.
   */
  it("опознавателей уровней нет и в английских значениях — запрет постановки выполняется буквально", () => {
    // Прежде `simple` допускался в двух полях соглашения о ПЭП, потому что «simple electronic signature» —
    // английский юридический термин; обоснование жило в комментарии теста, то есть норма стояла в комментарии вместо
    // решения (находка ревью К1 № 2 — тот же приём, за который К3а уже получил находку). Вместо отступления
    // переписан **текст данных**: английская пара говорит «electronic signature», и буквальный запрет постановки
    // выполняется без исключений. Русская пара сохраняет юридическое «простая электронная подпись» — латиницы там
    // нет, и запрет её не касается. **Для юриста это ограничение названо** (строка «Открыто» в STATUS): вернёт он
    // «simple electronic signature» — понадобится решение владельца на отступление, и тогда правится эта проверка,
    // а не формулировка.
    for (const v of values().filter((x) => x.lang === "en"))
      for (const bad of ["simple", "qualified"]) expect(v.text.toLowerCase(), `${v.where}.en содержит «${bad}»`).not.toContain(bad);
  });

  it("раздела уровней подписи в файле нет, и завести его нельзя", () => {
    // Проверяется **отсутствие раздела**, а не три русские строки Р-1704 литералами (находка ревью К1 № 6): строки
    // были бы третьей копией, и английские пары, когда их примут, проехали бы мимо такой проверки. Раздел закрыт
    // перечнем ключей файла, поэтому уровням в данных экрана П4 места нет вовсе (Р-1715).
    expect(Object.keys(RAW as object)).toEqual(["text_version", "challenge_ttl_ms", "screen", "pep", "errors"]);
    for (const section of ["levels", "signature_levels", "level_texts"])
      expect(() => parsePasskeyCatalog({ ...(RAW as object), [section]: { ru: "а", en: "b" } }), section).toThrow(/лишний ключ/);
  });

  it("техника не просачивается **по форме**, а не только по словам", () => {
    // Чёрный список слов закрывает известное; форма закрывает и то, чего в нём нет (находка ревью К1 № 5):
    // опознаватели вида `after_human`, `rp_id`, `tok_`, `sha256:`, `M1`, `BANK`, `SignatureLevel`.
    for (const v of values()) {
      expect(v.text, `${v.where}.${v.lang}: подчёркивание`).not.toMatch(/[A-Za-z]_[A-Za-z]/);
      expect(v.text, `${v.where}.${v.lang}: слово заглавными`).not.toMatch(/\b[A-Z]{3,}\b/);
      expect(v.text.toLowerCase(), `${v.where}.${v.lang}: хэш`).not.toContain("sha256");
      expect(v.text, `${v.where}.${v.lang}: опознаватель вида M1`).not.toMatch(/\b[A-Z]\d\b/);
    }
  });
});

describe("пары ru/en дословно", () => {
  it("заголовок, подпись и подвал экрана — те, что в файле", () => {
    expect(catalog.screen.title).toEqual({ ru: "Как вы будете подтверждать поручения", en: "How you will confirm instructions" });
    expect(catalog.screen.footer).toEqual({
      ru: "Ключ остаётся в телефоне. Мы его не видим и не храним.",
      en: "The key stays on your phone. We do not see it and do not store it.",
    });
  });

  it("у каждой пары заполнены оба языка", () => {
    for (const v of values()) expect(v.text.trim().length, `${v.where}.${v.lang}`).toBeGreaterThan(0);
    // Число пар названо: пропади раздел из файла — покраснеет здесь, а не «тихо сойдётся» на меньшем наборе.
    expect(values()).toHaveLength(2 * (5 + 4 + 9));
  });

  it("пустая строка в паре не принимается", () => {
    const raw = RAW as { screen: { title: object } };
    // Сообщение названо регуляркой, как в остальных случаях файла: `.toThrow()` без сообщения прошёл бы на любом
    // исключении, в том числе не на том, о котором случай (находка ревью К1 № 9).
    expect(() =>
      parsePasskeyCatalog({ ...(RAW as object), screen: { ...(RAW as { screen: object }).screen, title: { ...raw.screen.title, ru: "" } } }),
    ).toThrow(/passkey\.screen\.title/);
  });
});
