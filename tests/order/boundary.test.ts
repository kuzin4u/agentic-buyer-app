// Н-3, К1 — граница модуля итога (правило планов № 1 «только через порт»; граница с окном Б, Р-1693).
// `src/order` работает с ядром и каркасом **через порты**: прочитанная операция, время чтения, поручение из `verify`,
// цена агента, акт и строки словаря каркаса приходят зависимостями. Проверяется обходом графа импортов, а не доверием
// к комментарию: `src/ui-server/` и `src/ui-client/` — файлы окна Б, и на этом стоит весь К1 — строки `line.not_spent`
// и `DONE_TEXT` подаются портом `ShellText`, а не берутся оттуда. Типы ядра (`agentic-buyer-ref`) разрешены: операция
// и запись об исполнении берутся у него, своей копии приложение не держит.
import { readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { DYNAMIC, filesUnder, specifiers } from "../support/imports.js";

const ROOT = resolve(import.meta.dirname, "../..");
const ORDER = join(ROOT, "src/order");

/** Пакеты и пути пакетов, которые модулю итога ввозить нельзя. Ядро целиком не запрещено — домен и операция берутся
 *  у него, — но **адаптеры конкретной платформы внутри ядра запрещены** (правило планов № 1; находка ревью К1 № 5):
 *  без этой строки «чтобы не дублировать разбор» в приложение въехал бы `agentic-buyer-ref/src/agent/adapters/pao/`,
 *  и адаптер ПАО оказался бы в приложении при зелёной границе. */
const FORBIDDEN_PACKAGES = [
  /^agentic-ps-platform(\/|$)/,
  /^vitest(\/|$)/,
  /^agentic-buyer-ref\/src\/agent\/adapters\//,
];

const FORBIDDEN_LOCAL = [
  /^src\/demo\//,
  /^src\/dashboards\//,
  /^src\/pult\//,
  /^src\/ui-server\//,
  /^src\/ui-client\//,
  // Модуль поручения — соседняя задача, а не источник форм итога: общее лежит в `src/contract/ui-v1/` и
  // `src/config-parse.ts`. Без этой строки «пара ru/en» могла бы приехать из `src/intent/`, и модуль итога зависел бы
  // от карточки поручения.
  /^src\/intent\//,
];

describe("граница src/order (правило 1 планов: только через порт)", () => {
  const files = filesUnder(ORDER);

  it("файлы модуля найдены — иначе проверка ничего не проверяет", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("ни один файл модуля не ввозит экраны, сервер окна Б, стенд, пульт и пакет Платформы — ни прямо, ни через свои модули", () => {
    const bad: string[] = [];
    const seen = new Set<string>();
    const stack = [...files];
    while (stack.length > 0) {
      const f = stack.pop()!;
      if (seen.has(f)) continue;
      seen.add(f);
      const src = readFileSync(f, "utf8");
      const name = relative(ROOT, f);
      if (DYNAMIC.test(src)) bad.push(`${name} → динамическая ссылка на модуль`);
      for (const s of specifiers(src)) {
        if (s.startsWith("node:")) continue;
        if (!s.startsWith(".")) {
          if (FORBIDDEN_PACKAGES.some((re) => re.test(s))) bad.push(`${name} → ${s}`);
          continue;
        }
        const target = resolve(dirname(f), s).replace(/\.js$/, ".ts");
        const rel = relative(ROOT, target);
        if (FORBIDDEN_LOCAL.some((re) => re.test(rel))) bad.push(`${name} → ${rel}`);
        else if (rel.startsWith("src/")) stack.push(target);
      }
    }
    expect(bad).toEqual([]);
  });

  it("проверка ловит подделку: импорт словаря каркаса и пакета Платформы был бы красным", () => {
    expect(FORBIDDEN_LOCAL.some((re) => re.test("src/ui-server/lang.ts"))).toBe(true);
    expect(FORBIDDEN_LOCAL.some((re) => re.test("src/ui-server/money.ts"))).toBe(true);
    expect(FORBIDDEN_LOCAL.some((re) => re.test("src/intent/texts.ts"))).toBe(true);
    expect(FORBIDDEN_PACKAGES.some((re) => re.test("agentic-ps-platform/fixtures"))).toBe(true);
    // Адаптер платформы внутри ядра — тоже красный: правило планов № 1 держит его вне приложения.
    expect(FORBIDDEN_PACKAGES.some((re) => re.test("agentic-buyer-ref/src/agent/adapters/pao/map.js"))).toBe(true);
    // А ядро, контракт и общий разбор `config/` — нет: это источники домена, типов и формы пары ru/en.
    expect(FORBIDDEN_PACKAGES.some((re) => re.test("agentic-buyer-ref/src/shared/domain.js"))).toBe(false);
    expect(FORBIDDEN_LOCAL.some((re) => re.test("src/contract/ui-v1/methods.ts"))).toBe(false);
    expect(FORBIDDEN_LOCAL.some((re) => re.test("src/config-parse.ts"))).toBe(false);
  });
});
