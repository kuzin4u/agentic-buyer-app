// Набор витрин демо-стенда (К1.1 DEMO-2 ч. 1; Р-1235, Р-1276, Р-1278; передача kuzin4u/agentic-buyer-app#5, стенд v0.41.0).
// Фикстура Платформы SHOPS, в которой витрина SHOP-1042 «Масса Мадре» заменена своей: реквизиты фикстуры (id, merchant_id,
// ИНН, MCC, категория, регионы, возврат, знак готовности) — без изменений, поэтому поручение и его merchantScope
// (MERCHANT_FIXTURES) не меняются; товары — четыре SKU каталога пекарни (kuzin4u/Sourdough-Bakery, docs/DATA_MODEL.md).
// Цены — текущие, целые копейки и валюта (правило совместимости 2); штрихкодов нет — gtin: null.
import { SHOPS, type Shop, type ShopItem } from "agentic-ps-platform/fixtures";

export const MASSA_MADRE_ID = "SHOP-1042";

const fixture = SHOPS.find((s) => s.id === MASSA_MADRE_ID);
if (!fixture) throw new Error(`в SHOPS нет витрины ${MASSA_MADRE_ID}`);
/** Доставка и возраст карточки — как у хлеба фикстуры (Р-1278 п. 3). */
const bread = fixture.items[0];
if (!bread) throw new Error(`у витрины ${MASSA_MADRE_ID} фикстуры нет товаров`);

const item = (sku: string, title: string, weight: string, price: number, description: string): ShopItem => ({
  sku,
  title,
  description,
  price,
  currency: "RUB",
  in_stock: true,
  category: fixture.category,
  ...(bread.delivery !== undefined && { delivery: bread.delivery }),
  ...(fixture.returns && { returns: fixture.returns.text }),
  gtin: null,
  brand: null,
  model: null,
  ...(bread.updated_age_sec !== undefined && { updated_age_sec: bread.updated_age_sec }),
  ...(bread.delivery_options && { delivery_options: bread.delivery_options }),
  attributes: { вес: weight },
});

/** «Масса Мадре» — реквизиты фикстуры, товары — по Р-1276 и Р-1278 п. 3. */
export const MASSA_MADRE: Shop = {
  ...fixture,
  items: [
    item("SKU-001", "Тартин — хлеб на закваске", "650 г", 38000, "Классика: хрустящая корочка, пористый мякиш, лёгкая кислинка"),
    item("SKU-002", "Заварной ржано-пшеничный", "500 г", 42500, "Тёмный, плотный, солодовый вкус. Заварная технология"),
    item("SKU-003", "Тартин сырный", "650 г", 46800, "Тартин с кусочками Гауды/Грюйера внутри и сырной корочкой"),
    item("SKU-004", "Бородинский с кориандром", "400 г", 34000, "С кориандром и мёдом. Долгая ферментация"),
  ],
};

/** Набор стенда: «Масса Мадре» на стенде одна — на месте SHOP-1042 фикстуры (Р-1278 п. 1). */
export const DEMO_SHOPS: readonly Shop[] = SHOPS.map((s) => (s.id === MASSA_MADRE_ID ? MASSA_MADRE : s));
