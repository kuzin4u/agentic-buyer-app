// Разбор ссылок на модули в исходниках — общий помощник тестов границ (экраны DEMO-2, драйвер нарушителя П7). Отдельно от
// файлов тестов: импорт из `*.test.ts` заново регистрирует его тесты в импортирующем файле (ревью П-11.3а № 8).
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/** Формы ссылки на модуль: from, побочный импорт, динамический импорт, require/createRequire, `/// <reference types>`.
 *  Пробел перед скобкой `import ("…")` / `require ("…")` — тоже ссылка (ревью П-11.3а-3 № 4). */
const SPEC =
  /(?:^|[\s;])(?:import|export)\s[^"'`;]*?from\s*["'`]([^"'`]+)["'`]|(?:^|[\s;])import\s*["'`]([^"'`]+)["'`]|\bimport\s*\(\s*["'`]([^"'`]+)["'`]\s*\)|\brequire(?:\.resolve)?\s*\(\s*["'`]([^"'`]+)["'`]\s*\)|\/\/\/\s*<reference\s+(?:types|path)\s*=\s*["']([^"']+)["']/g;

/** Начало вызова `import(` / `require(` / `require.resolve(` (с пробелами перед скобкой); `createRequire(` — отдельно. */
const CALL = /\b(?:import|require(?:\.resolve)?)\s*\(/g;
/** Один литерал без подстановки — и сразу закрывающая скобка: только такой вызов читается статически. */
const SINGLE_LITERAL = /^\s*(?:"[^"\\\n]*"|'[^'\\\n]*'|`[^`\\$]*`)\s*\)/;

/** Динамическая ссылка, которую статически не прочитать, — сама нарушение: любой `import(` / `require(`, аргумент которого
 *  не один литерал (переменная, сложение строк, шаблон с подстановкой, второй аргумент), и любой `createRequire(`
 *  (ревью П-11.3а-2, повторное № 9; П-11.3а-3 № 4; решение владельца, чат 11.11). */
export function hasDynamic(source: string): boolean {
  if (/\bcreateRequire\s*\(/.test(source)) return true;
  for (const m of source.matchAll(CALL)) if (!SINGLE_LITERAL.test(source.slice(m.index + m[0].length))) return true;
  return false;
}

/** Совместимость с прежним `DYNAMIC.test(src)`. */
export const DYNAMIC = { test: hasDynamic } as const;

export function specifiers(source: string): string[] {
  const out: string[] = [];
  for (const m of source.matchAll(SPEC)) out.push((m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5])!);
  return out;
}

export function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? filesUnder(p) : /\.(ts|mts|cts|tsx|js)$/.test(n) ? [p] : [];
  });
}
