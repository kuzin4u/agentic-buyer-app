// К3.1 (ревью Б4 № 3, 7; карточка П28, развилки Р-1592 и Р-1595): вердикт системы — **по остановке**, а не по условию.
// Прежде `system[c]` и `guaranteesOf` склеивали доказательства всех остановок одного вида без объекта, и две остановки давали
// одну запись акта ACC-1. Остановки без объекта различаются ключом по идентификаторам самой записи (`stopKeyOf`, от широкого
// звена к узкому), а запись без ни одного идентификатора присоединяется к единственной остановке того же вида в окне — с
// пометкой, что привязка сделана правилом, а не номером (вариант (1); пометка — в акте и в «Причинах», `ATTACHED_BY_RULE`).
//
// Два класса остановок проверяются отдельно, потому что ключ им нужен в разных слоях:
//  - класс А — у остановки есть записи шины: ключ нужен движку, протокол различает вердикты по доказательствам сам;
//  - класс Б — условия по журналу стенда: записей шины у остановки нет (журнал в ленту интерпретаций не идёт), и без ключа
//    `Verdict.stop` в протоколе все остановки одного условия получили бы одну запись (Р-1595).
import { describe, expect, it } from "vitest";
import type { Interpretation, TxIds, Who } from "../../src/dashboards/interpret.js";
import { ATTACHED_BY_RULE, evaluate } from "../../src/pult/engine.js";
import { PULT } from "../../src/pult/phrases.js";
import type { StandLogEntry, StandTest } from "../../src/pult/standlog.js";
import { buildTxModel } from "../../src/pult/tx.js";
import { verdicts } from "../../src/pult/verdict.js";
import { emptyProtocol, protocolStep, protocolView } from "../../src/pult/protocol.js";
import { acc1Csv, acc1CsvCell, acc1Markdown, acc1MdCell, acc1Unlinked, type Acc1Record } from "../../src/pult/acc1.js";
import { causesView } from "../../src/pult/causes.js";
import type { TestRow, TestTable } from "../../src/pult/testtable.js";

let seq = 0;
const at = (n: number) => new Date(Date.UTC(2026, 10, 17, 12, 0, 0, n)).toISOString();
type O = { code?: string; stream?: Interpretation["stream"]; source?: Interpretation["source"] };
function rec(ref: string, ids: TxIds, o: O = {}): Interpretation {
  const n = ++seq;
  const who: Who | undefined = o.code !== undefined ? { code: o.code, status: "found", side: ["platform"], verdict: "expected" } : undefined;
  return {
    seq: n,
    at: at(n),
    stream: o.stream ?? "monitor",
    ref,
    level: "key",
    stage: "payment",
    actor: "agent",
    emulated: false,
    kind: o.code !== undefined ? "conflict" : "norm",
    phrase: { ru: ref, en: ref },
    ...(Object.keys(ids).length > 0 && { ids }),
    ...(who && { who }),
    ...(o.source !== undefined && { source: o.source }),
  };
}

/** Отказ Платформы `MANDATE_SCOPE` по поручению, которого в модели транзакций нет: ни корзины, ни намерения по нему не было
 *  (так уходят к системе записи корзины драйвера «ПР» — расхождение № 10). Объекта у записи нет, а идентификатор поручения
 *  на руках — по нему остановки и различаются. */
const scopeRefusal = (cart: string) => rec("POST /pao/v1/credentials", { mandate_id: cart }, { source: "agent_platform", code: "MANDATE_SCOPE" });
/** Шаг сюжета той же остановки без единого идентификатора: по нему не определить, к которой остановке он относится. */
const scopeStep = () => rec("failed", {}, { stream: "scenario", code: "MANDATE_SCOPE" });

