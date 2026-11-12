// П-11.4б: эмулятор клиента «Решения людей: Авто» (П5, дополнение 1; Р-1497). Таблица решений по сценарию теста, «Вручную» —
// ни одного действия, форма шагов `client.*` (только `code` / `status` и идентификатор объекта, источник `client-emulator`),
// словари ru/en, интерпретатор (участник — клиент, эмулированный; код — не ошибка агента) и живые прогоны в «Авто».
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { BusItem, ScenarioLine } from "../../src/demo/bus.js";
import { CLIENT_EMULATOR_SOURCE, CLIENT_STEPS, ClientEmulator, decide, type ClientEmulatorPorts, type RunLabel } from "../../src/demo/client-emulator.js";
import { MESSAGES } from "../../src/demo/i18n.js";
import { startDemo, type Demo } from "../../src/demo/run.js";
import type { ScenarioStep } from "../../src/demo/scenarios.js";
import { interpret, LOCAL_STAND_EMULATED, type InterpretEnv } from "../../src/dashboards/interpret.js";
import { PHRASES } from "../../src/dashboards/phrases.js";
import { parseWireItem } from "../../src/dashboards/wire.js";

const sc = (scenario: string): RunLabel => ({ scenario });
const ln = (step: string, params: Record<string, string | number> = {}) => ({ step, params });

describe("П-11.4б: таблица решений «сценарий × шаг ожидания» (П5 п. 2, доп. 1)", () => {
  it("сюжеты: карточка — «согласен», подпись поручения и корзины, подтверждение; П-03 — отказ от корзины, П-04 — отклонение, П-05 — отзыв", () => {
    expect(decide(sc("purchase"), ln("cart.card", { merchant_id: "MRC-1", intent_id: "m1" }))).toEqual({ kind: "cart_agree", intentId: "m1", merchantId: "MRC-1" });
    expect(decide(sc("intent"), ln("intent.awaiting_signature", { mandate_id: "m1" }))).toEqual({ kind: "sign", mandateId: "m1", reject: false });
    expect(decide(sc("purchase"), ln("cart.awaiting_signature", { mandate_id: "c1" }))).toEqual({ kind: "sign", mandateId: "c1", reject: false });
    expect(decide(sc("reject"), ln("cart.awaiting_signature", { mandate_id: "c1" }))).toEqual({ kind: "sign", mandateId: "c1", reject: true });
    expect(decide(sc("upk"), ln("upk.required", { confirmation_id: "cf1", upk_url: "http://x/c/cf1" }))).toEqual({ kind: "confirm", confirmationId: "cf1", reject: false });
    expect(decide(sc("unconfirmed"), ln("upk.required", { confirmation_id: "cf1" }))).toEqual({ kind: "confirm", confirmationId: "cf1", reject: true });
    expect(decide(sc("revoke"), ln("revoke.ask", { mandate_id: "m1" }))).toEqual({ kind: "revoke", mandateId: "m1" });
  });

  it("драйвер: подпись по просьбам ветки, отзыв — только Н-06; Н-07 «корзину не подписывать» — ничего", () => {
    for (const s of ["fault.note.intent_requested", "fault.note.cart_sign_ask", "fault.note.cart_sign_ask_scope"])
      expect(decide({ fault: "Н-09" }, ln(s, { mandate_id: "m1" })), s).toEqual({ kind: "sign", mandateId: "m1", reject: false });
    expect(decide({ fault: "Н-06" }, ln("fault.note.revoke_ask", { mandate_id: "m1" }))).toEqual({ kind: "revoke", mandateId: "m1" });
    expect(decide({ fault: "Н-08" }, ln("fault.note.revoke_ask", { mandate_id: "m1" }))).toBeUndefined();
    expect(decide({ fault: "Н-07" }, ln("fault.note.cart_keep_unsigned", { mandate_id: "c1" }))).toBeUndefined();
  });

  it("без метки, с незнакомой меткой, без идентификатора и на прочих шагах — ничего", () => {
    expect(decide(undefined, ln("intent.awaiting_signature", { mandate_id: "m1" }))).toBeUndefined();
    expect(decide(sc("demo_other"), ln("intent.awaiting_signature", { mandate_id: "m1" }))).toBeUndefined();
    expect(decide(sc("intent"), ln("intent.awaiting_signature"))).toBeUndefined();
    expect(decide(sc("purchase"), ln("revoke.ask", { mandate_id: "m1" }))).toBeUndefined();
    expect(decide(sc("purchase"), ln("outcome", { mandate_id: "m1" }))).toBeUndefined();
  });
});

