// П-11.5а: модель таблицы тестирования пульта — 25 тестов задания v1.1 ↔ вердикты и паспорта ↔ ожидания на стенде (столбец
// M; Р-1533, Р-1534, Р-1538; решение владельца 13.11 — PR #16, К1). Отрицательные сценарии — находки ревью № 1–8, 12 (ложное
// «да» и вечное «нет»), каждый — поломкой по С3.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createInterpretFeed, type InterpretFeed } from "../../src/dashboards/feed.js";
import { LOCAL_STAND_EMULATED, type Interpretation } from "../../src/dashboards/interpret.js";
import { localStandSource } from "../../src/dashboards/source.js";
import { NOT_REPRODUCIBLE_LABEL, STAND_TEST_TABLE } from "../../src/dashboards/stand-tests.js";
import { FAULT_TESTS } from "../../src/demo/fault-tests.js";
import { startDemo, type Demo } from "../../src/demo/run.js";
import { MORE_SCENARIOS, RUN_STEP } from "../../src/demo/scenarios.js";
import { evaluate } from "../../src/pult/engine.js";
import { STAND_LOG_WHAT, STAND_TESTS, type StandLogEntry } from "../../src/pult/standlog.js";
import {
  FAULT_WHAT,
  TEST_CODES,
  TEST_SCENARIO,
  TEST_SPECS,
  testTable,
  testTableMarkdown,
  type TableReaction,
  type TestCode,
  type TestTable,
  type TestTableInput,
} from "../../src/pult/testtable.js";
import { buildTxModel, type PultTx, type TxModel } from "../../src/pult/tx.js";
import { verdicts, type Verdict } from "../../src/pult/verdict.js";

const T0 = Date.UTC(2026, 10, 12, 12, 0, 0);
const at = (sec: number) => new Date(T0 + sec * 1000).toISOString();
const rec = (seq: number, sec: number, ref: string, o: Partial<Interpretation> = {}): Interpretation =>
  ({ seq, at: at(sec), stream: "scenario", ref, level: "key", stage: "mandate", actor: "agent", emulated: false, kind: "norm", phrase: { ru: ref, en: ref }, ...o }) as Interpretation;
const tx = (id: string, seqs: number[], o: Partial<PultTx> = {}): PultTx =>
  ({ id, seqs, ops: [], confirmationIds: [], orderIds: [], opRefs: [], merchantIds: [], shopsByOrder: {}, stage: "outcome", worst: "norm", firstAt: "", lastAt: "", ...o }) as PultTx;
const modelOf = (txs: PultTx[]): TxModel => ({ mandates: [], txs, unattached: [] });
const paid = (seq: number, sec = 0) => ({ outcome: { kind: "paid" as const, seq, at: at(sec) } });
const log = (seq: number, sec: number, what: StandLogEntry["what"], o: Partial<StandLogEntry> = {}): StandLogEntry => ({ seq, at: at(sec), kind: "fault", what, ids: {}, ...o });
const NOW = at(600);
const table = (o: Partial<TestTableInput> & Pick<TestTableInput, "items">) => testTable({ model: modelOf([]), verdicts: [], now: NOW, ...o });
const row = (t: TestTable, c: TestCode) => t.rows.find((r) => r.test === c)!;

