// Заголовки карточек библиотеки ситуаций (`docs/reference/situations.md`, К0) для экрана «Интерпретация» (К1.4).
// Библиотека — копия из чата, только чтение; берётся сводная таблица в начале файла. Текст карточек — на русском.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const SITUATIONS_PATH = "docs/reference/situations.md";
/** Файл библиотеки — от корня пакета, а не от рабочего каталога процесса (К1.4 № 11, П-5.2): `npm run demo` из другой папки
 *  находит её так же. */
export const SITUATIONS_FILE = fileURLToPath(new URL(`../../${SITUATIONS_PATH}`, import.meta.url));

/** Строка сводной таблицы: `| С-01 | Заголовок | риск | сессия |`. */
const ROW = /^\| (С-\d{2}) \| ([^|]+?) \|/;

export function parseSituationTitles(md: string): Readonly<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const line of md.split("\n")) {
    const m = ROW.exec(line);
    if (m && !Object.hasOwn(out, m[1]!)) out[m[1]!] = m[2]!.trim();
  }
  return out;
}

export const loadSituationTitles = (path = SITUATIONS_FILE): Readonly<Record<string, string>> => parseSituationTitles(readFileSync(path, "utf8"));
