// Акт ACC-1 пульта (П-6.2, часть окна Б; PR #16, К2): строки акта по 25 тестам задания v1.1 и выгрузка — Markdown-таблица и
// CSV. Чистые функции: вход — таблица тестирования (`testTable`, «сходится» в ней уже поставлено по вердиктам движка) и
// перечень записей, который передаёт вызывающий (протокол П-6.1 окна А — со статусами движка). Акт ничего
// не вычисляет: ни вердиктов, ни статусов, ни «сходится» — только раскладывает готовое по колонкам (инвариант 2). Подключение
// к экрану «Отчёт» — окно А (П-6.2).
//
// Ячейки — текстом (инвариант 4): Markdown — `markdownCell` (`\ | ` [ ] * _`, перевод строки, `& < >`) и сверх того
// автоссылки, упоминания, эмодзи и формулы GitHub (ревью П-4.3 № 3, ревью К2 № 1); CSV — по RFC 4180 и без формул в начале
// ячейки. В строках — только идентификаторы, коды и подписи (инвариант 1).
import { markdownCell } from "../dashboards/control-feed.js";
import { STAND_TEST_KIND_LABEL } from "../dashboards/stand-tests.js";
import type { PultActionKind } from "./actions.js";
import { PULT, type Phrase } from "./phrases.js";
import type { ProtoEntry, ProtoStatus } from "./protocol.js";
import { AGREE_LABEL, TABLE_NOTE, TEST_KIND_LABEL, type Agree, type TestCode, type TestRow, type TestTable } from "./testtable.js";

export type Acc1Lang = "ru" | "en";
const p = (ru: string, en: string): Phrase => ({ ru, en });

/** Запись, которую акт получает аргументом (протокол П-6.1 окна А, `ProtoEntry`): идентификатор (`П-NNN`), привязка — к
 *  тесту (тогда только к нему) или к объекту прогона, статус, время появления, вид реакции и секунд до неё — как их
 *  поставил движок (ревью К2 № 4). Акт ничего из этого не вычисляет, только подписывает словами. Источника записи
 *  (эмулятор клиента, драйвер «ПР», оператор) у `ProtoEntry` нет — сначала поле у окна А, затем в акте, после MVP (STATUS
 *  «Открыто»); пометки «Авто» и «ПР» акт ставит на строке теста (П5 п. 3, П7 п. 4). */
export interface Acc1Record {
  /** `П-NNN` — `ProtoEntry.no`. */
  readonly id: string;
  readonly test?: TestCode;
  /** Объект прогона — `ProtoEntry.obj`; у записи системы `""` — в строку теста не попадает. */
  readonly obj?: string;
  /** Типы — по `ProtoEntry`: расхождение с П-6.1 роняет сборку (ревью № 3). */
  readonly status: ProtoEntry["status"];
  /** Время появления записи — `ProtoEntry.at`, как есть. */
  readonly at: ProtoEntry["at"];
  /** Вид реакции — `ProtoEntry.reaction`. */
  readonly action?: ProtoEntry["reaction"];
  /** Секунд от появления до реакции — `ProtoEntry.reactSec`. */
  readonly reactSec?: ProtoEntry["reactSec"];
}

/** Подписи статусов и реакций — из словаря пульта окна А (один источник с панелью «Журнал»); `Record` по типу движка:
 *  новый статус или вид реакции без подписи — ошибка сборки, а не код в акте (ревью К2 № 4). */
export const ACC1_STATUS_LABEL: Readonly<Record<ProtoStatus, Phrase>> = {
  open: PULT["proto.st.open"],
  reacted: PULT["proto.st.reacted"],
  prevented: PULT["proto.st.prevented"],
  cleared: PULT["proto.st.cleared"],
  closed: PULT["proto.st.closed"],
  stopped: PULT["proto.st.stopped"],
};
export const ACC1_ACTION_LABEL: Readonly<Record<PultActionKind, Phrase>> = {
  stop: PULT["act.kind.stop"],
  remind: PULT["act.kind.remind"],
  remind_note: PULT["act.kind.remind_note"],
  revoke: PULT["act.kind.revoke"],
  review: PULT["act.kind.review"],
};

/** Строка акта ACC-1. */
export interface Acc1Row {
  readonly test: TestCode;
  readonly kind: Phrase;
  /** Ожидание на стенде — столбец M задания v1.1. */
  readonly expected: Phrase;
  readonly fact: Phrase;
  readonly agree: Agree;
  /** Замечание: известная причина «нет» или «не проверено» и записи журнала этого теста. Пусто — замечаний нет. */
  readonly note: Phrase;
  /** Прогон при эмуляторе клиента «Авто» (П5 п. 3). */
  readonly auto: boolean;
  /** Строка судится по прогону драйвера нарушителя «ПР» (П7 п. 4). */
  readonly violatorDriver: boolean;
  /** Метка прогона; пусто — прогона нет. */
  readonly run: string;
}

