// К2.2в: сюжет 4 «подтверждение человеком через УПК» на живом стенде (Р-1255 п. 2). Своё поручение до 5 000 ₽, сумма
// выше порога банка → ADP CONFIRMATION_REQUIRED → ссылка на страницу УПК и код «SMS банка» на мониторе → человек вводит
// код на странице УПК (в тесте — запросом к странице, как человек) → итог по событию operation.authorized.
// Подпись поручения и корзины в автотесте — эмулятором банка (П2 п. 5).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { BusItem, MonitorEvent, ScenarioLine } from "../../src/demo/bus.js";
import { parseWireItem } from "../../src/dashboards/wire.js";
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

describe("сюжет 4: подтверждение человеком через УПК", { timeout: 90_000 }, () => {
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

  it("у кнопки 4 — своя карточка поручения (до 5 000 ₽) и панель УПК; кнопки «подтвердить за человека» нет", async () => {
    const html = await (await fetch(`${demo.monitor.url}/`)).text();
    expect(html).toContain('id="intent-card-upk"');
    expect(html.indexOf('id="intent-card-upk"')).toBeLessThan(html.indexOf('data-scenario="upk"'));
    expect(html).toContain('id="upk-panel"');
    expect(html).toContain(MESSAGES.ru["upk.hint"]);
    expect(html).not.toMatch(/data-scenario="(sign|confirm)/);
  });

  it("сумма выше порога → запрос подтверждения → человек вводит код на странице УПК → итог по событию", async () => {
    const n = steps().length;
    expect((await post("upk")).status).toBe(202);
    const created = await until(after(n, "intent.created"));
    expect(created.params.limit).toMatchObject({ minor: 500000, currency: "RUB" });
    const w = await until(after(n, "intent.awaiting_signature"));
    expect((await demo.stand.stand.issuer.sign(String(w.params.mandate_id))).statusCode).toBe(200);

    const card = await until(after(n, "cart.card"));
    const threshold = demo.stand.stand.params.confirm_above_kop;
    const total = card.params.total as { minor: number; currency: string };
    expect(total.minor).toBeGreaterThan(threshold);
    expect(total.minor).toBeLessThanOrEqual(500000);
    expect(Number(card.params.qty)).toBeGreaterThan(1);
    expect((await post("cart/accept")).status).toBe(202);
    const cw = await until(after(n, "cart.awaiting_signature"));
    expect((await demo.stand.stand.issuer.sign(String(cw.params.mandate_id))).statusCode).toBe(200);

    // Запрос подтверждения: ссылка на страницу УПК стенда и код «SMS банка».
    const req = await until(after(n, "upk.required"));
    const url = String(req.params.upk_url);
    expect(url.startsWith(`${demo.stand.urls.upk}/c/`)).toBe(true);
    const sms = await until(after(n, "upk.sms"));
    const code = String(sms.params.code);
    expect(code).toMatch(/\S/);
    // Пока человек не ответил — итога нет; прервать можно (ожидание решения), но здесь — не прерываем.
    await pause(500);
    expect(steps().slice(n).some((s) => s.step === "outcome")).toBe(false);
    const confirmEv = events().find((e) => e.what === "confirmation.required");
    expect(confirmEv).toMatchObject({ cls: "check", amount: { minor: total.minor, currency: "RUB" } });

    // Человек: страница УПК → код из SMS → «подтвердить».
    const page = await fetch(url);
    expect(page.status).toBe(200);
    const answer = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ decision: "APPROVE", instrument: "CARD", code }).toString(),
    });
    expect(answer.status).toBe(200);

    const outcome = await until(after(n, "outcome"), 60_000);
    expect(outcome.params).toMatchObject({ status: "AUTHORIZED", amount: { minor: total.minor, currency: "RUB" } });
    // Панель витрины (К2.3): итог связан с заказом; ответы витрины — слова продавца, отдельными шагами.
    const placed = steps().slice(n).find((s) => s.step === "order.placed")!;
    expect(outcome.params.order_id).toBe(placed.params.order_id);
    expect(steps().slice(n).filter((s) => s.step === "order.shop_reply" && s.params.order_id === placed.params.order_id).length).toBeGreaterThan(0);
    const ev = await until(() => events().find((e) => e.what === "operation.authorized"));
    expect(ev).toMatchObject({ cls: "outcome", amount: { minor: total.minor } });
    await demo.scenarios.settled();
  });

  it("контракт линии дашбордов DEMO-2 (К1.2): шаг «SMS банка» на линию не идёт, остальные записи — по форме", () => {
    const history = demo.bus.history();
    const sms = history.filter((i) => i.stream === "scenario" && i.line.step === "upk.sms");
    expect(sms.length).toBeGreaterThan(0);
    for (const i of sms) expect(parseWireItem(JSON.parse(JSON.stringify(i)))).toBeUndefined();
    const lost = history.filter((i) => !sms.includes(i) && parseWireItem(JSON.parse(JSON.stringify(i))) === undefined);
    expect(lost).toEqual([]);
    const upkUrl = history.flatMap((i) => (i.stream === "scenario" && i.line.step === "upk.required" ? [parseWireItem(JSON.parse(JSON.stringify(i)))] : []));
    expect(upkUrl.length).toBeGreaterThan(0);
    for (const w of upkUrl) expect(w?.stream === "scenario" && "upk_url" in w.line.params).toBe(false);
  });
});
