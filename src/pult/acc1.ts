// Акт ACC-1 пульта (П-6.2, часть окна Б; PR #16, К2): строки акта по 25 тестам задания v1.1 и выгрузка — Markdown-таблица и
// CSV. Чистые функции: вход — таблица тестирования (`testTable`, «сходится» в ней уже поставлено по вердиктам движка) и
// перечень записей, который передаёт вызывающий (журнал действий и протокол П-6.1 окна А — со статусами движка). Акт ничего
// не вычисляет: ни вердиктов, ни статусов, ни «сходится» — только раскладывает готовое по колонкам (инвариант 2). Подключение
// к экрану «Отчёт» — окно А (П-6.2).
//
// Ячейки — текстом (инвариант 4): Markdown — `markdownCell` (`\ | ` [ ] * _`, перевод строки, `& < >`) и сверх того
// автоссылки, упоминания, эмодзи и формулы GitHub (ревью П-4.3 № 3, ревью К2 № 1); CSV — по RFC 4180 и без формул в начале
// ячейки. В строках — только идентификаторы, коды и подписи (инвариант 1).
import { markdownCell } from "../dashboards/control-feed.js";
import { STAND_TEST_KIND_LABEL } from "../dashboards/stand-tests.js";
import type { Phrase } from "./phrases.js";
import { AGREE_LABEL, TABLE_NOTE, TEST_KIND_LABEL, type Agree, type TestCode, type TestRow, type TestTable } from "./testtable.js";

export type Acc1Lang = "ru" | "en";
const p = (ru: string, en: string): Phrase => ({ ru, en });

/** Запись, которую акт получает аргументом (журнал действий, протокол П-6.1): идентификатор (`П-NNN` или код записи),
 *  привязка — к тесту (тогда только к нему) или к объекту прогона, статус — строкой движка. Акт статус не вычисляет и не
 *  переводит: пишет код. Тип статуса, источник, время и вид действия — согласовать с П-6.1 окна А (STATUS «Открыто»). */
export interface Acc1Record {
  readonly id: string;
  readonly test?: TestCode;
  readonly obj?: string;
  readonly status: string;
}

/** Строка акта ACC-1. */
export interface Acc1Row {
  readonly test: TestCode;
  readonly kind: Phrase;
  /** Ожидание на стенде — столбец M задания v1.1. */
  readonly expected: Phrase;
  readonly fact: Phrase;
  readonly agree: Agree;
  /** Замечание: известная причина «нет» и записи журнала этого теста. Пусто — замечаний нет. */
  readonly note: Phrase;
  /** Прогон при эмуляторе клиента «Авто» (П5 п. 3). */
  readonly auto: boolean;
  /** Строка судится по прогону драйвера нарушителя «ПР» (П7 п. 4). */
  readonly violatorDriver: boolean;
  /** Метка прогона; пусто — прогона нет. */
  readonly run: string;
}

/** Известная причина «нет», которую пульт на стенде не может снять сам (адрес — STATUS). */
interface KnownNote {
  readonly applies: (r: TestRow) => boolean;
  readonly note: Phrase;
}
/** Н-08: пока ветка защиты на стенде недостижима — «нет» с причиной (Р-1546; П9 п. 4 — проект), и только когда Платформа
 *  отказала (`refused`): «нет» при прошедшей операции — другая причина, её № 10 не объясняет (ревью К2 № 12). **Временно:**
 *  снимается кирпичом окна А по № 10 — до MVP, после П-6.1 (решение владельца 13.11); после него — живой прогон Н-08. */
export const KNOWN_NOTES: Partial<Readonly<Record<TestCode, KnownNote>>> = {
  "Н-08": {
    applies: (r) => r.agree === "no" && r.driver === "refused",
    note: p(
      "ветка «сработало, защитила Платформа» на стенде недостижима — STATUS «Расхождения» № 10",
      'the "triggered, protected by the Payment system" branch is unreachable on the stand — STATUS discrepancy No. 10',
    ),
  },
};

const AUTO_LABEL: Phrase = p("эмулятор клиента: авто", "client emulator: auto");
const RECORDS_LABEL: Phrase = p("записи:", "records:");