describe("П-11.5а: перечни — из кода источника (Р-1511, Р-1534 В2)", () => {
  it("25 строк по порядку задания; Н-xx — тесты стенда; виды по коду", () => {
    expect(TEST_SPECS.map((s) => s.test)).toEqual([...TEST_CODES]);
    expect(TEST_CODES.filter((c) => c.startsWith("Н-"))).toEqual([...STAND_TESTS]);
    expect(STAND_TEST_TABLE.map((r) => r.test)).toEqual([...STAND_TESTS]);
    const kindOf = (c: string) => (c.startsWith("П-") ? "correct" : c.startsWith("Н-") ? "incorrect" : c === "У-04" ? "prevented" : "toward");
    for (const s of TEST_SPECS) expect(s.kind, s.test).toBe(kindOf(s.test));
  });
  it("тест → сюжет: номер сюжета демо-стенда по порядку `RUN_STEP` (1–10); сюжеты 6–10 — `MORE_SCENARIOS` (ревью № 10)", () => {
    const order = Object.keys(RUN_STEP);
    expect(order.slice(5)).toEqual(MORE_SCENARIOS.map((s) => s.name));
    // Номера сюжетов — `scenarios.ts` (комментарий у `ScenarioName`): П-01 — 2, П-02 — 4, П-03…П-09 — 6, 7, 3, 8, 9, 5, 10.
    const NO: Record<keyof typeof TEST_SCENARIO, number> = { "П-01": 2, "П-02": 4, "П-03": 6, "П-04": 7, "П-05": 3, "П-06": 8, "П-07": 9, "П-08": 5, "П-09": 10, "У-01": 1, "У-02": 2, "У-03": 4, "У-04": 4 };
    for (const [c, n] of Object.entries(NO)) expect(TEST_SCENARIO[c as keyof typeof NO], c).toBe(order[n - 1]);
    for (const c of TEST_CODES.filter((x) => !x.startsWith("Н-"))) expect(Object.values(RUN_STEP)).toContain(`run.${TEST_SCENARIO[c as keyof typeof TEST_SCENARIO]}`);
  });
  it("«ПР» — перечень драйвера; «П» — коды журнала стенда", () => {
    const violator = STAND_TEST_TABLE.filter((r) => r.kind === "violator" || r.kind === "stand_fault_and_violator").map((r) => r.test);
    expect(violator).toEqual([...FAULT_TESTS]);
    const standFault = STAND_TEST_TABLE.filter((r) => r.kind === "stand_fault" || r.kind === "stand_fault_and_violator").map((r) => r.test);
    expect(Object.keys(FAULT_WHAT).sort()).toEqual([...standFault].sort());
    for (const w of Object.values(FAULT_WHAT).flat()) expect(STAND_LOG_WHAT as readonly string[]).toContain(w);
  });
  it("файл задания v1.1 не менялся (sha256) — иначе структура ожиданий пересверяется скриптом (Р-1534 В1)", () => {
    const f = join(import.meta.dirname, "../../docs/reference/2026-11-13-zadanie-testirovanie-pulta-v1.1.xlsx");
    expect(createHash("sha256").update(readFileSync(f)).digest("hex")).toBe("76da1beaad0cbe971eaa244302d97b8ff98b53cd90753b8e406d05ca2ea44060");
  });
  it("«нет случая» по столбцу M — ровно тесты стенда «не воспроизводится» (Н-10)", () => {
    const noCase = TEST_SPECS.filter((s) => s.mvp?.kind === "no_case").map((s) => s.test);
    expect(noCase).toEqual(STAND_TEST_TABLE.filter((r) => r.kind === "not_reproducible").map((r) => r.test));
    expect(row(table({ items: [] }), "Н-10").expected.ru).toContain("нет случая");
  });
});

