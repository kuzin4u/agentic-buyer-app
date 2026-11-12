// П-8.1 «Кнопки реакции» (модель «Кнопки реакции» v1.0; Р-1526, Р-1527): флаг показа, порт `PultActions` и его реализация
// на стенде, маршрут `POST /pult/act/<действие>`, тест с настоящим агентом по П2 дополнению 6 — отзыв поручения при
// ожидающем подтверждении → агенту `confirmation.rejected`, агент останавливается, «оплачено» нет.
import { DEMO_VIOLATORS, type DemoIds, type DemoViolator, type StandDemo } from "agentic-ps-platform/stand";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { envFlag } from "../../src/demo/flags.js";
import { pultAct } from "../../src/demo/pult-act.js";
import { pultActions } from "../../src/demo/pult-actions.js";
import type { BusItem, MonitorEvent, ScenarioLine } from "../../src/demo/bus.js";
import { startDemo, type Demo } from "../../src/demo/run.js";
import { REVIEW_ID_FIELDS, REVIEW_VIOLATORS, type ActionResult, type PultActions, type Reaction } from "../../src/pult/actions.js";
import { PULT } from "../../src/pult/phrases.js";

const NOW = () => new Date("2026-11-12T12:00:00Z");
const q = (o: Record<string, string>) => new URLSearchParams(o);
const refusedAll = (): PultActions & Record<string, ReturnType<typeof vi.fn>> => {
  const no: ActionResult = { ok: false, status: 409, code: "MANDATE_NOT_ACTIVE" };
  return { stopPurchase: vi.fn(async () => no), remindClient: vi.fn(async () => no), revokeMandate: vi.fn(async () => no), sendToReview: vi.fn(async () => no) };
};

