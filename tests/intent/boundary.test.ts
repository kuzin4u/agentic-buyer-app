// П-К4, К2 — граница модуля поручения (правило 1 планов «только через порт»; ревью К2 З5).
// `src/intent` работает с ядром и стендом **через порты**, а не импортом: шаблон карточки, хранилище черновиков,
// журнал, время и идентификаторы подаются зависимостями. Проверяется обходом графа импортов, а не доверием к
// комментарию: сборку стенда (`src/demo`) и пакет стенда (`agentic-ps-platform`, devDependency) модуль не ввозит ни
// прямо, ни через свои модули. Типы ядра (`agentic-buyer-ref`) разрешены — перечень режимов подтверждения и домен
// берутся у ядра, своей копии приложение не держит (П33 п. 1).
import { readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { DYNAMIC, filesUnder, specifiers } from "../support/imports.js";

const ROOT = resolve(import.meta.dirname, "../..");
const INTENT = join(ROOT, "src/intent");

/** Пакеты, которые модулю поручения ввозить нельзя. Ядро и его канонизация — можно (`agentic-buyer-ref`,
 *  `@kuzin4u/agentic-core`): это источник домена и хэша показанного, а не сборка стенда. */
const FORBIDDEN_PACKAGES = [/^agentic-ps-platform(\/|$)/, /^vitest(\/|$)/];

/** Свои каталоги, которые модулю поручения ввозить нельзя: сборка стенда, экраны и пульт. */
/** `src/ui-server/` — файлы окна Б (ИН-0): окно А их не импортирует (указание владельца 20.11), и на этом стоит весь
 *  К3 — показ суммы подаётся портом, а не берётся оттуда (ревью К3 З5). Граница закреплена здесь, а не комментарием. */
const FORBIDDEN_LOCAL = [/^src\/demo\//, /^src\/dashboards\//, /^src\/pult\//, /^src\/ui-server\//, /^src\/ui-client\//];

describe("граница src/intent (правило 1 планов: только через порт)", () => {
  const files = filesUnder(INTENT);

  it("файлы модуля найдены — иначе проверка ничего не проверяет", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("ни один файл модуля не ввозит сборку стенда, экраны, пульт и пакет Платформы — ни прямо, ни через свои модули", () => {
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
        // Свои файлы обходятся дальше: нарушение через соседний модуль — то же нарушение.
        else if (rel.startsWith("src/")) stack.push(target);
      }
    }
    expect(bad).toEqual([]);
  });

  it("проверка ловит подделку: импорт сборки стенда и пакета Платформы был бы красным", () => {
    expect(FORBIDDEN_LOCAL.some((re) => re.test("src/demo/scenarios.ts"))).toBe(true);
    expect(FORBIDDEN_LOCAL.some((re) => re.test("src/ui-server/money.ts"))).toBe(true);
    expect(FORBIDDEN_PACKAGES.some((re) => re.test("agentic-ps-platform/fixtures"))).toBe(true);
    // А ядро — нет: домен и канонизация берутся у него.
    expect(FORBIDDEN_PACKAGES.some((re) => re.test("agentic-buyer-ref/src/shared/domain.js"))).toBe(false);
    expect(FORBIDDEN_LOCAL.some((re) => re.test("src/contract/ui-v1/methods.ts"))).toBe(false);
  });
});
