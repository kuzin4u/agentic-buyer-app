// П-11.3а, П-11.3а-1 (П7 и дополнение 1, Р-1480, Р-1482): каркас драйвера нарушителя «ПР» — только при DEMO_FAULTS=1,
// ключ агента приложения, пометка на стенде до нарушающего запроса (защёлка), «защита сработала» — только объявленный
// веткой код, на шину — только тест, код, статус и идентификаторы стенда; своя метка прогона, взаимная блокировка с
// сюжетами, закрытие с таймаутом; маршрут /fault/<Н-xx>; граница импортов. Ветки нарушений — П-11.3б–д.
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
import { FaultyDriver, ID_FIELDS, type FaultBranch } from "../../src/demo/faulty.js";
import { MESSAGES } from "../../src/demo/i18n.js";
import { startDemo, type Demo } from "../../src/demo/run.js";
import { DemoScenarios } from "../../src/demo/scenarios.js";
import { TRAINING_MERCHANTS } from "../../src/demo/shops.js";
import { filesUnder, specifiers } from "../support/imports.js";

const ROOT = resolve(import.meta.dirname, "../..");
const enc = (test: string) => encodeURIComponent(test);
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
const paoError = (status: number, code?: string, clientCode?: string) =>
  new PaoCallError(status, code ? { code: code as never, message: code, retry: "never" } : undefined, 1, undefined, clientCode ? { clientCode: clientCode as never } : undefined);

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
  const steps = (): ScenarioLine[] => demo.bus.history().flatMap((i) => (i.stream === "scenario" ? [i.line] : []));
  // origin: строка — заголовок Origin; null — без заголовка. Тела ответов — для проверки «ключ не выходит».
  const post = async (path: string, origin: string | null = demo.monitor.url) => {
    const r = await fetch(`${demo.monitor.url}${path}`, { method: "POST", headers: origin !== null ? { origin } : {} });
    const body = await r.text();
    replies.push(body);
    return { status: r.status, body };
  };
  /** Свой экземпляр драйвера с ветками теста; шаги — на шину демо, блокировка — с сюжетами демо. */
  const driver = (branches: Partial<Record<FaultTest, FaultBranch>>, closeWaitMs?: number) =>
    new FaultyDriver(demo.stand, (s) => demo.bus.scenario(s), { branches, otherBusy: () => demo.scenarios.busy, ...(closeWaitMs !== undefined && { closeWaitMs }) });
  /** Один прогон ветки — шаги этого прогона. */
  async function once(test: FaultTest, branch: FaultBranch): Promise<ScenarioLine[]> {
    const n = steps().length;
    const d = driver({ [test]: branch });
    expect(d.start(test)).toEqual({ ok: true });
    await d.settled();
    return steps().slice(n);
  }
  const marked = (test: string, mandateId: string) => demo.stand.stand.demo!.log().some((e) => e.what === "MARKED" && e.test === test && e.ids?.mandate_id === mandateId);

  beforeAll(async () => {
    demo = await startDemo({ faults: true });
  }, 30_000);
  afterAll(async () => {
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

  it("подпись — ключом агента приложения после пометки «ПР»; без кода защиты — «совершено и помечено»; своя метка прогона", async () => {
    const callsFrom = demo.stand.stand.calls().length;
    let logAtCall = -1;
    const s = await once("Н-05", {
      expect: [],
      run: async (c) => {
        c.mark({ mandate_id: "mnd_probe5" });
        logAtCall = demo.stand.stand.demo!.log().length;
        await c.call("GET /pao/v1/agent", {});
        return {};
      },
    });
    expect(marked("Н-05", "mnd_probe5")).toBe(true);
    expect(logAtCall).toBeGreaterThan(0);
    const call = demo.stand.stand.calls().slice(callsFrom).find((c) => c.path === "/pao/v1/agent")!;
    expect(call.status).toBe(200);
    expect(call.kid !== undefined && demo.stand.isAgentKid(call.kid)).toBe(true); // тот же ключ, что у агента
    expect(s.map((x) => x.step)).toEqual(["run.fault", "fault.marked"]);
    expect(s[1]!.params).toMatchObject({ test: "Н-05", mandate_id: "mnd_probe5" });
  });

  it("защёлка: запрос до пометки не уходит на стенд — «не разыграно» NOT_MARKED (ревью П-11.3а-1 № 2)", async () => {
    const callsFrom = demo.stand.stand.calls().length;
    const s = await once("Н-06", {
      expect: [],
      run: async (c) => {
        await c.call("GET /pao/v1/agent", {});
        return {};
      },
    });
    expect(s.at(-1)).toMatchObject({ step: "fault.failed", params: { test: "Н-06", code: "NOT_MARKED" } });
    expect(demo.stand.stand.calls().slice(callsFrom).some((c) => c.path === "/pao/v1/agent")).toBe(false);
    // Ветка без пометки и без запросов — тоже не засчитывается.
    expect((await once("Н-08", { expect: [], run: async () => ({}) })).at(-1)).toMatchObject({ step: "fault.failed", params: { code: "NOT_MARKED" } });
  });

  it("«защита сработала» — только объявленный веткой код; отказ по форме тела, 5xx, отказ клиента ПАО — «не разыграно» (ревью № 3, № 4)", async () => {
    // Объявленный код из таблицы п. 4 ответа #112 — «защита сработала, помечено».
    const ok = await once("Н-07", {
      expect: ["PRINCIPAL_SIGNATURE_PENDING"],
      run: async (c) => {
        c.mark({ mandate_id: "mnd_probe7" });
        throw paoError(409, "PRINCIPAL_SIGNATURE_PENDING");
      },
    });
    expect(ok.at(-1)).toMatchObject({ step: "fault.refused", params: { test: "Н-07", code: "PRINCIPAL_SIGNATURE_PENDING", status: 409, mandate_id: "mnd_probe7" } });
    expect(marked("Н-07", "mnd_probe7")).toBe(true);
    // Обратный тест: настоящий запрос с телом не по форме — отказ Платформы, но не защита Н-07.
    const form = await once("Н-07", {
      expect: ["PRINCIPAL_SIGNATURE_PENDING"],
      run: async (c) => {
        c.mark({ mandate_id: "mnd_probe7b" });
        await c.call("POST /pao/v1/credentials", { body: {} as never, idempotencyKey: "fault-probe-7b" });
        return {};
      },
    });
    expect(form.at(-1)!.step).toBe("fault.failed");
    expect(String(form.at(-1)!.params.code)).toMatch(/^UNEXPECTED_[A-Z_]+$/);
    expect(form.at(-1)!.params.code).not.toBe("UNEXPECTED_PRINCIPAL_SIGNATURE_PENDING");
    // 5xx и отказ самого клиента ПАО — не защита, даже с объявленным кодом в теле.
    for (const [e, code] of [
      [paoError(503, "PRINCIPAL_SIGNATURE_PENDING"), "PRINCIPAL_SIGNATURE_PENDING"],
      [paoError(302, undefined, "PAO_CLIENT_REDIRECT"), "PAO_CLIENT_REDIRECT"],
      [paoError(0), "NO_RESPONSE"],
    ] as const) {
      const s = await once("Н-07", {
        expect: ["PRINCIPAL_SIGNATURE_PENDING"],
        run: async (c) => {
          c.mark({ mandate_id: "mnd_probe7c" });
          throw e;
        },
      });
      expect(s.at(-1), code).toMatchObject({ step: "fault.failed", params: { code } });
    }
    // Код защиты витрины (ответ не через клиент ПАО) — тем же правилом: объявлен — «сработала», нет — «не разыграно».
    const shop = { run: async (c: Parameters<FaultBranch["run"]>[0]) => (c.mark({ mandate_id: "mnd_probe1" }), { code: "ORDER_NOT_PAYABLE", status: 409 }) };
    expect((await once("Н-01", { expect: ["ORDER_NOT_PAYABLE"], ...shop })).at(-1)).toMatchObject({ step: "fault.refused", params: { code: "ORDER_NOT_PAYABLE" } });
    expect((await once("Н-01", { expect: ["PACKAGE_MISMATCH"], ...shop })).at(-1)).toMatchObject({ step: "fault.failed", params: { code: "UNEXPECTED_ORDER_NOT_PAYABLE" } });
  });

  it("стенд не принял пометку — «не разыграно» MARK_REJECTED, запроса нет, процесс не падает (ревью П-11.3а № 1)", async () => {
    const callsFrom = demo.stand.stand.calls().length;
    const s = await once("Н-06", {
      expect: [],
      run: async (c) => {
        c.mark({ mandate_id: "" });
        await c.call("GET /pao/v1/agent", {});
        return {};
      },
    });
    expect(s.at(-1)).toMatchObject({ step: "fault.failed", params: { test: "Н-06", code: "MARK_REJECTED" } });
    expect(demo.stand.stand.calls().slice(callsFrom).some((c) => c.path === "/pao/v1/agent")).toBe(false);
  });

  it("на шину из ветки — только тест, код, статус и идентификаторы стенда: криптограмма и токен отброшены (ревью № 7, инвариант 1)", async () => {
    const s = await once("Н-09", {
      expect: [],
      run: async (c) => {
        c.mark({ mandate_id: "mnd_probe9", shop_id: "SHOP-1", order_ref: "ord_ref_1" });
        c.step("fault.note", { cryptogram: "crypt_SECRET", token_ref: "tok_SECRET", code: "X", status: 1, merchant_id: "m_1" });
        return {};
      },
    });
    const note = s.find((x) => x.step === "fault.note")!;
    expect(note.params).toEqual({ test: "Н-09", code: "X", status: 1, merchant_id: "m_1" });
    expect(JSON.stringify(demo.bus.history())).not.toContain("SECRET");
    // Все поля пометки стенда — в шаге итога (ревью № 10).
    expect(s.at(-1)!.params).toMatchObject({ mandate_id: "mnd_probe9", shop_id: "SHOP-1", order_ref: "ord_ref_1" });
    expect([...ID_FIELDS].sort()).toEqual(["confirmation_id", "mandate_id", "merchant_id", "op_ref", "order_id", "order_ref", "shop_id"]);
  });

  it("метка прогона: «Контроль» режет ленту на прогон нарушителя без паспорта — он не приклеивается к прогону сюжета (ревью П-11.3а № 3)", async () => {
    const from = demo.bus.history().length;
    // Прогон сюжета (метка run.intent), затем нарушение — в одном срезе ленты.
    expect((await post("/scenario/intent")).status).toBe(202);
    for (let i = 0; i < 100 && !steps().some((x) => x.step === "intent.awaiting_signature"); i++) await pause(50);
    expect((await post("/scenario/abort")).status).toBe(202);
    await demo.scenarios.settled();
    await once("Н-05", { expect: [], run: async (c) => (c.mark({ mandate_id: "mnd_probe5r" }), {}) });
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
    expect(runs[1]!.items.filter((i) => i.stream === "scenario").map((i) => i.ref)).toEqual(["run.fault", "fault.marked"]);
  });

  it("взаимная блокировка: пока идёт нарушение, сюжет не стартует, и наоборот (ревью П-11.3а № 4)", async () => {
    let release!: () => void;
    const gate = new Promise<void>((ok) => (release = ok));
    const d = driver({
      "Н-09": {
        expect: [],
        run: async (c) => {
          c.mark({ mandate_id: "mnd_probe9b" });
          await gate;
          return {};
        },
      },
    });
    expect(d.start("Н-09")).toEqual({ ok: true });
    expect(d.start("Н-09")).toEqual({ ok: false, code: "BUSY" });
    const sc = new DemoScenarios(demo.stand, () => undefined, { otherBusy: () => d.busy });
    expect(sc.start("intent")).toEqual({ ok: false, code: "BUSY" });
    release();
    await d.settled();
    // Сюжет идёт (ждёт подписи поручения) — драйвер демо отвечает BUSY.
    expect((await post("/scenario/intent")).status).toBe(202);
    expect(demo.faulty!.start("Н-07")).toEqual({ ok: false, code: "BUSY" });
    expect((await post(`/fault/${enc("Н-07")}`)).status).toBe(409);
    expect((await post("/scenario/abort")).status).toBe(202);
    await demo.scenarios.settled();
  });

  it("закрытие: ветка, послушная отмене, кончается без шагов и запросов; зависшая — не дольше срока; после — CLOSED и свободен (ревью № 6, № 8, № 9, № 11)", async () => {
    // Послушная: ждёт отмены, потом пробует запрос — он не уходит, шагов итога нет.
    const callsFrom = demo.stand.stand.calls().length;
    const d = driver(
      {
        "Н-01": {
          expect: [],
          run: async (c) => {
            c.mark({ mandate_id: "mnd_probe1c" });
            await new Promise<void>((ok) => c.signal.addEventListener("abort", () => ok(), { once: true }));
            await c.call("GET /pao/v1/agent", {});
            return {};
          },
        },
      },
      200,
    );
    expect(d.start("Н-01")).toEqual({ ok: true });
    const n = steps().length;
    await d.close();
    await pause(50);
    expect(steps().slice(n)).toEqual([]);
    expect(demo.stand.stand.calls().slice(callsFrom).some((c) => c.path === "/pao/v1/agent")).toBe(false);
    expect(d.start("Н-01")).toEqual({ ok: false, code: "CLOSED" });
    // Зависшая: ответ, который не придёт, — закрытие не дольше срока, драйвер больше не занят.
    const h = driver({ "Н-01": { expect: [], run: async (c) => (c.mark({ mandate_id: "mnd_probe1h" }), await new Promise<never>(() => undefined)) } }, 200);
    expect(h.start("Н-01")).toEqual({ ok: true });
    const t0 = Date.now();
    await h.close();
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(h.busy).toBe(false);
  });

  it("тексты шагов — с пометкой «нарушитель (ПР)», ru и en", () => {
    for (const step of ["run.fault", "fault.refused", "fault.marked", "fault.failed"])
      for (const lang of ["ru", "en"] as const) expect((MESSAGES[lang] as Record<string, string>)[`step.${step}`], `${lang} ${step}`).toMatch(/\(ПР\)/);
  });

  it("ключ не выходит из драйвера (П7 п. 5): ни на шине, ни в журнале агента и стенда, ни в ответах маршрута", () => {
    const text = JSON.stringify(demo.bus.history()) + JSON.stringify(demo.stand.journal.entries) + JSON.stringify(demo.stand.stand.demo!.log()) + replies.join("");
    expect(text).not.toMatch(/PRIVATE KEY|"d":"/);
    expect(text).not.toContain(demo.stand.keysDir!);
  });
});

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
    // Прямой fetch на ПАО вне драйвера и сборки стенда (печать адреса — не обращение).
    if (name !== "src/demo/stand.ts" && /\bfetch\s*\(/.test(text) && /\burls\.pao\b|\.urls\.pao\b/.test(text)) bad.push(`${name} → fetch на urls.pao`);
  }
  for (const dir of ["src/pult", "src/dashboards", "src/demo/public/pult"])
    for (const f of src.filter((x) => x.startsWith(join(root, dir) + "/"))) if (/faulty|fault-tests|loadKey/.test(readFileSync(f, "utf8"))) bad.push(`${rel(f)} → драйвер`);
  return bad;
}

