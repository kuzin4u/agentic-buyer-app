// ВР-1, К4 — инвариант 1 на каталоге: строка, похожая на номер карты, в карточке не проходит (Р-1718, П38 п. 4).
//
// Образец — `tests/onboarding/invariant1.test.ts`: просев закрывается перечнем, и каждая ветка показана **красной**
// фикстурой с нарушением, которая **остаётся** в тестах (Р-1698).
//
// Строки, похожие на номер карты, и штрихкоды собираются **во время прогона** генераторами
// `tests/support/card-like.ts` и в файлы не пишутся (CLAUDE.md, «Секреты»; Р-1699) — ни настоящие, ни заглушки из
// одинаковых цифр: Р-1699 снял оговорку «цифры не все одинаковые» без исключений (находка ревью К4 № 3).
//
// Фикстура магазина и товара — **общая** (`./fixture.js`), а не своя копия: две копии уже начали расходиться
// (находка ревью К4 № 9).
import { describe, expect, it } from "vitest";
import { isGtin, validateProduct } from "@kuzin4u/agentic-core/catalog";
import { badGtinUnlikeCard, cardLikeNumber, gtinLookingLikeCard } from "../support/card-like.js";
import { hasCardNumber } from "../../src/card-guard.js";
import { CARD_LIKE_FIELDS, cardLikeIn, read, type CardLikeField } from "../../src/catalog/read.js";
import { MERCHANT, one, product, productFacts, shop } from "./fixture.js";
import type { CatalogProduct } from "../../src/catalog/port.js";

/** Что вернул просев для одной карточки, прочитанное **через `read`**, а не только из `cardLikeIn`. */
const cardLikeOf = (p: CatalogProduct, issues: Parameters<typeof one>[1] = []): readonly CardLikeField[] => {
  const entry = read([one(p, issues)]).entries.find((e) => e.kind === "offer");
  if (entry?.kind !== "offer") throw new Error("записи товара нет — проверять нечего");
  return entry.cardLike;
};

describe("К4: просев свободного текста карточки", () => {
  it("обычная карточка: пометок нет, опознаватель на месте", () => {
    expect(cardLikeIn(product(), [])).toEqual([]);
    expect(read([one(product())]).entries).toEqual([
      { kind: "offer", merchantId: MERCHANT, sku: "SKU-001", inContour: true, issues: [], signals: [], cardLike: [] },
    ]);
  });

  it("карточка без описания — ветвь отсутствующего поля проходится, а не падает", () => {
    const noDescription: CatalogProduct = { ...product() };
    delete noDescription.description;
    expect(noDescription.description).toBeUndefined();
    expect(cardLikeIn(noDescription, [])).toEqual([]);
  });

  // Красные фикстуры: в каждой — своя строка генератора, чтобы по выводу было видно, какое поле сработало.
  // Имён атрибутов здесь нет: по букве Р-1718 просеиваются **значения** (см. отдельную проверку ниже).
  const cases: readonly { field: CardLikeField; over: (s: string) => Partial<CatalogProduct> }[] = [
    { field: "sku", over: (s) => ({ sku: s }) },
    { field: "title", over: (s) => ({ title: `Хлеб ${s}` }) },
    { field: "description", over: (s) => ({ description: `Оплата по ${s}` }) },
    { field: "attributes", over: (s) => ({ attributes: { вес: `650 г ${s}` } }) },
  ];

  const reached = new Set<CardLikeField>();

  for (const [i, c] of cases.entries()) {
    it(`похожая на номер строка в поле ${c.field} — поле помечено через read`, () => {
      const value = cardLikeNumber(String(i + 1));
      expect(hasCardNumber(value), "генератор обязан давать похожую строку").toBe(true);

      const found = cardLikeOf(product(c.over(value)));
      expect(found).toEqual([c.field]);
      for (const f of found) reached.add(f);

      // Позиция **не потеряна** (П38 п. 6): запись на месте, счёт сходится.
      const r = read([one(product(c.over(value)))]);
      expect(r.entries).toHaveLength(1);
      expect(r.positions).toBe(1);
    });
  }

  it("похожий на номер `sku` изымается значением, а запись остаётся с пометкой", () => {
    const value = cardLikeNumber("7");
    const r = read([one(product({ sku: value }))]);
    expect(r.entries).toEqual([
      { kind: "offer", merchantId: MERCHANT, sku: null, inContour: true, issues: [], signals: [], cardLike: ["sku"] },
    ]);
    // Единственное поле карточки, которое идёт в запись, — `sku`; только для него это утверждение может покраснеть
    // (находка ревью К4 № 5: для `title`, `description` и `attributes` оно сторож К2, а не К4).
    expect(JSON.stringify(r)).not.toContain(value);
  });

  it("несколько полей сразу — помечены все", () => {
    const a = cardLikeNumber("8");
    const b = cardLikeNumber("9");
    expect([...cardLikeOf(product({ sku: a, description: `Оплата ${b}` }))].sort()).toEqual(["description", "sku"]);
  });

  // Р-1729 (дополнение к Р-1718): имя атрибута приходит из того же файла продавца, что значение, — просеивается
  // наравне с ним. Цена названа в решении: имя-число помечает **весь** `attributes`.
  it("имя атрибута просеивается наравне со значением (Р-1729)", () => {
    const value = cardLikeNumber("4");
    expect(cardLikeOf(product({ attributes: { [value]: "650 г" } }))).toEqual(["attributes"]);
    expect(cardLikeOf(product({ attributes: { вес: value } }))).toEqual(["attributes"]);
  });

  // Р-1729: текст условий возврата магазина — свободный текст продавца, и он дойдёт до человека рядом с карточкой.
  it("текст условий возврата магазина просеивается, и пометка ставится на записи его товаров (Р-1729)", () => {
    const value = cardLikeNumber("6");
    const dirty = { ...shop, returns: { days: 0, text: `Возврата нет, звоните ${value}` } };
    const r = read([{ merchantId: MERCHANT, inContour: true, facts: { shop: dirty, shopIssues: [], products: [productFacts(product())], dropped: [] } }]);
    const entry = r.entries.find((e) => e.kind === "offer");
    expect(entry?.kind === "offer" ? entry.cardLike : null).toEqual(["returns"]);
    // Текст магазина в запись не идёт — проверка сторожит, что он и не появился.
    expect(JSON.stringify(r)).not.toContain(value);
  });

  it("магазина нет (фид не разобран) — текст возврата не проверяется, а не считается чистым", () => {
    expect(cardLikeIn(product(), [])).toEqual([]);
    expect(cardLikeIn(product(), [], shop)).toEqual([]);
  });

  it("каждое поле перечня достижимо — считается по фактическим возвратам просева", () => {
    for (const c of cases) reached.add(c.field);
    // `gtin` и `returns` — своими случаями: оба зависят не только от строки.
    for (const f of cardLikeOf(product({ gtin: cardLikeNumber("5") }), ["BAD_GTIN"])) reached.add(f);
    const dirty = { ...shop, returns: { days: 0, text: `Звоните ${cardLikeNumber("6")}` } };
    for (const f of cardLikeIn(product(), [], dirty)) reached.add(f);
    expect([...reached].sort()).toEqual([...CARD_LIKE_FIELDS].sort());
  });
});

