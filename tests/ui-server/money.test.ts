// Сумма человеку (ИН-0, подшаг К4а; К-Б § 3 «Деньги», **правило планов № 2**).
//
// Правило № 2 — сумма это число в минимальных единицах плюс валюта, а формат на экране выводится по валюте и языку, а
// не литералом «₽». До этого файла оно не держалось ничем: единственная проверка строки была «содержит шестёрку»
// (находка ревью К4 № 2), то есть проходила и при «6 ₽» вместо «6 320,00 ₽» — ошибка масштаба в сто раз.
//
// Проверяется не «похоже на сумму», а **точная строка** и обе названные в коде ошибки: валюта вне таблицы ISO 4217 и
// нецелое число минимальных единиц. Оба случая — дефект сборки ответа, и они нарочно не гасятся: иначе сумма ушла бы
// на экран с неверным масштабом.
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { ISO4217_MINOR_UNITS } from "../../src/iso4217.js";
import { formatUiMoney, purchaseResponse, UI_LANGS, UI_TEXT, type CorePurchase } from "../../src/ui-server/index.js";

/** Пробел в выводе `Intl` — неразрывный и может быть узким: сравниваем по значащим знакам, а не по виду пробела.
 *  Класс задан свойством Unicode (`\p{Zs}` — любой пробельный разделитель), а не перечнем самих знаков: неразрывный
 *  пробел в исходнике запрещён линтером и в чужом редакторе неразличим от обычного. */
const plain = (s: string): string => s.replace(/\p{Zs}|\s/gu, " ");

test("рубли: формат по языку, знак валюты из данных, а не литералом", () => {
  // 632 000 минимальных единиц = 6 320 рублей: масштаб виден в самой строке, и подмена сотен на единицы её ломает.
  const money = { amount: 632_000, currency: "RUB" } as const;
  expect(plain(formatUiMoney(money, "ru"))).toBe("6 320,00 ₽");
  expect(plain(formatUiMoney(money, "en"))).toBe("RUB 6,320.00");
  // Та же величина на двух языках пишется по-разному — это и значит «формат по языку».
  expect(formatUiMoney(money, "ru")).not.toBe(formatUiMoney(money, "en"));
});

test("число знаков после запятой — по ISO 4217, а не по виду валюты", () => {
  // Йена без дробной части, динар с тремя знаками: таблица, а не догадка по «обычно два знака».
  expect(ISO4217_MINOR_UNITS.JPY).toBe(0);
  expect(ISO4217_MINOR_UNITS.BHD).toBe(3);
  // `en-GB` пишет йену как `JP¥` — знак валюты берётся у локали, а не выдумывается нами: именно это и значит
  // «формат по валюте и языку» (правило планов № 2).
  expect(plain(formatUiMoney({ amount: 1234, currency: "JPY" }, "en"))).toBe("JP¥1,234");
  expect(plain(formatUiMoney({ amount: 1234, currency: "BHD" }, "en"))).toBe("BHD 1.234");
  // Тот же набор цифр при разном числе знаков даёт разные суммы — на этом и ломается «два знака всегда».
  expect(formatUiMoney({ amount: 1234, currency: "JPY" }, "en")).not.toBe(formatUiMoney({ amount: 1234, currency: "BHD" }, "en"));
});

test("валюты нет в таблице ISO 4217 — ошибка сборки ответа, а не тихий показ", () => {
  expect(() => formatUiMoney({ amount: 100, currency: "XXX" } as never, "ru")).toThrow(RangeError);
});

test("нецелое число минимальных единиц — ошибка, а не округление на экране", () => {
  for (const amount of [1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53]) {
    expect(() => formatUiMoney({ amount, currency: "RUB" }, "ru")).toThrow(TypeError);
  }
});

test("строка «не списано» § 5.3 — это формат той же величины, а не её пересчёт", () => {
  const core = {
    purchase_id: "pur_71",
    state: "OFFERS",
    intent: {
      mandate_id: "mnd_14",
      status: "ACTIVE",
      amount_left: { amount: 632_000, currency: "RUB" },
      valid_to: "2026-12-01T00:00:00Z",
      as_of: "2026-11-20T10:00:00Z",
      revocation_id: null,
    },
    stops: [],
    stoppable: false,
  } as unknown as CorePurchase;
  for (const lang of UI_LANGS) {
    const out = purchaseResponse(core, lang);
    // Сравнение с форматом **той же** величины: «содержит цифру» пропускало ошибку масштаба (находка ревью К4 № 2).
    expect(out.done_line.not_spent).toBe(UI_TEXT["line.not_spent"][lang].replace("{money}", formatUiMoney({ amount: 632_000, currency: "RUB" }, lang)));
    // Пара «число плюс валюта» уходит экрану как есть — он её не складывает и не пересчитывает.
    expect(out.intent.amount_left).toEqual({ amount: 632_000, currency: "RUB" });
  }
});

test("таблица ISO 4217 одна на монитор и на /ui/v1 — второй копии нет", () => {
  // Обещанный случай ревью К2: два перечня знаков разошлись бы молча, и одна и та же сумма показывалась бы в двух
  // местах по-разному (находка ревью К4 № 3).
  const table = readFileSync("src/iso4217.ts", "utf8");
  expect(table).toContain("ISO4217_MINOR_UNITS");
  for (const file of ["src/ui-server/money.ts", "src/demo/money.ts"]) {
    const text = readFileSync(file, "utf8");
    expect(text, file).toContain("ISO4217_MINOR_UNITS");
    expect(text, file).toMatch(/from "\.\.?\/(\.\.\/)?iso4217\.js"/);
    // Своего перечня знаков у потребителя нет: ни объявления таблицы, ни «по умолчанию два знака».
    expect(text, file).not.toMatch(/MINOR_UNITS\s*[:=]\s*\{/);
  }
});
