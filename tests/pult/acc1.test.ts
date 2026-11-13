// К2 (П-6.2, окно Б; PR #16): акт ACC-1 — строки по таблице тестирования и переданным записям, выгрузка Markdown и CSV.
// Акт ничего не вычисляет (инвариант 2); ячейки — текстом (инвариант 4); ревью П-4.3 № 3 — автоссылки GFM и «~~».
import { describe, expect, it } from "vitest";
import type { Interpretation } from "../../src/dashboards/interpret.js";
import {
  ACC1_ACTION_LABEL,
  ACC1_EXPORT_LABEL,
  ACC1_EXPORTS,
  ACC1_STATUS_LABEL,
  ACC1_TITLE,
  acc1Csv,
  acc1CsvCell,
  acc1CsvExcel,
  acc1Markdown,
  acc1MdCell,
  acc1MdTitle,
  acc1Rows,
  acc1Unlinked,
  KNOWN_NOTES,
  UTF8_BOM,
  type Acc1Record,
} from "../../src/pult/acc1.js";
import { PULT_ACTIONS } from "../../src/pult/actions.js";
import { PULT } from "../../src/pult/phrases.js";
import { PROTO_STATUSES } from "../../src/pult/protocol.js";
import { TABLE_NOTE, TEST_CODES, testTable, type TestRow, type TestTable } from "../../src/pult/testtable.js";
import type { PultTx } from "../../src/pult/tx.js";

