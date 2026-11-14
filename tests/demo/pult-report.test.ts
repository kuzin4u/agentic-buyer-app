// П-6.2 (Р-1552): «Отчёт» пульта — ответ маршрута `GET /pult/report` по снимку ленты (форматы, файлы выгрузки, отказы) и
// живая контрольная точка ROADMAP: на сюжетах 1–5 отчёт сходится с «Контролем» К2.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { reportResponse, REPORT_FORMATS, routeReport } from "../../src/demo/pult-report.js";
import { startDemo, type Demo } from "../../src/demo/run.js";
import { acc1BuiltAt, ACC1_EXPORTS, acc1Markdown, acc1MdCell, ACC1_TITLE, UTF8_BOM } from "../../src/pult/acc1.js";
import type { PultReport } from "../../src/pult/feed.js";
import { testTable } from "../../src/pult/testtable.js";
import { buildTxModel } from "../../src/pult/tx.js";
import { driver } from "./drive.js";

const BUILT = "2026-11-13T20:55:07.000Z";
const empty = (): PultReport => ({ builtAt: BUILT, table: testTable({ items: [], model: buildTxModel([]), verdicts: [], now: BUILT }), records: [] });

describe("«Отчёт»: ответ маршрута по снимку (П-6.2)", () => {
  it("перечень форматов — json и три выгрузки окна Б как есть; неизвестный формат — 400; движок не отработал — 409", () => {
    expect(REPORT_FORMATS).toEqual(["json", ...ACC1_EXPORTS]);
    expect(reportResponse(empty(), "pdf", "ru")).toMatchObject({ status: 400 });
    expect(reportResponse(empty(), null, "ru")).toMatchObject({ status: 400 });
    expect(reportResponse(undefined, "json", "ru")).toMatchObject({ status: 409, body: JSON.stringify({ error: "NO_ENGINE" }) });
  });

  it("json — время сборки, итоги, 25 строк акта с подписью «сходится»; без имени файла", () => {
    const r = reportResponse(empty(), "json", "ru");
    expect(r.status).toBe(200);
    expect(r.filename).toBeUndefined();
    const b = JSON.parse(r.body) as { builtAt: string; totals: { tests: number }; rows: { agreeLabel: { ru: string } }[]; agreeLabels: object };
    expect(b.builtAt).toBe(BUILT);
    expect(b.totals.tests).toBe(25);
    expect(b.rows).toHaveLength(25);
    expect(b.rows[0]!.agreeLabel.ru).toBeTruthy();
    expect(b.agreeLabels).toBeDefined();
  });

  it("выгрузки — файлом, тексты окна Б как есть (Markdown — `acc1Markdown`, CSV — 27 строк с временем сборки, CSV для Excel — с BOM), имя и время в тексте — по времени сборки (Р-1553)", () => {
    const rep = empty();
    const md = reportResponse(rep, "md", "en");
    expect(md).toMatchObject({ status: 200, type: "text/markdown; charset=utf-8", filename: "acc1-2026-11-13T20-55-en.md" });
    expect(md.body).toBe(acc1Markdown(rep.table, "en", rep.records));
    expect(md.body).toContain(ACC1_TITLE.en);
    // время сборки внутри акта — то же, что `builtAt` отчёта (одно «сейчас» на отчёт)
    expect(md.body).toContain(acc1MdCell(acc1BuiltAt(BUILT, "en")));
    const csv = reportResponse(rep, "csv", "ru");
    expect(csv).toMatchObject({ type: "text/csv; charset=utf-8", filename: "acc1-2026-11-13T20-55-ru.csv" });
    expect(csv.body.trimEnd().split("\r\n")).toHaveLength(27);
    expect(csv.body).toContain("Время сборки: 2026-11-13T20:55:07Z (UTC)");
    const xl = reportResponse(rep, "csv_excel", "ru");
    expect(xl.filename).toBe("acc1-2026-11-13T20-55-ru-excel.csv");
    expect(xl.body.startsWith(UTF8_BOM)).toBe(true);
  });
});

