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
  // Добавлено кирпичом **К6 ИН-П2** (находка ревью К6 № 4): пасскей принёс в приложение ещё два вида того, чего у
  // сервера быть не должно, — **закрытый ключ** и **биометрия**. Прежде эти слова искал свой, локальный список внутри
  // одного теста, да ещё подстрокой по всему JSON (случайно краснел на base64 открытого ключа). Место им здесь: это
  // та же норма инварианта 1 «у сервера только опознаватели», и перечень у неё один.
  /private_?key|privatekey|закрытый_?ключ/i,
  /\bbiometr\w*|биометр\w*/i,
  /\bsecret\b|секрет/i,
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
  "private_key",
  "privateKey",
  "biometrics",
  "биометрия",
  "secret",
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
  // Пасскей: **открытый** ключ и его опознаватель разрешены — ими и доказывается подпись (П37 п. 2). Запрет на
  // `private_key` рядом не должен задевать их, иначе он запрещал бы то, на чём держится ПЭП.
  "public_key",
  "passkey_id",
];

export const hitsForbidden = (name: string): boolean => FORBIDDEN_FIELD_NAMES.some((re) => re.test(name));