const joinP = (parts: readonly Phrase[], sep: string): Phrase => p(parts.map((x) => x.ru).join(sep), parts.map((x) => x.en).join(sep));
const recList = (rs: readonly Acc1Record[]): Phrase => {
  const list = rs.map((x) => `${x.id}: ${x.status}`).join(", ");
  return joinP([RECORDS_LABEL, p(list, list)], " ");
};
/** Запись относится к строке: задан тест — только к нему; иначе — по объекту прогона (ревью К2 № 3). */
const belongs = (x: Acc1Record, r: TestRow) => (x.test !== undefined ? x.test === r.test : x.obj !== undefined && r.objs.includes(x.obj));

/** Строки акта: по одной на тест, в порядке таблицы. */
export function acc1Rows(table: TestTable, records: readonly Acc1Record[] = []): Acc1Row[] {
  return table.rows.map((r) => {
    const known = KNOWN_NOTES[r.test];
    const mine = records.filter((x) => belongs(x, r));
    const notes: Phrase[] = [];
    if (known?.applies(r)) notes.push(known.note);
    if (mine.length) notes.push(recList(mine));
    return {
      test: r.test,
      kind: TEST_KIND_LABEL[r.kind],
      expected: r.expected,
      fact: r.fact,
      agree: r.agree,
      note: joinP(notes, "; "),
      auto: r.auto,
      violatorDriver: r.driver !== undefined,
      run: r.run ?? "",
    };
  });
}

/** Записи, не попавшие ни в одну строку (записи о системе, о другом прогоне), — акт их не теряет (ревью К2 № 3). */
export function acc1Unlinked(table: TestTable, records: readonly Acc1Record[] = []): Acc1Record[] {
  return records.filter((x) => !table.rows.some((r) => belongs(x, r)));
}

const HEAD: Readonly<Record<Acc1Lang, readonly string[]>> = {
  ru: ["№ теста", "Вид", "Ожидание на стенде (MVP, задание v1.1)", "MVP — факт", "MVP — сходится", "Замечание", "Пометки (П5, П7)", "Метка прогона"],
  en: ["Test No.", "Kind", "Expected on the stand (MVP, task v1.1)", "MVP — fact", "MVP — agrees", "Remark", "Marks (П5, П7)", "Run label"],
};
const TITLE: Phrase = p("Акт ACC-1 — таблица тестирования пульта (задание v1.1)", "ACC-1 record — console test table (task v1.1)");
const UNLINKED_LABEL: Phrase = p("Записи без строки теста", "Records not linked to a test row");

const marks = (r: Acc1Row, lang: Acc1Lang): string =>
  [...(r.auto ? [AUTO_LABEL[lang]] : []), ...(r.violatorDriver ? [STAND_TEST_KIND_LABEL.violator[lang]] : [])].join("; ");
const cells = (r: Acc1Row, lang: Acc1Lang): string[] => [
  r.test,
  r.kind[lang],
  r.expected[lang],
  r.fact[lang],
  AGREE_LABEL[r.agree][lang],
  r.note[lang],
  marks(r, lang),
  r.run,
];

/** Ячейка Markdown акта: `markdownCell` и сверх того (ревью П-4.3 № 3, ревью К2 № 1; проверено рендером GitHub):
 *  `~` и точка после `www` — обратной косой (зачёркивание и `www.`-ссылка не срабатывают); `:`, `@`, `$` — внутри `<span>`:
 *  обратная косая их не гасит — GitHub после разбора Markdown всё равно делает ссылку на почту, упоминание, эмодзи и
 *  формулу; разрыв элементом — гасит (`http<span>:</span>//`, `m<span>@</span>e.x`). `<span>` — разметка акта, не данные. */
export function acc1MdCell(s: string): string {
  return markdownCell(s)
    .replace(/~/g, "\\~")
    .replace(/(www)\./gi, "$1\\.")
    .replace(/[:@$]/g, (c) => `<span>${c}</span>`);
}

/** Ячейка CSV (RFC 4180): всегда в кавычках, кавычка — удвоением; перевод строки — пробел; начало `= + - @` и табуляция,
 *  в том числе после пробелов, — с апострофом, чтобы таблица не приняла текст за формулу (ревью К2 № 10). */
