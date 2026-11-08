// К1.1 (Р-1276, Р-1278; передача kuzin4u/agentic-buyer-app#5): набор витрин демо-стенда — SHOPS фикстуры с «Масса Мадре»
// на месте SHOP-1042; реквизиты фикстуры, четыре SKU каталога пекарни. Стенд v0.41.0 принимает набор (сверка (а)–(е)).
import { MERCHANT_FIXTURES, SHOPS } from "agentic-ps-platform/fixtures";
import { createStand } from "agentic-ps-platform/stand";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEMO_SHOPS, MASSA_MADRE, MASSA_MADRE_ID } from "../../src/demo/shops.js";
import { startDemo, type Demo } from "../../src/demo/run.js";

describe("набор витрин демо-стенда", () => {
  it("«Масса Мадре» одна — на месте SHOP-1042; остальные витрины фикстуры — без изменений и в том же порядке", () => {
    expect(DEMO_SHOPS.map((s) => s.id)).toEqual(SHOPS.map((s) => s.id));
    expect(DEMO_SHOPS.filter((s) => s.name === MASSA_MADRE.name)).toEqual([MASSA_MADRE]);
    for (const s of DEMO_SHOPS) if (s.id !== MASSA_MADRE_ID) expect(s).toBe(SHOPS.find((f) => f.id === s.id));
  });

  it("реквизиты — как в фикстуре: id, merchant_id, ИНН, MCC, категория, регионы, возврат, знак, поведение (Р-1278 п. 2)", () => {
    const fix = SHOPS.find((s) => s.id === MASSA_MADRE_ID)!;
    expect({ ...MASSA_MADRE, items: [] }).toEqual({ ...fix, items: [] });
    expect(MASSA_MADRE).toMatchObject({ merchant_id: "MER-1042", inn: "0010420004", mcc: "5462", behaviour: "NORMAL", readiness_mark: true });
  });

  it("товары — четыре SKU по Р-1276: цена в копейках RUB, вес в attributes, gtin/brand/model — null", () => {
    expect(MASSA_MADRE.items.map((i) => [i.sku, i.title, i.attributes?.["вес"], i.price, i.currency])).toEqual([
      ["SKU-001", "Тартин — хлеб на закваске", "650 г", 38000, "RUB"],
      ["SKU-002", "Заварной ржано-пшеничный", "500 г", 42500, "RUB"],
      ["SKU-003", "Тартин сырный", "650 г", 46800, "RUB"],
      ["SKU-004", "Бородинский с кориандром", "400 г", 34000, "RUB"],
    ]);
    const bread = SHOPS.find((s) => s.id === MASSA_MADRE_ID)!.items[0]!;
    for (const i of MASSA_MADRE.items) {
      expect(i).toMatchObject({ gtin: null, brand: null, model: null, in_stock: true, category: "хлеб" });
      expect(Number.isSafeInteger(i.price)).toBe(true);
      expect(i.delivery_options).toEqual(bread.delivery_options);
      expect(i.updated_age_sec).toBe(bread.updated_age_sec);
      expect(i.delivery).toBe(bread.delivery);
      expect(i.returns).toBe(bread.returns);
    }
  });

  it("поручение не меняется: продавцы набора — те же, что MERCHANT_FIXTURES (merchantScope)", () => {
    expect(DEMO_SHOPS.map((s) => s.merchant_id).sort()).toEqual(MERCHANT_FIXTURES.map((f) => f.merchant_id).sort());
  });

  it("стенд v0.41.0 принимает набор (сверка (а)–(е) fail-closed); цена не в целых копейках — исключение", async () => {
    const s = createStand({ shops: DEMO_SHOPS });
    expect(s.shops.map((x) => x.id)).toEqual(DEMO_SHOPS.map((x) => x.id));
    await s.close();
    const bad = { ...MASSA_MADRE, items: [{ ...MASSA_MADRE.items[0]!, price: 380.5 }] };
    expect(() => createStand({ shops: [bad] })).toThrow(/createStand: витрина SHOP-1042 — правило \(д\) price/);
  });
});

describe("живой стенд: витрина «Масса Мадре» в выдаче и со знаком готовности", () => {
  let demo: Demo;
  beforeAll(async () => {
    demo = await startDemo({ passMs: 0 });
  }, 60_000);
  afterAll(async () => {
    await demo?.close();
  });

  it("каталог SHOP-1042 у эмулятора продавцов — четыре SKU, без прежних товаров фикстуры; витрина в списке", async () => {
    const list = await fetch(`${demo.stand.urls.merchants}/v1/shops`);
    expect(list.status).toBe(200);
    expect(JSON.stringify(await list.json())).toContain(MASSA_MADRE_ID);
    const r = await fetch(`${demo.stand.urls.merchants}/v1/shops/${MASSA_MADRE_ID}/catalog`);
    expect(r.status).toBe(200);
    const body = (await r.json()) as { items: { sku: string; price?: number; currency?: string }[] };
    expect(body.items.map((i) => [i.sku, i.price, i.currency])).toEqual(MASSA_MADRE.items.map((i) => [i.sku, i.price, "RUB"]));
    expect(demo.stand.stand.shops.find((s) => s.id === MASSA_MADRE_ID)).toMatchObject({ readiness_mark: true, items: { length: 4 } });
  });});