describe("кнопки реакции пульта — флаг, порт, маршрут (П-8.1)", () => {
  it("флаг DEMO_ACTIONS / DEMO_FAULTS (ревью П-1.3 № 8, Р-1527): включён только при «1»", () => {
    expect(envFlag("1")).toBe(true);
    for (const v of ["true", "0", "", " 1", undefined]) expect(envFlag(v), String(v)).toBe(false);
  });

  it("перечни разбора — из кода стенда (Р-1511): нарушители и поля идентификаторов как у `sendToReview`", () => {
    expect([...REVIEW_VIOLATORS]).toEqual([...DEMO_VIOLATORS]);
    // Поля идентификаторов стенд наружу не отдаёт (`DEMO_ID_FIELDS` не экспортирован) — контракт типов: равенство проверяет tsc.
    type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
    const ids: Same<(typeof REVIEW_ID_FIELDS)[number], keyof DemoIds> = true;
    const viol: Same<(typeof REVIEW_VIOLATORS)[number], DemoViolator> = true;
    expect([ids, viol]).toEqual([true, true]);
  });

  it("условие 1 Р-1527: отказ стенда на каждой из четырёх кнопок — «отказано» с кодом (409), в журнале реакций «refused», не «сделано»", async () => {
    const a = refusedAll();
    const log: Reaction[] = [];
    const feed = { react: (r: Reaction) => log.push(r) };
    const cases: [string, Record<string, string>][] = [
      ["stop", { cart: "CART-1" }],
      ["remind", { confirmation: "CNF-1" }],
      ["revoke", { mandate: "MND-1" }],
      ["review", { mandate_id: "CART-1", condition: "R46", violator: "AGENT" }],
    ];
    for (const [act, params] of cases) {
      const r = await pultAct(act, q(params), a, feed, NOW);
      expect(r.status, act).toBe(409);
      expect(r.body, act).toMatchObject({ outcome: "refused", result: { ok: false, code: "MANDATE_NOT_ACTIVE" } });
    }
    expect(log.map((x) => x.outcome)).toEqual(["refused", "refused", "refused", "refused"]);
  });

  it("условие 2 Р-1527 (В1 (а)): «Напомнить» у R08 / R18 стенд не вызывает вовсе — только «напомнено»", async () => {
    const a = refusedAll();
    const log: Reaction[] = [];
    for (const cond of ["R08", "R18"]) {
      const r = await pultAct("remind_note", q({ obj: "MND-2", cond }), a, { react: (x) => log.push(x) }, NOW);
      expect(r).toMatchObject({ status: 200, body: { outcome: "noted", cond } });
    }
    for (const m of [a.stopPurchase, a.remindClient, a.revokeMandate, a.sendToReview]) expect(m).not.toHaveBeenCalled();
    expect(log).toHaveLength(2);
    // R21 «без стенда» нельзя: продление у подтверждения — только стендом.
    expect((await pultAct("remind_note", q({ obj: "X", cond: "R21" }), a, { react: () => undefined }, NOW)).status).toBe(400);
  });

  it("маршрут: неизвестное действие — 404; номера не по форме, неизвестный нарушитель — 400; стенд не вызывается", async () => {
    const a = refusedAll();
    const feed = { react: vi.fn() };
    expect((await pultAct("pay", q({}), a, feed, NOW)).status).toBe(404);
    expect((await pultAct("stop", q({ cart: "<b>x</b>" }), a, feed, NOW)).status).toBe(400);
    expect((await pultAct("review", q({ mandate_id: "M", condition: "R46", violator: "CLIENT" }), a, feed, NOW)).status).toBe(400);
    expect(feed.react).not.toHaveBeenCalled();
    expect(a.stopPurchase).not.toHaveBeenCalled();
  });

  it("реализация порта: ответ стенда как есть — 4xx и исключение стенда — отказ; продление — новый срок", async () => {
    const demo = {
      stopPurchase: vi.fn(async () => ({ statusCode: 409, body: { error: { code: "MANDATE_NOT_ACTIVE" } }, rejected: [] })),
      remindClient: vi.fn(async () => ({ confirmation_id: "C", expires_at: "2026-11-12T12:05:00Z", extended: true })),
      revokeMandate: vi.fn(async () => {
        throw new Error("unknown mandate");
      }),
      sendToReview: vi.fn(() => ({})),
    } as unknown as StandDemo;
    const p = pultActions(demo);
    expect(await p.stopPurchase("X")).toEqual({ ok: false, status: 409, code: "MANDATE_NOT_ACTIVE", rejected: [] });
    expect(await p.remindClient("C")).toEqual({ ok: true, expiresAt: "2026-11-12T12:05:00Z", extended: true });
    expect(await p.revokeMandate("Y")).toEqual({ ok: false, code: "unknown mandate" });
    expect(await p.sendToReview({ tx: { op_ref: "P" }, condition: "R46", violator: "AGENT" })).toEqual({ ok: true });
  });
});