describe("К4: штрихкод — годный вне фильтра, негодный как свободный текст (Р-1718)", () => {
  it("штрихкода нет (`null`) — просеивать нечего", () => {
    expect(cardLikeOf(product({ gtin: null }))).toEqual([]);
  });

  it("негодный штрихкод, похожий на номер, — помечен: ядро его забраковало, значит это произвольная строка", () => {
    const value = cardLikeNumber("3");
    expect(cardLikeOf(product({ gtin: value }), ["BAD_GTIN"])).toEqual(["gtin"]);
  });

  it("негодный штрихкод, не похожий на номер, — не помечен: фильтр, а не повтор вердикта ядра", () => {
    const value = badGtinUnlikeCard(13);
    expect(isGtin(value), "ядро обязано забраковать").toBe(false);
    expect(hasCardNumber(value), "и он не похож на номер").toBe(false);
    expect(cardLikeOf(product({ gtin: value }), ["BAD_GTIN"])).toEqual([]);
  });

  // Находка ревью К4 № 2: равенство «`BAD_GTIN` ⇔ не прошёл `isGtin`» живёт в **коде** ядра, вывести его нельзя —
  // значит привязываем тестом к источнику. Разделит ядро код по длине и по контрольной цифре — покраснеет здесь.
  it("условие привязано к источнику: `BAD_GTIN` ядро ставит ровно негодному штрихкоду", () => {
    const bad = badGtinUnlikeCard(13);
    const good = gtinLookingLikeCard(13);

    const codesFor = (gtin: string): string[] => validateProduct(product({ gtin }), shop).map((i) => i.code);

    expect(codesFor(bad)).toContain("BAD_GTIN");
    expect(codesFor(good)).not.toContain("BAD_GTIN");
  });

  it("значение не строкой: `BAD_GTIN` ядро не ставит, и фильтр не срабатывает молча", () => {
    // Ядро такому значению ставит `BAD_TYPE`; условие просева проверяет тип само (находка ревью К4 № 10).
    const notString = { gtin: 12345 } as unknown as Partial<CatalogProduct>;
    expect(cardLikeIn(product(notString), ["BAD_TYPE"])).toEqual([]);
    expect(cardLikeIn(product(notString), ["BAD_GTIN"])).toEqual([]);
  });

  // **Названный остаточный риск (П38 п. 4), показанный делом.** Фикстура остаётся в тестах: она не «проверяет
  // правильность», а фиксирует цену решения Р-1718 — годный штрихкод из-под фильтра выведен сознательно, и
  // похожая на номер строка в нём проходит. Свидетель годности — ядро.
  it("годный штрихкод, похожий на номер карты, фильтр НЕ видит — это принятый риск, а не недосмотр", () => {
    for (const length of [13, 14] as const) {
      const value = gtinLookingLikeCard(length);
      expect(value, `GTIN-${length}`).toHaveLength(length);
      expect(isGtin(value), `ядро обязано признать GTIN-${length} годным`).toBe(true);
      expect(hasCardNumber(value), `GTIN-${length} обязан быть похож на номер`).toBe(true);

      // Ядро годный штрихкод не бракует, значит `BAD_GTIN` не придёт — и поле остаётся вне фильтра.
      expect(validateProduct(product({ gtin: value }), shop).map((i) => i.code)).not.toContain("BAD_GTIN");
      expect(cardLikeOf(product({ gtin: value }))).toEqual([]);
    }
  });

  it("риск ограничен: тот же годный штрихкод в описании — помечен", () => {
    const value = gtinLookingLikeCard(13);
    expect(cardLikeOf(product({ gtin: value, description: `Код ${value}` }))).toEqual(["description"]);
  });
});
