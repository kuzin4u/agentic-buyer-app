// П-8.1 «Кнопки реакции» (модель «Кнопки реакции» v1.0; Р-1526, Р-1527): флаг показа, порт `PultActions` и его реализация
// на стенде, маршрут `POST /pult/act/<действие>`, тест с настоящим агентом по П2 дополнению 6 — отзыв поручения при
// ожидающем подтверждении → агенту `confirmation.rejected`, агент останавливается, «оплачено» нет.
import { DEMO_VIOLATORS, type DemoIds, type DemoViolator, type StandDemo } from "agentic-ps-platform/stand";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { envFlag } from "../../src/demo/flags.js";
import { t } from "../../src/demo/i18n.js";
import { actFailureLog, actFailWhat, pultAct } from "../../src/demo/pult-act.js";
import { pultActions } from "../../src/demo/pult-actions.js";
import type { BusItem, MonitorEvent, ScenarioLine } from "../../src/demo/bus.js";
import { startDemo, type Demo } from "../../src/demo/run.js";
import { REVIEW_ID_FIELDS, REVIEW_VIOLATORS, type ActionResult, type PultActions, type Reaction } from "../../src/pult/actions.js";
import type { PultBoardState } from "../../src/pult/feed.js";
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
    // Поля идентификаторов: `DEMO_ID_FIELDS` объявлен в `demo.d.ts`, но входом пакета `agentic-ps-platform/stand` не
    // экспортирован (`index.d.ts`, ревью П-8.1 № 11) — контракт типов: равенство проверяет tsc.
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
    // Номер транзакции пульта с типом звена — не номер стенда (ревью П-8.1 № 1, 2).
    for (const v of ["cart:CA", "order:ORD-1", "op:P1", "confirmation:Q1"]) {
      expect((await pultAct("stop", q({ cart: v }), a, feed, NOW)).status, v).toBe(400);
      expect((await pultAct("review", q({ mandate_id: v, condition: "R46", violator: "AGENT" }), a, feed, NOW)).status, v).toBe(400);
      expect((await pultAct("review", q({ order_id: "ORD-1", op_ref: v, condition: "R46", violator: "AGENT" }), a, feed, NOW)).status, v).toBe(400);
    }
    expect(feed.react).not.toHaveBeenCalled();
    expect(a.stopPurchase).not.toHaveBeenCalled();
    expect(a.sendToReview).not.toHaveBeenCalled();
  });

  it("словари пульта и монитора: строка режима показа одна и та же (ревью П-8.1 № 9)", () => {
    for (const lang of ["ru", "en"] as const)
      for (const k of ["mode.actions", "mode.actions_note", "mode.faults", "mode.faults_note", "mode.faults_note_plain"] as const) expect(t(lang, k), `${k} ${lang}`).toBe(PULT[k][lang]);
  });

  it("реализация порта: ответ стенда как есть — 4xx и исключение стенда — отказ; продление — новый срок", async () => {
    const demo = {
      stopPurchase: vi.fn(async () => ({ statusCode: 409, body: { error: { code: "MANDATE_NOT_ACTIVE" } }, rejected: [] })),
      remindClient: vi.fn(async () => ({ confirmation_id: "C", expires_at: "2026-11-12T12:05:00Z", extended: true })),
      revokeMandate: vi.fn(async () => {
        throw new Error("unknown mandate");
      }),
      sendToReview: vi.fn(() => ({ seq: 17, at: "2026-11-12T12:00:03.000Z" })),
    } as unknown as StandDemo;
    const p = pultActions(demo);
    expect(await p.stopPurchase("X")).toEqual({ ok: false, status: 409, code: "MANDATE_NOT_ACTIVE", rejected: [] });
    expect(await p.remindClient("C")).toEqual({ ok: true, expiresAt: "2026-11-12T12:05:00Z", extended: true });
    expect(await p.revokeMandate("Y")).toEqual({ ok: false, code: "unknown mandate" });
    // Б1 (ревью П-8.1 № 6): номер и время записи стенда — в ответе разбора
    expect(await p.sendToReview({ tx: { op_ref: "P" }, condition: "R46", violator: "AGENT" })).toEqual({ ok: true, recordSeq: 17, recordAt: "2026-11-12T12:00:03.000Z" });
  });

  it("Б1 (ревью П-8.1 № 4): длинный текст отказа стенда — не длиннее 120 знаков; сбой адаптера (не `Error` стенда) — `failed`, маршрут — 500, а не 409", async () => {
    const demo = {
      revokeMandate: vi.fn(async () => {
        throw new Error("x".repeat(500));
      }),
      stopPurchase: vi.fn(async () => {
        throw new TypeError("cannot read properties of undefined");
      }),
    } as unknown as StandDemo;
    const log = vi.fn();
    const p = pultActions(demo, log);
    const long = await p.revokeMandate("Y");
    expect(long).toMatchObject({ ok: false });
    expect(long.code!.length).toBe(120);
    expect(long.failed).toBeUndefined();
    // Отказ стенда по правилам — не сбой: в журнал сервера ничего не пишется (Б1, ревью Б1 № 3).
    expect(log).not.toHaveBeenCalled();
    expect(await p.stopPurchase("MND-cart-0001")).toEqual({ ok: false, failed: true, code: "ADAPTER_FAILED" });
    // Причина `failed` — в журнале сервера: вид действия, вид ошибки и её текст; номера объекта в строке нет (инвариант 1).
    expect(log).toHaveBeenCalledTimes(1);
    const line = String(log.mock.calls[0]![0]);
    expect(line).toBe(actFailureLog("stop", new TypeError("cannot read properties of undefined")));
    expect(line).toContain("TypeError");
    expect(line).toContain("cannot read properties of undefined");
    expect(line).not.toContain("MND-cart-0001");
    const feed = { react: vi.fn() };
    const r = await pultAct("stop", new URLSearchParams("cart=C1"), p, feed, NOW);
    expect(r.status).toBe(500);
    // не «сделано»: исход — «отказано», в журнал реакций ушёл отказ (инвариант 2; ревью Б1 № 7)
    expect(r.body).toMatchObject({ outcome: "refused", result: { failed: true } });
    expect(feed.react).toHaveBeenLastCalledWith(expect.objectContaining({ outcome: "refused" }));
    const r2 = await pultAct("revoke", new URLSearchParams("mandate=M1"), p, feed, NOW);
    expect(r2.status).toBe(409);
  });

  it("Б1 № 3: строка журнала сервера — из словаря (ru и en), вид действия разобран, текст ошибки до 120 знаков; сырой путь не журналируется", () => {
    // Слова — из словаря, как у прочих строк журнала сервера (`cli.stop_failed`, `cli.release_failed`; ревью Б-К1 № 2).
    for (const lang of ["ru", "en"] as const) {
      const line = actFailureLog("remind", new TypeError("y".repeat(500)), lang);
      const text = t(lang, "cli.act_failed").replace("{what}", "remind").replace("{kind}", "TypeError").replace("{text}", ": " + "y".repeat(120));
      expect(line, lang).toBe(text);
      // Не ошибка вовсе (стенд отдал строку, число, `undefined`) — в журнал только вид: домысливать текст нечему.
      expect(actFailureLog("stop", "упало", lang), lang).toBe(t(lang, "cli.act_failed").replace("{what}", "stop").replace("{kind}", "string").replace("{text}", ""));
      expect(actFailureLog("review", undefined, lang), lang).toBe(t(lang, "cli.act_failed").replace("{what}", "review").replace("{kind}", "undefined").replace("{text}", ""));
    }
    // По умолчанию — ru: журнал адаптера языка страницы не знает (его знает маршрут).
    expect(actFailureLog("stop", "упало")).toBe(actFailureLog("stop", "упало", "ru"));
    // Знаки, а не единицы UTF-16 (как `CODE_MAX` отказа): эмодзи не режется посередине.
    const emoji = actFailureLog("revoke", new TypeError("🙂".repeat(200)));
    expect(Array.from(emoji.slice(emoji.indexOf("TypeError: ") + "TypeError: ".length))).toHaveLength(120);
    // Ревью Б-К1 № 1: в журнал идёт только разобранное действие. Путь приходит от клиента — маршрут ловится по началу
    // `/pult/act/`, поэтому хвост может быть любым: номер объекта, чужой текст, десятки килобайт. В строке его быть не должно.
    expect(actFailWhat("stop")).toBe("stop");
    expect(actFailWhat("stop/mnd_0191f0c2-5f3a-7c21-9a01-6f1d2b3c4d5e")).toBe("unknown");
    expect(actFailWhat("x".repeat(10_000))).toBe("unknown");
    const sneaky = actFailureLog(actFailWhat("stop/mnd_0191f0c2"), new TypeError("boom"));
    expect(sneaky).not.toContain("mnd_0191f0c2");
    expect(sneaky).toContain("unknown");
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
  // Отсечка «после» — по номеру записи (`seq`), а не по позиции в истории шины: окно истории обрезается, позиции съезжают
  // (Б1, повторное ревью П-8.1-р № 4). Шаги сюжета пишет сам стенд в порядке их наступления, поэтому для них отсечка по `seq`
  // верна. **Событиям ПАО она не годится** (Б1, ревью Б1 № 10): номер события выдаётся при приёме на шину, и запоздавшее
  // событие прошлого теста получит `seq` больше нашей отсечки — его нашли бы вместо нашего. Поэтому события ищутся по номеру
  // запроса подтверждения, а запрос этого теста отличается от прошлых набором `seen`.
  const lastStep = () => steps().reduce((s, x) => Math.max(s, x.seq), 0);
  const after = (n: number, name: string) => () => steps().find((s) => s.seq > n && s.step === name);
  const post = (path: string, origin = demo.monitor.url) => fetch(`${demo.monitor.url}${path}`, { method: "POST", headers: { origin } });
  /** Сюжет 4 до ожидания подтверждения клиентом: подписи — эмулятором банка в автотесте (П2 п. 5). */
  /** Подтверждения прошлых тестов: история шины между сюжетами не очищается (ревью П-8.1 № 3). */
  const seen = new Set<string>();
  async function toPendingConfirmation(): Promise<{ n: number; intent: string; cart: string; confirmation: string }> {
    await demo.scenarios.settled();
    const n = lastStep();
    expect((await post("/scenario/upk")).status).toBe(202);
    const w = await until(after(n, "intent.awaiting_signature"));
    await demo.stand.stand.issuer.sign(String(w.params.mandate_id));
    await until(after(n, "cart.card"));
    expect((await post("/scenario/cart/accept")).status).toBe(202);
    const cw = await until(after(n, "cart.awaiting_signature"));
    await demo.stand.stand.issuer.sign(String(cw.params.mandate_id));
    await until(after(n, "upk.required"));
    // Только запрос подтверждения этого сюжета: запрос прошлого теста уже закрыт, его `confirmation.rejected` нашёлся бы сразу
    // и проверка П2 доп. 6 молча ослабла бы. Отличается запрос **не отсечкой по `seq`** (её запоздавшее событие прошлого теста
    // перешагнёт — Б1, ревью Б1 № 10), а набором уже виденных номеров: берём первый незнакомый.
    const ev = await until(() => events().find((e) => e.what === "confirmation.required" && !seen.has(String(e.ids.confirmation_id))));
    const confirmation = String(ev.ids.confirmation_id);
    seen.add(confirmation);
    return { n, intent: String(w.params.mandate_id), cart: String(cw.params.mandate_id), confirmation };
  }
  /** Событие — по номеру объекта, без отсечки по `seq` (Б1, ревью Б1 № 10): номер события выдаётся при приёме на шину. */
  const eventWith = (what: string, f: (e: MonitorEvent) => boolean) => () => events().find((e) => e.what === what && f(e));

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
    // Ревью П-8.1 № 10: без Origin — 403; не POST — 404.
    expect((await fetch(`${demo.monitor.url}/pult/act/stop?cart=X`, { method: "POST" })).status).toBe(403);
    expect((await fetch(`${demo.monitor.url}/pult/act/stop?cart=X`)).status).toBe(404);
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
    await until(eventWith("confirmation.rejected", (e) => e.ids.confirmation_id === p.confirmation));
    await demo.scenarios.settled();
    expect(steps().some((s) => s.seq > p.n && s.step === "outcome" && s.params.status === "AUTHORIZED")).toBe(false);
  });

  it("Б1 № 3 живьём: «остановить» по поручению-намерению (не CART) и «напомнить» по неожидающему запросу — 409 с текстом стенда, «отказано», не «сделано»", async () => {
    const p = await toPendingConfirmation();
    // (1) «Остановить покупку» по поручению намерения: остановка — только корзины (CART), стенд отказывает исключением.
    // Отказ по правилам, а не сбой: 409, `outcome: "refused"`, текст стенда в коде записи, признака `failed` нет (иначе 500).
    const notCart = await post(`/pult/act/stop?cart=${p.intent}`);
    expect(notCart.status).toBe(409);
    const nc = (await notCart.json()) as Reaction;
    expect(nc).toMatchObject({ action: "stop", obj: p.intent, outcome: "refused" });
    expect(nc.result?.failed).toBeUndefined();
    expect(nc.result!.code!.length).toBeLessThanOrEqual(120);
    // Причина — именно «не CART», а не «мандат не найден» и не иное состояние (ревью Б-К1 № 3): текст отказа стенда
    // (`agentic-ps-platform` v0.48.0, `dist/stand/demo-actions.js:14`) называет тип мандата и требуемый CART. Перепишет стенд
    // формулировку — тест покраснеет здесь, а не молча зазеленеет на другом отказе (сверка при подъёме тега, П2).
    expect(nc.result!.code).toContain("CART");
    expect(nc.result!.code).toContain(p.intent);
    expect(nc.result!.code).not.toContain("не найден");
    // Покупка от отказанной кнопки не двинулась: запрос подтверждения всё ещё ждёт.
    expect(events().some((e) => e.what === "confirmation.rejected" && e.ids.confirmation_id === p.confirmation)).toBe(false);
    // (2) Запрос подтверждения закрывается остановкой корзины (РП76) — и «Напомнить» по уже не ждущему запросу отказывают.
    const stop = (await (await post(`/pult/act/stop?cart=${p.cart}`)).json()) as Reaction;
    expect(stop).toMatchObject({ outcome: "done" });
    expect(stop.result?.rejected).toContain(p.confirmation);
    await until(eventWith("confirmation.rejected", (e) => e.ids.confirmation_id === p.confirmation));
    const late = await post(`/pult/act/remind?confirmation=${p.confirmation}`);
    expect(late.status).toBe(409);
    const lt = (await late.json()) as Reaction;
    expect(lt).toMatchObject({ action: "remind", obj: p.confirmation, cond: "R21", outcome: "refused" });
    expect(lt.result?.failed).toBeUndefined();
    // Причина — «запрос не ожидает решения», а не «запрос не найден» (`demo-actions.js:43` против `:40`): номер запроса верный,
    // отказ именно по состоянию (ревью Б-К1 № 3).
    expect(lt.result!.code).toContain(p.confirmation);
    expect(lt.result!.code).toContain("не ожидает");
    expect(lt.result!.code).not.toContain("не найден");
    await demo.scenarios.settled();
    expect(steps().some((s) => s.seq > p.n && s.step === "outcome" && s.params.status === "AUTHORIZED")).toBe(false);
  });

  it("П2 доп. 6: «Отозвать поручение» при ожидающем подтверждении → агенту confirmation.rejected и mandate.revoked, агент остановился, «оплачено» нет", async () => {
    const p = await toPendingConfirmation();
    const r = (await (await post(`/pult/act/revoke?mandate=${p.intent}`)).json()) as Reaction;
    expect(r).toMatchObject({ action: "revoke", outcome: "done", result: { ok: true } });
    await until(eventWith("confirmation.rejected", (e) => e.ids.confirmation_id === p.confirmation));
    await until(eventWith("mandate.revoked", (e) => e.ids.mandate_id === p.intent));
    await demo.scenarios.settled();
    expect(steps().some((s) => s.seq > p.n && s.step === "outcome" && s.params.status === "AUTHORIZED")).toBe(false);
    expect(events().some((e) => e.what === "operation.authorized" && e.ids.mandate_id === p.cart)).toBe(false);
  });

  it("П-8.2 (Р-1531): в режиме показа журнала стенда нет — у реакции «журнал недоступен», «упреждено» не ставится", async () => {
    // Своё нажатие (ревью П-8.2 № 8): тест не зависит от реакций прошлых тестов.
    const p = await toPendingConfirmation();
    expect((await post(`/pult/act/remind?confirmation=${p.confirmation}`)).status).toBe(200);
    const b = await boardUntil(demo, (x) => (x.reactions ?? []).some((r) => r.action === "remind" && r.obj === p.confirmation));
    const mine = b.reactions!.filter((r) => r.action === "remind" && r.obj === p.confirmation);
    expect(mine.map((r) => [r.link.state, r.preempted])).toEqual([["unavailable", undefined]]);
    // Покупку — остановить, чтобы не висела до срока (900 с).
    expect((await post(`/pult/act/stop?cart=${p.cart}`)).status).toBe(200);
    await demo.scenarios.settled();
  });
});

