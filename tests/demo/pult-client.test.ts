// П-2.1а (Р-1462; ревью П-1.1 № 12, П-1.4 № 3, 4, 6, 7, повторное ревью П-2.1 № 3, 4): скрипт пульта `public/pult/pult.js`
// на подменённом DOM (`tests/support/fake-dom.ts`) — разметка страницы настоящая (`pultPage`). Проверяется поведение:
// раскладка и её хранение, состояние ленты, фокус (крошки, Esc, `pult:select` → `pult:focus`, клавиатурный фокус),
// доска (колонки, порядок «Завершены», счётчики без перестройки, выбор карточки нажатием).
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { pultPage } from "../../src/demo/dash-pult.js";
import { loadBrand } from "../../src/demo/server.js";
import type { PultBoardState, PultCard } from "../../src/pult/feed.js";
import { PULT } from "../../src/pult/phrases.js";
import { FakeEvent, pageEnv, type FakeElement, type PageEnv } from "../support/fake-dom.js";

const FOCUS_JS = readFileSync("src/demo/public/pult/focus.js", "utf8");
const PULT_JS = readFileSync("src/demo/public/pult/pult.js", "utf8");
const { brand } = loadBrand("config/brand.demo.json");

function start(o: Parameters<typeof pageEnv>[1] & { lang?: "ru" | "en"; noFocus?: boolean } = {}): PageEnv {
  const env = pageEnv(pultPage(o.lang ?? "ru", brand, false), o);
  if (!o.noFocus) env.run(FOCUS_JS);
  env.run(PULT_JS);
  return env;
}
const $ = (env: PageEnv, id: string) => env.document.getElementById(id)!;
const ru = (k: keyof typeof PULT) => PULT[k].ru;

const NOW = "2026-11-10T12:00:10.000Z";
function card(id: string, column: PultCard["column"], o: Partial<PultCard> = {}): PultCard {
  return { id, kind: "tx", column, worst: "norm", order: 1, since: "2026-11-10T12:00:00.000Z", ...o };
}
const boardMsg = (cards: PultCard[], jumps: PultBoardState["jumps"] = []) => ({ type: "board", board: { now: NOW, cards, jumps } });

