// ВР-1, К3 — тексты по кодам каталога: ru у ядра, en данными в `config/` (П38 п. 5, Р-1719, Р-1696).
//
// Источник перечня — **реестр ядра** `CATALOG_DIAG`, литералов кодов в тесте нет (Р-1511). Файл берётся тот же,
// что в работе: `config/catalog.default.json`.
//
// Каждая отказная ветка разбора показана **красной фикстурой** (Р-1698): фикстура — испорченная копия настоящего
// файла, и она остаётся в тестах. Проверяются ключи **файла**, а не вывод разбора: разбор строит ключи из перечня
// реестра, поэтому проверка его результата была бы верна при любом содержимом файла (урок находки К1 № 6 Н-3).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CATALOG_DIAG } from "../../src/catalog/port.js";
import {
  CATALOG_DIAG_CODES,
  catalogTextOf,
  parseCatalogTexts,
  type CatalogDiagCode,
  type CatalogTexts,
} from "../../src/catalog/texts.js";
import { hasCardNumber } from "../../src/card-guard.js";
import CATALOG_FILE from "../../config/catalog.default.json" with { type: "json" };
import type { UiLang } from "../../src/contract/ui-v1/common.js";

const CONFIG = new URL("../../config/catalog.default.json", import.meta.url);
const raw: unknown = JSON.parse(readFileSync(CONFIG, "utf8"));
const texts: CatalogTexts = parseCatalogTexts(raw);

/**
 * **Закрытие на компиляции** (находка ревью К3 № 1). Файл ввезён модулем **здесь, а не в `src/`**: набор текстов —
 * настройка (инвариант 7), и ввоз в работающий код вшил бы в сборку именно `catalog.default.json`. А `tsc --noEmit`
 * идёт и по `tests` (`include` в `tsconfig.json`), поэтому проверка настоящая.
 *
 * Что ловит: **новый код у ядра без перевода** — `Record<CatalogDiagCode, …>` требует все ключи, и появление
 * тридцать третьего кода в реестре роняет `npm run check`. Чего **не** ловит: лишний ключ в файле — проверка
 * лишних свойств работает только на свежем литерале, а ввезённый JSON таким не считается; это ловят разбор и
 * проверка ключей файла ниже.
 */
const _closedAtCompileTime = CATALOG_FILE.codes_en satisfies Record<CatalogDiagCode, { readonly en: string }>;
void _closedAtCompileTime;

type FileShape = { codes_en: Record<string, { en?: string; ru?: string }> };
const file = raw as FileShape;

/** Испорченная копия настоящего файла — для красных фикстур. */
const broken = (spoil: (f: FileShape) => void): unknown => {
  const copy = structuredClone(raw) as FileShape;
  spoil(copy);
  return copy;
};

/** Какой-нибудь код из реестра — первый; литералом не пишется. */
const SOME = CATALOG_DIAG_CODES[0]!;

/**
 * Код **со своим** текстом — выбран по свойству реестра, а не назван литералом (находка ревью К3 № 6): первый, чей
 * русский текст отличается от текста `SOME`. У 22 кодов модели и разбора в реестре одна общая строка, поэтому такой
 * выбор заодно выражает смысл проверок ниже — «у этого кода текст свой».
 */
const OWN = CATALOG_DIAG_CODES.find((c) => CATALOG_DIAG[c].human.ru !== CATALOG_DIAG[SOME].human.ru);
if (OWN === undefined) throw new Error("в реестре все тексты одинаковы — проверки ниже ничего не значат");

describe("К3: перечень кодов — из реестра ядра, в обе стороны", () => {
  it("ключи файла — ровно коды реестра: ни пропуска, ни лишнего", () => {
    expect(Object.keys(file.codes_en).slice().sort()).toEqual([...CATALOG_DIAG_CODES].slice().sort());
  });

  // Реестр К17 каталога — 32 записи: 22 кода модели и разбора, два сигнала A5, восемь кодов живой проверки.
  // Прежняя проверка «перечень совпадает с ключами реестра» снята как тавтология (находка ревью К3 № 5):
  // `CATALOG_DIAG_CODES` и **есть** `Object.keys(CATALOG_DIAG)`, покраснеть она не могла. Доказательство вывода —
  // проверка ключей файла выше; числом краснеет изменение самого реестра.
  it("в реестре 32 кода — изменился реестр, значит изменился и перевод", () => {
    expect(CATALOG_DIAG_CODES).toHaveLength(32);
  });

  // Находка ревью К3 № 3: у 22 кодов в реестре **одна** русская строка, и в файле у них 22 независимые копии
  // одного перевода. Правка одной из них ничем бы не покраснела — тот самый класс «копия совместима, разойдётся
  // молча» (П38 дополнение 1). Привязка к источнику: группировка переводов обязана повторять группировку реестра.
  it("одинаковый ru у двух кодов ⟺ одинаковый en: группировка перевода повторяет группировку реестра", () => {
    const pairs: string[] = [];
    for (let i = 0; i < CATALOG_DIAG_CODES.length; i++)
      for (let j = i + 1; j < CATALOG_DIAG_CODES.length; j++) {
        const a = CATALOG_DIAG_CODES[i]!;
        const b = CATALOG_DIAG_CODES[j]!;
        const sameRu = CATALOG_DIAG[a].human.ru === CATALOG_DIAG[b].human.ru;
        const sameEn = texts.codes_en[a] === texts.codes_en[b];
        if (sameRu !== sameEn) pairs.push(`${a} / ${b}: ru ${sameRu ? "одинаков" : "различен"}, en наоборот`);
      }
    expect(pairs).toEqual([]);
  });

  it("лишний код в файле — разбор отказывает и называет код", () => {
    const bad = broken((f) => {
      f.codes_en["NOT_A_CODE"] = { en: "x" };
    });
    expect(() => parseCatalogTexts(bad)).toThrow("catalog.codes_en.NOT_A_CODE: кода нет в реестре ядра");
  });

  it("пропущенный код в файле — разбор отказывает и называет код", () => {
    const bad = broken((f) => {
      delete f.codes_en[SOME];
    });
    expect(() => parseCatalogTexts(bad)).toThrow(`catalog.codes_en.${SOME}: ожидается объект`);
  });

  it("лишний раздел в файле — разбор отказывает", () => {
    const bad = broken((f) => {
      (f as unknown as Record<string, unknown>)["codes_ru"] = {};
    });
    expect(() => parseCatalogTexts(bad)).toThrow("catalog.codes_ru: лишнее поле");
  });
});

