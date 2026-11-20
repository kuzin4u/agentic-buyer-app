// Инвариант 1 приложения: реквизиты недоступны. Перечень запрещённых имён полей — **в одном месте** на все тесты
// (ревью К2 Б1: до этого он лежал тремя копиями — `tests/contract/ui-v1.test.ts`, `tests/intent/model.test.ts`,
// `tests/intent/draft.test.ts`, и копия К2 была уже сужена: `expiry`, `kid`, `track2`, `credentials` в ней пропали).
//
// Запрещено: реквизит, номер карты и его части, срок действия, криптограмма, второй фактор, ключ подписи агента.
// Разрешены идентификаторы — `order_id`, `mandate_id`, `instrument_token`, `purchase_id` (CLAUDE.md, инвариант 1),
// поэтому слова `token` в перечне нет.
export const FORBIDDEN_FIELD_NAMES: readonly RegExp[] = [
  /\bpan\b/i,
  /card_?number/i,
  /\bcvv\b/i,
  /\bcvc\b/i,
  /cryptogram|криптограмм/i,
  /\bkid\b/i,
  /expiry|exp_?month|exp_?year/i,
  /\btrack2?\b/i,
  /\bcredential(s)?\b/i,
];

/** Имена, которые перечень обязан поймать: самопроверка, без неё пустой или испорченный перечень остаётся зелёным. */
export const FORBIDDEN_EXAMPLES: readonly string[] = [
  "pan",
  "card_number",
  "cardNumber",
  "cvv",
  "cvc",
  "cryptogram",
  "kid",
  "expiry_month",
  "exp_year",
  "track2",
  "credentials",
];

/** Имена, которые перечень трогать не должен: идентификаторы инварианта 1 и соседние безобидные поля. */
export const ALLOWED_EXAMPLES: readonly string[] = [
  "order_id",
  "mandate_id",
  "instrument_token",
  "purchase_id",
  "merchant_id",
  "view_id",
  "draft_id",
  "confirmation_mode",
];

export const hitsForbidden = (name: string): boolean => FORBIDDEN_FIELD_NAMES.some((re) => re.test(name));