/** Известная причина «нет» или «не проверено», которую пульт на стенде не может снять сам (адрес — STATUS, DECISIONS). */
export interface KnownNote {
  readonly applies: (r: TestRow) => boolean;
  readonly note: Phrase;
}
/** Известные причины. Н-02 — «не проверено»: сбой стенда честным агентом не вызвать (П11, Р-1556); снимается веткой драйвера
 *  после выпуска стенда с Н-02 в `MARKABLE`. Было: Н-08 — «нет» с причиной «ветка «сработало, защитила Платформа» на стенде
 *  недостижима, № 10» (Р-1546, П9 п. 4); снято после кирпича № 10 окна А (`cf35e9e`, Р-1548) — живой Н-08 даёт «да» по этой
 *  ветке (`tests/demo/acc1-n08-live.test.ts`). */
export const KNOWN_NOTES: Partial<Readonly<Record<TestCode, KnownNote>>> = {
  "Н-02": {
    applies: (r) => r.agree === "unchecked",
    note: p(
      "сбой стенда не вызвать честным агентом: второй реквизит выдаётся только на новый запрос по уже выданному заказу, а агент повторяет оплату прежним ключом (инвариант 9 агента); пометку «ПР» по Н-02 стенд не принимает — ветка драйвера после выпуска стенда (П11)",
      'the stand fault cannot be caused by an honest agent: a second credential is issued only for a new request on an already issued order, and the agent repeats a payment with the same key (agent invariant 9); the stand does not accept a violator mark for Н-02 — a driver branch after a stand release (П11)',
    ),
  },
};

const AUTO_LABEL: Phrase = p("эмулятор клиента: авто", "client emulator: auto");
const RECORDS_LABEL: Phrase = p("записи:", "records:");

const joinP = (parts: readonly Phrase[], sep: string): Phrase => p(parts.map((x) => x.ru).join(sep), parts.map((x) => x.en).join(sep));
/** `П-001 (<время>) — закрыто, остановить покупку, до реакции 12 с` — части, которых у записи нет, не пишутся; «до
 *  реакции … с» — подписями панели «Журнал» (`log.react`, `card.sec`), как в `pult.js` (ревью № 1). */
const recText = (x: Acc1Record): Phrase => {
  const parts = [ACC1_STATUS_LABEL[x.status]];
  if (x.action) parts.push(ACC1_ACTION_LABEL[x.action]);
  if (x.reactSec !== undefined) parts.push(joinP([PULT["log.react"], p(`${x.reactSec}`, `${x.reactSec}`), PULT["card.sec"]], " "));
  const head = `${x.id} (${x.at}) —`;
  return joinP([p(head, head), joinP(parts, ", ")], " ");
};
/** Записи — через « · », замечания строки — через «; » (`acc1Rows`): граница замечания и записи видна (ревью № 2). */
const recList = (rs: readonly Acc1Record[]): Phrase => joinP([RECORDS_LABEL, joinP(rs.map(recText), " · ")], " ");
/** Запись относится к строке: задан тест — только к нему; иначе — по объекту прогона (ревью К2 № 3). */
const belongs = (x: Acc1Record, r: TestRow) => (x.test !== undefined ? x.test === r.test : x.obj !== undefined && r.objs.includes(x.obj));

/** Строки акта: по одной на тест, в порядке таблицы. `known` — известные причины (по умолчанию `KNOWN_NOTES`; подмена —
 *  для теста границы замечаний — ревью К8 № 1). */
