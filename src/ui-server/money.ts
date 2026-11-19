// Формат суммы в текстах сервера `/ui/v1` (ИН-0, К2; контракт К-Б § 3 «Деньги», правило планов № 2).
//
// В ответах экрану сумма идёт **парой** `{ amount, currency }` как есть из ядра — пару экран получает всегда. Текст
// человеку («Не списано: 1 000 ₽») собирает сервер: формат зависит от валюты и языка (Intl), знак валюты литералом не
// пишется. Число знаков после запятой — по ISO 4217 (`src/iso4217.ts`), не по CLDR.
// Экран сумм не складывает и не пересчитывает (правило 3): арифметики над деньгами здесь нет — только показ одной пары.
import type { UiLang, UiMoney } from "../contract/ui-v1/index.js";
import { ISO4217_MINOR_UNITS } from "../iso4217.js";

const LOCALE: Readonly<Record<UiLang, string>> = { ru: "ru-RU", en: "en-GB" };

/** Сумма человеку. Валюта вне таблицы ISO 4217 или нецелое число минимальных единиц — **дефект сборки ответа**, а не
 *  случай для ошибки контракта: исключение наружу не гасим, иначе сумма ушла бы на экран с неверным масштабом. */
export function formatUiMoney(m: UiMoney, lang: UiLang): string {
  if (!Number.isSafeInteger(m.amount)) throw new TypeError("сумма /ui/v1: ожидается целое число минимальных единиц");
  const digits = ISO4217_MINOR_UNITS[m.currency];
  if (digits === undefined) throw new RangeError(`сумма /ui/v1: валюты ${m.currency} нет в таблице ISO 4217`);
  return new Intl.NumberFormat(LOCALE[lang], {
    style: "currency",
    currency: m.currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(m.amount / 10 ** digits);
}
