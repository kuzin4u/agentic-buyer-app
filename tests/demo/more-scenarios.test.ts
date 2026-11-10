// П-11.1 (Р-1457, Р-1459): сюжеты 6–10 — правильные тесты задания на тестирование пульта — на живом стенде с настоящим
// агентом (createAgentCore). Проверка здесь — код защиты и записи стенда; паспорт К2.1 и контролёр К2.2 — по ленте
// прогона, как у сюжетов 1–5 (tests/demo/interpret-live.test.ts). Паспорт в пульте — П-11.5 основного окна.
// Решения клиента в банке — эмулятором банка в автотесте (П2 п. 5, как подпись в drive.ts).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { control, DEFAULT_WAIT_MS, splitRuns } from "../../src/dashboards/control.js";
import { interpret, LOCAL_STAND_EMULATED, type InterpretEnv, type Interpretation } from "../../src/dashboards/interpret.js";
import { matches, type Passport } from "../../src/dashboards/passports.js";
import { parseDiagSnapshot, parseWireItem } from "../../src/dashboards/wire.js";
import type { BusItem, ScenarioLine } from "../../src/demo/bus.js";
import { MESSAGES } from "../../src/demo/i18n.js";
import { startDemo, type Demo } from "../../src/demo/run.js";
import { MORE_SCENARIOS } from "../../src/demo/scenarios.js";
import { TRAINING_MERCHANTS } from "../../src/demo/shops.js";
import { rawInHumanText } from "../dashboards/human-text.js";
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
  // З2: в тексте человека ключевых строк нет машинных кодов и имён полей — ru и en (ревью П-11.1б № 2).
  for (const r of s.items.filter((x) => x.level === "key"))
    for (const lang of ["ru", "en"] as const) expect(rawInHumanText(r.phrase[lang], lang), `сюжет ${p.no}, seq ${r.seq}, ${lang}: ${r.phrase[lang]}`).toBeUndefined();
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
      expect(items.find((r) => r.ref === "cart.rejected")?.stage).toBe("outcome"); // ревью П-11.1б № 3
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

  describe("сюжет 7 «Клиент не подтвердил покупку» (П-04)", () => {
    it("«Отклонить» на странице УПК → запрос стенда REJECTED → агент остановился сам (CONFIRMATION_REJECTED); подтверждения и оплаты нет; паспорт принят", async () => {
      const n = lastSeq();
      const callsFrom = demo.stand.stand.calls().length;
      const items = (await driver(demo).run(7)).map((i) => interpret(i, env));
      const declined = steps().find((s) => s.seq > n && s.step === "upk.declined")!;
      expect(declined.params).toMatchObject({ code: "CONFIRMATION_REJECTED", state: "STOPPED" });
      const id = String(steps().find((s) => s.seq > n && s.step === "upk.required")!.params.confirmation_id);
      // Запись стенда: запрос подтверждения П6 — отклонён решением человека через страницу УПК (POST шлюза участников).
      expect((await demo.stand.stand.confirmations.get(id))?.status).toBe("REJECTED");
      const calls = demo.stand.stand.calls().slice(callsFrom);
      expect(calls.filter((c) => c.method === "POST" && c.path === `/participants/v1/confirmations/${id}` && c.status === 200)).toHaveLength(1);
      const mon = demo.bus.history().flatMap((i) => (i.stream === "monitor" && i.event.seq > n ? [i.event] : []));
      expect(mon.some((e) => e.what === "confirmation.approved" || e.what === "operation.authorized")).toBe(false);
      expect(steps().some((s) => s.seq > n && s.step === "outcome")).toBe(false);
      // Остановленная покупка — на стадии «Итог», а не «Подтверждение» (ревью П-11.1б № 3).
      expect(items.find((r) => r.ref === "upk.declined")?.stage).toBe("outcome");
      const runs = segments(items);
      expect(runs.map((s) => s.passport.name)).toEqual(["unconfirmed"]);
      for (const s of runs) expectAccepted(s);
    });
  });
});

// Р-1459 В6, Р-1465 (в): срок запроса подтверждения без режима сбоев — 900 с; на стенде с `faults` — demo_order_hold_sec
// (45 с). Стенд запрос сам не просрочивает (таймеров нет, истечение — при обращении), а ядро перечитывает его только через
// expires_at + signature_skew_sec агента (300 с). Поэтому:
//  - обычный прогон и CI (≈ 50 с): ответ банка после срока — Платформа отвечает 409 EXPIRED и шлёт confirmation.expired,
//    ядро останавливается по событию;
//  - SLOW_TESTS=1, не в CI (≈ 6 мин): человек не отвечает вовсе — ядро узнаёт о сроке своим GET с допуском часов.
const SLOW = process.env.SLOW_TESTS === "1";