let logSeq = 0;
const T0 = Date.UTC(2026, 10, 17, 15, 0, 0);
const mark = (ids: StandLogEntry["ids"], test: StandTest = "Н-01"): StandLogEntry => ({
  seq: ++logSeq,
  at: new Date(T0).toISOString(),
  kind: "action",
  test,
  what: "MARKED",
  ids,
});
/** Р-1551: пометка без итога прогона не судится — к каждой пометке дописывается шаг итога её прогона (как `played` у движка).
 *  Первая запись — начало окна ленты: запись журнала стенда старше первой записи окна не судится (повторное ревью Б4а № 10),
 *  поэтому окно открывается раньше часов стенда. */
const outcomeStep = (test: StandTest): readonly Interpretation[] => [
  rec("search.started", {}, { stream: "scenario" }),
  { ...rec("fault.marked", {}, { stream: "scenario" }), test, at: new Date(T0 + 1).toISOString() },
];

const engine = (items: readonly Interpretation[], standLog?: readonly StandLogEntry[]) => {
  const model = buildTxModel(items);
  const ev = evaluate(model, items, standLog !== undefined ? { standLog } : {});
  return { ev, model, vs: verdicts(ev, model, items) };
};

describe("класс А (у остановки есть записи шины): ключ группировки сработавших защит — engine.ts", () => {
  it("две остановки одного вида без объекта — две сработавшие защиты, каждая со своим ключом (прежде склеивались в одну)", () => {
    const items = [scopeRefusal("CX1"), scopeRefusal("CX2")];
    const { ev } = engine(items);
    // ПОЛОМКА С3 (слой движка): вернуть ключ `${kind}|${obj ?? ""}` — защита станет одна, и этот тест покраснеет.
    expect(ev.guarantees).toHaveLength(2);
    expect(ev.guarantees.map((g) => g.stop)).toEqual(["mandate_id=CX1", "mandate_id=CX2"]);
    // Доказательства не перемешаны: у каждой остановки — только её запись.
    expect(ev.guarantees.map((g) => g.seqs)).toEqual([[items[0]!.seq], [items[1]!.seq]]);
    expect(ev.guarantees.every((g) => g.obj === undefined && g.attachedByRule === undefined)).toBe(true);
  });

  it("вариант (1): запись без идентификаторов присоединяется к единственной остановке того же вида — с пометкой привязки", () => {
    const items = [scopeRefusal("CY1"), scopeStep()];
    const { ev, vs } = engine(items);
    expect(ev.guarantees).toHaveLength(1);
    expect(ev.guarantees[0]).toMatchObject({ stop: "mandate_id=CY1", attachedByRule: true, seqs: [items[0]!.seq, items[1]!.seq] });
    // Пометка доходит до вердикта — оттуда её берут акт и «Причины».
    expect(vs.find((v) => v.guarantee === "mandate_scope")!.attachedByRule).toBe(true);
  });

  it("остановок того же вида в окне две — запись без идентификаторов остаётся общей группой, без пометки: угадывать пульт не вправе", () => {
    const items = [scopeRefusal("CZ1"), scopeRefusal("CZ2"), scopeStep()];
    const { ev } = engine(items);
    expect(ev.guarantees).toHaveLength(3);
    expect(ev.guarantees.filter((g) => g.attachedByRule === true)).toEqual([]);
    // Общая группа «без идентификаторов» — без ключа остановки.
    expect(ev.guarantees.filter((g) => g.stop === undefined)).toHaveLength(1);
  });
});

