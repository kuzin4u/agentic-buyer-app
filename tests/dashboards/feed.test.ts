// К1.4 DEMO-2 ч. 1: лента экрана «Интерпретация» на подменном источнике — очередь до снимка реестров, порядок по seq,
// сброс при перезапуске источника, отказ снимка, предел, упавший слушатель.
import { describe, expect, it } from "vitest";
import { createInterpretFeed, type FeedEvent } from "../../src/dashboards/feed.js";
import { LOCAL_STAND_EMULATED } from "../../src/dashboards/interpret.js";
import { SourceError, type DashboardSource, type SourceStatus } from "../../src/dashboards/source.js";
import type { DiagSnapshot, WireItem } from "../../src/dashboards/wire.js";

const SNAP: DiagSnapshot = {
  v: 1,
  registries: [
    {
      id: "agent",
      status: "ready",
      components: ["pao"],
      entries: [
        { code: "LIMIT_EXCEEDED", component: "pao", source: ["client", "bank"], action: "after_human", human: { ru: "ч" }, operator: { ru: "о" }, norm: "н", since: "с" },
      ],
    },
  ],
};

function fakeSource(diag: Promise<DiagSnapshot>) {
  let onItem: ((i: WireItem) => void) | undefined;
  const statusL = new Set<(s: SourceStatus) => void>();
  let closed = false;
  const source: DashboardSource = {
    subscribe(l) {
      onItem = l;
      return () => (onItem = undefined);
    },
    onStatus(l) {
      statusL.add(l);
      l("connecting");
      return () => statusL.delete(l);
    },
    diag: () => diag,
    rejected: 0,
    async close() {
      closed = true;
    },
  };
  return {
    source,
    push: (i: WireItem) => onItem?.(i),
    status: (s: SourceStatus) => statusL.forEach((l) => l(s)),
    closed: () => closed,
  };
}

