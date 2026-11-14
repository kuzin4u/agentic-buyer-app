// П-8.2 (Р-1531): журнал реакций ↔ протокол — нажатие связывается с записью журнала стенда по этому действию; «упреждено
// реакцией» — только по отметке движка у R21; журнала нет (режим показа) — «журнал недоступен», а не «записи нет».
import { describe, expect, it } from "vitest";
import type { Reaction } from "../../src/pult/actions.js";
import type { EngineView } from "../../src/pult/engine.js";
import { linkReactions } from "../../src/pult/reactions.js";
import type { StandLogEntry } from "../../src/pult/standlog.js";

const T = (s: number) => new Date(Date.UTC(2026, 10, 12, 18, 0, s)).toISOString();
const rec = (seq: number, what: StandLogEntry["what"], ids: StandLogEntry["ids"], s: number): StandLogEntry => ({ seq, at: T(s), kind: "action", what, ids });
const react = (action: Reaction["action"], obj: string, s: number, outcome: Reaction["outcome"] = "done"): Reaction => ({ at: T(s), action, obj, outcome });
/** Результат движка с отметкой «упреждено реакцией» у R21 по записям `log`. */
const preemptedBy = (log: number[]) => ({ objs: [{ id: "C1", kind: "tx", conds: { R21: { status: "ok", seqs: [], note: "preempted_by_reaction", log } } }] }) as unknown as EngineView;

describe("журнал реакций ↔ протокол стенда (П-8.2)", () => {
  it("каждое действие — своя запись стенда по своему объекту; повтор напоминания — следующая запись; разбор — по любому номеру", () => {
    const log = [
      rec(1, "CLIENT_REMINDED", { confirmation_id: "Q1", mandate_id: "C1" }, 10),
      rec(2, "REMIND_REPEATED", { confirmation_id: "Q1", mandate_id: "C1" }, 12),
      rec(3, "PURCHASE_STOPPED", { mandate_id: "C1" }, 14),
      rec(4, "MANDATE_REVOKED", { mandate_id: "I1" }, 16),
      rec(5, "SENT_TO_REVIEW", { order_id: "O1" }, 18),
      rec(6, "ACTION_REFUSED", { mandate_id: "C9" }, 20),
    ];
    const rs = [react("remind", "Q1", 10), react("remind", "Q1", 12), react("stop", "C1", 14), react("revoke", "I1", 16), react("review", "O1", 18), react("stop", "C9", 20, "refused")];
    expect(linkReactions(rs, log).map((x) => (x.link.state === "linked" ? [x.link.seq, x.link.what] : x.link.state))).toEqual([
      [1, "CLIENT_REMINDED"],
      [2, "REMIND_REPEATED"],
      [3, "PURCHASE_STOPPED"],
      [4, "MANDATE_REVOKED"],
      [5, "SENT_TO_REVIEW"],
      [6, "ACTION_REFUSED"],
    ]);
  });

  it("запись другого объекта или позже нажатия — не связывается («записи нет»); «напомнено» без стенда — без записи; журнала нет — «недоступен»", () => {
    const log = [rec(1, "CLIENT_REMINDED", { confirmation_id: "Q2" }, 10), rec(2, "CLIENT_REMINDED", { confirmation_id: "Q1" }, 30)];
    expect(linkReactions([react("remind", "Q1", 20)], log)[0]!.link).toEqual({ state: "not_found" });
    expect(linkReactions([react("remind_note", "I1", 20, "noted")], log)[0]!.link).toEqual({ state: "no_stand" });
    expect(linkReactions([react("remind", "Q1", 40)], undefined)[0]!.link).toEqual({ state: "unavailable" });
    // Ревью П-8.2 № 9: отказ «Напомнить» исключением стенда — записи нет (ACTION_REFUSED — только отказ шлюза участников).
    expect(linkReactions([react("remind", "Q1", 25, "refused")], log)[0]!.link).toEqual({ state: "not_found" });
  });

  it("«упреждено реакцией» — только у напоминания, чья запись стенда стоит в доказательстве R21 движка", () => {
    const log = [rec(1, "CLIENT_REMINDED", { confirmation_id: "Q1" }, 10), rec(2, "CLIENT_REMINDED", { confirmation_id: "Q2" }, 11)];
    const rs = [react("remind", "Q1", 10), react("remind", "Q2", 11)];
    const out = linkReactions(rs, log, preemptedBy([1]));
    expect(out.map((x) => x.preempted)).toEqual(["R21", undefined]);
    // Без результата движка «упреждено» не ставится: экран его не выводит сам.
    expect(linkReactions(rs, log).map((x) => x.preempted)).toEqual([undefined, undefined]);
  });
});
