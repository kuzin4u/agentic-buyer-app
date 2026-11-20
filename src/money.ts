// Показ суммы человеку — **нейтральный** модуль приложения (кирпич К4а ИН-0, решение владельца **Р-1667**).
//
// Лежит рядом с `src/iso4217.ts`, а не в `src/ui-server/`, потому что показывать сумму нужно обеим ветвям работы:
// окно А (П-К4) показывает её через порт `MoneyText` и импортировать из `src/ui-server/` не может — граница. Пока
// функция жила в сервере, у приложения появилась бы **вторая** функция показа суммы, и одна и та же величина
// печаталась бы в двух местах по-разному (та же беда, от которой защищает одна таблица ISO 4217).
//
// Правило планов № 2: сумма это число в минимальных единицах плюс валюта (ISO 4217), а знак валюты и разделители
// берутся у локали — литерала «₽» здесь нет и быть не может. Число знаков после запятой — по ISO 4217
// (`src/iso4217.ts`), а не по CLDR: у йены знаков нет, у динара их три, и «обычно два» ломает масштаб.
//
// Ничего, кроме показа, здесь не делается: ни сложения, ни пересчёта курсов, ни остатка (инвариант 2 — величины
// приходят от ядра как есть).
import type { CurrencyCode, Money } from "agentic-buyer-ref/src/shared/domain.js";
import { ISO4217_MINOR_UNITS } from "./iso4217.js";

/** Язык показа. Перечень языков интерфейса живёт у контракта (`UiLang`), здесь — только то, что нужно формату. */
export type MoneyLang = "ru" | "en";

const LOCALE: Readonly<Record<MoneyLang, string>> = { ru: "ru-RU", en: "en-GB" };

/**
 * Сумма человеку.
 *
 * Валюта вне таблицы ISO 4217 или нецелое число минимальных единиц — **дефект сборки ответа**, а не случай для
 * ошибки контракта: исключение наружу не гасится, иначе сумма ушла бы на экран с неверным масштабом. Оба случая
 * закрыты тестом (`tests/ui-server/money.test.ts`).
 */
export function formatMoneyText(m: Readonly<Money>, lang: MoneyLang): string {
  if (!Number.isSafeInteger(m.amount)) throw new TypeError("сумма: ожидается целое число минимальных единиц");
  const digits = ISO4217_MINOR_UNITS[m.currency as CurrencyCode];
  if (digits === undefined) throw new RangeError(`сумма: валюты ${m.currency} нет в таблице ISO 4217`);
  return new Intl.NumberFormat(LOCALE[lang], {
    style: "currency",
    currency: m.currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(m.amount / 10 ** digits);
}
