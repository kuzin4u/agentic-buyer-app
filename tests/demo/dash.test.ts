// К1.4 DEMO-2 ч. 1: экран «Интерпретация» на живом стенде — страница ru/en с брендом, без данных шины в разметке;
// лента /dash/interpret/events — интерпретации записей шины через адаптер источника; скрипт выводит данные только
// через textContent (инвариант 4); заголовки карточек С-xx — из библиотеки ситуаций.
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Interpretation } from "../../src/dashboards/interpret.js";
import { loadSituationTitles, parseSituationTitles } from "../../src/demo/situations.js";
import { startDemo, type Demo } from "../../src/demo/run.js";
import { driver } from "./drive.js";

async function readSse(url: string, until: (text: string) => boolean, ms = 10_000): Promise<string> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ms);
  let text = "";
  try {
    const res = await fetch(url, { signal: ac.signal });
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    while (!until(text)) {
      const { value, done } = await reader.read();
      if (done) break;
      text += dec.decode(value, { stream: true });
    }
    ac.abort();
  } catch (e) {
    if (!ac.signal.aborted) throw e;
  } finally {
    clearTimeout(timer);
  }
  return text;
}

const messages = (text: string) =>
  text
    .split("\n\n")
    .filter((b) => b.startsWith("data: "))
    .map((b) => JSON.parse(b.slice(6)) as { type: string; items?: Interpretation[]; item?: Interpretation });

