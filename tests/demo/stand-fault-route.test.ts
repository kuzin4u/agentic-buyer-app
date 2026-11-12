// П-11.2б: взвод и снятие сбоев стенда «П» человеком — маршрут `POST /stand-fault/<Н-xx>/arm|disarm` (В10), витрина для Н-03,
// Н-04, Н-05 — явно или продавец карточки идущего прогона, иначе 409 SHOP_REQUIRED, «на все витрины» — никогда (В8, вопрос
// № 12 (б)); настройки — только перечень стенда для теста; без режима сбоев маршрута нет.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { StandDemo } from "agentic-ps-platform/stand";
import type { BusItem } from "../../src/demo/bus.js";
import { startDemo, type Demo } from "../../src/demo/run.js";
import type { ScenarioStep } from "../../src/demo/scenarios.js";
import { lastCardMerchant, OPTIONS_BY_TEST, parseOptions, STAND_FAULT_TESTS, StandFaults } from "../../src/demo/stand-faults.js";
import { MESSAGES } from "../../src/demo/i18n.js";
import { PHRASES } from "../../src/dashboards/phrases.js";
import { interpret, LOCAL_STAND_EMULATED, type InterpretEnv } from "../../src/dashboards/interpret.js";
import { parseWireItem } from "../../src/dashboards/wire.js";

const sc = (seq: number, step: string, params: Record<string, string> = {}): BusItem => ({ stream: "scenario", line: { seq, at: new Date(0).toISOString(), step, params } });

describe("П-11.2б: настройки и витрина по умолчанию", () => {
  it("настройки — только перечень теста, по форме; повтор ключа и иное — отказ; lang — не настройка", () => {
    expect(parseOptions("Н-03", new URLSearchParams("shop_id=SHOP-4401&lang=en"))).toEqual({ shop_id: "SHOP-4401" });
    expect(parseOptions("Н-12", new URLSearchParams("delay_ms=500&reorder=true"))).toEqual({ delay_ms: 500, reorder: true });
    for (const [t, q] of [
      ["Н-11", "shop_id=SHOP-1"],
      ["Н-03", "delay_ms=5"],
      ["Н-03", "shop_id=a b"],
      ["Н-03", "shop_id=A&shop_id=B"],
      ["Н-12", "delay_ms=-1"],
      ["Н-12", "reorder=yes"],
      ["Н-02", "x=1"],
    ] as const)
      expect(parseOptions(t, new URLSearchParams(q)), `${t} ${q}`).toBeUndefined();
  });

  it("продавец по умолчанию — карточка корзины после последней метки прогона; новый прогон без карточки — нет", () => {
    expect(lastCardMerchant([])).toBeUndefined();
    expect(lastCardMerchant([sc(1, "run.purchase"), sc(2, "cart.card", { merchant_id: "MRC-1" })])).toBe("MRC-1");
    expect(lastCardMerchant([sc(1, "run.purchase"), sc(2, "cart.card", { merchant_id: "MRC-1" }), sc(3, "run.intent")])).toBeUndefined();
    // Прогон драйвера «ПР» карточек не шлёт — продавца нет.
    expect(lastCardMerchant([sc(1, "run.purchase"), sc(2, "cart.card", { merchant_id: "MRC-1" }), sc(3, "run.fault", { test: "Н-09" })])).toBeUndefined();
  });

  it("интерпретатор: шаг stand_fault.* — Платформа (эмулятор), служебная стадия, норма, без «кто ошибся» (ревью № 5)", () => {
    const w = parseWireItem({ stream: "scenario", line: { seq: 1, at: new Date(0).toISOString(), step: "stand_fault.armed", params: { test: "Н-03", merchant_id: "MRC-7" } } });
    const i = interpret(w!, { snapshot: {} as InterpretEnv["snapshot"], emulated: LOCAL_STAND_EMULATED });
    expect(i).toMatchObject({ actor: "platform", emulated: true, stage: "service", kind: "norm" });
    expect(i.who).toBeUndefined();
    expect(i.phrase.ru).toBe("Сбой стенда (П) Н-03 взведён человеком — продавец MRC-7");
  });

  it("Н-03 / Н-04 / Н-05 без витрины и без карточки — SHOP_REQUIRED, стенд не трогается; с карточкой — продавец карточки", () => {
    const calls: string[] = [];
    const emitted: ScenarioStep[] = [];
    const card: { merchant?: string } = {};
    const demo = { arm: (t: string, o?: object) => void calls.push(`arm ${t} ${JSON.stringify(o)}`), disarm: () => true } as unknown as Pick<StandDemo, "arm" | "disarm">;
    const f = new StandFaults({ demo, currentMerchant: () => card.merchant, emit: (s) => emitted.push(s) });
    for (const t of ["Н-03", "Н-04", "Н-05"] as const) expect(f.arm(t, new URLSearchParams())).toEqual({ ok: false, code: "SHOP_REQUIRED" });
    expect(calls).toEqual([]);
    expect(emitted).toEqual([]);
    card.merchant = "MRC-7";
    expect(f.arm("Н-03", new URLSearchParams())).toEqual({ ok: true, test: "Н-03", options: { merchant_id: "MRC-7" } });
    expect(calls).toEqual(['arm Н-03 {"merchant_id":"MRC-7"}']);
    expect(emitted).toEqual([{ step: "stand_fault.armed", params: { test: "Н-03", merchant_id: "MRC-7" } }]);
    // Сбои без выбора витрины (Н-02, Н-11, Н-12) — витрина не нужна.
    expect(f.arm("Н-11", new URLSearchParams()).ok).toBe(true);
  });

  it("у шагов stand_fault.* — тексты ru/en на мониторе и в интерпретаторе, «человеком»", () => {
    for (const s of ["stand_fault.armed", "stand_fault.disarmed"]) {
      expect(MESSAGES.ru[`step.${s}` as keyof (typeof MESSAGES)["ru"]], s).toMatch(/человеком/);
      expect(MESSAGES.en[`step.${s}` as keyof (typeof MESSAGES)["en"]], s).toMatch(/by a person/);
      expect(PHRASES.scenario[s]?.ru, s).toMatch(/человеком/);
      expect(PHRASES.scenario[s]?.en, s).toMatch(/by a person/);
    }
  });
});

