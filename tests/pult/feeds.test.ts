// П-5.2: «Ленты» пульта — модуль `src/pult/feeds.ts` (строки «простыми словами» и «шины», сводка транзакции — К1.4 № 6) и
// лента `/pult/feeds`. Журнал стенда в ленты не попадает; пересчёт — не чаще раза в 200 мс; сброс — сразу пусто.
import { readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { LABELS } from "../../src/dashboards/phrases.js";
import { MonitorBus } from "../../src/demo/bus.js";
import { startMonitorServer } from "../../src/demo/server.js";
import { loadSituationTitles, SITUATIONS_FILE } from "../../src/demo/situations.js";
import { specifiers } from "../support/imports.js";
import { createInterpretFeed, type FeedEvent, type InterpretFeed } from "../../src/dashboards/feed.js";
import { LOCAL_STAND_EMULATED, type Interpretation } from "../../src/dashboards/interpret.js";
import { localStandSource } from "../../src/dashboards/source.js";
import { startDemo, type Demo } from "../../src/demo/run.js";
import { createFeedsFeed, FEEDS_LABELS, feedsLabels, feedsView, type FeedsEvent, type FeedsView } from "../../src/pult/feeds.js";

const rec = (seq: number, o: Partial<Interpretation> = {}): Interpretation =>
  ({
    seq,
    at: new Date(Date.UTC(2026, 10, 12, 12, 0, seq)).toISOString(),
    stream: "scenario",
    ref: `step.${seq}`,
    level: "key",
    stage: "mandate",
    actor: "agent",
    emulated: false,
    kind: "norm",
    phrase: { ru: `фраза ${seq}`, en: `phrase ${seq}` },
    ...o,
  }) as Interpretation;

function fakeFeed(list: Interpretation[]) {
  const ls = new Set<(e: FeedEvent) => void>();
  const feed: InterpretFeed = {
    list: () => list,
    status: () => "open",
    diag: () => ({ state: "ready" }),
    subscribe: (l) => (ls.add(l), () => ls.delete(l)),
    close: async () => undefined,
  };
  return { feed, emit: (e: FeedEvent) => ls.forEach((l) => l(e)), list, listeners: ls };
}

describe("П-5.2: модуль «Лент»", () => {
  it("последние N записей по номеру; строка «простыми словами» — фраза, участник, вид; строка шины — поток, что пришло, идентификаторы", () => {
    const items = [rec(3, { stream: "monitor", ref: "operation.authorized", source: "pao_event", ids: { op_ref: "op-1" } }), rec(1), rec(2)];
    const v = feedsView(items, 2);
    expect(v.plain.map((r) => r.seq)).toEqual([2, 3]);
    expect(v.plain[1]).toMatchObject({ actor: "agent", kind: "norm", stage: "mandate", phrase: { ru: "фраза 3", en: "phrase 3" } });
    // Запись с операцией модель транзакций сама делает транзакцией по первому звену (`op:…`) — строка помечена ею.
    expect(v.bus[1]).toEqual({ seq: 3, at: items[0]!.at, stream: "monitor", ref: "operation.authorized", source: "pao_event", ids: { op_ref: "op-1" }, tx: v.bus[1]!.tx });
    expect(v.bus[1]!.tx).toMatch(/op-1/);
    expect(v.txs[v.bus[1]!.tx!]).toMatchObject({ records: 1, linkConflict: false });
    expect(Object.keys(v.plain[0]!)).not.toContain("tx"); // без транзакции — без поля
  });

  it("подписи ru и en — у каждого ключа, непустые; участники, виды, стадии и «эмулятор» — те же, что на экране «Интерпретация» (ревью № 3)", () => {
    for (const [k, t] of Object.entries(FEEDS_LABELS)) for (const l of ["ru", "en"] as const) expect(t[l].trim(), `${k} ${l}`).not.toBe("");
    for (const l of ["ru", "en"] as const) {
      const f = feedsLabels(l);
      expect(f["feeds.view.bus"]).toBe(l === "en" ? "Bus" : "Шина");
      for (const [k, v] of Object.entries(LABELS.role)) expect(f[`actor.${k}`], k).toBe(v[l]);
      for (const [k, v] of Object.entries(LABELS.kind)) expect(f[`kind.${k}`], k).toBe(v[l]);
      for (const [k, v] of Object.entries(LABELS.stage)) expect(f[`stage.${k}`], k).toBe(v[l]);
      expect(f["feeds.emulated"]).toBe(LABELS.emulated[l]);
    }
  });

  it("сводка — у всех транзакций модели, и у той, чьи записи ушли за окно строк (ревью № 1)", () => {
    const items = [rec(1, { stream: "monitor", ref: "operation.authorized", source: "pao_event", ids: { op_ref: "op-old" } }), rec(2), rec(3), rec(4)];
    const v = feedsView(items, 2);
    expect(v.plain.map((r) => r.seq)).toEqual([3, 4]);
    const old = Object.values(v.txs).find((t) => t.id.includes("op-old"));
    expect(old).toMatchObject({ records: 1 });
  });

  it("лента: пересчёт не чаще раза в debounce; журнал стенда и статус не пересчитывают; reset — сразу пусто; close — тишина", () => {
    vi.useFakeTimers();
    try {
      const f = fakeFeed([rec(1)]);
      const ff = createFeedsFeed(f.feed, { debounceMs: 200 });
      const got: FeedsEvent[] = [];
      ff.subscribe((e) => got.push(e));
      expect(ff.view().plain.map((r) => r.seq)).toEqual([1]);
      // Только журнал стенда и статус — пересчёта нет вовсе (журнал — для движка, П-11.2а).
      f.emit({ type: "stand", line: { seq: 8, at: rec(8).at, entry: { seq: 1, at: rec(8).at, kind: "fault", what: "ARMED", ids: {} } } });
      f.emit({ type: "status", status: "open" });
      vi.advanceTimersByTime(500);
      expect(got).toEqual([]);
      f.list.push(rec(2), rec(3));
      f.emit({ type: "item", item: f.list[1]! });
      f.emit({ type: "item", item: f.list[2]! });
      f.emit({ type: "stand", line: { seq: 9, at: rec(9).at, entry: { seq: 1, at: rec(9).at, kind: "fault", what: "ARMED", ids: {} } } });
      f.emit({ type: "status", status: "open" });
      expect(got).toEqual([]);
      vi.advanceTimersByTime(200);
      expect(got.map((e) => e.type)).toEqual(["feeds"]);
      expect((got[0] as { view: FeedsView }).view.plain.map((r) => r.seq)).toEqual([1, 2, 3]);
      // Событие без новой записи (тот же отпечаток ленты) — вид не шлётся повторно (ревью № 2).
      f.emit({ type: "item", item: f.list[2]! });
      vi.advanceTimersByTime(200);
      expect(got.map((e) => e.type)).toEqual(["feeds"]);
      f.emit({ type: "reset" });
      expect(got.at(-1)).toEqual({ type: "reset" });
      expect(ff.view()).toEqual({ plain: [], bus: [], txs: {} });
      ff.close();
      expect(f.listeners.size).toBe(0);
      f.emit({ type: "item", item: rec(4) });
      vi.advanceTimersByTime(500);
      expect(got.map((e) => e.type)).toEqual(["feeds", "reset"]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("П-5.2: границы «Лент» и путь библиотеки ситуаций", () => {
  it("В17 (а): модуль «Лент» только читает — импортирует лишь типы ленты экранов, словарь экрана «Интерпретация» и модель транзакций; в шину и ленту экранов не пишет, в interpret не идёт", () => {
    const src = readFileSync(join(import.meta.dirname, "../../src/pult/feeds.ts"), "utf8");
    expect(specifiers(src).sort()).toEqual(["../dashboards/feed.js", "../dashboards/interpret.js", "../dashboards/phrases.js", "../dashboards/wire.js", "./tx.js"]);
    expect(src).not.toMatch(/\binterpret\(|\.scenario\(|\bpush\(\{ stream/);
  });

  it("без режима дашбордов `/pult/feeds` и `/pult/feeds.js` — 404 (ревью № 7)", async () => {
    const bus = new MonitorBus({
      calls: () => [],
      merchantCalls: () => [],
      journal: () => [],
      listenFeed: () => () => undefined,
      isAgentKid: () => false,
      confirmation: async () => undefined,
      now: () => new Date(),
    });
    const server = await startMonitorServer({
      bus,
      urls: { pao: "http://127.0.0.1:1", merchants: "http://127.0.0.1:2", bankApp: "http://127.0.0.1:3", upk: "http://127.0.0.1:4" },
      agentCode: "agent:x",
      brandPath: "config/brand.demo.json",
    });
    try {
      for (const p of ["/pult/feeds", "/pult/feeds.js"]) expect((await fetch(`${server.url}${p}`)).status, p).toBe(404);
    } finally {
      await server.close();
    }
  });

  it("К1.4 № 11: библиотека ситуаций — от корня пакета, а не от рабочего каталога", () => {
    expect(isAbsolute(SITUATIONS_FILE)).toBe(true);
    expect(SITUATIONS_FILE).toBe(resolve(import.meta.dirname, "../../docs/reference/situations.md"));
    expect(Object.keys(loadSituationTitles()).length).toBe(28);
  });
});

describe("П-5.2: живой стенд — сводка транзакции (К1.4 № 6) и лента /pult/feeds", { timeout: 90_000 }, () => {
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
  async function until<T>(f: () => T | undefined, ms = 60_000): Promise<T> {
    const end = Date.now() + ms;
    for (;;) {
      const v = f();
      if (v !== undefined) return v;
      if (Date.now() > end) throw new Error("не дождались");
      await pause(100);
    }
  }
  const post = (p: string) => fetch(`${demo.monitor.url}${p}`, { method: "POST", headers: { origin: demo.monitor.url } });

  it("сюжет 2 в «Авто»: у корзины — сводка со стадией «итог», итогом «оплачено» по событию, продавцом и числом записей; строки ленты помечены транзакцией; журнала стенда в лентах нет", async () => {
    demo.clientEmulator!.setAuto(true);
    expect((await post("/scenario/intent")).status).toBe(202);
    await until(() => (demo.bus.history().some((i) => i.stream === "scenario" && i.line.step === "intent.signed") ? true : undefined));
    await demo.scenarios.settled();
    expect((await post("/scenario/purchase")).status).toBe(202);
    const cart = await until(() => {
      const s = demo.bus.history().find((i) => i.stream === "scenario" && i.line.step === "cart.created");
      return s && s.stream === "scenario" ? String(s.line.params.mandate_id) : undefined;
    });
    const v = await until(() => {
      const view = feedsView(feed.list());
      return view.txs[cart]?.outcome === "paid" ? view : undefined;
    });
    expect(v.txs[cart]).toMatchObject({ id: cart, stage: "outcome", outcome: "paid", linkConflict: false });
    expect(v.txs[cart]!.records).toBeGreaterThan(3);
    expect(v.txs[cart]!.merchantIds.length).toBeGreaterThan(0);
    expect(v.plain.filter((r) => r.tx === cart).length).toBe(v.bus.filter((r) => r.tx === cart).length);
    expect(v.bus.some((r) => r.tx === cart && r.stream === "monitor" && r.ref === "operation.authorized")).toBe(true);
    expect(new Set(v.bus.map((r) => r.stream))).not.toContain("stand");
    demo.clientEmulator!.setAuto(false);
  });

  it("лента /pult/feeds: первым — подписи на языке запроса, затем вид лент", async () => {
    const ac = new AbortController();
    const res = await fetch(`${demo.monitor.url}/pult/feeds?lang=en`, { signal: ac.signal, headers: { accept: "text/event-stream" } });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const reader = res.body!.getReader();
    let text = "";
    while ((text.match(/^data: /gm) ?? []).length < 2) text += new TextDecoder().decode((await reader.read()).value);
    ac.abort();
    await reader.cancel().catch(() => undefined);
    const msgs = text.split("\n").filter((l) => l.startsWith("data: ")).map((l) => JSON.parse(l.slice(6)) as { type: string; labels?: Record<string, string>; view?: FeedsView });
    expect(msgs[0]!.type).toBe("hello");
    expect(msgs[0]!.labels!["feeds.view.plain"]).toBe("In plain words");
    expect(msgs[1]!.type).toBe("feeds");
    expect(Array.isArray(msgs[1]!.view!.plain)).toBe(true);
  });
});