/** Подменённые порты: шина — список подписчиков; банк — журнал вызовов и заданный ответ. */
function fakePorts(reply: { statusCode: number; body: unknown } = { statusCode: 200, body: { status: "ACTIVE" } }) {
  const subs = new Set<(i: BusItem) => void>();
  const calls: string[] = [];
  const emitted: ScenarioStep[] = [];
  let seq = 0;
  const ports: ClientEmulatorPorts = {
    issuer: {
      sign: async (id, o) => (calls.push(`sign ${id}${o?.decision ? ` ${o.decision}` : ""}`), reply),
      confirm: async (id, o) => (calls.push(`confirm ${id} ${o?.decision ?? ""}`), reply),
      revoke: async (id) => (calls.push(`revoke ${id}`), reply),
    },
    answerCart: (agree) => (calls.push(`cart ${agree}`), { ok: true }),
    subscribe: (fn) => (subs.add(fn), () => subs.delete(fn)),
    emit: (s) => emitted.push(s),
  };
  const push = (step: string, params: ScenarioLine["params"] = {}) => {
    for (const f of [...subs]) f({ stream: "scenario", line: { seq: ++seq, at: new Date(0).toISOString(), step, params } });
  };
  return { ports, calls, emitted, push, subs };
}

/** Все шаги ожидания клиента под всеми метками — то, на что эмулятор мог бы ответить. */
function feedAll(push: (step: string, params?: ScenarioLine["params"]) => void) {
  for (const run of ["intent", "purchase", "limit", "upk", "revoke", "reject", "unconfirmed", "scope", "suspended", "expired"]) {
    push(`run.${run}`);
    push("cart.card", { merchant_id: "MRC-1" });
    push("intent.awaiting_signature", { mandate_id: "m1" });
    push("cart.awaiting_signature", { mandate_id: "c1" });
    push("upk.required", { confirmation_id: "cf1", upk_url: "http://x/c/cf1" });
    push("revoke.ask", { mandate_id: "m1" });
  }
  for (const t of ["Н-01", "Н-06", "Н-07", "Н-08", "Н-09"]) {
    push("run.fault", { test: t });
    for (const s of ["fault.note.intent_requested", "fault.note.cart_sign_ask", "fault.note.cart_sign_ask_scope", "fault.note.revoke_ask", "fault.note.cart_keep_unsigned"]) push(s, { mandate_id: "m1" });
  }
}