describe("кнопки реакции на живом стенде с настоящим агентом (П-8.1, П2 доп. 6)", { timeout: 180_000 }, () => {
  let demo: Demo;
  let plain: Demo;
  const steps = (): ScenarioLine[] => demo.bus.history().flatMap((i: BusItem) => (i.stream === "scenario" ? [i.line] : []));
  const events = (): MonitorEvent[] => demo.bus.history().flatMap((i: BusItem) => (i.stream === "monitor" ? [i.event] : []));
  const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
  async function until<T>(f: () => T | undefined, ms = 60_000): Promise<T> {
    const end = Date.now() + ms;
    for (;;) {
      const v = f();
      if (v !== undefined) return v;
      if (Date.now() > end) throw new Error("не дождались");
      await pause(50);
    }
  }
  const after = (n: number, name: string) => () => steps().slice(n).find((s) => s.step === name);
  const post = (path: string, origin = demo.monitor.url) => fetch(`${demo.monitor.url}${path}`, { method: "POST", headers: { origin } });
  /** Сюжет 4 до ожидания подтверждения клиентом: подписи — эмулятором банка в автотесте (П2 п. 5). */
  async function toPendingConfirmation(): Promise<{ n: number; intent: string; cart: string; confirmation: string }> {
    await demo.scenarios.settled();
    const n = steps().length;
    expect((await post("/scenario/upk")).status).toBe(202);
    const w = await until(after(n, "intent.awaiting_signature"));
    await demo.stand.stand.issuer.sign(String(w.params.mandate_id));
    await until(after(n, "cart.card"));
    expect((await post("/scenario/cart/accept")).status).toBe(202);
    const cw = await until(after(n, "cart.awaiting_signature"));
    await demo.stand.stand.issuer.sign(String(cw.params.mandate_id));
    await until(after(n, "upk.required"));
    const ev = await until(() => events().find((e) => e.what === "confirmation.required" && e.ids.mandate_id !== undefined) ?? events().filter((e) => e.what === "confirmation.required").at(-1));
    return { n, intent: String(w.params.mandate_id), cart: String(cw.params.mandate_id), confirmation: String(ev.ids.confirmation_id) };
  }

  beforeAll(async () => {
    [demo, plain] = await Promise.all([startDemo({ actions: true }), startDemo()]);
  }, 60_000);
  afterAll(async () => {
    await Promise.all([demo?.close(), plain?.close()]);
  });

  it("В2: без режима показа или сбоев маршрута нет (404) и кнопок нет; в режиме показа — строка «режим показа: вкл.»; чужой Origin — 403", async () => {
    expect((await fetch(`${plain.monitor.url}/pult/act/stop?cart=X`, { method: "POST", headers: { origin: plain.monitor.url } })).status).toBe(404);
    expect(await (await fetch(`${plain.monitor.url}/pult`)).text()).toContain('"actions":false');
    const html = await (await fetch(`${demo.monitor.url}/pult`)).text();
    expect(html).toContain('"actions":true');
    expect(html).toContain(PULT["mode.actions"].ru);
    expect(await (await fetch(`${demo.monitor.url}/`)).text()).toContain(PULT["mode.actions"].ru);
    expect((await post("/pult/act/stop?cart=X", "http://evil.example")).status).toBe(403);
  });

  it("каждая кнопка на стенде: «Напомнить» (продление один раз), «Передать на разбор», отказ стенда по неизвестному поручению — «отказано»", async () => {
    const p = await toPendingConfirmation();
    const r1 = (await (await post(`/pult/act/remind?confirmation=${p.confirmation}`)).json()) as Reaction;
    expect(r1).toMatchObject({ outcome: "done", result: { ok: true, extended: true } });
    const r2 = (await (await post(`/pult/act/remind?confirmation=${p.confirmation}`)).json()) as Reaction;
    expect(r2).toMatchObject({ outcome: "done", result: { extended: false } });
    const rv = await post(`/pult/act/review?mandate_id=${p.cart}&condition=R21&violator=AGENT`);
    expect(rv.status).toBe(200);
    const bad = await post("/pult/act/revoke?mandate=MND-unknown");
    expect(bad.status).toBe(409);
    expect(await bad.json()).toMatchObject({ outcome: "refused" });
    // Остановить покупку: отзыв CART закрывает ожидающий запрос подтверждения (РП76).
    const stop = (await (await post(`/pult/act/stop?cart=${p.cart}`)).json()) as Reaction;
    expect(stop).toMatchObject({ outcome: "done" });
    expect(stop.result?.rejected).toContain(p.confirmation);
    await until(() => events().find((e) => e.what === "confirmation.rejected" && e.ids.confirmation_id === p.confirmation));
    await demo.scenarios.settled();
    expect(steps().slice(p.n).some((s) => s.step === "outcome" && s.params.status === "AUTHORIZED")).toBe(false);
  });

  it("П2 доп. 6: «Отозвать поручение» при ожидающем подтверждении → агенту confirmation.rejected и mandate.revoked, агент остановился, «оплачено» нет", async () => {
    const p = await toPendingConfirmation();
    const r = (await (await post(`/pult/act/revoke?mandate=${p.intent}`)).json()) as Reaction;
    expect(r).toMatchObject({ action: "revoke", outcome: "done", result: { ok: true } });
    await until(() => events().find((e) => e.what === "confirmation.rejected" && e.ids.confirmation_id === p.confirmation));
    await until(() => events().find((e) => e.what === "mandate.revoked" && e.ids.mandate_id === p.intent));
    await demo.scenarios.settled();
    expect(steps().slice(p.n).some((s) => s.step === "outcome" && s.params.status === "AUTHORIZED")).toBe(false);
    expect(events().some((e) => e.what === "operation.authorized" && e.ids.mandate_id === p.cart)).toBe(false);
  });
});