describe("К3: ru берётся у ядра, en — наш (Р-1696)", () => {
  it("русского текста в файле нет ни у одного кода", () => {
    for (const code of CATALOG_DIAG_CODES) expect(Object.keys(file.codes_en[code]!), code).toEqual(["en"]);
  });

  it("русская строка в файле — разбор отказывает со ссылкой на решение", () => {
    const bad = broken((f) => {
      f.codes_en[SOME]!.ru = "своя русская строка";
    });
    expect(() => parseCatalogTexts(bad)).toThrow(`catalog.codes_en.${SOME}.ru: русский текст берётся у ядра (Р-1696)`);
  });

  it("подстановка в английской строке — разбор отказывает", () => {
    const bad = broken((f) => {
      f.codes_en[SOME]!.en = "Item {money} is unavailable.";
    });
    expect(() => parseCatalogTexts(bad)).toThrow(`catalog.codes_en.${SOME}.en: подстановка {money} здесь не бывает`);
  });

  it("ru отдаётся из реестра ядра, а не из приложения", () => {
    for (const code of CATALOG_DIAG_CODES)
      expect(catalogTextOf(code, texts, "ru"), code).toBe(CATALOG_DIAG[code].human.ru);
  });

  it("en отдаётся из файла, пока у реестра английского нет", () => {
    expect(catalogTextOf(OWN, texts, "en")).toBe(file.codes_en[OWN]!.en);
    // И это именно наша строка, а не русская из реестра.
    expect(catalogTextOf(OWN, texts, "en")).not.toBe(CATALOG_DIAG[OWN].human.ru);
  });

  // Ветка «реестр раньше файла» — та, которая у того же приёма в `src/order/texts.ts` однажды оказалась мёртвой
  // (находка ревью К2 № 5 Н-3). Проверить её можно только на реестре, у которого нужный язык есть.
  it("появился en у реестра — берётся он, пара из config замолкает сама", () => {
    const entry = CATALOG_DIAG[OWN];
    const patched = {
      ...CATALOG_DIAG,
      [OWN]: { ...entry, human: { ...entry.human, en: "From the registry" } },
    } as typeof CATALOG_DIAG;

    expect(catalogTextOf(OWN, texts, "en", patched)).toBe("From the registry");
    // На нетронутом реестре та же строка — из файла: разница доказывает, что ветка живая.
    expect(catalogTextOf(OWN, texts, "en", CATALOG_DIAG)).toBe(file.codes_en[OWN]!.en);
    // Русский при этом по-прежнему из реестра.
    expect(catalogTextOf(OWN, texts, "ru", patched)).toBe(entry.human.ru);
  });

  // Ветвь `never` — страж компиляции, но в работе она достижима: `lang` приезжает из разобранного запроса.
  // Без этой проверки её никто не видел ни зелёной, ни красной (находка ревью К3 № 4; приём тот же, что у
  // `src/order/journal.ts` — тестом закрывается то, что к компиляции не сводится).
  it("язык вне перечня интерфейса — отказ, а не молчаливая английская строка", () => {
    expect(() => catalogTextOf(SOME, texts, "de" as UiLang)).toThrow("язык вне перечня интерфейса");
  });
});

describe("К3: качество текстов", () => {
  it("каждая английская строка непустая, латиницей и без кириллицы", () => {
    for (const code of CATALOG_DIAG_CODES) {
      const s = texts.codes_en[code];
      expect(s.trim(), code).not.toBe("");
      expect(s, code).toMatch(/[A-Za-z]/);
      expect(s, code).not.toMatch(/[А-Яа-яЁё]/);
    }
  });

  it("в текстах нет строк, похожих на номер карты (инвариант 1)", () => {
    for (const code of CATALOG_DIAG_CODES) {
      expect(hasCardNumber(texts.codes_en[code]), code).toBe(false);
      expect(hasCardNumber(CATALOG_DIAG[code].human.ru), code).toBe(false);
    }
  });

  it("у каждого кода реестра есть русский текст — иначе паре не на что опираться", () => {
    for (const code of CATALOG_DIAG_CODES) expect(CATALOG_DIAG[code].human.ru.trim(), code).not.toBe("");
  });
});
