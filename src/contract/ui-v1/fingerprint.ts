// Контракт К-Б `/ui/v1`, правило 2 — **отпечаток тела** для идемпотентности: «тот же ключ, то же тело».
//
// Отпечаток один на все `POST` методы: его считают подпись принципов (§ 5.14, К1.3 П-К1) и отправка поручения на
// подпись (§ 5.2, К5 П-К4). Вторая копия расходилась бы молча — у одного метода повтор с другим порядком ключей
// считался бы «другим телом» и получал `IDEMPOTENCY_CONFLICT`, у другого нет (находка ревью К5 В1). Тот же довод, что
// у общей проверки провенанса (`press.ts`) и общих примитивов разбора `config/`.
import { showingHash } from "./shown-hash.js";

/** Версия формы отпечатка: входит в отпечаток, чтобы смена формы не выдала чужой повтор за свой. */
const FINGERPRINT_VERSION = "ui.body@1.0";

/** Снимок тела как оно пришло — «сырые байты» этого слоя: ключи объектов по алфавиту (чтобы порядок ключей в JSON на
 *  «то же тело» не влиял), значения вне JSON — явными пометками, а не исключением.
 *  Нужен потому, что отпечаток считается **до** проверки формы: негодное тело тоже занимает ключ (решение владельца
 *  19.11, 18:20), а канонизация ядра на `undefined` в массиве, `NaN` или `Date` бросает `TypeError` — и маршрут отдал
 *  бы 500 вместо 400. `undefined` у поля и отсутствие поля различимы (`u` против отсутствия ключа): иначе негодное
 *  тело и годное стали бы «одним телом». */
export function rawDump(value: unknown): string {
  if (value === undefined) return "u";
  if (value === null) return "n";
  if (typeof value === "number") return Number.isFinite(value) ? `d${value}` : `d!${String(value)}`;
  if (typeof value === "boolean" || typeof value === "bigint") return `b${String(value)}`;
  if (typeof value === "string") return `s${JSON.stringify(value)}`;
  if (typeof value === "function" || typeof value === "symbol") return `x${typeof value}`;
  if (Array.isArray(value)) return `[${value.map(rawDump).join(",")}]`;
  const o = value as Record<string, unknown>;
  // Ключи с `undefined` в снимок **входят**: `{a: undefined}` и `{}` — разные тела.
  const keys = Object.keys(o).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${rawDump(o[k])}`).join(",")}}`;
}

/** Отпечаток тела для правила 2. Хэш считает канонизация ядра (`showingHash`), та же, что считает хэш показанного —
 *  своей копии правила хэширования здесь нет (П30 доп. 1, П7 доп. 3); канонизируется **строка снимка**, поэтому
 *  негодное тело отпечаток получает так же, как годное.
 *  `scope` — имя метода: один и тот же ключ, пришедший в два разных метода, не считается повтором. */
export function bodyFingerprint(scope: string, body: unknown): string {
  return showingHash({ text_version: `${FINGERPRINT_VERSION}/${scope}`, card: rawDump(body) });
}
