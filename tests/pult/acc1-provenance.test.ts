// Провенанс нажатия в акте ACC-1 (П26, Б5 № 1 вариант (б)): признак «кто нажал» живёт в данных нажатия — в записи журнала
// реакций (`Reaction.by`), а не в параметре сборки акта. Проверяется путь целиком: нажатие с признаком → журнал реакций →
// строки оператора У-01…У-04 в акте и в ответе экрана «Отчёт». Отдельный файл — чтобы не пересекаться с `tests/pult/acc1.test.ts`,
// где ожидания числа записей правит окно А (кирпич К3.1).
import { describe, expect, it } from "vitest";
import { acc1Csv, acc1Markdown, acc1Rows } from "../../src/pult/acc1.js";
import { reportResponse, routeReport } from "../../src/demo/pult-report.js";
import { createActProvenance, pultAct } from "../../src/demo/pult-act.js";
import type { PultActions } from "../../src/pult/actions.js";
import type { TestRow, TestTable } from "../../src/pult/testtable.js";

const p = (ru: string, en: string) => ({ ru, en });
/** Пометка провенанса — та же, что была у параметра сборки (`OPERATOR_BY_TEST_LABEL` в `acc1.ts`). */
const MARK = "роль оператора играл тест";
const row = (test: TestRow["test"], o: Partial<TestRow> = {}): TestRow => ({
  test,
  kind: "toward",
  expected: p("ожидание", "expected"),
  fact: p("факт", "fact"),
  agree: "yes",
  auto: false,
  run: "run.intent 1/1",
  objs: [],
  ...o,
});
const table = (rows: readonly TestRow[]): TestTable => ({
  at: "2026-11-16T12:00:00.000Z",
  rows: [...rows],
  totals: { tests: rows.length, yes: rows.length, no: 0, noCase: 0, unchecked: 0 },
});

