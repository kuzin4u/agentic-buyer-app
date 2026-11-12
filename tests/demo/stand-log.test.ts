// П-11.2а (Р-1514): журнал сбоев и действий стенда — четвёртый поток линии `stand`: шина → `/events` → источник → лента экранов
// → событие `stand` (для движка пульта, `standLog`). Обязательные проверки владельца: (1) запись стенда не становится строкой
// консоли ни на «Интерпретации», ни на «Контроле»; (2) событие `stand` не сдвигает срок прогона «Контроля» и в прогон не
// попадает; (3) номера потока `stand` не ломают номера остальных потоков.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEMO_TESTS } from "agentic-ps-platform/stand";
import { createControlFeed } from "../../src/dashboards/control-feed.js";
import { createInterpretFeed, type FeedEvent, type InterpretFeed } from "../../src/dashboards/feed.js";
import { LOCAL_STAND_EMULATED, type Interpretation } from "../../src/dashboards/interpret.js";
import { PASSPORTS } from "../../src/dashboards/passports.js";
import { localStandSource, type DashboardSource } from "../../src/dashboards/source.js";
import { parseWireStand, STAND_LOG_HEADER, WIRE_STAND_ID_KEYS, WIRE_STAND_TESTS, WIRE_STAND_WHAT, type WireItem, type WireStandItem } from "../../src/dashboards/wire.js";
import { STAND_ID_FIELDS, STAND_LOG_WHAT, STAND_TESTS } from "../../src/pult/standlog.js";
import { MonitorBus, STAND_ENTRY_ID_KEYS, type BusItem } from "../../src/demo/bus.js";
import { startDemo, type Demo } from "../../src/demo/run.js";

const AT = "2026-11-12T12:00:00.000Z";
const standRaw = (seq: number, entry: Record<string, unknown>) => ({ stream: "stand", line: { seq, at: AT, entry } });
const ENTRY = { seq: 1, at: AT, kind: "fault", test: "Н-03", what: "ARMED", ids: {} };

describe("П-11.2а: форма потока stand на линии", () => {
  it("перечни линии — те же, что у движка пульта (`standlog.ts`) и у стенда (DEMO_TESTS)", () => {
    expect([...WIRE_STAND_TESTS]).toEqual([...STAND_TESTS]);
    expect([...WIRE_STAND_TESTS]).toEqual([...DEMO_TESTS]);
    expect([...WIRE_STAND_WHAT]).toEqual([...STAND_LOG_WHAT]);
    expect([...WIRE_STAND_ID_KEYS]).toEqual([...STAND_ID_FIELDS]);
  });

  it("разбор: запись по форме — как есть; лишнее поле (review) не переносится; не по форме — целиком отброшена", () => {
    expect(parseWireStand(standRaw(7, { ...ENTRY, ids: { shop_id: "SHOP-1" }, review: { condition: "R32", violator: "MERCHANT" } }))).toEqual({
      stream: "stand",
      line: { seq: 7, at: AT, entry: { ...ENTRY, ids: { shop_id: "SHOP-1" } } },
    });
    for (const bad of [
      { ...ENTRY, what: "PAN_LEAKED" },
      { ...ENTRY, test: "Н-13" },
      { ...ENTRY, kind: "other" },
      { ...ENTRY, ids: { card: "x" } },
      { ...ENTRY, ids: { order_id: "" } },
      { ...ENTRY, seq: 0 },
    ])
      expect(parseWireStand(standRaw(7, bad)), JSON.stringify(bad)).toBeUndefined();
    expect(parseWireStand({ stream: "console", line: { seq: 1, at: AT, kind: "x" } })).toBeUndefined();
  });
});

