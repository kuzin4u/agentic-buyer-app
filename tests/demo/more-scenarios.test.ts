// П-11.1 (Р-1457, Р-1459): сюжеты 6–10 — правильные тесты задания на тестирование пульта — на живом стенде с настоящим
// агентом (createAgentCore). Проверка здесь — код защиты и записи стенда; паспорт К2.1 и контролёр К2.2 — по ленте
// прогона, как у сюжетов 1–5 (tests/demo/interpret-live.test.ts). Паспорт в пульте — П-11.5 основного окна.
// Решения клиента в банке — эмулятором банка в автотесте (П2 п. 5, как подпись в drive.ts).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { control, DEFAULT_WAIT_MS, splitRuns } from "../../src/dashboards/control.js";
import { interpret, LOCAL_STAND_EMULATED, type InterpretEnv, type Interpretation } from "../../src/dashboards/interpret.js";
import { matches, type Passport } from "../../src/dashboards/passports.js";
import { parseDiagSnapshot } from "../../src/dashboards/wire.js";
import type { BusItem, ScenarioLine } from "../../src/demo/bus.js";
import { MESSAGES } from "../../src/demo/i18n.js";
import { startDemo, type Demo } from "../../src/demo/run.js";
import { MORE_SCENARIOS } from "../../src/demo/scenarios.js";
import { TRAINING_MERCHANTS } from "../../src/demo/shops.js";
import { driver } from "./drive.js";

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Прогоны ленты по меткам (как «Контроль»), только с паспортом. */
function segments(list: Interpretation[]) {
  return splitRuns(list).map((s) => {
    if (!s.passport) throw new Error(`прогон без паспорта: ${s.name}`);
    return { ...s, passport: s.passport };
  });
}

/** Паспорт прогона сходится с фактом стенда, контролёр после срока — «принято N из N». */
function expectAccepted(s: ReturnType<typeof segments>[number]): void {
  const p: Passport = s.passport;
  for (const e of p.expect) {
    const n = s.items.filter((r) => matches(r, e.match)).length;
    if (e.times !== undefined) expect(n, `сюжет ${p.no}, ${e.id}`).toBe(e.times);
    else expect(n, `сюжет ${p.no}, ${e.id}`).toBeGreaterThan(0);
  }
  for (const e of p.forbid) expect(s.items.filter((r) => matches(r, e.match)).map((r) => `${r.seq} ${r.ref}`), `сюжет ${p.no}, запрет ${e.id}`).toEqual([]);
  const last = Math.max(...s.items.filter((r) => r.source !== "pao_event").map((r) => Date.parse(r.at)));
  const done = control(p, s.items, { now: new Date(last + DEFAULT_WAIT_MS), startedAt: s.startedAt });
  expect(done.items.filter((i) => i.state !== "accepted").map((i) => `${i.id}: ${i.state} ${i.reasons.join(",")}`), `сюжет ${p.no}`).toEqual([]);
}