describe("сюжет 7: срок запроса подтверждения истёк (стенд с faults; «не ответил вовсе» — только SLOW_TESTS=1)", { timeout: 600_000 }, () => {
  let demo: Demo;
  const steps = (): ScenarioLine[] => demo.bus.history().flatMap((i: BusItem) => (i.stream === "scenario" ? [i.line] : []));
  const post = (name: string) => fetch(`${demo.monitor.url}/scenario/${name}`, { method: "POST", headers: { origin: demo.monitor.url } });
  const lastSeq = () => demo.bus.history().reduce((m, i) => Math.max(m, i.stream === "monitor" ? i.event.seq : i.line.seq), 0);
  async function until(from: number, name: string, ms = 30_000): Promise<ScenarioLine> {
    const end = Date.now() + ms;
    for (;;) {
      const s = steps().find((x) => x.seq > from && x.step === name);
      if (s) return s;
      if (Date.now() > end) throw new Error(`не дождались шага ${name}`);
      await pause(100);
    }
  }

  /** Сюжет 7 до запроса подтверждения: поручение и корзина подписаны эмулятором банка (автотест, П2 п. 5). */
  async function toConfirmation(from: number): Promise<{ id: string; expiresAt: string }> {
    expect((await post("unconfirmed")).status).toBe(202);
    const w = await until(from, "intent.awaiting_signature");
    expect((await demo.stand.stand.issuer.sign(String(w.params.mandate_id))).statusCode).toBe(200);
    await until(from, "cart.card");
    expect((await post("cart/accept")).status).toBe(202);
    const cw = await until(from, "cart.awaiting_signature");
    expect((await demo.stand.stand.issuer.sign(String(cw.params.mandate_id))).statusCode).toBe(200);
    const id = String((await until(from, "upk.required")).params.confirmation_id);
    const rec = await demo.stand.stand.confirmations.get(id);
    expect(rec?.status).toBe("PENDING");
    // Срок запроса — короткий режима сбоев, а не 15 минут (ревью П-11.1б № 7).
    expect(Date.parse(rec!.expires_at) - demo.stand.stand.now().getTime()).toBeLessThan(120_000);
    return { id, expiresAt: String(rec!.expires_at) };
  }

  /** Конец прогона: запрос стенда EXPIRED, шаг остановки ядра, паспорт 7 и «Контроль» по ленте после from. */
  async function expectExpired(from: number, id: string, ms: number): Promise<void> {
    const declined = await until(from, "upk.declined", ms);
    expect(declined.params).toMatchObject({ code: "CONFIRMATION_EXPIRED", state: "STOPPED" });
    expect((await demo.stand.stand.confirmations.get(id))?.status).toBe("EXPIRED");
    await demo.scenarios.settled();
    const raw = await (await fetch(`${demo.monitor.url}/api/diag`)).json();
    const env: InterpretEnv = { snapshot: parseDiagSnapshot(raw)!.snapshot, emulated: LOCAL_STAND_EMULATED, training: TRAINING_MERCHANTS };
    // Записи шины этого прогона в формате линии (как у драйвера); ждём, пока шина затихнет.
    let seen = -1;
    for (let i = 0; i < 40 && seen !== demo.bus.history().length; i++) {
      seen = demo.bus.history().length;
      demo.bus.poll();
      await pause(400);
    }
    const items = demo.bus
      .history()
      .map((r) => parseWireItem(JSON.parse(JSON.stringify(r))))
      .filter((x): x is NonNullable<typeof x> => x !== undefined && (x.stream === "monitor" ? x.event.seq : x.line.seq) > from)
      .map((x) => interpret(x, env));
    expect(items.some((r) => r.ref === "confirmation.approved" || r.ref === "operation.authorized")).toBe(false);
    const runs = segments(items);
    expect(runs.map((s) => s.passport.name)).toEqual(["unconfirmed"]);
    for (const s of runs) expectAccepted(s);
  }

  beforeAll(async () => {
    demo = await startDemo({ faults: true });
    // Режим сбоев не включился — тест «≈ 50 с» стал бы 15-минутным.
    expect(demo.stand.stand.params.demo_order_hold_sec).toBeLessThan(120);
  }, 30_000);
  afterAll(async () => {
    await demo?.close();
  });

  it("ответ банка после срока → Платформа 409 EXPIRED и confirmation.expired → агент остановился сам (CONFIRMATION_EXPIRED); паспорт принят (≈ 50 с)", async () => {
    const n = lastSeq();
    const { id, expiresAt } = await toConfirmation(n);
    while (demo.stand.stand.now().getTime() <= Date.parse(expiresAt)) await pause(500);
    await pause(1000);
    // Решение «подтвердить» пришло из банка после срока: запись не принята, запрос закрыт по сроку (РП50 п. 5).
    const late = await demo.stand.stand.issuer.confirm(id);
    expect(late.statusCode).toBe(409);
    expect(late.body).toMatchObject({ code: "CONFIRMATION_NOT_PENDING", status: "EXPIRED" });
    // Агент узнаёт по событию Платформы, а не по своему сроку с допуском часов (тот — минуты).
    await expectExpired(n, id, 15_000);
  });

  it.runIf(SLOW)("SLOW_TESTS=1: человек не отвечает вовсе → агент сам перечитывает запрос после срока с допуском часов → CONFIRMATION_EXPIRED (≈ 6 мин)", async () => {
    const n = lastSeq();
    const { id, expiresAt } = await toConfirmation(n);
    const skewMs = demo.stand.agent.params.signature_skew_sec * 1000;
    const wait = Date.parse(expiresAt) - demo.stand.stand.now().getTime() + skewMs + 60_000;
    await expectExpired(n, id, wait);
    // Решения человека не было: обращений банка по запросу нет.
    expect(demo.stand.stand.calls().some((c) => c.path === `/participants/v1/confirmations/${id}`)).toBe(false);
  });
});
