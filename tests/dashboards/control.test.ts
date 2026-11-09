// К2.2 DEMO-2: контролёр — сверка прогона сюжета с паспортом на синтетических интерпретациях (Р-1384 п. 3, Р-1386).
// До срока итог — «ждёт» или «не принято», «принято» — только после срока; срок — от начала прогона и последней записи по
// часам процесса (события Платформы — по её часам — в отсчёт не входят); уже видимое нарушение — «не принято» сразу.
// Синтетика строится из признаков паспорта — так проверяется логика состояний; само сопоставление проверяют
// passports.test.ts и живая сверка пяти сюжетов (tests/demo/interpret-live.test.ts).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { control, ControlInputError, DEFAULT_WAIT_MS } from "../../src/dashboards/control.js";
import type { Interpretation } from "../../src/dashboards/interpret.js";
import { PASSPORTS, type Match, type Passport } from "../../src/dashboards/passports.js";

const T0 = Date.parse("2026-11-09T12:00:00.000Z");
const W = 5000;

/** Интерпретация с признаками ожидания (первое из перечисленных). Без stream — запись журнала агента, как у живых A5. */
function rec(seq: number, m: Match, atMs = T0 + seq): Interpretation {
  const code = m.code === undefined ? undefined : typeof m.code === "string" ? m.code : m.code[0]!;
  const who =
    code !== undefined || m.verdict !== undefined || m.side !== undefined
      ? { who: { code: code ?? "X", status: "found" as const, side: m.side ?? [], verdict: m.verdict ?? "expected", ...(m.codeDetail && { codeDetail: m.codeDetail }) } }
      : {};
  return {
    seq,
    at: new Date(atMs).toISOString(),
    stream: m.stream ?? "console",
    ref: m.ref ?? "x",
    ...(m.status !== undefined && { status: m.status }),
    ...(m.source !== undefined && { source: m.source[0]! }),
    level: "key",
    stage: "mandate",
    actor: m.actor ?? "agent",
    emulated: false,
    kind: m.kind ?? "norm",
    phrase: { ru: "—", en: "—" },
    ...who,
    ...(m.situation !== undefined && { situation: m.situation }),
    ...(m.training === true && { training: true as const }),
  };
}

/** Прогон по паспорту: каждое ожидание — нужное число раз, в порядке паспорта. */
const full = (p: Passport) => p.expect.flatMap((e, i) => Array.from({ length: e.times ?? 1 }, (_, k) => rec(10 * i + k + 1, e.match)));
const P1 = PASSPORTS[0]!;
const P2 = PASSPORTS[1]!;
const started = new Date(T0);
const end = (list: readonly Interpretation[]) => Math.max(...list.filter((r) => r.source !== "pao_event").map((r) => Date.parse(r.at)));
const run = (p: Passport, list: readonly Interpretation[], nowMs: number) => control(p, list, { now: new Date(nowMs), startedAt: started, waitMs: W });
const item = (r: ReturnType<typeof control>, id: string) => r.items.find((i) => i.id === id)!;

