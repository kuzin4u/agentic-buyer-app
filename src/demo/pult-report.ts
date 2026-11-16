// «Отчёт» пульта (П-6.2, Р-1552): ответ маршрута `GET /pult/report` по снимку ленты пульта (`PultFeed.report()`). Форматы:
// `json` — строки акта и итоги для экрана; `md`, `csv`, `csv_excel` — выгрузки акта ACC-1 окна Б как есть (`acc1.ts`: свои
// тексты и экранирование — там, здесь только отдача файлом). Только чтение; данных витрин и реквизитов в акте нет.
import { ACC1_EXPORTS, acc1Csv, acc1CsvExcel, acc1Markdown, acc1Rows, acc1Unlinked, type Acc1Export } from "../pult/acc1.js";
import type { ActProvenance } from "./pult-act.js";
import type { PultReport } from "../pult/feed.js";
import { AGREE_LABEL } from "../pult/testtable.js";

export type ReportFormat = "json" | Acc1Export;
export const REPORT_FORMATS: readonly ReportFormat[] = ["json", ...ACC1_EXPORTS];

export interface ReportResponse {
  readonly status: number;
  readonly type: string;
  readonly body: string;
  /** Имя файла выгрузки (`content-disposition: attachment`); нет — показ на экране. */
  readonly filename?: string;
}

const FILE: Readonly<Record<Acc1Export, { readonly ext: string; readonly type: string }>> = {
  md: { ext: "md", type: "text/markdown; charset=utf-8" },
  csv: { ext: "csv", type: "text/csv; charset=utf-8" },
  csv_excel: { ext: "csv", type: "text/csv; charset=utf-8" },
};
const isFormat = (s: string | null): s is ReportFormat => s !== null && (REPORT_FORMATS as readonly string[]).includes(s);
/** Метка времени для имени файла: `2026-11-13T20-55` (часы шины, UTC). */
const stamp = (iso: string) => iso.slice(0, 16).replace(":", "-");

/** Маршрут `GET /pult/report` (П13, Р-1558): `json` — собрать снимок (кнопка «Собрать отчёт») и показать; выгрузки
 *  (`md`, `csv`, `csv_excel`) — **только показанный снимок** по `at=<builtAt>`, нового не собирают: подписанный акт — тот,
 *  что владелец смотрел на экране. `at` нет — 400 `NO_SNAPSHOT`; снимок с таким временем не последний (собран новый,
 *  перезапуск стенда, другой пульт) — 409 `SNAPSHOT_GONE`: собрать заново. */
export function routeReport(
  feed: { report(): PultReport | undefined; reportAt(builtAt: string): PultReport | undefined },
  format: string | null,
  at: string | null,
  lang: "ru" | "en",
  provenance?: ActProvenance,
): ReportResponse {
  // Провенанс прогона (П26) — липкий признак сборки демо-стенда (`ActProvenance`), а не подсчёт по окну журнала реакций:
  // окно последних 50 нажатий вытеснило бы нажатия теста в длинном прогоне (ревью Б-К4, блокер Б1).
  if (!isFormat(format) || format === "json") {
    const report = isFormat(format) ? feed.report() : undefined;
    // Снимок собран и показан — провенанс этого снимка запоминается: выгрузка отдаст тот же, что видел владелец.
    if (report !== undefined) provenance?.shown(report.builtAt);
    return reportResponse(report, format, lang, provenance?.byTest() === true);
  }
  const json = (status: number, error: string): ReportResponse => ({ status, type: "application/json; charset=utf-8", body: JSON.stringify({ error }) });
  if (at === null || at === "") return json(400, "NO_SNAPSHOT");
  const snap = feed.reportAt(at);
  // Провенанс — того снимка, что показан на экране (П13, Х4б): нажатие теста после сборки задним числом её не помечает.
  return snap === undefined ? json(409, "SNAPSHOT_GONE") : reportResponse(snap, format, lang, provenance?.byTestAt(at) === true);
}

export function reportResponse(
  report: PultReport | undefined,
  format: string | null,
  lang: "ru" | "en",
  byTest = false,
): ReportResponse {
  const json = (status: number, body: unknown): ReportResponse => ({ status, type: "application/json; charset=utf-8", body: JSON.stringify(body) });
  if (!isFormat(format)) return json(400, { error: "BAD_FORMAT" });
  // Движок ещё не отработал — отчёта нет (не пустой акт).
  if (report === undefined) return json(409, { error: "NO_ENGINE" });
  const { table, records, builtAt } = report;
  const opts = { operatorByTest: byTest };
  if (format === "json") {
    return json(200, {
      builtAt,
      totals: table.totals,
      rows: acc1Rows(table, records, opts).map((r) => ({ ...r, agreeLabel: AGREE_LABEL[r.agree] })),
      unlinked: acc1Unlinked(table, records).length,
      // Подписи «сходится» — окна Б (`AGREE_LABEL`): итоги на экране теми же словами, что в акте.
      agreeLabels: AGREE_LABEL,
    });
  }
  const body = format === "md" ? acc1Markdown(table, lang, records, opts) : format === "csv" ? acc1Csv(table, lang, records, opts) : acc1CsvExcel(table, lang, records, opts);
  const suffix = format === "csv_excel" ? "-excel" : "";
  return { status: 200, type: FILE[format].type, body, filename: `acc1-${stamp(builtAt)}-${lang}${suffix}.${FILE[format].ext}` };
}
