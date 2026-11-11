// Сумма — целое число в минимальных единицах плюс валюта ISO 4217 (правило совместимости 2). Формат на экране зависит
// от валюты и языка (Intl), знак валюты литералом не пишется.
//
// Число знаков после запятой — по ISO 4217, а не по Intl: Intl берёт его из CLDR, а у части валют они расходятся
// (IQD: ISO 3, CLDR 0; LAK, IRR: ISO 2, CLDR 0), и сумма вышла бы в 100–1000 раз больше (ревью К1.3 № 6). Валюта вне
// таблицы — ошибка: монитор показывает событие без суммы, а не сумму с неверным масштабом.
import { LANGS, type Lang } from "./i18n.js";

export interface Money {
  readonly minor: number;
  readonly currency: string;
}

/** Знаки минимальной единицы по ISO 4217 (таблица A.1) для валют, которые встречаются на стенде и в планах рынков. */
export const ISO4217_MINOR_UNITS: Readonly<Record<string, number>> = {
  RUB: 2,
  BYN: 2,
  KZT: 2,
  AMD: 2,
  KGS: 2,
  UZS: 2,
  CNY: 2,
  USD: 2,
  EUR: 2,
  GBP: 2,
  CHF: 2,
  SEK: 2,
  NOK: 2,
  DKK: 2,
  PLN: 2,
  CZK: 2,
  HUF: 2,
  TRY: 2,
  AED: 2,
  INR: 2,
  LAK: 2,
  IRR: 2,
  JPY: 0,
  KRW: 0,
  ISK: 0,
  IQD: 3,
  KWD: 3,
  BHD: 3,
  OMR: 3,
  JOD: 3,
  TND: 3,
};

const LOCALE: Record<Lang, string> = { ru: "ru-RU", en: "en-GB" };

export function formatMoney(m: Money, lang: Lang): string {
  if (!Number.isSafeInteger(m.minor)) throw new Error("сумма: ожидается целое число минимальных единиц");
  const digits = ISO4217_MINOR_UNITS[m.currency];
  if (digits === undefined) throw new Error(`сумма: валюты ${m.currency} нет в таблице ISO 4217 монитора`);
  const nf = new Intl.NumberFormat(LOCALE[lang], {
    style: "currency",
    currency: m.currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  return nf.format(m.minor / 10 ** digits);
}

/** Сумма для ленты: число, валюта и готовый текст на каждом языке — клиент выбирает текст, формат не повторяет. */
export interface MoneyView extends Money {
  readonly text: Readonly<Record<Lang, string>>;
}

export function moneyView(m: Money): MoneyView {
  const text = Object.fromEntries(LANGS.map((l) => [l, formatMoney(m, l)])) as Record<Lang, string>;
  return { minor: m.minor, currency: m.currency, text };
}

/** Момент для ленты (П-11.1д-а, ревью П-11.1д № 3): машинное значение ISO 8601 и текст на каждом языке — дата и время до
 *  минут в поясе процесса стенда, как время на экране мандатов банка (З9): ru «11.11.2026, 10:23», en «11/11/2026, 10:23». */
export interface TimeView {
  readonly iso: string;
  readonly text: Readonly<Record<Lang, string>>;
}

const TIME_LOCALE: Readonly<Record<Lang, string>> = { ru: "ru-RU", en: "en-GB" };

/** Момент не по форме — исключение: шина выводит шаг без него, как сумму не по форме. */
export function timeView(iso: string): TimeView {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) throw new RangeError(`время не по форме: ${iso}`);
  const text = Object.fromEntries(
    LANGS.map((l) => [l, d.toLocaleString(TIME_LOCALE[l], { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })]),
  ) as Record<Lang, string>;
  return { iso: d.toISOString(), text };
}