describe("контролёр (К2.2)", () => {
  it("всё по паспорту: до срока — «ждёт» (выполнено N из N), после срока — «принято N из N»", () => {
    const list = full(P1);
    const before = run(P1, list, end(list) + W - 1);
    expect(before).toMatchObject({ state: "waiting", accepted: 0, met: before.total });
    const after = run(P1, list, end(list) + W);
    expect(after.state).toBe("accepted");
    expect(after.accepted).toBe(after.total);
    expect(after.total).toBe(P1.expect.length + P1.forbid.length);
  });

  it("запрет после «всё выполнено», до срока — «не принято»: принято до срока не выдаётся (ревью № 2)", () => {
    const list = full(P1);
    expect(run(P1, list, end(list) + 1).state).toBe("waiting");
    const bad = [...list, rec(500, { stream: "monitor", ref: "POST /participants/v1/mandates/{mandate_id}/sign", source: ["agent_platform"] }, end(list) + 2)];
    const r = run(P1, bad, end(list) + 3);
    expect(r.state).toBe("rejected");
    expect(item(r, "client-sign-only")).toMatchObject({ type: "forbid", state: "rejected", reasons: ["forbidden"], seqs: [500] });
  });

  it("второе «оплачено» до срока — «не принято» сразу (too_many)", () => {
    const list = full(P2);
    const twice = [...list, rec(999, P2.expect.find((e) => e.id === "paid")!.match)];
    const r = run(P2, twice, end(twice) + 1);
    expect(r.state).toBe("rejected");
    expect(item(r, "paid")).toMatchObject({ state: "rejected", reasons: ["too_many"], count: 2, times: 1 });
  });

  it("нет события Платформы: до срока — «ждёт» (missing), после — «не принято»; опоздавшее событие — «принято»", () => {
    const list = full(P1).filter((r) => r.ref !== "mandate.signed");
    expect(item(run(P1, list, end(list) + W - 1), "signed-event")).toMatchObject({ state: "waiting", reasons: ["missing"], met: false });
    expect(item(run(P1, list, end(list) + W), "signed-event")).toMatchObject({ state: "rejected", reasons: ["missing"] });
    const arrived = [...list, rec(99, P1.expect.find((e) => e.id === "signed-event")!.match, end(list) + 3000)];
    expect(run(P1, arrived, end(list) + W).state).toBe("accepted");
  });

  it("часы разошлись: событие Платформы «из будущего» срок не отодвигает; срок — по часам процесса (ревью № 3)", () => {
    const list = full(P1).map((r) => (r.ref === "mandate.signed" ? { ...r, at: new Date(T0 + 3_600_000).toISOString() } : r));
    const r = run(P1, list, end(list) + W);
    expect(r.state).toBe("accepted");
    expect(r.deadline).toBe(new Date(end(list) + W).toISOString());
  });

  it("пустой прогон: срок — от начала прогона, не от «сейчас» — после срока «не принято» (ревью № 1)", () => {
    expect(run(P1, [], T0 + W - 1).state).toBe("waiting");
    const late = run(P1, [], T0 + 3_600_000);
    expect(late.state).toBe("rejected");
    expect(late.deadline).toBe(new Date(T0 + W).toISOString());
    expect(item(late, "created")).toMatchObject({ state: "rejected", reasons: ["missing"] });
  });

  it("опоздал ранний шаг сюжета — «не принято» (order), исходная причина не теряется (ревью № 6, № 7)", () => {
    const list = full(P1).map((r) => (r.ref === "intent.created" ? { ...r, seq: 1000 } : r));
    const r = run(P1, list, end(list) + W);
    expect(r.state).toBe("rejected");
    expect(r.items.some((i) => i.reasons.includes("order"))).toBe(true);
    // Две причины у одного пункта (повторное ревью № 3): шаг «б» нужен дважды, пришёл один раз и раньше шага «а» —
    // «порядок» и «мало», обе; «слишком много» тоже не теряется за «порядком».
    const ab: Passport = {
      ...P1,
      expect: [
        { id: "a", what: P1.title, match: { stream: "scenario", ref: "a" } },
        { id: "b", what: P1.title, match: { stream: "scenario", ref: "b" }, times: 2 },
      ],
      forbid: [],
    };
    const few = [rec(2, { stream: "scenario", ref: "a" }), rec(1, { stream: "scenario", ref: "b" })];
    expect(item(run(ab, few, end(few) + 1), "b")).toMatchObject({ state: "rejected", reasons: ["order", "too_few"] });
    const many = [rec(5, { stream: "scenario", ref: "a" }), ...[1, 2, 3].map((s) => rec(s, { stream: "scenario", ref: "b" }))];
    expect(item(run(ab, many, end(many) + 1), "b").reasons).toEqual(["too_many", "order"]);
  });

  it("итог сюжета раньше события Платформы «оплачено» — «не принято» по отношению «после», а не по порядку шагов (инвариант 6, ревью № 5)", () => {
    // Итог — на своём месте среди шагов сюжета; событие «оплачено» пришло позже итога (seq больше).
    const list = full(P2).map((r) => (r.ref === "operation.authorized" ? { ...r, seq: 10_000 } : r));
    const r = run(P2, list, end(list) + W);
    expect(r.state).toBe("rejected");
    expect(item(r, "outcome").reasons).toEqual(["order"]);
    expect(r.items.filter((i) => i.reasons.includes("order")).map((i) => i.id)).toEqual(["outcome"]);
    // Итог есть, а события «оплачено» нет — тоже нарушение порядка, не «ждёт».
    const none = full(P2).filter((x) => x.ref !== "operation.authorized");
    expect(item(run(P2, none, end(none) + 1), "outcome")).toMatchObject({ state: "rejected" });
  });

  it("ошибки входа: нечитаемое время записи, начала, «сейчас»; срок не число или меньше нуля (ревью № 8)", () => {
    const list = full(P1);
    expect(() => control(P1, [{ ...list[0]!, at: "вчера" }], { now: new Date(T0), startedAt: started, waitMs: W })).toThrow(ControlInputError);
    expect(() => control(P1, list, { now: new Date(T0), startedAt: new Date(NaN), waitMs: W })).toThrow(ControlInputError);
    expect(() => control(P1, list, { now: new Date(NaN), startedAt: started, waitMs: W })).toThrow(ControlInputError);
    expect(() => control(P1, list, { now: new Date(T0), startedAt: started, waitMs: NaN })).toThrow(ControlInputError);
    expect(() => control(P1, list, { now: new Date(T0), startedAt: started, waitMs: -1 })).toThrow(ControlInputError);
  });

  it("срок по умолчанию — не меньше окна перестановки событий Платформы (event_reorder_window_ms, Н-12) с запасом (Р-1386 п. 4)", () => {
    // Окно — из параметров установленного стенда, не литералом (как версия Платформы, З8): читаются только данные.
    const params = JSON.parse(readFileSync(new URL("../../node_modules/agentic-ps-platform/config/params.stand.json", import.meta.url), "utf8")) as { event_reorder_window_ms: number };
    const window = params.event_reorder_window_ms;
    expect(Number.isInteger(window) && window > 0).toBe(true);
    expect(DEFAULT_WAIT_MS).toBeGreaterThanOrEqual(2 * window);
    const list = full(P1);
    expect(control(P1, list, { now: new Date(end(list) + window), startedAt: started }).state).toBe("waiting");
  });
});