describe("П13 (Р-1558): выгрузка отдаёт показанный снимок, а не собирает новый", () => {
  /** Лента с часами: каждый `report()` — новый снимок со своим временем; `reportAt` — как у настоящей ленты. */
  const feedOf = () => {
    let n = 0;
    let last: PultReport | undefined;
    return {
      report: () => {
        const builtAt = new Date(Date.UTC(2026, 10, 14, 16, 40, n++)).toISOString();
        last = { builtAt, table: testTable({ items: [], model: buildTxModel([]), verdicts: [], now: builtAt }), records: [] };
        return last;
      },
      reportAt: (at: string) => (last !== undefined && last.builtAt === at ? last : undefined),
    };
  };

  it("json — собрать снимок; md, csv, csv для Excel по `at` показанного — время сборки внутри акта то же, что на экране", () => {
    const f = feedOf();
    const shown = JSON.parse(routeReport(f, "json", null, "ru").body) as { builtAt: string };
    for (const fmt of ACC1_EXPORTS) {
      const r = routeReport(f, fmt, shown.builtAt, "ru");
      expect(r.status, fmt).toBe(200);
      const line = acc1BuiltAt(shown.builtAt, "ru");
      expect(r.body, fmt).toContain(fmt === "md" ? acc1MdCell(line) : line);
    }
  });

  it("`at` нет — 400 NO_SNAPSHOT; собран новый — выгрузка прежнего 409 SNAPSHOT_GONE; неизвестный формат — 400 BAD_FORMAT, снимок не собирается", () => {
    const f = feedOf();
    const first = JSON.parse(routeReport(f, "json", null, "ru").body) as { builtAt: string };
    expect(routeReport(f, "md", null, "ru")).toMatchObject({ status: 400, body: JSON.stringify({ error: "NO_SNAPSHOT" }) });
    expect(routeReport(f, "md", "", "ru")).toMatchObject({ status: 400 });
    routeReport(f, "json", null, "ru");
    expect(routeReport(f, "csv", first.builtAt, "ru")).toMatchObject({ status: 409, body: JSON.stringify({ error: "SNAPSHOT_GONE" }) });
    expect(routeReport(f, "pdf", first.builtAt, "ru")).toMatchObject({ status: 400, body: JSON.stringify({ error: "BAD_FORMAT" }) });
  });

  it("поломка С3 по смыслу: выгрузка, собравшая новый снимок, дала бы другое время — здесь его нет", () => {
    const f = feedOf();
    const shown = JSON.parse(routeReport(f, "json", null, "ru").body) as { builtAt: string };
    const md = routeReport(f, "md", shown.builtAt, "en").body;
    // ещё одна выгрузка — тот же снимок, то же время: новый не собирался
    expect(routeReport(f, "md", shown.builtAt, "en").body).toBe(md);
  });
});