describe("П-11.4б: режимы и пометка шагов", () => {
  it("уточнение 3: в «Вручную» (по умолчанию) — ни одного действия ни по одной метке и ни одного шага", async () => {
    const f = fakePorts();
    const e = new ClientEmulator(f.ports);
    expect(e.auto).toBe(false);
    feedAll(f.push);
    await e.settled();
    expect(f.calls).toEqual([]);
    expect(f.emitted).toEqual([]);
    await e.close();
  });

  it("в «Авто», П-04 и Н-07: «согласен», подпись корзины, отклонение запроса, «корзину не подписывать» — ничего; каждый шаг client.* — с источником client-emulator и идентификатором объекта", async () => {
    const f = fakePorts();
    const e = new ClientEmulator(f.ports);
    expect(e.setAuto(true)).toBe(true);
    f.push("run.unconfirmed");
    f.push("cart.card", { merchant_id: "MRC-1", intent_id: "m1" });
    f.push("cart.awaiting_signature", { mandate_id: "c1" });
    f.push("upk.required", { confirmation_id: "cf1", upk_url: "http://x/c/cf1" });
    f.push("run.fault", { test: "Н-07" });
    f.push("fault.note.cart_keep_unsigned", { mandate_id: "c2" });
    await e.settled();
    expect(f.calls).toEqual(["cart true", "sign c1", "confirm cf1 REJECT"]);
    expect(f.emitted).toEqual([
      { step: "client.auto_on", params: { source: CLIENT_EMULATOR_SOURCE } },
      { step: "client.cart_agreed", params: { mandate_id: "m1", merchant_id: "MRC-1", source: CLIENT_EMULATOR_SOURCE } },
      { step: "client.signed", params: { mandate_id: "c1", source: CLIENT_EMULATOR_SOURCE } },
      { step: "client.confirm_rejected", params: { confirmation_id: "cf1", source: CLIENT_EMULATOR_SOURCE } },
    ]);
    await e.close();
  });

  it("уточнение 1: отказ банка — только status и машинный код; тело ответа, код УПК и ссылка на шину не идут", async () => {
    const f = fakePorts({ statusCode: 409, body: { code: "MANDATE_NOT_PENDING", detail: "секрет банка", upk_code: "123456" } });
    const e = new ClientEmulator(f.ports);
    e.setAuto(true);
    f.push("run.upk");
    f.push("upk.required", { confirmation_id: "cf1", upk_url: "http://x/c/cf1" });
    f.push("upk.sms", { code: "123456" });
    await e.settled();
    expect(f.emitted.at(-1)).toEqual({ step: "client.confirm_failed", params: { confirmation_id: "cf1", status: 409, code: "MANDATE_NOT_PENDING", source: CLIENT_EMULATOR_SOURCE } });
    const text = JSON.stringify(f.emitted);
    expect(text).not.toMatch(/123456|upk_url|http:|секрет/);
    await e.close();
  });

  it("включение посреди прогона — по метке этого прогона, но только на следующие шаги; выключение — сразу без действий", async () => {
    const f = fakePorts();
    const e = new ClientEmulator(f.ports);
    f.push("run.reject");
    f.push("intent.awaiting_signature", { mandate_id: "m1" }); // до включения — не подписывается задним числом
    e.setAuto(true);
    f.push("cart.awaiting_signature", { mandate_id: "c1" });
    await e.settled();
    e.setAuto(false);
    f.push("upk.required", { confirmation_id: "cf1" });
    await e.settled();
    expect(f.calls).toEqual(["sign c1 REJECT"]);
    expect(f.emitted.map((s) => s.step)).toEqual(["client.auto_on", "client.cart_rejected", "client.auto_off"]);
    expect(e.setAuto(false)).toBe(false); // повтор — без шага
    expect(f.emitted).toHaveLength(3);
    await e.close();
    expect(f.subs.size).toBe(0);
  });

  /** Порты с банком, который отвечает только по команде теста: действие «висит», пока его не отпустят. */
  function heldPorts() {
    const f = fakePorts();
    const held: (() => void)[] = [];
    const reply = { statusCode: 200, body: {} };
    const hold = (call: string) => new Promise<typeof reply>((ok) => held.push(() => (f.calls.push(call), ok(reply))));
    const ports: ClientEmulatorPorts = { ...f.ports, issuer: { sign: (id) => hold(`sign ${id}`), confirm: (id) => hold(`confirm ${id}`), revoke: (id) => hold(`revoke ${id}`) } };
    const release = async () => {
      while (held.length) held.shift()!();
      await new Promise((r) => setTimeout(r, 0));
    };
    return { ...f, ports, held, release };
  }

  it("ревью № 4: «выкл → вкл» посреди длинного вызова — шаги, пришедшие до выключения, не оживают", async () => {
    const f = heldPorts();
    const e = new ClientEmulator(f.ports);
    e.setAuto(true);
    f.push("run.purchase");
    f.push("intent.awaiting_signature", { mandate_id: "m1" }); // начато и висит
    f.push("cart.awaiting_signature", { mandate_id: "c1" }); // в очереди за ним
    await new Promise((r) => setTimeout(r, 0));
    e.setAuto(false);
    e.setAuto(true);
    await f.release();
    await e.settled();
    await f.release();
    expect(f.calls).toEqual(["sign m1"]); // начатое до выключения — доведено; очередь до выключения — не выполнена
    expect(f.emitted.map((s) => s.step)).toEqual(["client.auto_on", "client.auto_off", "client.auto_on", "client.signed"]);
    await e.close();
  });

  it("ревью № 3: close() во время начатого действия — шаг о совершённом действии всё равно на шине (пометка, П5 п. 3)", async () => {
    const f = heldPorts();
    const e = new ClientEmulator(f.ports);
    e.setAuto(true);
    f.push("run.revoke");
    f.push("revoke.ask", { mandate_id: "m1" }); // начато и висит
    f.push("intent.awaiting_signature", { mandate_id: "m2" }); // в очереди за ним
    await new Promise((r) => setTimeout(r, 0));
    const closing = e.close();
    await f.release();
    await closing;
    await f.release();
    // Начатое — доведено и помечено; стоявшее в очереди после close() не начинается (проверка `#closed` в `#act`).
    expect(f.calls).toEqual(["revoke m1"]);
    expect(f.emitted.at(-1)).toEqual({ step: "client.revoked", params: { mandate_id: "m1", source: CLIENT_EMULATOR_SOURCE } });
  });

  it("ревью № 10: код не по форме не выходит; исключение банка — CLIENT_CALL_FAILED; отказ ответа на карточку — cart_failed", async () => {
    const odd = fakePorts({ statusCode: 409, body: { code: "123456 секрет" } });
    const e1 = new ClientEmulator(odd.ports);
    e1.setAuto(true);
    odd.push("run.intent");
    odd.push("intent.awaiting_signature", { mandate_id: "m1" });
    await e1.settled();
    expect(odd.emitted.at(-1)).toEqual({ step: "client.sign_failed", params: { mandate_id: "m1", status: 409, source: CLIENT_EMULATOR_SOURCE } });
    await e1.close();

    const thrown = fakePorts();
    const e2 = new ClientEmulator({ ...thrown.ports, issuer: { ...thrown.ports.issuer, confirm: () => Promise.reject(new Error("банк упал: секрет")) } });
    e2.setAuto(true);
    thrown.push("run.upk");
    thrown.push("upk.required", { confirmation_id: "cf1" });
    await e2.settled();
    expect(thrown.emitted.at(-1)).toEqual({ step: "client.confirm_failed", params: { confirmation_id: "cf1", code: "CLIENT_CALL_FAILED", source: CLIENT_EMULATOR_SOURCE } });
    await e2.close();

    for (const [code, want] of [["NOT_AWAITING", "NOT_AWAITING"], ["не ждём", "CART_ANSWER_FAILED"]] as const) {
      const c = fakePorts();
      const e3 = new ClientEmulator({ ...c.ports, answerCart: () => ({ ok: false, code }) });
      e3.setAuto(true);
      c.push("run.purchase");
      c.push("cart.card", { merchant_id: "MRC-1", intent_id: "m1" });
      await e3.settled();
      expect(c.emitted.at(-1)).toEqual({ step: "client.cart_failed", params: { mandate_id: "m1", merchant_id: "MRC-1", code: want, source: CLIENT_EMULATOR_SOURCE } });
      await e3.close();
    }
  });
});

