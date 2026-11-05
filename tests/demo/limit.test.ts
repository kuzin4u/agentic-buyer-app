// К2.2б: сюжет 3 «отказ: превышен лимит клиента в банке» на живом стенде (Р-1255 п. 1). Лимит ставит эмулятор банка;
// отказывает ADP Платформы; итог — событие operation.declined (сборщик итогов — фоновый проход стенда); лимит снимается.
// Подпись в автотесте — эмулятором банка (П2 п. 5).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { BusItem, MonitorEvent, ScenarioLine } from "../../src/demo/bus.js";
import { MESSAGES } from "../../src/demo/i18n.js";
import { DEMO_PRINCIPAL } from "../../src/demo/scenarios.js";
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

describe("сюжет 3: отказ — превышен лимит клиента в банке", { timeout: 90_000 }, () => {
  let demo: Demo;
  const steps = (): ScenarioLine[] => demo.bus.history().flatMap((i: BusItem) => (i.stream === "scenario" ? [i.line] : []));
  const events = (): MonitorEvent[] => demo.bus.history().flatMap((i: BusItem) => (i.stream === "monitor" ? [i.event] : []));
  const after = (n: number, name: string) => () => steps().slice(n).find((s) => s.step === name);
  const post = (name: string) => fetch(`${demo.monitor.url}/scenario/${name}`, { method: "POST", headers: { origin: demo.monitor.url } });

  beforeAll(async () => {
    demo = await startDemo();
  }, 30_000);
  afterAll(async () => {
    await demo?.close();
  });

  it("кнопка и подпись сюжета 3 на странице; без поручения — 409", async () => {
    const html = await (await fetch(`${demo.monitor.url}/`)).text();
    expect(html).toContain('data-scenario="limit"');
    expect(html).toContain(MESSAGES.ru["scenario.limit"]);
    expect((await post("limit")).status).toBe(409);
  });

  it("лимит банка ниже итога → ADP LIMIT_EXCEEDED → operation.declined красным с кодом; лимит снят; оплаты нет", async () => {
    let n = steps().length;
    expect((await post("intent")).status).toBe(202);
    const w = await until(after(n, "intent.awaiting_signature"));
    expect((await demo.stand.stand.issuer.sign(String(w.params.mandate_id))).statusCode).toBe(200);
    await until(after(n, "intent.signed"));
    await demo.scenarios.settled();

    n = steps().length;
    expect((await post("limit")).status).toBe(202);
    const card = await until(after(n, "cart.card"));
    expect((await post("cart/accept")).status).toBe(202);
    const set = await until(after(n, "bank.limit_set"));
    const limit = set.params.limit as { minor: number; currency: string };
    expect(limit.minor).toBeLessThan((card.params.total as { minor: number }).minor);
    const cartWait = await until(after(n, "cart.awaiting_signature"));
    expect((await demo.stand.stand.issuer.sign(String(cartWait.params.mandate_id))).statusCode).toBe(200);

    const declined = await until(after(n, "limit.declined"), 60_000);
    expect(declined.params.code).toBe("DECLINED_LIMIT_EXCEEDED");
    await until(after(n, "bank.limit_reset"));
    expect(steps().slice(n).findIndex((s) => s.step === "limit.declined")).toBeLessThan(steps().slice(n).findIndex((s) => s.step === "bank.limit_reset"));
    expect(steps().slice(n).some((s) => s.step === "outcome")).toBe(false);

    const ev = await until(() => events().find((e) => e.what === "operation.declined"));
    // Код — из ответа ADP, чей предел — из уведомления банку (CLIENT), сумма — итог корзины ядра (не сообщение эквайрера).
    expect(ev).toMatchObject({
      cls: "decline",
      code: "LIMIT_EXCEEDED",
      codeDetail: "CLIENT",
      source: "pao_event",
      amount: { minor: (card.params.total as { minor: number }).minor, currency: "RUB" },
    });
    // Лимит снят: у клиента в банке пустой набор лимитов.
    const limits = await demo.stand.stand.issuer.getLimits(DEMO_PRINCIPAL);
    expect(limits.statusCode).toBe(200);
    expect(JSON.stringify(limits.body)).not.toContain("per_operation");
    await demo.scenarios.settled();
    // Поручение использовано (корзина была) — повтор только через новый сюжет 1.
    expect((await post("limit")).status).toBe(409);
  });

  it("прервано после постановки лимита — лимит всё равно снят (ревью К2.2б № 4)", async () => {
    let n = steps().length;
    expect((await post("intent")).status).toBe(202);
    const w = await until(after(n, "intent.awaiting_signature"));
    expect((await demo.stand.stand.issuer.sign(String(w.params.mandate_id))).statusCode).toBe(200);
    await until(after(n, "intent.signed"));
    await demo.scenarios.settled();

    n = steps().length;
    expect((await post("limit")).status).toBe(202);
    await until(after(n, "cart.card"));
    expect((await post("cart/accept")).status).toBe(202);
    await until(after(n, "cart.awaiting_signature"));
    expect(steps().slice(n).some((s) => s.step === "bank.limit_set")).toBe(true);
    expect((await post("abort")).status).toBe(202);
    await until(after(n, "aborted"));
    await until(after(n, "bank.limit_reset"));
    await demo.scenarios.settled();
    expect(JSON.stringify((await demo.stand.stand.issuer.getLimits(DEMO_PRINCIPAL)).body)).not.toContain("per_operation");
  });
});
