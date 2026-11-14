// П-6.1а: протокол П-NNN (модель 1.23, раздел 1.10) — статусы по переходам, одна остановка — одна запись, решение клиента вне
// протокола (В1 (а)), «упреждено реакцией» только по пометке движка (В2 (а)), время до реакции.
import { describe, expect, it } from "vitest";
import type { Interpretation } from "../../src/dashboards/interpret.js";
import type { Reaction } from "../../src/pult/actions.js";
import type { WaitCandidate } from "../../src/pult/control.js";
import type { CondResult, EngineView } from "../../src/pult/engine.js";
import { emptyProtocol, PROTO_KEPT, protocolStep, protocolView, type ProtocolInput, type ProtocolState } from "../../src/pult/protocol.js";
import type { PultTx, TxModel } from "../../src/pult/tx.js";
import type { Verdict } from "../../src/pult/verdict.js";

const T0 = Date.UTC(2026, 10, 13, 12, 0, 0);
const at = (s: number) => new Date(T0 + s * 1000).toISOString();
const WAIT = 15_000;
const item = (seq: number, s: number): Interpretation =>
  ({ seq, at: at(s), stream: "monitor", ref: "x", level: "key", stage: "payment", actor: "agent", emulated: false, kind: "norm", phrase: { ru: "x", en: "x" } }) as Interpretation;
const tx = (id: string, o: Partial<PultTx> = {}): PultTx =>
  ({ id, ops: [], orderIds: [], opRefs: [], confirmationIds: [], merchantIds: [], shopsByOrder: {}, seqs: [], ...o }) as unknown as PultTx;
const model = (...txs: PultTx[]): TxModel => ({ mandates: [], txs, unattached: [] });
const reaction = (s: number, action: Reaction["action"], obj: string, cond?: string): Reaction => ({ at: at(s), action, obj, ...(cond && { cond }), outcome: "done" });
const evWith = (obj: string, r21: Partial<CondResult>): EngineView =>
  ({ objs: [{ id: obj, kind: "tx", conds: { R21: { status: "ok", seqs: [], ...r21 } } }], system: {}, guarantees: [] }) as unknown as EngineView;

function run(prev: ProtocolState, o: Partial<ProtocolInput> & { nowS: number }): ProtocolState {
  return protocolStep(prev, { verdicts: [], waits: [], waitMs: WAIT, reactions: [], model: model(), items: [], ...o, now: at(o.nowS) });
}
const byKey = (st: ProtocolState) => st.entries.map((e) => [e.no, e.type, e.cond ?? e.guarantee, e.obj, e.status]);