describe("П-11.4б: словари и интерпретатор", () => {
  it("у каждого шага client.* — текст ru/en на мониторе и в интерпретаторе, с пометкой «эмулятор клиента»", () => {
    for (const s of CLIENT_STEPS) {
      expect(MESSAGES.ru[`step.${s}` as keyof (typeof MESSAGES)["ru"]], s).toMatch(/^Эмулятор клиента:/);
      expect(MESSAGES.en[`step.${s}` as keyof (typeof MESSAGES)["en"]], s).toMatch(/^Client emulator:/);
      expect(PHRASES.scenario[s]?.ru, s).toMatch(/^Эмулятор клиента:/);
      expect(PHRASES.scenario[s]?.en, s).toMatch(/^Client emulator:/);
    }
  });

  it("шаг эмулятора — участник «клиент», эмулированный; неудача — «конфликт» без нарушителя, код — во фразе, не ошибка агента", () => {
    const w = parseWireItem({ stream: "scenario", line: { seq: 1, at: new Date(0).toISOString(), step: "client.sign_failed", params: { mandate_id: "m1", status: 409, code: "MANDATE_NOT_PENDING", source: "client-emulator" } } });
    expect(w).toBeDefined();
    // Снимок реестров шагу сюжета без кода не нужен; код эмулятора квалификации не получает — снимок не читается.
    const i = interpret(w!, { snapshot: {} as InterpretEnv["snapshot"], emulated: LOCAL_STAND_EMULATED });
    expect(i).toMatchObject({ actor: "client", emulated: true, kind: "conflict", stage: "service" });
    expect(i.who).toBeUndefined();
    expect(i.phrase.ru).toMatch(/^Эмулятор клиента: подпись поручения m1 не прошла — \S/);
    // Успешное действие — норма.
    const ok = parseWireItem({ stream: "scenario", line: { seq: 2, at: new Date(0).toISOString(), step: "client.signed", params: { mandate_id: "m1", source: "client-emulator" } } });
    expect(interpret(ok!, { snapshot: {} as InterpretEnv["snapshot"], emulated: LOCAL_STAND_EMULATED })).toMatchObject({ actor: "client", emulated: true, kind: "norm" });
  });
});