describe("«Отчёт» на живом стенде: сюжеты 1–5 сходятся с «Контролем» К2 (контрольная точка ROADMAP П-6.2)", { timeout: 300_000 }, () => {
  let demo: Demo;
  beforeAll(async () => {
    demo = await startDemo();
  }, 60_000);
  afterAll(async () => {
    await demo?.close();
  });

  /** Первое сообщение ленты «Контроля» со списком прогонов. */
  async function runs(): Promise<{ name: string; result?: { state: string } }[]> {
    const res = await fetch(`${demo.monitor.url}/dash/control/events`);
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) throw new Error("лента закрыта");
      buf += dec.decode(value, { stream: true });
      for (const block of buf.split("\n\n").slice(0, -1)) {
        const line = block.split("\n").find((l) => l.startsWith("data: "));
        const e = line ? (JSON.parse(line.slice(6)) as { type?: string; runs?: { name: string; result?: { state: string } }[] }) : undefined;
        if (e?.type === "runs" && e.runs) {
          await reader.cancel();
          return e.runs;
        }
      }
    }
  }

  it("прогоны 1–5: «Контроль» К2 — «принято»; в отчёте П-01 (2), П-05 (3), П-02 (4), П-08 (5) — «да»", async () => {
    for (const no of [1, 2, 3, 4, 5] as const) await driver(demo).run(no);
    // Срок паспорта К2 — 15 с после последней записи прогона: ждём, пока все пять станут «принято» или «отклонено».
    let rs: Awaited<ReturnType<typeof runs>> = [];
    for (const end = Date.now() + 60_000; Date.now() < end; await new Promise((r) => setTimeout(r, 1_000))) {
      rs = await runs();
      if (rs.length >= 5 && rs.slice(-5).every((r) => r.result && r.result.state !== "waiting")) break;
    }
    expect(rs.slice(-5).map((r) => [r.name, r.result?.state])).toEqual(rs.slice(-5).map((r) => [r.name, "accepted"]));
    const rep = await fetch(`${demo.monitor.url}/pult/report?format=json&lang=ru`);
    expect(rep.status).toBe(200);
    const body = (await rep.json()) as { builtAt: string; totals: { no: number }; unlinked: number; rows: { test: string; agree: string }[] };
    expect(Number.isFinite(Date.parse(body.builtAt))).toBe(true);
    const agree = Object.fromEntries(body.rows.map((r) => [r.test, r.agree]));
    expect([agree["П-01"], agree["П-05"], agree["П-02"], agree["П-08"]]).toEqual(["yes", "yes", "yes", "yes"]);
    // Ложного «нет» нет (ревью П-6.2 № 2): ситуация У-01…У-04 (ожидание оператора, «Напомнить») в прогоне без оператора не
    // возникла — «не проверено», а не «нет» (Р-1553, П8).
    expect(body.totals.no).toBe(0);
    expect(body.rows.filter((r) => r.test.startsWith("У-")).map((r) => r.agree)).toEqual(["unchecked", "unchecked", "unchecked", "unchecked"]);
    expect(typeof body.unlinked).toBe("number");
    // Выгрузка — файлом, заголовки — общие (CSP, nosniff, no-store; ревью № 3). П13: показанный снимок — по `at`.
    const at = encodeURIComponent(body.builtAt);
    const md = await fetch(`${demo.monitor.url}/pult/report?format=md&lang=ru&at=${at}`);
    expect(md.headers.get("content-disposition")).toMatch(/^attachment; filename="acc1-.*-ru\.md"$/);
    expect(md.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    expect(md.headers.get("x-content-type-options")).toBe("nosniff");
    expect(md.headers.get("content-security-policy")).toBeTruthy();
    expect(md.headers.get("cache-control")).toBe("no-store");
    const mdText = await md.text();
    expect(mdText).toContain(ACC1_TITLE.ru);
    // время сборки — внутри текста выгрузки (Р-1553, П8) и то же, что показано на экране (П13, контрольная точка).
    // Время в акте — до секунды: пересборку в ту же секунду эта сверка не отличит — её ловит 409 ниже и unit-тест с шагом
    // часов в 1 с (ревью Х4б № 3).
    expect(mdText.split("\n")[2]).toContain(body.builtAt.replace(/\.\d{3}Z$/, "Z").replace(/:/g, "<span>:</span>"));
    const xl = await fetch(`${demo.monitor.url}/pult/report?format=csv_excel&lang=en&at=${at}`);
    expect(xl.headers.get("content-disposition")).toMatch(/-en-excel\.csv"$/);
    expect(await xl.text()).toContain(`Built at: ${body.builtAt.replace(/\.\d{3}Z$/, "Z")} (UTC)`);
    // без `at` — 400; новый снимок — прежний 409 (П13)
    expect((await fetch(`${demo.monitor.url}/pult/report?format=md`)).status).toBe(400);
    await fetch(`${demo.monitor.url}/pult/report?format=json`);
    expect((await fetch(`${demo.monitor.url}/pult/report?format=md&at=${at}`)).status).toBe(409);
    // Коды через маршрут: неизвестный формат — 400; json — без вложения.
    expect((await fetch(`${demo.monitor.url}/pult/report?format=pdf`)).status).toBe(400);
    expect((await fetch(`${demo.monitor.url}/pult/report?format=json`)).headers.get("content-disposition")).toBeNull();
  });
});
