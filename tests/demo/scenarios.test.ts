// К2.1 (П2 п. 5): сюжеты 1 и 2 на живом стенде — подпись поручения и корзины человеком в банке, покупка до итога по
// событию operation.*, консоль агента, поправки монитора (а)–(в) и проверка утечки реквизитов на настоящем выпуске.
// Подпись в автотесте — эмулятором банка stand.issuer.sign (П2 п. 5: только в автотестах); путь человека — вход по
// ссылке /bank-login на экран мандатов банка — проверяется отдельно.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { BusItem, MonitorEvent, ScenarioLine } from "../../src/demo/bus.js";
import { MESSAGES } from "../../src/demo/i18n.js";
import { startDemo, type Demo } from "../../src/demo/run.js";

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

const steps = (d: Demo): ScenarioLine[] => d.bus.history().flatMap((i: BusItem) => (i.stream === "scenario" ? [i.line] : []));
const events = (d: Demo): MonitorEvent[] => d.bus.history().flatMap((i: BusItem) => (i.stream === "monitor" ? [i.event] : []));
const step = (d: Demo, name: string) => () => steps(d).find((s) => s.step === name);

async function readSse(url: string, ms = 2000): Promise<string> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ms);
  let text = "";
  try {
    const res = await fetch(url, { signal: ac.signal });
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      text += dec.decode(value, { stream: true });
    }
  } catch (e) {
    if (!ac.signal.aborted) throw e;
  } finally {
    clearTimeout(timer);
  }
  return text;
}