const at = "2026-11-06T10:00:00.000Z";
const declined = (seq: number): WireItem => ({
  stream: "monitor",
  event: { seq, at, source: "pao_event", cls: "decline", what: "operation.declined", code: "LIMIT_EXCEEDED", codeDetail: "CLIENT", ids: {} },
});
const stepItem = (seq: number): WireItem => ({ stream: "scenario", line: { seq, at, step: "intent.signed", params: { mandate_id: "mnd_1" } } });
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("лента «Интерпретации»", () => {
  it("записи до снимка реестров ждут в очереди; после — интерпретируются по снимку, по возрастанию seq", async () => {
    let resolve!: (s: DiagSnapshot) => void;
    const f = fakeSource(new Promise((r) => (resolve = r)));
    const feed = createInterpretFeed(f.source, { emulated: LOCAL_STAND_EMULATED });
    const events: FeedEvent[] = [];
    feed.subscribe((e) => events.push(e));
    f.push(stepItem(5));
    f.push(declined(3));
    expect(feed.list()).toEqual([]);
    expect(feed.diag()).toEqual({ state: "loading" });
    resolve(SNAP);
    await tick();
    expect(feed.diag()).toEqual({ state: "ready" });
    expect(feed.list().map((r) => r.seq)).toEqual([3, 5]);
    expect(feed.list()[0]).toMatchObject({ kind: "conflict", situation: "С-26", who: { status: "found", side: ["client", "bank"] } });
    // Запись с меньшим номером, пришедшая позже, встаёт на своё место.
    f.push(stepItem(4));
    expect(feed.list().map((r) => r.seq)).toEqual([3, 4, 5]);
    expect(events.map((e) => e.type)).toEqual(["diag", "item", "item", "item"]);
  });

  it("перезапуск источника (reset) сбрасывает накопленное; состояние линии передаётся экрану", async () => {
    const f = fakeSource(Promise.resolve(SNAP));
    const feed = createInterpretFeed(f.source, { emulated: LOCAL_STAND_EMULATED });
    await tick();
    f.push(stepItem(1));
    f.status("open");
    expect(feed.status()).toBe("open");
    const events: FeedEvent[] = [];
    feed.subscribe((e) => events.push(e));
    f.status("reset");
    expect(feed.list()).toEqual([]);
    expect(events).toEqual([{ type: "reset" }, { type: "diag", diag: { state: "loading" } }, { type: "status", status: "reset" }]);
    await tick();
    expect(feed.diag()).toEqual({ state: "ready" });
    // После сброса новые записи снова попадают в ленту.
    f.push(stepItem(1));
    expect(feed.list().map((r) => r.seq)).toEqual([1]);
  });

  it("после reset снимок реестров читается заново — у нового экземпляра источника; ответ прежнего запроса отбрасывается (ревью К1.4 № 1, № 12)", async () => {
    const OTHER: DiagSnapshot = { v: 1, registries: [] };
    const answers: ((s: DiagSnapshot) => void)[] = [];
    const f = fakeSource(Promise.resolve(SNAP));
    f.source.diag = () => new Promise((r) => answers.push(r));
    const feed = createInterpretFeed(f.source, { emulated: LOCAL_STAND_EMULATED });
    f.push(declined(1));
    f.status("reset"); // до снимка: очередь очищается
    expect(answers).toHaveLength(2);
    answers[1]!(OTHER);
    answers[0]!(SNAP); // запоздалый ответ прежнему экземпляру
    await tick();
    expect(feed.list()).toEqual([]);
    f.push(declined(1));
    // Снимок нового экземпляра пуст — код без расшифровки; запись прежнего экземпляра не вернулась.
    expect(feed.list().map((r) => [r.seq, r.who?.status])).toEqual([[1, "unknown"]]);
  });

  it("лента полна, а запись младше всех — экрану не отправляется (ревью К1.4 № 8)", async () => {
    const f = fakeSource(Promise.resolve(SNAP));
    const feed = createInterpretFeed(f.source, { emulated: LOCAL_STAND_EMULATED, limit: 2 });
    await tick();
    f.push(stepItem(5));
    f.push(stepItem(6));
    const seen: number[] = [];
    feed.subscribe((e) => e.type === "item" && seen.push(e.item.seq));
    f.push(stepItem(1));
    expect(seen).toEqual([]);
    expect(feed.list().map((r) => r.seq)).toEqual([5, 6]);
  });

  it("снимок не получен — код ошибки адаптера, записи всё равно показываются: коды — без расшифровки («неизвестно»)", async () => {
    const f = fakeSource(Promise.reject(new SourceError("SOURCE_DIAG_TIMEOUT")));
    const feed = createInterpretFeed(f.source, { emulated: LOCAL_STAND_EMULATED });
    await tick();
    expect(feed.diag()).toEqual({ state: "failed", code: "SOURCE_DIAG_TIMEOUT" });
    f.push(declined(1));
    expect(feed.list()[0]!.who).toMatchObject({ status: "unknown", verdict: "unknown" });
  });

  it("предел ленты: старшие по seq вытесняют младшие; упавший слушатель не останавливает ленту; close закрывает источник", async () => {
    const f = fakeSource(Promise.resolve(SNAP));
    const feed = createInterpretFeed(f.source, { emulated: LOCAL_STAND_EMULATED, limit: 2 });
    await tick();
    feed.subscribe(() => {
      throw new Error("экран упал");
    });
    const seen: number[] = [];
    feed.subscribe((e) => e.type === "item" && seen.push(e.item.seq));
    for (const s of [1, 2, 3]) f.push(stepItem(s));
    expect(feed.list().map((r) => r.seq)).toEqual([2, 3]);
    expect(seen).toEqual([1, 2, 3]);
    await feed.close();
    expect(f.closed()).toBe(true);
    f.push(stepItem(4));
    expect(feed.list().map((r) => r.seq)).toEqual([2, 3]);
  });
});
