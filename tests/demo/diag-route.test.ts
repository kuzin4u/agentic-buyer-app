// К1.2 (Р-1273 п. 3, Р-1275 п. 1): снимок реестров диагностики — маршрут стенда /api/diag; экраны получают его через
// адаптер источника. Реестры Платформы — «ждёт передачи» (расхождение № 2). На живом стенде адаптер читает и ленту.
import { request } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { localStandSource, type DashboardSource } from "../../src/dashboards/source.js";
import { INSTANCE_HEADER, type WireItem } from "../../src/dashboards/wire.js";
import { buildDiagSnapshot } from "../../src/demo/diag.js";
import { startDemo, type Demo } from "../../src/demo/run.js";

const ENTRY_KEYS = ["action", "code", "component", "human", "norm", "operator", "since", "source"];

describe("снимок реестров (сборка контура)", () => {
  const snap = buildDiagSnapshot();

  it("агент и продавец — ready, с записями; Платформа — pending, без записей", () => {
    expect(snap.registries.map((r) => [r.id, r.status])).toEqual([
      ["agent", "ready"],
      ["merchant", "ready"],
      ["platform", "pending"],
    ]);
    const [agent, merchant, platform] = snap.registries;
    expect(agent!.entries.length).toBeGreaterThan(20);
    expect(merchant!.entries.length).toBeGreaterThan(0);
    expect(platform!.entries).toEqual([]);
    expect(platform!.components).toEqual(["platform", "pi"]);
  });

  it("коды ПАО и агента на месте: MANDATE_REVOKED, LIMIT_EXCEEDED (ПАО), NO_RESPONSE (агент)", () => {
    const agent = snap.registries[0]!;
    const by = new Map(agent.entries.map((e) => [e.code, e]));
    expect(by.get("MANDATE_REVOKED")?.component).toBe("pao");
    expect(by.get("LIMIT_EXCEEDED")?.component).toBe("pao");
    expect(by.get("NO_RESPONSE")?.component).toBe("agent");
    expect(agent.components).toEqual(expect.arrayContaining(["pao", "agent"]));
  });

  it("в записи — только поля формата К17, тексты — только ru/en (поломка: лишнее поле — красный)", () => {
    for (const r of snap.registries)
      for (const e of r.entries) {
        expect(Object.keys(e).sort()).toEqual(ENTRY_KEYS);
        expect(Object.keys(e.human).every((l) => l === "ru" || l === "en")).toBe(true);
        expect(Object.keys(e.operator).every((l) => l === "ru" || l === "en")).toBe(true);
      }
  });
});

describe("живой стенд: адаптер читает /api/diag и /events", () => {
  let demo: Demo;
  let src: DashboardSource;
  beforeAll(async () => {
    demo = await startDemo({ passMs: 0 });
    src = localStandSource(demo.monitor.url, { retryMs: 50 });
  }, 60_000);
  afterAll(async () => {
    await src?.close();
    await demo?.close();
  });

  it("снимок через адаптер равен снимку сборки, отброшенных нет", async () => {
    expect(await src.diag()).toEqual(buildDiagSnapshot());
    expect(src.rejected).toBe(0);
  });

  it("запись шины стенда приходит в адаптер по форме линии (контракт bus ↔ wire)", async () => {
    const got: WireItem[] = [];
    src.subscribe((i) => got.push(i));
    demo.bus.scenario({ step: "intent.created", params: { mandate_id: "mdt_demo", limit: { amount: 100000, currency: "RUB" } } });
    const end = Date.now() + 5000;
    while (!got.some((i) => i.stream === "scenario" && i.line.step === "intent.created") && Date.now() < end) await new Promise((r) => setTimeout(r, 20));
    const line = got.find((i) => i.stream === "scenario" && i.line.step === "intent.created");
    expect(line).toMatchObject({ stream: "scenario", line: { params: { mandate_id: "mdt_demo", limit: { minor: 100000, currency: "RUB" } } } });
    expect(src.rejected).toBe(0);
  });

  it("/api/diag — только GET, JSON, под CSP и nosniff; чужой Host — 421", async () => {
    const r = await fetch(`${demo.monitor.url}/api/diag`, { method: "POST" });
    expect(r.status).toBe(405);
    const g = await fetch(`${demo.monitor.url}/api/diag`);
    expect(g.status).toBe(200);
    expect(g.headers.get("content-type")).toMatch(/^application\/json/);
    expect(g.headers.get("content-security-policy")).toMatch(/default-src 'self'/);
    expect(g.headers.get("x-content-type-options")).toBe("nosniff");
    const port = new URL(demo.monitor.url).port;
    const status = await new Promise<number>((ok, fail) => {
      const req = request({ host: "127.0.0.1", port, path: "/api/diag", headers: { host: "evil.example" } }, (res) => {
        res.resume();
        ok(res.statusCode ?? 0);
      });
      req.on("error", fail);
      req.end();
    });
    expect(status).toBe(421);
  });

  it("/events несёт номер экземпляра шины (адаптер узнаёт перезапуск стенда)", async () => {
    const ac = new AbortController();
    const r = await fetch(`${demo.monitor.url}/events`, { signal: ac.signal });
    expect(r.headers.get(INSTANCE_HEADER)).toMatch(/^[0-9a-f-]{36}$/);
    ac.abort();
    await r.body?.cancel().catch(() => undefined);
  });
});