describe("скрипт пульта на подменённом DOM (П-2.1а)", () => {
  it("раскладка: сетка → вкладки → вкладка «Контроль» → сетка → разворот «Хода»; выбор сохраняется", () => {
    const env = start();
    const grid = $(env, "grid");
    expect(grid.classList.contains("tabs")).toBe(false);
    expect($(env, "tabbar").hidden).toBe(true);
    env.document.querySelector("[data-layout='tabs']")!.click();
    expect(grid.classList.contains("tabs")).toBe(true);
    expect($(env, "tabbar").hidden).toBe(false);
    expect($(env, "p-proc").classList.contains("is-tab")).toBe(true);
    env.document.querySelector("[data-tab='ctl']")!.click();
    expect($(env, "p-ctl").classList.contains("is-tab")).toBe(true);
    expect($(env, "p-proc").classList.contains("is-tab")).toBe(false);
    expect(env.document.querySelector("[data-tab='ctl']")!.getAttribute("aria-pressed")).toBe("true");
    expect(JSON.parse(env.storage.get("pult.layout.v1")!)).toMatchObject({ layout: "tabs", tab: "ctl" });
    env.document.querySelector("[data-layout='grid']")!.click();
    const max = env.document.querySelector("[data-max='proc']")!;
    max.click();
    expect(grid.classList.contains("max")).toBe(true);
    expect($(env, "p-proc").classList.contains("is-max")).toBe(true);
    expect(max.textContent).toBe(ru("pane.restore"));
    max.click();
    expect(grid.classList.contains("max")).toBe(false);
    expect(max.textContent).toBe(ru("pane.maximize"));
  });

  it("сохранённая раскладка восстанавливается; повреждённое значение и недоступное хранилище — раскладка по умолчанию, пульт работает", () => {
    const saved = start({ stored: { "pult.layout.v1": JSON.stringify({ layout: "tabs", tab: "int", max: null }) } });
    expect($(saved, "grid").classList.contains("tabs")).toBe(true);
    expect($(saved, "p-int").classList.contains("is-tab")).toBe(true);
    for (const bad of ["{не json", JSON.stringify({ layout: "<script>", tab: "x", max: "y" }), "null"]) {
      const env = start({ stored: { "pult.layout.v1": bad } });
      expect($(env, "grid").classList.contains("tabs"), bad).toBe(false);
      expect($(env, "grid").classList.contains("max"), bad).toBe(false);
    }
    const noStore = start({ storage: "throws" });
    noStore.document.querySelector("[data-layout='tabs']")!.click();
    expect($(noStore, "grid").classList.contains("tabs")).toBe(true);
  });

  it("состояние ленты: hello → «шина подключена»; незнакомое — «подключение»; закрытая лента — «пульт отключён»", () => {
    const env = start();
    const es = env.sources[0]!;
    expect(es.url).toBe("/pult/events");
    es.send({ type: "hello", status: "open" });
    expect($(env, "status").textContent).toBe(ru("status.open"));
    expect($(env, "status-icon").textContent).toBe("●");
    es.send({ type: "status", status: "что-то новое" });
    expect($(env, "status").textContent).toBe(ru("status.connecting"));
    es.readyState = 2;
    es.onerror!();
    expect($(env, "status").textContent).toBe(ru("status.pult_closed"));
  });

  it("фокус: выбор карточки → pult:focus с номером, data-focus-tx, крошка «Транзакция» — текст с aria-current=location; Esc — система, фокус клавиатуры на строке фокуса", () => {
    const env = start();
    const events: unknown[] = [];
    env.document.addEventListener("pult:focus", (e) => events.push(e.detail));
    env.sources[0]!.send(boardMsg([card("C1", "pay")]));
    const c = env.document.querySelector("[data-card='C1']")!;
    c.dispatchEvent(new FakeEvent("pointerdown", { bubbles: true }));
    expect(events.at(-1)).toEqual({ level: "tx", tx: "C1" });
    expect($(env, "grid").dataset.focus).toBe("tx");
    expect($(env, "grid").dataset.focusTx).toBe("C1");
    expect($(env, "focus-up").hidden).toBe(false);
    const cur = $(env, "crumbs").querySelector(".cur")!;
    expect(cur.tagName).toBe("SPAN");
    expect(cur.getAttribute("aria-current")).toBe("location");
    expect(cur.textContent).toBe(`${ru("focus.tx")} C1`);
    // Повторный выбор той же карточки (click после pointerdown, по новому узлу после перестройки) — без нового события.
    const before = events.length;
    env.document.querySelector("[data-card='C1']")!.click();
    expect(events.length).toBe(before);
    // Esc в поле ввода и при наборе через IME — не фокус пульта.
    const input = env.document.createElement("input");
    env.document.body.appendChild(input);
    input.dispatchEvent(new FakeEvent("keydown", { bubbles: true, key: "Escape" }));
    env.document.dispatchEvent(new FakeEvent("keydown", { key: "Escape", isComposing: true }));
    expect($(env, "grid").dataset.focus).toBe("tx");
    // Esc — система; клавиатурный фокус — на строке фокуса, а не на body.
    env.document.dispatchEvent(new FakeEvent("keydown", { key: "Escape" }));
    expect($(env, "grid").dataset.focus).toBe("system");
    expect($(env, "grid").dataset.focusTx).toBeUndefined();
    expect($(env, "focus-up").hidden).toBe(true);
    expect(env.document.activeElement).toBe($(env, "focusbar"));
    expect(events.at(-1)).toEqual({ level: "system", tx: null });
  });

  it("«↑ выше» и крошка «Система» — уровень выше и фокус клавиатуры на строке фокуса; начальное состояние — в data-focus", () => {
    const env = start();
    expect($(env, "grid").dataset.focus).toBe("system");
    env.sources[0]!.send(boardMsg([card("C2", "cart")]));
    env.document.querySelector("[data-card='C2']")!.click();
    $(env, "focus-up").focus();
    $(env, "focus-up").click();
    expect($(env, "grid").dataset.focus).toBe("system");
    expect(env.document.activeElement).toBe($(env, "focusbar"));
    env.document.querySelector("[data-card='C2']")!.click();
    const sys = $(env, "crumbs").querySelector("[data-crumb='system']")!;
    expect(sys.tagName).toBe("BUTTON");
    sys.focus();
    sys.click();
    expect($(env, "grid").dataset.focus).toBe("system");
    expect(env.document.activeElement).toBe($(env, "focusbar"));
  });

  it("доска: восемь колонок, карточки по колонкам, подсказка на пустой доске, «Завершены» — по времени итога, последние сначала", () => {
    const env = start();
    env.sources[0]!.send(boardMsg([]));
    expect($(env, "b-proc").querySelector(".empty")!.textContent).toBe(ru("empty.proc"));
    env.sources[0]!.send(
      boardMsg([
        // Порядок итогов обратен порядку начала: A началась раньше, но её итог позже — по началу было бы B, A.
        card("A", "done", { outcome: "paid", outcomeSeq: 90, order: 1 }),
        card("B", "done", { outcome: "declined", outcomeSeq: 50, order: 2 }),
        card("C", "pay", { order: 3 }),
        card("M", "mandate", { kind: "mandate", order: 4 }),
      ]),
    );
    const cols = env.document.querySelectorAll(".bcol");
    expect(cols.map((c) => c.dataset.col)).toEqual(["mandate", "select", "cart", "confirmation", "pay", "result", "post", "done"]);
    const done = env.document.querySelector(".bcol[data-col='done']")!;
    // Итог A позже итога B — A первой, хотя по началу транзакций (и по старому «последние по началу») было бы B, A.
    expect(done.querySelectorAll("[data-card]").map((c) => c.dataset.card)).toEqual(["A", "B"]);
    expect(done.querySelector("[data-card='A']")!.querySelector(".bc-o")!.textContent).toBe(ru("outcome.paid"));
    expect(env.document.querySelector(".bcol[data-col='pay']")!.querySelector("[data-card='C']")).not.toBeNull();
    expect(env.document.querySelector("[data-card='M']")!.querySelector(".bc-k")!.textContent).toBe(ru("card.mandate"));
    expect($(env, "b-proc").querySelector(".empty")).toBeNull();
  });

  it("счётчик «в стадии» раз в секунду — только текст, узлы карточек прежние; перестройка доски возвращает фокус клавиатуры на карточку", () => {
    const env = start();
    env.sources[0]!.send(boardMsg([card("T", "pay")]));
    const node = env.document.querySelector("[data-card='T']") as FakeElement;
    const counter = node.querySelector(".bc-t")!;
    expect(counter.textContent).toMatch(new RegExp(`^${ru("card.in_stage")} \\d+ ${ru("card.sec")}$`));
    for (const f of env.intervals) f();
    expect(env.document.querySelector("[data-card='T']")).toBe(node);
    // Новая доска с той же карточкой — узел новый, фокус клавиатуры остался на этой карточке.
    node.focus();
    env.sources[0]!.send(boardMsg([card("T", "result")]));
    const again = env.document.querySelector("[data-card='T']")!;
    expect(again).not.toBe(node);
    expect(env.document.activeElement).toBe(again);
  });

  it("скрипт фокуса не загрузился — строка фокуса скрыта, доска и раскладка работают", () => {
    const env = start({ noFocus: true });
    expect($(env, "focusbar").hidden).toBe(true);
    env.sources[0]!.send(boardMsg([card("Z", "cart")]));
    expect(env.document.querySelector("[data-card='Z']")).not.toBeNull();
    env.document.querySelector("[data-layout='tabs']")!.click();
    expect($(env, "grid").classList.contains("tabs")).toBe(true);
  });

  it("П-2.2 «График»: переключение вида сохраняется; строки и отрезки по времени; «сейчас» растёт без перестройки узлов; выбор строки — фокус", () => {
    const env = start();
    const graph = {
      rows: [
        { id: "G1", kind: "tx", order: 1, marks: [{ at: "2026-11-10T12:00:05.000Z", kind: "error" }], segs: [{ col: "cart", from: "2026-11-10T12:00:00.000Z", to: "2026-11-10T12:00:05.000Z" }, { col: "pay", from: "2026-11-10T12:00:05.000Z" }] },
      ],
    };
    env.sources[0]!.send({ type: "board", board: { now: NOW, cards: [card("G1", "pay")], jumps: [], graph } });
    expect(env.document.querySelector(".bcol")).not.toBeNull();
    const toGraph = env.document.querySelector("[data-mode='graph']")!;
    toGraph.click();
    expect(toGraph.getAttribute("aria-pressed")).toBe("true");
    expect(JSON.parse(env.storage.get("pult.layout.v1")!)).toMatchObject({ mode: "graph" });
    expect(env.document.querySelector(".bcol")).toBeNull();
    const row = env.document.querySelector(".grow[data-card='G1']")!;
    expect(row.querySelector(".gname")!.textContent).toBe("G1");
    const segs = row.querySelectorAll(".seg");
    expect(segs.map((s) => s.className)).toEqual(["seg col-cart", "seg col-pay"]);
    // Начало — 12:00:00, «сейчас» — 12:00:10 (+ мгновения у экрана): cart — первая половина, pay — до «сейчас».
    expect(Number.parseFloat(segs[0]!.style.left!)).toBe(0);
    expect(Number.parseFloat(segs[0]!.style.width!)).toBeCloseTo(50, 0);
    expect(Number.parseFloat(segs[1]!.style.left!) + Number.parseFloat(segs[1]!.style.width!)).toBeCloseTo(100, 0);
    expect(row.querySelector(".gmark")!.className).toBe("gmark k-error");
    // Раз в секунду — только положения: узел строки прежний.
    for (const f of env.intervals) f();
    expect(env.document.querySelector(".grow[data-card='G1']")).toBe(row);
    // Выбор строки — фокус на транзакцию.
    row.dispatchEvent(new FakeEvent("pointerdown", { bubbles: true }));
    expect($(env, "grid").dataset.focusTx).toBe("G1");
    expect(env.document.querySelector(".grow[data-card='G1']")!.classList.contains("cur")).toBe(true);
    // Вид «График» восстанавливается из хранилища.
    const again = start({ stored: { "pult.layout.v1": env.storage.get("pult.layout.v1")! } });
    again.sources[0]!.send({ type: "board", board: { now: NOW, cards: [], jumps: [], graph } });
    expect(again.document.querySelector(".grow[data-card='G1']")).not.toBeNull();
  });

  it("П-2.2, ревью № 2: шкала — от начала незавершённой строки, не дальше 10 минут назад; давняя завершённая строка идущую не сжимает", () => {
    const env = start({ stored: { "pult.layout.v1": JSON.stringify({ layout: "grid", tab: "proc", max: null, mode: "graph" }) } });
    const graph = {
      rows: [
        // Завершилась 20 минут назад.
        { id: "OLD", kind: "tx", order: 1, marks: [], segs: [{ col: "cart", from: "2026-11-10T11:40:00.000Z", to: "2026-11-10T11:40:03.000Z" }, { col: "done", from: "2026-11-10T11:40:03.000Z" }] },
        // Идёт: началась 4 с назад (now — 12:00:10).
        { id: "NEW", kind: "tx", order: 2, marks: [], segs: [{ col: "cart", from: "2026-11-10T12:00:06.000Z", to: "2026-11-10T12:00:08.000Z" }, { col: "pay", from: "2026-11-10T12:00:08.000Z" }] },
      ],
    };
    env.sources[0]!.send({ type: "board", board: { now: NOW, cards: [], jumps: [], graph } });
    const fresh = env.document.querySelector(".grow[data-card='NEW']")!.querySelectorAll(".seg");
    // Шкала от начала NEW: её корзина — с левого края, около половины ширины.
    expect(Number.parseFloat(fresh[0]!.style.left!)).toBe(0);
    expect(Number.parseFloat(fresh[0]!.style.width!)).toBeGreaterThan(40);
    // Давняя корзина OLD — левее шкалы, обрезана (нулевая ширина).
    const old = env.document.querySelector(".grow[data-card='OLD']")!.querySelectorAll(".seg");
    expect(Number.parseFloat(old[0]!.style.width!)).toBe(0);
    // Нет незавершённых — шкала от самой ранней, но не дальше 10 минут назад: 20-минутная корзина всё равно обрезана.
    const env2 = start({ stored: { "pult.layout.v1": JSON.stringify({ layout: "grid", tab: "proc", max: null, mode: "graph" }) } });
    env2.sources[0]!.send({ type: "board", board: { now: NOW, cards: [], jumps: [], graph: { rows: [graph.rows[0]] } } });
    expect(Number.parseFloat(env2.document.querySelector(".seg")!.style.width!)).toBe(0);
  });

  it("П-2.3 разрезы: стадия, продавец (список из карточек), тип, поручения без покупки — на доске и «Графике»; число скрытых; сброс", () => {
    const env = start();
    const cards = [
      card("A", "pay", { merchantIds: ["MER-1"], order: 1 }),
      card("B", "cart", { merchantIds: ["MER-2"], worst: "error", order: 2 }),
      card("M", "mandate", { kind: "mandate", order: 3 }),
      // Ревью П-2.3 № 4: транзакция с конфликтом звеньев — два продавца; видна в разрезе каждого.
      card("K", "pay", { merchantIds: ["MER-2", "MER-3"], linkConflict: true, order: 4 }),
    ];
    const graph = { rows: cards.map((c) => ({ id: c.id, kind: c.kind, order: c.order, marks: [], segs: [{ col: c.column, from: "2026-11-10T12:00:05.000Z" }] })) };
    env.sources[0]!.send({ type: "board", board: { now: NOW, cards, jumps: [], graph } });
    const ids = () => env.document.querySelectorAll("[data-card]").map((c) => c.dataset.card).sort();
    const change = (id: string, v: string | boolean) => {
      const f = $(env, id);
      if (typeof v === "boolean") f.checked = v;
      else f.value = v;
      f.dispatchEvent(new FakeEvent("change", { bubbles: true }));
    };
    expect(ids()).toEqual(["A", "B", "K", "M"]);
    // Продавцы — из карточек, все продавцы каждой.
    expect($(env, "cut-merchant").querySelectorAll("option").map((o) => o.getAttribute("value"))).toEqual(["", "MER-1", "MER-2", "MER-3"]);
    change("cut-merchant", "MER-2");
    expect(ids()).toEqual(["B", "K"]);
    expect($(env, "cut-hidden").textContent).toBe(`${ru("cut.hidden")}: 2`);
    change("cut-merchant", "MER-3");
    expect(ids()).toEqual(["K"]);
    change("cut-merchant", "");
    change("cut-stage", "pay");
    expect(ids()).toEqual(["A", "K"]);
    change("cut-stage", "");
    // Тип «ошибка» выключен — B скрыта.
    env.document.querySelector("[data-cut-kind='error']")!.click();
    expect(env.document.querySelector("[data-cut-kind='error']")!.getAttribute("aria-pressed")).toBe("false");
    expect(ids()).toEqual(["A", "K", "M"]);
    change("cut-mandates", false);
    expect(ids()).toEqual(["A", "K"]);
    // На «Графике» — тот же разрез.
    env.document.querySelector("[data-mode='graph']")!.click();
    expect(env.document.querySelectorAll(".grow").map((r) => r.dataset.card)).toEqual(["A", "K"]);
    // Сброс — всё видно, поля в исходном положении.
    $(env, "cut-reset").click();
    expect(env.document.querySelectorAll(".grow").map((r) => r.dataset.card).sort()).toEqual(["A", "B", "K", "M"]);
    expect($(env, "cut-mandates").checked).toBe(true);
    expect($(env, "cut-stage").value).toBe("");
    expect($(env, "cut-hidden").textContent).toBe("");
  });

  it("ревью П-2.3 № 1: список продавцов обновляется на месте — без дублей, новый добавляется, выбранный остаётся после ухода с доски", () => {
    const env = start();
    const opts = () => $(env, "cut-merchant").querySelectorAll("option").map((o) => o.getAttribute("value"));
    const send = (cards: PultCard[]) => env.sources[0]!.send({ type: "board", board: { now: NOW, cards, jumps: [], graph: { rows: [] } } });
    send([card("A", "pay", { merchantIds: ["MER-1"] }), card("B", "cart", { merchantIds: ["MER-2"] })]);
    expect(opts()).toEqual(["", "MER-1", "MER-2"]);
    const sel = $(env, "cut-merchant");
    sel.value = "MER-2";
    sel.dispatchEvent(new FakeEvent("change", { bubbles: true }));
    const node = sel.querySelectorAll("option")[2];
    // Второй пакет: MER-2 ушла с доски, пришёл MER-3, MER-1 — снова. Дублей нет, узлы прежних option не пересоздаются.
    send([card("A", "pay", { merchantIds: ["MER-1"] }), card("C", "cart", { merchantIds: ["MER-3"] })]);
    expect(opts()).toEqual(["", "MER-1", "MER-2", "MER-3"]);
    expect(sel.querySelectorAll("option")[2]).toBe(node);
    expect(sel.value).toBe("MER-2");
    // Выбран продавец, которого на доске нет, — карточек не видно, скрыто — обе.
    expect(env.document.querySelectorAll("[data-card]")).toEqual([]);
    expect($(env, "cut-hidden").textContent).toBe(`${ru("cut.hidden")}: 2`);
  });

  it("П-3.2а: признаки итога на карточке и строке «Графика» — ru/en; операции списком; «ждём шаг агента»; номера операций — текстом", () => {
    const flagged = card("F", "done", {
      outcome: "paid",
      outcomeSeq: 9,
      afterRevoke: true,
      doubleDebit: true,
      ops: [{ opRef: "<i>P1</i>", kind: "declined" }, { opRef: "P2", kind: "paid" }, { opRef: "P3" }],
    });
    const waiting = card("W", "result", { pending: true, order: 2 });
    const graph = { rows: [{ id: "F", kind: "tx", order: 1, marks: [], segs: [{ col: "done", from: "2026-11-10T12:00:05.000Z" }], afterRevoke: true, doubleDebit: true }] };
    for (const lang of ["ru", "en"] as const) {
      const env = start({ lang });
      env.sources[0]!.send({ type: "board", board: { now: NOW, cards: [flagged, waiting], jumps: [], graph } });
      const f = env.document.querySelector("[data-card='F']")!;
      expect(f.querySelectorAll(".bc-w").map((x) => x.textContent)).toEqual([PULT["card.after_revoke"][lang], PULT["card.double_debit"][lang]]);
      expect(f.querySelector(".bc-ops")!.textContent).toBe(
        `${PULT["card.ops"][lang]}: <i>P1</i> — ${PULT["op.declined"][lang]} · P2 — ${PULT["op.paid"][lang]} · P3 — ${PULT["op.none"][lang]}`,
      );
      expect(f.querySelectorAll("i")).toEqual([]);
      expect(env.document.querySelector("[data-card='W']")!.querySelector(".bc-p")!.textContent).toBe(PULT["card.pending"][lang]);
      env.document.querySelector("[data-mode='graph']")!.click();
      const name = env.document.querySelector(".grow[data-card='F']")!.querySelector(".gname")!;
      expect(name.querySelectorAll(".gflag").map((x) => x.textContent)).toEqual([PULT["card.after_revoke"][lang], PULT["card.double_debit"][lang]]);
    }
  });

  it("данные карточки — только текстом: номер и фраза с разметкой не становятся элементами", () => {
    const env = start({ lang: "en" });
    env.sources[0]!.send(boardMsg([card("<img src=x>", "pay", { last: { at: NOW, phrase: { ru: "<b>ру</b>", en: "<b>en</b>" } } })]));
    const c = env.document.querySelector("[data-card]")!;
    expect(c.querySelector(".bc-id")!.textContent).toBe("<img src=x>");
    expect(c.querySelector(".bc-e")!.textContent).toContain("<b>en</b>");
    expect(c.querySelectorAll("img, b").filter((x) => x !== c.querySelector(".bc-id"))).toEqual([]);
  });

  it("П-4.1 «Контроль»: паспорта, «Идёт к нарушению» — только после порога (без новой записи), секунды без перестройки; «В работе сейчас»; ru/en; данные — текстом", () => {
    const control = {
      passports: [
        {
          obj: "<b>T1</b>",
          findings: [{ cond: "R27", condText: { ru: "итог — от Платформы", en: "outcome — from the Platform" }, node: "У3", nodeText: { ru: "Итог", en: "Outcome" }, violator: "merchant", protector: "operator" }],
        },
      ],
      waits: [
        { kind: "confirmation", cond: "R21", obj: "T2", confirmationId: "Q2", since: "2026-11-10T12:00:00.000Z" },
        { kind: "agent_step", obj: "P9", since: "2026-11-10T12:00:08.000Z" },
        // R18 — реакции «Напомнить клиенту» нет (ревью П-4.1 № 10); порог пройдёт на 13-й секунде, как у «шага агента».
        { kind: "consent", cond: "R18", obj: "T3", since: "2026-11-10T12:00:08.000Z" },
      ],
      waitMs: 15_000,
      active: [{ id: "T2", column: "confirmation", since: "2026-11-10T12:00:00.000Z" }],
      counts: { txs: 2, wrong: 1 },
    };
    const t0 = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(t0);
    try {
      for (const lang of ["ru", "en"] as const) {
        const env = start({ lang });
        env.sources[0]!.send({ type: "board", board: { now: NOW, cards: [card("T2", "confirmation")], jumps: [], control } });
        const box = $(env, "b-ctl");
        expect(box.querySelector(".ctl-status")!.textContent).toBe(
          `${PULT["ctl.status"][lang]}: 2 · ${PULT["ctl.status.wrong"][lang]}: 1 · ${PULT["ctl.status.waits"][lang]}: 0`,
        );
        const f = box.querySelector(".passport")!.querySelector(".pp-f")!.textContent;
        expect(f).toBe(
          `R27 ${lang === "en" ? "outcome — from the Platform" : "итог — от Платформы"} · ${PULT["ctl.node"][lang]} У3 ${lang === "en" ? "Outcome" : "Итог"} · ` +
            `${PULT["ctl.violator"][lang]}: ${PULT["subj.merchant"][lang]} · ${PULT["ctl.protector"][lang]}: ${PULT["subj.operator"][lang]}`,
        );
        expect(box.querySelector(".pp-h")!.textContent).toBe("<b>T1</b>");
        expect(box.querySelectorAll("b")).toEqual([]);
        // 10 с с запроса — порог 15 с не пройден: строк нет.
        expect(box.querySelectorAll(".wait-row")).toEqual([]);
        const activeT = box.querySelector(".active-row")!.querySelector(".active-t")!;
        expect(box.querySelector(".active-row")!.textContent).toBe(`T2 · ${PULT["col.confirmation"][lang]} · ${activeT.textContent}`);
        const activeAt0 = activeT.textContent;
        // Через 5 с без новой записи — строка R21 появилась; «шаг агента» (2 с + 5 с) — ещё нет.
        clock.mockReturnValue(t0 + 5_000);
        for (const i of env.intervals) i();
        const rows = box.querySelectorAll(".wait-row");
        expect(rows.map((r) => r.dataset.wait)).toEqual(["confirmation"]);
        expect(rows[0]!.textContent).toBe(`R21 · ${PULT["ctl.wait.confirmation"][lang]} · T2 · Q2 · 15 ${PULT["card.sec"][lang]}${PULT["ctl.wait.action"][lang]}`);
        // Ещё секунда — набор тот же: узел строки прежний, меняются только секунды; «В работе сейчас» тоже тикает.
        const node = rows[0];
        clock.mockReturnValue(t0 + 6_000);
        for (const i of env.intervals) i();
        expect(box.querySelectorAll(".wait-row")[0]).toBe(node);
        expect(node!.querySelector(".wait-s")!.textContent).toBe(`16 ${PULT["card.sec"][lang]}`);
        expect(box.querySelector(".active-t")!.textContent).not.toBe(activeAt0);
        // Через 13 с — «возможно, чужая операция» (без условия и реакции) и R18 (без реакции «Напомнить клиенту»).
        clock.mockReturnValue(t0 + 13_000);
        for (const i of env.intervals) i();
        const r2 = box.querySelectorAll(".wait-row");
        expect(r2.map((r) => r.dataset.wait)).toEqual(["confirmation", "agent_step", "consent"]);
        expect(r2[1]!.textContent).toBe(`${PULT["ctl.wait.agent_step"][lang]} · P9 · 15 ${PULT["card.sec"][lang]} — ${PULT["ctl.wait.agent_step.note"][lang]}`);
        expect(r2[2]!.textContent).toBe(`R18 · ${PULT["ctl.wait.consent"][lang]} · T3 · 15 ${PULT["card.sec"][lang]}`);
        // Внутренних кодов задач на экране нет (ревью П-4.1 № 10).
        expect(box.textContent).not.toMatch(/[ПP]-\d/);
        clock.mockReturnValue(t0);
      }
    } finally {
      clock.mockRestore();
    }
  });
});
