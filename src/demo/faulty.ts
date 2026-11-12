// Драйвер нарушителя «ПР» демо-стенда (П7, П-11.3): нарушения агента, которые эталонное ядро не совершает (Н-01, Н-05 ПР,
// Н-06…Н-09 «Задания на тестирование пульта» v1.0), разыгрывает приложение ключом своего агента и помечает каждое на
// стенде (`stand.demo.mark`, ответ Платформы по #112 п. 3–4). Решений здесь нет: драйвер — нарушитель, защиту дают
// Платформа и витрины кодами из таблицы п. 4 ответа #112.
//  - Только при `DEMO_FAULTS=1`: без флага экземпляр не создаётся и ключ не загружается (конструктор отказывает).
//  - Ключ агента загружается функцией ядра `loadKey` из каталога ключей демо-стенда и живёт только в памяти экземпляра:
//    на шину, в журнал, в ответы маршрута и на диск не попадает; запросы с ним уходят только на адреса стенда (П7 п. 5).
//  - Свой подписанный клиент ПАО и витрин, не порт ядра — исключение из правила совместимости 1 (П7, дополнение 1).
//  - Импортирует драйвер только сборка демо-стенда (`run.ts`) и автотесты; пульт и дашборды — нет (тест графа импортов).
// Договор ветки (повторное ревью П-11.3а-1, ревью П-11.3а-2; решения владельца, чат 11.11):
//  - запрос ключом агента (`c.call` — ПАО, `c.shop` — витрины) уходит только после пометки «ПР», пока ветка идёт и драйвер
//    её не остановил; запрет — на стороне клиента, а не на дисциплине ветки;
//  - драйвер ведёт журнал запросов ветки (ответ / отказ с кодом и статусом / сбой), дожидается всех ушедших запросов и
//    выносит итог только по журналу: «защита сработала» — объявленная пара «код + статус» в ответе; «совершено» — только
//    при пришедшем ответе 2xx; что ветка бросила или поймала, итог не меняет;
//  - на шину из ветки — только шаги закрытого перечня и только тест, код, статус и идентификаторы стенда по форме; коды из
//    ответов — тоже только по форме.
import { randomUUID } from "node:crypto";
import { signRequest, type Signer } from "@kuzin4u/agentic-core";
import { PaoCallError, PaoClient } from "@kuzin4u/agentic-core/pao";
import type { DemoIds } from "agentic-ps-platform/stand";
import { listKeys, loadKey } from "agentic-buyer-ref/src/agent/signer/index.js";
import { FAULT_PLAN, matchesOp, type FaultPlanEntry, type FaultStart, type FaultTest } from "./fault-tests.js";
import { DEMO_PRINCIPAL, EXPIRY_SEC, type ScenarioStep, type StepSink } from "./scenarios.js";
import { DEMO_SHOPS, MASSA_MADRE } from "./shops.js";
import type { DemoStand } from "./stand.js";

export { FAULT_PLAN, FAULT_TESTS, isFaultTest, type FaultPlanEntry, type FaultStart, type FaultTest, type Guard } from "./fault-tests.js";

type Pao = PaoClient<{ baseUrl: string; agentCode: string; signer: Signer; maxAttempts: number }>;

/** Идентификаторы пометки стенда (`DEMO_ID_FIELDS` Платформы, РП75 п. 4; в пакете не экспортируются). Список сверяется с
 *  типом `DemoIds` при компиляции в обе стороны: лишнее поле и недостающее — ошибка. */
export const ID_FIELDS = ["mandate_id", "confirmation_id", "op_ref", "merchant_id", "shop_id", "order_id", "order_ref"] as const satisfies readonly (keyof DemoIds)[];
const ID_FIELDS_COMPLETE: Exclude<keyof DemoIds, (typeof ID_FIELDS)[number]> extends never ? true : never = true;
void ID_FIELDS_COMPLETE;

/** Шаги, которые ветка может выпустить на шину, — закрытый перечень; у каждого — текст ru/en в словарях. Чужое имя —
 *  ошибка: драйвер останавливает ветку, её запросы больше не уходят, итог — BAD_STEP (инвариант 6: ни `outcome`, ни
 *  `run.*`, ни итоговых `fault.*`). «Запрос отправлен» (`fault.sent`) выпускает сам драйвер — по факту запроса. Ветки
 *  П-11.3б–д дописывают свои имена сюда и в словари. */
export const BRANCH_STEPS = [
  "fault.note.prepared",
  // П-11.3б: подготовка Н-07 и Н-06 — поручение нарушителя, подпись и отзыв — клиентом в банке.
  "fault.note.intent_requested",
  "fault.note.intent_signed",
  "fault.note.cart_created",
  "fault.note.cart_keep_unsigned",
  "fault.note.cart_sign_ask",
  "fault.note.cart_signed",
  "fault.note.cart_sign_ask_scope",
  "fault.note.other_merchant",
  "fault.note.revoke_ask",
  "fault.note.revoked",
  // П-11.3г: подготовка Н-01 — настоящая покупка: заказ у витрины и первая (законная) оплата.
  "fault.note.order_placed",
  "fault.note.first_payment",
  // П-11.3д: Н-05 — нарушитель прочитал каталог (только записи стенда, Р-1483).
  "fault.note.catalog_read",
] as const;
export type BranchStep = (typeof BRANCH_STEPS)[number];

/** Ответ витрины на запрос ветки (тело — только в памяти ветки: на шину не идёт). */
export interface ShopReply {
  readonly status: number;
  readonly body: unknown;
}

/** Что ветка получает. Стенд — только адреса ПАО и витрин: ни эмулятора банка и страницы УПК (подпись и подтверждение за
 *  клиента — только эмулятор клиента, П5 п. 5), ни каталога ключей. */
export interface FaultContext {
  /** Запрос к ПАО ключом агента — только после `mark`, пока ветка идёт; иначе не уходит (отказ промиса). */
  readonly call: Pao["call"];
  /** Запрос к витрине ключом агента (подпись, как у ядра) — по тем же правилам и только на адрес витрин стенда: путь —
   *  с `/`, без `#`; иначе не уходит. Ответ не 2xx — отказ промиса. */
  readonly shop: (method: "GET" | "POST", target: string, body?: unknown) => Promise<ShopReply>;
  /** **Нарушающий** запрос (ревью П-11.3а-2, повторное № 1): те же `call` и `shop`, но итог считается только по ним —
   *  «защита сработала» и «совершено». `call` и `shop` выше — подготовка: у неё учитывается лишь сбой. */
  readonly violate: { readonly call: Pao["call"]; readonly shop: FaultContext["shop"] };
  readonly urls: Readonly<{ pao: string; merchants: string }>;
  /** Шаг на шину: имя — из BRANCH_STEPS, параметры — только `code`, `status` и идентификаторы стенда по форме. */
  readonly step: (step: BranchStep, params?: ScenarioStep["params"]) => void;
  readonly signal: AbortSignal;
  /** Пометка «ПР» на стенде — **до** нарушающего запроса (П7 п. 4). Отказ стенда — исключение, ветка остановлена. */
  readonly mark: (ids: DemoIds) => void;
  /** Ждать действия **клиента** над мандатом (подпись — ACTIVE, отзыв — REVOKED) по `GET` мандата, не дольше срока
   *  (`clientWaitMs`). Драйвер за клиента ничего не делает (инвариант 3, П5): подписывает и отзывает человек на экране банка
   *  или эмулятор клиента «Авто» при `DEMO_FAULTS=1`; в автотестах — эмулятор банка. Срок истёк — ветка остановлена с
   *  конкретной причиной (CLIENT_SIGN_TIMEOUT / CLIENT_REVOKE_TIMEOUT); клиент отклонил — CLIENT_DECLINED. */
  readonly waitClient: (mandateId: string, want: "ACTIVE" | "REVOKED") => Promise<void>;
  /** Разбудить ленту событий ядра (только чтение ленты ПАО ядром, как опрос сюжетов): лента читает лишь по сигналу, а
   *  push в демо-стенде нет — без сигнала событие Платформы по запросам ветки (Н-01: `operation.authorized` первой оплаты)
   *  дошло бы до монитора только со следующим сюжетом. Итог на мониторе — по событию (инвариант 6), драйвер его не пишет. */
  readonly wakeEvents: () => void;
}