describe("П-11.2б: маршрут при режиме сбоев (живой стенд)", () => {
  let demo: Demo;
  beforeAll(async () => {
    demo = await startDemo({ faults: true });
  }, 30_000);
  afterAll(async () => {
    await demo?.close();
  });
  /** `origin: null` — запрос без заголовка Origin. */
  const call = (path: string, origin: string | null = demo.monitor.url, method = "POST") =>
    fetch(`${demo.monitor.url}${path}`, { method, headers: origin === null ? {} : { origin } });
  const log = () => demo.stand.stand.demo!.log();
  const steps = () => demo.bus.history().flatMap((i) => (i.stream === "scenario" && i.line.step.startsWith("stand_fault.") ? [i.line] : []));
  const shop = () => demo.stand.stand.shops[0]!;

  it("перечень настроек = перечень стенда: каждая настройка перечня принимается стендом, чужая — отвергается им же", () => {
    const d = demo.stand.stand.demo!;
    for (const t of STAND_FAULT_TESTS)
      for (const k of ["merchant_id", "shop_id", "delay_ms", "reorder"] as const) {
        const v = k === "merchant_id" ? shop().merchant_id : k === "shop_id" ? shop().id : k === "delay_ms" ? 10 : false;
        let ok = true;
        try {
          d.arm(t, { [k]: v });
        } catch {
          ok = false;
        } finally {
          d.disarm(t); // снять при любом исходе: взведённый сбой отравил бы следующие тесты файла (ревью № 6)
        }
        expect(ok, `${t} ${k}`).toBe(OPTIONS_BY_TEST[t].includes(k));
      }
  });

  it("взвод Н-03 на витрину и снятие: 200, записи ARMED / DISARMED стенда с витриной, шаги stand_fault.* на шине; повторное снятие — 409 NOT_ARMED", async () => {
    const from = log().length;
    const n = steps().length;
    const a = await call(`/stand-fault/${encodeURIComponent("Н-03")}/arm?shop_id=${shop().id}`);
    expect(a.status).toBe(200);
    expect(await a.json()).toEqual({ ok: true, test: "Н-03", options: { shop_id: shop().id } });
    const d = await call(`/stand-fault/${encodeURIComponent("Н-03")}/disarm`);
    expect(d.status).toBe(200);
    expect(log().slice(from).map((e) => `${e.what} ${e.test}`)).toEqual(["ARMED Н-03", "DISARMED Н-03"]);
    expect(steps().slice(n).map((s) => s.step)).toEqual(["stand_fault.armed", "stand_fault.disarmed"]);
    expect(steps().slice(n)[0]!.params).toMatchObject({ test: "Н-03", shop_id: shop().id });
    const again = await call(`/stand-fault/${encodeURIComponent("Н-03")}/disarm`);
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ ok: false, code: "NOT_ARMED" });
  });

  it("Н-03 без витрины вне прогона — 409 SHOP_REQUIRED, на стенде ничего не взведено (не «на все витрины»)", async () => {
    const from = log().length;
    const r = await call(`/stand-fault/${encodeURIComponent("Н-04")}/arm`);
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ ok: false, code: "SHOP_REQUIRED" });
    expect(log().slice(from)).toEqual([]);
  });

  it("настройка вне перечня — 400 BAD_OPTION; отказ стенда (срок вне 1…60 000, чужая витрина) — 409 ARM_REJECTED без текста стенда", async () => {
    const bad = await call(`/stand-fault/${encodeURIComponent("Н-11")}/arm?shop_id=${shop().id}`);
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ ok: false, code: "BAD_OPTION" });
    for (const q of ["delay_ms=99999999", "delay_ms=0"]) {
      const r = await call(`/stand-fault/${encodeURIComponent("Н-12")}/arm?${q}`);
      expect(r.status, q).toBe(409);
      expect(await r.json()).toEqual({ ok: false, code: "ARM_REJECTED" });
    }
    const foreign = await call(`/stand-fault/${encodeURIComponent("Н-05")}/arm?shop_id=SHOP-NOPE`);
    expect(await foreign.json()).toEqual({ ok: false, code: "ARM_REJECTED" });
  });

  it("чужой и пустой Origin — 403, ничего не взведено; тест не «П» (Н-01, Н-10), иной метод и путь — 404", async () => {
    const from = log().length;
    for (const o of ["http://evil.example", null]) expect((await call(`/stand-fault/${encodeURIComponent("Н-11")}/arm`, o)).status, String(o)).toBe(403);
    expect(log().slice(from)).toEqual([]);
    for (const [path, method] of [
      [`/stand-fault/${encodeURIComponent("Н-01")}/arm`, "POST"],
      [`/stand-fault/${encodeURIComponent("Н-10")}/arm`, "POST"],
      [`/stand-fault/${encodeURIComponent("Н-11")}/arm`, "GET"],
      [`/stand-fault/${encodeURIComponent("Н-11")}/toggle`, "POST"],
      ["/stand-fault/", "POST"],
      [`/stand-fault/${encodeURIComponent("Н-11")}%2Farm`, "POST"], // %2F — не разделитель (ревью № 3)
      ["/stand-fault/%E0/arm", "POST"], // битая кодировка — маршрута нет
    ] as const)
      expect((await call(path, demo.monitor.url, method)).status, `${method} ${path}`).toBe(404);
    expect(log().slice(from)).toEqual([]);
  });

  it("продавец по умолчанию — только пока сюжет идёт: на карточке — продавец карточки; после «прервать» — SHOP_REQUIRED (ревью № 1)", async () => {
    const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const until = async (pred: () => boolean) => {
      const end = Date.now() + 60_000;
      while (!pred()) {
        if (Date.now() > end) throw new Error("не дождались");
        await pause(50);
      }
    };
    const stepsAll = () => demo.bus.history().flatMap((i) => (i.stream === "scenario" ? [i.line] : []));
    // Поручение подписывает эмулятор клиента «Авто»; затем «Вручную» — сюжет 2 стоит на карточке корзины.
    demo.clientEmulator!.setAuto(true);
    const n0 = stepsAll().length;
    expect((await call("/scenario/intent")).status).toBe(202);
    await until(() => stepsAll().slice(n0).some((s) => s.step === "intent.signed"));
    await demo.scenarios.settled();
    demo.clientEmulator!.setAuto(false);
    const n1 = stepsAll().length;
    expect((await call("/scenario/purchase")).status).toBe(202);
    await until(() => stepsAll().slice(n1).some((s) => s.step === "cart.card"));
    const card = stepsAll().slice(n1).find((s) => s.step === "cart.card")!;
    try {
      const r = await call(`/stand-fault/${encodeURIComponent("Н-03")}/arm`);
      expect(r.status).toBe(200);
      expect(await r.json()).toEqual({ ok: true, test: "Н-03", options: { merchant_id: card.params.merchant_id } });
    } finally {
      demo.stand.stand.demo!.disarm("Н-03");
      await call("/scenario/abort");
      await demo.scenarios.settled();
    }
    // Прогон окончен — продавца прошлого прогона не берём.
    const after = await call(`/stand-fault/${encodeURIComponent("Н-03")}/arm`);
    expect(await after.json()).toEqual({ ok: false, code: "SHOP_REQUIRED" });
  }, 90_000);
});

describe("П-11.2б: без режима сбоев маршрута нет", () => {
  let demo: Demo;
  beforeAll(async () => {
    demo = await startDemo();
  }, 30_000);
  afterAll(async () => {
    await demo?.close();
  });

  it("/stand-fault/* — 404 на любой метод и путь, и со своим Origin, и с битой кодировкой", async () => {
    for (const method of ["POST", "GET"])
      for (const p of [`${encodeURIComponent("Н-11")}/arm`, `${encodeURIComponent("Н-11")}/disarm`, "%E0/arm"]) {
        const r = await fetch(`${demo.monitor.url}/stand-fault/${p}`, { method, headers: { origin: demo.monitor.url } });
        expect(r.status, `${method} ${p}`).toBe(404);
      }
  });
});
