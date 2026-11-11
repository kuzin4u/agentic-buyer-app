// П-11.3а, П-11.3а-1, П-11.3а-2 (П7 и дополнение 1; решения владельца, чат 11.11): драйвер нарушителя «ПР» — только при
// DEMO_FAULTS=1, ключ агента приложения; запрос ключом агента — только после пометки, пока ветка идёт и не остановлена,
// и только на адреса стенда; итог — по журналу запросов ветки: «защита сработала» — объявленная пара «код + статус»
// в ответе, «совершено» — только при пришедшем ответе, что ветка бросила или поймала — не решает; закрытый перечень шагов
// ветки; на шину — только тест, код, статус и идентификаторы по форме; метка прогона, взаимная блокировка, закрытие;
// маршрут; граница импортов.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { PaoCallError } from "@kuzin4u/agentic-core/pao";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { splitRuns } from "../../src/dashboards/control.js";
import { interpret, LOCAL_STAND_EMULATED, type InterpretEnv } from "../../src/dashboards/interpret.js";
import { parseDiagSnapshot, parseWireItem, type WireItem } from "../../src/dashboards/wire.js";
import type { ScenarioLine } from "../../src/demo/bus.js";
import { FAULT_TESTS, type FaultTest } from "../../src/demo/fault-tests.js";
import { BRANCH_STEPS, FaultyDriver, ID_FIELDS, type BranchStep, type FaultBranch, type FaultContext } from "../../src/demo/faulty.js";
import { MESSAGES } from "../../src/demo/i18n.js";
import { startDemo, type Demo } from "../../src/demo/run.js";
import { DemoScenarios } from "../../src/demo/scenarios.js";
import { TRAINING_MERCHANTS } from "../../src/demo/shops.js";
import { DYNAMIC, filesUnder, specifiers } from "../support/imports.js";

const ROOT = resolve(import.meta.dirname, "../..");
const enc = (test: string) => encodeURIComponent(test);
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("драйвер нарушителя «ПР» — без режима сбоев его нет (П7 п. 2)", () => {
  let demo: Demo;
  beforeAll(async () => {
    demo = await startDemo();
  }, 30_000);
  afterAll(async () => {
    await demo?.close();
  });

  it("без флага: драйвера и каталога ключей нет, конструктор отказывает, маршрут /fault/* — 404 на любой метод", async () => {
    expect(demo.faulty).toBeUndefined();
    expect(demo.stand.keysDir).toBeUndefined();
    expect(() => new FaultyDriver(demo.stand, () => undefined)).toThrow(/DEMO_FAULTS=1/);
    for (const test of FAULT_TESTS) {
      const r = await fetch(`${demo.monitor.url}/fault/${enc(test)}`, { method: "POST", headers: { origin: demo.monitor.url } });
      expect(r.status, test).toBe(404);
    }
    expect((await fetch(`${demo.monitor.url}/fault/${enc("Н-07")}`)).status).toBe(404);
  });
});