/** Ветка нарушения: только ход. Роль нарушения и ожидаемую защиту ветка не объявляет — драйвер берёт их из закрытой
 *  таблицы FAULT_PLAN (ревью П-11.3а-3 № 3); итог выносит по журналу её запросов. */
export interface FaultBranch {
  readonly run: (c: FaultContext) => Promise<void>;
}

/** Поручение нарушителя (подготовка Н-07, Н-06): как у агента в сюжете 1 — «хлеб», до 1 000 ₽, на «Массу Мадре»; подписывает
 *  клиент. Корзина под ним — один товар витрины по её цене. Данные мандата, не строки интерфейса. */
const VIOLATOR_SHOP = MASSA_MADRE;
const VIOLATOR_ITEM = MASSA_MADRE.items[0]!;
const VIOLATOR_PRICE: number = (() => {
  const p = VIOLATOR_ITEM.price;
  if (typeof p !== "number") throw new Error("у товара витрины нарушителя нет цены");
  return p;
})();
/** Срок корзины — не позже срока поручения: тот же, что у поручения (иначе Платформа отказывает MANDATE_SCOPE). */
const mandateBody = (type: "INTENT" | "CART", parent: string | null, validTo: string) => {
  const price = VIOLATOR_PRICE;
  return {
    type,
    parent_id: parent,
    subject: "хлеб",
    amount_limit: type === "INTENT" ? 100000 : price,
    currency: "RUB",
    valid_to: validTo,
    merchant_scope: [VIOLATOR_SHOP.merchant_id],
    principal_ref: DEMO_PRINCIPAL,
    mode: "IMMEDIATE" as const,
    key_terms_shown: true,
    cart: type === "CART" ? { merchant_id: VIOLATOR_SHOP.merchant_id, items: [{ sku: VIOLATOR_ITEM.sku, qty: 1, price }], total: price } : null,
  };
};

/** Подготовка Н-01, Н-06…Н-09: пометка по продавцу, поручение нарушителя, подпись клиента, корзина под ним, пометка по
 *  корзине. Не экспортируется: обратный автотест Н-08 берёт ветку фабрикой n08Branch (П-11.3д-2; ревью П-11.3в № 5). */
async function intentAndCart(c: FaultContext, key: string): Promise<{ intentId: string; cartId: string }> {
  c.mark({ merchant_id: VIOLATOR_SHOP.merchant_id, shop_id: VIOLATOR_SHOP.id });
  const validTo = new Date(Date.now() + 86_400_000).toISOString();
  const intent = await c.call("POST /pao/v1/mandates", { body: mandateBody("INTENT", null, validTo), idempotencyKey: `${key}-intent` });
  const intentId = String(intent.id);
  c.step("fault.note.intent_requested", { mandate_id: intentId });
  await c.waitClient(intentId, "ACTIVE");
  c.step("fault.note.intent_signed", { mandate_id: intentId });
  const cart = await c.call("POST /pao/v1/mandates", { body: mandateBody("CART", intentId, String(intent.valid_to ?? validTo)), idempotencyKey: `${key}-cart` });
  const cartId = String(cart.id);
  c.step("fault.note.cart_created", { mandate_id: cartId });
  // Вторая пометка — по корзине, до нарушения (решение владельца, чат 11.11, вариант (а)): «ПР» несёт идентификатор корзины,
  // а не только продавца (у честного сюжета 1 тот же продавец; ревью П-11.3б № 6). Пульт пока корзину нарушителя в модель не
  // берёт (её шаги — `fault.note.*`) и относит пометку к системе — привязка «ПР» к транзакции нарушителя — в «Открыто»
  // (повторное ревью П-11.3б C).
  c.mark({ mandate_id: cartId, merchant_id: VIOLATOR_SHOP.merchant_id, shop_id: VIOLATOR_SHOP.id });
  return { intentId, cartId };
}

/** Реквизит по корзине нарушителя — нарушение Н-06…Н-09 (операция таблицы FAULT_PLAN). Сумма — минимальные единицы и
 *  валюта корзины (правило совместимости 2); по умолчанию — цена корзины и продавец корзины. Тело ответа (реквизит) — только
 *  в памяти вызывающего: в журнал нарушения идёт лишь исход (ответ / отказ / сбой), на шину — код и статус (инвариант 1). */
const credentialFor = (c: FaultContext, cartId: string, key: string, o: CredentialOptions = {}) =>
  c.violate.call("POST /pao/v1/credentials", { body: credentialBody(cartId, key, o), idempotencyKey: `${key}-credential` });

type CredentialOptions = { amountMax?: number; merchantId?: string; orderRef?: string };
/** Тело запроса реквизита: по умолчанию — цена и продавец корзины, номер заказа — условный (у Н-06…Н-09 заказа нет);
 *  у Н-01 — номер настоящего заказа витрины (витрина сверяет его с `order_ref` пакета). */
const credentialBody = (cartId: string, key: string, o: CredentialOptions) => ({
  mandate_id: cartId,
  order_ref: o.orderRef ?? `fault-${key}`,
  merchant_id: o.merchantId ?? VIOLATOR_SHOP.merchant_id,
  amount_max: o.amountMax ?? VIOLATOR_PRICE,
  currency: "RUB",
  kind: "CARD" as const,
});

/** Подпись корзины клиентом перед нарушением Н-08, Н-09: в ПАО проверка «не подписан» стоит раньше «вне области» — по
 *  неподписанной корзине защита MANDATE_SCOPE не проверяется (план П-11.3в). */
async function signedCart(c: FaultContext, key: string): Promise<{ intentId: string; cartId: string }> {
  const ids = await intentAndCart(c, key);
  c.step("fault.note.cart_sign_ask_scope", { mandate_id: ids.cartId });
  await c.waitClient(ids.cartId, "ACTIVE");
  c.step("fault.note.cart_signed", { mandate_id: ids.cartId });
  return ids;
}

/** Остановка ветки ею самой с конкретной причиной (до пометки — «не помечено», после — «помечено, но не разыграно»). */
/** Причины, с которыми ветка останавливается сама (`BranchStop`). */
export const BRANCH_STOP_CODES = ["NO_SECOND_MERCHANT", "ORDER_ID_MALFORMED", "FIRST_PAYMENT_NOT_AUTHORIZED"] as const;
class BranchStop extends Error {
  constructor(readonly code: (typeof BRANCH_STOP_CODES)[number]) {
    super(code);
  }
}

/** Продавец Б для Н-09 — первая витрина набора стенда, отличная от продавца корзины (не литералом: при правке состава витрин
 *  литерал молча указал бы на несуществующего продавца). Нет такой — undefined (решение владельца, чат 11.11). */
