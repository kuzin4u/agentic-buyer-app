// К2.2г: сюжет 5 «отзыв поручения — следующая попытка отклонена» на живом стенде (Р-1255 п. 3). Отзыв в автотесте —
// эмулятором банка (как подпись, П2 п. 5); на экране демо кнопки «отозвать» нет — отзывает человек на экране банка.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { BusItem, ScenarioLine } from "../../src/demo/bus.js";
import { MESSAGES } from "../../src/demo/i18n.js";
import { startDemo, type Demo } from "../../src/demo/run.js";

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until<T>(f: () => T | undefined, ms = 30_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = f();
    if (v !== undefined) return v;
    if (Date.now() > end) throw new Error("не дождались");
    await pause(50);
  }
}

describe("сюжет 5: отзыв поручения — следующая попытка отклонена", { timeout: 90_000 }, () => {
  let demo: Demo;
  const steps = (): ScenarioLine[] => demo.bus.history().flatMap((i: BusItem) => (i.stream === "scenario" ? [i.line] : []));
  const after = (n: number, name: string) => () => steps().slice(n).find((s) => s.step === name);
  const post = (name: string) => fetch(`${demo.monitor.url}/scenario/${name}`, { method: "POST", headers: { origin: demo.monitor.url } });

  beforeAll(async () => {
    demo = await startDemo({ passMs: 0 });
  }, 30_000);
  afterAll(async () => {
    await demo?.close();
  });

  it("кнопка сюжета 5 и подпись; без поручения — 409; кнопки «отозвать» на демо-экране нет", async () => {
    const html = await (await fetch(`${demo.monitor.url}/`)).text();
    expect(html).toContain('data-scenario="revoke"');
    expect(html).toContain(MESSAGES.ru["scenario.revoke_note"]);
    expect(html).not.toMatch(/\/m\/[^"]*\/revoke/);
    expect((await post("revoke")).status).toBe(409);
  });

  it("человек отзывает поручение в банке → событие → попытка купить остановлена по ответу Платформы, до корзины и оплаты", async () => {
    let n = steps().length;
    expect((await post("intent")).status).toBe(202);
    const w = await until(after(n, "intent.awaiting_signature"));
    const id = String(w.params.mandate_id);
    expect((await demo.stand.stand.issuer.sign(id)).statusCode).toBe(200);
    await until(after(n, "intent.signed"));
    await demo.scenarios.settled();

    n = steps().length;
    expect((await post("revoke")).status).toBe(202);
    expect((await until(after(n, "revoke.ask"))).params.mandate_id).toBe(id);
    // Пока человек не отозвал — попытки нет.
    await pause(800);
    expect(steps().slice(n).some((s) => s.step === "revoke.attempt")).toBe(false);
    const from = demo.stand.stand.calls().length;
    expect((await demo.stand.stand.issuer.revoke(id)).statusCode).toBe(200);
    await until(after(n, "revoke.seen"));
    // По событию агент перечитал поручение у Платформы (GET мандата) — до попытки (ревью К2.2г № 2).
    const atSeen = demo.stand.stand.calls().length;
    expect(demo.stand.stand.calls().slice(from, atSeen).some((c) => c.method === "GET" && c.path === `/pao/v1/mandates/${id}`)).toBe(true);
    const merchantsAtSeen = demo.stand.merchantCalls().length;
    const refused = await until(after(n, "revoke.refused"));
    expect(refused.params).toMatchObject({ code: "MANDATE_REVOKED", state: "STOPPED" });
    await demo.scenarios.settled();
    // Попытку остановил агент: после неё — ни обращений к Платформе (кроме ленты), ни к витринам.
    expect(demo.stand.stand.calls().slice(atSeen).filter((c) => !c.path.startsWith("/pao/v1/events"))).toEqual([]);
    expect(demo.stand.merchantCalls().length).toBe(merchantsAtSeen);
    // Поручение отозвано — дальше только новый сюжет 1.
    expect((await post("purchase")).status).toBe(409);
    expect((await post("revoke")).status).toBe(409);
  });

  it("отзыв до нажатия кнопки 5 (событие уже прочитано ядром) — сюжет не ждёт, попытка сразу остановлена (ревью К2.2г № 3)", async () => {
    let n = steps().length;
    expect((await post("intent")).status).toBe(202);
    const w = await until(after(n, "intent.awaiting_signature"));
    const id = String(w.params.mandate_id);
    expect((await demo.stand.stand.issuer.sign(id)).statusCode).toBe(200);
    await until(after(n, "intent.signed"));
    await demo.scenarios.settled();
    expect((await demo.stand.stand.issuer.revoke(id)).statusCode).toBe(200);
    // Ядро читает ленту и узнаёт об отзыве (как опрос оболочки).
    for (let i = 0; i < 100 && !demo.stand.agent.mandates.revoked(id); i++) {
      await demo.stand.agent.events.signal();
      await pause(100);
    }
    expect(demo.stand.agent.mandates.revoked(id)).toBe(true);
    n = steps().length;
    expect((await post("revoke")).status).toBe(202);
    expect((await until(after(n, "revoke.refused"), 5_000)).params.code).toBe("MANDATE_REVOKED");
    await demo.scenarios.settled();
  });

  it("прервать ожидание отзыва — шаг «прервано»", async () => {
    let n = steps().length;
    expect((await post("intent")).status).toBe(202);
    const w = await until(after(n, "intent.awaiting_signature"));
    expect((await demo.stand.stand.issuer.sign(String(w.params.mandate_id))).statusCode).toBe(200);
    await until(after(n, "intent.signed"));
    await demo.scenarios.settled();
    n = steps().length;
    expect((await post("revoke")).status).toBe(202);
    await until(after(n, "revoke.ask"));
    expect((await post("abort")).status).toBe(202);
    await until(after(n, "aborted"));
    await demo.scenarios.settled();
  });
});