describe("драйвер нарушителя «ПР» — при режиме сбоев (П7)", () => {
  let demo: Demo;
  const replies: string[] = [];
  const unhandled: unknown[] = [];
  const onUnhandled = (e: unknown) => unhandled.push(e);
  const steps = (): ScenarioLine[] => demo.bus.history().flatMap((i) => (i.stream === "scenario" ? [i.line] : []));
  // origin: строка — заголовок Origin; null — без заголовка. Тела ответов — для проверки «ключ не выходит».
  const post = async (path: string, origin: string | null = demo.monitor.url) => {
    const r = await fetch(`${demo.monitor.url}${path}`, { method: "POST", headers: origin !== null ? { origin } : {} });
    const body = await r.text();
    replies.push(body);
    return { status: r.status, body };
  };
  type Opts = { closeWaitMs?: number; fetch?: typeof fetch; timeoutMs?: number };
  const driver = (branches: Partial<Record<FaultTest, FaultBranch>>, o: Opts = {}) =>
    new FaultyDriver(demo.stand, (s) => demo.bus.scenario(s), { branches, otherBusy: () => demo.scenarios.busy, ...o });
  /** Один прогон ветки — шаги этого прогона. */
  async function once(test: FaultTest, branch: FaultBranch, o: Opts = {}): Promise<ScenarioLine[]> {
    const n = steps().length;
    const d = driver({ [test]: branch }, o);
    expect(d.start(test)).toEqual({ ok: true });
    await d.settled();
    return steps().slice(n);
  }
  const last = async (test: FaultTest, branch: FaultBranch, o: Opts = {}) => (await once(test, branch, o)).at(-1)!;
  const marked = (test: string, mandateId: string) => demo.stand.stand.demo!.log().some((e) => e.what === "MARKED" && e.test === test && e.ids?.mandate_id === mandateId);
  /** Настоящий запрос к ПАО, на который Платформа отвечает отказом: тело не по форме. */
  const badCredential = (c: FaultContext, key: string) => c.violate.call("POST /pao/v1/credentials", { body: {} as never, idempotencyKey: key });
  /** Подменный fetch: запросы с маркером в пути отвечают по `reply`, остальные — настоящим fetch; все адреса — в `seen`. */
  const fake = (reply: (url: URL) => Response | Promise<Response> | undefined, seen: string[] = []): typeof fetch =>
    (async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      seen.push(url.href);
      return (await reply(url)) ?? fetch(input, init);
    }) as typeof fetch;

  beforeAll(async () => {
    process.on("unhandledRejection", onUnhandled);
    demo = await startDemo({ faults: true });
  }, 30_000);
  afterAll(async () => {
    process.off("unhandledRejection", onUnhandled);
    await demo?.close();
  });

  it("маршрут: только POST, только с Origin монитора, имя — только из перечня; ветки нет — 409 NOT_READY", async () => {
    expect(demo.faulty).toBeDefined();
    expect((await post(`/fault/${enc("Н-07")}`, null)).status).toBe(403);
    expect((await post(`/fault/${enc("Н-07")}`, "http://evil.example")).status).toBe(403);
    expect((await fetch(`${demo.monitor.url}/fault/${enc("Н-07")}`)).status).toBe(404); // только POST: GET маршрута нет
    expect((await post(`/fault/${enc("Н-02")}`)).status).toBe(404); // сбой стенда «П», не «ПР»
    expect((await post("/fault/%E0%A4%A")).status).toBe(400);
    const r = await post(`/fault/${enc("Н-07")}`);
    expect(r.status).toBe(409);
    expect(JSON.parse(r.body)).toEqual({ ok: false, code: "NOT_READY" });
  });

  it("запрос к ПАО — ключом агента после пометки «ПР»; ответ 2xx — «совершено и помечено»; «запрос отправлен» выпускает драйвер; своя метка прогона", async () => {
    const callsFrom = demo.stand.stand.calls().length;
    let logAtCall = -1;
    const s = await once("Н-05", {
      expect: [],
      run: async (c) => {
        c.mark({ mandate_id: "mnd_probe5" });
        logAtCall = demo.stand.stand.demo!.log().length;
        await c.violate.call("GET /pao/v1/agent", {});
      },
    });
    expect(marked("Н-05", "mnd_probe5")).toBe(true);
    expect(logAtCall).toBeGreaterThan(0);
    const call = demo.stand.stand.calls().slice(callsFrom).find((c) => c.path === "/pao/v1/agent")!;
    expect(call.status).toBe(200);
    expect(call.kid !== undefined && demo.stand.isAgentKid(call.kid)).toBe(true); // тот же ключ, что у агента
    expect(s.map((x) => x.step)).toEqual(["run.fault", "fault.sent", "fault.marked"]);
    expect(s.at(-1)!.params).toMatchObject({ test: "Н-05", mandate_id: "mnd_probe5" });
  });

  it("запрос к витрине — ключом агента, по тем же правилам: после пометки уходит, без пометки — нет", async () => {
    const from = demo.stand.merchantCalls().length;
    const s = await once("Н-01", {
      expect: [],
      run: async (c) => {
        c.mark({ mandate_id: "mnd_probe1s" });
        expect((await c.violate.shop("GET", "/v1/shops")).status).toBe(200);
      },
    });
    expect(s.at(-1)).toMatchObject({ step: "fault.marked", params: { test: "Н-01", mandate_id: "mnd_probe1s" } });
    const call = demo.stand.merchantCalls().slice(from).find((c) => c.path === "/v1/shops")!;
    expect(call.status).toBe(200);
    expect(call.kid !== undefined && demo.stand.isAgentKid(call.kid)).toBe(true);
    const from2 = demo.stand.merchantCalls().length;
    expect(await last("Н-01", { expect: [], run: async (c) => void (await c.violate.shop("GET", "/v1/shops")) })).toMatchObject({ step: "fault.failed", params: { code: "NOT_MARKED" } });
    expect(demo.stand.merchantCalls().slice(from2)).toEqual([]);
  });

  it("защёлка: запрос до пометки не уходит — «не помечено» NOT_MARKED; пометка без запроса — «помечено, но не разыграно» NOT_SENT", async () => {
    const callsFrom = demo.stand.stand.calls().length;
    expect(await last("Н-06", { expect: [], run: async (c) => void (await c.violate.call("GET /pao/v1/agent", {})) })).toMatchObject({ step: "fault.failed", params: { test: "Н-06", code: "NOT_MARKED" } });
    expect(demo.stand.stand.calls().slice(callsFrom).some((c) => c.path === "/pao/v1/agent")).toBe(false);
    expect(await last("Н-08", { expect: [], run: async (c) => c.mark({ mandate_id: "mnd_probe8" }) })).toMatchObject({
      step: "fault.unplayed",
      params: { test: "Н-08", code: "NOT_SENT", mandate_id: "mnd_probe8" },
    });
  });

  it("«защита сработала» — только объявленная пара «код + статус» в ответе настоящего запроса; иное — «помечено, но не разыграно» с причиной", async () => {
    const probe = (key: string, mandate: string): FaultBranch["run"] => async (c) => {
      c.mark({ mandate_id: mandate });
      await badCredential(c, key);
    };
    const first = await last("Н-07", { expect: [{ code: "PRINCIPAL_SIGNATURE_PENDING", status: 409 }], run: probe("fault-probe-7a", "mnd_probe7a") });
    expect(first.step).toBe("fault.unplayed");
    const code = String(first.params.code).replace(/^UNEXPECTED_/, "");
    const status = Number(first.params.status);
    expect(first.params.code).toBe(`UNEXPECTED_${code}`);
    expect(status).toBeGreaterThanOrEqual(400);
    const ok = await last("Н-07", { expect: [{ code, status }], run: probe("fault-probe-7b", "mnd_probe7b") });
    expect(ok).toMatchObject({ step: "fault.refused", params: { test: "Н-07", code, status, mandate_id: "mnd_probe7b" } });
    expect(marked("Н-07", "mnd_probe7b")).toBe(true);
    // Код тот, статус другой — не защита.
    expect(await last("Н-07", { expect: [{ code, status: status + 1 }], run: probe("fault-probe-7c", "mnd_probe7c") })).toMatchObject({ step: "fault.unplayed", params: { code: `UNEXPECTED_${code}`, status } });
    // Блокер ревью П-11.3а-2: ветка глотает объявленный отказ — итог по журналу всё равно «защита сработала», не «совершено».
    const swallowed = await last("Н-07", {
      expect: [{ code, status }],
      run: async (c) => {
        c.mark({ mandate_id: "mnd_probe7e" });
        await badCredential(c, "fault-probe-7e").catch(() => undefined);
      },
    });
    expect(swallowed).toMatchObject({ step: "fault.refused", params: { code, status } });
  });

  it("подготовка и нарушение различаются: итог — только по нарушающему запросу, у подготовки учитывается лишь сбой (ревью П-11.3а-2, повторное № 1)", async () => {
    // Подготовка 2xx, нарушение не отправлено — «не разыграно» NOT_SENT, а не «совершено»; «запрос отправлен» — не выпущен.
    const prepOnly = await once("Н-07", {
      expect: [],
      run: async (c) => {
        c.mark({ mandate_id: "mnd_prep1" });
        await c.call("GET /pao/v1/agent", {});
        await c.shop("GET", "/v1/shops");
      },
    });
    expect(prepOnly.at(-1)).toMatchObject({ step: "fault.unplayed", params: { code: "NOT_SENT", mandate_id: "mnd_prep1" } });
    expect(prepOnly.some((x) => x.step === "fault.sent")).toBe(false);
    // Объявленный код пришёл на подготовку — не защита: «не разыграно» PREP_FAILED.
    const seen = await last("Н-07", {
      expect: [{ code: "X_GUARD", status: 409 }],
      run: async (c) => {
        c.mark({ mandate_id: "mnd_prep2" });
        await c.shop("GET", "/v1/shops").catch(() => undefined);
      },
    }, { fetch: fake((u) => (u.pathname === "/v1/shops" ? json(409, { code: "X_GUARD" }) : undefined)) });
    expect(seen).toMatchObject({ step: "fault.unplayed", params: { code: "PREP_FAILED", status: 409 } });
    // Подготовка 2xx, затем нарушение с объявленной парой — «защита сработала»; «запрос отправлен» — один, у нарушения.
    const real = await once("Н-07", {
      expect: [{ code: "X_GUARD", status: 409 }],
      run: async (c) => {
        c.mark({ mandate_id: "mnd_prep3" });
        await c.call("GET /pao/v1/agent", {});
        await c.violate.shop("GET", "/v1/shops/guarded").catch(() => undefined);
      },
    }, { fetch: fake((u) => (u.pathname === "/v1/shops/guarded" ? json(409, { code: "X_GUARD" }) : undefined)) });
    expect(real.at(-1)).toMatchObject({ step: "fault.refused", params: { code: "X_GUARD", status: 409 } });
    expect(real.filter((x) => x.step === "fault.sent")).toHaveLength(1);
    // Нарушение прошло (2xx), а объявленный код пришёл на подготовку — не «защита сработала».
    const missed = await last("Н-07", {
      expect: [{ code: "X_GUARD", status: 409 }],
      run: async (c) => {
        c.mark({ mandate_id: "mnd_prep4" });
        await c.violate.call("GET /pao/v1/agent", {});
        await c.shop("GET", "/v1/shops/guarded").catch(() => undefined);
      },
    }, { fetch: fake((u) => (u.pathname === "/v1/shops/guarded" ? json(409, { code: "X_GUARD" }) : undefined)) });
    expect(missed).toMatchObject({ step: "fault.unplayed", params: { code: "PREP_FAILED" } });
  });

  it("«защита» витрины — по объявленной паре «код + статус»: объявлена — «сработала»; другой статус или код не объявлен — «не разыграно» (повторное № 3)", async () => {
    const guarded = fake((u) => (u.pathname === "/v1/shops/paid" ? json(409, { code: "ORDER_NOT_PAYABLE" }) : undefined));
    const run: FaultBranch["run"] = async (c) => {
      c.mark({ mandate_id: "mnd_probe1g" });
      await c.violate.shop("POST", "/v1/shops/paid", { again: true }).catch(() => undefined);
    };
    expect(await last("Н-01", { expect: [{ code: "ORDER_NOT_PAYABLE", status: 409 }], run }, { fetch: guarded })).toMatchObject({ step: "fault.refused", params: { code: "ORDER_NOT_PAYABLE", status: 409 } });
    expect(await last("Н-01", { expect: [{ code: "ORDER_NOT_PAYABLE", status: 410 }], run }, { fetch: guarded })).toMatchObject({ step: "fault.unplayed", params: { code: "UNEXPECTED_ORDER_NOT_PAYABLE", status: 409 } });
    expect(await last("Н-01", { expect: [{ code: "PACKAGE_MISMATCH", status: 409 }], run }, { fetch: guarded })).toMatchObject({ step: "fault.unplayed", params: { code: "UNEXPECTED_ORDER_NOT_PAYABLE" } });
  });

  it("повисший запрос к ПАО — по сроку «нет ответа», драйвер свободен; сюжеты не заблокированы (повторное № 2)", async () => {
    const hang = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.pathname !== "/pao/v1/agent") return fetch(input, init);
      return new Promise<Response>((_, fail) => init?.signal?.addEventListener("abort", () => fail(init.signal!.reason), { once: true }));
    }) as typeof fetch;
    const d = driver({ "Н-05": { expect: [], run: async (c) => (c.mark({ mandate_id: "mnd_hang" }), void (await c.violate.call("GET /pao/v1/agent", {}).catch(() => undefined))) } }, { fetch: hang, timeoutMs: 200 });
    const n = steps().length;
    const t0 = Date.now();
    expect(d.start("Н-05")).toEqual({ ok: true });
    expect(d.busy).toBe(true);
    await d.settled();
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(d.busy).toBe(false);
    expect(steps().slice(n).at(-1)).toMatchObject({ step: "fault.unplayed", params: { code: "NO_RESPONSE", mandate_id: "mnd_hang" } });
  });

  it("пометка — только по форме и хотя бы с одним идентификатором стенда; иначе MARK_REJECTED и запрос не уходит (повторное № 6)", async () => {
    for (const ids of [{}, { mandate_id: "id with spaces" }, { mandate_id: "x".repeat(200) }, { unknown_field: "x" }, { mandate_id: 42 }]) {
      const callsFrom = demo.stand.stand.calls().length;
      const logFrom = demo.stand.stand.demo!.log().length;
      const s = await last("Н-06", { expect: [], run: async (c) => (c.mark(ids as never), void (await c.violate.call("GET /pao/v1/agent", {}))) });
      expect(s, JSON.stringify(ids)).toMatchObject({ step: "fault.failed", params: { code: "MARK_REJECTED" } });
      expect(demo.stand.stand.calls().slice(callsFrom).some((c) => c.path === "/pao/v1/agent"), JSON.stringify(ids)).toBe(false);
      expect(demo.stand.stand.demo!.log().slice(logFrom).some((e) => e.what === "MARKED"), JSON.stringify(ids)).toBe(false);
    }
  });

  it("ошибка, брошенная самой веткой, — не отказ Платформы, даже с объявленным кодом: «не разыграно» BRANCH_ERROR", async () => {
    const s = await once("Н-07", {
      expect: [{ code: "PRINCIPAL_SIGNATURE_PENDING", status: 409 }],
      run: async (c) => {
        c.mark({ mandate_id: "mnd_probe7d" });
        await c.violate.call("GET /pao/v1/agent", {});
        throw new PaoCallError(409, { code: "PRINCIPAL_SIGNATURE_PENDING" as never, message: "x", retry: "never" }, 1);
      },
    });
    expect(s.at(-1)).toMatchObject({ step: "fault.unplayed", params: { code: "BRANCH_ERROR", mandate_id: "mnd_probe7d" } });
    expect(s.some((x) => x.step === "fault.refused")).toBe(false);
  });

  it("сбои настоящих запросов — «помечено, но не разыграно» с причиной, даже если ветка их поймала: нет ответа, 5xx, перенаправление, отказ клиента ПАО (восстановлено, ревью П-11.3а-2 № 7)", async () => {
    const cases: [string, (u: URL) => Response | undefined, (c: FaultContext) => Promise<unknown>, string, number?][] = [
      ["витрина: нет ответа", (u) => (u.pathname === "/v1/shops" ? (() => { throw new TypeError("fetch failed"); })() : undefined), (c) => c.violate.shop("GET", "/v1/shops"), "NO_RESPONSE"],
      ["витрина: 503", (u) => (u.pathname === "/v1/shops" ? json(503, { code: "PRINCIPAL_SIGNATURE_PENDING" }) : undefined), (c) => c.violate.shop("GET", "/v1/shops"), "PRINCIPAL_SIGNATURE_PENDING", 503],
      ["витрина: 302", (u) => (u.pathname === "/v1/shops" ? new Response(null, { status: 302, headers: { location: "http://evil.example/" } }) : undefined), (c) => c.violate.shop("GET", "/v1/shops"), "REDIRECT", 302],
      ["ПАО: 503", (u) => (u.pathname === "/pao/v1/agent" ? json(503, { code: "STATE_UNAVAILABLE", message: "x", retry: "never" }) : undefined), (c) => c.violate.call("GET /pao/v1/agent", {}), "STATE_UNAVAILABLE", 503],
      ["ПАО: перенаправление — отказ клиента", (u) => (u.pathname === "/pao/v1/agent" ? new Response(null, { status: 302, headers: { location: "http://evil.example/" } }) : undefined), (c) => c.violate.call("GET /pao/v1/agent", {}), "PAO_CLIENT_REDIRECT"],
      ["ПАО: нет ответа", (u) => (u.pathname === "/pao/v1/agent" ? (() => { throw new TypeError("fetch failed"); })() : undefined), (c) => c.violate.call("GET /pao/v1/agent", {}), "NO_RESPONSE"],
    ];
    for (const [name, reply, send, code, status] of cases) {
      const s = await last(
        "Н-07",
        {
          expect: [{ code: "PRINCIPAL_SIGNATURE_PENDING", status: 503 }],
          run: async (c) => {
            c.mark({ mandate_id: "mnd_probe7f" });
            await send(c).catch(() => undefined); // ветка глотает — итог всё равно по журналу
          },
        },
        { fetch: fake(reply) },
      );
      expect(s.step, name).toBe("fault.unplayed");
      expect(String(s.params.code), name).toBe(code);
      if (status !== undefined) expect(s.params.status, name).toBe(status);
      expect(s.params.mandate_id, name).toBe("mnd_probe7f");
    }
  });

  it("код из ответа витрины — только по форме: не по форме — «код не по форме», на шину и в акт не попадает (инварианты 1, 4)", async () => {
    for (const code of ["<script>alert(1)</script>", "x".repeat(300), "crypt_SECRET", 42]) {
      const s = await last(
        "Н-01",
        { expect: [], run: async (c) => (c.mark({ mandate_id: "mnd_probe1m" }), void (await c.violate.shop("GET", "/v1/shops").catch(() => undefined))) },
        { fetch: fake((u) => (u.pathname === "/v1/shops" ? json(409, { code }) : undefined)) },
      );
      expect(s, String(code)).toMatchObject({ step: "fault.unplayed", params: { code: "MALFORMED_CODE", status: 409 } });
    }
    const noCode = await last("Н-01", { expect: [], run: async (c) => (c.mark({ mandate_id: "mnd_probe1n" }), void (await c.violate.shop("GET", "/v1/shops").catch(() => undefined))) }, { fetch: fake((u) => (u.pathname === "/v1/shops" ? json(404, {}) : undefined)) });
    expect(noCode).toMatchObject({ step: "fault.unplayed", params: { code: "NO_CODE", status: 404 } });
    const wire = JSON.stringify(demo.bus.history());
    expect(wire).not.toContain("<script>");
    expect(wire).not.toContain("crypt_SECRET");
    expect(wire).not.toContain("x".repeat(300));
  });

  it("адрес витрины — только стенд: запрос ключом агента не уходит ни при каком виде пути (@host, //host, схема, #, \\) — BAD_TARGET (П7 п. 5)", async () => {
    const merchants = new URL(demo.stand.urls.merchants);
    for (const target of ["@evil.example/x", "//evil.example/x", "http://evil.example/x", "/v1/shops#x", "/v1/shops\\..\\x", "/v1/@evil.example", "v1/shops", " /v1/shops"]) {
      const seen: string[] = [];
      const s = await last("Н-01", { expect: [], run: async (c) => (c.mark({ mandate_id: "mnd_probe1t" }), void (await c.violate.shop("GET", target).catch(() => undefined))) }, { fetch: fake(() => json(200, {}), seen) });
      expect(s, target).toMatchObject({ step: "fault.unplayed", params: { code: "BAD_TARGET" } });
      expect(seen, target).toEqual([]);
    }
    // Настоящий путь стенда — уходит, на источник витрин.
    const seen: string[] = [];
    await last("Н-01", { expect: [], run: async (c) => (c.mark({ mandate_id: "mnd_probe1u" }), void (await c.violate.shop("GET", "/v1/shops?x=1"))) }, { fetch: fake(() => undefined, seen) });
    expect(seen.map((u) => new URL(u).origin)).toEqual([merchants.origin]);
  });

  it("ветка, не дождавшаяся запросов: итог — после ответов на все ушедшие; запрос после её конца не уходит; процесс не падает (ревью П-11.3а-2 № 1, № 3)", async () => {
    const callsFrom = demo.stand.stand.calls().length;
    let late!: Promise<unknown>;
    const s = await once("Н-09", {
      expect: [],
      run: async (c) => {
        c.mark({ mandate_id: "mnd_probe9a" });
        void c.violate.call("GET /pao/v1/agent", {}); // без await — итог его дождётся
        void c.violate.shop("GET", "/v1/shops/refused"); // без await, с отказом — не роняет процесс
        setTimeout(() => (late = badCredential(c, "fault-probe-9a")), 20); // после конца ветки — не уходит
      },
    }, { fetch: fake((u) => (u.pathname === "/v1/shops/refused" ? json(404, { code: "SHOP_NOT_FOUND" }) : undefined)) });
    expect(s.filter((x) => x.step === "fault.sent")).toHaveLength(2);
    // Отказ витрины не объявлен — один исход (повторное № 3: закреплён).
    expect(s.at(-1)).toMatchObject({ step: "fault.unplayed", params: { code: "UNEXPECTED_SHOP_NOT_FOUND", status: 404 } });
    await pause(100);
    await expect(late).rejects.toThrow("CLOSED");
    expect(demo.stand.stand.calls().slice(callsFrom).filter((c) => c.path === "/pao/v1/credentials")).toEqual([]);
    expect(unhandled).toEqual([]);
  });

  it("шаги ветки — закрытый перечень: чужое имя — ошибка, ветка остановлена — и её запросы не уходят, даже если ошибку поймала; до пометки — настоящая причина (ревью П-11.3а-2 № 2, № 6)", async () => {
    for (const name of ["outcome", "run.purchase", "fault.refused", "fault.marked", "fault.sent", "fault.note.other"]) {
      const callsFrom = demo.stand.stand.calls().length;
      const s = await once("Н-07", {
        expect: [],
        run: async (c) => {
          c.mark({ mandate_id: "mnd_probe7s" });
          try {
            c.step(name as BranchStep, { code: "PRINCIPAL_SIGNATURE_PENDING", op_ref: "op_fake" });
          } catch {
            // ветка перехватила — запрос всё равно не уйдёт
          }
          await c.violate.call("GET /pao/v1/agent", {}).catch(() => undefined);
        },
      });
      expect(s.map((x) => x.step), name).toEqual(["run.fault", "fault.unplayed"]);
      expect(s.at(-1)!.params, name).toMatchObject({ code: "BAD_STEP", mandate_id: "mnd_probe7s" });
      expect(demo.stand.stand.calls().slice(callsFrom).some((c) => c.path === "/pao/v1/agent"), name).toBe(false);
    }
    // Чужой шаг до пометки — «не помечено» с настоящей причиной, не NOT_MARKED.
    expect(await last("Н-07", { expect: [], run: async (c) => c.step("outcome" as BranchStep) })).toMatchObject({ step: "fault.failed", params: { code: "BAD_STEP" } });
    // Ошибка ветки до пометки — тоже своя причина.
    expect(await last("Н-07", { expect: [], run: async () => { throw new Error("x"); } })).toMatchObject({ step: "fault.failed", params: { code: "BRANCH_ERROR" } });
    for (const n of BRANCH_STEPS)
      for (const lang of ["ru", "en"] as const) expect((MESSAGES[lang] as Record<string, string>)[`step.${n}`], `${lang} ${n}`).toMatch(/\(ПР\)/);
  });

  it("стенд не принял пометку — «не помечено» MARK_REJECTED, запроса нет, процесс не падает", async () => {
    const callsFrom = demo.stand.stand.calls().length;
    expect(
      await last("Н-06", {
        expect: [],
        run: async (c) => {
          c.mark({ mandate_id: "" });
          await c.violate.call("GET /pao/v1/agent", {});
        },
      }),
    ).toMatchObject({ step: "fault.failed", params: { test: "Н-06", code: "MARK_REJECTED" } });
    expect(demo.stand.stand.calls().slice(callsFrom).some((c) => c.path === "/pao/v1/agent")).toBe(false);
  });

  it("на шину из ветки — только тест, код, статус и идентификаторы стенда по форме: криптограмма и токен отброшены (инвариант 1)", async () => {
    const s = await once("Н-09", {
      expect: [],
      run: async (c) => {
        const ids = { mandate_id: "mnd_probe9", shop_id: "SHOP-1", order_ref: "ord_ref_1" };
        c.mark(ids);
        ids.mandate_id = "mnd_changed"; // после пометки — не расходится с записью MARKED (копия)
        c.step("fault.note.prepared", { cryptogram: "crypt_SECRET", token_ref: "tok_SECRET", code: "X", status: 409, merchant_id: "m_1" });
        c.step("fault.note.prepared", { code: "crypt_SECRET", order_id: "tok SECRET with spaces", status: 7 });
        await c.violate.call("GET /pao/v1/agent", {});
      },
    });
    const notes = s.filter((x) => x.step === "fault.note.prepared");
    expect(notes[0]!.params).toEqual({ test: "Н-09", code: "X", status: 409, merchant_id: "m_1" });
    expect(notes[1]!.params).toEqual({ test: "Н-09" });
    expect(JSON.stringify(demo.bus.history())).not.toContain("SECRET");
    expect(s.at(-1)!.params).toMatchObject({ mandate_id: "mnd_probe9", shop_id: "SHOP-1", order_ref: "ord_ref_1" });
    expect([...ID_FIELDS].sort()).toEqual(["confirmation_id", "mandate_id", "merchant_id", "op_ref", "order_id", "order_ref", "shop_id"]);
  });

  it("метка прогона: «Контроль» режет ленту на прогон нарушителя без паспорта — он не приклеивается к прогону сюжета", async () => {
    const from = demo.bus.history().length;
    expect((await post("/scenario/intent")).status).toBe(202);
    for (let i = 0; i < 100 && !steps().some((x) => x.step === "intent.awaiting_signature"); i++) await pause(50);
    expect((await post("/scenario/abort")).status).toBe(202);
    await demo.scenarios.settled();
    await once("Н-05", {
      expect: [],
      run: async (c) => {
        c.mark({ mandate_id: "mnd_probe5r" });
        await c.violate.call("GET /pao/v1/agent", {});
      },
    });
    const raw = await (await fetch(`${demo.monitor.url}/api/diag`)).json();
    const env: InterpretEnv = { snapshot: parseDiagSnapshot(raw)!.snapshot, emulated: LOCAL_STAND_EMULATED, training: TRAINING_MERCHANTS };
    const items = demo.bus
      .history()
      .slice(from)
      .map((r) => parseWireItem(JSON.parse(JSON.stringify(r))))
      .filter((x): x is WireItem => x !== undefined)
      .map((x) => interpret(x, env));
    const runs = splitRuns(items);
    expect(runs.map((r) => r.name)).toEqual(["intent", "fault"]);
    expect(runs[1]!.passport).toBeUndefined();
    expect(runs[0]!.items.some((i) => i.ref.startsWith("fault.") || i.ref === "run.fault")).toBe(false);
    expect(runs[1]!.items.filter((i) => i.stream === "scenario").map((i) => i.ref)).toEqual(["run.fault", "fault.sent", "fault.marked"]);
  });

  it("взаимная блокировка: пока идёт нарушение, сюжет не стартует, и наоборот", async () => {
    let release!: () => void;
    const gate = new Promise<void>((ok) => (release = ok));
    const d = driver({
      "Н-09": {
        expect: [],
        run: async (c) => {
          c.mark({ mandate_id: "mnd_probe9b" });
          await gate;
        },
      },
    });
    expect(d.start("Н-09")).toEqual({ ok: true });
    expect(d.start("Н-09")).toEqual({ ok: false, code: "BUSY" });
    const sc = new DemoScenarios(demo.stand, () => undefined, { otherBusy: () => d.busy });
    expect(sc.start("intent")).toEqual({ ok: false, code: "BUSY" });
    release();
    await d.settled();
    expect((await post("/scenario/intent")).status).toBe(202);
    expect(demo.faulty!.start("Н-07")).toEqual({ ok: false, code: "BUSY" });
    expect((await post(`/fault/${enc("Н-07")}`)).status).toBe(409);
    expect((await post("/scenario/abort")).status).toBe(202);
    await demo.scenarios.settled();
  });

  it("закрытие: ветка, послушная отмене, кончается без шагов и запросов; зависшая — не дольше срока; после — CLOSED и свободен", async () => {
    const callsFrom = demo.stand.stand.calls().length;
    const d = driver(
      {
        "Н-01": {
          expect: [],
          run: async (c) => {
            c.mark({ mandate_id: "mnd_probe1c" });
            await new Promise<void>((ok) => c.signal.addEventListener("abort", () => ok(), { once: true }));
            await c.violate.call("GET /pao/v1/agent", {});
          },
        },
      },
      { closeWaitMs: 200 },
    );
    expect(d.start("Н-01")).toEqual({ ok: true });
    const n = steps().length;
    await d.close();
    await pause(50);
    expect(steps().slice(n)).toEqual([]);
    expect(demo.stand.stand.calls().slice(callsFrom).some((c) => c.path === "/pao/v1/agent")).toBe(false);
    expect(d.start("Н-01")).toEqual({ ok: false, code: "CLOSED" });
    const h = driver({ "Н-01": { expect: [], run: async (c) => (c.mark({ mandate_id: "mnd_probe1h" }), await new Promise<never>(() => undefined)) } }, { closeWaitMs: 200 });
    expect(h.start("Н-01")).toEqual({ ok: true });
    const t0 = Date.now();
    await h.close();
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(h.busy).toBe(false);
  });

  it("тексты итоговых шагов — с пометкой «нарушитель (ПР)», ru и en; «не помечено» — только у fault.failed", () => {
    for (const step of ["run.fault", "fault.sent", "fault.refused", "fault.marked", "fault.unplayed", "fault.failed"])
      for (const lang of ["ru", "en"] as const) expect((MESSAGES[lang] as Record<string, string>)[`step.${step}`], `${lang} ${step}`).toMatch(/\(ПР\)/);
    expect(MESSAGES.ru["step.fault.unplayed"]).toMatch(/помечено на стенде, но не разыграно/);
  });

  it("ключ не выходит из драйвера (П7 п. 5): ни на шине, ни в журнале агента и стенда, ни в ответах маршрута", () => {
    const text = JSON.stringify(demo.bus.history()) + JSON.stringify(demo.stand.journal.entries) + JSON.stringify(demo.stand.stand.demo!.log()) + replies.join("");
    expect(text).not.toMatch(/PRIVATE KEY|"d":"/);
    expect(text).not.toContain(demo.stand.keysDir!);
  });
});