export const otherMerchant = (shops: readonly { readonly merchant_id: string; readonly id: string }[]): string | undefined =>
  shops.find((s) => s.merchant_id !== VIOLATOR_SHOP.merchant_id)?.merchant_id;

/** Ветка Н-08 на данной сумме реквизита (ревью П-11.3в № 2): в таблице — цена корзины + 1 (нарушение), в обратном автотесте —
 *  цена корзины (в пределе): один ход, отличие — одно поле; правка ветки не разводит прямой и обратный тесты. Н-09 —
 *  отдельная ветка: что она отличается от обратного Н-08 только продавцом, тест проверяет по телу запроса реквизита. */
export const n08Branch = (amountMax: number): FaultBranch => ({
  run: async (c) => {
    const key = `n08-${randomUUID()}`;
    const { cartId } = await signedCart(c, key);
    await credentialFor(c, cartId, key, { amountMax });
  },
});

/** Ветка Н-09 на данном наборе витрин (для автотестов «нет второго продавца»; в сборке — DEMO_SHOPS). */
export const n09Branch = (shops: readonly { readonly merchant_id: string; readonly id: string }[]): FaultBranch => ({
  run: async (c) => {
    const merchantB = otherMerchant(shops);
    if (merchantB === undefined) throw new BranchStop("NO_SECOND_MERCHANT"); // до пометки и запросов
    const key = `n09-${randomUUID()}`;
    const { cartId } = await signedCart(c, key);
    c.step("fault.note.other_merchant", { merchant_id: merchantB });
    await credentialFor(c, cartId, key, { merchantId: merchantB });
  },
});

/** Ветка Н-01 «повторная оплата заказа» (R46 «два списания»; ответ Платформы по #112 п. 4; решения владельца, чат 11.11).
 *  Пометки «ПР» — по продавцу и по корзине (intentAndCart) и третья — по заказу: после проверки номера, до реквизита
 *  (решение владельца по В4, чат 12.11).
 *  Подготовка — настоящая покупка: подписанная клиентом корзина, заказ у витрины, реквизит по этому заказу, первая оплата
 *  пакетом агентской оплаты — законная, с авторизацией на Платформе (событие `operation.authorized` на шине). Нарушение —
 *  тот же пакет ещё раз на тот же заказ → витрина 409 ORDER_NOT_PAYABLE, вторая авторизация не уходит.
 *  - Пакет — ровно ПАО §4 (как у ядра): поля ответа Платформы на реквизит без изменений + корзина и номер заказа. Пакет и
 *    реквизит — только в памяти ветки (инвариант 1): `#shop` пишет в журнал лишь исход, на шину — только идентификаторы.
 *  - Первая оплата прошла — по записи операции Платформы (`GET /pao/v1/operations` по корзине), не по ответу витрины
 *    (инвариант 6): витрина отвечает ORDER_NOT_PAYABLE на любой заказ не в состоянии CREATED — и на отклонённый, и на
 *    ждущий подтверждения; без этой проверки отказ повтора мог бы прийти без первого списания (ложная «защита»).
 *    Не прошла — «помечено, но не разыграно» FIRST_PAYMENT_NOT_AUTHORIZED, нарушение не уходит. */
const n01Branch: FaultBranch = {
  run: async (c) => {
    const key = `n01-${randomUUID()}`;
    const { cartId } = await signedCart(c, key);
    const placed = await c.shop("POST", `/v1/shops/${VIOLATOR_SHOP.id}/orders`, { items: [{ sku: VIOLATOR_ITEM.sku, qty: 1 }], cart_mandate_id: cartId });
    // Номер заказа — из ответа витрины (данные витрины): только по форме идентификатора, иначе в путь и на шину не идёт.
    const orderId = (placed.body as { id?: unknown } | null | undefined)?.id;
    // Номер — ещё и сегмент пути оплаты: первый знак — буква или цифра (ни «.», ни «..»), иначе реквизит выдавался бы впустую
    // до отказа адреса BAD_TARGET (повторное ревью П-11.3г № 5).
    if (typeof orderId !== "string" || !ID_FORM.test(orderId) || !/^[A-Za-z0-9]/.test(orderId)) throw new BranchStop("ORDER_ID_MALFORMED");
    // Третья пометка — по заказу, до реквизита и первой оплаты (решение владельца по В4, чат 12.11; ревью П-11.3г № 2):
    // в Н-01 нарушение совершается над заказом — без пометки по нему разбор «ПР» на стенде неполон. Итог несёт её
    // идентификаторы (последняя пометка).
    c.mark({ mandate_id: cartId, order_id: orderId, order_ref: orderId, merchant_id: VIOLATOR_SHOP.merchant_id, shop_id: VIOLATOR_SHOP.id });
    c.step("fault.note.order_placed", { order_id: orderId, mandate_id: cartId });
    const cred = await c.call("POST /pao/v1/credentials", { body: credentialBody(cartId, key, { orderRef: orderId }), idempotencyKey: `${key}-credential` });
    const pkg = { credential_ref: cred.credential_ref, kind: cred.kind, payload: cred.payload, aoi: cred.aoi, cart_mandate_id: cartId, order_ref: orderId };
    const payment = `/v1/shops/${VIOLATOR_SHOP.id}/orders/${orderId}/payment`;
    await c.shop("POST", payment, pkg);
    const ops = await c.call("GET /pao/v1/operations", { query: { mandate_id: cartId } });
    const first = ops.filter((o) => o.order_ref === orderId);
    const opRef = first[0]?.op_ref;
    // Условие хода, а не итог: «авторизовано» на монитор выпускает только событие Платформы, которое получило ядро (ревью
    // П-11.3г № 1). Номер операции — по форме: по нему пульт свяжет событие с шагом (№ 9).
    if (first.length !== 1 || (first[0]!.status !== "AUTHORIZED" && first[0]!.status !== "SETTLED") || typeof opRef !== "string" || !ID_FORM.test(opRef))
      throw new BranchStop("FIRST_PAYMENT_NOT_AUTHORIZED");
    c.step("fault.note.first_payment", { order_id: orderId, op_ref: opRef });
    c.wakeEvents(); // итог первой оплаты — на монитор событием Платформы, не словами драйвера
    await c.violate.shop("POST", payment, pkg);
  },
};

/** Ветка Н-05 «ПР» «инструкция продавца агенту» (R47; Р-1483; решения владельца по В1–В2 П-11.3д, чат 12.11): к MVP —
 *  только записи стенда. Сбой Н-05 на витрину нарушителя взводит и снимает драйвер (таблица: `arm`); ветка помечает
 *  продавца и читает каталог ключом агента — витрина подмешивает в первую карточку инструкцию и пишет INSTRUCTION_SERVED.
 *  Ответ каталога ветка не читает: инструкция — данные витрины, не команда, на шину и в итог не идёт (инвариант 4).
 *  Итог «записи стенда сделаны» выносит драйвер по журналу стенда (таблица: `recordOnly`). */
const n05Branch: FaultBranch = {
  run: async (c) => {
    c.mark({ merchant_id: VIOLATOR_SHOP.merchant_id, shop_id: VIOLATOR_SHOP.id });
    await c.shop("GET", `/v1/shops/${VIOLATOR_SHOP.id}/catalog`);
    c.step("fault.note.catalog_read", { shop_id: VIOLATOR_SHOP.id });
  },
};