const lit = (s: string) => ({ ru: s, en: s });
/** Время появления записи протокола (`ProtoEntry.at`). */
const AT = "2026-11-13T12:00:05.000Z";
const base = testTable({ items: [], model: { mandates: [], txs: [], unattached: [] }, verdicts: [], now: "2026-11-13T12:00:00.000Z" });
/** Таблица с подменёнными строками — акт берёт их как есть. */
const withRows = (patch: Partial<Record<string, Partial<TestRow>>>): TestTable => ({
  ...base,
  rows: base.rows.map((r) => ({ ...r, ...patch[r.test] })),
});
const row = (rs: ReturnType<typeof acc1Rows>, test: string) => rs.find((r) => r.test === test)!;
/** Разбор CSV RFC 4180 (кавычки, удвоенная кавычка, CRLF) — только для проверки. */
function parseCsv(s: string, sep = ","): string[][] {
  const out: string[][] = [];
  let rec: string[] = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (q) {
      if (c === '"' && s[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === sep) {
      rec.push(cell);
      cell = "";
    } else if (c === "\r" && s[i + 1] === "\n") {
      rec.push(cell);
      out.push(rec);
      rec = [];
      cell = "";
      i++;
    } else cell += c;
  }
  return out;
}

describe("К2: строки акта ACC-1", () => {
  it("25 строк по порядку задания; колонки — из таблицы как есть: «сходится», факт, ожидание, «Авто», метка прогона", () => {
    const t = withRows({ "П-01": { agree: "yes", auto: true, run: "run.purchase", fact: lit("TX-1 оплачено") }, "Н-07": { agree: "no" } });
    const rs = acc1Rows(t);
    expect(rs.map((r) => r.test)).toEqual([...TEST_CODES]);
    expect(row(rs, "П-01")).toMatchObject({ agree: "yes", auto: true, run: "run.purchase", fact: lit("TX-1 оплачено") });
    expect(row(rs, "Н-07").agree).toBe("no");
    expect(row(rs, "П-03")).toMatchObject({ agree: "unchecked", run: "" });
  });
  it("инвариант 2: акт не пересчитывает «сходится» — «да» без единого вердикта остаётся «да», «нет» при любом факте остаётся «нет»", () => {
    const rs = acc1Rows(withRows({ "Н-01": { agree: "yes", fact: lit("ожидаемого паспорта нет") }, "П-01": { agree: "no", fact: lit("паспортов нет") } }));
    expect(row(rs, "Н-01").agree).toBe("yes");
    expect(row(rs, "П-01").agree).toBe("no");
  });
  it("записи — к тесту по коду (тогда только к нему) или по объекту прогона (ревью К2 № 3)", () => {
    const t = withRows({ "П-01": { objs: ["T1"] }, "П-02": { objs: ["T1"] } });
    const recs: Acc1Record[] = [
      { id: "П-001", obj: "T1", status: "closed", at: AT },
      { id: "П-002", test: "У-04", obj: "T1", status: "prevented", at: AT },
    ];
    const rs = acc1Rows(t, recs);
    expect(row(rs, "П-01").note.ru).toBe(`записи: П-001 (${AT}) — закрыто`);
    expect(row(rs, "П-02").note.ru).toBe(`записи: П-001 (${AT}) — закрыто`);
    expect(row(rs, "У-04").note.en).toBe(`records: П-002 (${AT}) — pre-empted by a reaction`);
  });
  it("статус и реакция — словами ru/en из словаря пульта, не кодом; время и секунды до реакции — как дал движок (ревью К2 № 4)", () => {
    const t = withRows({ "П-01": { objs: ["T1"] } });
    const recs: Acc1Record[] = [
      { id: "П-001", obj: "T1", status: "reacted", at: AT, action: "stop", reactSec: 12 },
      { id: "П-002", obj: "T1", status: "stopped", at: AT },
    ];
    const n = row(acc1Rows(t, recs), "П-01").note;
    // «до реакции … с» — подписями панели «Журнал»; записи — через « · », замечания — через «; » (ревью № 1, 2)
    expect(n.ru).toBe(`записи: П-001 (${AT}) — отреагировано, остановить покупку, до реакции 12 с · П-002 (${AT}) — остановлено гарантией`);
    expect(n.en).toBe(`records: П-001 (${AT}) — reacted, stop the purchase, to reaction 12 s · П-002 (${AT}) — stopped by a guarantee`);
    expect(n.ru).toContain(`${PULT["log.react"].ru} 12 ${PULT["card.sec"].ru}`);
    // нулевая реакция — тоже пишется (0 — не «нет»)
    expect(row(acc1Rows(t, [{ id: "П-003", obj: "T1", status: "reacted", at: AT, reactSec: 0 }]), "П-01").note.ru).toContain("до реакции 0 с");
    // замечание Н-08 и записи: граница видна — «; » только между замечанием и записями
    const h = row(acc1Rows(withRows({ "Н-08": { agree: "no", driver: "refused", objs: ["T1"] } }), recs), "Н-08").note.ru;
    expect(h.split("; ")).toHaveLength(2);
    expect(h.split("; ")[1]).toMatch(/^записи: П-001 .* · П-002 /);
  });
  it("запись системы (`obj: \"\"`) в строку теста не попадает — уходит в «Записи без строки теста» (ревью № 7)", () => {
    const t = withRows({ "П-01": { objs: ["T1"] } });
    const sys: Acc1Record = { id: "П-004", obj: "", status: "open", at: AT };
    expect(acc1Rows(t, [sys]).map((r) => r.note.ru).join("")).toBe("");
    expect(acc1Unlinked(t, [sys])).toEqual([sys]);
  });
  it("подписи — у каждого статуса движка и каждого вида реакции, ru и en, и это подписи панели «Журнал» (один источник)", () => {
    for (const s of PROTO_STATUSES) {
      expect(ACC1_STATUS_LABEL[s], s).toBe(PULT[`proto.st.${s}`]);
      expect(ACC1_STATUS_LABEL[s].ru, s).not.toBe("");
      expect(ACC1_STATUS_LABEL[s].en, s).not.toBe("");
    }
    for (const a of PULT_ACTIONS) {
      expect(ACC1_ACTION_LABEL[a], a).toBe(PULT[`act.kind.${a}`]);
      expect(ACC1_ACTION_LABEL[a].ru, a).not.toBe("");
      expect(ACC1_ACTION_LABEL[a].en, a).not.toBe("");
    }
    // ru-акт — без кодов статусов и видов реакции (ревью № 7)
    const recs: Acc1Record[] = PROTO_STATUSES.map((s, i) => ({ id: `П-00${i}`, obj: "T1", status: s, at: AT, action: PULT_ACTIONS[i % PULT_ACTIONS.length] }));
    expect(new Set(recs.map((x) => x.action)).size).toBe(PULT_ACTIONS.length);
    const md = acc1Markdown(withRows({ "П-01": { objs: ["T1"] } }), "ru", recs);
    for (const s of [...PROTO_STATUSES, ...PULT_ACTIONS]) expect(md).not.toMatch(new RegExp(`\\b${s}\\b`));
  });
  it("запись по запросу подтверждения (У-04, «Напомнить клиенту» по `cnf_…`) попадает в строку настоящей таблицы (ревью К2 № 2)", () => {
    const at = (s: number) => new Date(Date.UTC(2026, 10, 13, 12, 0, s)).toISOString();
    const item = (seq: number, s: number, ref: string) => ({ seq, at: at(s), stream: "scenario", ref, level: "key", stage: "cart", actor: "agent", emulated: false, kind: "norm", phrase: lit(ref) }) as Interpretation;
    const items = [item(1, 0, "run.upk"), item(2, 1, "cart.created")];
    const tx = { id: "T1", seqs: [2], ops: [], confirmationIds: ["cnf_1"], orderIds: [], opRefs: [], merchantIds: [], shopsByOrder: {}, stage: "confirm", worst: "norm", firstAt: "", lastAt: "" } as unknown as PultTx;
    const t = testTable({ items, model: { mandates: [], txs: [tx], unattached: [] }, verdicts: [], now: at(60) });
    const rs = acc1Rows(t, [{ id: "П-007", obj: "cnf_1", status: "reacted", at: AT, action: "remind" }]);
    expect(row(rs, "У-04").note.ru).toBe(`записи: П-007 (${AT}) — отреагировано, напомнить клиенту`);
  });
  it("записи без строки теста не теряются — отдельной строкой в Markdown и CSV (ревью К2 № 3)", () => {
    const recs: Acc1Record[] = [{ id: "П-009", obj: "SYS", status: "open", at: AT }];
    expect(acc1Unlinked(base, recs)).toEqual(recs);
    expect(acc1Rows(base, recs).map((r) => r.note.ru).join("")).toBe("");
    expect(acc1Markdown(base, "ru", recs)).toContain("Записи без строки теста<span>:</span> записи<span>:</span> П-009 (2026-11-13T12<span>:</span>00<span>:</span>05.000Z) — открыто");
    const csv = parseCsv(acc1Csv(base, "en", recs));
    expect(csv).toHaveLength(27);
    expect(csv[26]![5]).toBe(`Records not linked to a test row: records: П-009 (${AT}) — open`);
  });
  it("Н-08 «нет» при отказе Платформы — замечание с причиной № 10 (Р-1546); «нет» при прошедшей операции, «да», без прогона — без него (ревью К2 № 12)", () => {
    const note = (o: Partial<TestRow>) => row(acc1Rows(withRows({ "Н-08": o })), "Н-08").note;
    expect(note({ agree: "no", driver: "refused" }).ru).toContain("«Расхождения» № 10");
    expect(note({ agree: "no", driver: "refused" }).en).toContain("discrepancy No. 10");
    expect(note({ agree: "no", driver: "marked" }).ru).toBe("");
    expect(note({ agree: "yes", driver: "refused" }).ru).toBe("");
    expect(row(acc1Rows(base), "Н-08").note.ru).toBe("");
    for (const k of Object.keys(KNOWN_NOTES)) expect(TEST_CODES as readonly string[]).toContain(k);
  });
  it("пометки в выгрузке: «Авто» (П5 п. 3) и «нарушитель (ПР) — драйвер приложения» (П7 п. 4) — в Markdown и CSV (ревью К2 № 5)", () => {
    const t = withRows({ "П-01": { auto: true }, "Н-07": { driver: "marked", run: "run.fault Н-07" } });
    for (const lang of ["ru", "en"] as const) {
      const csv = parseCsv(acc1Csv(t, lang));
      const p01 = csv.find((r) => r[0] === "П-01")!;
      const n07 = csv.find((r) => r[0] === "Н-07")!;
      expect(p01[6]).toBe(lang === "ru" ? "эмулятор клиента: авто" : "client emulator: auto");
      expect(n07[6]).toBe(lang === "ru" ? "нарушитель (ПР) — драйвер приложения" : "violator (ПР) — app driver");
      expect(csv.find((r) => r[0] === "П-02")![6]).toBe("");
      const md = acc1Markdown(t, lang).split("\n");
      expect(md.find((l) => l.startsWith("| П-01 "))).toContain(lang === "ru" ? "эмулятор клиента<span>:</span> авто" : "client emulator<span>:</span> auto");
      expect(md.find((l) => l.startsWith("| Н-07 "))).toContain(lang === "ru" ? "нарушитель (ПР)" : "violator (ПР)");
    }
  });
});

describe("К2: ячейка Markdown — текстом (инвариант 4; ревью П-4.3 № 3)", () => {
  it("разметка, HTML, автоссылки, упоминания, эмодзи, формулы и зачёркивание не срабатывают (ревью К2 № 1)", () => {
    const s = acc1MdCell("a|b\n<b>x</b> `c` [l](u) *e* _i_ ~~s~~ http://e.x www.e.x m@e.x mailto:m@e.x @octocat :smile: $x^2$");
    expect(s).not.toMatch(/(^|[^\\])\|/);
    expect(s).not.toContain("\n");
    expect(s).not.toContain("<b>");
    expect(s).toContain("http<span>:</span>//e.x");
    expect(s).toContain("m<span>@</span>e.x");
    expect(s).toContain("www<span>.</span>e.x");
    expect(s).not.toMatch(/www\./i);
    // вне разрывающего `<span>` нет ни одного `: @ $`
    expect(s.replace(/<span>[:@$]<\/span>/g, "")).not.toMatch(/[:@$]/);
    expect(s).not.toMatch(/(^|[^\\])[`*_[\]]/);
    // тильда — только ссылкой на символ: `<span>` и обратная косая её не гасят (Р-1550, рендер GitHub)
    expect(s).toContain("&#126;&#126;s&#126;&#126;");
    expect(s).not.toContain("~");
  });
  it("обратная косая в данных не снимает экранирование: «\\~» → «\\\\&#126;» (ревью К2 № 8)", () => {
    expect(acc1MdCell("\\~")).toBe("\\\\&#126;");
    expect(acc1MdCell("\\@")).toBe("\\\\<span>@</span>");
    expect(acc1MdCell("\\www.e")).toBe("\\\\www<span>.</span>e");
  });
  it("`#` — обёрткой: `#16`, `owner/repo#9` не станут ссылками на PR; тильда рядом — по-прежнему `&#126;`, не испорчена (ревью К5 № 4, Р-1550)", () => {
    expect(acc1MdCell("PR #16, kuzin4u/agentic-buyer-app#9")).toBe("PR <span>#</span>16, kuzin4u/agentic-buyer-app<span>#</span>9");
    expect(acc1MdCell("#1~")).toBe("<span>#</span>1&#126;");
    // точным сравнением: порядок замен (`#` раньше тильды) держит и эта строка (ревью К7 № 2)
    expect(acc1MdCell("a#b ~ ##")).toBe("a<span>#</span>b &#126; <span>#</span><span>#</span>");
    // в замечании акта — тоже: запись с номером PR в данных
    const md = acc1Markdown(withRows({ "П-01": { fact: lit("см. #16 :#9") } }), "ru");
    expect(md).toContain("см. <span>#</span>16 <span>:</span><span>#</span>9");
    // вне обёрток, ссылок на символ и `# ` заголовка решёток нет (ревью К7 № 3)
    expect(md.replace(/^# /, "").replace(/<span>#<\/span>|&#126;/g, "")).not.toContain("#");
  });
  it("в заменах сверх `markdownCell` нет обратной косой: тильда и `www.` не зависят от удвоения косой (Р-1549, CodeQL № 4)", () => {
    expect(acc1MdCell("~ www.e WWW.E")).toBe("&#126; www<span>.</span>e WWW<span>.</span>E");
    // данные со своей ссылкой на символ остаются текстом: `&` гасит `markdownCell`
    // (с К7 `#` данных — тоже в `<span>`; рендер GitHub — «&#126;» буквально)
    expect(acc1MdCell("&#126;")).toBe("&amp;<span>#</span>126;");
  });
  it("акт: заголовок, 25 строк по 8 колонок, итоги и примечание — ru и en; данные с «|» и переводом строки таблицу не ломают", () => {
    const t = withRows({ "П-01": { fact: lit("T|1\n<b> http://e ~~x~~") } });
    for (const lang of ["ru", "en"] as const) {
      const md = acc1Markdown(t, lang).split("\n");
      expect(md[0]).toMatch(lang === "ru" ? /^# Акт ACC-1/ : /^# ACC-1 record/);
      const rows = md.filter((l) => /^\| [ПНУ]-\d\d /.test(l));
      expect(rows).toHaveLength(25);
      for (const l of rows) expect(l.replace(/\\\|/g, "").split("|").length - 2, l).toBe(8);
      expect(md.join("\n")).not.toContain("<b>");
      expect(md.join("\n")).not.toContain("://");
      expect(md.some((l) => l.startsWith(lang === "ru" ? "Итого<span>:</span> тестов 25" : "Total<span>:</span> 25 tests"))).toBe(true);
      // заголовок и примечание — тоже через ячейку (ревью К2 № 9)
      // с исходной фразой, не с выводом; что заголовок идёт через ячейку — на фразе со спецсимволами (ревью К5 № 2)
      expect(md[0]).toBe(acc1MdTitle(ACC1_TITLE[lang]));
      expect(acc1MdTitle("a:#1 ~")).toBe("# a<span>:</span><span>#</span>1 &#126;");
      expect(md[md.length - 1]).toBe(acc1MdCell(TABLE_NOTE[lang]));
    }
  });
  it("en-акт — без «ёлочек» и без «pult» (ревью К2 № 6, 7; правило совместимости 3)", () => {
    const en = acc1Markdown(withRows({ "Н-08": { agree: "no", driver: "refused" } }), "en");
    expect(en).not.toMatch(/[«»]/);
    expect(en).not.toMatch(/pult/i);
    expect(en).toMatch(/console/i);
  });
});

describe("К3: CSV для Excel — UTF-8 с BOM и «;» (решение владельца 13.11)", () => {
  it("начинается с BOM, поля через «;», 26 строк по 8 полей; машинный CSV — без BOM и через запятую", () => {
    const t = withRows({ "П-01": { fact: lit("a; b, c") }, "П-02": { fact: lit("=1+1") } });
    for (const lang of ["ru", "en"] as const) {
      const xl = acc1CsvExcel(t, lang);
      expect(parseCsv(xl.slice(1), ";")[2]![3]).toBe("'=1+1"); // защита от формул — и в выгрузке для Excel (ревью К3 № 3)
      expect(xl.startsWith(UTF8_BOM)).toBe(true);
      expect(Buffer.from(xl, "utf8").subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
      const recs = parseCsv(xl.slice(1), ";");
      expect(recs).toHaveLength(26);
      for (const r of recs) expect(r).toHaveLength(8);
      expect(recs[1]![3]).toBe("a; b, c");
      expect(recs[0]![0]).toBe(lang === "ru" ? "№ теста" : "Test No.");
      const plain = acc1Csv(t, lang);
      expect(plain.startsWith(UTF8_BOM)).toBe(false);
      expect(parseCsv(plain)[0]).toHaveLength(8);
      // та же таблица — те же ячейки
      expect(parseCsv(plain)).toEqual(recs);
    }
  });
  it("подписи выгрузок для кнопок «Отчёта» — у каждой ru и en", () => {
    for (const k of ACC1_EXPORTS) {
      expect(ACC1_EXPORT_LABEL[k].ru, k).not.toBe("");
      expect(ACC1_EXPORT_LABEL[k].en, k).not.toBe("");
    }
    expect(ACC1_EXPORT_LABEL.csv_excel.ru).toBe("CSV для Excel");
  });
});

describe("К2: CSV (RFC 4180)", () => {
  it("заголовок и 25 строк по 8 полей, CRLF; кавычка — удвоением, перевод строки — пробелом, запятая — внутри поля", () => {
    const t = withRows({ "П-01": { fact: lit('a "q", b\nc'), run: "run.purchase" } });
    for (const lang of ["ru", "en"] as const) {
      const csv = acc1Csv(t, lang);
      expect(csv.endsWith("\r\n")).toBe(true);
      const recs = parseCsv(csv);
      expect(recs).toHaveLength(26);
      for (const r of recs) expect(r).toHaveLength(8);
      expect(recs[0]![0]).toBe(lang === "ru" ? "№ теста" : "Test No.");
      expect(recs[1]).toMatchObject({ 0: "П-01", 3: 'a "q", b c', 7: "run.purchase" });
    }
  });
  it("начало ячейки «= + - @» и табуляция — с апострофом: таблица не примет текст за формулу", () => {
    for (const s of ["=1+1", "+cmd", "-2", "@SUM(A1)", "\tx", " =1+1"]) expect(acc1CsvCell(s)).toBe(`"'${s}"`);
    // перевод строки в начале — пробел, и апостроф всё равно ставится (ревью К2 № 10)
    expect(acc1CsvCell("\n=1")).toBe(`"' =1"`);
    expect(acc1CsvCell("\r=1")).toBe(`"' =1"`);
    expect(acc1CsvCell("a=1")).toBe('"a=1"');
    const recs = parseCsv(acc1Csv(withRows({ "П-01": { fact: lit("=HYPERLINK(\"x\")") } }), "ru"));
    expect(recs[1]![3]).toBe('\'=HYPERLINK("x")');
  });
});