describe("провенанс нажатия в акте ACC-1 (П26)", () => {
  it("липкий признак прогона: нажатие теста поднимает его, нажатие человека не снимает, окно журнала реакций не теряет", () => {
    const pr = createActProvenance();
    expect(pr.byTest()).toBe(false);
    // Нажатия человека пометки не дают: это обычная ручная приёмка.
    pr.press("operator");
    pr.press("operator");
    expect(pr.byTest()).toBe(false);
    // Нажал тест — признак прогона поднят.
    pr.press("test");
    expect(pr.byTest()).toBe(true);
    // И не снимается: прогон, в котором нажимал тест, остаётся прогоном с тестом, сколько бы человек ни нажимал после.
    for (let i = 0; i < 100; i++) pr.press("operator");
    expect(pr.byTest()).toBe(true);
  });

  it("пометка — только у строк оператора с прогоном, и в выгрузках акта", () => {
    const t = table([row("У-01"), row("У-04", { kind: "prevented" }), row("У-02", { run: undefined }), row("П-01", { kind: "correct" })]);
    const rows = acc1Rows(t, [], { operatorByTest: true });
    const mark = Object.fromEntries(rows.map((r) => [r.test, r.operatorByTest]));
    // У-01 и У-04 — строки оператора с прогоном; У-02 без прогона — тест оператора не играл; П-01 — не строка оператора.
    expect(mark).toEqual({ "У-01": true, "У-04": true, "У-02": false, "П-01": false });
    // Без признака — пометки нет ни у одной строки (ручная приёмка владельца).
    expect(acc1Rows(t, [], {}).every((r) => !r.operatorByTest)).toBe(true);
    // В выгрузках пометка видна словами, в ru и en.
    const md = acc1Markdown(t, "ru", [], { operatorByTest: true });
    expect(md).toContain(MARK);
    expect(acc1Markdown(t, "en", [], { operatorByTest: true })).toContain("the operator's role was played by a test");
    expect(acc1Csv(t, "ru", [], { operatorByTest: true })).toContain(MARK);
    // Акт без признака пометку не несёт — иначе ручная приёмка выглядела бы автоматическим прогоном.
    expect(acc1Markdown(t, "ru", [], {})).not.toContain(MARK);
  });

  it("экран «Отчёт» и выгрузки говорят одно и то же (`reportResponse`)", () => {
    const report = { no: 11, table: table([row("У-01")]), records: [], builtAt: "2026-11-16T12:00:00.000Z" };
    const json = JSON.parse(reportResponse(report, "json", "ru", true).body) as { rows: { operatorByTest: boolean }[] };
    expect(json.rows[0]!.operatorByTest).toBe(true);
    const human = JSON.parse(reportResponse(report, "json", "ru", false).body) as { rows: { operatorByTest: boolean }[] };
    expect(human.rows[0]!.operatorByTest).toBe(false);
    // Выгрузка — тем же путём: экран и файл акта говорят одно и то же (правило приёмки Х4б).
    expect(reportResponse(report, "md", "ru", true).body).toContain(MARK);
    expect(reportResponse(report, "md", "ru", false).body).not.toContain(MARK);
    expect(reportResponse(report, "md", "ru").body).not.toContain(MARK);
  });

  it("рабочий путь целиком: нажатие с признаком → липкий провенанс прогона → снимок отчёта → выгрузка акта", async () => {
    const provenance = createActProvenance();
    const at = "2026-11-16T12:00:00.000Z";
    // Опознаватель снимка — его **номер** строкой, не время сборки (К2.1, перечень сверки PR #20, п. 1): тем же токеном
    // снимок ищет лента, им же провенанс сличает показанный снимок. Номер и время — разные значения разных сущностей.
    const snapId = "12";
    const report = { no: Number(snapId), table: table([row("У-01")]), records: [], builtAt: at };
    const feed = { report: () => report, reportAt: (x: string) => (x === snapId ? report : undefined), react: () => undefined };
    const actions: PultActions = {
      stopPurchase: async () => ({ ok: true }),
      remindClient: async () => ({ ok: true }),
      revokeMandate: async () => ({ ok: true }),
      sendToReview: async () => ({ ok: true }),
    };
    const show = () => routeReport(feed, "json", null, "ru", provenance);
    const download = () => routeReport(feed, "md", snapId, "ru", provenance);
    const pressRoute = (by: string) =>
      pultAct("remind", new URLSearchParams({ confirmation: "CNF-1", by }), actions, feed, () => new Date(at), { faults: true, provenance });

    // Нажимал человек — ни на экране, ни в файле пометки нет.
    await pressRoute("operator");
    expect(JSON.parse(show().body).rows[0].operatorByTest).toBe(false);
    expect(download().body).not.toContain(MARK);

    // Нажал тест — признак прогона поднят, снимок собран после него: пометка и на экране, и в файле.
    await pressRoute("test");
    expect(JSON.parse(show().body).rows[0].operatorByTest).toBe(true);
    expect(download().body).toContain(MARK);

    // Нажатие человека признак не снимает: прогон, в котором нажимал тест, остаётся прогоном с тестом.
    await pressRoute("operator");
    expect(JSON.parse(show().body).rows[0].operatorByTest).toBe(true);

    // Окно журнала реакций ленты признак не теряет: он не считается по нажатиям (блокер Б1 ревью Б-К4).
    expect(provenance.byTest()).toBe(true);
  });

  it("выгрузка отдаёт провенанс показанного снимка, а не нынешний (П13, Х4б)", async () => {
    const provenance = createActProvenance();
    const at = "2026-11-16T12:00:00.000Z";
    // Снимок опознаётся номером (К2.1): по времени сборки сравнение в `byTestAt` шло бы «номер против времени» и всегда
    // промахивалось — провенанс показанного снимка молча подменялся бы нынешним, то есть возвращался блокер Б1.
    const snapId = "13";
    const report = { no: Number(snapId), table: table([row("У-01")]), records: [], builtAt: at };
    const feed = { report: () => report, reportAt: (x: string) => (x === snapId ? report : undefined), react: () => undefined };
    const actions: PultActions = {
      stopPurchase: async () => ({ ok: true }),
      remindClient: async () => ({ ok: true }),
      revokeMandate: async () => ({ ok: true }),
      sendToReview: async () => ({ ok: true }),
    };
    // Снимок собран и показан в ручном прогоне — пометки на экране не было.
    expect(JSON.parse(routeReport(feed, "json", null, "ru", provenance).body).rows[0].operatorByTest).toBe(false);
    // Затем на том же стенде нажал тест — но подписанный акт тот, что владелец смотрел: задним числом он не помечается.
    await pultAct("remind", new URLSearchParams({ confirmation: "CNF-1", by: "test" }), actions, feed, () => new Date(at), { faults: true, provenance });
    expect(routeReport(feed, "md", snapId, "ru", provenance).body).not.toContain(MARK);
    // Собрали заново — провенанс нынешний, пометка появляется и на экране, и в файле.
    expect(JSON.parse(routeReport(feed, "json", null, "ru", provenance).body).rows[0].operatorByTest).toBe(true);
    expect(routeReport(feed, "md", snapId, "ru", provenance).body).toContain(MARK);
  });
});
