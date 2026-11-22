// ВР-1, К5 — учебные витрины стенда «нарочно не так»: что из их поведения **видно учёту каталога** (постановка
// ВР-1, К5; П38 п. 6; С-43, РП58 «Дополнение З12»).
//
// **Измерение, а не утверждение.** Первая редакция этого файла набрала факты руками и объявила их «кодами учебной
// витрины» — три утверждения из четырёх оказались неверны (блокеры ревью К5 № 1–4): у CONTRADICTORY на стенде не
// `A5_RETURNS_MISMATCH`, а `A5_PRICE_MISMATCH` (в описании «Цена: 290 ₽» против `price` 32000); у DUAL_PRICE и
// INJECTION на стадии выдачи кода **нет вовсе**; у INCOMPLETE карточки до приложения не доходят. Теперь коды
// **измеряются**: карточка берётся у фикстуры стенда, приводится к модели К8 и прогоняется через проверки **ядра**,
// а случай объявляет ожидаемое — и расхождение краснит объявление.
//
// **Предел измерения, названный честно.** Приведение карточки стенда к модели К8 делает **адаптер витрин ядра**
// (Р42 п. 2, Р54 п. 4), и его копией это сопоставление не является: здесь только поля, на которые смотрят
// `validateProduct`, `checkProductA5` и `checkShopA5`, а адаптер делает больше (маски опознавателей, знак
// готовности, `responded_at`). Карточки берутся не из внутренних полей витрины, а из `MERCHANT_FIXTURES`
// **самого стенда**, поле `agent_items` — каталог в том виде, в каком его видит **опознанный агент** (у DUAL_PRICE
// там уже своя цена, A5 п. 1.2). Разойдётся сопоставление с адаптером — измерение станет неверным; настоящую
// сверку даёт живой прогон демо-стенда (`tests/demo/*-live.test.ts`), и его место — приёмка, а не этот файл.
//
// Чего в файле **нет** и почему: сверки с `TRAINING_MERCHANTS` демо-стенда. Первая редакция называла её «перечень
// из источника», но это была тавтология (блокер ревью К5 № 4): `read` переносит коды дословно, и сравнивались две
// рукописные стороны. Хуже — источник был взят не по назначению: `TRAINING_MERCHANTS` держит префиксы **учебного
// сбоя витрины для пульта** (З10, Р-1361), включая сбои, которые агент ловит на заказе и оплате, а не коды модели
// каталога; измерение ниже как раз это и показывает.
import { describe, expect, it } from "vitest";
import {
  MERCHANT_FIXTURES,
  SHOP_BEHAVIOURS,
  type CatalogItemView,
  type MerchantFixture,
  type ShopBehaviour,
} from "agentic-ps-platform/fixtures";
import { readShop } from "agentic-buyer-ref/src/agent/catalog/index.js";
import { cardLikeNumber } from "../support/card-like.js";
import { read } from "../../src/catalog/read.js";
import type { CatalogFacts, CatalogProduct, CatalogShop, ShopOffers } from "../../src/catalog/port.js";
import { MERCHANT, offers, one, product, productFacts } from "./fixture.js";

/** Знаков после запятой у валюты цены: таблицы в ядре нет (К9), витрины стенда — только рубли. */
const EXPONENT = 2;

/** Факты магазина, как их собирает адаптер из записи списка витрин; `returns` у неполной витрины нет. */
const shopOf = (f: MerchantFixture): CatalogShop | null =>
  f.returns === undefined
    ? null
    : {
        id: f.id,
        inn: f.inn,
        mcc: f.mcc,
        paymentMethods: [...f.payment_methods],
        deliveryRegions: [...f.delivery_regions],
        returns: f.returns,
        readiness: { zone: f.zone, mark: f.readiness_mark },
      };

/** Карточка выдачи агенту → модель К8. Цены нет — карточка не переводится (у ядра это `dropped`). */
const productOf = (f: MerchantFixture, item: CatalogItemView): CatalogProduct | null => {
  if (item.price === undefined || item.currency === undefined) return null;
  const currency = item.currency;
  return {
    sku: item.sku,
    gtin: item.gtin ?? null,
    brand: item.brand ?? null,
    model: item.model ?? null,
    attributes: { ...(item.attributes ?? {}) },
    title: item.title,
    category: item.category ?? f.category,
    price: { amount: item.price, currency },
    availability: { inStock: item.in_stock ?? true },
    delivery: (item.delivery_options ?? [{ method: "PICKUP" as const, min_days: 0, max_days: 0, cost: 0, currency }]).map(
      (d) => ({ method: d.method, minDays: d.min_days, maxDays: d.max_days, cost: { amount: d.cost, currency: d.currency } }),
    ),
    updatedAt: item.updated_at ?? new Date().toISOString(),
    ...(item.description === undefined ? {} : { description: item.description }),
  };
};