describe("протокол П-NNN (П-6.1а)", () => {
  it("гарантия — сразу «остановлено гарантией», нарушение — «открыто»; решение клиента — не в протоколе, строкой журнала (В1 (а)); одна остановка — одна запись", () => {
    const vs: Verdict[] = [
      { kind: "protection", obj: "C1", cond: "R17", protector: "agent", seqs: [1] },
      { kind: "violation", obj: "C2", cond: "R46", violator: "agent", seqs: [2] },
      { kind: "protection", obj: "C3", guarantee: "limit_client", protector: "bank", seqs: [3] },
      { kind: "client_decision", obj: "C4", cond: "R09", violator: "client_decision", seqs: [4] },
      // Другое условие у того же объекта — своя запись.
      { kind: "violation", obj: "C2", cond: "R18", violator: "agent", seqs: [2] },
    ];
    const items = [item(1, 1), item(2, 2), item(3, 3), item(4, 4)];
    let st = run(emptyProtocol(), { verdicts: vs, items, nowS: 10 });
    // Повторный шаг с теми же вердиктами — записей не прибавилось (ключ тип + условие + объект).
    st = run(st, { verdicts: vs, items, nowS: 11 });
    expect(byKey(st)).toEqual([
      ["П-001", "fired", "R17", "C1", "stopped"],
      ["П-002", "bad", "R46", "C2", "open"],
      ["П-003", "fired", "limit_client", "C3", "stopped"],
      ["П-004", "bad", "R18", "C2", "open"],
    ]);
    // Время появления — по доказательству, а не по пересчёту.
    expect(st.entries[1]!.at).toBe(at(2));
    expect(st.entries[2]!.guaranteeText?.ru).toBeTruthy();
    const view = protocolView(st, vs, items);
    expect(view.decisions).toEqual([{ obj: "C4", cond: "R09", at: at(4) }]);
    expect(view.counts).toMatchObject({ stopped: 2, open: 2 });
  });

  it("предупреждение — после порога, время появления — начало ожидания + порог; реакция по транзакции и условию — «отреагировано», время до реакции; реакция раньше записи не считается", () => {
    const w: WaitCandidate = { kind: "confirmation", cond: "R21", obj: "C1", confirmationId: "Q1", since: at(0) };
    expect(run(emptyProtocol(), { waits: [w], nowS: 10 }).entries).toEqual([]);
    let st = run(emptyProtocol(), { waits: [w], nowS: 20, reactions: [reaction(5, "remind", "Q1", "R21")] });
    expect(st.entries[0]).toMatchObject({ no: "П-001", type: "warn", cond: "R21", obj: "C1", at: at(15), status: "open" });
    st = run(st, { waits: [w], nowS: 25, reactions: [reaction(5, "remind", "Q1", "R21"), reaction(22, "remind", "Q1", "R21")], model: model(tx("C1", { confirmationIds: ["Q1"] })) });
    expect(st.entries[0]).toMatchObject({ status: "reacted", reactedAt: at(22), reaction: "remind", reactSec: 7 });
    // Реакция по другому условию не своего узла — не связана.
    const other = run(emptyProtocol(), { waits: [w], nowS: 30, reactions: [reaction(20, "review", "C1", "R46")] });
    expect(other.entries[0]!.status).toBe("open");
  });

  it("предупреждение ушло: без реакции и нарушения — «снято само»; с нарушением — «закрыто»; после реакции — «упреждено» только по пометке движка, иначе «снято само» (В2 (а))", () => {
    const w: WaitCandidate = { kind: "confirmation", cond: "R21", obj: "C1", confirmationId: "Q1", since: at(0) };
    const m = model(tx("C1", { confirmationIds: ["Q1"] }));
    const open = run(emptyProtocol(), { waits: [w], nowS: 20, model: m });
    expect(run(open, { nowS: 30, model: m }).entries[0]).toMatchObject({ status: "cleared", endedAt: at(30) });
    const bad: Verdict = { kind: "violation", obj: "C1", cond: "R21", violator: "agent", seqs: [] };
    expect(run(open, { nowS: 30, model: m, verdicts: [bad] }).entries.find((e) => e.type === "warn")!.status).toBe("closed");
    const reacted = run(open, { waits: [w], nowS: 22, model: m, reactions: [reaction(21, "remind", "Q1", "R21")] });
    expect(reacted.entries[0]!.status).toBe("reacted");
    // «Упреждено» — только напоминание, которое журнал реакций связал с записью стенда R21 (`preempted`), по тому же запросу.
    const pre = [{ ...reaction(21, "remind", "Q1", "R21"), preempted: "R21" as const }];
    expect(run(reacted, { nowS: 30, model: m, reactions: pre }).entries[0]!.status).toBe("prevented");
    // Без связи с записью стенда — уход после реакции не доказывает, что упредила реакция: «снято само» (пометка движка на всей
    // транзакции — не довод, ревью № 6).
    const r = [reaction(21, "remind", "Q1", "R21")];
    expect(run(reacted, { nowS: 30, model: m, reactions: r, ev: evWith("C1", { note: "preempted_by_reaction" }) }).entries[0]!.status).toBe("cleared");
    // Упредившее напоминание по другому запросу той же транзакции — не довод для этой записи.
    const otherQ = [reaction(21, "remind", "Q1", "R21"), { ...reaction(22, "remind", "Q9", "R21"), preempted: "R21" as const }];
    expect(run(reacted, { nowS: 30, model: model(tx("C1", { confirmationIds: ["Q1", "Q9"] })), reactions: otherQ }).entries[0]!.status).toBe("cleared");
  });

  it("ревью № 1: реакция без условия (остановить, отозвать) — только не позже 15 с после записи", () => {
    const v: Verdict = { kind: "violation", obj: "C2", cond: "R46", violator: "agent", seqs: [1] };
    const items = [item(1, 0)];
    const m = model(tx("C2", { intentId: "I2" }));
    expect(run(emptyProtocol(), { verdicts: [v], items, nowS: 30, model: m, reactions: [reaction(14, "stop", "C2")] }).entries[0]!.status).toBe("reacted");
    expect(run(emptyProtocol(), { verdicts: [v], items, nowS: 30, model: m, reactions: [reaction(16, "revoke", "I2")] }).entries[0]!.status).toBe("open");
  });

  it("ревью № 2, 3, 5, 9: повтор запроса подтверждения — своя запись; записи системы разных остановок не сливаются; разбор по номеру заказа связан; нарушение на намерении закрывается итогом его транзакции", () => {
    const m = model(tx("C1", { confirmationIds: ["Q1", "Q2"] }));
    const w1: WaitCandidate = { kind: "confirmation", cond: "R21", obj: "C1", confirmationId: "Q1", since: at(0) };
    const w2: WaitCandidate = { kind: "confirmation", cond: "R21", obj: "C1", confirmationId: "Q2", since: at(30) };
    let st = run(emptyProtocol(), { waits: [w1], nowS: 20, model: m });
    st = run(st, { waits: [w2], nowS: 50, model: m });
    expect(st.entries.map((e) => [e.no, e.confirmationId, e.status])).toEqual([
      ["П-001", "Q1", "cleared"],
      ["П-002", "Q2", "open"],
    ]);
    // Ревью № 12: напоминание по Q2 не прилипает к снятой записи Q1 — ни по другому номеру запроса, ни после конца записи.
    st = run(st, { waits: [w2], nowS: 60, model: m, reactions: [reaction(55, "remind", "Q2", "R21")] });
    expect(st.entries.map((e) => [e.confirmationId, e.status, e.reaction])).toEqual([
      ["Q1", "cleared", undefined],
      ["Q2", "reacted", "remind"],
    ]);
    const ended = run(run(emptyProtocol(), { waits: [w1], nowS: 20, model: m }), { nowS: 30, model: m });
    const late = run(ended, { nowS: 50, model: m, reactions: [reaction(40, "review", "C1", "R21")] });
    expect(late.entries[0]).toMatchObject({ status: "cleared" });
    expect(late.entries[0]!.reactSec).toBeUndefined();

    const sys: Verdict[] = [
      { kind: "violation", cond: "R32", violator: "undetermined", seqs: [1] },
      { kind: "violation", cond: "R32", violator: "undetermined", seqs: [2] },
    ];
    expect(run(emptyProtocol(), { verdicts: sys, items: [item(1, 1), item(2, 2)], nowS: 10 }).entries).toHaveLength(2);

    const vo: Verdict = { kind: "violation", obj: "order:O1", cond: "R46", violator: "agent", seqs: [] };
    const mo = model(tx("order:O1", { orderIds: ["O1"] }));
    expect(run(emptyProtocol(), { verdicts: [vo], nowS: 10, model: mo, reactions: [reaction(12, "review", "O1", "R46")] }).entries[0]!.status).toBe("reacted");

    const vi: Verdict = { kind: "violation", obj: "I5", cond: "R08", violator: "agent", seqs: [1] };
    const ri = [reaction(11, "review", "I5", "R08")];
    const mi = model(tx("C5", { intentId: "I5", outcome: { kind: "paid", seq: 9, at: at(19) } }));
    expect(run(emptyProtocol(), { verdicts: [vi], items: [item(1, 10)], nowS: 20, model: mi, reactions: ri }).entries[0]).toMatchObject({ status: "closed" });
  });

  it("ревью № 4: запись, вытесненная пределом, не заводится заново под новым номером, пока её вердикт жив", () => {
    const n = PROTO_KEPT + 3;
    const vs: Verdict[] = Array.from({ length: n }, (_, i) => ({ kind: "protection", obj: `C${i}`, cond: "R17", protector: "agent", seqs: [] }));
    let st = run(emptyProtocol(), { verdicts: vs, nowS: 10 });
    expect(st.entries).toHaveLength(PROTO_KEPT);
    expect(st.seq).toBe(n);
    st = run(st, { verdicts: vs, nowS: 20 });
    st = run(st, { verdicts: vs, nowS: 30 });
    expect(st.seq).toBe(n);
    expect(st.entries).toHaveLength(PROTO_KEPT);
    // Ревью № 14: открытые записи предел не вытесняет — превышает.
    const open: Verdict[] = Array.from({ length: n }, (_, i) => ({ kind: "violation", obj: `B${i}`, cond: "R46", violator: "agent", seqs: [] }));
    const so = run(emptyProtocol(), { verdicts: open, nowS: 10 });
    expect(so.entries).toHaveLength(n);
    expect(so.gone).toEqual([]);
  });

  it("предупреждение R08 на поручении-намерении закрывается нарушением R08 транзакции этого намерения; нарушение с реакцией — «закрыто» по итогу транзакции", () => {
    const w: WaitCandidate = { kind: "sign", cond: "R08", obj: "I1", since: at(0) };
    const m = model(tx("C1", { intentId: "I1" }));
    const st = run(emptyProtocol(), { waits: [w], nowS: 20, model: m });
    const bad: Verdict = { kind: "violation", obj: "C1", cond: "R08", violator: "agent", seqs: [] };
    expect(run(st, { nowS: 30, model: m, verdicts: [bad] }).entries.find((e) => e.type === "warn")!.status).toBe("closed");

    const v: Verdict = { kind: "violation", obj: "C2", cond: "R46", violator: "agent", seqs: [] };
    const r = [reaction(12, "stop", "C2")];
    let s = run(emptyProtocol(), { verdicts: [v], nowS: 10, model: model(tx("C2")), reactions: r });
    expect(s.entries[0]!.status).toBe("reacted");
    s = run(s, { verdicts: [v], nowS: 20, model: model(tx("C2", { outcome: { kind: "declined", seq: 9, at: at(19) } })), reactions: r });
    expect(s.entries[0]).toMatchObject({ status: "closed", endedAt: at(20) });
    // Без реакции итог транзакции нарушение не закрывает.
    const noReact = run(emptyProtocol(), { verdicts: [v], nowS: 20, model: model(tx("C2", { outcome: { kind: "declined", seq: 9, at: at(19) } })) });
    expect(noReact.entries[0]!.status).toBe("open");
  });

  it("среднее время до реакции — по записям с реакцией", () => {
    const vs: Verdict[] = [
      { kind: "violation", obj: "C1", cond: "R46", violator: "agent", seqs: [1] },
      { kind: "violation", obj: "C2", cond: "R46", violator: "agent", seqs: [2] },
    ];
    const items = [item(1, 0), item(2, 0)];
    const st = run(emptyProtocol(), { verdicts: vs, items, nowS: 10, model: model(tx("C1"), tx("C2")), reactions: [reaction(4, "review", "C1", "R46"), reaction(9, "review", "C2", "R46")] });
    expect(protocolView(st, vs, items).avgReactSec).toBe(6.5);
  });
});