describe("П-11.4б: живой стенд в «Авто» (DEMO_FAULTS=1) — без единого issuer.* в тесте", { timeout: 120_000 }, () => {
  let demo: Demo;
  beforeAll(async () => {
    demo = await startDemo({ faults: true });
  }, 30_000);
  afterAll(async () => {
    await demo?.close();
  });

  const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const lastSeq = () => demo.bus.history().reduce((m, i) => Math.max(m, i.stream === "monitor" ? i.event.seq : i.line.seq), 0);
  const steps = (from: number) => demo.bus.history().flatMap((i) => (i.stream === "scenario" && i.line.seq > from ? [i.line] : []));
  async function until(from: number, names: readonly string[], ms = 90_000): Promise<ScenarioLine> {
    const end = Date.now() + ms;
    for (;;) {
      const s = steps(from).find((x) => names.includes(x.step));
      if (s) return s;
      if (Date.now() > end) throw new Error(`не дождались ${names.join(" / ")}: ${steps(from).map((x) => x.step).join(", ")}`);
      await pause(50);
    }
  }
  const post = async (path: string) => {
    const r = await fetch(`${demo.monitor.url}${path}`, { method: "POST", headers: { origin: demo.monitor.url } });
    expect(r.status, path).toBe(202);
  };
  /** Уточнения 1 и 2 у каждого шага client.* прогона: только идентификаторы объекта, status, машинный code и source; хотя
   *  бы один идентификатор объекта (кроме переключения режима). */
  const ALLOWED = ["mandate_id", "confirmation_id", "merchant_id", "order_id", "status", "code", "source"];
  function checkClientSteps(s: readonly ScenarioLine[]): void {
    for (const x of s.filter((y) => y.step.startsWith("client."))) {
      const name = `${x.step} ${JSON.stringify(x.params)}`;
      expect(Object.keys(x.params).filter((k) => !ALLOWED.includes(k)), name).toEqual([]);
      expect(x.params.source, name).toBe("client-emulator");
      if (x.params.code !== undefined) expect(String(x.params.code), name).toMatch(/^[A-Z][A-Z0-9_]{0,63}$/);
      if (!x.step.startsWith("client.auto_")) expect(["mandate_id", "confirmation_id", "order_id"].some((k) => typeof x.params[k] === "string"), name).toBe(true);
    }
  }
  async function run(name: string, end: readonly string[]): Promise<ScenarioLine[]> {
    await demo.scenarios.settled();
    await demo.faulty?.settled();
    const n = lastSeq();
    await post(`/scenario/${name}`);
    const last = await until(n, [...end, "failed"]);
    expect(last.step, JSON.stringify(last.params)).not.toBe("failed");
    await demo.clientEmulator!.settled();
    const s = steps(n);
    checkClientSteps(s);
    return s;
  }
  async function fault(test: string): Promise<{ last: ScenarioLine; s: ScenarioLine[] }> {
    await demo.scenarios.settled();
    await demo.faulty!.settled();
    const n = lastSeq();
    const r = await fetch(`${demo.monitor.url}/fault/${encodeURIComponent(test)}`, { method: "POST", headers: { origin: demo.monitor.url } });
    expect(r.status).toBe(202);
    const last = await until(n, ["fault.refused", "fault.marked", "fault.failed", "fault.unplayed"]);
    await demo.faulty!.settled();
    await demo.clientEmulator!.settled();
    const s = steps(n);
    checkClientSteps(s);
    return { last, s };
  }

  it("эмулятор создан, по умолчанию «Вручную»; включение — шаг client.auto_on на шине", async () => {
    expect(demo.clientEmulator).toBeDefined();
    expect(demo.clientEmulator!.auto).toBe(false);
    const n = lastSeq();
    demo.clientEmulator!.setAuto(true);
    expect(steps(n).map((s) => s.step)).toEqual(["client.auto_on"]);
  });

  it("сюжет 2 «покупка»: подпись поручения, «согласен» (с поручением-намерением карточки, Р-1506), подпись корзины — эмулятором; сюжет доходит до итога", async () => {
    const i = await run("intent", ["intent.signed"]);
    const intentId = i.find((x) => x.step === "client.signed")?.params.mandate_id;
    expect(typeof intentId).toBe("string");
    const s = await run("purchase", ["outcome"]);
    expect(s.filter((x) => x.step.startsWith("client.")).map((x) => x.step)).toEqual(["client.cart_agreed", "client.signed"]);
    // «согласен» привязан к тому же поручению, что карточка и корзина (`cart.created` intent_id).
    expect(s.find((x) => x.step === "cart.card")?.params.intent_id).toBe(intentId);
    expect(s.find((x) => x.step === "client.cart_agreed")?.params.mandate_id).toBe(intentId);
    expect(s.find((x) => x.step === "cart.created")?.params.intent_id).toBe(intentId);
  });

  it("сюжет 7 (П-04): эмулятор отклоняет запрос подтверждения в банке — upk.declined", async () => {
    const s = await run("unconfirmed", ["upk.declined", "outcome"]);
    const names = s.map((x) => x.step);
    expect(names).toContain("client.confirm_rejected");
    expect(names).toContain("upk.declined");
    expect(names).not.toContain("client.confirmed");
    expect(names).not.toContain("outcome");
  });

  it("драйвер Н-07 «ПР»: эмулятор подписывает только поручение, корзину — нет; защита PRINCIPAL_SIGNATURE_PENDING", async () => {
    const { last, s } = await fault("Н-07");
    expect(last.step, JSON.stringify(last.params)).toBe("fault.refused");
    expect(last.params.code).toBe("PRINCIPAL_SIGNATURE_PENDING");
    expect(s.filter((x) => x.step.startsWith("client.")).map((x) => x.step)).toEqual(["client.signed"]);
    const intent = s.find((x) => x.step === "fault.note.intent_requested")?.params.mandate_id;
    expect(s.find((x) => x.step === "client.signed")?.params.mandate_id).toBe(intent);
  });

  it("сюжет 6 (П-03): эмулятор отказывается от корзины в банке — cart.rejected", async () => {
    await run("intent", ["intent.signed"]);
    const s = await run("reject", ["cart.rejected", "reject.signed"]);
    const names = s.map((x) => x.step);
    expect(names).toContain("client.cart_rejected");
    expect(names).toContain("cart.rejected");
    expect(names).not.toContain("reject.signed");
    expect(names).not.toContain("client.signed");
  });

  it("драйвер Н-06 «ПР»: эмулятор подписывает поручение и корзину и отзывает поручение — защита MANDATE_REVOKED", async () => {
    const { last, s } = await fault("Н-06");
    expect(last.step, JSON.stringify(last.params)).toBe("fault.refused");
    expect(last.params.code).toBe("MANDATE_REVOKED");
    expect(s.filter((x) => x.step.startsWith("client.")).map((x) => x.step)).toEqual(["client.signed", "client.signed", "client.revoked"]);
  });

  it("сюжет 4 (УПК): подтверждение — issuer.confirm эмулятором; шаги client.* — только разрешённые ключи (уточнение 1, проверка run)", async () => {
    const s = await run("upk", ["outcome", "upk.declined"]);
    expect(s.map((x) => x.step)).toContain("client.confirmed");
    expect(s.map((x) => x.step)).toContain("outcome");
    expect(JSON.stringify(s.filter((x) => x.step.startsWith("client.")))).not.toMatch(/upk_url|\/c\//);
    expect(Object.keys(s.find((x) => x.step === "client.confirmed")!.params).sort()).toEqual(["confirmation_id", "source"]);
  });

  it("сюжет 5 (П-05): эмулятор отзывает поручение в банке — revoke.refused", async () => {
    await run("intent", ["intent.signed"]);
    const s = await run("revoke", ["revoke.refused"]);
    expect(s.map((x) => x.step)).toContain("client.revoked");
  });

  it("в «Вручную» живой сюжет стоит на подписи — эмулятор ничего не делает", async () => {
    await demo.scenarios.settled();
    demo.clientEmulator!.setAuto(false);
    const n = lastSeq();
    await post("/scenario/intent");
    await until(n, ["intent.awaiting_signature"]);
    await pause(1_500);
    expect(steps(n).map((x) => x.step)).not.toContain("intent.signed");
    expect(steps(n).filter((x) => x.step.startsWith("client.") && x.step !== "client.auto_off")).toEqual([]);
    await post("/scenario/abort");
    await demo.scenarios.settled();
  });
});

describe("П-11.4б: без режима сбоев эмулятора нет (П5 п. 4)", () => {
  let demo: Demo;
  beforeAll(async () => {
    demo = await startDemo();
  }, 30_000);
  afterAll(async () => {
    await demo?.close();
  });

  it("demo.clientEmulator нет", () => {
    expect(demo.clientEmulator).toBeUndefined();
  });
});