describe("класс Б (записей шины у остановки нет): обход по остановкам — verdict.ts, ключ записи — protocol.ts", () => {
  const twoMarks = () => {
    const log = [mark({ order_id: "OX1" }), mark({ order_id: "OX2" })];
    return { log, items: [...outcomeStep("Н-01")] };
  };

  it("две пометки «ПР» по разным заказам вне модели — две остановки условия в движке; сводка условия остаётся одна", () => {
    const { log, items } = twoMarks();
    const { ev } = engine(items, log);
    const stops = (ev.systemStops ?? []).filter((s) => s.cond === "R46");
    expect(stops.map((s) => s.stop)).toEqual(["order_id=OX1", "order_id=OX2"]);
    // Сводный статус условия не меняется: его читают плитки узлов и статусы правил справочника.
    expect(ev.system.R46.status).toBe("bad");
    // Доказательства остановок не перемешаны: у каждой — своя запись журнала.
    expect(stops.map((s) => s.res.log)).toEqual([[log[0]!.seq], [log[1]!.seq]]);
  });

  it("обход по остановкам в verdict.ts: вердикт — по одному на остановку, а не на условие", () => {
    const { log, items } = twoMarks();
    const { vs } = engine(items, log);
    // ПОЛОМКА С3 (слой вердиктов): убрать обход по `systemStops` и оставить один `fromCond(c, view.system[c])` — вердикт
    // станет один, и этот тест покраснеет.
    const own = vs.filter((v) => v.cond === "R46" && v.obj === undefined);
    expect(own).toHaveLength(2);
    expect(own.map((v) => v.stop)).toEqual(["order_id=OX1", "order_id=OX2"]);
    expect(own.every((v) => v.kind === "violation" && v.violator === "agent")).toBe(true);
  });

  it("ключ остановки в протоколе: две остановки — две записи П-NNN; без ключа у вердиктов без доказательств была бы одна", () => {
    const { log, items } = twoMarks();
    const { vs, model } = engine(items, log);
    // Доказательств шины у таких вердиктов нет — `sysSeq = min(seqs)` не берётся, и ключ записи даёт только `stop`.
    expect(vs.filter((v) => v.cond === "R46" && v.obj === undefined).every((v) => v.seqs.length === 0)).toBe(true);
    const st = protocolStep(emptyProtocol(), { verdicts: vs, waits: [], waitMs: 15_000, now: at(900), reactions: [], model, items });
    const sys = st.entries.filter((e) => e.obj === "" && e.cond === "R46");
    // ПОЛОМКА С3 (слой протокола): убрать `e.stop` из `entryKey` — вторая запись исчезнет, и этот тест покраснеет.
    expect(sys.map((e) => e.no)).toEqual(["П-001", "П-002"]);
    // Повторный пересчёт новых записей не заводит: ключ остановки устойчив.
    const again = protocolStep(st, { verdicts: vs, waits: [], waitMs: 15_000, now: at(901), reactions: [], model, items });
    expect(again.entries.filter((e) => e.cond === "R46")).toHaveLength(2);
    // Ключ остановки — служебное поле: на экран не уходит (ревью Б4 № 8), а пометка привязки уходит.
    expect(protocolView(st, vs, items).entries[0]).not.toHaveProperty("stop");
  });

  it("вариант (1) в журнале стенда: пометка с одной витриной идентификаторов остановки не несёт — присоединяется к единственной остановке условия", () => {
    // Витрина (`shop_id`, `merchant_id`) в ключ остановки не входит: у одной витрины остановок много — это не остановка.
    const log = [mark({ order_id: "OW1" }), mark({ shop_id: "SHOP-1", merchant_id: "M-1" })];
    const items = [...outcomeStep("Н-01")];
    const { ev, vs } = engine(items, log);
    const stops = (ev.systemStops ?? []).filter((s) => s.cond === "R46");
    expect(stops).toHaveLength(1);
    expect(stops[0]).toMatchObject({ stop: "order_id=OW1", attachedByRule: true });
    // Доказательства считаются заново по объединённому набору — присоединённая запись в них есть.
    expect(stops[0]!.res.log).toEqual([log[0]!.seq, log[1]!.seq]);
    expect(vs.find((v) => v.cond === "R46" && v.obj === undefined)!.attachedByRule).toBe(true);
  });

  it("остановок условия две — пометка без идентификаторов остаётся общей группой: своя запись, без пометки привязки", () => {
    const log = [mark({ order_id: "OV1" }), mark({ order_id: "OV2" }), mark({ shop_id: "SHOP-2" })];
    const items = [...outcomeStep("Н-01")];
    const { ev } = engine(items, log);
    const stops = (ev.systemStops ?? []).filter((s) => s.cond === "R46");
    expect(stops).toHaveLength(3);
    expect(stops.filter((s) => s.attachedByRule === true)).toEqual([]);
    expect(stops.filter((s) => s.stop === undefined)).toHaveLength(1);
  });
});