describe("П-11.2а: на шину — только идентификаторы из перечня (ревью № 2)", () => {
  it("поле ids вне перечня стенда на шину не идёт; перечень шины = перечню линии", () => {
    expect([...STAND_ENTRY_ID_KEYS]).toEqual([...WIRE_STAND_ID_KEYS]);
    const log = [{ seq: 1, at: AT, kind: "fault", test: "Н-03", what: "PAID_BEFORE_OUTCOME", ids: { order_id: "ORD-1", shop_id: "SHOP-1", merchant_id: "", card: "секрет" } }];
    const bus = new MonitorBus({
      calls: () => [],
      merchantCalls: () => [],
      journal: () => [],
      listenFeed: () => () => undefined,
      isAgentKid: () => false,
      confirmation: async () => undefined,
      now: () => new Date(AT),
      standLog: () => log as never,
    });
    bus.poll();
    const lines = bus.history().flatMap((i) => (i.stream === "stand" ? [i.line] : []));
    expect(lines.map((l) => l.entry.ids)).toEqual([{ order_id: "ORD-1", shop_id: "SHOP-1" }]);
    bus.poll(); // повторное чтение — без повторов
    expect(bus.history().filter((i) => i.stream === "stand")).toHaveLength(1);
  });
});

/** Подменённый источник: записи участников и журнал стенда — раздельно, как у `localStandSource`. */
function fakeSource() {
  const items = new Set<(i: WireItem) => void>();
  const stands = new Set<(i: WireStandItem) => void>();
  const statuses = new Set<(s: "open" | "reset") => void>();
  const source: DashboardSource = {
    subscribe: (l) => (items.add(l), () => void items.delete(l)),
    subscribeStand: (l) => (stands.add(l), () => void stands.delete(l)),
    onStatus: (l) => (statuses.add(l as (s: "open" | "reset") => void), () => void statuses.delete(l as (s: "open" | "reset") => void)),
    diag: async () => ({ v: 1, registries: [] }),
    rejected: 0,
    close: async () => undefined,
  };
  return {
    source,
    stand: (seq: number, at = AT) => stands.forEach((l) => l(parseWireStand({ stream: "stand", line: { seq, at, entry: { ...ENTRY, seq } } })!)),
    scenario: (seq: number, at: string, step: string) => items.forEach((l) => l({ stream: "scenario", line: { seq, at, step, params: {} } })),
    reset: () => statuses.forEach((l) => l("reset")),
  };
}

