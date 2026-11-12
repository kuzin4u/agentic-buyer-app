// П-9.1: клавиши пульта `public/pult/keys.js` на подменённом DOM вместе с настоящими `pult.js` и `feeds.js` (разметка —
// `pultPage`). Раскладка — STATUS «Открыто» (Р-1523, В13 (а)): 1–4 — панели, 5–6 — виды «Хода», 7–8 — виды «Контроля»,
// ? — справка, пробел — пауза. Клавиши нажимают существующие кнопки; в полях ввода и с модификаторами — ничего.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { pultPage } from "../../src/demo/dash-pult.js";
import { loadBrand } from "../../src/demo/server.js";
import { feedsLabels } from "../../src/pult/feeds.js";
import { FakeEvent, pageEnv, type PageEnv } from "../support/fake-dom.js";

const read = (f: string) => readFileSync(`src/demo/public/pult/${f}`, "utf8");
const { brand } = loadBrand("config/brand.demo.json");

function start(): PageEnv {
  const env = pageEnv(pultPage("ru", brand, false));
  env.run(read("focus.js"));
  env.run(read("pult.js"));
  env.run(read("feeds.js"));
  env.run(read("keys.js"));
  return env;
}
const key = (env: PageEnv, k: string, o: { target?: { dispatchEvent(e: FakeEvent): unknown }; ctrl?: boolean } = {}) => {
  const e = new FakeEvent("keydown", { key: k, bubbles: true });
  if (o.ctrl) Object.assign(e, { ctrlKey: true });
  (o.target ?? env.document).dispatchEvent(e);
  return e;
};
const pressed = (env: PageEnv, sel: string) => env.document.querySelector(sel)!.getAttribute("aria-pressed");

describe("клавиши пульта (П-9.1)", () => {
  it("1–4 в сетке — развернуть панель, повторно — свернуть; во вкладках — открыть вкладку", () => {
    const env = start();
    const grid = env.document.getElementById("grid")!;
    key(env, "2");
    expect(grid.classList.contains("max")).toBe(true);
    expect(env.document.getElementById("p-ctl")!.classList.contains("is-max")).toBe(true);
    // П-9.4 (ревью П-9.1 № 6): фокус клавиатуры — на заголовок выбранной панели.
    expect(env.document.activeElement).toBe(env.document.getElementById("h-ctl"));
    expect(env.document.getElementById("h-ctl")!.getAttribute("tabindex")).toBe("-1");
    key(env, "2");
    expect(grid.classList.contains("max")).toBe(false);
    // При развёрнутой панели клавиша другой панели разворачивает её.
    key(env, "1");
    key(env, "3");
    expect(env.document.getElementById("p-int")!.classList.contains("is-max")).toBe(true);
    key(env, "3");
    env.document.querySelector("[data-layout='tabs']")!.click();
    key(env, "3");
    expect(pressed(env, "[data-tab='int']")).toBe("true");
    key(env, "4");
    expect(pressed(env, "[data-tab='log']")).toBe("true");
  });

  it("5–6 — виды «Хода», 7–8 — виды «Контроля»; нажатая клавиша не уходит дальше (preventDefault)", () => {
    const env = start();
    expect(key(env, "6").defaultPrevented).toBe(true);
    expect(pressed(env, "[data-mode='graph']")).toBe("true");
    key(env, "5");
    expect(pressed(env, "[data-mode='board']")).toBe("true");
    // Вид «Контроля» `pult.js` перерисовывает с доской «Условий»; решение кнопки — в сохранённом состоянии раскладки.
    const ctlView = () => (JSON.parse(env.storage.get("pult.layout.v1") ?? "{}") as { ctlView?: string }).ctlView;
    key(env, "8");
    expect(ctlView()).toBe("all");
    key(env, "7");
    expect(ctlView()).toBe("prio");
  });

  it("? — событие справки; пробел — пауза вкл. / выкл.: «Ленты» встают, доска на событие паузы не ломается", () => {
    const env = start();
    const got: unknown[] = [];
    env.document.addEventListener("pult:help", (e: FakeEvent) => got.push(["help", e.detail]));
    env.document.addEventListener("pult:pause", (e: FakeEvent) => got.push(["pause", e.detail]));
    env.sources.find((s) => s.url.startsWith("/pult/feeds"))!.send({ type: "hello", labels: feedsLabels("ru") });
    key(env, "?");
    key(env, " ");
    const note = env.document.getElementById("int-feeds")!.querySelector(".feeds-paused")!;
    expect(note.hidden).toBe(false);
    // Доска на паузе (пока П-8.1 её не останавливает) — обычная перерисовка, без ошибок.
    const pultEs = env.sources.find((s) => s.url.startsWith("/pult/events"))!;
    pultEs.send({ type: "board", board: { now: "2026-11-12T12:00:00.000Z", cards: [{ id: "c1", kind: "tx", column: "cart", worst: "norm", order: 1, since: "2026-11-12T12:00:00.000Z" }], jumps: [] } });
    expect(env.document.getElementById("b-proc")!.textContent).toContain("c1");
    key(env, " ");
    expect(note.hidden).toBe(true);
    expect(got).toEqual([
      ["help", { toggle: true }],
      ["pause", { paused: true }],
      ["pause", { paused: false }],
    ]);
  });

  it("ревью № 1–3, 5: клавиши выключены — ничего; кнопка скрытой панели не нажимается; удержание пробела — без паузы и без прокрутки; пауза — от последнего события", () => {
    const off = pageEnv(pultPage("ru", brand, false), { stored: { "pult.keys.v1": JSON.stringify({ on: false }) } });
    for (const f of ["focus.js", "pult.js", "keys.js"]) off.run(read(f));
    key(off, "2");
    expect(off.document.getElementById("grid")!.classList.contains("max")).toBe(false);

    const env = start();
    env.document.querySelector("[data-layout='tabs']")!.click(); // открыт «Ход», «Контроль» скрыт
    const ctlView = () => (JSON.parse(env.storage.get("pult.layout.v1") ?? "{}") as { ctlView?: string }).ctlView;
    key(env, "8");
    expect(ctlView()).not.toBe("all");
    const got: unknown[] = [];
    env.document.addEventListener("pult:pause", (e: FakeEvent) => got.push(e.detail));
    const held = new FakeEvent("keydown", { key: " ", bubbles: true });
    Object.assign(held, { repeat: true });
    env.document.dispatchEvent(held);
    expect(held.defaultPrevented).toBe(true);
    expect(got).toEqual([]);
    // Пауза, поставленная другим источником (кнопка окна А), — пробел снимает её, а не ставит повторно.
    env.document.dispatchEvent(new FakeEvent("pult:pause", { detail: { paused: true } }));
    key(env, " ");
    expect(got.at(-1)).toEqual({ paused: false });
  });

  it("в поле ввода, с Ctrl и пробел на кнопке — ничего: ни кнопки, ни паузы", () => {
    const env = start();
    const grid = env.document.getElementById("grid")!;
    const got: unknown[] = [];
    env.document.addEventListener("pult:pause", (e: FakeEvent) => got.push(e.detail));
    const input = env.document.querySelector("input")!;
    expect(input).toBeTruthy();
    key(env, "2", { target: input });
    key(env, "2", { ctrl: true });
    expect(grid.classList.contains("max")).toBe(false);
    key(env, " ", { target: env.document.querySelector("[data-tab='proc']")! });
    expect(got).toEqual([]);
  });
});