describe("П-11.5а: П-xx — ожидаемый итог и ни одного паспорта", () => {
  const items = [rec(1, 0, "run.purchase"), rec(2, 1, "cart.created"), rec(3, 2, "outcome")];
  const model = modelOf([tx("T1", [2, 3], paid(3))]);

  it("«да» — итог есть, паспортов нет; паспорт у объекта — «нет»; решение клиента паспорта не даёт", () => {
    expect(row(table({ items, model }), "П-01")).toMatchObject({ agree: "yes", auto: false, objs: ["T1"] });
    expect(row(table({ items, model, verdicts: [{ kind: "violation", obj: "T1", cond: "R18", violator: "agent", seqs: [3] }] }), "П-01").agree).toBe("no");
    expect(row(table({ items, model, verdicts: [{ kind: "client_decision", obj: "T1", violator: "client_decision", seqs: [3] }] }), "П-01").agree).toBe("yes");
  });
  it("ревью № 6: паспорт без объекта с доказательством в окне — «нет»; вне окна — не мешает", () => {
    const sys: Verdict = { kind: "violation", cond: "R41", violator: "undetermined", seqs: [2] };
    expect(row(table({ items, model, verdicts: [sys] }), "П-01").agree).toBe("no");
    expect(row(table({ items: [rec(0, 0, "intent.created"), ...items], model, verdicts: [{ ...sys, seqs: [0] }] }), "П-01").agree).toBe("yes");
  });
  it("прогона нет — «не проверено»; только со взведённым сбоем «П» — «не проверено»; «Авто» — пометка без влияния", () => {
    expect(row(table({ items: [] }), "П-01").agree).toBe("unchecked");
    expect(row(table({ items: [rec(0, 0, "stand_fault.armed", { test: "Н-11" }), ...items], model }), "П-01").agree).toBe("unchecked");
    const disarmed = [rec(0, 0, "stand_fault.armed", { test: "Н-11" }), rec(1, 0, "stand_fault.disarmed", { test: "Н-11" }), ...items.map((x) => ({ ...x, seq: x.seq + 1 }))];
    expect(row(table({ items: disarmed, model: modelOf([tx("T1", [3, 4], paid(4))]) }), "П-01").agree).toBe("yes");
    expect(row(table({ items: [rec(0, 0, "client.auto_on"), ...items], model }), "П-01")).toMatchObject({ agree: "yes", auto: true });
  });
  it("ревью № 1: П-09 — пустой прогон (ждёт срока) не «да»; «да» — только с защитой R09 агента (M v1.1)", () => {
    const exp = [rec(1, 0, "run.expired"), rec(2, 1, "intent.created"), rec(3, 2, "expiry.wait")];
    expect(row(table({ items: exp }), "П-09").agree).toBe("no");
    const r09: Verdict = { kind: "protection", obj: "M1", cond: "R09", protector: "agent", seqs: [3] };
    expect(row(table({ items: exp, verdicts: [r09] }), "П-09")).toMatchObject({ agree: "yes" });
    expect(row(table({ items: exp, verdicts: [{ ...r09, protector: "undetermined" }] }), "П-09").agree).toBe("no");
  });
  it("ревью № 8: П-06 — R17 «сработало», защитил агент (M v1.1); защитник Платформа (ожидание E) — «нет»", () => {
    const sc = [rec(1, 0, "run.scope"), rec(2, 1, "scope.refused")];
    expect(row(table({ items: sc }), "П-06").agree).toBe("no");
    const r17: Verdict = { kind: "protection", obj: "M1", cond: "R17", protector: "agent", seqs: [2] };
    expect(row(table({ items: sc, verdicts: [r17] }), "П-06").agree).toBe("yes");
    expect(row(table({ items: sc, verdicts: [{ ...r17, protector: "platform" }] }), "П-06").agree).toBe("no");
  });
  it("П-08: вердикт по поручению из другого прогона — по доказательству в окне; защитил агент или Платформа — оба «да» (M v1.1)", () => {
    const items2 = [rec(1, 0, "run.intent"), rec(2, 1, "intent.created"), rec(3, 2, "run.revoke"), rec(4, 3, "revoke.refused")];
    const v: Verdict = { kind: "client_decision", obj: "M1", guarantee: "revoke", violator: "client_decision", protector: "agent", seqs: [4] };
    const m: TxModel = { mandates: [{ id: "M1", status: "revoked", txIds: [], stage: "revoke", worst: "norm", seqs: [2, 4], firstAt: "", lastAt: "" }], txs: [], unattached: [] };
    expect(row(table({ items: items2, model: m, verdicts: [v] }), "П-08")).toMatchObject({ agree: "yes", objs: ["M1"] });
    expect(row(table({ items: items2, model: m, verdicts: [{ ...v, protector: "platform" }] }), "П-08").agree).toBe("yes");
    // повторное ревью № 3: отзыв вердиктом условия R09 (гарантия подавлена) — тоже «да»
    const byCond: Verdict = { kind: "client_decision", obj: "M1", cond: "R09", violator: "client_decision", protector: "agent", seqs: [4] };
    expect(row(table({ items: items2, model: m, verdicts: [byCond] }), "П-08").agree).toBe("yes");
    // защита вместо решения клиента — «нет»
    expect(row(table({ items: items2, model: m, verdicts: [{ ...v, kind: "protection" }] }), "П-08").agree).toBe("no");
  });
  it("П-07: защитник по источнику — Платформа или агент, оба «да» (M v1.1); паспорт — «нет»", () => {
    const items = [rec(1, 0, "run.suspended"), rec(2, 1, "suspended.refused")];
    const g: Verdict = { kind: "protection", obj: "M1", guarantee: "agent_suspended", protector: "platform", seqs: [2] };
    expect(row(table({ items, verdicts: [g] }), "П-07").agree).toBe("yes");
    expect(row(table({ items, verdicts: [{ ...g, protector: "agent" }] }), "П-07").agree).toBe("yes");
    expect(row(table({ items, verdicts: [g, { kind: "violation", obj: "M1", cond: "R09", violator: "agent", seqs: [2] }] }), "П-07").agree).toBe("no");
  });
  it("П-03: R09 «сработало», решение клиента (`rejected_*`) — «да»; решение без R09 или ложный паспорт R09 «не определён» — «нет» (M v1.1)", () => {
    const rj = [rec(1, 0, "run.reject"), rec(2, 1, "cart.created"), rec(3, 2, "cart.rejected")];
    const m = modelOf([tx("T1", [2, 3])]);
    const cd: Verdict = { kind: "client_decision", obj: "T1", cond: "R09", violator: "client_decision", protector: "agent", cause: { kind: "rule", rule: "rejected_agent_stop" }, seqs: [3] };
    expect(row(table({ items: rj, model: m, verdicts: [cd] }), "П-03").agree).toBe("yes");
    const noCond: Verdict = { kind: "client_decision", obj: "T1", violator: "client_decision", protector: "agent", seqs: [3] };
    expect(row(table({ items: rj, model: m, verdicts: [noCond] }), "П-03").agree).toBe("no");
    const r09: Verdict = { kind: "protection", obj: "T1", cond: "R09", violator: "undetermined", protector: "agent", seqs: [3] };
    expect(row(table({ items: rj, model: m, verdicts: [cd, r09] }), "П-03").agree).toBe("no");
  });
  it("П-04: R21 «сработало» — решение клиента, защитила Платформа (`confirmation_expired`) — «да» без итога транзакции; защитник агент — «нет» (M v1.1)", () => {
    const un = [rec(1, 0, "run.unconfirmed"), rec(2, 1, "cart.created"), rec(3, 60, "confirmation.expired")];
    const m = modelOf([tx("T1", [2, 3])]);
    const r21: Verdict = { kind: "client_decision", obj: "T1", cond: "R21", violator: "client_decision", protector: "platform", seqs: [3] };
    expect(row(table({ items: un, model: m, verdicts: [r21] }), "П-04").agree).toBe("yes");
    expect(row(table({ items: un, model: m, verdicts: [{ ...r21, protector: "agent" }] }), "П-04").agree).toBe("no");
    expect(row(table({ items: un, model: m }), "П-04").agree).toBe("no");
  });
});