describe("П-11.2а: лента экранов — журнал стенда отдельным событием", () => {
  it("проверка 1: запись стенда — событие stand и standLog(), а не интерпретация (ни строки консоли, ни иной); до снимка реестров — тоже сразу", async () => {
    const f = fakeSource();
    const feed = createInterpretFeed(f.source, { emulated: LOCAL_STAND_EMULATED });
    const events: FeedEvent[] = [];
    feed.subscribe((e) => events.push(e));
    f.stand(5);
    f.stand(3);
    await new Promise((r) => setTimeout(r, 0));
    expect(feed.list()).toEqual([]);
    expect(events.filter((e) => e.type === "item")).toEqual([]);
    expect(events.filter((e) => e.type === "stand").map((e) => (e.type === "stand" ? e.line.seq : 0))).toEqual([5, 3]);
    expect(feed.standLog?.().map((l) => l.seq)).toEqual([3, 5]); // по номеру шины
    f.stand(5); // повтор номера — та же запись (ревью № 7)
    expect(feed.standLog?.().map((l) => l.seq)).toEqual([3, 5]);
    f.reset();
    expect(feed.standLog?.()).toEqual([]);
    await feed.close();
  });

  it("проверка 2, сквозная (ревью № 4): источник → лента → «Контроль» — запись стенда позже прогона срок не сдвигает и в прогон не попадает", async () => {
    const T0 = Date.parse(AT);
    const iso = (ms: number) => new Date(T0 + ms).toISOString();
    const build = async (withStand: boolean) => {
      const f = fakeSource();
      const feed = createInterpretFeed(f.source, { emulated: LOCAL_STAND_EMULATED });
      await new Promise((r) => setTimeout(r, 0)); // снимок реестров
      const c = createControlFeed(feed, { now: () => new Date(T0 + 2000), waitMs: 5000, tickMs: 0 });
      f.scenario(10, iso(0), "run.intent");
      f.scenario(11, iso(100), "intent.created");
      if (withStand) f.stand(12, iso(1500)); // позже последней записи прогона
      c.recompute();
      const runs = JSON.stringify(c.runs());
      c.close();
      await feed.close();
      return runs;
    };
    const plain = await build(false);
    expect(plain).toContain('"key":10');
    const stand = await build(true);
    expect(stand).toBe(plain);
  });

  it("проверка 2, модульно: control-feed пропускает событие stand — прогон и срок те же", () => {
    const listeners = new Set<(e: FeedEvent) => void>();
    const T0 = Date.parse(AT);
    const recs: Interpretation[] = PASSPORTS[0]!.expect.map((e, i) => ({
      seq: 100 + i,
      at: new Date(T0 + i).toISOString(),
      stream: e.match.stream ?? "console",
      ref: e.match.ref ?? "x",
      level: "key",
      stage: "mandate",
      actor: e.match.actor ?? "agent",
      emulated: false,
      kind: e.match.kind ?? "norm",
      phrase: { ru: "—", en: "—" },
    }));
    const feed: InterpretFeed = {
      list: () => recs,
      status: () => "open",
      diag: () => ({ state: "ready" }),
      subscribe: (l) => (listeners.add(l), () => listeners.delete(l)),
      close: async () => undefined,
    };
    let now = T0 + 1000;
    const c = createControlFeed(feed, { now: () => new Date(now), waitMs: 5000, tickMs: 0 });
    c.recompute();
    const before = JSON.stringify(c.runs());
    // Запись стенда пришла позже последней записи прогона — срок (последняя запись + 5 с) от неё не сдвигается.
    const st = parseWireStand({ stream: "stand", line: { seq: 999, at: new Date(T0 + 4000).toISOString(), entry: ENTRY } })!;
    listeners.forEach((l) => l({ type: "stand", line: st.line }));
    c.recompute();
    expect(JSON.stringify(c.runs())).toBe(before);
    now = T0 + 7000;
    c.recompute();
    const after = c.runs();
    expect(JSON.stringify(after)).not.toContain('"seq":999');
    c.close();
  });
});