/** Ветки по тестам (П-11.3б–д). Нет ветки — запуск NOT_READY. */
const BRANCHES: Partial<Record<FaultTest, FaultBranch>> = {
  "Н-01": n01Branch,
  "Н-05": n05Branch,
  // Н-07 «транзакция без согласия клиента» (R18): реквизит по корзине, которую клиент не подписывал → 409
  // PRINCIPAL_SIGNATURE_PENDING.
  "Н-07": {
    run: async (c) => {
      const key = `n07-${randomUUID()}`;
      const { cartId } = await intentAndCart(c, key);
      c.step("fault.note.cart_keep_unsigned", { mandate_id: cartId });
      await credentialFor(c, cartId, key);
    },
  },
  // Н-06 «агент не видит отзыв» (R37 / R09 / R18): полномочие **действовало** — клиент подписал и поручение, и корзину —
  // и было отозвано: клиент отзывает поручение в банке (корзина — каскадом, как сюжет 5); нарушитель всё равно просит
  // реквизит по корзине → 409 MANDATE_REVOKED (решение владельца 1, чат 11.11; ревью П-11.3б № 5).
  "Н-06": {
    run: async (c) => {
      const key = `n06-${randomUUID()}`;
      const { intentId, cartId } = await intentAndCart(c, key);
      c.step("fault.note.cart_sign_ask", { mandate_id: cartId });
      await c.waitClient(cartId, "ACTIVE");
      c.step("fault.note.cart_signed", { mandate_id: cartId });
      c.step("fault.note.revoke_ask", { mandate_id: intentId });
      // Отозвано должно быть поручение — действием клиента (отказ агента от полномочий подготовке запрещён, BAD_PREP).
      await c.waitClient(intentId, "REVOKED");
      await c.waitClient(cartId, "REVOKED");
      c.step("fault.note.revoked", { mandate_id: cartId });
      await credentialFor(c, cartId, key);
    },
  },
  // Н-08 «сумма операции ≠ корзине» (R17), ветка MANDATE_SCOPE (Р-1459 В5): реквизит по подписанной корзине на сумму на одну
  // минимальную единицу больше её предела → 409 MANDATE_SCOPE.
  "Н-08": n08Branch(VIOLATOR_PRICE + 1),
  // Н-09 «оплата другому продавцу» (R26), ветка MANDATE_SCOPE: реквизит по подписанной корзине продавца А на продавца Б →
  // 409 MANDATE_SCOPE. Это и защита Платформы для П-06 (сюжет 8 — защитил агент).
  "Н-09": n09Branch(DEMO_SHOPS),
};

/** Сколько закрытие ждёт идущую ветку (как у сюжетов): ответ стенда без таймаута не вешает остановку демо. */
const CLOSE_WAIT_MS = 3000;
/** Срок ответа ПАО и витрины на запрос ветки, мс: повисший запрос не держит драйвер (и через блокировку — сюжеты)
 *  занятым (повторное № 2). */
const REQUEST_TIMEOUT_MS = 10_000;

export interface FaultyOptions {
  readonly branches?: Partial<Record<FaultTest, FaultBranch>>;
  /** Идёт ли сюжет: нарушитель ходит тем же ключом агента — одновременно с сюжетом не стартует. */
  readonly otherBusy?: () => boolean;
  /** Срок ожидания ветки при закрытии, мс (по умолчанию CLOSE_WAIT_MS). */
  readonly closeWaitMs?: number;
  /** Только для автотестов: подменный fetch для ПАО и витрин («нет ответа», 5xx, перенаправление, код не по форме).
   *  Сборка демо-стенда (`run.ts`) его не передаёт (тест границы драйвера проверяет вызов конструктора в `run.ts`). */
  readonly fetch?: typeof fetch;
  /** Срок ответа на запрос ветки, мс (по умолчанию REQUEST_TIMEOUT_MS). */
  readonly timeoutMs?: number;
  /** Срок ожидания действия клиента (подпись, отзыв), мс. По умолчанию — 180 с, как срок поручения сюжета 10 (EXPIRY_SEC):
   *  человек успевает подписать в банке (решение владельца, чат 11.11). В автотестах — короче. */
  readonly clientWaitMs?: number;
  /** Только для автотестов: таблица нарушений вместо FAULT_PLAN (как `branches`). Сборка демо-стенда её не передаёт. */
  readonly plan?: Partial<Record<FaultTest, FaultPlanEntry>>;
}

/** Срок ожидания действия клиента по умолчанию, мс — срок поручения сюжета 10. */
const CLIENT_WAIT_MS = EXPIRY_SEC * 1000;
/** Как часто драйвер перечитывает мандат, ожидая действия клиента, мс. */
const CLIENT_POLL_MS = 300;

/** Причины остановки ветки драйвером — закрытый перечень (Р-1511): у каждой — фраза ru/en в `CODE_WORDS`, это сверяет тест. */
export const STOP_CODES = [
  "NOT_MARKED",
  "MARK_REJECTED",
  "MARK_AFTER_VIOLATION",
  "BAD_STEP",
  "BAD_TARGET",
  "BAD_VIOLATION",
  "BAD_PREP",
  "CLIENT_SIGN_TIMEOUT",
  "CLIENT_REVOKE_TIMEOUT",
  "CLIENT_DECLINED",
  "ABORTED",
  "ARM_REJECTED",
  "ARMED_ELSEWHERE",
] as const;
/** Итоговые коды, которые выносит разбор журнала ветки (`#settle`, `paoEntry`, `shopEntry`), — тоже с фразой ru/en; кроме
 *  `UNEXPECTED_<код>` (код защиты как есть) и `missing` строки таблицы (`FAULT_PLAN`). */
export const SETTLE_CODES = ["BRANCH_ERROR", "NOT_SENT", "PREP_FAILED", "NO_RESPONSE", "MALFORMED_BODY"] as const;
type StopCode = (typeof STOP_CODES)[number] | BranchStop["code"];

/** Куда сбой стенда взвёл человек (маршрут `/stand-fault/`, П-11.2б): витрина и / или продавец; оба пусты — на все витрины. */
export interface HumanArm {
  readonly shop_id?: string;
  readonly merchant_id?: string;
}

/** Запуск нарушения: сведения о взводе человеком этого теста — от маршрута сбоев «П» (П-11.2г, Р-1520). */
export interface FaultStartOptions {
  readonly humanArm?: HumanArm;
}

/** Отказ запроса ветки драйвером (запрос не ушёл): остановлена ветка, кончилась или драйвер закрыт. */
class FaultStop extends Error {
  constructor(
    readonly code: StopCode | "CLOSED" | "SECOND_VIOLATION" | "PREP_AFTER_VIOLATION" | "PREP_PENDING",
    options?: { cause?: unknown },
  ) {
    super(code, options);
  }
}

/** Отказ витрины на запрос ветки: ответ не 2xx. */
class ShopCallError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | undefined,
  ) {
    super(`витрина: ${status}${code ? ` ${code}` : ""}`);
  }
}

/** Исход запроса ветки: ответ 2xx, отказ (код по форме и статус — кандидат в «защиту»), сбой (не защита). */
type Outcome = { readonly kind: "ok" } | { readonly kind: "refused"; readonly code: string; readonly status: number } | { readonly kind: "fail"; readonly code: string; readonly status?: number };
/** Запись журнала: исход, роль — подготовка или нарушение — и у запроса к витрине его метод и путь (для `recordOnly.via`). */
type Entry = Outcome & { readonly violation: boolean; readonly op?: { readonly method: string; readonly path: string } };