describe("сюжеты 1–2 на живом стенде", { timeout: 60_000 }, () => {
  let demo: Demo;
  let origin: string;
  const post = (name: string, from = origin) => fetch(`${demo.monitor.url}/scenario/${name}`, { method: "POST", headers: { origin: from } });

  beforeAll(async () => {
    demo = await startDemo();
    origin = demo.monitor.url;
  }, 30_000);
  afterAll(async () => {
    await demo?.close();
  });

  it("без поручения покупка не начинается; чужая страница сюжет не запускает", async () => {
    const r = await post("purchase");
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ ok: false, code: "NEED_INTENT" });
    expect((await post("intent", "http://evil.example")).status).toBe(403);
  });

  it("страница: кнопки двух сюжетов, ссылка на банк — через вход /bank-login, кнопки «подписать за человека» нет", async () => {
    const html = await (await fetch(`${demo.monitor.url}/`)).text();
    expect(html).toContain('data-scenario="intent"');
    expect(html).toContain('data-scenario="purchase"');
    expect(html).toContain(`<a href="/bank-login" target="_blank" rel="noopener">${MESSAGES.ru["link.bank"]}</a>`);
    expect(html).not.toMatch(/data-scenario="(sign|confirm)/);
    // Карточка поручения видна до нажатия кнопки 1 (Т3а; ревью К2.1 № 1): предмет, предел, срок, разовое.
    expect(html).toContain('id="intent-card"');
    expect(html).toContain(MESSAGES.ru["card.single_use"]);
    expect(html.indexOf('id="intent-card"')).toBeLessThan(html.indexOf('data-scenario="intent"'));
  });

  it("вход в банк с чужой страницы — 403; со страницы монитора — 303", async () => {
    const cross = await fetch(`${demo.monitor.url}/bank-login`, { redirect: "manual", headers: { "sec-fetch-site": "cross-site" } });
    expect(cross.status).toBe(403);
    const same = await fetch(`${demo.monitor.url}/bank-login`, { redirect: "manual", headers: { "sec-fetch-site": "same-origin" } });
    expect(same.status).toBe(303);
  });

  let intentId = "";
  /** Поручение, которое последний тест сюжета 1 оставил ждать подписи, — для теста отмены. */
  let pendingIntent = "";
  it("сюжет 1: поручение создано и ждёт подписи; человек входит в банк по ссылке и видит поручение; подпись — по событию", async () => {
    expect((await post("intent")).status).toBe(202);
    const waiting = await until(step(demo, "intent.awaiting_signature"));
    intentId = String(waiting.params.mandate_id);
    expect(intentId).toMatch(/^mnd_/);
    expect(steps(demo).find((s) => s.step === "intent.created")?.params.limit).toMatchObject({ minor: 100000, currency: "RUB" });

    // Путь человека: /bank-login → одноразовый вход на экран банка → карточка поручения.
    const login = await fetch(`${demo.monitor.url}/bank-login`, { redirect: "manual" });
    expect(login.status).toBe(303);
    const location = login.headers.get("location")!;
    expect(location.startsWith(`${demo.stand.urls.bankApp}/login/`)).toBe(true);
    const entered = await fetch(location, { redirect: "manual" });
    const cookie = entered.headers.get("set-cookie")?.split(";")[0];
    expect(cookie).toBeTruthy();
    const card = await fetch(`${demo.stand.urls.bankApp}/m/${intentId}`, { headers: { cookie: cookie! } });
    expect(card.status).toBe(200);
    expect(await card.text()).toContain(intentId);
    // Ссылка входа не попала ни в ленту, ни в SSE, ни на страницу (ревью К2.1 № 10).
    const token = location.split("/login/")[1]!;
    demo.bus.poll();
    await pause(300);
    expect(JSON.stringify(demo.bus.history())).not.toContain(token);
    expect(await readSse(`${demo.monitor.url}/events`, 800)).not.toContain(token);
    expect(await (await fetch(`${demo.monitor.url}/`)).text()).not.toContain(token);

    expect((await demo.stand.stand.issuer.sign(intentId)).statusCode).toBe(200);
    expect((await until(step(demo, "intent.signed"))).params).toMatchObject({ mandate_id: intentId, status: "ACTIVE" });
    expect(await until(() => events(demo).find((e) => e.what === "mandate.signed"))).toMatchObject({ cls: "mandate", source: "pao_event", ids: { mandate_id: intentId } });
  });

  it("сюжет 2: нашёл, сравнил, выбрал; корзина подписана человеком; итог — по событию operation.authorized с суммой", async () => {
    expect((await post("purchase")).status).toBe(202);
    // Карточка корзины (Р-1248 п. 1): сюжет ждёт решения человека; до «согласен» корзина не запрашивается.
    const card = await until(step(demo, "cart.card"));
    expect(card.params).toMatchObject({ title: expect.any(String), merchant_id: expect.any(String), price: { currency: "RUB" }, qty: 1 });
    // Итог на карточке — по правилу ядра (cartTotal: цена × количество), совпадает с итогом корзины ниже.
    const cardTotal = card.params.total as { minor: number; currency: string };
    expect(cardTotal.minor).toBe((card.params.price as { minor: number }).minor);
    await pause(300);
    const mandatePosts = () => demo.stand.stand.calls().filter((c) => c.method === "POST" && c.path === "/pao/v1/mandates").length;
    expect(mandatePosts()).toBe(1); // только INTENT
    expect((await post("cart/accept", "http://evil.example")).status).toBe(403);
    expect((await post("cart/accept")).status).toBe(202);
    expect((await post("cart/accept")).status).toBe(409); // ответ уже дан
    const cartWait = await until(step(demo, "cart.awaiting_signature"));
    expect(mandatePosts()).toBe(2);
    expect(steps(demo).find((s) => s.step === "cart.created")?.params.total).toMatchObject({ minor: cardTotal.minor, currency: cardTotal.currency });
    expect(steps(demo).findIndex((s) => s.step === "cart.agreed")).toBeLessThan(steps(demo).findIndex((s) => s.step === "cart.created"));
    const found = steps(demo).find((s) => s.step === "search.found")!;
    expect(Number(found.params.contour)).toBeGreaterThan(0);
    const picked = steps(demo).find((s) => s.step === "search.picked")!;
    expect(picked.params).toMatchObject({ merchant_id: expect.any(String), sku: expect.any(String), price: { currency: "RUB" } });
    expect((await demo.stand.stand.issuer.sign(String(cartWait.params.mandate_id))).statusCode).toBe(200);

    const outcome = await until(step(demo, "outcome"), 30_000);
    expect(outcome.params).toMatchObject({ status: "AUTHORIZED", amount: { currency: "RUB" } });
    const opRef = String(outcome.params.op_ref);
    const ev = await until(() => events(demo).find((e) => e.what === "operation.authorized"));
    expect(ev).toMatchObject({ cls: "outcome", source: "pao_event", ids: { op_ref: opRef } });
    expect(ev.amount).toMatchObject({ minor: (outcome.params.amount as { minor: number }).minor, currency: "RUB" });
    // Слово продавца (PAID) — не итог: в ленте ответ витрины на оплату — «оплата», не «итог».
    const pay = events(demo).find((e) => e.what.endsWith("/payment") && e.source === "agent_merchant");
    expect(pay?.cls).toBe("payment");
    await demo.scenarios.settled();
  });

  it("поручение разовое: вторая покупка без нового сюжета 1 не начинается", async () => {
    const r = await post("purchase");
    expect(await r.json()).toEqual({ ok: false, code: "NEED_INTENT" });
  });

  it("поправки монитора: открытый адрес — «агент → Платформа (открытый адрес)»; merchant_id — в идентификаторах", async () => {
    demo.bus.poll();
    const open = events(demo).filter((e) => e.what === "GET /.well-known/pao-configuration");
    expect(open.length).toBeGreaterThan(0);
    for (const e of open) expect(e.source).toBe("agent_platform_open");
    const ready = events(demo).find((e) => e.what === "GET /pao/v1/merchants/{merchant_id}/readiness");
    expect(ready?.ids.merchant_id).toMatch(/^MER-/);
  });

  it("чужой неподписанный запрос к открытому адресу — «по сети», не «агент» (ревью К2.1 № 2)", async () => {
    const before = events(demo).length;
    expect((await fetch(`${demo.stand.urls.pao}/.well-known/pao-configuration`)).status).toBe(200);
    const foreign = await until(() => {
      demo.bus.poll();
      return events(demo)
        .slice(before)
        .find((e) => e.what === "GET /.well-known/pao-configuration");
    });
    expect(foreign.source).toBe("network_platform");
  });

  it("инвариант 1 на настоящем выпуске: криптограмма и token_ref — не в ленте SSE и не на странице", async () => {
    const issued = demo.stand.stand.issuedCredentials();
    expect(issued.length).toBeGreaterThan(0);
    const sse = await readSse(`${demo.monitor.url}/events`);
    expect(sse).toContain("operation.authorized");
    const html = (await (await fetch(`${demo.monitor.url}/`)).text()) + (await (await fetch(`${demo.monitor.url}/?lang=en`)).text());
    for (const c of issued) {
      for (const v of [c.cryptogram, c.token_ref]) {
        expect(sse).not.toContain(v);
        expect(html).not.toContain(v);
      }
    }
  });

  it("человек не согласился с карточкой корзины — корзина не запрошена, поручение можно использовать снова (Р-1248 п. 1)", async () => {
    // Новое поручение, подписанное (в автотесте — эмулятором банка, П2 п. 5).
    let before = steps(demo).length;
    expect((await post("intent")).status).toBe(202);
    const w = await until(() => steps(demo).slice(before).find((s) => s.step === "intent.awaiting_signature"));
    expect((await demo.stand.stand.issuer.sign(String(w.params.mandate_id))).statusCode).toBe(200);
    await until(() => steps(demo).slice(before).find((s) => s.step === "intent.signed"));
    await demo.scenarios.settled();

    const posts = () => demo.stand.stand.calls().filter((c) => c.method === "POST" && c.path === "/pao/v1/mandates").length;
    before = steps(demo).length;
    expect((await post("purchase")).status).toBe(202);
    await until(() => steps(demo).slice(before).find((s) => s.step === "cart.card"));
    const n = posts();
    expect((await post("cart/decline", "http://evil.example")).status).toBe(403);
    expect((await post("cart/decline")).status).toBe(202);
    await until(() => steps(demo).slice(before).find((s) => s.step === "cart.declined"));
    await demo.scenarios.settled();
    expect(posts()).toBe(n);
    expect(steps(demo).slice(before).some((s) => s.step === "cart.created")).toBe(false);
    // Поручение не использовано: сюжет 2 запускается снова; без ответа карточка ждёт и корзину не запрашивает.
    before = steps(demo).length;
    expect((await post("purchase")).status).toBe(202);
    await until(() => steps(demo).slice(before).find((s) => s.step === "cart.card"));
    const m = posts();
    await pause(500);
    expect(posts()).toBe(m);
    expect((await post("cart/decline")).status).toBe(202);
    await demo.scenarios.settled();
  });

  it("человек отклонил поручение — сюжет остановлен с кодом, следующий сюжет 1 запускается (ревью К2.1 № 11)", async () => {
    const before = steps(demo).length;
    expect((await post("intent")).status).toBe(202);
    const waiting = await until(() => steps(demo).slice(before).find((s) => s.step === "intent.awaiting_signature"));
    // Отказ — эмулятором банка в автотесте (П2 п. 5); на экране демо кнопки отказа за человека нет.
    expect((await demo.stand.stand.issuer.sign(String(waiting.params.mandate_id), { decision: "REJECT" })).statusCode).toBe(200);
    const failed = await until(() => steps(demo).slice(before).find((s) => s.step === "failed"));
    expect(String(failed.params.code)).toMatch(/^[A-Z_]+$/);
    await demo.scenarios.settled();
    expect((await post("purchase")).status).toBe(409);
    const again = steps(demo).length;
    expect((await post("intent")).status).toBe(202);
    pendingIntent = String((await until(() => steps(demo).slice(again).find((s) => s.step === "intent.awaiting_signature"))).params.mandate_id);
  });

  // Последним: отмена сюжетов необратима для этого стенда (close).
  it("отмена при ожидающей карточке корзины: корзина не запрошена, ответ после отмены — 409 (ревью К2.1а № 3, № 5)", async () => {
    // Сюжет 1 из прошлого теста ждёт подписи — подписываем, затем сюжет 2 до карточки.
    expect((await demo.stand.stand.issuer.sign(pendingIntent)).statusCode).toBe(200);
    await demo.scenarios.settled();
    const before = steps(demo).length;
    expect((await post("purchase")).status).toBe(202);
    await until(() => steps(demo).slice(before).find((s) => s.step === "cart.card"));
    const posts = demo.stand.stand.calls().filter((c) => c.method === "POST" && c.path === "/pao/v1/mandates").length;
    await demo.scenarios.close();
    const r = await post("cart/accept");
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ ok: false, code: "NOT_AWAITING" });
    await pause(300);
    expect(demo.stand.stand.calls().filter((c) => c.method === "POST" && c.path === "/pao/v1/mandates").length).toBe(posts);
  });
});