describe("П-11.2а: живой стенд — журнал стенда до ленты экранов (DEMO_FAULTS=1)", { timeout: 60_000 }, () => {
  let demo: Demo;
  let feed: InterpretFeed;
  let source: DashboardSource;
  beforeAll(async () => {
    demo = await startDemo({ faults: true });
    source = localStandSource(demo.monitor.url);
    feed = createInterpretFeed(source, { emulated: LOCAL_STAND_EMULATED });
  }, 30_000);
  afterAll(async () => {
    await feed?.close();
    await demo?.close();
  });
  const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
  async function until<T>(f: () => T | undefined, ms = 20_000): Promise<T> {
    const end = Date.now() + ms;
    for (;;) {
      const v = f();
      if (v !== undefined) return v;
      if (Date.now() > end) throw new Error("не дождались");
      await pause(50);
    }
  }

  it("взвод, снятие и пометка стенда → строки stand на шине и в standLog() ленты — та же форма, что stand.demo.log()", async () => {
    const d = demo.stand.stand.demo!;
    const from = d.log().length;
    d.arm("Н-11");
    d.disarm("Н-11");
    d.mark("Н-01", { order_id: "ORD-stand-log" });
    demo.bus.poll();
    const want = d.log().slice(from).map(({ seq, at, kind, test, what, ids }) => ({ seq, at, kind, ...(test !== undefined && { test }), what, ids: { ...ids } }));
    expect(want.map((e) => e.what)).toEqual(["ARMED", "DISARMED", "MARKED"]);
    const onBus = demo.bus.history().flatMap((i: BusItem) => (i.stream === "stand" ? [i.line.entry] : []));
    expect(onBus.slice(-3)).toEqual(want);
    const got = await until(() => {
      const l = feed.standLog?.() ?? [];
      return l.length >= 3 ? l.slice(-3) : undefined;
    });
    expect(got.map((l) => l.entry)).toEqual(want);
    expect(source.rejected).toBe(0);
  });

  it("проверки 1 и 3: номера шины уникальны во всех четырёх потоках; записи стенда не становятся интерпретациями; записи участников после них доходят", async () => {
    const standSeqs = new Set((feed.standLog?.() ?? []).map((l) => l.seq));
    expect(standSeqs.size).toBeGreaterThan(0);
    const n = demo.bus.history().length;
    const r = await fetch(`${demo.monitor.url}/scenario/intent`, { method: "POST", headers: { origin: demo.monitor.url } });
    expect(r.status).toBe(202);
    const step = await until(() => feed.list().find((x) => x.stream === "scenario" && x.ref === "intent.awaiting_signature"));
    expect(Math.min(...standSeqs)).toBeLessThan(step.seq);
    const seqs = demo.bus.history().map((i) => (i.stream === "monitor" ? i.event.seq : i.line.seq));
    expect(new Set(seqs).size).toBe(seqs.length);
    expect(demo.bus.history().length).toBeGreaterThan(n);
    // Ни одна интерпретация не несёт номер записи стенда; консоль — только журнал агента.
    expect(feed.list().filter((x) => standSeqs.has(x.seq))).toEqual([]);
    expect(feed.list().filter((x) => x.stream === "console" && /ARMED|DISARMED|MARKED/.test(x.ref))).toEqual([]);
    expect(source.rejected).toBe(0);
    await fetch(`${demo.monitor.url}/scenario/abort`, { method: "POST", headers: { origin: demo.monitor.url } });
    await demo.scenarios.settled();
  });

  /** Записи `/events`, пришедшие за `ms` после подключения (история отдаётся сразу при подключении). */
  async function events(headers: Record<string, string>, ms = 600): Promise<{ stream: string }[]> {
    const ac = new AbortController();
    const res = await fetch(`${demo.monitor.url}/events`, { signal: ac.signal, headers: { accept: "text/event-stream", ...headers } });
    const reader = res.body!.getReader();
    let text = "";
    const stop = setTimeout(() => ac.abort(), ms);
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        text += new TextDecoder().decode(value);
      }
    } catch {
      // оборвали по сроку
    } finally {
      clearTimeout(stop);
      await reader.cancel().catch(() => undefined);
    }
    return text.split("\n").filter((l) => l.startsWith("data: ")).map((l) => JSON.parse(l.slice(6)) as { stream: string });
  }

  it("блокер ревью № 1: страница монитора (`/events` без заголовка) потока stand не получает — строкой консоли он не станет; источник дашбордов (заголовок) — получает", async () => {
    const plain = await events({});
    expect(plain.length).toBeGreaterThan(0);
    expect(plain.filter((i) => i.stream === "stand")).toEqual([]);
    expect((await events({ [STAND_LOG_HEADER]: "0" })).filter((i) => i.stream === "stand")).toEqual([]);
    const withStand = await events({ [STAND_LOG_HEADER]: "1" });
    expect(withStand.filter((i) => i.stream === "stand").length).toBeGreaterThanOrEqual(3);
  });
});

describe("П-11.2а: без режима сбоев потока stand нет", () => {
  let demo: Demo;
  beforeAll(async () => {
    demo = await startDemo();
  }, 30_000);
  afterAll(async () => {
    await demo?.close();
  });

  it("на шине нет ни одной строки stand", () => {
    demo.bus.poll();
    expect(demo.bus.history().filter((i) => i.stream === "stand")).toEqual([]);
  });
});