describe("растущий журнал (ревью К3.1 № 1, 2, 8): одна остановка — одна запись, пометка ставится и снимается", () => {
  /** Шаг протокола по журналу на этот момент: движок пересчитывается на растущем журнале, как на стенде. */
  const step = (log: readonly StandLogEntry[], items: readonly Interpretation[], prev = emptyProtocol(), ms = 900) => {
    const model = buildTxModel(items);
    const ev = evaluate(model, items, { standLog: log });
    const vs = verdicts(ev, model, items);
    return { st: protocolStep(prev, { verdicts: vs, waits: [], waitMs: 15_000, now: at(ms), reactions: [], model, items }), vs };
  };
  const r46 = (st: ReturnType<typeof step>["st"]) => st.entries.filter((e) => e.cond === "R46");

  it("порядок настоящего драйвера Н-01: пометка по продавцу раньше пометки по корзине — запись одна, номер прежний, с пометкой привязки", () => {
    // Формы — как у драйвера (`src/demo/faulty.ts`, `intentAndCart` и ветка Н-01): сперва пометка только по продавцу
    // (идентификаторов остановки в ней нет), затем по корзине, затем по заказу. Обе последние несут `mandate_id` корзины —
    // это одна остановка.
    const shop = { merchant_id: "VIOLATOR-M1", shop_id: "VIOLATOR-S1" };
    const byShop = mark({ ...shop });
    const byCart = mark({ mandate_id: "CART-A1", ...shop });
    const byOrder = mark({ mandate_id: "CART-A1", order_id: "ORD-A1", order_ref: "ORD-A1", ...shop });
    const items = [...outcomeStep("Н-01")];
    // Шаг 1: в журнале только пометка по продавцу — остановка без ключа, своя запись.
    const one = step([byShop], items);
    expect(r46(one.st).map((e) => e.no)).toEqual(["П-001"]);
    // Шаг 2 и 3: появились пометки с корзиной — безликая присоединяется, запись переключается на ключ, второй записи нет.
    const two = step([byShop, byCart], items, one.st, 901);
    expect(r46(two.st).map((e) => e.no)).toEqual(["П-001"]);
    expect(r46(two.st)[0]!.attachedByRule).toBe(true);
    const three = step([byShop, byCart, byOrder], items, two.st, 902);
    expect(r46(three.st).map((e) => e.no)).toEqual(["П-001"]);
    expect(r46(three.st)[0]!.attachedByRule).toBe(true);
  });

  it("обратный порядок: остановка с ключом была раньше безликой — пометка привязки появляется у уже заведённой записи", () => {
    const byCart = mark({ mandate_id: "CART-B1" });
    const byShop = mark({ shop_id: "VIOLATOR-S2" });
    const items = [...outcomeStep("Н-01")];
    const one = step([byCart], items);
    expect(r46(one.st).map((e) => [e.no, e.attachedByRule])).toEqual([["П-001", undefined]]);
    const two = step([byCart, byShop], items, one.st, 901);
    expect(r46(two.st).map((e) => [e.no, e.attachedByRule])).toEqual([["П-001", true]]);
  });

  it("присоединение отменилось (в окне стало две остановки) — пометка снимается, а безликая группа получает свою запись", () => {
    const byCart = mark({ mandate_id: "CART-C1" });
    const byShop = mark({ shop_id: "VIOLATOR-S3" });
    const other = mark({ mandate_id: "CART-C2" });
    const items = [...outcomeStep("Н-01")];
    const one = step([byCart, byShop], items);
    expect(r46(one.st)[0]!.attachedByRule).toBe(true);
    const two = step([byCart, byShop, other], items, one.st, 901);
    // Три остановки: две по корзинам и общая группа «без идентификаторов» — и ни одной пометки привязки.
    expect(r46(two.st)).toHaveLength(3);
    expect(r46(two.st).filter((e) => e.attachedByRule === true)).toEqual([]);
  });
});

