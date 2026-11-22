// ВР-1, К2 — учёт отклонённого: ни одна позиция не теряется молча (П38 п. 6).
//
// Ожидания — готовыми объектами и числами, а не повторным вызовом той же сборки: иначе тест подтверждал бы, что
// `read` равен себе. Факты собраны руками в формах ядра (`ShopOffers`, `CatalogFacts`, `ProductFacts`) — то, что
// отдаёт порт.
//
// Чего в этом файле **нет** и почему: подложной второй сборки «учёт с отбором». В первой редакции она стояла здесь
// как «красная фикстура», но доказывала только то, что сама теряет записи, — на `read` она не опиралась и
// подставить её вместо `read` было нельзя (находка ревью К2 № 6). Красноту настоящих проверок показывают поломки
// самого `read`, и шаги названы в строке кирпича (Р-1698, Р-1702): схлопывание `dropped` через `new Set` роняет
// проверку «запись на каждую карточку», отбор товаров исключённого магазина — три проверки, включая сквозную
// сверку счёта.
import { describe, expect, it } from "vitest";
import { classifyOffer } from "agentic-buyer-ref/src/agent/policy/catalog.js";
import type { CatalogProduct, CatalogShop, ShopOffers, ShopUnavailable } from "../../src/catalog/port.js";
import { CATALOG_ENTRY_KINDS, read, type CatalogEntry, type CatalogEntryKind } from "../../src/catalog/read.js";

type ProductFacts = ShopOffers["facts"]["products"][number];
type Issues = ProductFacts["issues"];
type Signals = ProductFacts["signals"];

const RUB = (amount: number) => ({ amount, currency: "RUB" });

const REGION = "RU-MOW";

/**
 * Магазин в форме К8. Опознаватель магазина **не равен** коду продавца: у витрины эмулятора это разные значения
 * (ядро оговаривает это прямо), и в фикстуре они разные — иначе подмена `merchantId` на `shop.id` не покраснела бы
 * ни в одной проверке (находка ревью К2 № 2; разобранный случай К1.5).
 */
const shop: CatalogShop = {
  id: "SHOP-1042",
  inn: "0012345678",
  mcc: "5462",
  paymentMethods: ["card", "sbp"],
  deliveryRegions: [REGION],
  returns: { days: 0, text: "Хлеб надлежащего качества возврату не подлежит" },
};

const MERCHANT = "MER-7001";
const MERCHANT_B = "MER-7002";
const SHOP_B = "SHOP-2050";

/** Товар в форме К8. `gtin` у выпечки нет — это `null` по замыслу модели, а не «забыли». */
const product = (sku: string, title: string, price: number): CatalogProduct => ({
  sku,
  gtin: null,
  brand: null,
  model: null,
  attributes: { вес: "650 г" },
  title,
  category: "Хлеб",
  price: RUB(price),
  availability: { inStock: true },
  delivery: [{ method: "PICKUP", minDays: 0, maxDays: 0, cost: RUB(0) }],
  updatedAt: "2026-11-22T09:00:00+03:00",
  description: "Классика: хрустящая корочка, пористый мякиш",
});

const productFacts = (p: CatalogProduct, issues: Issues = [], signals: Signals = []): ProductFacts => ({
  product: p,
  issues,
  signals,
});

