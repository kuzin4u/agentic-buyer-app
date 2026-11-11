// П-11.3а, П-11.3а-1, П-11.3а-2 (П7 и дополнение 1; решения владельца, чат 11.11): драйвер нарушителя «ПР» — только при
// DEMO_FAULTS=1, ключ агента приложения; запрос ключом агента — только после пометки, пока ветка идёт и не остановлена,
// и только на адреса стенда; итог — по журналу запросов ветки: «защита сработала» — объявленная пара «код + статус»
// в ответе, «совершено» — только при пришедшем ответе, что ветка бросила или поймала — не решает; закрытый перечень шагов
// ветки; на шину — только тест, код, статус и идентификаторы по форме; метка прогона, взаимная блокировка, закрытие;
// маршрут; граница импортов.
import { randomUUID } from "node:crypto";
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
import { BRANCH_STEPS, credentialFor, FAULT_PLAN, FaultyDriver, ID_FIELDS, n09Branch, otherMerchant, signedCart, type BranchStep, type FaultBranch, type FaultContext, type Guard } from "../../src/demo/faulty.js";
import { MESSAGES } from "../../src/demo/i18n.js";
import { startDemo, type Demo } from "../../src/demo/run.js";
import { DemoScenarios } from "../../src/demo/scenarios.js";
import { DEMO_SHOPS, MASSA_MADRE, TRAINING_MERCHANTS } from "../../src/demo/shops.js";
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
  type Opts = { closeWaitMs?: number; fetch?: typeof fetch; timeoutMs?: number; clientWaitMs?: number };
  /** Ветка каркасных тестов: ход и ожидаемые пары — тестовой таблицей (как FAULT_PLAN в сборке стенда, опция `plan`).
   *  Операции нарушения в каркасных тестах — служебные запросы стенда (TEST_OPS). */
  type TestBranch = { readonly expect: readonly Guard[]; readonly run: FaultBranch["run"] };
  const TEST_OPS = ["GET /pao/v1/agent", "POST /pao/v1/credentials", "GET /v1/shops", "GET /v1/shops/{shop_id}", "GET /v1/shops/{shop_id}/catalog", "POST /v1/shops/{shop_id}"];
  const driver = (branches: Partial<Record<FaultTest, TestBranch>>, o: Opts = {}) => {
    const entries = Object.entries(branches) as [FaultTest, TestBranch][];
    return new FaultyDriver(demo.stand, (s) => demo.bus.scenario(s), {
      branches: Object.fromEntries(entries.map(([t, b]) => [t, { run: b.run }])),
      plan: Object.fromEntries(entries.map(([t, b]) => [t, { violations: TEST_OPS, expect: b.expect }])),
      otherBusy: () => demo.scenarios.busy,
      ...o,
    });
  };
  /** Один прогон ветки — шаги этого прогона. */
  async function once(test: FaultTest, branch: TestBranch, o: Opts = {}): Promise<ScenarioLine[]> {
    const n = steps().length;
    const d = driver({ [test]: branch }, o);
    expect(d.start(test)).toEqual({ ok: true });
    await d.settled();
    return steps().slice(n);
  }
  const last = async (test: FaultTest, branch: TestBranch, o: Opts = {}) => (await once(test, branch, o)).at(-1)!;
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
    const r = await post(`/fault/${enc("Н-05")}`); // ветки Н-05 пока нет (П-11.3д)
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
    // Причина подготовки не теряется (ревью П-11.3а-3, мелочь № 5).
    expect(seen).toMatchObject({ step: "fault.unplayed", params: { code: "PREP_FAILED,X_GUARD", status: 409 } });
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
    // Подготовка не ответила, нарушение не отправлено — PREP_FAILED с причиной «нет ответа».
    const noAnswer = await last("Н-07", {
      expect: [],
      run: async (c) => {
        c.mark({ mandate_id: "mnd_prep5" });
        await c.shop("GET", "/v1/shops").catch(() => undefined);
      },
    },{ fetch: fake((u) => (u.pathname === "/v1/shops" ? (() => { throw new TypeError("fetch failed"); })() : undefined)) });
    expect(noAnswer).toMatchObject({ step: "fault.unplayed", params: { code: "PREP_FAILED,NO_RESPONSE" } });
  });

  it("порядок и состав (решение владельца, чат 11.11): одно нарушение за прогон, подготовка после нарушения отклоняется, прошедшее нарушение старше любого исхода — оба порядка", async () => {
    const guarded = fake((u) => (u.pathname === "/v1/shops/guarded" ? json(409, { code: "X_GUARD" }) : undefined));
    const expectGuard = [{ code: "X_GUARD", status: 409 }];
    // Нарушение прошло (2xx), затем «подготовка» с объявленным кодом — отклонена, не уходит; итог — «совершено».
    const callsFrom = demo.stand.merchantCalls().length;
    let prepAfter: unknown;
    const passed = await once("Н-07", {
      expect: expectGuard,
      run: async (c) => {
        c.mark({ mandate_id: "mnd_ord1" });
        await c.violate.call("GET /pao/v1/agent", {});
        prepAfter = await c.shop("GET", "/v1/shops/guarded").catch((e: unknown) => e);
      },
    }, { fetch: guarded });
    expect(passed.at(-1)).toMatchObject({ step: "fault.marked", params: { mandate_id: "mnd_ord1" } });
    expect(String((prepAfter as Error).message)).toBe("PREP_AFTER_VIOLATION");
    expect(demo.stand.merchantCalls().slice(callsFrom).some((c) => c.path === "/v1/shops/guarded")).toBe(false);
    // Порядок наоборот: подготовка, затем нарушение с объявленной парой — «защита сработала».
    expect(
      await last("Н-07", {
        expect: expectGuard,
        run: async (c) => {
          c.mark({ mandate_id: "mnd_ord2" });
          await c.call("GET /pao/v1/agent", {});
          await c.violate.shop("GET", "/v1/shops/guarded").catch(() => undefined);
        },
      }, { fetch: guarded }),
    ).toMatchObject({ step: "fault.refused", params: { code: "X_GUARD" } });
    // Два нарушения: второе не уходит; первое 2xx — «совершено», хотя второе получило бы объявленную пару.
    const two = await once("Н-07", {
      expect: expectGuard,
      run: async (c) => {
        c.mark({ mandate_id: "mnd_ord3" });
        await c.violate.call("GET /pao/v1/agent", {});
        expect(String(((await c.violate.shop("GET", "/v1/shops/guarded").catch((e: unknown) => e)) as Error).message)).toBe("SECOND_VIOLATION");
      },
    }, { fetch: guarded });
    expect(two.at(-1)).toMatchObject({ step: "fault.marked" });
    expect(two.filter((x) => x.step === "fault.sent")).toHaveLength(1);
    // Два нарушения, порядок наоборот: первое — объявленная пара, второе (было бы 2xx) не уходит — «защита сработала».
    expect(
      await last("Н-07", {
        expect: expectGuard,
        run: async (c) => {
          c.mark({ mandate_id: "mnd_ord4" });
          await c.violate.shop("GET", "/v1/shops/guarded").catch(() => undefined);
          await c.violate.call("GET /pao/v1/agent", {}).catch(() => undefined);
        },
      }, { fetch: guarded }),
    ).toMatchObject({ step: "fault.refused", params: { code: "X_GUARD" } });
    // Прошедшее нарушение старше остановки ветки и её ошибки.
    for (const after of [(c: FaultContext) => c.step("outcome" as BranchStep), () => { throw new Error("x"); }] as const) {
      expect(
        await last("Н-07", {
          expect: expectGuard,
          run: async (c) => {
            c.mark({ mandate_id: "mnd_ord5" });
            await c.violate.call("GET /pao/v1/agent", {});
            after(c);
          },
        }),
      ).toMatchObject({ step: "fault.marked", params: { mandate_id: "mnd_ord5" } });
    }
  });

  it("исключение из решения о последнем кирпиче каркаса (ревью П-11.3а-4 № 1, № 2): сбой подготовки выше «защиты»; нарушение не уходит, пока подготовка не ответила", async () => {
    const expectGuard = [{ code: "X_GUARD", status: 409 }];
    const reply = (u: URL) =>
      u.pathname === "/v1/shops/prep-refused" ? json(409, { code: "ORDER_MISSING" }) : u.pathname === "/v1/shops/guarded" ? json(409, { code: "X_GUARD" }) : u.pathname === "/v1/shops/prep-slow" ? pause(150).then(() => json(200, {})) : undefined;
    // № 1: подготовка отказала (ветка проглотила), нарушение получило объявленную пару — не «защита сработала».
    expect(
      await last("Н-07", {
        expect: expectGuard,
        run: async (c) => {
          c.mark({ mandate_id: "mnd_exc1" });
          await c.shop("GET", "/v1/shops/prep-refused").catch(() => undefined);
          await c.violate.shop("GET", "/v1/shops/guarded").catch(() => undefined);
        },
      }, { fetch: fake(reply) }),
    ).toMatchObject({ step: "fault.unplayed", params: { code: "PREP_FAILED,ORDER_MISSING", status: 409 } });
    // Зеркало: подготовка получила объявленный код, нарушение — 2xx — «совершено».
    expect(
      await last("Н-07", {
        expect: expectGuard,
        run: async (c) => {
          c.mark({ mandate_id: "mnd_exc2" });
          await c.shop("GET", "/v1/shops/guarded").catch(() => undefined);
          await c.violate.call("GET /pao/v1/agent", {});
        },
      }, { fetch: fake(reply) }),
    ).toMatchObject({ step: "fault.marked", params: { mandate_id: "mnd_exc2" } });
    // № 2: подготовка без await (медленная, в итоге 2xx), сразу нарушение — нарушение не уходит, PREP_PENDING.
    let pending: unknown;
    const s = await once("Н-07", {
      expect: expectGuard,
      run: async (c) => {
        c.mark({ mandate_id: "mnd_exc3" });
        void c.shop("GET", "/v1/shops/prep-slow");
        pending = await c.violate.shop("GET", "/v1/shops/guarded").catch((e: unknown) => e);
      },
    }, { fetch: fake(reply) });
    expect(String((pending as Error).message)).toBe("PREP_PENDING");
    expect(s.some((x) => x.step === "fault.sent" || x.step === "fault.refused")).toBe(false);
    expect(s.at(-1)).toMatchObject({ step: "fault.unplayed", params: { code: "NOT_SENT" } });
    // Подготовка ПАО отказала (промис отклонён, ветка поймала) — счёт ожидания снят: нарушение уходит, 2xx — «совершено»
    // (перепроверка П-11.3а-4 № 1: снятие счёта при сбое подготовки закреплено тестом).
    const afterFail = await once("Н-07", {
      expect: expectGuard,
      run: async (c) => {
        c.mark({ mandate_id: "mnd_exc4" });
        await c.call("POST /pao/v1/credentials", { body: {} as never, idempotencyKey: "fault-probe-exc4" }).catch(() => undefined); // подготовка: отказ ПАО
        await c.violate.call("GET /pao/v1/agent", {});
      },
    });
    expect(afterFail.filter((x) => x.step === "fault.sent")).toHaveLength(1);
    expect(afterFail.at(-1)).toMatchObject({ step: "fault.marked", params: { mandate_id: "mnd_exc4" } });
  });

  it("ответ 2xx от ПАО с телом не JSON — «тело не разобрать», а не «нет ответа» (мелочь № 9)", async () => {
    expect(
      await last("Н-05", {
        expect: [],
        run: async (c) => (c.mark({ mandate_id: "mnd_body" }), void (await c.violate.call("GET /pao/v1/agent", {}).catch(() => undefined))),
      }, { fetch: fake((u) => (u.pathname === "/pao/v1/agent" ? new Response("not json", { status: 200, headers: { "content-type": "application/json" } }) : undefined)) }),
    ).toMatchObject({ step: "fault.unplayed", params: { code: "MALFORMED_BODY" } });
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
        await c.call("GET /pao/v1/agent", {}); // настоящий запрос (подготовка) ушёл — но отказ ниже не его ответ
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
        void c.violate.shop("GET", "/v1/shops/refused"); // нарушение без await, с отказом — итог его дождётся, процесс не падает
        setTimeout(() => (late = c.call("GET /pao/v1/agent", {})), 20); // после конца ветки — не уходит
      },
    }, { fetch: fake((u) => (u.pathname === "/v1/shops/refused" ? json(404, { code: "SHOP_NOT_FOUND" }) : undefined)) });
    expect(s.filter((x) => x.step === "fault.sent")).toHaveLength(1);
    // Отказ витрины не объявлен — один исход (повторное № 3: закреплён).
    expect(s.at(-1)).toMatchObject({ step: "fault.unplayed", params: { code: "UNEXPECTED_SHOP_NOT_FOUND", status: 404 } });
    await pause(100);
    await expect(late).rejects.toThrow("CLOSED");
    expect(demo.stand.stand.calls().slice(callsFrom).filter((c) => c.path === "/pao/v1/agent")).toEqual([]);
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

  describe("П-11.3б: ветки Н-07, Н-06 и закрытая таблица нарушений", { timeout: 60_000 }, () => {
    /** Драйвер с настоящими ветками и таблицей FAULT_PLAN (без тестовых подмен), срок ожидания клиента — короче. */
    const real = (clientWaitMs = 15_000) => new FaultyDriver(demo.stand, (s) => demo.bus.scenario(s), { otherBusy: () => demo.scenarios.busy, clientWaitMs });
    const untilStep = async (from: number, name: string) => {
      for (const end = Date.now() + 15_000; Date.now() < end; await pause(50)) {
        const s = steps().slice(from).find((x) => x.step === name);
        if (s) return s;
      }
      throw new Error(`не дождались шага ${name}`);
    };
    const signCalls = (from: number) => demo.stand.stand.calls().slice(from).filter((c) => c.method === "POST" && /^\/participants\/v1\/mandates\/[^/]+\/sign$/.test(c.path));

    it("таблица FAULT_PLAN — по всем тестам «ПР», коды и операции по п. 4 ответа Платформы по #112; ветка роль и коды не объявляет", () => {
      expect(Object.keys(FAULT_PLAN).sort()).toEqual([...FAULT_TESTS].sort());
      expect(FAULT_PLAN["Н-07"]).toEqual({ violations: ["POST /pao/v1/credentials"], expect: [{ code: "PRINCIPAL_SIGNATURE_PENDING", status: 409 }] });
      expect(FAULT_PLAN["Н-06"]).toEqual({ violations: ["POST /pao/v1/credentials"], expect: [{ code: "MANDATE_REVOKED", status: 409 }] });
      expect(FAULT_PLAN["Н-01"].expect).toEqual([{ code: "ORDER_NOT_PAYABLE", status: 409 }]);
      expect(FAULT_PLAN["Н-08"].expect).toEqual([{ code: "MANDATE_SCOPE", status: 409 }]);
      expect(FAULT_PLAN["Н-09"].expect).toEqual([{ code: "MANDATE_SCOPE", status: 409 }]);
      expect(FAULT_PLAN["Н-05"].expect).toEqual([]);
    });

    it("нарушение не той операцией, что в таблице, — ошибка BAD_VIOLATION, запрос не уходит", async () => {
      const callsFrom = demo.stand.stand.calls().length;
      const n = steps().length;
      const d = new FaultyDriver(demo.stand, (s) => demo.bus.scenario(s), {
        branches: { "Н-07": { run: async (c) => (c.mark({ mandate_id: "mnd_badv" }), void (await c.violate.call("GET /pao/v1/agent", {}).catch(() => undefined))) } },
      });
      d.start("Н-07");
      await d.settled();
      expect(steps().slice(n).at(-1)).toMatchObject({ step: "fault.unplayed", params: { code: "BAD_VIOLATION" } });
      expect(demo.stand.stand.calls().slice(callsFrom).some((c) => c.path === "/pao/v1/agent")).toBe(false);
    });

    it("Н-07: поручение нарушителя подписал клиент (эмулятор банка), корзину — нет; реквизит по неподписанной корзине → 409 PRINCIPAL_SIGNATURE_PENDING, реквизит не выдан", async () => {
      const n = steps().length;
      const credsFrom = demo.stand.stand.issuedCredentials().length;
      const d = real();
      expect(d.start("Н-07")).toEqual({ ok: true });
      const req = await untilStep(n, "fault.note.intent_requested");
      expect((await demo.stand.stand.issuer.sign(String(req.params.mandate_id))).statusCode).toBe(200); // клиент — в банке
      await d.settled();
      const s = steps().slice(n);
      expect(s.map((x) => x.step)).toEqual(["run.fault", "fault.note.intent_requested", "fault.note.intent_signed", "fault.note.cart_created", "fault.note.cart_keep_unsigned", "fault.sent", "fault.refused"]);
      const cartId = String(s.find((x) => x.step === "fault.note.cart_created")!.params.mandate_id);
      // Итог и вторая пометка несут корзину (ревью П-11.3б № 6); привязка «ПР» к транзакции на пульте — в «Открыто».
      expect(s.at(-1)!.params).toMatchObject({ test: "Н-07", code: "PRINCIPAL_SIGNATURE_PENDING", status: 409, mandate_id: cartId, merchant_id: MASSA_MADRE.merchant_id });
      expect(demo.stand.stand.demo!.log().some((e) => e.what === "MARKED" && e.test === "Н-07" && e.ids?.mandate_id === cartId)).toBe(true);
      expect(demo.stand.stand.issuedCredentials().length).toBe(credsFrom);
      expect(demo.stand.stand.demo!.log().some((e) => e.what === "MARKED" && e.test === "Н-07" && e.ids?.merchant_id === MASSA_MADRE.merchant_id)).toBe(true);
    });

    it("Н-06: полномочие действовало — клиент подписал поручение и корзину, затем отозвал поручение (корзина — каскадом); реквизит по отозванной корзине → 409 MANDATE_REVOKED, реквизит не выдан", async () => {
      const n = steps().length;
      const credsFrom = demo.stand.stand.issuedCredentials().length;
      const d = real();
      expect(d.start("Н-06")).toEqual({ ok: true });
      const req = await untilStep(n, "fault.note.intent_requested");
      const intentId = String(req.params.mandate_id);
      expect((await demo.stand.stand.issuer.sign(intentId)).statusCode).toBe(200);
      const cartAsk = await untilStep(n, "fault.note.cart_sign_ask");
      const cartId = String(cartAsk.params.mandate_id);
      expect((await demo.stand.stand.issuer.sign(cartId)).statusCode).toBe(200); // второе действие клиента — корзина действует
      await untilStep(n, "fault.note.revoke_ask");
      expect((await demo.stand.stand.issuer.revoke(intentId)).statusCode).toBe(200); // третье — отзыв поручения в банке
      await d.settled();
      const s = steps().slice(n);
      expect(s.map((x) => x.step)).toEqual([
        "run.fault",
        "fault.note.intent_requested",
        "fault.note.intent_signed",
        "fault.note.cart_created",
        "fault.note.cart_sign_ask",
        "fault.note.cart_signed",
        "fault.note.revoke_ask",
        "fault.note.revoked",
        "fault.sent",
        "fault.refused",
      ]);
      expect(s.at(-1)!.params).toMatchObject({ test: "Н-06", code: "MANDATE_REVOKED", status: 409, mandate_id: cartId });
      expect(demo.stand.stand.issuedCredentials().length).toBe(credsFrom);
    });

    it("отказ агента от полномочий (relinquish) в подготовке запрещён — BAD_PREP, запрос не уходит; пометка после нарушения — ошибка", async () => {
      const callsFrom = demo.stand.stand.calls().length;
      const n = steps().length;
      const d = new FaultyDriver(demo.stand, (s) => demo.bus.scenario(s), {
        branches: {
          "Н-06": {
            run: async (c) => {
              c.mark({ mandate_id: "mnd_relq" });
              await c.call("POST /pao/v1/mandates/{id}/relinquish", { path: { id: "mnd_relq" }, idempotencyKey: "fault-relq" }).catch(() => undefined);
            },
          },
        },
      });
      d.start("Н-06");
      await d.settled();
      expect(steps().slice(n).at(-1)).toMatchObject({ step: "fault.unplayed", params: { code: "BAD_PREP" } });
      expect(demo.stand.stand.calls().slice(callsFrom).some((c) => c.path.endsWith("/relinquish"))).toBe(false);
      // Пометка после нарушающего запроса — ошибка; прошедшее нарушение при этом остаётся «совершено» (старше всего).
      expect(
        await last("Н-07", {
          expect: [],
          run: async (c) => {
            c.mark({ mandate_id: "mnd_mav1" });
            await c.violate.call("GET /pao/v1/agent", {});
            expect(() => c.mark({ mandate_id: "mnd_mav2" })).toThrow("MARK_AFTER_VIOLATION");
          },
        }),
      ).toMatchObject({ step: "fault.marked", params: { mandate_id: "mnd_mav1" } });
      // На стенде пометки после нарушения нет (повторное B: «ни одна — после нарушающего запроса»).
      expect(marked("Н-07", "mnd_mav2")).toBe(false);
    });

    it("«прервать» (кнопка монитора) останавливает ожидание клиента в нарушении — «не разыграно» ABORTED, сюжеты снова свободны (решение 3)", async () => {
      const n = steps().length;
      expect((await post(`/fault/${enc("Н-07")}`)).status).toBe(202); // драйвер сборки — срок 180 с
      await untilStep(n, "fault.note.intent_requested");
      expect(demo.scenarios.start("intent")).toEqual({ ok: false, code: "BUSY" }); // пока ждёт клиента — сюжеты заняты
      const t0 = Date.now();
      expect((await post("/scenario/abort")).status).toBe(202);
      await demo.faulty!.settled();
      expect(Date.now() - t0).toBeLessThan(3000);
      expect(steps().slice(n).at(-1)).toMatchObject({ step: "fault.unplayed", params: { test: "Н-07", code: "ABORTED" } });
      expect(demo.faulty!.busy).toBe(false);
      expect(demo.faulty!.abort()).toEqual({ ok: false, code: "NOT_AWAITING" });
    });

    it("клиент не подписал за срок — «помечено, но не разыграно» с конкретной причиной CLIENT_SIGN_TIMEOUT; драйвер за клиента не подписывал", async () => {
      const n = steps().length;
      const callsFrom = demo.stand.stand.calls().length;
      const d = real(400);
      d.start("Н-07");
      await d.settled();
      expect(steps().slice(n).at(-1)).toMatchObject({ step: "fault.unplayed", params: { code: "CLIENT_SIGN_TIMEOUT" } });
      expect(signCalls(callsFrom)).toEqual([]); // подписи не было ни от кого — драйвер за клиента не подписывает
    });

    it("инвариант 3: у ветки нет средств подписать за клиента — путь шлюза участников закрыт (BAD_TARGET), в контексте нет эмулятора банка", async () => {
      const callsFrom = demo.stand.stand.calls().length;
      const merchantsFrom = demo.stand.merchantCalls().length;
      let keys: string[] = [];
      const n = steps().length;
      // Прямой путь шлюза и обходы через «..» после «/v1/» (ревью П-11.3б № 3).
      for (const target of ["/participants/v1/mandates/mnd_sign_try/sign", "/v1/../participants/v1/mandates/mnd_sign_try/sign", "/v1/%2e%2e/participants/v1/mandates/mnd_sign_try/sign", "/v1/%2E%2E/x", "/v1/./../x"]) {
        const d = new FaultyDriver(demo.stand, (s) => demo.bus.scenario(s), {
          branches: {
            "Н-07": {
              run: async (c) => {
                keys = Object.keys(c).sort();
                c.mark({ mandate_id: "mnd_sign_try" });
                await c.shop("POST", target, { decision: "APPROVE" }).catch(() => undefined);
              },
            },
          },
        });
        const n = steps().length;
        d.start("Н-07");
        await d.settled();
        expect(steps().slice(n).at(-1), target).toMatchObject({ step: "fault.unplayed", params: { code: "BAD_TARGET" } });
      }
      void n;
      // wakeEvents (П-11.3г) — только сигнал ленте событий ядра: ни ядра, ни эмулятора банка ветка не получает.
      expect(keys).toEqual(["call", "mark", "shop", "signal", "step", "urls", "violate", "waitClient", "wakeEvents"]);
      expect(signCalls(callsFrom)).toEqual([]);
      expect(demo.stand.merchantCalls().slice(merchantsFrom)).toEqual([]);
    });
  });

  // Ветки по подписанной корзине (П-11.3в, П-11.3г): настоящая таблица и настоящие ветки; клиент — эмулятор банка.
  const real = (o: Opts = {}) => new FaultyDriver(demo.stand, (s) => demo.bus.scenario(s), { otherBusy: () => demo.scenarios.busy, clientWaitMs: 15_000, ...o });
  const untilStepFrom = async (from: number, name: string) => {
    for (const end = Date.now() + 15_000; Date.now() < end; await pause(50)) {
      const s = steps().slice(from).find((x) => x.step === name);
      if (s) return s;
    }
    throw new Error(`не дождались шага ${name}`);
  };
  /** Клиент (эмулятор банка, автотест) подписывает поручение и корзину нарушителя. */
  const clientSignsBoth = async (from: number): Promise<string> => {
    const req = await untilStepFrom(from, "fault.note.intent_requested");
    expect((await demo.stand.stand.issuer.sign(String(req.params.mandate_id))).statusCode).toBe(200);
    const ask = await untilStepFrom(from, "fault.note.cart_sign_ask_scope");
    const cartId = String(ask.params.mandate_id);
    expect((await demo.stand.stand.issuer.sign(cartId)).statusCode).toBe(200);
    return cartId;
  };

  describe("П-11.3в: ветка MANDATE_SCOPE — Н-08, Н-09 (по подписанной корзине)", { timeout: 60_000 }, () => {
    const price = MASSA_MADRE.items[0]!.price!;

    it("Н-08: реквизит по подписанной корзине на сумму на одну единицу больше её предела → 409 MANDATE_SCOPE, реквизит не выдан", async () => {
      const n = steps().length;
      const credsFrom = demo.stand.stand.issuedCredentials().length;
      const d = real();
      expect(d.start("Н-08")).toEqual({ ok: true });
      const cartId = await clientSignsBoth(n);
      await d.settled();
      const s = steps().slice(n);
      expect(s.at(-1)).toMatchObject({ step: "fault.refused", params: { test: "Н-08", code: "MANDATE_SCOPE", status: 409, mandate_id: cartId } });
      expect(demo.stand.stand.issuedCredentials().length).toBe(credsFrom);
    });

    it("Н-08, обратный (только автотест): сумма в пределе корзины — не защита: реквизит выдан, «совершено»; криптограмма и token_ref — только в памяти ветки", async () => {
      const n = steps().length;
      const credsFrom = demo.stand.stand.issuedCredentials().length;
      let secrets: string[] = [];
      // Тот же ход, что ветка Н-08, но amount_max = цене корзины (в пределе); таблица — настоящая FAULT_PLAN.
      const d = new FaultyDriver(demo.stand, (s) => demo.bus.scenario(s), {
        otherBusy: () => demo.scenarios.busy,
        clientWaitMs: 15_000,
        branches: {
          "Н-08": {
            run: async (c) => {
              // Ключ — с UUID, как у веток: метка времени Date.now() — 13 цифр в order_ref; с верной суммой Луна Платформа
              // принимает её за номер карты и отвечает CREDENTIALS_FORBIDDEN (плавающий отказ, П-11.3г).
              const key = `n08r-${randomUUID()}`;
              const { cartId } = await signedCart(c, key);
              const cred = await credentialFor(c, cartId, key, { amountMax: price });
              // Без фильтра: каждое поле — явно (ревью П-11.3в № 1 — исключение: отсутствующее поле не проверялось бы молча).
              secrets = [cred.payload?.cryptogram, cred.payload?.token_ref, cred.credential_ref] as string[];
            },
          },
        },
      });
      d.start("Н-08");
      await clientSignsBoth(n);
      await d.settled();
      const end = steps().slice(n).at(-1);
      expect(end, JSON.stringify(end?.params)).toMatchObject({ step: "fault.marked", params: { test: "Н-08" } });
      expect(demo.stand.stand.issuedCredentials().length).toBe(credsFrom + 1); // MANDATE_SCOPE в прямом тесте — из-за суммы
      const [cryptogram, tokenRef, credentialRef] = secrets;
      for (const [name, v] of [["cryptogram", cryptogram], ["token_ref", tokenRef], ["credential_ref", credentialRef]] as const) {
        expect(typeof v === "string" && v.length > 0, `${name} — непустая строка`).toBe(true);
      }
      // Явно, а не полагаясь на фильтр шага: ни на шине, ни в журнале агента, ни в журнале стенда, ни в ответах маршрута.
      const everywhere = [JSON.stringify(demo.bus.history()), JSON.stringify(demo.stand.journal.entries), JSON.stringify(demo.stand.stand.demo!.log()), replies.join("")].join("\n");
      for (const secret of secrets) expect(everywhere.includes(secret), "реквизит вышел из памяти ветки").toBe(false);
    });

    it("Н-09: реквизит по подписанной корзине «Массы Мадре» на другого продавца стенда → 409 MANDATE_SCOPE, реквизит не выдан", async () => {
      const n = steps().length;
      const credsFrom = demo.stand.stand.issuedCredentials().length;
      const d = real();
      expect(d.start("Н-09")).toEqual({ ok: true });
      const cartId = await clientSignsBoth(n);
      await d.settled();
      const s = steps().slice(n);
      const other = s.find((x) => x.step === "fault.note.other_merchant")!;
      expect(other.params.merchant_id).toBe(otherMerchant(DEMO_SHOPS));
      expect(other.params.merchant_id).not.toBe(MASSA_MADRE.merchant_id);
      expect(DEMO_SHOPS.some((x) => x.merchant_id === other.params.merchant_id)).toBe(true);
      expect(s.at(-1)).toMatchObject({ step: "fault.refused", params: { test: "Н-09", code: "MANDATE_SCOPE", status: 409, mandate_id: cartId } });
      expect(demo.stand.stand.issuedCredentials().length).toBe(credsFrom);
    });

    it("Н-09 без второго продавца на стенде — «не разыграно» NO_SECOND_MERCHANT до пометки и запросов, не «Масса Мадре» по умолчанию", async () => {
      expect(otherMerchant([MASSA_MADRE])).toBeUndefined();
      const callsFrom = demo.stand.stand.calls().length;
      const logFrom = demo.stand.stand.demo!.log().length;
      const n = steps().length;
      const d = new FaultyDriver(demo.stand, (s) => demo.bus.scenario(s), { branches: { "Н-09": n09Branch([MASSA_MADRE]) } });
      d.start("Н-09");
      await d.settled();
      expect(steps().slice(n).at(-1)).toMatchObject({ step: "fault.failed", params: { test: "Н-09", code: "NO_SECOND_MERCHANT" } });
      expect(demo.stand.stand.calls().slice(callsFrom).filter((c) => c.path.startsWith("/pao/"))).toEqual([]);
      expect(demo.stand.stand.demo!.log().slice(logFrom).some((e) => e.what === "MARKED")).toBe(false);
    });
  });

  describe("П-11.3г: ветка Н-01 — повторная оплата оплаченного заказа", { timeout: 60_000 }, () => {
    /** Авторизации заказа на мониторе — события Платформы, которые получило ядро (инвариант 6). */
    const authorized = (opRef: string) =>
      demo.bus.history().filter((i) => i.stream === "monitor" && i.event.source === "pao_event" && i.event.what === "operation.authorized" && i.event.ids.op_ref === opRef);
    /** Подглядывающий fetch (только автотест): настоящий ответ, из ответа на реквизит — три значения для проверки «нигде нет». */
    const spying = (secrets: string[]): typeof fetch =>
      (async (input: string | URL | Request, init?: RequestInit) => {
        const r = await fetch(input, init);
        const url = new URL(input instanceof Request ? input.url : String(input));
        if (url.pathname === "/pao/v1/credentials" && (init?.method ?? (input instanceof Request ? input.method : "GET")) === "POST" && r.ok) {
          const b = (await r.clone().json()) as { credential_ref?: unknown; payload?: { cryptogram?: unknown; token_ref?: unknown } };
          // Без фильтра: каждое поле — явно (как обратный тест Н-08, ревью П-11.3в № 1).
          secrets.push(...([b.credential_ref, b.payload?.cryptogram, b.payload?.token_ref] as string[]));
        }
        return r;
      }) as typeof fetch;

    it("Н-01: заказ, реквизит, первая оплата — авторизация Платформы (одна operation.authorized); повтор тем же пакетом → 409 ORDER_NOT_PAYABLE; реквизит и пакет — только в памяти ветки", async () => {
      const n = steps().length;
      const histFrom = demo.bus.history().length;
      const credsFrom = demo.stand.stand.issuedCredentials().length;
      const secrets: string[] = [];
      const d = real({ fetch: spying(secrets) });
      expect(d.start("Н-01")).toEqual({ ok: true });
      const cartId = await clientSignsBoth(n);
      await d.settled();
      const s = steps().slice(n);
      const orderId = String(s.find((x) => x.step === "fault.note.order_placed")?.params.order_id);
      expect(orderId).toMatch(/^ORD-/);
      expect(s.find((x) => x.step === "fault.note.first_payment")?.params).toMatchObject({ test: "Н-01", order_id: orderId });
      // Порядок: первая оплата прошла раньше, чем ушёл нарушающий запрос.
      expect(s.findIndex((x) => x.step === "fault.note.first_payment")).toBeLessThan(s.findIndex((x) => x.step === "fault.sent"));
      expect(s.at(-1)).toMatchObject({ step: "fault.refused", params: { test: "Н-01", code: "ORDER_NOT_PAYABLE", status: 409, mandate_id: cartId } });
      // Первое списание — по событию Платформы; второе не ушло: событие одно и после отказа не прибавилось.
      // Событие — по op_ref операции первой оплаты (номера заказа в событии нет: операцию нарушителя ядро не читает — это не
      // его покупка). Лента ядра читает по сигналу: до отказа её будит только ветка (wakeEvents); после нарушения тест
      // дочитывает её сам (ревью № 3).
      const rawOpRef = s.find((x) => x.step === "fault.note.first_payment")?.params.op_ref;
      expect(typeof rawOpRef === "string" && /^[A-Za-z0-9_.:-]+$/.test(rawOpRef), "op_ref первой оплаты — по форме").toBe(true);
      const opRef = rawOpRef as string;
      for (const end = Date.now() + 10_000; authorized(opRef).length === 0 && Date.now() < end; await pause(50));
      expect(authorized(opRef)).toHaveLength(1);
      // После нарушения ленту ядра ветка уже не будит — дочитать её здесь, иначе второе событие и не пришло бы (ревью
      // П-11.3г № 3).
      await demo.stand.agent.events.signal();
      const otherAuth = demo.bus.history().slice(histFrom).filter((i) => i.stream === "monitor" && i.event.source === "pao_event" && i.event.what === "operation.authorized" && i.event.ids.op_ref !== opRef);
      expect(otherAuth).toEqual([]);
      // Витрина получила две оплаты заказа: первую — 200, повтор — 409 ORDER_NOT_PAYABLE до авторизации.
      const payments = demo.stand.merchantCalls().filter((c) => c.path === `/v1/shops/${MASSA_MADRE.id}/orders/${orderId}/payment`);
      expect(payments.map((c) => [c.status, c.code ?? null])).toEqual([
        [200, null],
        [409, "ORDER_NOT_PAYABLE"],
      ]);
      // Реквизит выдан ровно один (по заказу) — и по ответу, и по стенду; значения — явно непустые, затем «нигде нет».
      expect(secrets).toHaveLength(3);
      expect(demo.stand.stand.issuedCredentials().length).toBe(credsFrom + 1);
      for (const [i, name] of ["credential_ref", "cryptogram", "token_ref"].entries()) expect(typeof secrets[i] === "string" && secrets[i]!.length > 0, `${name} — непустая строка`).toBe(true);
      // Ни на шине, ни в журнале агента, ни в журнале стенда. Ответы маршрута не проверяются: прогон — через d.start, а
      // маршрут отдаёт только {ok, code} (ревью П-11.3г № 11).
      const everywhere = [JSON.stringify(demo.bus.history()), JSON.stringify(demo.stand.journal.entries), JSON.stringify(demo.stand.stand.demo!.log())].join("\n");
      for (const secret of secrets) expect(everywhere.includes(secret), "реквизит вышел из памяти ветки").toBe(false);
    });

    it("Н-01: первая оплата не авторизована Платформой — повтор не уходит, «помечено, но не разыграно» FIRST_PAYMENT_NOT_AUTHORIZED, а не ложная «защита»", async () => {
      // Платформа «не знает» операции по корзине — отказ повтора тогда ничего бы не доказывал; операция есть, но номер не по
      // форме — пульт не свяжет событие с шагом (ревью П-11.3г № 9).
      const noOps = fake((u) => (u.pathname === "/pao/v1/operations" ? json(200, []) : undefined));
      // Сколько настоящих авторизованных операций подмена переписала: случай «op_ref не по форме» проверяет op_ref, только
      // если операция была и авторизована (иначе тот же код пришёл бы по другой причине; повторное ревью П-11.3г № 1).
      let rewritten = 0;
      const badOpRef = (async (input: string | URL | Request, init?: RequestInit) => {
        const r = await fetch(input, init);
        if (new URL(input instanceof Request ? input.url : String(input)).pathname !== "/pao/v1/operations") return r;
        const ops = (await r.json()) as Record<string, unknown>[];
        rewritten += ops.filter((o) => typeof o.order_ref === "string" && o.order_ref.startsWith("ORD-") && (o.status === "AUTHORIZED" || o.status === "SETTLED")).length;
        return json(r.status, ops.map((o) => ({ ...o, op_ref: "op ref!" })));
      }) as typeof fetch;
      for (const [name, f] of [["нет операции", noOps], ["op_ref не по форме", badOpRef]] as const) {
        const n = steps().length;
        const d = real({ fetch: f });
        expect(d.start("Н-01")).toEqual({ ok: true });
        const cartId = await clientSignsBoth(n);
        await d.settled();
        if (f === badOpRef) expect(rewritten, name).toBe(1);
        const s = steps().slice(n);
        expect(s.some((x) => x.step === "fault.sent"), name).toBe(false);
        expect(s.some((x) => x.step === "fault.note.first_payment"), name).toBe(false);
        expect(s.at(-1), name).toMatchObject({ step: "fault.unplayed", params: { test: "Н-01", code: "FIRST_PAYMENT_NOT_AUTHORIZED", mandate_id: cartId } });
      }
    });

    it("Н-01: номер заказа из ответа витрины — только по форме (инвариант 4): иначе ни реквизита, ни оплаты, на шину не идёт — ORDER_ID_MALFORMED (ревью П-11.3г № 4)", async () => {
      for (const bad of ["../x", "..", ".", "<b>x</b>", 42]) {
        const n = steps().length;
        const credsFrom = demo.stand.stand.issuedCredentials().length;
        const paysFrom = demo.stand.merchantCalls().length;
        // Подменный ответ витрины на заказ; остальное — настоящий стенд.
        const d = real({ fetch: fake((u) => (u.pathname === `/v1/shops/${MASSA_MADRE.id}/orders` ? json(201, { id: bad }) : undefined)) });
        expect(d.start("Н-01")).toEqual({ ok: true });
        const cartId = await clientSignsBoth(n);
        await d.settled();
        const s = steps().slice(n);
        expect(s.at(-1), String(bad)).toMatchObject({ step: "fault.unplayed", params: { test: "Н-01", code: "ORDER_ID_MALFORMED", mandate_id: cartId } });
        expect(s.some((x) => x.step === "fault.note.order_placed" || x.step === "fault.sent")).toBe(false);
        expect(s.filter((x) => "order_id" in x.params)).toEqual([]);
        expect(demo.stand.stand.issuedCredentials().length).toBe(credsFrom);
        expect(demo.stand.merchantCalls().slice(paysFrom).filter((c) => c.path.endsWith("/payment"))).toEqual([]);
      }
    });
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

/** Опции каждого `new FaultyDriver(…)` в тексте: объект третьим аргументом — только ключи otherBusy и closeWaitMs (полной
 *  или краткой записью), без `...`; нет объекта — тоже норма. Разбор — по парным скобкам верхнего уровня. */
function driverOptionsOk(text: string): boolean {
  const ALLOWED = new Set(["otherBusy", "closeWaitMs"]);
  for (let at = text.indexOf("new FaultyDriver("); at >= 0; at = text.indexOf("new FaultyDriver(", at + 1)) {
    // Аргументы вызова до парной скобки.
    let depth = 0;
    let end = -1;
    for (let i = at + "new FaultyDriver".length; i < text.length; i++) {
      const ch = text[i]!;
      if (ch === "(" || ch === "{" || ch === "[") depth++;
      else if (ch === ")" || ch === "}" || ch === "]") {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end < 0) return false;
    const args = text.slice(at + "new FaultyDriver(".length, end);
    // Части верхнего уровня, разделённые запятыми.
    const split = (s: string): string[] => {
      const out: string[] = [];
      let d = 0;
      let cur = "";
      for (const ch of s) {
        if (ch === "(" || ch === "{" || ch === "[") d++;
        else if (ch === ")" || ch === "}" || ch === "]") d--;
        if (ch === "," && d === 0) {
          out.push(cur.trim());
          cur = "";
        } else cur += ch;
      }
      if (cur.trim()) out.push(cur.trim());
      return out;
    };
    const parts = split(args);
    const opts = parts[2];
    if (opts === undefined) continue;
    if (!opts.startsWith("{") || !opts.endsWith("}")) return false; // опции не литералом — не проверить
    for (const p of split(opts.slice(1, -1))) {
      if (p.startsWith("...")) return false;
      const key = /^([A-Za-z_$][\w$]*)/.exec(p)?.[1];
      if (key === undefined || !ALLOWED.has(key)) return false;
    }
  }
  return true;
}

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
    // Средства действия за клиента — подписи, подтверждения, отзыва — в драйвере не упоминаются вовсе (инвариант 3, П5 п. 5;
    // ревью П-11.3б № 4).
    if (name === "src/demo/faulty.ts" && /\bissuer\b|bankApp|\bupk\b|participants|revokeMandate|remindClient|stopPurchase|\.inject\s*\(/.test(text)) bad.push(`${name} → средство действия за клиента`);
    // Опции драйвера только для автотестов — сборка стенда их не передаёт: у `new FaultyDriver(` в объекте опций — только
    // otherBusy и closeWaitMs, без краткой записи других ключей и без разворота `...` (ревью П-11.3б № 1, повторное A).
    if (name === "src/demo/run.ts" && !driverOptionsOk(text)) bad.push(`${name} → опции драйвера для автотестов`);
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
    for (const [file, expr] of Object.entries(ALLOWED_DYNAMIC)) expect(readFileSync(join(ROOT, file), "utf8"), file).toContain(expr);
    expect(readFileSync(join(ROOT, "src/demo/run.ts"), "utf8")).toContain("new FaultyDriver(");
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
      // Сложение строк, второй аргумент, пробел перед скобкой (ревью П-11.3а-3 № 4).
      writeFileSync(join(root, "src/demo/plus.ts"), `const x = "core";\nexport const t = import("@kuzin4u/agentic-" + x + "/pao");\n`);
      writeFileSync(join(root, "src/demo/arg2.ts"), `export const t = import("@kuzin4u/agentic-core/pao", { with: {} });\n`);
      writeFileSync(join(root, "src/demo/space.ts"), `export const t = import ("@kuzin4u/agentic-core/pao");\nexport const r = require ("agentic-buyer-ref/src/agent/adapters/pao/index.js");\n`);
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
          "src/demo/plus.ts → динамическая ссылка на модуль",
          "src/demo/arg2.ts → динамическая ссылка на модуль",
          "src/demo/space.ts → @kuzin4u/agentic-core",
          "src/demo/space.ts → адаптер ядра",
          "src/demo/platform.ts → динамическая ссылка на модуль",
          "src/pult/p.ts → faulty",
          "src/pult/p.ts → драйвер",
        ]),
      );
      expect(v.some((x) => x.startsWith("src/demo/faulty.ts") || x.startsWith("src/demo/run.ts") || x.startsWith("src/demo/stand.ts"))).toBe(false);
      // Опция для автотестов после otherBusy в run.ts и средство действия за клиента в драйвере (ревью П-11.3б № 1, № 4).
      writeFileSync(
        join(root, "src/demo/run.ts"),
        `import { x } from "./faulty.js";\nexport const y = new FaultyDriver(stand, (s) => b.scenario(s), { otherBusy: () => sc.busy, plan: {} });\n`,
      );
      writeFileSync(join(root, "src/demo/faulty.ts"), `import { PaoClient } from "@kuzin4u/agentic-core/pao";\nexport const x = (d: any) => d.stand.demo.revokeMandate("m");\n`);
      expect(driverBoundary(root)).toEqual(expect.arrayContaining(["src/demo/run.ts → опции драйвера для автотестов", "src/demo/faulty.ts → средство действия за клиента"]));
      // Краткая запись и разворот (повторное A).
      for (const opts of ["{ otherBusy: () => sc.busy, plan }", "{ branches, otherBusy: () => sc.busy }", "{ otherBusy: () => sc.busy, ...testOpts }"]) {
        writeFileSync(join(root, "src/demo/run.ts"), `import { x } from "./faulty.js";\nexport const y = new FaultyDriver(stand, (s) => b.scenario(s), ${opts});\n`);
        expect(driverBoundary(root), opts).toContain("src/demo/run.ts → опции драйвера для автотестов");
      }
      // Разрешённые опции — не нарушение.
      writeFileSync(join(root, "src/demo/run.ts"), `import { x } from "./faulty.js";\nexport const y = new FaultyDriver(stand, (s) => b.scenario(s), { otherBusy: () => sc.busy, closeWaitMs: 100 });\n`);
      expect(driverBoundary(root)).not.toContain("src/demo/run.ts → опции драйвера для автотестов");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
