// ВР-1 — **общая** фикстура каталога для тестов модуля (находка ревью К4 № 9).
//
// Заведена потому, что две копии уже разошлись: в `read.test.ts` у магазина были способы оплаты `card` и `sbp`, в
// `invariant1.test.ts` — только `card`. Расхождение безвредно сегодня и тихо завтра: тест, написанный на одной
// копии, проверяет не то, что другой. Тот же вывод ревью делало в Н-3 (К4).
//
// Правило фикстуры: **разные сущности — разные значения** (решение владельца 16.11.2026). Опознаватель магазина
// (`SHOP-…`) не равен коду продавца (`MER-…`) — это два разных понятия (**Р-1727**), и равенство значений здесь
// было блокером ревью К2 № 2.
import type { CatalogProduct, CatalogShop, ShopOffers } from "../../src/catalog/port.js";

export const REGION = "RU-MOW";
export const MERCHANT = "MER-7001";
export const MERCHANT_B = "MER-7002";
export const SHOP_B = "SHOP-2050";

export const RUB = (amount: number) => ({ amount, currency: "RUB" });

/** Магазин в форме К8. Свои значения, не из фикстуры Платформы: тест не должен падать от её правки. */
export const shop: CatalogShop = {
  id: "SHOP-1042",
  inn: "0012345678",
  mcc: "5462",
  paymentMethods: ["card", "sbp"],
  deliveryRegions: [REGION],
  returns: { days: 0, text: "Хлеб надлежащего качества возврату не подлежит" },
};

/** Товар в форме К8. `gtin` у выпечки нет — это `null` по замыслу модели, а не «забыли». */
export const product = (over: Partial<CatalogProduct> = {}): CatalogProduct => ({
  sku: "SKU-001",
  gtin: null,
  brand: null,
  model: null,
  attributes: { вес: "650 г" },
  title: "Тартин — хлеб на закваске",
  category: "Хлеб",
  price: RUB(38000),
  availability: { inStock: true },
  delivery: [{ method: "PICKUP", minDays: 0, maxDays: 0, cost: RUB(0) }],
  updatedAt: "2026-11-22T09:00:00+03:00",
  description: "Классика: хрустящая корочка, пористый мякиш",
  ...over,
});

export type ProductFacts = ShopOffers["facts"]["products"][number];
export type Issues = ProductFacts["issues"];
export type Signals = ProductFacts["signals"];

export const productFacts = (p: CatalogProduct, issues: Issues = [], signals: Signals = []): ProductFacts => ({
  product: p,
  issues,
  signals,
});

/** Витрина, ответившая фактами. */
export const offers = (over: {
  merchantId?: string;
  inContour?: boolean;
  shopIssues?: ShopOffers["facts"]["shopIssues"];
  products?: ShopOffers["facts"]["products"];
  dropped?: ShopOffers["facts"]["dropped"];
}): ShopOffers => ({
  merchantId: over.merchantId ?? MERCHANT,
  inContour: over.inContour ?? true,
  facts: {
    shop,
    shopIssues: over.shopIssues ?? [],
    products: over.products ?? [],
    dropped: over.dropped ?? [],
  },
});

/** Одна витрина с одним товаром — частый случай проверок просева. */
export const one = (p: CatalogProduct, issues: Issues = []): ShopOffers => offers({ products: [productFacts(p, issues)] });