/** Измеренные факты витрины: как их увидит приложение, если ядро прочитает её каталог. */
function measure(f: MerchantFixture): CatalogFacts {
  const shop = shopOf(f);
  // Факты магазина не разобраны — ядро отдаёт один код и **пустые** карточки (Р54 п. 5, `adapter.ts` `#facts`).
  if (shop === null) return { shop: null, shopIssues: ["REQUIRED"], products: [], dropped: [] };

  const translated = f.agent_items.map((v) => productOf(f, v));
  const products = translated.filter((p): p is CatalogProduct => p !== null);
  // Непереведённая карточка — код на каждую (Р42 п. 6); у неполной карточки нет цены, это `REQUIRED`.
  const dropped = translated.filter((p) => p === null).map(() => "REQUIRED" as const);
  return readShop(shop, products, [...dropped], EXPONENT);
}

const codesOf = (f: CatalogFacts): string[] => [
  ...f.shopIssues,
  ...f.products.flatMap((p) => [...p.issues, ...p.signals]),
  ...f.dropped,
];

/**
 * Что учёт каталога видит у каждого учебного поведения. `codes` — **ожидание**, сверяемое с измерением.
 *
 * Перечень закрыт **на компиляции** (`Record<ShopBehaviour, Case>`): новое поведение у стенда не скомпилируется без
 * строки здесь. Шаг воспроизведения вместо рантайм-проверки полноты (Р-1702): убрать строку `NORMAL` — `tsc` даёт
 * `TS2741 Property 'NORMAL' is missing`.
 */
interface Case {
  readonly why: string;
  readonly codes: readonly string[];
}

const CASES: Readonly<Record<ShopBehaviour, Case>> = {
  NORMAL: { why: "модель соблюдена", codes: [] },
  READ_ONLY: { why: "ломается на заказе: POST отвергает, каталог отдаёт годный", codes: [] },
  REJECTS_UNIDENTIFIED: { why: "ломается на опознании агента, не на модели каталога", codes: [] },
  REJECTS_FULFILMENT: { why: "ломается на подтверждении исполнения, каталог годный", codes: [] },
  OUT_OF_CATEGORY: { why: "товар не той категории — это пределы поручения, а не код модели", codes: [] },
  CONTRADICTORY: {
    why: "в описании названа цена, не совпадающая с `price` — сигнал A5 товара",
    codes: ["A5_PRICE_MISMATCH"],
  },
  DUAL_PRICE: {
    why: "опознанному агенту показана своя цена, но в тексте цены нет: двойная цена видна не каталогом, а сверкой ответа на заказ — кода на стадии выдачи нет",
    codes: [],
  },
  INJECTION: {
    why: "в описании инструкция агенту; кода для неё у ядра нет (расхождение № 6), и на стадии выдачи она не видна ничем",
    codes: [],
  },
  INCOMPLETE: {
    why: "у витрины нет условий возврата: факты магазина не разобраны, магазин исключён целиком, карточек ядро не отдаёт (Р54 п. 5)",
    codes: ["REQUIRED"],
  },
};

describe("К5: что видно учёту у учебных витрин — измерено, а не объявлено", () => {
  it("витрины фикстуры покрывают все поведения перечня стенда", () => {
    const used = new Set(MERCHANT_FIXTURES.map((s) => s.behaviour));
    expect([...used].sort()).toEqual([...SHOP_BEHAVIOURS].sort());
  });

  for (const s of MERCHANT_FIXTURES) {
    const c = CASES[s.behaviour];
    it(`${s.behaviour} (${s.id}): ${c.why}`, () => {
      const facts = measure(s);
      // Ожидание сверяется с измерением: разойдётся — краснеет объявление, а не измерение.
      expect(codesOf(facts).slice().sort()).toEqual([...c.codes].sort());

      // Чтение не падает ни на одном учебном поведении — это и есть «коды, а не падение».
      const r = read([{ merchantId: s.merchant_id, inContour: s.readiness_mark, facts }]);
      expect(r.entries.length).toBeGreaterThan(0);

      // Ни одна позиция не теряется молча: товары и непереведённые карточки сошлись со счётом.
      const kept = r.entries.filter((e) => e.kind === "offer" || e.kind === "dropped").length;
      expect(kept).toBe(r.positions);
      expect(r.positions).toBe(facts.products.length + facts.dropped.length);
    });
  }

  it("кода модели каталога нет у пяти поведений из девяти — и это измерено, а не предположено", () => {
    const silent = MERCHANT_FIXTURES.filter((s) => codesOf(measure(s)).length === 0).map((s) => s.behaviour);
    expect(silent.sort()).toEqual(
      ["NORMAL", "OUT_OF_CATEGORY", "READ_ONLY", "REJECTS_FULFILMENT", "REJECTS_UNIDENTIFIED", "DUAL_PRICE", "INJECTION"].sort(),
    );
  });
});