/** Доска пульта с ленты `/pult/events` (второе сообщение — `board`). */
async function boardOf(d: Demo): Promise<PultBoardState> {
  const ac = new AbortController();
  const res = await fetch(`${d.monitor.url}/pult/events`, { signal: ac.signal });
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let text = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      text += dec.decode(value, { stream: true });
      for (const m of text.split("\n\n").slice(0, -1)) {
        const j = JSON.parse(m.replace(/^data: /, "")) as { type: string; board?: PultBoardState };
        if (j.type === "board" && j.board) return j.board;
      }
    }
  } finally {
    ac.abort();
  }
  throw new Error("лента закрылась без доски");
}
async function boardUntil(d: Demo, f: (b: PultBoardState) => boolean, ms = 30_000): Promise<PultBoardState> {
  const end = Date.now() + ms;
  for (;;) {
    const b = await boardOf(d);
    if (f(b)) return b;
    if (Date.now() > end) throw new Error("не дождались доски");
    await new Promise((r) => setTimeout(r, 300));
  }
}

describe("У-04 на живом стенде в режиме сбоев: «Напомнить» → код клиента → «упреждено реакцией» (П-8.2, Р-1531)", { timeout: 180_000 }, () => {
  let demo: Demo;
  const steps = (): ScenarioLine[] => demo.bus.history().flatMap((i: BusItem) => (i.stream === "scenario" ? [i.line] : []));
  // По номеру записи, не по позиции (повторное ревью П-8.1-р № 4).
  const after = (n: number, name: string) => () => steps().find((s) => s.seq > n && s.step === name);
  const post = (path: string) => fetch(`${demo.monitor.url}${path}`, { method: "POST", headers: { origin: demo.monitor.url } });
  async function until<T>(f: () => T | undefined, ms = 60_000): Promise<T> {
    const end = Date.now() + ms;
    for (;;) {
      const v = f();
      if (v !== undefined) return v;
      if (Date.now() > end) throw new Error("не дождались");
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  beforeAll(async () => {
    demo = await startDemo({ faults: true });
  }, 60_000);
  afterAll(async () => {
    await demo?.close();
  });

  it("покупка оплачена по событию; запись R21 — «соблюдено» с «упреждено реакцией», реакция связана с записью CLIENT_REMINDED стенда; паспорта R21 нет", async () => {
    // Сюжет 4 вручную (эмулятор клиента — «Вручную»): подписи — эмулятором банка в автотесте (П2 п. 5).
    const n = steps().reduce((s, x) => Math.max(s, x.seq), 0);
    expect((await post("/scenario/upk")).status).toBe(202);
    const w = await until(after(n, "intent.awaiting_signature"));
    await demo.stand.stand.issuer.sign(String(w.params.mandate_id));
    await until(after(n, "cart.card"));
    expect((await post("/scenario/cart/accept")).status).toBe(202);
    const cw = await until(after(n, "cart.awaiting_signature"));
    await demo.stand.stand.issuer.sign(String(cw.params.mandate_id));
    const req = await until(after(n, "upk.required"));
    const sms = await until(after(n, "upk.sms"));
    // Номер запроса подтверждения — с доски пульта («Идёт к нарушению» R21), как у оператора.
    const b0 = await boardUntil(demo, (b) => b.control.waits.some((x) => x.cond === "R21"));
    const w21 = b0.control.waits.find((x) => x.cond === "R21")!;
    const q = w21.confirmationId!;
    // Кнопка у строки «Идёт к нарушению» — только после порога (экран показывает созревшие ожидания), и запись протокола
    // П-6.1а заводится тогда же: оператор жмёт после порога (модель 1.23: реакция раньше записи не считается).
    const dueIn = Date.parse(w21.since) + b0.control.waitMs - Date.now();
    if (dueIn > 0) await new Promise((r) => setTimeout(r, dueIn + 250));
    // Оператор: «Напомнить клиенту».
    const r = (await (await post(`/pult/act/remind?confirmation=${q}`)).json()) as Reaction;
    expect(r).toMatchObject({ outcome: "done", result: { ok: true, extended: true } });
    // Клиент: страница УПК → код из SMS → «подтвердить».
    const answer = await fetch(String(req.params.upk_url), {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ decision: "APPROVE", instrument: "CARD", code: String(sms.params.code) }).toString(),
    });
    expect(answer.status).toBe(200);
    const outcome = await until(after(n, "outcome"), 90_000);
    expect(outcome.params.status).toBe("AUTHORIZED");
    await demo.scenarios.settled();

    // «Оплачено» на доске — только по событию Платформы (инвариант 6): оно может прийти позже шага итога сюжета.
    const cart = String(cw.params.mandate_id);
    const b = await boardUntil(demo, (x) => (x.reactions ?? []).some((y) => y.action === "remind" && y.preempted === "R21") && x.cards.some((c) => c.id === cart && c.outcome === "paid"), 60_000);
    const rr = b.reactions!.find((y) => y.action === "remind" && y.obj === q)!;
    expect(rr).toMatchObject({ preempted: "R21", link: { state: "linked", what: "CLIENT_REMINDED" } });
    // Паспорта у этой покупки нет вовсе (У-04: «паспорт НЕ появляется» — ни по R21, ни по условиям журнала стенда, которые
    // в режиме сбоев теперь считаются; ревью П-8.2 № 1) — ни у корзины, ни у поручения-намерения; «оплачено» — по событию.
    expect(b.control.passports.filter((p) => p.obj === cart || p.obj === String(w.params.mandate_id))).toEqual([]);
    expect(b.control.passports.flatMap((p) => p.findings.map((f) => f.cond))).not.toContain("R21");
    expect(b.cards.filter((c) => c.kind === "tx").map((c) => [c.id, c.cartMandateId, c.outcome])).toContainEqual([cart, cart, "paid"]);
    // П-6.1а: в «Журнале» — запись протокола R21 по этой покупке «упреждено реакцией» (пометка движка, В2 (а)), время до
    // реакции есть; нарушений по ней в протоколе нет.
    const pb = await boardUntil(demo, (x) => (x.protocol?.entries ?? []).some((e) => e.cond === "R21" && e.obj === cart && e.status === "prevented"), 30_000);
    const pe = pb.protocol!.entries.find((e) => e.cond === "R21" && e.obj === cart)!;
    expect(pe).toMatchObject({ type: "warn", status: "prevented", reaction: "remind" });
    expect(pe.reactSec).toBeGreaterThanOrEqual(0);
    expect(pb.protocol!.entries.filter((e) => e.obj === cart && e.type === "bad")).toEqual([]);
  });
});