export function acc1CsvCell(s: string): string {
  const flat = s.replace(/[\r\n]+/g, " ");
  const safe = /^\s*[=+\-@]/.test(flat) || flat.startsWith("\t") ? `'${flat}` : flat;
  return `"${safe.replace(/"/g, '""')}"`;
}

const totalsLine = (t: TestTable, lang: Acc1Lang): string => {
  const s = t.totals;
  return lang === "ru"
    ? `Итого: тестов ${s.tests}, сходится ${s.yes}, не сходится ${s.no}, нет случая ${s.noCase}, не проверено ${s.unchecked}.`
    : `Total: ${s.tests} tests, ${s.yes} agree, ${s.no} do not agree, ${s.noCase} no case, ${s.unchecked} not checked.`;
};

/** Акт ACC-1 в Markdown: заголовок, таблица 25 строк, записи без строки теста, итоги, примечание таблицы. */
export function acc1Markdown(table: TestTable, lang: Acc1Lang, records: readonly Acc1Record[] = []): string {
  const line = (xs: readonly string[]) => `| ${xs.map(acc1MdCell).join(" | ")} |`;
  const head = HEAD[lang];
  const out = [`# ${acc1MdCell(TITLE[lang])}`, "", line(head), `|${head.map(() => "---").join("|")}|`];
  for (const r of acc1Rows(table, records)) out.push(line(cells(r, lang)));
  const free = acc1Unlinked(table, records);
  if (free.length) out.push("", acc1MdCell(`${UNLINKED_LABEL[lang]}: ${recList(free)[lang]}`));
  out.push("", acc1MdCell(totalsLine(table, lang)), "", acc1MdCell(TABLE_NOTE[lang]));
  return out.join("\n");
}

function csvWith(sep: "," | ";", table: TestTable, lang: Acc1Lang, records: readonly Acc1Record[]): string {
  const line = (xs: readonly string[]) => xs.map(acc1CsvCell).join(sep);
  const out = [line(HEAD[lang]), ...acc1Rows(table, records).map((r) => line(cells(r, lang)))];
  const free = acc1Unlinked(table, records);
  if (free.length) out.push(line(["", "", "", "", "", `${UNLINKED_LABEL[lang]}: ${recList(free)[lang]}`, "", ""]));
  return out.join("\r\n") + "\r\n";
}

/** Акт ACC-1 в CSV для машинного чтения: строка заголовка, 25 строк и строка записей без теста (если есть); разделитель —
 *  запятая, без BOM, конец строки — CRLF (RFC 4180). */
export function acc1Csv(table: TestTable, lang: Acc1Lang, records: readonly Acc1Record[] = []): string {
  return csvWith(",", table, lang, records);
}

/** Знак порядка байтов UTF-8 (U+FEFF): без него Excel читает файл в кодировке системы и портит кириллицу. Кодом знака, не
 *  литералом — невидимый знак в исходнике теряется при правке (ревью К3 № 2). */
export const UTF8_BOM = String.fromCharCode(0xfeff);

/** Акт ACC-1 в CSV для Excel с русскими настройками (К3, решение владельца 13.11): UTF-8 с BOM, разделитель «;» (так Excel
 *  с русскими настройками делит колонки), остальное — как в `acc1Csv`. Отдавать файлом в UTF-8. */
export function acc1CsvExcel(table: TestTable, lang: Acc1Lang, records: readonly Acc1Record[] = []): string {
  return UTF8_BOM + csvWith(";", table, lang, records);
}

/** Выгрузки акта и подписи кнопок для экрана «Отчёт» (кнопки — окно А, П-6.2). */
export const ACC1_EXPORTS = ["md", "csv", "csv_excel"] as const;
export type Acc1Export = (typeof ACC1_EXPORTS)[number];
export const ACC1_EXPORT_LABEL: Readonly<Record<Acc1Export, Phrase>> = {
  md: p("Markdown", "Markdown"),
  csv: p("CSV (машинное чтение)", "CSV (machine-readable)"),
  // «;» Excel делит на колонки только при региональных настройках с «;» (Россия, большая часть Европы) — в en это сказано
  // прямо: при en-US файл ляжет в одну колонку (ревью К3 № 1).
  csv_excel: p("CSV для Excel", "CSV for Excel (semicolon-separated)"),
};