/** Разрешённые динамические выражения — две точные строки (решение владельца, чат 11.11), а не файлы целиком. */
const ALLOWED_DYNAMIC: Readonly<Record<string, string>> = {
  "src/demo/platform.ts": `createRequire(import.meta.url)("agentic-ps-platform/package.json")`,
  "src/demo/stand.ts": `createRequire(import.meta.url).resolve("agentic-buyer-ref/config/params.stand.json")`,
};

/** Нарушения границы драйвера (П7 п. 6, дополнение 1) в дереве `root/src`. */
function driverBoundary(root: string): string[] {
  const src = filesUnder(join(root, "src"));
  const rel = (f: string) => relative(root, f);
  const bad: string[] = [];
  for (const f of src) {
    const name = rel(f);
    const text = readFileSync(f, "utf8");
    const specs = specifiers(text);
    if (specs.some((s) => /(^|\/)faulty\.js$/.test(s)) && name !== "src/demo/run.ts") bad.push(`${name} → faulty`);
    if (name === "src/demo/faulty.ts") continue;
    if (specs.some((s) => /^@kuzin4u\/agentic-core(\/|$)/.test(s))) bad.push(`${name} → @kuzin4u/agentic-core`);
    if (specs.some((s) => s.startsWith("agentic-buyer-ref/src/agent/adapters/"))) bad.push(`${name} → адаптер ядра`);
    if (/\bloadKey\b/.test(text)) bad.push(`${name} → loadKey`);
    // Динамическая ссылка на модуль статически не читается — сама нарушение; исключены только две точные строки.
    const allowed = Object.hasOwn(ALLOWED_DYNAMIC, name) ? ALLOWED_DYNAMIC[name]! : undefined;
    if (DYNAMIC.test(allowed !== undefined ? text.split(allowed).join("") : text)) bad.push(`${name} → динамическая ссылка на модуль`);
    // Прямой fetch с адресами стенда вне драйвера и сборки стенда (печать адреса без fetch — не обращение).
    if (name !== "src/demo/stand.ts" && /\bfetch\s*\(/.test(text) && /\burls\b/.test(text)) bad.push(`${name} → fetch на адреса стенда`);
  }
  for (const dir of ["src/pult", "src/dashboards", "src/demo/public/pult"])
    for (const f of src.filter((x) => x.startsWith(join(root, dir) + "/"))) if (/faulty|fault-tests|loadKey/.test(readFileSync(f, "utf8"))) bad.push(`${rel(f)} → драйвер`);
  return bad;
}

describe("граница драйвера нарушителя (П7 п. 6, дополнение 1)", () => {
  it("драйвер импортирует только run.ts; клиент ПАО, @kuzin4u/agentic-core, адаптеры ядра, loadKey, динамические ссылки и fetch на адреса стенда — только в драйвере", () => {
    expect(driverBoundary(ROOT)).toEqual([]);
    expect(specifiers(readFileSync(join(ROOT, "src/demo/run.ts"), "utf8"))).toContain("./faulty.js");
    const driverText = readFileSync(join(ROOT, "src/demo/faulty.ts"), "utf8");
    expect(specifiers(driverText)).toContain("@kuzin4u/agentic-core/pao");
    expect(driverText).toMatch(/\bloadKey\b/);
    expect(driverText).not.toMatch(/\bissuer\b|bankApp|\bupk\b/); // П5 п. 5: ни эмулятора банка, ни страницы УПК
    for (const [file, expr] of Object.entries(ALLOWED_DYNAMIC)) expect(readFileSync(join(ROOT, file), "utf8"), file).toContain(expr);
  });

  it("поломки ловятся на временном дереве: клиент ПАО, адаптер ядра, динамическая ссылка (и в разрешённых файлах — вне точных строк), fetch на адреса стенда, импорт драйвера", () => {
    const root = mkdtempSync(join(tmpdir(), "fault-boundary-"));
    try {
      mkdirSync(join(root, "src/demo"), { recursive: true });
      mkdirSync(join(root, "src/pult"), { recursive: true });
      writeFileSync(join(root, "src/demo/faulty.ts"), `import { PaoClient } from "@kuzin4u/agentic-core/pao";\nexport const x = PaoClient;\n`);
      writeFileSync(join(root, "src/demo/run.ts"), `import { x } from "./faulty.js";\nexport const y = x;\n`);
      writeFileSync(join(root, "src/demo/bad.ts"), `import { PaoClient } from "@kuzin4u/agentic-core/pao";\nimport { PaoPlatform } from "agentic-buyer-ref/src/agent/adapters/pao/index.js";\nexport const z = [PaoClient, PaoPlatform];\n`);
      writeFileSync(join(root, "src/demo/raw.ts"), `export const go = (d: { urls: { pao: string } }) => { const { pao } = d.urls; return fetch(pao + "/pao/v1/agent"); };\n`);
      writeFileSync(join(root, "src/demo/dyn.ts"), `const m = "@kuzin4u/agentic-core/pao";\nexport const c = import(m);\n`);
      // Шаблонная строка с подстановкой — тоже динамическая ссылка (повторное № 9).
      writeFileSync(join(root, "src/demo/tpl.ts"), "const x = \"core\";\nexport const t = import(`@kuzin4u/agentic-${x}/pao`);\n");
      writeFileSync(
        join(root, "src/demo/platform.ts"),
        `import { createRequire } from "node:module";\nexport const v = ${ALLOWED_DYNAMIC["src/demo/platform.ts"]};\nexport const p = createRequire(import.meta.url)("@kuzin4u/agentic-core/pao");\n`,
      );
      writeFileSync(join(root, "src/demo/stand.ts"), `import { createRequire } from "node:module";\nexport const s = ${ALLOWED_DYNAMIC["src/demo/stand.ts"]};\n`);
      writeFileSync(join(root, "src/pult/p.ts"), `import { x } from "../demo/faulty.js";\nexport const p = x;\n`);
      const v = driverBoundary(root);
      expect(v).toEqual(
        expect.arrayContaining([
          "src/demo/bad.ts → @kuzin4u/agentic-core",
          "src/demo/bad.ts → адаптер ядра",
          "src/demo/raw.ts → fetch на адреса стенда",
          "src/demo/dyn.ts → динамическая ссылка на модуль",
          "src/demo/tpl.ts → динамическая ссылка на модуль",
          "src/demo/platform.ts → динамическая ссылка на модуль",
          "src/pult/p.ts → faulty",
          "src/pult/p.ts → драйвер",
        ]),
      );
      expect(v.some((x) => x.startsWith("src/demo/faulty.ts") || x.startsWith("src/demo/run.ts") || x.startsWith("src/demo/stand.ts"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
