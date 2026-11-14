// П-9.2: справка пульта — тексты (`src/pult/help.ts`) и окно (`public/pult/help.js`) на подменённом DOM вместе с настоящими
// `pult.js`, `feeds.js`, `keys.js` (разметка — `pultPage`). По панели — строки ru/en; клавиши — по принятой раскладке; «пульт —
// в одной вкладке» (Р-1530); переключатель клавиш (WCAG 2.1.4) выключает клавиши; Esc закрывает окно, а не поднимает фокус.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { pultPage } from "../../src/demo/dash-pult.js";
import { loadBrand } from "../../src/demo/server.js";
import { HELP_GENERAL, HELP_KEYS, HELP_LABELS, HELP_PANES, helpForPage } from "../../src/pult/help.js";
import { PANES } from "../../src/pult/phrases.js";
import { FakeEvent, pageEnv, type PageEnv } from "../support/fake-dom.js";

const read = (f: string) => readFileSync(`src/demo/public/pult/${f}`, "utf8");
const { brand } = loadBrand("config/brand.demo.json");

function start(lang: "ru" | "en" = "ru", o: Parameters<typeof pageEnv>[1] = {}): PageEnv {
  const env = pageEnv(pultPage(lang, brand, false), o);
  for (const f of ["focus.js", "pult.js", "feeds.js", "help.js", "keys.js"]) env.run(read(f));
  return env;
}
const key = (env: PageEnv, k: string, target?: { dispatchEvent(e: FakeEvent): unknown }) => {
  const e = new FakeEvent("keydown", { key: k, bubbles: true });
  (target ?? env.document).dispatchEvent(e);
  return e;
};
const dialog = (env: PageEnv) => env.document.getElementById("pult-help-dialog")!;

describe("справка пульта — тексты (П-9.2)", () => {
  it("у каждой панели — 2–5 строк, ru и en непустые; у каждой клавиши раскладки — строка; без кодов задач", () => {
    expect(Object.keys(HELP_PANES)).toEqual([...PANES]);
    const all = [...Object.values(HELP_PANES).flat(), ...HELP_GENERAL, ...HELP_KEYS.flatMap((k) => [k.key, k.what]), ...Object.values(HELP_LABELS)];
    for (const t of all)
      for (const l of ["ru", "en"] as const) {
        expect(t[l].trim(), JSON.stringify(t)).not.toBe("");
        expect(t[l], JSON.stringify(t)).not.toMatch(/П-\d|Р-\d{3,}|PR #|\bTODO\b/);
      }
    for (const lines of Object.values(HELP_PANES)) expect(lines.length).toBeGreaterThanOrEqual(2);
    // Раскладка — STATUS «Открыто» (Р-1523 В13 (а)).
    expect(HELP_KEYS.map((k) => k.key.ru)).toEqual(["1–4", "5–6", "7–8", "?", "пробел", "Esc"]);
    expect(helpForPage("en").general[0]).toMatch(/one tab/);
    expect(helpForPage("ru").general[0]).toMatch(/одной вкладке/);
  });
});

describe("окно справки на подменённом DOM (П-9.2)", () => {
  it("«?» открывает окно (фокус на «Закрыть»), повторный «?» закрывает; кнопка «Справка» открывает; данные — текстом", () => {
    const env = start();
    expect(dialog(env).hidden).toBe(true);
    key(env, "?");
    expect(dialog(env).hidden).toBe(false);
    expect(env.document.activeElement).toBe(dialog(env).querySelector(".help-close"));
    expect(dialog(env).textContent).toContain("Пульт — в одной вкладке");
    expect(dialog(env).textContent).toContain("Ход");
    expect(dialog(env).querySelector("script")).toBeNull();
    key(env, "?");
    expect(dialog(env).hidden).toBe(true);
    env.document.querySelector("[data-help]")!.click();
    expect(dialog(env).hidden).toBe(false);
  });

  it("Esc в окне закрывает окно и возвращает фокус; событие отменено — фокус пульта не поднимается", () => {
    const env = start();
    const btn = env.document.querySelector("[data-help]")!;
    btn.focus();
    btn.click();
    const e = key(env, "Escape", dialog(env).querySelector(".help-close")!);
    expect(e.defaultPrevented).toBe(true);
    expect(dialog(env).hidden).toBe(true);
    expect(env.document.activeElement).toBe(btn);
  });

  it("переключатель клавиш: выключил — клавиши не действуют и выбор помнится; включил — снова действуют", () => {
    const env = start();
    const grid = env.document.getElementById("grid")!;
    env.document.querySelector("[data-help]")!.click();
    const toggle = env.document.getElementById("pult-keys-on")! as unknown as { checked: boolean; dispatchEvent(e: FakeEvent): unknown };
    expect(toggle.checked).toBe(true);
    toggle.checked = false;
    toggle.dispatchEvent(new FakeEvent("change", { bubbles: true }));
    expect(env.storage.get("pult.keys.v1")).toBe(JSON.stringify({ on: false }));
    env.document.querySelector(".help-close")!.click(); // закрыть справку: при открытой клавиши молчат и так
    key(env, "2");
    expect(grid.classList.contains("max")).toBe(false);
    env.document.querySelector("[data-help]")!.click();
    expect(toggle.checked).toBe(false); // выбор помнится
    toggle.checked = true;
    toggle.dispatchEvent(new FakeEvent("change", { bubbles: true }));
    env.document.querySelector(".help-close")!.click();
    key(env, "2");
    expect(grid.classList.contains("max")).toBe(true);
  });

  it("ревью № 2: пока справка открыта — фон inert, цифры и пробел не действуют; закрыли — inert снят, клавиши снова действуют", () => {
    const env = start();
    const grid = env.document.getElementById("grid")!;
    const main = env.document.querySelector("main")!;
    key(env, "?");
    expect(main.hasAttribute("inert")).toBe(true);
    const got: unknown[] = [];
    env.document.addEventListener("pult:pause", (e: FakeEvent) => got.push(e.detail));
    key(env, "2");
    key(env, " ");
    expect(grid.classList.contains("max")).toBe(false);
    expect(got).toEqual([]);
    key(env, "?");
    expect(main.hasAttribute("inert")).toBe(false);
    key(env, "2");
    expect(grid.classList.contains("max")).toBe(true);
  });

  it("ревью № 1: справка «Журнала» не обещает того, чего на панели нет", () => {
    for (const l of ["ru", "en"] as const) expect(HELP_PANES.log.map((t) => t[l]).join(" ")).toMatch(/позже|later/);
  });

  it("en: заголовок и строки — на английском", () => {
    const env = start("en");
    key(env, "?");
    expect(dialog(env).textContent).toContain("Console help");
    expect(dialog(env).textContent).toContain("Keep the console in one tab");
  });
});