describe("П-11.5а: Н-xx — ожидаемый паспорт", () => {
  it("Н-03 (M v1.1): R27 продавец / пульт — «да»; паспорт R28 — «нет» (ревью № 7); R27 «нарушил: оператор» (ожидание E) — «нет»", () => {
    const items = [rec(1, 0, "stand_fault.armed", { test: "Н-03" }), rec(2, 1, "cart.created")];
    const model = modelOf([tx("T1", [2])]);
    const n03: Verdict = { kind: "protection", obj: "T1", cond: "R27", node: "У3", violator: "merchant", protector: "operator", cause: { kind: "fault", what: "PAID_BEFORE_OUTCOME" }, seqs: [2] };
    expect(row(table({ items, model, verdicts: [n03] }), "Н-03").agree).toBe("yes");
    const r28: Verdict = { kind: "violation", obj: "T1", cond: "R28", node: "У3", violator: "operator", seqs: [2] };
    expect(row(table({ items, model, verdicts: [n03, r28] }), "Н-03").agree).toBe("no");
    expect(row(table({ items, model, verdicts: [{ ...n03, kind: "violation", violator: "operator" }] }), "Н-03").agree).toBe("no");
  });
  it("Н-06 (M v1.1): «сходится» по R37 + агент + У5; R09 «не определён» (гонка С-28) не мешает; R37 без пометки агента — «нет»", () => {
    const items = [rec(1, 0, "run.fault", { test: "Н-06" }), rec(2, 1, "cart.created"), rec(3, 2, "fault.marked", { test: "Н-06" })];
    const model = modelOf([tx("T1", [2])]);
    const r37: Verdict = { kind: "violation", obj: "T1", cond: "R37", node: "У5", violator: "agent", seqs: [2] };
    const r09: Verdict = { kind: "violation", obj: "T1", cond: "R09", node: "У5", violator: "undetermined", seqs: [2] };
    expect(row(table({ items, model, verdicts: [r37, r09] }), "Н-06").agree).toBe("yes");
    expect(row(table({ items, model, verdicts: [{ ...r37, violator: "undetermined" }, r09] }), "Н-06").agree).toBe("no");
  });
  it("Н-08 (M v1.1): паспорт R17, нарушил агент — «да» и при отказе Платформы (защитила Платформа), и при прошедшей операции (защитника нет)", () => {
    const items = [rec(1, 0, "run.fault", { test: "Н-08" }), rec(2, 1, "cart.created"), rec(3, 2, "fault.refused", { test: "Н-08", testCode: "MANDATE_SCOPE" })];
    const model = modelOf([tx("T1", [2])]);
    const fired: Verdict = { kind: "protection", obj: "T1", cond: "R17", violator: "agent", protector: "platform", seqs: [2] };
    expect(row(table({ items, model, verdicts: [fired] }), "Н-08").agree).toBe("yes");
    const passed: Verdict = { kind: "violation", obj: "T1", cond: "R17", violator: "agent", seqs: [2] };
    expect(row(table({ items, model, verdicts: [passed] }), "Н-08").agree).toBe("yes");
    expect(row(table({ items, model, verdicts: [{ ...fired, violator: "platform" }] }), "Н-08").agree).toBe("no");
  });
  it("ревью № 7: ожидаемый паспорт и паспорт того же условия с другим нарушителем — «нет»", () => {
    const items = [rec(1, 0, "stand_fault.armed", { test: "Н-11" }), rec(2, 1, "cart.created")];
    const r20: Verdict = { kind: "violation", obj: "T1", cond: "R20", violator: "bank", seqs: [2] };
    expect(row(table({ items, model: modelOf([tx("T1", [2])]), verdicts: [r20] }), "Н-11").agree).toBe("yes");
    expect(row(table({ items, model: modelOf([tx("T1", [2])]), verdicts: [r20, { ...r20, obj: "T2", violator: "undetermined" }] }), "Н-11").agree).toBe("no");
  });
  it("ревью № 2: Н-12 (M v1.1) — один взвод без записи стенда — «не проверено»; сработал и итог есть — «да»; итога нет — «не проверено»; R31 «потеряно» — «нет»", () => {
    const items = [rec(1, 0, "stand_fault.armed", { test: "Н-12" }), rec(2, 1, "cart.created"), rec(3, 5, "outcome")];
    const done = modelOf([tx("T1", [2, 3], { ...paid(3, 5), opRefs: ["OP1"] })]);
    expect(row(table({ items, model: done }), "Н-12").agree).toBe("unchecked");
    const fired = [log(1, 2, "OUTCOME_EVENT_DELAYED", { test: "Н-12", ids: { op_ref: "OP1" } })];
    expect(row(table({ items, model: done, standLog: fired }), "Н-12").agree).toBe("yes");
    expect(row(table({ items, model: modelOf([tx("T1", [2], { opRefs: ["OP1"] })]), standLog: fired }), "Н-12").agree).toBe("unchecked");
    // повторное ревью № 2: итога нет, паспорт есть — «нет», и факт не говорит «итог учтён»
    const r31: Verdict = { kind: "violation", obj: "T1", cond: "R31", node: "У4", violator: "operator", seqs: [2] };
    const noOutcome = row(table({ items, model: modelOf([tx("T1", [2], { opRefs: ["OP1"] })]), standLog: fired, verdicts: [r31] }), "Н-12");
    expect(noOutcome.agree).toBe("no");
    expect(noOutcome.fact.ru).not.toContain("итог учтён");
    const lost: Verdict = { kind: "violation", cond: "R31", node: "У4", violator: "operator", cause: { kind: "rule", rule: "late_lost" }, seqs: [] };
    expect(row(table({ items, model: done, standLog: fired, verdicts: [lost] }), "Н-12").agree).toBe("no");
    expect(row(table({ items: [] }), "Н-10")).toMatchObject({ agree: "no_case", fact: NOT_REPRODUCIBLE_LABEL.INVARIANT_1 });
  });
  it("ревью № 5: пометка «ПР» без доказательств на шине — только если её запись журнала стенда в окне прогона", () => {
    const items = [
      rec(1, 0, "run.fault", { test: "Н-07" }),
      rec(2, 1, "fault.marked", { test: "Н-07" }),
      rec(3, 10, "run.fault", { test: "Н-07" }),
      rec(4, 11, "fault.refused", { test: "Н-07", testCode: "PRINCIPAL_SIGNATURE_PENDING" }),
    ];
    const mark: Verdict = { kind: "violation", cond: "R18", violator: "agent", cause: { kind: "mark", test: "Н-07" }, seqs: [] };
    // пометка — в первом прогоне; таблица берёт последний — «нет»
    expect(row(table({ items, verdicts: [mark], standLog: [log(1, 1, "MARKED", { test: "Н-07" })] }), "Н-07").agree).toBe("no");
    expect(row(table({ items, verdicts: [mark], standLog: [log(2, 11, "MARKED", { test: "Н-07" })] }), "Н-07").agree).toBe("yes");
    // журнала нет — пометку к окну не отнести
    expect(row(table({ items, verdicts: [mark] }), "Н-07").agree).toBe("no");
    const unplayed = [rec(1, 0, "run.fault", { test: "Н-07" }), rec(2, 1, "fault.unplayed", { test: "Н-07", testCode: "NOT_SENT" })];
    expect(row(table({ items: unplayed, verdicts: [mark], standLog: [log(1, 1, "MARKED", { test: "Н-07" })] }), "Н-07").agree).toBe("unchecked");
  });
});