const CODE_FORM = /^[A-Z][A-Z0-9_]{0,63}$/;
const ID_FORM = /^[A-Za-z0-9_.:-]{1,128}$/;

/** Код из ответа — только по форме; иначе сбой формы, а не код (инварианты 1, 4). */
const formCode = (code: unknown): string | undefined => (typeof code === "string" && CODE_FORM.test(code) ? code : undefined);

/** Отказ промиса, помеченный обработанным: ветка, не дождавшаяся запроса, не роняет процесс. */
function rejected<T>(e: unknown): Promise<T> {
  const p = Promise.reject(e) as Promise<T>;
  p.catch(() => undefined);
  return p;
}

export class FaultyDriver {
  readonly #d: DemoStand;
  readonly #emit: StepSink;
  readonly #pao: Pao;
  readonly #signer: Signer;
  readonly #fetch: typeof fetch;
  readonly #branches: Partial<Record<FaultTest, FaultBranch>>;
  readonly #otherBusy: () => boolean;
  readonly #closeWaitMs: number;
  readonly #clientWaitMs: number;
  readonly #plan: Readonly<Record<FaultTest, FaultPlanEntry>>;
  readonly #ac = new AbortController();
  #running: Promise<void> | null = null;
  /** Прервать идущую ветку (кнопка «прервать»): итог — «не разыграно» ABORTED. */
  #abortRun: (() => void) | null = null;
  /** Снять сбой стенда, взведённый драйвером на время ветки (`arm` таблицы); null — снимать нечего. Вызывается при любом
   *  исходе: конец ветки, «прервать», закрытие драйвера — и только один раз. */
  #disarm: (() => void) | null = null;
  /** Тест, чей сбой стенда держит ветка (взвела драйвер и ещё не сняла); null — не держит. Пока держит, взвод и снятие этого
   *  теста человеком отклоняются (П-11.2в, П7 доп. 2): у стенда один взвод на тест, чужой взвод перезаписал бы витрину
   *  нарушителя, а снятие драйвером в конце ветки сняло бы и сбой человека. */
  #held: FaultTest | null = null;
  /** Снять удержание этого прогона, если взвод не драйвера (взвёл человек, П-11.2г (а)); null — снимать нечего. */
  #releaseHold: (() => void) | null = null;