describe("сюжеты 6–10 для тестов пульта (П-11.1)", { timeout: 180_000 }, () => {
  let demo: Demo;
  let env: InterpretEnv;
  const steps = (): ScenarioLine[] => demo.bus.history().flatMap((i: BusItem) => (i.stream === "scenario" ? [i.line] : []));
  const post = (name: string) => fetch(`${demo.monitor.url}/scenario/${name}`, { method: "POST", headers: { origin: demo.monitor.url } });
  async function until(from: number, name: string, ms = 30_000): Promise<ScenarioLine> {
    const end = Date.now() + ms;
    for (;;) {
      const s = steps().find((x) => x.seq > from && x.step === name);
      if (s) return s;
      if (Date.now() > end) throw new Error(`не дождались шага ${name}`);
      await pause(50);
    }
  }
  const lastSeq = () => demo.bus.history().reduce((m, i) => Math.max(m, i.stream === "monitor" ? i.event.seq : i.line.seq), 0);

  beforeAll(async () => {
    demo = await startDemo();
    const raw = await (await fetch(`${demo.monitor.url}/api/diag`)).json();
    env = { snapshot: parseDiagSnapshot(raw)!.snapshot, emulated: LOCAL_STAND_EMULATED, training: TRAINING_MERCHANTS };
  }, 30_000);
  afterAll(async () => {
    await demo?.close();
  });

  it("кнопки сюжетов 6–10 на мониторе — с пояснением ru и en; имя вне перечня маршрутом сюжетов не считается", async () => {
    for (const lang of ["ru", "en"] as const) {
      const html = await (await fetch(`${demo.monitor.url}/?lang=${lang}`)).text();
      for (const s of MORE_SCENARIOS) {
        const m = MESSAGES[lang] as Readonly<Record<string, string>>;
        expect(m[`scenario.${s.name}`], `${lang} ${s.name}`).toBeTruthy();
        expect(m[`scenario.${s.name}_note`], `${lang} ${s.name}`).toBeTruthy();
        expect(m[`step.run.${s.name}`], `${lang} ${s.name}`).toBeTruthy();
        if (s.card) expect(m[`card.intent_${s.name}.title`], `${lang} ${s.name}`).toBeTruthy();
        expect(html).toContain(`data-scenario="${s.name}"`);
      }
    }
    // Имя вне перечня — не маршрут сюжетов: 405, как до П-11.1а; метки прогона на шине нет (ревью П-11.1а № 7).
    const runs = () => steps().filter((s) => s.step.startsWith("run.")).length;
    const before = runs();
    for (const name of ["constructor", "__proto__", "nope"]) expect((await post(name)).status, name).toBe(405);
    expect(runs()).toBe(before);
  });

  describe("сюжет 6 «Клиент отказался от корзины» (П-03)", () => {
    it("без поручения — 409", async () => {
      expect((await post("reject")).status).toBe(409);
    });

    it("клиент отклоняет корзину в банке → событие Платформы → агент остановился сам; заказа, реквизита и операции нет; паспорт принят", async () => {
      const n = lastSeq();
      const callsFrom = demo.stand.stand.calls().length;
      const merchantsFrom = demo.stand.merchantCalls().length;
      const items = (await driver(demo).run(6)).map((i) => interpret(i, env));
      const rejected = steps().find((s) => s.seq > n && s.step === "cart.rejected")!;
      expect(rejected.params).toMatchObject({ code: "MANDATE_NOT_ACTIVE", state: "STOPPED" });
      const cartId = String(rejected.params.mandate_id);
      // Запись стенда: решение клиента в банке — тем же маршрутом подписи, принято (200).
      const calls = demo.stand.stand.calls().slice(callsFrom);
      expect(calls.filter((c) => c.method === "POST" && c.path === `/participants/v1/mandates/${cartId}/sign` && c.status === 200)).toHaveLength(1);
      // Код защиты: ни реквизита, ни заказа у витрины — агент остановился до них.
      expect(calls.some((c) => c.path === "/pao/v1/credentials")).toBe(false);
      expect(demo.stand.merchantCalls().slice(merchantsFrom).some((c) => c.method === "POST" && /\/orders$/.test(c.path))).toBe(false);
      // Событие Платформы об отказе — на шине; операции нет.
      const mon = demo.bus.history().flatMap((i) => (i.stream === "monitor" && i.event.seq > n ? [i.event] : []));
      expect(mon.some((e) => e.source === "pao_event" && e.what === "mandate.rejected" && e.ids.mandate_id === cartId)).toBe(true);
      expect(mon.some((e) => e.what.startsWith("operation."))).toBe(false);
      // Паспорт 6 и контролёр — на прогоне «reject» (прогон «intent» драйвера — свой паспорт 1).
      const runs = segments(items);
      expect(runs.map((s) => s.passport.name)).toEqual(["intent", "reject"]);
      for (const s of runs) expectAccepted(s);
      // Поручение использовано запросом корзины: повтор сюжета 6 — только после нового сюжета 1.
      expect((await post("reject")).status).toBe(409);
    });

    it("человек подписал корзину вместо отказа — шаг «подписана, а сюжет ждал отказа»; заказа и оплаты нет", async () => {
      const n = lastSeq();
      expect((await post("intent")).status).toBe(202);
      const w = await until(n, "intent.awaiting_signature");
      expect((await demo.stand.stand.issuer.sign(String(w.params.mandate_id))).statusCode).toBe(200);
      await until(n, "intent.signed");
      await demo.scenarios.settled();
      const merchantsFrom = demo.stand.merchantCalls().length;
      expect((await post("reject")).status).toBe(202);
      await until(n, "cart.card");
      expect((await post("cart/accept")).status).toBe(202);
      const cw = await until(n, "cart.awaiting_signature");
      expect((await demo.stand.stand.issuer.sign(String(cw.params.mandate_id))).statusCode).toBe(200);
      expect((await until(n, "reject.signed")).params.mandate_id).toBe(cw.params.mandate_id);
      await demo.scenarios.settled();
      expect(steps().some((s) => s.seq > n && (s.step === "order.placed" || s.step === "outcome" || s.step === "cart.rejected"))).toBe(false);
      expect(demo.stand.merchantCalls().slice(merchantsFrom).some((c) => c.method === "POST" && /\/orders$/.test(c.path))).toBe(false);
    });

    it("сюжет 2: корзину отклонили в банке — тот же шаг «корзина отклонена», а не «сюжет не дошёл до конца» (ревью П-11.1а № 4)", async () => {
      const n = lastSeq();
      expect((await post("intent")).status).toBe(202);
      const w = await until(n, "intent.awaiting_signature");
      expect((await demo.stand.stand.issuer.sign(String(w.params.mandate_id))).statusCode).toBe(200);
      await until(n, "intent.signed");
      await demo.scenarios.settled();
      expect((await post("purchase")).status).toBe(202);
      await until(n, "cart.card");
      expect((await post("cart/accept")).status).toBe(202);
      const cw = await until(n, "cart.awaiting_signature");
      expect((await demo.stand.stand.issuer.sign(String(cw.params.mandate_id), { decision: "REJECT" })).statusCode).toBe(200);
      expect((await until(n, "cart.rejected")).params).toMatchObject({ mandate_id: cw.params.mandate_id, code: "MANDATE_NOT_ACTIVE", state: "STOPPED" });
      await demo.scenarios.settled();
      expect(steps().some((s) => s.seq > n && (s.step === "failed" || s.step === "reject.ask" || s.step === "order.placed"))).toBe(false);
    });
  });
});
