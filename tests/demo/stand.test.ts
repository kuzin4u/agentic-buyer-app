// К1.2 (П2): демо-стенд поднимается, всё слушает только 127.0.0.1, настоящий агент допущен стендом.
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startDemoStand, type DemoStand } from "../../src/demo/stand.js";

describe("демо-стенд: запуск", () => {
  let demo: DemoStand;
  beforeAll(async () => {
    // Без фоновых проходов: этому тесту они не нужны, а время в них — лишняя зависимость (ревью К2.2а № 7).
    demo = await startDemoStand({ passMs: 0 });
  }, 30_000);
  afterAll(async () => {
    await demo?.close();
  });

  it("адреса всех экранов и служб — только 127.0.0.1", () => {
    for (const url of Object.values(demo.urls)) expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  });

  it("серверы слушают 127.0.0.1, а не все интерфейсы", () => {
    const apps = [demo.stand.app, demo.merchants.app, demo.stand.bankApp.app, demo.stand.upk.app];
    for (const app of apps) {
      const addr = app.server.address() as AddressInfo | null;
      expect(addr?.address).toBe("127.0.0.1");
    }
  });

  it("агент допущен: самопроверка старта без отказов", () => {
    const report = demo.agent.selfCheck();
    expect(report?.ready).toBe(true);
    expect(report?.checks.length).toBeGreaterThan(0);
    expect(report?.checks.filter((c) => c.status === "fail")).toEqual([]);
  });

  it("агент ходит в ПАО стенда по сети — обращение допуска в журнале стенда", () => {
    const network = demo.stand.calls().filter((c) => c.source === "network");
    expect(network.some((c) => c.method === "GET" && c.path === "/pao/v1/agent" && c.status === 200)).toBe(true);
  });
});