  constructor(d: DemoStand, emit: StepSink, o: FaultyOptions = {}) {
    // Без режима сбоев драйвера нет (П7 п. 2): ни ключа, ни клиента.
    if (!d.faults || d.keysDir === undefined || d.stand.demo === undefined) throw new Error("драйвер нарушителя — только при DEMO_FAULTS=1 (П7)");
    const active = listKeys(d.keysDir).filter((k) => k.state === "active" && d.isAgentKid(k.kid));
    if (active.length !== 1) throw new Error(`ключ агента приложения: действующих ${active.length}, нужен один (П7)`);
    const { signer } = loadKey(d.keysDir, active[0]!.kid);
    this.#signer = signer;
    // Срок и отмена — у каждого запроса, ПАО и витрин (повторное № 2): повисший ответ кончается «нет ответа», закрытие
    // драйвера обрывает идущие запросы.
    const base = o.fetch ?? fetch;
    const timeoutMs = o.timeoutMs ?? REQUEST_TIMEOUT_MS;
    this.#fetch = ((input: string | URL | Request, init?: RequestInit) =>
      base(input, { ...init, signal: AbortSignal.any([this.#ac.signal, AbortSignal.timeout(timeoutMs), ...(init?.signal ? [init.signal] : [])]) })) as typeof fetch;
    // Одна попытка: нарушитель не повторяет — код защиты нужен как есть.
    this.#pao = new PaoClient({ baseUrl: d.urls.pao, agentCode: d.agentCode, signer, maxAttempts: 1, fetch: this.#fetch });
    this.#d = d;
    this.#emit = emit;
    this.#branches = o.branches ?? BRANCHES;
    this.#otherBusy = o.otherBusy ?? (() => false);
    this.#closeWaitMs = o.closeWaitMs ?? CLOSE_WAIT_MS;
    this.#clientWaitMs = o.clientWaitMs ?? CLIENT_WAIT_MS;
    this.#plan = { ...FAULT_PLAN, ...o.plan };
  }

  /** Занят — пока идёт ветка и пока не пришли ответы на все её запросы. */
  get busy(): boolean {
    return this.#running !== null;
  }

  /** Держит ли ветка взвод сбоя стенда этого теста: всё время ветки, которая пользуется взводом, — своим (П-11.2в) или
   *  человека на витрину нарушителя (П-11.2г (а), Р-1520); «прервать» и закрытие снимают удержание сразу. */
  holds(test: string): boolean {
    return (this.#disarm !== null || this.#releaseHold !== null) && this.#held === test;
  }

  /** Есть ли у теста ветка (кирпичи П-11.3б–д). */
  has(test: FaultTest): boolean {
    return Object.hasOwn(this.#branches, test);
  }

  /** Запустить нарушение; ход — шагами на шину. Возвращает сразу. */
  start(test: FaultTest, o: FaultStartOptions = {}): FaultStart {
    if (this.#ac.signal.aborted) return { ok: false, code: "CLOSED" };
    if (this.#running || this.#otherBusy()) return { ok: false, code: "BUSY" };
    const branch = Object.hasOwn(this.#branches, test) ? this.#branches[test] : undefined;
    if (!branch) return { ok: false, code: "NOT_READY" };
    // Своя метка прогона: «Контроль» режет ленту по `run.*` — нарушение не приклеится к прогону последнего сюжета.
    this.#step("run.fault", { test });
    const running: Promise<void> = this.#run(test, branch, o.humanArm)
      .catch(() => undefined)
      .finally(() => {
        if (this.#running === running) this.#running = null;
      });
    this.#running = running;
    return { ok: true };
  }

  /** Прервать идущее нарушение по кнопке «прервать» (решение владельца 3, чат 11.11: срок ожидания клиента — с отменой):
   *  запросы ветки больше не уходят, ожидание клиента снимается, итог — «не разыграно» ABORTED; драйвер не закрывается. */
  abort(): { ok: true } | { ok: false; code: "NOT_AWAITING" } {
    if (!this.#abortRun) return { ok: false, code: "NOT_AWAITING" };
    this.#abortRun();
    this.#disarm?.(); // не ждать конца ветки: сбой стенда снят сразу
    this.#releaseHold?.(); // взвод человека не снимается, удержание — сразу
    return { ok: true };
  }

  /** Дождаться текущего нарушения (для тестов). */
  async settled(): Promise<void> {
    await this.#running;
  }

  /** Остановить драйвер: новых нарушений нет (CLOSED), запросы ветки после закрытия не уходят, идущее — не дольше
   *  срока; после срока драйвер свободен. */
  async close(): Promise<void> {
    this.#ac.abort();
    this.#disarm?.(); // зависшая ветка не держит сбой стенда взведённым после закрытия
    this.#releaseHold?.();
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([this.#running, new Promise<void>((ok) => (timer = setTimeout(ok, this.#closeWaitMs)))]);
    clearTimeout(timer);
    this.#running = null;
  }

  async #run(test: FaultTest, branch: FaultBranch, humanArm: HumanArm | undefined): Promise<void> {
    // Сигнал ветки: закрывается закрытием драйвера, остановкой ветки драйвером и её концом. Запросы, уже ушедшие,
    // доходят до ответа (их ждёт итог); новые не уходят.
    const run = new AbortController();
    const signal = AbortSignal.any([this.#ac.signal, run.signal]);
    const plan = this.#plan[test];
    const journal: Promise<Entry>[] = [];
    let marked: DemoIds | undefined;
    let stop: StopCode | undefined;
    const halt = (code: StopCode): FaultStop => {
      stop ??= code;
      run.abort();
      return new FaultStop(code);
    };
    /** Нарушение уже отправлено: за прогон — одно (ревью П-11.3а-3 № 1, № 2; решение владельца, чат 11.11). */
    let violated = false;
    /** Подготовка без ответа: пока она идёт, нарушение не уходит — иначе отказ нарушения мог бы прийти раньше, чем
     *  подготовка сделана (ревью П-11.3а-4 № 2; исключение из решения о последнем кирпиче каркаса). */
    let prepPending = 0;
    /** Можно ли отправить запрос: ветка идёт, драйвер не закрыт, пометка стоит; после нарушения — ни второго нарушения,
     *  ни подготовки (запрос не уходит; итог прошедшего нарушения это не меняет). Иначе — причина. */
    const gate = (violation: boolean): FaultStop | undefined =>
      signal.aborted
        ? new FaultStop("CLOSED")
        : !marked
          ? halt("NOT_MARKED")
          : violated
            ? new FaultStop(violation ? "SECOND_VIOLATION" : "PREP_AFTER_VIOLATION")
            : violation && prepPending > 0
              ? new FaultStop("PREP_PENDING")
              : undefined;
    /** Учёт подготовки в полёте: снимается, когда пришёл её исход (ответ или сбой). */
    const track = <T>(violation: boolean, p: Promise<T>): Promise<T> => {
      if (violation) return p;
      prepPending++;
      const done = () => void prepPending--;
      p.then(done, done);
      return p;
    };

    this.#abortRun = () => void halt("ABORTED");
    const mark = (ids: DemoIds): void => {
      if (signal.aborted) throw new FaultStop("CLOSED");
      // Пометки — до нарушения (решение владельца, чат 11.11, вариант (а)): вторая пометка по корзине — можно, после
      // нарушающего запроса — нет.
      if (violated) throw halt("MARK_AFTER_VIOLATION");
      // Форма до стенда (повторное № 6): хотя бы один идентификатор, все — по форме; иначе пометка на стенде и итог на
      // шине разошлись бы, а пустая пометка открыла бы защёлку.
      const entries = Object.entries(ids).filter(([, v]) => v !== undefined);
      if (entries.length === 0 || entries.some(([k, v]) => !(ID_FIELDS as readonly string[]).includes(k) || typeof v !== "string" || !ID_FORM.test(v))) throw halt("MARK_REJECTED");
      try {
        this.#d.stand.demo!.mark(test, ids);
      } catch (e) {
        throw Object.assign(halt("MARK_REJECTED"), { cause: e });
      }
      marked = { ...ids }; // копия: изменение объекта веткой после пометки не расходится с записью MARKED
    };

    /** Запрос к ПАО: подготовка или нарушение (роль — в журнал; «запрос отправлен» — только у нарушения). */
    const callAs = (violation: boolean) =>
      ((op: Parameters<Pao["call"]>[0], args: Parameters<Pao["call"]>[1]) => {
        const g = gate(violation);
        if (g) return rejected(g);
        // Нарушение — только операцией из закрытой таблицы (иное — ошибка, не предупреждение; решение владельца, чат 11.11).
        if (violation && !plan.violations.includes(op)) return rejected(halt("BAD_VIOLATION"));
        // Отказ агента от полномочий — не подготовка: он даёт тот же REVOKED, что и отзыв клиентом, и подменил бы действие
        // клиента в Н-06 (ревью П-11.3б № 2).
        if (!violation && op === "POST /pao/v1/mandates/{id}/relinquish") return rejected(halt("BAD_PREP"));
        if (violation) {
          violated = true;
          this.#step("fault.sent", { test });
        }
        const req = track(violation, this.#pao.call(op, args));
        journal.push(req.then((): Outcome => ({ kind: "ok" }), paoEntry).then((o) => ({ ...o, violation })));
        return req;
      }) as Pao["call"];

    /** Запрос к витрине: подготовка или нарушение. */
    const shopAs =
      (violation: boolean) =>
      (method: "GET" | "POST", target: string, body?: unknown): Promise<ShopReply> => {
        const g = gate(violation);
        if (g) return rejected(g);
        const url = shopUrl(this.#d.urls.merchants, target);
        if (!url) return rejected(halt("BAD_TARGET"));
        if (violation && !plan.violations.some((v) => matchesOp(v, method, url.pathname))) return rejected(halt("BAD_VIOLATION"));
        if (violation) {
          violated = true;
          this.#step("fault.sent", { test });
        }
        const req = track(violation, this.#shop(method, url, body));
        journal.push(req.then(shopEntry, (): Outcome => ({ kind: "fail", code: "NO_RESPONSE" })).then((o) => ({ ...o, violation, op: { method, path: url.pathname } })));
        const out = req.then((r) => {
          if (r.status >= 200 && r.status < 300) return r;
          throw new ShopCallError(r.status, formCode((r.body as { code?: unknown } | null)?.code));
        });
        out.catch(() => undefined); // ветка может не дождаться — отказ не уходит необработанным
        return out;
      };
    const call = callAs(false);
    const shop = shopAs(false);

    const step = (s: BranchStep, p: ScenarioStep["params"] = {}): void => {
      if (signal.aborted) return; // после конца ветки, её остановки и закрытия шагов нет
      if (!(BRANCH_STEPS as readonly string[]).includes(s)) throw halt("BAD_STEP");
      this.#step(s, { test, ...safeParams(p) });
    };

    /** Ожидание действия клиента над мандатом: перечитывание `GET` мандата ключом агента (чтение — не нарушение и не
     *  подготовка в журнале; правила отправки — те же), не дольше clientWaitMs. Клиентское драйвер не делает (инвариант 3). */
    const waitClient = async (mandateId: string, want: "ACTIVE" | "REVOKED"): Promise<void> => {
      const end = Date.now() + this.#clientWaitMs;
      for (;;) {
        const g = gate(false);
        if (g) throw g;
        const m = await this.#pao.call("GET /pao/v1/mandates/{id}", { path: { id: mandateId } }).catch(() => undefined);
        const status = (m as { status?: unknown } | undefined)?.status;
        if (status === want) return;
        // Клиент отклонил (ждали подписи) или поручение кончилось иначе — ждать нечего.
        if (want === "ACTIVE" && (status === "REJECTED" || status === "REVOKED" || status === "EXPIRED")) throw halt("CLIENT_DECLINED");
        if (Date.now() >= end) throw halt(want === "ACTIVE" ? "CLIENT_SIGN_TIMEOUT" : "CLIENT_REVOKE_TIMEOUT");
        await new Promise<void>((ok) => {
          const t = setTimeout(ok, CLIENT_POLL_MS);
          signal.addEventListener("abort", () => (clearTimeout(t), ok()), { once: true });
        });
      }
    };

    const ctx: FaultContext = {
      call,
      shop,
      violate: { call: callAs(true), shop: shopAs(true) },
      urls: { pao: this.#d.urls.pao, merchants: this.#d.urls.merchants },
      step,
      signal,
      mark,
      waitClient,
      // Лента остановлена (агент остановлен) — не ошибка ветки: событие не придёт, итог ветки — по её журналу.
      // Как у шагов: после конца ветки, её остановки и закрытия драйвера — ничего (ревью П-11.3г № 7).
      wakeEvents: () => {
        if (!signal.aborted) void this.#d.agent.events.signal().catch(() => undefined);
      },
    };
    const standDemo = this.#d.stand.demo!;
    const logFrom = standDemo.log().length;
    let threw = false;
    try {
      // Сбой стенда этого теста (таблица: `arm`) — на витрину нарушителя, только на время ветки. Взведён до прогона
      // (человеком) — не трогаем: ни перезаписи его настроек, ни снятия. Стенд не взвёл — ветка не идёт.
      // Снятие — замыкание этого прогона: в поле экземпляра для abort() и close() лежит оно же, и обнуляется поле, только
      // если там именно оно (ревью П-11.3д-1 № 5: снятие старой ветки не снимет сбой новой). Взвод и снятие — на шину с
      // пометкой (ПР): сбой взвёл драйвер, а не человек (№ 2).
      // Взвод человека (П-11.2г, Р-1520): на витрину нарушителя (или на все) — ветка идёт по нему и держит его всё время ветки
      // (а), не снимая; не на витрину нарушителя или куда — не известно — ветка не идёт по чужому сбою: ARMED_ELSEWHERE (б).
      if (plan.arm && armedNow(standDemo.log(), test)) {
        const covers =
          humanArm !== undefined &&
          (humanArm.shop_id === undefined || humanArm.shop_id === VIOLATOR_SHOP.id) &&
          (humanArm.merchant_id === undefined || humanArm.merchant_id === VIOLATOR_SHOP.merchant_id);
        if (!covers) stop ??= "ARMED_ELSEWHERE";
        else {
          const release = (): void => {
            if (this.#releaseHold !== release) return;
            this.#releaseHold = null;
            this.#held = null;
          };
          this.#releaseHold = release;
          this.#held = test;
        }
      } else if (plan.arm) {
        let armed = false;
        try {
          standDemo.arm(test, { shop_id: VIOLATOR_SHOP.id });
          armed = true;
        } catch {
          stop ??= "ARM_REJECTED";
        }
        if (armed) {
          // Снятие — в поле сразу после взвода, до любого другого действия: что бы ни бросило дальше (и шаг на шину), finally
          // его снимет (повторное ревью П-11.3д-1 № 1 — иначе взвод без снятия «отравил» бы все следующие сюжеты).
          let done = false;
          const disarm = (): void => {
            if (done) return;
            done = true;
            if (this.#disarm === disarm) {
              this.#disarm = null;
              this.#held = null;
            }
            // `disarm` стенда бросает только при выключенных сбоях или чужом тесте — здесь недостижимо; если всё же бросил,
            // шага «снят» нет — несоответствие видно на шине (№ 6). Шаг на шину после снятия: его сбой снятие не отменяет.
            try {
              standDemo.disarm(test);
              this.#step("fault.note.disarmed", { test, shop_id: VIOLATOR_SHOP.id });
            } catch {
              // шаг «снят» не выпускается
            }
          };
          this.#disarm = disarm;
          this.#held = test;
          this.#step("fault.note.armed", { test, shop_id: VIOLATOR_SHOP.id });
        }
      }
      if (stop === undefined) await branch.run(ctx);
    } catch (e) {
      // Ветка сама остановилась с конкретной причиной (нет второго продавца) — эта причина; иначе что ветка бросила, итог не
      // решает — решает журнал; учитывается только «ветка сломалась».
      if (e instanceof BranchStop) stop ??= e.code;
      else threw = true;
    } finally {
      run.abort(); // ветка кончилась — новые запросы, пометки и шаги из неё не уходят
      this.#abortRun = null;
      this.#disarm?.(); // при любом исходе ветки (решение владельца по В1 П-11.3д)
      this.#releaseHold?.(); // удержание взвода человека — до конца ветки (П-11.2г (а))
    }
    // Итог — только когда пришли ответы на все ушедшие запросы (или не пришли — тогда сбой).
    const entries = await Promise.all(journal);
    if (this.#ac.signal.aborted) return;
    // Записи стенда за прогон (только `recordOnly`): обе — пометка этого теста и **после неё** нужная запись по витрине
    // нарушителя; и у ветки — успешный (2xx) свой запрос подготовки из таблицы (`via`) к витрине нарушителя: запись от
    // чужого чтения в окне прогона итог не делает (ревью П-11.3д-1 № 4, повторное № 2).
    const log = plan.recordOnly ? standDemo.log().slice(logFrom) : [];
    const markSeq = log.find((e) => e.test === test && e.what === "MARKED")?.seq;
    const recorded =
      plan.recordOnly !== undefined &&
      markSeq !== undefined &&
      log.some((e) => e.test === test && e.what === plan.recordOnly!.record && e.ids.shop_id === VIOLATOR_SHOP.id && e.seq > markSeq) &&
      entries.some((e) => !e.violation && e.kind === "ok" && e.op !== undefined && `${e.op.method} ${e.op.path}` === plan.recordOnly!.via.replace("{shop_id}", VIOLATOR_SHOP.id));
    this.#settle(test, plan, marked, stop, threw, entries, recorded);
  }

  /** Подписанный запрос к витрине ключом агента — как у ядра: x-agent-code, x-timestamp, x-nonce, подпись; без повторов
   *  и перенаправлений; срок и отмена — у обёртки fetch. Нет ответа — исключение. */
  async #shop(method: "GET" | "POST", url: URL, body: unknown): Promise<ShopReply> {
    const text = body === undefined ? undefined : JSON.stringify(body);
    const headers = {
      ...(text !== undefined && { "content-type": "application/json" }),
      "x-agent-code": this.#d.agentCode,
      "x-timestamp": new Date().toISOString().slice(0, 19) + "Z",
      "x-nonce": randomUUID(),
    };
    const signed = signRequest({ method, path: url.pathname, query: url.search.slice(1), headers, body: text ?? "" }, this.#signer);
    const res = await this.#fetch(url, {
      method,
      headers: signed.headers,
      redirect: "manual",
      ...(text !== undefined && { body: text }),
    });
    const raw = await res.text();
    let parsed: unknown;
    try {
      parsed = raw === "" ? undefined : (JSON.parse(raw) as unknown);
    } catch {
      parsed = undefined;
    }
    return { status: res.status, body: parsed };
  }

  /** Итог по журналу (решения владельца, чат 11.11). Нарушение за прогон — одно, подготовка — только до него
   *  (`gate`). По старшинству:
   *  1. ответ 2xx на нарушение — `fault.marked` «совершено и помечено»: прошедшее нарушение старше любого другого исхода —
   *     дефект защиты не прячется ни за остановкой ветки, ни за её ошибкой (ревью П-11.3а-3 № 1, № 2);
   *  2. ветку остановил драйвер (чужой шаг, адрес вне стенда, запрос без пометки, пометка отклонена) — эта причина;
   *  3. подготовка не удалась — `PREP_FAILED` и её настоящая причина через запятую (код, нет ответа, перенаправление…):
   *     у подготовки учитывается лишь сбой — ни её отказ (даже с объявленным кодом), ни её 2xx итогом не считаются;
   *     выше «защиты»: отказ нарушения мог прийти из-за несделанной подготовки (ревью П-11.3а-4 № 1);
   *  4. в ответе нарушения — объявленная пара «код + статус» — `fault.refused` «защита сработала»;
   *  5. сбой нарушения (нет ответа, 5xx, перенаправление, отказ клиента ПАО, тело не разобрать, код не по форме, без кода);
   *  6. отказ нарушения с необъявленной парой — `UNEXPECTED_<код>`;
   *  7. ветка сломалась сама — `BRANCH_ERROR`; нарушение не отправлено — `NOT_SENT`.
   *  Тест «только записи стенда» (`recordOnly`, Н-05 к MVP) после п. 3: `fault.recorded` «записи стенда сделаны» — при обеих
   *  записях стенда за прогон; иначе `missing` таблицы; это не «защита сработала» и не «совершено».
   *  Без пометки — `fault.failed` «не помечено» с настоящей причиной; с пометкой — `fault.unplayed` «помечено, но не
   *  разыграно» с причиной и идентификаторами. */
  #settle(test: FaultTest, plan: FaultPlanEntry, marked: DemoIds | undefined, stop: StopCode | undefined, threw: boolean, entries: readonly Entry[], recorded: boolean): void {
    const ids = marked ? pick(marked) : {};
    const unplayed = (code: string, status?: number) =>
      this.#step(marked ? "fault.unplayed" : "fault.failed", { test, code, ...(status !== undefined && { status }), ...ids });
    const v = entries.find((e) => e.violation);
    if (marked && v?.kind === "ok") return this.#step("fault.marked", { test, ...ids });
    if (stop) return unplayed(stop);
    if (!marked) return unplayed(threw ? "BRANCH_ERROR" : "NOT_MARKED");
    // Сбой подготовки — выше «защиты сработала»: отказ нарушения мог прийти из-за несделанной подготовки (ревью
    // П-11.3а-4 № 1; исключение из решения о последнем кирпиче каркаса — ложный зелёный, видимый до прогона).
    const prep = entries.find((e) => !e.violation && e.kind !== "ok");
    if (prep && prep.kind !== "ok") return unplayed(`PREP_FAILED,${prep.code}`, prep.status);
    // Только записи стенда (Р-1483): нарушающего запроса нет (таблица — без операций нарушения); итог — «записи стенда
    // сделаны» строго при обеих записях за прогон, иначе — «не разыграно» с причиной таблицы. Сломавшаяся ветка — не итог.
    if (plan.recordOnly) {
      if (threw) return unplayed("BRANCH_ERROR");
      return recorded ? this.#step("fault.recorded", { test, ...ids }) : unplayed(plan.recordOnly.missing);
    }
    if (v?.kind === "refused" && plan.expect.some((g) => g.code === v.code && g.status === v.status)) return this.#step("fault.refused", { test, code: v.code, status: v.status, ...ids });
    if (v?.kind === "fail") return unplayed(v.code, v.status);
    if (v?.kind === "refused") return unplayed(`UNEXPECTED_${v.code}`, v.status);
    return unplayed(threw ? "BRANCH_ERROR" : "NOT_SENT");
  }

  #step(step: string, params: ScenarioStep["params"] = {}): void {
    this.#emit({ step, params });
  }
}

/** Запись журнала по отказу клиента ПАО: отказ клиента до сети, нет ответа, 5xx — сбой; 4xx — отказ с кодом по форме. */
function paoEntry(e: unknown): Outcome {
  // Ответ пришёл, но тело не разобрать (клиент ПАО бросает SyntaxError из JSON.parse) — не «нет ответа»: нарушение могло
  // состояться (ревью П-11.3а-3, мелочь № 9; решение владельца, чат 11.11).
  if (e instanceof SyntaxError) return { kind: "fail", code: "MALFORMED_BODY" };
  if (!(e instanceof PaoCallError)) return { kind: "fail", code: "NO_RESPONSE" };
  if (e.clientCode !== undefined) return { kind: "fail", code: e.clientCode };
  if (e.status === 0) return { kind: "fail", code: "NO_RESPONSE" };
  const code = formCode(e.code);
  if (e.status >= 500) return { kind: "fail", code: code ?? "SERVER_ERROR", status: e.status };
  if (code === undefined) return { kind: "fail", code: e.code === undefined ? "NO_CODE" : "MALFORMED_CODE", status: e.status };
  return { kind: "refused", code, status: e.status };
}

/** Запись журнала по ответу витрины: 2xx — ответ; 3xx — перенаправление (сбой, как у клиента ПАО); 5xx — сбой; 4xx — отказ
 *  с кодом по форме (без кода или не по форме — сбой). */
function shopEntry(r: ShopReply): Outcome {
  if (r.status >= 200 && r.status < 300) return { kind: "ok" };
  if (r.status >= 300 && r.status < 400) return { kind: "fail", code: "REDIRECT", status: r.status };
  const raw = (r.body as { code?: unknown } | null)?.code;
  const code = formCode(raw);
  if (r.status >= 500) return { kind: "fail", code: code ?? "SERVER_ERROR", status: r.status };
  if (code === undefined) return { kind: "fail", code: raw === undefined ? "NO_CODE" : "MALFORMED_CODE", status: r.status };
  return { kind: "refused", code, status: r.status };
}

/** Адрес запроса к витрине — только на витрины стенда (П7 п. 5): путь начинается с одного `/`, без `#`, `\`, `@` и
 *  управляющих знаков, и после разбора источник тот же, что у витрин стенда. Иначе — нет адреса. */
function shopUrl(base: string, target: string): URL | undefined {
  const control = [...target].some((ch) => ch.charCodeAt(0) < 0x20 || ch.charCodeAt(0) === 0x7f);
  // Только протокол витрин `/v1/…` — после разбора адреса и без переходов вверх (`..`, `%2e`): ни шлюза банка с подписью и
  // подтверждением клиента (инвариант 3), ни прочих путей (ревью П-11.3б № 3).
  if (!target.startsWith("/v1/") || /[#\\@\s]/.test(target) || /(^|\/)\.\.?(\/|$)|%2e/i.test(target.split("?")[0]!) || control) return undefined;
  let url: URL;
  try {
    url = new URL(target, base);
  } catch {
    return undefined;
  }
  if (!url.pathname.startsWith("/v1/")) return undefined;
  return url.origin === new URL(base).origin && url.hash === "" && url.username === "" && url.password === "" ? url : undefined;
}

/** Взведён ли сбой стенда сейчас — по журналу стенда: последняя запись ARMED / DISARMED этого теста (у `StandDemo` нет
 *  чтения взвода; Н-05 сам себя не снимает — снимает только `disarm`). */
function armedNow(log: readonly { readonly test?: string; readonly what: string }[], test: FaultTest): boolean {
  for (let i = log.length - 1; i >= 0; i--) {
    const e = log[i]!;
    if (e.test === test && (e.what === "ARMED" || e.what === "DISARMED")) return e.what === "ARMED";
  }
  return false;
}

/** Параметры шага ветки: только код, статус и идентификаторы стенда — и только по форме (инвариант 1). */
function safeParams(p: ScenarioStep["params"]): ScenarioStep["params"] {
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(p)) {
    if (k === "code" && typeof v === "string" && CODE_FORM.test(v)) out.code = v;
    else if (k === "status" && typeof v === "number" && Number.isInteger(v) && v >= 100 && v <= 599) out.status = v;
    else if ((ID_FIELDS as readonly string[]).includes(k) && typeof v === "string" && ID_FORM.test(v)) out[k] = v;
  }
  return out;
}

/** Идентификаторы пометки — в шаг шины (все поля стенда), по форме. */
function pick(ids: DemoIds): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of ID_FIELDS) {
    const v = ids[k];
    if (typeof v === "string" && ID_FORM.test(v)) out[k] = v;
  }
  return out;
}
