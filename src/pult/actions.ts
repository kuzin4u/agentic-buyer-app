// Кнопки реакции пульта DEMO-2 (П-8.1; модель «Кнопки реакции» v1.0, Р-1526, Р-1527). Порт `PultActions`: пульт
// вызывает действия через него и стенд не импортирует (правило совместимости 1); реализация — сборка демо-стенда
// (`src/demo/pult-actions.ts`), вызывает `stand.demo.*`. Решение принимает стенд: ответ показывается как есть, отказ стенда —
// «отказано», а не «сделано» (инвариант 2; условие 1 Р-1527).
// В1 (а): «Напомнить клиенту» у У-01 (R08) и У-02 (R18) — только запись «напомнено» в журнале пульта, стенд не вызывается
// (у стенда такого действия нет); у У-03 (R21) — `remindClient`, продление срока стендом.

/** Действие кнопки: остановить покупку, напомнить (У-03 — стендом), напомнить без стенда (У-01, У-02), отозвать, на разбор. */
export const PULT_ACTIONS = ["stop", "remind", "remind_note", "revoke", "review"] as const;
export type PultActionKind = (typeof PULT_ACTIONS)[number];

/** Нарушитель для «Передать на разбор» — перечень стенда (`DEMO_VIOLATORS`). */
export const REVIEW_VIOLATORS = ["AGENT", "MERCHANT", "BANK", "PLATFORM", "OPERATOR"] as const;
export type ReviewViolator = (typeof REVIEW_VIOLATORS)[number];
/** Идентификаторы операции для разбора — перечень стенда (`DEMO_ID_FIELDS`). */
export const REVIEW_ID_FIELDS = ["mandate_id", "confirmation_id", "op_ref", "merchant_id", "shop_id", "order_id", "order_ref"] as const;
export type ReviewIds = Partial<Record<(typeof REVIEW_ID_FIELDS)[number], string>>;

/** Ответ стенда как есть: код ответа шлюза, итоговые поля; `ok` — только по ответу стенда. */
export interface ActionResult {
  readonly ok: boolean;
  /** Код ответа шлюза участников (`statusCode`), если он был. */
  readonly status?: number;
  /** Код или причина отказа — из ответа стенда (или текст исключения стенда). */
  readonly code?: string;
  /** Поля ответа стенда, которые показываются человеку: закрытые запросы, новый срок, продлено ли. */
  readonly rejected?: readonly string[];
  readonly expiresAt?: string;
  readonly extended?: boolean;
}

export interface PultActions {
  stopPurchase(cartMandateId: string): Promise<ActionResult>;
  remindClient(confirmationId: string): Promise<ActionResult>;
  revokeMandate(mandateId: string): Promise<ActionResult>;
  sendToReview(r: { readonly tx: ReviewIds; readonly condition: string; readonly violator: ReviewViolator }): Promise<ActionResult>;
}

/** Запись журнала реакций (П-8.1; связь с протоколом и «упреждено реакцией» — П-8.2). */
export interface Reaction {
  readonly at: string;
  readonly action: PultActionKind;
  /** Объект: поручение, запрос подтверждения или транзакция. */
  readonly obj: string;
  /** Условие, по которому нажата кнопка (R08, R18, R21, условие вердикта). */
  readonly cond?: string;
  /** «напомнено» без стенда (В1 (а)) — `noted`; ответ стенда — `done` или `refused`. */
  readonly outcome: "done" | "refused" | "noted";
  readonly result?: ActionResult;
}
