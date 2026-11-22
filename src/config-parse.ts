// Разбор файлов `config/` — общие примитивы (К3 П-К4, находка ревью К3 З6).
//
// Тексты и перечни приложения живут данными в `config/` (инвариант 7 и правило планов № 3), и разбирают их уже трое:
// профиль принципов (`src/principles/model.ts`, К1.2 П-К1), тексты карточки поручения (`src/intent/texts.ts`, К3) и
// тексты итога (`src/order/texts.ts`, К1 Н-3).
// Два разбора со своими сообщениями расходятся по строгости молча: один отвергает пустую строку, другой пропускает.
// Поэтому «что такое объект» и «что такое непустая строка» сказано здесь один раз; сообщения — те же, что были у
// разбора принципов, чтобы его тесты проверяли то же, что и раньше.
//
// Пара строк ru/en с проверкой подстановок переехала сюда из `src/intent/texts.ts` кирпичом **К1 Н-3**: третьему
// разбору она нужна так же, и вторая копия разошлась бы по строгости — в точности то, против чего завёлся этот
// модуль. Поведение и **сообщения не менялись**: тесты К3 П-К4 проверяют те же строки.
import type { UiLang } from "./contract/ui-v1/common.js";

export function obj(raw: unknown, where: string): Record<string, unknown> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new Error(`${where}: ожидается объект`);
  return raw as Record<string, unknown>;
}

export function str(raw: Record<string, unknown>, key: string, where: string): string {
  const v = raw[key];
  if (typeof v !== "string" || v.trim() === "") throw new Error(`${where}.${key}: пустая строка`);
  return v;
}

/** Текст человеку — **парой ru/en** (правило планов № 3, инвариант 7): одноязычной строки в `config/` не бывает. */
export type Bilingual = Readonly<Record<UiLang, string>>;

const LANGS: readonly UiLang[] = ["ru", "en"];

/**
 * Подстановка в строке `config/`: `{money}`, `{limit}`. Одна форма на приложение — заполняют её разные модули, но
 * распознают одинаково.
 *
 * **Фабрика, а не общая константа** (находка ревью К1 № 8): выражение с флагом `g` несёт состояние (`lastIndex`), и
 * общий объект на три модуля — отложенная поломка. Сегодня `matchAll` и `replace` его обнуляют, но первый же
 * `SLOT_RE.test(s)` оставил бы `lastIndex` ненулевым, и ближайший разбор начал бы поиск с середины строки: подстановка
 * в начале перестала бы находиться, а проверка — молча ослабла. Каждый вызов получает своё выражение.
 */
export const slotRe = (): RegExp => /\{([a-z_]+)\}/g;

/**
 * Пара ru/en с проверкой подстановок: у строк **обоих** языков перечень подстановок — ровно `slots`.
 *
 * Зачем проверка: `{limit}`, забытый в английской строке, доехал бы до экрана пустым местом вместо суммы, а лишний
 * `{total}` — незаполненной фигурной скобкой. Пустой `slots` означает «строка без подстановок».
 */
export function bilingual(raw: unknown, where: string, slots: readonly string[]): Bilingual {
  const r = obj(raw, where);
  for (const key of Object.keys(r)) if (!LANGS.includes(key as UiLang)) throw new Error(`${where}.${key}: лишний язык`);
  const out = {} as Record<UiLang, string>;
  for (const lang of LANGS) {
    const s = str(r, lang, where);
    const used = [...s.matchAll(slotRe())].map((m) => m[1] as string);
    for (const u of used) if (!slots.includes(u)) throw new Error(`${where}.${lang}: подстановка {${u}} здесь не бывает`);
    for (const need of slots) if (!used.includes(need)) throw new Error(`${where}.${lang}: нет подстановки {${need}}`);
    out[lang] = s;
  }
  return out;
}
