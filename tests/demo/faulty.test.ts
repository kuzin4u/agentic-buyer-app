// П-11.3а (П7, Р-1480, Р-1482): каркас драйвера нарушителя «ПР» — только при DEMO_FAULTS=1, ключ агента приложения,
// пометка на стенде, маршрут /fault/<Н-xx> по образцу кнопок сюжетов; граница импортов. Ветки нарушений — П-11.3б–д.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ScenarioLine } from "../../src/demo/bus.js";
import { FAULT_TESTS } from "../../src/demo/fault-tests.js";
import { FaultyDriver } from "../../src/demo/faulty.js";
import { MESSAGES } from "../../src/demo/i18n.js";
import { startDemo, type Demo } from "../../src/demo/run.js";
import { specifiers } from "../dashboards/boundary.test.js";

const ROOT = resolve(import.meta.dirname, "../..");
const filesUnder = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? filesUnder(p) : /\.(ts|js)$/.test(n) ? [p] : [];
  });
const enc = (test: string) => encodeURIComponent(test);

describe("драйвер нарушителя «ПР» — без режима сбоев его нет (П7 п. 2)", () => {
  let demo: Demo;
  beforeAll(async () => {
    demo = await startDemo();
  }, 30_000);
  afterAll(async () => {
    await demo?.close();
  });

  it("без флага: драйвера и каталога ключей нет, конструктор отказывает, маршрут /fault/* — 404", async () => {
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
  const steps = (): ScenarioLine[] => demo.bus.history().flatMap((i) => (i.stream === "scenario" ? [i.line] : []));
  // origin: строка — заголовок Origin; null — без заголовка.
  const post = (path: string, origin: string | null = demo.monitor.url) =>
    fetch(`${demo.monitor.url}${path}`, { method: "POST", headers: origin !== null ? { origin } : {} });
  beforeAll(async () => {
    demo = await startDemo({ faults: true });
  }, 30_000);
  afterAll(async () => {
    await demo?.close();
  });

  it("подпись драйвера — ключом агента приложения: Платформа принимает (GET /pao/v1/agent — ACTIVE)", async () => {
    expect(demo.faulty).toBeDefined();
    expect(await demo.faulty!.self()).toBe("ACTIVE");
    // Обращение — тем же ключом, что у агента (Н-тесты ждут «нарушил: агент»).
    const last = demo.stand.stand.calls().filter((c) => c.path === "/pao/v1/agent").at(-1)!;
    expect(last.status).toBe(200);
    expect(last.kid !== undefined && demo.stand.isAgentKid(last.kid)).toBe(true);
  });

  it("маршрут: только POST, только с Origin монитора, имя — только из перечня; ветки нет — 409 NOT_READY", async () => {
    expect((await post(`/fault/${enc("Н-07")}`, null)).status).toBe(403);
    expect((await post(`/fault/${enc("Н-07")}`, "http://evil.example")).status).toBe(403);
    expect((await fetch(`${demo.monitor.url}/fault/${enc("Н-07")}`)).status).toBe(404); // только POST: GET маршрута нет
    expect((await post(`/fault/${enc("Н-02")}`)).status).toBe(404); // сбой стенда «П», не «ПР»
    expect((await post("/fault/%E0%A4%A")).status).toBe(400);
    const r = await post(`/fault/${enc("Н-07")}`);
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ ok: false, code: "NOT_READY" });
  });

  it("ветка нарушения: пометка «ПР» на стенде (MARKED с ids), шаги с пометкой на шине; занят — BUSY", async () => {
    const n = steps().length;
    let release!: () => void;
    const gate = new Promise<void>((ok) => (release = ok));
    const d = new FaultyDriver(demo.stand, (s) => demo.bus.scenario(s), {
      "Н-07": async (c) => {
        c.step("fault.probe");
        await gate;
        return { ids: { mandate_id: "mnd_probe" }, code: "PRINCIPAL_SIGNATURE_PENDING", status: 409 };
      },
    });
    expect(d.start("Н-07")).toEqual({ ok: true });
    expect(d.start("Н-07")).toEqual({ ok: false, code: "BUSY" });
    release();
    await d.settled();
    const log = demo.stand.stand.demo!.log();
    expect(log.some((e) => e.what === "MARKED" && e.test === "Н-07" && e.ids?.mandate_id === "mnd_probe")).toBe(true);
    const s = steps().slice(n);
    expect(s.map((x) => x.step)).toEqual(["fault.start", "fault.probe", "fault.refused"]);
    expect(s.at(-1)!.params).toMatchObject({ test: "Н-07", code: "PRINCIPAL_SIGNATURE_PENDING", status: 409, mandate_id: "mnd_probe" });
    // Тексты шагов — с пометкой «нарушитель (ПР)», ru и en.
    for (const step of ["fault.start", "fault.refused", "fault.marked", "fault.failed"])
      for (const lang of ["ru", "en"] as const) expect((MESSAGES[lang] as Record<string, string>)[`step.${step}`], `${lang} ${step}`).toMatch(/\(ПР\)/);
  });

  it("ключ не выходит из драйвера (П7 п. 5): ни на шине, ни в журнале агента, ни путь к каталогу ключей", () => {
    const text = JSON.stringify(demo.bus.history()) + JSON.stringify(demo.stand.journal.entries);
    expect(text).not.toMatch(/PRIVATE KEY|"d":"/);
    expect(text).not.toContain(demo.stand.keysDir!);
  });
});

describe("граница драйвера нарушителя (П7 п. 6)", () => {
  it("драйвер импортирует только сборка демо-стенда (run.ts); loadKey — только в драйвере; пульт, дашборды и страница пульта его не знают", () => {
    const src = filesUnder(join(ROOT, "src"));
    const importers = src.filter((f) => specifiers(readFileSync(f, "utf8")).some((s) => /(^|\/)faulty\.js$/.test(s))).map((f) => relative(ROOT, f));
    expect(importers).toEqual(["src/demo/run.ts"]);
    const keyUsers = src.filter((f) => /\bloadKey\b/.test(readFileSync(f, "utf8"))).map((f) => relative(ROOT, f));
    expect(keyUsers).toEqual(["src/demo/faulty.ts"]);
    for (const dir of ["src/pult", "src/dashboards", "src/demo/public/pult"])
      for (const f of filesUnder(join(ROOT, dir))) expect(readFileSync(f, "utf8"), relative(ROOT, f)).not.toMatch(/faulty|fault-tests|loadKey/);
  });
});