describe("экран «Интерпретация»", { timeout: 90_000 }, () => {
  let demo: Demo;
  let mandateId = "";

  beforeAll(async () => {
    demo = await startDemo();
    await driver(demo).run(1);
    const signed = demo.bus.history().find((i) => i.stream === "scenario" && i.line.step === "intent.signed");
    mandateId = signed && signed.stream === "scenario" ? String(signed.line.params.mandate_id) : "";
  }, 60_000);
  afterAll(async () => {
    await demo?.close();
  });

  it("страница ru и en: заголовок, бренд из конфигурации, CSP 'self', переключатель языка; данных шины в разметке нет", async () => {
    const brand = JSON.parse(readFileSync("config/brand.demo.json", "utf8")) as { name: string };
    const ru = await fetch(`${demo.monitor.url}/dash/interpret?lang=ru`);
    expect(ru.status).toBe(200);
    expect(ru.headers.get("content-security-policy")).toContain("default-src 'self'");
    const html = await ru.text();
    expect(html).toContain("<h1>Интерпретация</h1>");
    expect(html).toContain(brand.name);
    expect(html).toContain('href="/dash/interpret?lang=en"');
    // Встроенных скриптов нет: у каждого <script> — src или type="application/json" (CSP 'self', ревью К1.4 № 3).
    const scripts = [...html.matchAll(/<script\b[^>]*>/gi)].map((m) => m[0]);
    expect(scripts.length).toBe(2);
    for (const s of scripts) expect(s).toMatch(/\ssrc="\/dash\/interpret\.js"|type="application\/json"/);
    expect(ru.headers.get("content-security-policy")).not.toContain("unsafe-inline");
    expect(mandateId).toMatch(/^mnd_/);
    expect(html).not.toContain(mandateId);
    const en = await (await fetch(`${demo.monitor.url}/dash/interpret?lang=en`)).text();
    expect(en).toContain("<h1>Interpretation</h1>");
    expect(en).toContain('"stage.mandate":"Mandate"');
  });

  it("монитор ссылается на экран; скрипт и стили экрана отдаются; скрипт не собирает разметку из строк (инвариант 4)", async () => {
    expect(await (await fetch(`${demo.monitor.url}/?lang=en`)).text()).toContain('href="/dash/interpret?lang=en"');
    const js = await fetch(`${demo.monitor.url}/dash/interpret.js`);
    expect(js.headers.get("content-type")).toContain("text/javascript");
    const css = await fetch(`${demo.monitor.url}/dash/dash.css`);
    expect(css.status).toBe(200);
    const src = readFileSync("src/demo/public/dash/interpret.js", "utf8");
    expect(src).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function/);
    expect(src).toContain("textContent");
  });

  it("лента: снимок интерпретаций сюжета 1 — фразы ru/en, стадия «поручение», норма, С-01; не через POST", async () => {
    const text = await readSse(`${demo.monitor.url}/dash/interpret/events`, (t) => t.includes('"type":"snapshot"') && t.includes("\n\n"));
    const snap = messages(text).find((m) => m.type === "snapshot")!;
    expect(snap).toMatchObject({ status: "open", diag: { state: "ready" } });
    // Метка начала прогона (К2.3а) — служебная стадия, её здесь не считаем.
    const key = snap.items!.filter((r) => r.level === "key" && !r.ref.startsWith("run."));
    expect(key.length).toBeGreaterThan(3);
    expect(key.every((r) => r.kind === "norm" && r.stage === "mandate")).toBe(true);
    expect(key.some((r) => r.situation === "С-01" && r.phrase.ru.length > 0 && r.phrase.en.length > 0)).toBe(true);
    expect((await fetch(`${demo.monitor.url}/dash/interpret/events`, { method: "POST" })).status).toBe(405);
  });

  it("живая доставка: после снимка новый шаг сюжета приходит событием item с новым seq (ревью К1.4 № 2)", async () => {
    const before = Math.max(...demo.bus.history().map((i) => (i.stream === "monitor" ? i.event.seq : i.line.seq)));
    // Сюжет — только после того, как снимок пришёл: иначе новые записи попали бы в снимок, а не в item (второй проход № 1).
    let snapshotSeen!: () => void;
    const gotSnapshot = new Promise<void>((r) => (snapshotSeen = r));
    const pending = readSse(
      `${demo.monitor.url}/dash/interpret/events`,
      (t) => {
        if (t.includes('"type":"snapshot"')) snapshotSeen();
        return messages(t).some((m) => m.type === "item" && m.item!.seq > before && m.item!.stream === "scenario" && !m.item!.ref.startsWith("run."));
      },
      30_000,
    );
    await gotSnapshot;
    await driver(demo).run(1);
    // Шаг сюжета после метки прогона (К2.3а); до его номера шина дочитывает журналы (З4), их записи могут прийти раньше.
    const item = messages(await pending).find((m) => m.type === "item" && m.item!.seq > before && m.item!.stream === "scenario" && !m.item!.ref.startsWith("run."));
    expect(item?.item).toMatchObject({ stage: "mandate", kind: "norm" });
  });

  it("К1.4а, З4 / R.1: порядок строк до и после перезагрузки одинаков — живая лента сюжета 2 и снимок нового подключения", async () => {
    let snapshotSeen!: () => void;
    const gotSnapshot = new Promise<void>((r) => (snapshotSeen = r));
    const done = (t: string) => messages(t).some((m) => m.type === "item" && m.item!.stream === "scenario" && m.item!.stage === "outcome");
    const pending = readSse(
      `${demo.monitor.url}/dash/interpret/events`,
      (t) => {
        if (t.includes('"type":"snapshot"')) snapshotSeen();
        return done(t);
      },
      60_000,
    );
    await gotSnapshot;
    await driver(demo).run(2);
    const live = messages(await pending);
    // Экран до перезагрузки: снимок плюс живые записи, по месту seq (как вставляет скрипт экрана).
    const before = [...live.find((m) => m.type === "snapshot")!.items!, ...live.filter((m) => m.type === "item").map((m) => m.item!)].sort((a, b) => a.seq - b.seq);
    // Ленту экран получает до конца сюжета; шаги после итога дождаться вторым чтением не нужно — сравнение по общему префиксу.
    const last = before[before.length - 1]!.seq;
    // F5: новое подключение — снимок.
    const after = messages(await readSse(`${demo.monitor.url}/dash/interpret/events`, (t) => t.includes('"type":"snapshot"') && t.includes("\n\n")))
      .find((m) => m.type === "snapshot")!
      .items!.filter((r) => r.seq <= last);
    const view = (list: readonly Interpretation[]) => list.map((r) => `${r.seq} ${r.phrase.ru}`);
    expect(view(after)).toEqual(view(before));
    for (let i = 1; i < after.length; i++) expect(after[i]!.seq).toBeGreaterThan(after[i - 1]!.seq);
  });

  it("чужой Host — 421 и на маршрутах экрана (DNS rebinding); close() закрывает открытую ленту экрана со стороны сервера (№ 4)", async () => {
    const port = new URL(demo.monitor.url).port;
    const { request } = await import("node:http");
    const status = (path: string) =>
      new Promise<number>((ok, fail) => {
        const r = request({ host: "127.0.0.1", port, path, headers: { host: `evil.example:${port}` } }, (res) => {
          res.resume();
          ok(res.statusCode ?? 0);
        });
        r.on("error", fail);
        r.end();
      });
    expect(await status("/dash/interpret")).toBe(421);
    expect(await status("/dash/interpret/events")).toBe(421);

    const own = await startDemo({ passMs: 0 });
    let ended: Promise<boolean> | undefined;
    try {
      const res = await fetch(`${own.monitor.url}/dash/interpret/events`);
      const reader = res.body!.getReader();
      await reader.read(); // снимок
      ended = (async () => {
        for (;;) if ((await reader.read()).done) return true;
      })();
    } finally {
      await own.close(); // стенд закрывается и при упавшем ожидании (второй проход № 2)
    }
    expect(await ended).toBe(true);
  });

  it("close() стенда с открытой лентой экрана после сюжетов 1 и 2 — не дольше 2 с (CI К1.4: зависание на Node 20 и 22; К1.4б)", async () => {
    // Сюжет 2 — с оплатой: в CI e1fd41c зависали наборы с оплатой, а набор только с сюжетом 1 проходил (ревью К1.4б № 1).
    // Сюжеты завершены (driver ждёт settled) — ожидание сюжетов в close() (до 3 с) замер не задевает (№ 5).
    const own = await startDemo();
    const limit = <T>(p: Promise<T>, what: string) =>
      Promise.race([
        p,
        new Promise<never>((_, fail) => setTimeout(() => fail(new Error(`${what}: дольше 3 с`)), 3000).unref()),
      ]);
    let closed = false;
    try {
      const d = driver(own);
      await d.run(1);
      await d.run(2);
      const res = await fetch(`${own.monitor.url}/dash/interpret/events`);
      const reader = res.body!.getReader();
      await reader.read(); // снимок — лента открыта
      // Конец ленты — нормальный (done), а не обрыв соединения (мягкое закрытие, Р-1336).
      const reading = (async () => {
        for (;;) if ((await reader.read()).done) return "done";
      })().catch((e: unknown) => `ошибка: ${String(e)}`);
      const t0 = Date.now();
      await limit(own.close(), "close()"); // зависание — быстрый отказ, а не тайм-аут describe (№ 4)
      closed = true;
      expect(Date.now() - t0).toBeLessThanOrEqual(2000);
      expect(await limit(reading, "конец ленты экрана")).toBe("done");
    } finally {
      if (!closed) void own.close().catch(() => undefined);
    }
  });

  it("словарь экрана полон: каждый ключ, который берёт скрипт, есть в ru и en (ревью К1.4 № 5)", async () => {
    const { STAGES, ROLES, KINDS } = await import("../../src/dashboards/interpret.js");
    const src = readFileSync("src/demo/public/dash/interpret.js", "utf8");
    const literal = [...src.matchAll(/label\("([a-z_.]+)"\)/g)].map((m) => m[1]!);
    const keys = [
      ...literal,
      ...STAGES.map((s) => `stage.${s}`),
      ...[...ROLES, "environment"].map((s) => `role.${s}`),
      ...KINDS.map((s) => `kind.${s}`),
      ...["expected", "failure", "unknown", "owner"].map((s) => `verdict.${s}`),
      ...["connecting", "open", "reset", "closed", "screen_offline"].map((s) => `status.${s}`),
      ...["loading", "ready", "failed"].map((s) => `diag.${s}`),
    ];
    // Обрыв связи экрана — через setStatus("screen_offline") (З7), ключ — в перечне статусов выше.
    expect(literal).toEqual(expect.arrayContaining(["who.side", "who.none", "pending", "emulated", "situation.label", "training"]));
    for (const lang of ["ru", "en"]) {
      const html = await (await fetch(`${demo.monitor.url}/dash/interpret?lang=${lang}`)).text();
      const cfg = JSON.parse(/<script id="i18n" type="application\/json">(.*?)<\/script>/s.exec(html)![1]!) as { labels: Record<string, string> };
      for (const k of keys) expect(Object.hasOwn(cfg.labels, k), `${lang}: ${k}`).toBe(true);
    }
  });

  it("заголовки карточек — из библиотеки: 28 карточек С-01…С-28", () => {
    const t = loadSituationTitles();
    expect(Object.keys(t)).toHaveLength(28);
    expect(t["С-26"]).toBe("Банк поставил клиенту лимит ниже суммы покупки");
    expect(parseSituationTitles("| С-01 | А | б | в |\n| С-01 | повтор | б | в |")).toEqual({ "С-01": "А" });
  });
});