export function acc1Rows(
  table: TestTable,
  records: readonly Acc1Record[] = [],
  known: Partial<Readonly<Record<TestCode, KnownNote>>> = KNOWN_NOTES,
): Acc1Row[] {
  return table.rows.map((r) => {
    const kn = known[r.test];
    const mine = records.filter((x) => belongs(x, r));
    const notes: Phrase[] = [];
    if (kn?.applies(r)) notes.push(kn.note);
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
export const ACC1_TITLE: Phrase = p("Акт ACC-1 — таблица тестирования пульта (задание v1.1)", "ACC-1 record — console test table (task v1.1)");
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

/** Ячейка Markdown акта: `markdownCell` и сверх того одно правило с двумя ветками (ревью П-4.3 № 3, ревью К2 № 1,
 *  Р-1549, Р-1550; проверено рендером GitHub в абзаце и в ячейке таблицы):
 *  - символ, который является разметкой при разборе, гасится ссылкой на символ: `~` → `&#126;` — по CommonMark ссылка на
 *    символ разметкой не бывает, и `~~s~~` из данных показывается буквально; `<span>` её не гасит: тильда в нём
 *    становится пустым зачёркиванием и пропадает из текста;
 *  - символ, который GitHub достраивает после разбора, гасится `<span>`: `:`, `@`, `$`, `#` и точка после `www` — иначе
 *    ссылка на почту, упоминание, эмодзи, формула, ссылка на задачу или PR (`#16`, `owner/repo#9`), `www.`-ссылка
 *    (`http<span>:</span>//`, `m<span>@</span>e.x`, `<span>#</span>16`, `www<span>.</span>e.x`); у `: @ $` обратная
 *    косая не гасит, у точки после `www` гасит, но `<span>` выбран, чтобы в заменах не было косой.
 *  `#` гасится первым: в ссылке на символ `&#126;`, которую ставит замена тильды, тоже есть `#` (ревью К5 № 4).
 *  `GH-N` и голый хэш коммита GitHub тоже делает ссылками — не гасятся, после MVP (STATUS «Открыто»).
 *  Обратной косой в этих заменах нет: правильность не зависит от того, удвоила ли `markdownCell` косую раньше (CodeQL
 *  `js/incomplete-sanitization`, оповещение № 4). `&#126;` и `<span>` — разметка акта, не данные. */
export function acc1MdCell(s: string): string {
  return markdownCell(s)
    .replace(/#/g, "<span>#</span>")
    .replace(/~/g, "&#126;")
    .replace(/(www)\./gi, "$1<span>.</span>")
    .replace(/[:@$]/g, (c) => `<span>${c}</span>`);
}

/** Заголовок акта: `# ` — разметка акта, текст — через ячейку (ревью К2 № 9, ревью К5 № 2). */
export const acc1MdTitle = (s: string): string => `# ${acc1MdCell(s)}`;

/** Ячейка CSV (RFC 4180): всегда в кавычках, кавычка — удвоением; перевод строки — пробел; начало `= + - @` и табуляция,
 *  в том числе после пробелов, — с апострофом, чтобы таблица не приняла текст за формулу (ревью К2 № 10). */
export function acc1CsvCell(s: string): string {
  const flat = s.replace(/[\r\n]+/g, " ");
  const safe = /^\s*[=+\-@]/.test(flat) || flat.startsWith("\t") ? `'${flat}` : flat;
  return `"${safe.replace(/"/g, '""')}"`;
}

const BUILT_LABEL: Phrase = p("Время сборки:", "Built at:");
const LOCAL_LABEL: Phrase = p("местное:", "local:");
/** Время сборки внутри акта (Р-1553, П8): акт без пульта привязан к моменту, на который посчитана таблица (`TestTable.at`).
 *  UTC — до секунды; местное — по часовому поясу процесса стенда (`timeZone` — для теста), со смещением от UTC. Время не
 *  разбирается `Date`; неразборчивое — пишется как есть. */
export function acc1BuiltAt(at: string, lang: Acc1Lang, timeZone?: string): string {
  const d = new Date(at);
  if (!Number.isFinite(d.getTime())) return `${BUILT_LABEL[lang]} ${at}`;
  const utc = d.toISOString().replace(/\.\d{3}Z$/, "Z");
  const local = new Intl.DateTimeFormat(lang === "ru" ? "ru-RU" : "en-US", {
    ...(timeZone !== undefined && { timeZone }),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    timeZoneName: "shortOffset",
  }).format(d);
  return `${BUILT_LABEL[lang]} ${utc} (UTC) · ${LOCAL_LABEL[lang]} ${local}`;
}

const totalsLine = (t: TestTable, lang: Acc1Lang): string => {
  const s = t.totals;
  return lang === "ru"
    ? `Итого: тестов ${s.tests}, сходится ${s.yes}, не сходится ${s.no}, нет случая ${s.noCase}, не проверено ${s.unchecked}.`
    : `Total: ${s.tests} tests, ${s.yes} agree, ${s.no} do not agree, ${s.noCase} no case, ${s.unchecked} not checked.`;
};

/** Акт ACC-1 в Markdown: заголовок, время сборки, таблица 25 строк, записи без строки теста, итоги, примечание таблицы. */
export function acc1Markdown(table: TestTable, lang: Acc1Lang, records: readonly Acc1Record[] = []): string {
  const line = (xs: readonly string[]) => `| ${xs.map(acc1MdCell).join(" | ")} |`;
  const head = HEAD[lang];
  const out = [acc1MdTitle(ACC1_TITLE[lang]), "", acc1MdCell(acc1BuiltAt(table.at, lang)), "", line(head), `|${head.map(() => "---").join("|")}|`];
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
  // Время сборки — последней строкой, в колонке «Замечание», по образцу записей без теста: первая строка остаётся
  // заголовком колонок (Р-1553, П8; В3 (а)).
  out.push(line(["", "", "", "", "", acc1BuiltAt(table.at, lang), "", ""]));
  return out.join("\r\n") + "\r\n";
}

/** Акт ACC-1 в CSV для машинного чтения: строка заголовка, 25 строк, строка записей без теста (если есть) и строка времени
 *  сборки; разделитель — запятая, без BOM, конец строки — CRLF (RFC 4180). */
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