describe("П-11.5а: У-01…У-04", () => {
  const intent = (seq0: number, sec0: number, m: string, signedAfter?: number) => [
    rec(seq0, sec0, "run.intent"),
    rec(seq0 + 1, sec0 + 1, "intent.created", { ids: { mandate_id: m } }),
    rec(seq0 + 2, sec0 + 1, "intent.awaiting_signature", { ids: { mandate_id: m } }),
    ...(signedAfter === undefined ? [] : [rec(seq0 + 3, sec0 + 1 + signedAfter, "mandate.signed", { stream: "monitor", source: "pao_event", ids: { mandate_id: m } })]),
  ];
  const t = (items: Interpretation[]) => table({ items, model: buildTxModel(items) });
  it("У-01: ожидание видно только в истории — проигрывание прогона; клиент медлил 19 с — «да», 4 с — «нет»", () => {
    const slow = t(intent(1, 0, "mnd_a", 19));
    expect(row(slow, "У-01").agree).toBe("yes");
    expect(row(slow, "У-01").fact.ru).toContain("mnd_a");
    expect(row(slow, "У-01").fact.ru).toMatch(/\d+ с/);
    expect(row(slow, "У-01").fact.en).toMatch(/\d+ s/);
    expect(row(t(intent(1, 0, "mnd_a", 4)), "У-01").agree).toBe("no");
  });
  it("ревью № 3: неподписанное поручение прошлого прогона не даёт «да» новому", () => {
    expect(row(t([...intent(1, 0, "mnd_old"), ...intent(10, 100, "mnd_new", 2)]), "У-01").agree).toBe("no");
  });
  it("ревью № 4: окно закрыто следующим прогоном — ожидание кончается на нём, а не на «сейчас»", () => {
    const items = [...intent(1, 0, "mnd_a"), rec(5, 2, "run.purchase"), rec(6, 4, "mandate.signed", { stream: "monitor", source: "pao_event", ids: { mandate_id: "mnd_a" } })];
    expect(row(t(items), "У-01").agree).toBe("no");
  });
  it("У-01 при «Авто» — «не засчитано: прогон не по П5 доп. 1 п. 5», в итогах — «не проверено»", () => {
    const tt = t([rec(0, 0, "client.auto_on"), ...intent(1, 0, "mnd_a", 19)]);
    expect(row(tt, "У-01")).toMatchObject({ agree: "not_counted", auto: true });
    expect(tt.totals.tests - tt.totals.yes - tt.totals.no - tt.totals.noCase).toBe(tt.totals.unchecked);
  });
  it("У-04: «напомнено» по R21 раньше оплаты и отметка движка «упреждено реакцией» (П-8.2) — «да»; без отметки или напоминание после оплаты (ревью № 12) — «нет»", () => {
    const items = [rec(1, 0, "run.upk"), rec(2, 1, "cart.created"), rec(3, 30, "outcome")];
    const model = modelOf([tx("T1", [2, 3], { ...paid(3, 30), confirmationIds: ["cnf_1"] })]);
    const r: TableReaction = { at: at(20), action: "remind", obj: "cnf_1", cond: "R21", outcome: "done", preempted: "R21" };
    expect(row(table({ items, model, reactions: [r] }), "У-04").agree).toBe("yes");
    const plain: TableReaction = { at: r.at, action: r.action, obj: r.obj, cond: "R21", outcome: r.outcome };
    expect(row(table({ items, model, reactions: [plain] }), "У-04").agree).toBe("no");
    expect(row(table({ items, model, reactions: [{ ...r, at: at(40) }] }), "У-04").agree).toBe("no");
  });
});

