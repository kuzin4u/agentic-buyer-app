// Общее для тестов К1.4а (З2, Р-1361): в тексте для человека нет латинских имён полей, сырых значений и машинных кодов.
// Идентификаторы (MER-5501, SHOP-4401, ORD-…, mnd_…, BRD-3301-01) — не коды: после них дефис, цифры или «_».

/** Машинный код: `A5_PRICE_MISMATCH`, `REQUIRED`, `PAID` (не идентификатор с дефисом или цифрами). */
const CODE = /\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b|\b[A-Z]{4,}\b(?![-\d_])/;
/** Сырые значения — на любом языке. */
const RAW = /\b(null|undefined|NaN|true|false)\b/;
/** В русском тексте латинских слов нет вовсе: `price`, `found` … — имена полей (идентификаторы — со «_» или цифрами). */
const LATIN_WORD = /(?<![\w-])[a-z]{3,}(?![\w-])/;

/** Что в тексте человека выдаёт сырое: код, сырое значение, в русском — латинское имя поля. Нет — undefined. */
export function rawInHumanText(text: string, lang: "ru" | "en"): string | undefined {
  for (const re of lang === "ru" ? [CODE, RAW, LATIN_WORD] : [CODE, RAW]) {
    const m = re.exec(text);
    if (m) return m[0];
  }
  return undefined;
}
