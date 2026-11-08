// Заголовки карточек библиотеки ситуаций (`docs/reference/situations.md`, К0) для экрана «Интерпретация» (К1.4).
// Библиотека — копия из чата, только чтение; берётся сводная таблица в начале файла. Текст карточек — на русском.
import { readFileSync } from "node:fs";

export const SITUATIONS_PATH = "docs/reference/situations.md";

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

export const loadSituationTitles = (path = SITUATIONS_PATH): Readonly<Record<string, string>> => parseSituationTitles(readFileSync(path, "utf8"));