describe("П-11.5а: выгрузка Markdown для акта ACC-1", () => {
  it("25 строк, каждая ячейка — через markdownCell: «|» и перевод строки в данных не ломают таблицу; итоги и примечание", () => {
    const items = [rec(1, 0, "run.purchase"), rec(2, 1, "cart.created"), rec(3, 2, "outcome")];
    const tt = table({ items, model: modelOf([tx("T|1\n<b>", [2, 3], paid(3))]) });
    for (const lang of ["ru", "en"] as const) {
      const md = testTableMarkdown(tt, lang).split("\n");
      const rows = md.filter((l) => /^\| [ПНУ]-\d\d /.test(l));
      expect(rows).toHaveLength(25);
      for (const l of rows) expect(l.replace(/\\\|/g, "").split("|").length - 2, l).toBe(6);
      expect(md.join("\n")).not.toContain("<b>");
      expect(md.some((l) => l.startsWith(lang === "ru" ? "Итого: тестов 25" : "Total: 25 tests"))).toBe(true);
    }
  });
});

describe("П-11.5а: живой стенд — П-01, П-05, П-08 и Н-01, Н-07, Н-09 с журналом стенда из ленты (П-8.2)", { timeout: 240_000 }, () => {
  let demo: Demo;
  let feed: InterpretFeed;
  beforeAll(async () => {
    demo = await startDemo({ faults: true });
    feed = createInterpretFeed(localStandSource(demo.monitor.url), { emulated: LOCAL_STAND_EMULATED });
  }, 30_000);
  afterAll(async () => {
    await feed?.close();
    await demo?.close();
  });
  const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const post = (p: string) => fetch(`${demo.monitor.url}${p}`, { method: "POST", headers: { origin: demo.monitor.url } });
  async function until<T>(f: () => T | undefined, ms = 60_000): Promise<T | undefined> {
    const end = Date.now() + ms;
    for (;;) {
      const v = f();
      if (v !== undefined || Date.now() > end) return v;
      await pause(200);
    }
  }
  // Журнал стенда — из ленты экранов (поток `stand` шины), как у ленты пульта, а не со стенда напрямую.
  const live = () => {
    const items = feed.list();
    const model = buildTxModel(items);
    const now = new Date().toISOString();
    const standLog = feed.standLog!().map((l) => l.entry as StandLogEntry);
    const view = evaluate(model, items, { now, standLog });
    return testTable({ items, model, verdicts: verdicts(view, model, items), standLog, now });
  };
  const YES = ["П-01", "П-05", "П-08", "Н-01", "Н-07", "Н-09"] as const;

  it("сюжеты в «Авто» и драйвер «ПР»: шесть строк «да» с пометкой «Авто», Н-10 — «нет случая», остальные — «не проверено»", async () => {
    demo.clientEmulator!.setAuto(true);
    for (const s of ["intent", "purchase", "intent", "limit", "intent", "revoke"]) {
      expect((await post(`/scenario/${s}`)).status, s).toBe(202);
      await pause(300);
      await demo.scenarios.settled();
    }
    for (const n of ["Н-01", "Н-07", "Н-09"]) {
      expect((await post(`/fault/${encodeURIComponent(n)}`)).status, n).toBe(202);
      await until(() => (feed.list().some((x) => x.test === n && /^fault\.(refused|marked|recorded|unplayed|failed)$/.test(x.ref)) ? true : undefined));
    }
    const t = (await until(() => {
      const x = live();
      return YES.every((c) => row(x, c).agree === "yes") ? x : undefined;
    }, 30_000)) ?? live();
    for (const c of YES) expect(row(t, c), `${c}: ${row(t, c).fact.ru}`).toMatchObject({ agree: "yes", auto: true });
    expect(row(t, "Н-10").agree).toBe("no_case");
    expect(t.totals).toMatchObject({ tests: 25, yes: 6, no: 0, noCase: 1, unchecked: 18 });
    // инвариант 1: в таблице — только идентификаторы и коды, без фраз шины
    const md = testTableMarkdown(t, "ru");
    for (const x of feed.list().filter((x) => x.stream === "scenario")) expect(md).not.toContain(x.phrase.ru);
    demo.clientEmulator!.setAuto(false);
  });
});
