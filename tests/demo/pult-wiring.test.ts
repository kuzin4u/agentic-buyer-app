// П-9.4 (Р-1523, В16 (а)): подключение скриптов окна Б на странице пульта — «Ленты» `feeds.js` (П-5.2) после `pult.js`, с
// подписями на языке страницы; клавиши `keys.js` — вместе со справкой П-9.2 (переключатель, WCAG 2.1.4). Файлы отдаются
// сервером как скрипты, без сборки разметки из строк (инвариант 4); CSP `'self'`.
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pultPage } from "../../src/demo/dash-pult.js";
import { feedsLabels } from "../../src/pult/feeds.js";
import { pageEnv } from "../support/fake-dom.js";
import { startDemo, type Demo } from "../../src/demo/run.js";
import { loadBrand } from "../../src/demo/server.js";

const { brand } = loadBrand("config/brand.demo.json");

describe("П-9.4: подключение «Лент» и клавиш на странице пульта", () => {
  it("теги — в порядке focus.js → pult.js → feeds.js, по одному; клавиш до справки нет (WCAG 2.1.4); подписи «Лент» — со страницей", () => {
    for (const lang of ["ru", "en"] as const) {
      const html = pultPage(lang, brand, false);
      const srcs = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
      expect(srcs, lang).toEqual(["/pult/focus.js", "/pult/pult.js", "/pult/feeds.js"]);
      expect(html).toContain('<script id="feeds-i18n" type="application/json">');
      expect(html).toContain(JSON.stringify(feedsLabels(lang)["feeds.view.plain"]));
    }
  });

  it("до первого сообщения ленты «Ленты» показывают подписи страницы, а не ключи (ревью П-9.4 № 1)", () => {
    const env = pageEnv(pultPage("ru", brand, false));
    env.run(readFileSync("src/demo/public/pult/feeds.js", "utf8"));
    const box = env.document.getElementById("int-feeds")!;
    expect(box.textContent).not.toMatch(/feeds\./);
    expect(box.querySelector("[data-feeds-view='plain']")!.textContent).toBe("Простыми словами");
  });
});

describe("П-9.4: сервер отдаёт скрипты окна Б", () => {
  let demo: Demo;
  beforeAll(async () => {
    demo = await startDemo();
  }, 30_000);
  afterAll(async () => {
    await demo?.close();
  });

  it("/pult/feeds.js и /pult/keys.js — 200, text/javascript, без innerHTML и eval; страница пульта — CSP 'self'", async () => {
    for (const p of ["/pult/feeds.js", "/pult/keys.js"]) {
      const r = await fetch(`${demo.monitor.url}${p}`);
      expect(r.status, p).toBe(200);
      expect(r.headers.get("content-type"), p).toContain("text/javascript");
      expect(await r.text(), p).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function/);
    }
    const page = await fetch(`${demo.monitor.url}/pult`);
    // `default-src 'self'` ограничивает и скрипты: отдельного `script-src`, который расширил бы его, нет.
    const csp = page.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("default-src 'self'");
    expect(csp).not.toMatch(/script-src/);
    const html = await page.text();
    expect(html).toContain('<script src="/pult/feeds.js"></script>');
    expect(html).not.toContain('<script src="/pult/keys.js"></script>'); // клавиши — со справкой П-9.2
  });
});
