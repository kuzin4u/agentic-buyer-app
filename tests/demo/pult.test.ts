// П-1.1 (модель пульта 1.23, Р-1318, Р-1332 в. 2): страница пульта на живом стенде — ru/en, бренд из конфигурации, CSP
// 'self', четыре панели, раскладка «сетка / вкладки»; переключатель «Пульт · Экран · Монитор» на всех страницах; лента
// /pult/events отдаёт состояние; скрипт пульта выводит данные только через textContent (инвариант 4).
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PANES, PULT, SWITCH } from "../../src/pult/phrases.js";
import { startDemo, type Demo } from "../../src/demo/run.js";

async function firstSse(url: string, ms = 10_000): Promise<unknown> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ms);
  let text = "";
  try {
    const res = await fetch(url, { signal: ac.signal });
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    while (!text.includes("\n\n")) {
      const { value, done } = await reader.read();
      if (done) break;
      text += dec.decode(value, { stream: true });
    }
    await reader.cancel();
  } finally {
    clearTimeout(timer);
    ac.abort();
  }
  return JSON.parse(text.split("\n\n")[0]!.replace(/^data: /, ""));
}

describe("пульт: каркас (П-1.1)", { timeout: 60_000 }, () => {
  let demo: Demo;

  beforeAll(async () => {
    demo = await startDemo();
  }, 60_000);
  afterAll(async () => {
    await demo?.close();
  });

  it("страница ru и en: заголовок, бренд, CSP 'self', четыре панели с кнопкой разворота, раскладка, переключатель языка", async () => {
    const brand = JSON.parse(readFileSync("config/brand.demo.json", "utf8")) as { name: string };
    for (const lang of ["ru", "en"] as const) {
      const res = await fetch(`${demo.monitor.url}/pult?lang=${lang}`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-security-policy")).toContain("default-src 'self'");
      const html = await res.text();
      expect(html).toContain(`<html lang="${lang}">`);
      expect(html).toContain(`<h1>${PULT.title[lang]}</h1>`);
      expect(html).toContain(brand.name);
      for (const p of PANES) {
        expect(html).toContain(`id="p-${p}"`);
        expect(html).toContain(`data-max="${p}"`);
        expect(html).toContain(`data-tab="${p}"`);
        expect(html).toContain(PULT[`pane.${p}`][lang]);
      }
      expect(html).toContain(`data-layout="grid"`);
      expect(html).toContain(`data-layout="tabs"`);
      expect(html).toContain(`href="/pult?lang=${lang === "ru" ? "en" : "ru"}"`);
      expect(html).toContain(`role="status"`);
      // Без inline-скриптов и стилей: <script> — только файл (src) или JSON словаря (ревью П-1.1 № 11).
      for (const tag of html.match(/<script\b[^>]*>/g) ?? []) expect(tag).toMatch(/\bsrc="|type="application\/json"/);
      expect(html).not.toMatch(/<style|style="/);
      expect(res.headers.get("content-security-policy")).not.toContain("unsafe-inline");
    }
  });

  it("переключатель «Пульт · Экран · Монитор» — на пульте, обоих экранах и мониторе; текущая страница — без ссылки", async () => {
    const pages = [
      ["/pult", SWITCH.pult],
      ["/dash/interpret", SWITCH["screen.interpret"]],
      ["/dash/control", SWITCH["screen.control"]],
      ["/", SWITCH.monitor],
    ] as const;
    for (const lang of ["ru", "en"] as const) {
      for (const [path, own] of pages) {
        const html = await (await fetch(`${demo.monitor.url}${path}?lang=${lang}`)).text();
        // Проверки — внутри самого переключателя, а не по всей странице (ревью П-1.1 № 9, № 10).
        const sw = html.match(/<span class="view-switch"[^>]*>[^]*?<\/span>/)?.[0];
        expect(sw, path).toBeDefined();
        expect(sw!.match(/aria-current="page"/g), path).toHaveLength(1);
        expect(sw, path).toContain(`<strong aria-current="page">${own[lang]}</strong>`);
        for (const [target] of pages) {
          const link = `href="${target}?lang=${lang}"`;
          if (target === path) expect(sw, `${path} → ${target}`).not.toContain(link);
          else expect(sw, `${path} → ${target}`).toContain(link);
        }
      }
    }
  });

  it("скрипт и стили пульта отдаются файлами; скрипт не собирает разметку из строк (инвариант 4)", async () => {
    const js = await fetch(`${demo.monitor.url}/pult/pult.js`);
    expect(js.status).toBe(200);
    expect(js.headers.get("content-type")).toContain("text/javascript");
    const src = await js.text();
    expect(src).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function/);
    expect(src).toContain("textContent");
    const css = await fetch(`${demo.monitor.url}/pult/pult.css`);
    expect(css.status).toBe(200);
    expect(css.headers.get("content-type")).toContain("text/css");
  });

  it("лента /pult/events: первое сообщение — состояние шины", async () => {
    const hello = (await firstSse(`${demo.monitor.url}/pult/events`)) as { type: string; status: string };
    expect(hello.type).toBe("hello");
    expect(["connecting", "open"]).toContain(hello.status);
  });

  it("словарь пульта: у каждой подписи есть ru и en, непустые", () => {
    for (const dict of [PULT, SWITCH]) {
      for (const [k, v] of Object.entries(dict)) {
        expect(v.ru.trim(), k).not.toBe("");
        expect(v.en.trim(), k).not.toBe("");
      }
    }
  });
});