/** Витрина, ответившая фактами. */
const offers = (over: {
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

const tartine = product("SKU-001", "Тартин — хлеб на закваске", 38000);
const rye = product("SKU-002", "Заварной ржано-пшеничный", 42500);

describe("учёт прочитанного каталога (П38 п. 6)", () => {
  it("пустой ответ — пустой учёт, а не исключение", () => {
    expect(read([])).toEqual({ entries: [], positions: 0, shopsExcluded: 0, shopsUnavailable: 0 });
  });

  it("витрина без замечаний: по записи на товар, коды пустые, зона контура перенесена", () => {
    const r = read([offers({ products: [productFacts(tartine), productFacts(rye)] })]);
    expect(r.entries).toEqual([
      { kind: "offer", merchantId: MERCHANT, sku: "SKU-001", inContour: true, issues: [], signals: [] },
      { kind: "offer", merchantId: MERCHANT, sku: "SKU-002", inContour: true, issues: [], signals: [] },
    ]);
    expect(r.positions).toBe(2);
    expect(r.shopsExcluded).toBe(0);
    expect(r.shopsUnavailable).toBe(0);
  });

  it("вне контура гарантий: признак ядра идёт в запись как есть (инвариант 5)", () => {
    const r = read([offers({ inContour: false, products: [productFacts(tartine)] })]);
    expect(r.entries).toEqual([
      { kind: "offer", merchantId: MERCHANT, sku: "SKU-001", inContour: false, issues: [], signals: [] },
    ]);
  });

  it("сигналы A5 и ошибки модели идут как есть — своих кодов приложение не добавляет", () => {
    const r = read([
      offers({ products: [productFacts(tartine, [], ["A5_PRICE_MISMATCH"]), productFacts(rye, ["BAD_GTIN"], [])] }),
    ]);
    expect(r.entries).toEqual([
      { kind: "offer", merchantId: MERCHANT, sku: "SKU-001", inContour: true, issues: [], signals: ["A5_PRICE_MISMATCH"] },
      { kind: "offer", merchantId: MERCHANT, sku: "SKU-002", inContour: true, issues: ["BAD_GTIN"], signals: [] },
    ]);
  });

  it("магазин исключён целиком: своя запись с числом ушедших товаров, и сами товары в учёте тоже", () => {
    const r = read([offers({ shopIssues: ["REQUIRED"], products: [productFacts(tartine), productFacts(rye)] })]);
    expect(r.entries).toEqual([
      { kind: "shop_excluded", merchantId: MERCHANT, codes: ["REQUIRED"], offers: 2 },
      // Ошибка магазина приезжает к каждому его товару — так же её сводит `classifyOffer` ядра (см. проверку ниже).
      { kind: "offer", merchantId: MERCHANT, sku: "SKU-001", inContour: true, issues: ["REQUIRED"], signals: [] },
      { kind: "offer", merchantId: MERCHANT, sku: "SKU-002", inContour: true, issues: ["REQUIRED"], signals: [] },
    ]);
    expect(r.shopsExcluded).toBe(1);
    expect(r.positions).toBe(2);
  });

  // Находка ревью К2 № 4: формула сведения кодов — правило **ядра**, повторённое в приложении. Привязка к
  // источнику: набор кодов записи сверяется с вердиктом `classifyOffer` на тех же фактах. Изменит ядро состав
  // сводимых кодов или их порядок — покраснеет здесь, а не «когда-нибудь на экране».
  it("набор кодов записи сходится с вердиктом classifyOffer ядра — правило взято у источника", () => {
    const facts = productFacts(rye, ["BAD_GTIN"], []);
    const shopIssues: Issues = ["REQUIRED"];

    const verdict = classifyOffer(facts, shop, [...shopIssues], REGION, MERCHANT);
    expect(verdict).toEqual({ kind: "EXCLUDED", reason: "MODEL", codes: ["REQUIRED", "BAD_GTIN"] });

    const entry = read([offers({ shopIssues, products: [facts] })]).entries.find((e) => e.kind === "offer");
    expect(entry?.issues).toEqual(verdict.kind === "EXCLUDED" && verdict.reason === "MODEL" ? verdict.codes : null);
  });

  it("непереведённые карточки: запись на каждую, одинаковые коды не схлопываются (Р42 п. 6)", () => {
    const r = read([offers({ dropped: ["REQUIRED", "REQUIRED", "BAD_AMOUNT"] })]);
    expect(r.entries).toEqual([
      { kind: "dropped", merchantId: MERCHANT, code: "REQUIRED" },
      { kind: "dropped", merchantId: MERCHANT, code: "REQUIRED" },
      { kind: "dropped", merchantId: MERCHANT, code: "BAD_AMOUNT" },
    ]);
    expect(r.positions).toBe(3);
  });

  it("недоступная витрина: оба опознавателя и причина ядра как есть, в том числе когда опознавателей нет", () => {
    const byDetail: ShopUnavailable = { shopId: SHOP_B, merchantId: MERCHANT_B, unavailable: { detail: "BAD_RESPONSE" } };
    const byReason: ShopUnavailable = { unavailable: { reason: "SHOP_SEARCH_DEADLINE" } };
    const r = read([byDetail, byReason]);
    expect(r.entries).toEqual([
      { kind: "shop_unavailable", shopId: SHOP_B, merchantId: MERCHANT_B, cause: { detail: "BAD_RESPONSE" } },
      { kind: "shop_unavailable", shopId: undefined, merchantId: undefined, cause: { reason: "SHOP_SEARCH_DEADLINE" } },
    ]);
    expect(r.shopsUnavailable).toBe(2);
    expect(r.positions).toBe(0);
  });

  it("сквозной случай: все четыре вида записи встречаются, счёт сходится с числом записей", () => {
    const r = read([
      offers({ products: [productFacts(tartine)], dropped: ["BAD_AMOUNT"] }),
      offers({ merchantId: MERCHANT_B, shopIssues: ["BAD_INN"], products: [productFacts(rye)] }),
      { shopId: SHOP_B, unavailable: { detail: "NO_RESPONSE" } },
    ]);

    // Счёт закреплён числами, а не ссылкой на самого себя (находка ревью К2 № 7).
    expect(r.positions).toBe(3);
    expect(r.shopsExcluded).toBe(1);
    expect(r.shopsUnavailable).toBe(1);

    const kinds = count(r.entries);
    expect(kinds).toEqual({ offer: 2, dropped: 1, shop_excluded: 1, shop_unavailable: 1 });
    // Ни один вид записи не остался непокрытым — перечень берётся у модуля.
    for (const kind of CATALOG_ENTRY_KINDS) expect(kinds[kind], kind).toBeGreaterThan(0);
    // Позиции — товары и непереведённые карточки; записи о магазинах считаются отдельно.
    expect(kinds.offer + kinds.dropped).toBe(r.positions);
    expect(kinds.shop_excluded).toBe(r.shopsExcluded);
    expect(kinds.shop_unavailable).toBe(r.shopsUnavailable);
  });

  it("в учёт не попадает свободный текст карточки (инвариант 1, П38 п. 3 и п. 4)", () => {
    const r = read([offers({ products: [productFacts(tartine)], dropped: ["REQUIRED"] })]);
    const dump = JSON.stringify(r);
    for (const text of [tartine.title, tartine.description!, tartine.attributes["вес"]!, shop.returns.text])
      expect(dump).not.toContain(text);
    // А опознаватели и коды — попадают: иначе проверка выше проходила бы на пустом учёте.
    expect(dump).toContain("SKU-001");
    expect(dump).toContain("REQUIRED");
  });
});

/** Сколько записей каждого вида: перечень видов берётся у модуля, а не повторяется здесь. */
function count(entries: readonly CatalogEntry[]): Record<CatalogEntryKind, number> {
  const out = Object.fromEntries(CATALOG_ENTRY_KINDS.map((k) => [k, 0])) as Record<CatalogEntryKind, number>;
  for (const e of entries) out[e.kind] += 1;
  return out;
}