describe("пометка привязки — одними словами в акте ACC-1 и в «Причинах» (П28, как провенанс в П26)", () => {
  const row = (test: TestRow["test"]): TestRow => ({
    test,
    kind: "toward",
    expected: { ru: "ожидание", en: "expected" },
    fact: { ru: "факт", en: "fact" },
    agree: "yes",
    auto: false,
    objs: [],
  });
  const table = (): TestTable => ({ at: at(0), rows: [row("Н-01")], totals: { tests: 1, yes: 1, no: 0, noCase: 0, unchecked: 0 } });

  it("источник слов один: словарь пульта; акт и экран берут его, а не копию литералом", () => {
    expect(ATTACHED_BY_RULE).toBe(PULT["int.attached_by_rule"]);
    for (const lang of ["ru", "en"] as const) expect(ATTACHED_BY_RULE[lang].length).toBeGreaterThan(0);
  });

  it("запись акта с пометкой несёт её текстом целиком, в ru и en, в md и csv; запись без пометки — не несёт", () => {
    const marked: Acc1Record = { id: "П-007", obj: "", status: "open", at: at(0), attachedByRule: true };
    const plain: Acc1Record = { id: "П-008", obj: "", status: "open", at: at(0) };
    const t = table();
    // Записи без строки теста акт не теряет (ревью К2 № 3) — пометка видна там же.
    expect(acc1Unlinked(t, [marked, plain])).toHaveLength(2);
    for (const lang of ["ru", "en"] as const) {
      // Ожидаемая строка — **целиком** и из источника, экранированная теми же функциями, которыми её экранирует акт
      // (правило кирпича К3.0б: обрезанное ожидание оставляет без проверки ровно ту половину, которая несёт смысл).
      const md = acc1MdCell(ATTACHED_BY_RULE[lang]);
      const csv = acc1CsvCell(ATTACHED_BY_RULE[lang]);
      expect(acc1Markdown(t, lang, [marked])).toContain(md);
      expect(acc1Markdown(t, lang, [marked])).toContain("П-007");
      expect(acc1Markdown(t, lang, [plain])).not.toContain(md);
      expect(acc1Csv(t, lang, [marked])).toContain(csv.slice(1, -1));
      expect(acc1Csv(t, lang, [plain])).not.toContain(csv.slice(1, -1));
    }
  });

  it("в тексте пометки нет знаков, которые акт достраивает разметкой: в выгрузке она читается словами", () => {
    // Двоеточие акт гасит `<span>:</span>` против автоссылок GitHub (`acc1MdCell`) — внутри фразы это читалось бы как
    // разметка (ревью К3.1 № 9). Проверяется само свойство фразы, а не её текст.
    for (const lang of ["ru", "en"] as const) expect(acc1MdCell(ATTACHED_BY_RULE[lang])).toBe(ATTACHED_BY_RULE[lang]);
  });

  it("«Причины» показывают пометку у разбора остановки, к которой запись присоединена правилом", () => {
    // Остановка с объектом: отказ Платформы по поручению-намерению одной покупки и шаг сюжета без идентификаторов.
    const intent = rec("intent.created", { mandate_id: "CM1" }, { stream: "scenario" });
    const refusal = rec("POST /pao/v1/credentials", { mandate_id: "CM1" }, { source: "agent_platform", code: "MANDATE_SCOPE" });
    const items = [intent, refusal, scopeStep()];
    const { ev, model, vs } = engine(items);
    const hit = ev.guarantees.find((g) => g.kind === "mandate_scope")!;
    expect(hit.attachedByRule).toBe(true);
    const cause = causesView(model, items, vs, []).flatMap((c) => c.items).find((x) => x.guarantee === "mandate_scope");
    expect(cause?.attachedByRule).toBe(true);
  });
});
