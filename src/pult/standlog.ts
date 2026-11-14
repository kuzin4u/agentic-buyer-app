// Журнал сбоев и действий демо-стенда для движка условий пульта (П-3.2в, В9): контракт записи `stand.demo.log()` Платформы
// v0.48.0 (`agentic-ps-platform/dist/stand/demo.d.ts`: DEMO_TESTS, DEMO_ID_FIELDS, DEMO_LOG_WHAT, DemoLogEntry, РП75 п. 3–6)
// своим типом — пакет Платформы в `src/pult` не импортируется (граница, П-1). Журнал на шине — П-11.2а (только в режиме
// сбоев, Р-1514); в ленту и движок пульта — П-8.2 (Р-1531).
// Перечни закрытые, как у стенда: новый код стенда — правка этого файла и теста (смена версии стенда — П2 доп. 4 и 6).

/** Тесты пульта со сбоями стенда и пометками приложения (РП75 п. 3). */
export const STAND_TESTS = ["Н-01", "Н-02", "Н-03", "Н-04", "Н-05", "Н-06", "Н-07", "Н-08", "Н-09", "Н-10", "Н-11", "Н-12"] as const;
export type StandTest = (typeof STAND_TESTS)[number];

/** Идентификаторы записи журнала (РП75 п. 4). */
export const STAND_ID_FIELDS = ["mandate_id", "confirmation_id", "op_ref", "merchant_id", "shop_id", "order_id", "order_ref"] as const;
export type StandIds = Partial<Record<(typeof STAND_ID_FIELDS)[number], string>>;

/** Что записано (РП75 п. 4): сбои «П» стенда, пометки `MARKED` нарушений «ПР», разыгранных приложением, действия кнопок. */
export const STAND_LOG_WHAT = [
  "ARMED", "DISARMED", "MARKED", "PAID_BEFORE_OUTCOME", "FULFILLED_BEFORE_OUTCOME", "INSTRUCTION_SERVED", "UPK_CODE_LEAKED",
  "OUTCOME_EVENT_DELAYED", "OUTCOME_EVENTS_REORDERED", "SECOND_CREDENTIAL_ISSUED", "PURCHASE_STOPPED", "CONFIRMATION_REJECTED",
  "CLIENT_REMINDED", "REMIND_REPEATED", "MANDATE_REVOKED", "ACTION_REFUSED", "SENT_TO_REVIEW",
] as const;
export type StandLogWhat = (typeof STAND_LOG_WHAT)[number];

/** Запись журнала стенда. `seq` — номер журнала стенда (не шины); `at` — часы стенда, ISO 8601. */
export interface StandLogEntry {
  readonly seq: number;
  readonly at: string;
  readonly kind: "fault" | "action";
  readonly test?: StandTest;
  readonly what: StandLogWhat;
  readonly ids: StandIds;
}

/** Форма записи сбоя «П» у стенда v0.48.0 — какие идентификаторы пишет каждый код (`faults.fired`): Н-11 —
 *  `stand/index.js`, Н-02 — `stand/demo-credentials.js` (`order_ref` — номер заказа в запросе реквизита), Н-03, Н-04,
 *  Н-05 — `env/merchants/server.js`, Н-12 — `stand/demo.js` (`opRefOf`: без `op_ref` в событии — `ids` пустые). */
export interface StandFaultForm {
  readonly UPK_CODE_LEAKED: "confirmation_id";
  readonly SECOND_CREDENTIAL_ISSUED: "mandate_id" | "merchant_id" | "order_ref";
  readonly PAID_BEFORE_OUTCOME: "shop_id" | "merchant_id" | "order_id";
  readonly FULFILLED_BEFORE_OUTCOME: "shop_id" | "merchant_id" | "order_id";
  readonly INSTRUCTION_SERVED: "shop_id" | "merchant_id";
  readonly OUTCOME_EVENT_DELAYED: "op_ref";
  readonly OUTCOME_EVENTS_REORDERED: "op_ref";
}
/** Запись сбоя в точной форме стенда: лишний или недостающий идентификатор — ошибка компилятора. */
export type StandFaultIds<W extends keyof StandFaultForm> = { readonly [K in StandFaultForm[W]]: string };

/** Наибольшая задержка итога сбоем Н-12 у стенда v0.48.0 (`DELAY_MAX_MS`, `stand/demo.js`), мс. */
export const STAND_DELAY_MAX_MS = 60_000;
