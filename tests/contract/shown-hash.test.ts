// КТ-0, К2.3 (контракт К-Б § 3, правило 1; П30 доп. 1, Р-1613): хэш показанного.
// Два свойства, ради которых правило и введено:
//   стабильность — порядок ключей хэш не меняет (сервер и экран собирают объект как им удобно);
//   чувствительность — **любое** показанное поле и `text_version` хэш меняют (иначе подменённая карточка прошла бы как
//   та же самая, и человек подтвердил бы невиденное — С-07).
// Канонизация — ядра (`canonicalJson` agentic-core), и тест это проверяет прямо: хэш должен совпасть с посчитанным по
// канонизатору ядра, а не по `JSON.stringify` (у него порядок ключей — порядок вставки).
import { describe, expect, it } from "vitest";
import { canonicalJson, sha256Hex } from "@kuzin4u/agentic-core";
import { isShownHash, SHOWN_HASH_PREFIX, shownMatches, showingHash, viewOf } from "../../src/contract/ui-v1/shown-hash.js";

/** Карточка корзины § 5.6 — суммы парой, время строкой ISO. */
const card = {
  lines: [{ title: "Хлеб на закваске, 600 г", qty: 1, price: { amount: 36800, currency: "RUB" } }],
  goods_total: { amount: 36800, currency: "RUB" },
  agent_fee: { amount: 1, currency: "RUB" },
  agent_fee_text: "Цена агента — 1 копейка",
  valid_to: "2026-11-25T12:00:00Z",
};
const shown = { text_version: "u5-card@1.0", card } as const;

describe("К2.3: хэш показанного — стабильность", () => {
  it("форма хэша — `sha256:` и 64 знака", () => {
    const h = showingHash(shown);
    expect(h.startsWith(SHOWN_HASH_PREFIX)).toBe(true);
    expect(isShownHash(h)).toBe(true);
    expect(h).toHaveLength(SHOWN_HASH_PREFIX.length + 64);
  });

  it("порядок ключей карточки хэш не меняет", () => {
    const reordered = {
      valid_to: card.valid_to,
      agent_fee_text: card.agent_fee_text,
      agent_fee: { currency: "RUB", amount: 1 },
      goods_total: { currency: "RUB", amount: 36800 },
      lines: [{ price: { currency: "RUB", amount: 36800 }, qty: 1, title: card.lines[0]?.title }],
    };
    expect(showingHash({ text_version: shown.text_version, card: reordered })).toBe(showingHash(shown));
  });

  it("хэш посчитан канонизацией ядра, а не `JSON.stringify`", () => {
    const own = `${SHOWN_HASH_PREFIX}${sha256Hex(canonicalJson({ text_version: shown.text_version, card }))}`;
    expect(showingHash(shown)).toBe(own);
    const naive = `${SHOWN_HASH_PREFIX}${sha256Hex(JSON.stringify({ text_version: shown.text_version, card }))}`;
    // у этой карточки ключи не по алфавиту, поэтому наивная сборка даёт другой хэш — канонизация не декорация
    expect(showingHash(shown)).not.toBe(naive);
  });

  it("два вызова на одном показанном дают один хэш", () => {
    expect(showingHash(shown)).toBe(showingHash({ text_version: "u5-card@1.0", card: { ...card } }));
  });
});

describe("К2.3: хэш показанного — чувствительность", () => {
  const base = showingHash(shown);

  it("смена `text_version` меняет хэш", () => {
    expect(showingHash({ text_version: "u5-card@1.1", card })).not.toBe(base);
  });

  it("любое поле карточки меняет хэш: сумма, валюта, количество, текст, срок", () => {
    const changed = [
      { ...card, goods_total: { amount: 36801, currency: "RUB" } },
      { ...card, goods_total: { amount: 36800, currency: "EUR" } },
      { ...card, lines: [{ ...card.lines[0], qty: 2 }] },
      { ...card, agent_fee_text: "Цена агента — 1 рубль" },
      { ...card, valid_to: "2026-11-26T12:00:00Z" },
      { ...card, lines: [{ ...card.lines[0], title: "Хлеб на закваске, 500 г" }] },
    ];
    for (const c of changed) expect(showingHash({ text_version: shown.text_version, card: c }), JSON.stringify(c).slice(0, 60)).not.toBe(base);
  });

  it("добавленное поле меняет хэш, убранное — тоже", () => {
    expect(showingHash({ text_version: shown.text_version, card: { ...card, note: "скидка" } })).not.toBe(base);
    const without: Record<string, unknown> = { ...card };
    delete without["agent_fee_text"];
    expect(showingHash({ text_version: shown.text_version, card: without })).not.toBe(base);
  });

  it("порядок позиций в массиве значим: перестановка строк — другая карточка", () => {
    const two = { ...card, lines: [card.lines[0], { title: "Молоко", qty: 1, price: { amount: 9900, currency: "RUB" } }] };
    const swapped = { ...card, lines: [two.lines[1], two.lines[0]] };
    expect(showingHash({ text_version: shown.text_version, card: two })).not.toBe(showingHash({ text_version: shown.text_version, card: swapped }));
  });
});

describe("К2.3: сверка присланного хэша и `view`", () => {
  it("свой хэш подходит, чужой и негодный по форме — нет", () => {
    expect(shownMatches(shown, showingHash(shown))).toBe(true);
    expect(shownMatches(shown, showingHash({ text_version: "u5-card@1.1", card }))).toBe(false);
    expect(shownMatches(shown, "sha256:" + "0".repeat(64))).toBe(false);
    expect(shownMatches(shown, "не хэш")).toBe(false);
    expect(shownMatches(shown, showingHash(shown).toUpperCase())).toBe(false);
  });

  it("`view` несёт идентификатор своей копии, версию текстов и хэш", () => {
    expect(viewOf("vw_1", shown)).toEqual({ view_id: "vw_1", text_version: "u5-card@1.0", hash: showingHash(shown) });
  });

  it("значение вне JSON — дефект сборки ответа, а не 409: канонизатор бросает", () => {
    expect(() => showingHash({ text_version: "u5-card@1.0", card: { at: new Date("2026-11-18T12:00:00Z") } })).toThrow(TypeError);
    expect(() => showingHash({ text_version: "u5-card@1.0", card: { amount: Number.NaN } })).toThrow(TypeError);
  });
});