describe("граница драйвера нарушителя (П7 п. 6, дополнение 1)", () => {
  it("драйвер импортирует только run.ts; клиент ПАО, @kuzin4u/agentic-core, адаптеры ядра, loadKey и fetch на urls.pao — только в драйвере", () => {
    expect(driverBoundary(ROOT)).toEqual([]);
    expect(specifiers(readFileSync(join(ROOT, "src/demo/faulty.ts"), "utf8"))).toContain("@kuzin4u/agentic-core/pao");
    expect(readFileSync(join(ROOT, "src/demo/faulty.ts"), "utf8")).not.toMatch(/\bissuer\b/); // П5 п. 5
  });

  it("поломки ловятся на временном дереве: клиент ПАО, адаптер ядра, fetch на urls.pao и импорт драйвера вне разрешённых файлов", () => {
    const root = mkdtempSync(join(tmpdir(), "fault-boundary-"));
    try {
      mkdirSync(join(root, "src/demo"), { recursive: true });
      mkdirSync(join(root, "src/pult"), { recursive: true });
      writeFileSync(join(root, "src/demo/faulty.ts"), `import { PaoClient } from "@kuzin4u/agentic-core/pao";\nexport const x = PaoClient;\n`);
      writeFileSync(join(root, "src/demo/run.ts"), `import { x } from "./faulty.js";\nexport const y = x;\n`);
      writeFileSync(join(root, "src/demo/bad.ts"), `import { PaoClient } from "@kuzin4u/agentic-core/pao";\nimport { PaoPlatform } from "agentic-buyer-ref/src/agent/adapters/pao/index.js";\nexport const z = [PaoClient, PaoPlatform];\n`);
      writeFileSync(join(root, "src/demo/raw.ts"), `export const go = (d: { urls: { pao: string } }) => fetch(d.urls.pao + "/pao/v1/agent");\n`);
      writeFileSync(join(root, "src/pult/p.ts"), `import { x } from "../demo/faulty.js";\nexport const p = x;\n`);
      expect(driverBoundary(root)).toEqual(
        expect.arrayContaining([
          "src/demo/bad.ts → @kuzin4u/agentic-core",
          "src/demo/bad.ts → адаптер ядра",
          "src/demo/raw.ts → fetch на urls.pao",
          "src/pult/p.ts → faulty",
          "src/pult/p.ts → драйвер",
        ]),
      );
      expect(driverBoundary(root).some((v) => v.startsWith("src/demo/faulty.ts") || v.startsWith("src/demo/run.ts"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
