// Разбор ссылок на модули в исходниках — общий помощник тестов границ (экраны DEMO-2, драйвер нарушителя П7). Отдельно от
// файлов тестов: импорт из `*.test.ts` заново регистрирует его тесты в импортирующем файле (ревью П-11.3а № 8).
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/** Формы ссылки на модуль: from, побочный импорт, динамический импорт, require/createRequire, `/// <reference types>`. */
const SPEC =
  /(?:^|[\s;])(?:import|export)\s[^"'`;]*?from\s*["'`]([^"'`]+)["'`]|(?:^|[\s;])import\s*["'`]([^"'`]+)["'`]|import\(\s*["'`]([^"'`]+)["'`]\s*\)|\brequire(?:\.resolve)?\(\s*["'`]([^"'`]+)["'`]\s*\)|\/\/\/\s*<reference\s+(?:types|path)\s*=\s*["']([^"']+)["']/g;

/** Динамическая ссылка, которую статически не прочитать, — сама нарушение: не строка или шаблонная строка с подстановкой
 *  (`import(\`…${x}…\`)` — ревью П-11.3а-2, повторное № 9). */
export const DYNAMIC = /import\(\s*(?:[^"'`\s)]|`[^`]*\$\{)|\brequire\(\s*(?:[^"'`\s)]|`[^`]*\$\{)|\bcreateRequire\(/;

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