describe("К5: неполная витрина — карточки до приложения не доходят (расхождение с ядром)", () => {
  it("магазин исключён по фактам магазина: число его товаров **неизвестно**, а не ноль", () => {
    const incomplete = MERCHANT_FIXTURES.find((s) => s.behaviour === "INCOMPLETE");
    expect(incomplete, "в наборе стенда должна быть неполная витрина").toBeDefined();
    expect(incomplete!.agent_items.length, "у неё есть карточки — именно поэтому потеря значима").toBeGreaterThan(0);

    const facts = measure(incomplete!);
    const r = read([{ merchantId: incomplete!.merchant_id, inContour: incomplete!.readiness_mark, facts }]);

    expect(r.entries).toEqual([
      { kind: "shop_excluded", merchantId: incomplete!.merchant_id, codes: ["REQUIRED"], offers: null },
    ]);
    // Счёт честен: позиций ядро не отдало. Что их было две — приложение знать не может, и не делает вид.
    expect(r.positions).toBe(0);
  });

  it("магазин исключён при разобранных фактах: число товаров известно и названо", () => {
    const r = read([offers({ shopIssues: ["BAD_INN"], products: [productFacts(product())] })]);
    const excluded = r.entries.find((e) => e.kind === "shop_excluded");
    expect(excluded?.kind === "shop_excluded" ? excluded.offers : "нет записи").toBe(1);
  });
});

describe("К5: падение одной витрины не роняет чтение остальных", () => {
  it("недоступные витрины рядом с ответившими: записи ответивших на месте, счёт сходится", () => {
    const r = read([
      { shopId: "SHOP-9001", unavailable: { detail: "NO_RESPONSE" } },
      one(product()),
      { shopId: "SHOP-9002", unavailable: { reason: "SHOP_SEARCH_DEADLINE" } },
      offers({ merchantId: "MER-7003", products: [productFacts(product())], dropped: ["BAD_AMOUNT"] }),
    ]);

    expect(r.shopsUnavailable).toBe(2);
    expect(r.positions).toBe(3);
    expect(r.entries.filter((e) => e.kind === "offer")).toHaveLength(2);
    expect(r.entries.filter((e) => e.kind === "dropped")).toHaveLength(1);
    expect(r.entries.filter((e) => e.kind === "shop_unavailable")).toHaveLength(2);
  });

  // Отказ целиком (fail-closed) был **назван** в К2, но не проверен: `toThrow` в тестах учёта не было ни одного
  // (замечание чата 22.11). Здесь он подтверждён, а не заявлен.
  it("элемент ответа вне перечня исходов ядра — отказ всего чтения, а не «пропустим один»", () => {
    const secret = cardLikeNumber("2");
    // В негодном элементе — и похожая на номер строка, и текст продавца: ни то, ни другое не должно оказаться в
    // сообщении (находка ревью К5 № 10; правило «сообщение — только из слов», находка К2 № 1).
    const bogus = { surprise: secret, title: "Хлеб зерновой" } as unknown as ShopOffers;

    expect(() => read([one(product()), bogus])).toThrow("исход поиска вне перечня ядра");
    try {
      read([bogus]);
      expect.unreachable("чтение обязано отказать");
    } catch (e) {
      const text = e instanceof Error ? `${e.message}${e.stack ?? ""}` : String(e);
      expect(text).not.toContain(secret);
      expect(text).not.toContain("Хлеб зерновой");
      expect(text).not.toContain("surprise");
      expect(e instanceof Error ? e.message : "").toBe("исход поиска вне перечня ядра");
    }
  });
});

describe("К5: перечень поведений закрыт на компиляции", () => {
  it("у каждого поведения перечня стенда есть свой случай", () => {
    // Полноту держит тип `Record<ShopBehaviour, Case>`; здесь — только то, что случаи не пусты по смыслу.
    for (const b of SHOP_BEHAVIOURS) expect(CASES[b].why.length, b).toBeGreaterThan(10);
    expect(MERCHANT).toMatch(/^MER-/);
  });
});
