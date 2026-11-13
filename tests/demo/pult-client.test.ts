// П-2.1а (Р-1462; ревью П-1.1 № 12, П-1.4 № 3, 4, 6, 7, повторное ревью П-2.1 № 3, 4): скрипт пульта `public/pult/pult.js`
// на подменённом DOM (`tests/support/fake-dom.ts`) — разметка страницы настоящая (`pultPage`). Проверяется поведение:
// раскладка и её хранение, состояние ленты, фокус (крошки, Esc, `pult:select` → `pult:focus`, клавиатурный фокус),
// доска (колонки, порядок «Завершены», счётчики без перестройки, выбор карточки нажатием).
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { pultPage } from "../../src/demo/dash-pult.js";
import { STAND_FAULT_TESTS } from "../../src/demo/stand-faults.js";
import { REACTION_RECORDS } from "../../src/pult/reactions.js";
import { ACC1_EXPORT_LABEL, ACC1_EXPORTS } from "../../src/pult/acc1.js";
import { loadBrand } from "../../src/demo/server.js";
import type { PultBoardState, PultCard } from "../../src/pult/feed.js";
import { conditionsView } from "../../src/pult/conditions.js";
import { NOTE_LABEL, STATUS_LABEL, type CondResult, type CondResults, type CondStatus, type EngineView, type Note } from "../../src/pult/engine.js";
import { PULT } from "../../src/pult/phrases.js";
import { CHECKABLE_CONDITIONS, RULES89, SECTORS, type CheckableCondition, type Rule89 } from "../../src/pult/rules89.js";
import { FakeEvent, pageEnv, type FakeElement, type PageEnv } from "../support/fake-dom.js";

const FOCUS_JS = readFileSync("src/demo/public/pult/focus.js", "utf8");
const PULT_JS = readFileSync("src/demo/public/pult/pult.js", "utf8");
const { brand } = loadBrand("config/brand.demo.json");

function start(o: Parameters<typeof pageEnv>[1] & { lang?: "ru" | "en"; noFocus?: boolean; rules?: readonly Rule89[]; actions?: boolean; faults?: boolean; clientAuto?: boolean } = {}): PageEnv {
  const env = pageEnv(
    pultPage(o.lang ?? "ru", brand, false, { ...(o.rules && { rules: o.rules }), ...(o.actions && { actions: true }), ...(o.faults && { faults: true }), ...(o.clientAuto !== undefined && { clientAuto: o.clientAuto }) }),
    o,
  );
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

// П-4.2 «Условия»: «Приоритет» (плитки узлов, сектора) и «Все 89». Состояние — из настоящего `conditionsView` над
// собранным результатом движка: экран показывает его, а не считает сам.
type CSet = Partial<Record<CheckableCondition, CondStatus | [CondStatus, Note]>>;
const cres = (x: CondStatus | [CondStatus, Note] | undefined): CondResult =>
  x === undefined ? { status: "na", seqs: [] } : Array.isArray(x) ? { status: x[0], seqs: [], note: x[1] } : { status: x, seqs: [] };
const cconds = (s: CSet = {}) => Object.fromEntries(CHECKABLE_CONDITIONS.map((c) => [c, cres(s[c])])) as CondResults;
const engineView = (system: CSet, objs: { id: string; s: CSet }[] = []): EngineView => ({
  system: cconds(system),
  objs: objs.map((o) => ({ id: o.id, kind: "tx" as const, conds: cconds(o.s) })),
  guarantees: [],
});
// У1 «сработало» только сводно (R47 — агент исключил инструкцию); У2 «нарушено» у T2 (R46) и записью системы (R23) —
// смешанный; У3 «нарушено» только сводно (R27 — запись системы); У4 — R31 без журнала стенда, как отдаёт движок ленты
// (`none` с пометкой `stand_log`); сектор «Подтверждение» — R21 «ещё не дошло».
const COND = conditionsView(
  engineView({ R47: "fired", R46: "bad", R23: "bad", R27: "bad", R21: "wait", R08: "ok", R18: "ok", R31: ["none", "stand_log"] }, [{ id: "T2", s: { R46: "bad" } }]),
);
const CTL = { passports: [], waits: [{ kind: "confirmation", cond: "R21", obj: "T2", confirmationId: "Q2", since: "2026-11-10T12:00:00.000Z" }], waitMs: 15_000, active: [], counts: { txs: 1, wrong: 0 } };
const condMsg = (conditions: unknown = COND) => ({ type: "board", board: { now: NOW, cards: [card("T2", "pay")], jumps: [], control: CTL, conditions } });
const rows89 = (env: PageEnv) => $(env, "b-ctl").querySelectorAll(".r89");
// Щелчок по заголовку перестраивает тело — заголовки ищутся заново после каждого.
const openAll = (env: PageEnv) => {
  for (let h = $(env, "b-ctl").querySelector(".cg-h[aria-expanded='false']"); h; h = $(env, "b-ctl").querySelector(".cg-h[aria-expanded='false']")) h.click();
};
const search = (env: PageEnv, q: string) => {
  const i = $(env, "b-ctl").querySelector("input")!;
  i.value = q;
  i.dispatchEvent(new FakeEvent("input", { bubbles: true }));
};

describe("«Условия» пульта (П-4.2)", () => {
  it("«Приоритет»: 5 плиток узлов и 8 секторов — статус из движка; «к нарушению» — фокус на транзакцию; нарушение без транзакции — «система», кнопка неактивна", () => {
    const t0 = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(t0);
    try {
      const env = start();
      env.sources[0]!.send(condMsg());
      const box = $(env, "b-ctl");
      expect(box.querySelector("[data-ctl-view='prio']")!.getAttribute("aria-pressed")).toBe("true");
      const tiles = box.querySelectorAll(".tile");
      expect(tiles.map((t) => t.dataset.node)).toEqual(["У1", "У2", "У3", "У4", "У5"]);
      const y2 = tiles[1]!;
      expect(y2.classList.contains("st-bad")).toBe(true);
      // Ревью П-4.2 № 2: смешанный узел — видны и транзакция, и запись системы; кнопка — к транзакции.
      expect(y2.querySelector(".tl-s")!.textContent).toBe(`${STATUS_LABEL.bad.ru}: T2 · ${ru("cv.node.system")}`);
      expect(y2.querySelector(".tl-go")!.dataset.go).toBe("T2");
      // Ревью П-4.2 № 1 (Р-1505): сработавшая защита — «сработало: система», кнопки нет (нарушения нет).
      expect(tiles[0]!.querySelector(".tl-s")!.textContent).toBe(`${STATUS_LABEL.fired.ru}: ${ru("cv.node.system")}`);
      expect(tiles[0]!.querySelector(".tl-go")).toBeNull();
      expect(tiles[0]!.textContent).not.toContain(ru("cv.node.no_tx"));
      expect(y2.querySelector(".tl-r")!.textContent).toBe(`${ru("cv.node.rules")} Е05, Ж03, О02 · ${ru("cv.node.conds")} R23, R25, R46`);
      // Уточнение 1: «нарушено» записью системы — «система», кнопка неактивна, щелчок фокус не ставит.
      const y3 = tiles[2]!;
      expect(y3.querySelector(".tl-s")!.textContent).toBe(`${STATUS_LABEL.bad.ru}: ${ru("cv.node.system")}`);
      const noTx = y3.querySelector(".tl-go")!;
      expect([noTx.textContent, noTx.hasAttribute("disabled"), noTx.dataset.go]).toEqual([ru("cv.node.no_tx"), true, undefined]);
      noTx.click();
      expect($(env, "grid").dataset.focus).toBe("system");
      // У4 (R31 — журнал сбоев стенда) — «на стенде не проверяется» с пометкой, без кодов задач.
      expect(tiles[3]!.querySelector(".tl-s")!.textContent).toBe(STATUS_LABEL.none.ru);
      expect(tiles[3]!.querySelector(".tl-n")!.textContent).toBe(NOTE_LABEL.stand_log.ru);
      expect(tiles[3]!.textContent).not.toMatch(/[ПP]-\d/);
      // «К нарушению» — по нажатию мыши фокус на T2.
      y2.querySelector(".tl-go")!.dispatchEvent(new FakeEvent("pointerdown", { bubbles: true }));
      expect($(env, "grid").dataset.focusTx).toBe("T2");
      // 8 секторов; «Подтверждение» — «ещё не дошло»; «Гонки» — «на стенде не проверяется».
      const sects = box.querySelectorAll(".sect");
      expect(sects.map((s) => s.dataset.sector)).toEqual(Object.keys(SECTORS));
      const conf = sects.find((s) => s.dataset.sector === "confirmation")!;
      expect(conf.className).toBe("sect st-wait");
      expect(conf.querySelector(".sect-att")).toBeNull();
      expect(sects.find((s) => s.dataset.sector === "races")!.className).toBe("sect st-none");
      // Уточнение 3: R21 за порогом — значок «внимание», цвет (класс статуса) сектора тот же.
      clock.mockReturnValue(t0 + 6_000);
      for (const i of env.intervals) i();
      const conf2 = box.querySelectorAll(".sect").find((s) => s.dataset.sector === "confirmation")!;
      expect(conf2.className).toBe("sect st-wait");
      expect(conf2.querySelector(".sect-att")!.textContent).toBe(` ⚑ ${ru("cv.attention")}: 1`);
      // Блоки П-4.1 на месте.
      expect(box.querySelectorAll(".wait-row").map((r) => r.dataset.wait)).toEqual(["confirmation"]);
    } finally {
      clock.mockRestore();
    }
  });

  it("«Все 89»: счётчик — из движка; поиск по номеру, условию и слову; фильтр по зоне 9 / 33 / 23 / 24; сектор; карточка правила; вид сохраняется", () => {
    const env = start();
    env.sources[0]!.send(condMsg());
    const box = $(env, "b-ctl");
    box.querySelector("[data-ctl-view='all']")!.click();
    expect(JSON.parse(env.storage.get("pult.layout.v1")!)).toMatchObject({ ctlView: "all" });
    expect(box.querySelector(".c89bar")!.hidden).toBe(false);
    expect(box.querySelectorAll(".tile")).toEqual([]);
    // Счётчик — числа `counts` движка (уточнение 5).
    const counts = COND.counts as Record<string, number>;
    const want = ["bad", "fired", "wait", "ok", "na", "none", "out"].filter((k) => counts[k]! > 0).map((k) => `${STATUS_LABEL[k as CondStatus].ru} ${counts[k]}`);
    expect(box.querySelector(".c89-count")!.textContent).toBe(`${ru("cv.counts")}: ${want.join(" · ")}`);
    // Ревью П-4.2 № 5: числа — из `counts`, а не пересчётом строк (`counts` нарочно не совпадает с `rules`).
    env.sources[0]!.send(condMsg({ ...COND, counts: { bad: 7 } }));
    expect(box.querySelector(".c89-count")!.textContent).toBe(`${ru("cv.counts")}: ${STATUS_LABEL.bad.ru} 7`);
    env.sources[0]!.send(condMsg());
    // Без поиска раскрыты только группы с нарушением (Е — R23, Ж — Ж03 по R46).
    expect(new Set(rows89(env).map((r) => r.dataset.rule!.charAt(0)))).toEqual(new Set(["Е", "Ж"]));
    const zh = rows89(env).find((r) => r.dataset.rule === "Ж03")!;
    expect(zh.querySelector(".s89")!.textContent).toBe(STATUS_LABEL.bad.ru);
    expect(zh.classList.contains("bad")).toBe(true);
    openAll(env);
    expect(rows89(env)).toHaveLength(89);
    // Статус строки — из `board.conditions`: правило без условия на стенде — как отдал движок.
    expect(rows89(env).find((r) => r.dataset.rule === "А08")!.querySelector(".s89")!.textContent).toBe(STATUS_LABEL.out.ru);
    search(env, "ж03");
    expect(rows89(env).map((r) => r.dataset.rule)).toEqual(["Ж03"]);
    search(env, "R21");
    expect(rows89(env).map((r) => r.dataset.rule)).toEqual(["Д05"]);
    search(env, "отзыв");
    expect(rows89(env).map((r) => r.dataset.rule)).toEqual(["Б06", "Б08", "Б09", "Л01", "Л02", "Л03"]);
    search(env, "нет такого слова");
    expect(rows89(env)).toEqual([]);
    expect(box.querySelector(".ctl-body")!.textContent).toContain(ru("cv.empty"));
    search(env, "");
    for (const [z, n] of [["red", 9], ["orange", 33], ["yellow", 23], ["background", 24]] as const) {
      box.querySelector(`[data-zone='${z}']`)!.click();
      expect(rows89(env), z).toHaveLength(n);
      expect(rows89(env).every((r) => r.classList.contains("z-" + z)), z).toBe(true);
      expect(box.querySelector(`[data-zone='${z}']`)!.getAttribute("aria-pressed")).toBe("true");
    }
    box.querySelector("[data-zone='']")!.click();
    // Сектор: из «Приоритета» — «Все 89» с правилами сектора, фильтр снимается.
    box.querySelector("[data-ctl-view='prio']")!.click();
    box.querySelector("[data-sector='cart']")!.click();
    expect(box.querySelector("[data-ctl-view='all']")!.getAttribute("aria-pressed")).toBe("true");
    expect(rows89(env).map((r) => r.dataset.rule)).toEqual(["В04", "Г03", "Г04", "Г06"]);
    const chip = box.querySelector(".cv-sec")!;
    expect([chip.hidden, chip.textContent]).toEqual([false, `${ru("cv.sector")}: ${SECTORS.cart.name.ru} ×`]);
    chip.click();
    expect(chip.hidden).toBe(true);
    // Карточка правила: щелчок — открыть, повторный — закрыть.
    openAll(env);
    rows89(env).find((r) => r.dataset.rule === "Ж03")!.click();
    const cardEl = box.querySelector(".c89card")!;
    const r = RULES89.find((x) => x.id === "Ж03")!;
    const dd = cardEl.querySelectorAll("dd").map((d) => d.textContent);
    expect(dd).toContain(r.ru.who);
    expect(dd).toContain(r.ru.evidence);
    expect(dd).toContain(`${r.v} × ${r.c} = ${r.v * r.c}`);
    expect(rows89(env).find((x) => x.dataset.rule === "Ж03")!.getAttribute("aria-expanded")).toBe("true");
    rows89(env).find((x) => x.dataset.rule === "Ж03")!.click();
    expect(box.querySelector(".c89card")).toBeNull();
    // Сохранённый вид восстанавливается.
    const again = start({ stored: { "pult.layout.v1": env.storage.get("pult.layout.v1")! } });
    again.sources[0]!.send(condMsg());
    expect($(again, "b-ctl").querySelectorAll(".tile")).toEqual([]);
    expect($(again, "b-ctl").querySelector(".c89bar")!.hidden).toBe(false);
  });

  it("новая доска не трогает поле поиска (тот же узел, значение и фокус); фокус на строке правила возвращается; нет «Условий» — «ещё не посчитаны»", () => {
    const env = start();
    env.sources[0]!.send(condMsg());
    const box = $(env, "b-ctl");
    box.querySelector("[data-ctl-view='all']")!.click();
    const input = box.querySelector("input")!;
    input.focus();
    search(env, "Ж0");
    env.sources[0]!.send(condMsg());
    expect(box.querySelector("input")).toBe(input);
    expect([input.value, env.document.activeElement]).toEqual(["Ж0", input]);
    expect(rows89(env).map((r) => r.dataset.rule)).toEqual(["Ж01", "Ж02", "Ж03", "Ж04", "Ж05"].filter((id) => RULES89.some((x) => x.id === id)));
    rows89(env)[0]!.focus();
    const id = rows89(env)[0]!.dataset.rule;
    env.sources[0]!.send(condMsg());
    expect((env.document.activeElement as FakeElement).dataset.rule).toBe(id);
    // Движок ещё не отработал — экран не выдумывает статусы.
    env.sources[0]!.send(condMsg(null));
    expect(box.querySelector(".c89-count")!.textContent).toBe(ru("cv.no_data"));
    expect(rows89(env).every((r) => r.querySelector(".s89")!.textContent === "—")).toBe(true);
    box.querySelector("[data-ctl-view='prio']")!.click();
    expect(box.querySelector(".ctl-body")!.textContent).toContain(ru("cv.no_data"));
  });

  it("en: подписи и статусы — en; у правила без en — ru с пометкой «en — after MVP»; формулировка с </script> в справочнике — текстом, разметки нет", () => {
    const env = start({ lang: "en" });
    env.sources[0]!.send(condMsg());
    const box = $(env, "b-ctl");
    expect(box.querySelector("[data-ctl-view='all']")!.textContent).toBe(PULT["cv.all"].en);
    expect(box.querySelectorAll(".tile")[1]!.querySelector(".tl-s")!.textContent).toBe(`${STATUS_LABEL.bad.en}: T2 · ${PULT["cv.node.system"].en}`);
    box.querySelector("[data-ctl-view='all']")!.click();
    openAll(env);
    const row = (id: string) => rows89(env).find((r) => r.dataset.rule === id)!.querySelector(".cru")!.textContent;
    expect(row("Ж03")).toBe(RULES89.find((x) => x.id === "Ж03")!.en!.rule);
    expect(row("А01")).toBe(`${RULES89.find((x) => x.id === "А01")!.ru.rule} (en — after MVP)`);
    // Уточнение 4: справочник в странице — через jsonForScript; `</script>` в данных не закрывает блок.
    const evil = RULES89.map((r) => (r.id === "Ж03" ? { ...r, ru: { ...r.ru, rule: "</script><b>x</b><img src=x>" } } : r));
    const html = pultPage("ru", brand, false, { rules: evil });
    expect(html).not.toContain("</script><b>");
    const e2 = start({ rules: evil });
    e2.sources[0]!.send(condMsg());
    e2.document.querySelector("[data-ctl-view='all']")!.click();
    const zh = $(e2, "b-ctl").querySelectorAll(".r89").find((r) => r.dataset.rule === "Ж03")!;
    expect(zh.querySelector(".cru")!.textContent).toBe("</script><b>x</b><img src=x>");
    expect($(e2, "b-ctl").querySelectorAll("b, img")).toEqual([]);
  });
});

// П-5.1 «Причины»: панель «Интерпретатор» показывает разбор из `board.causes` — в системе блоки, в фокусе — полностью.
describe("«Причины» пульта (П-5.1)", () => {
  const rec = (seq: number, phrase: string) => ({ seq, at: "2026-11-10T12:00:00.000Z", actor: "agent", kind: "norm", phrase: { ru: phrase, en: phrase } });
  const CAUSES = [
    {
      id: "T2",
      outcome: "paid",
      items: [
        {
          kind: "violation",
          cond: "R46",
          title: { ru: "<b>Один заказ — одна оплата</b>", en: "One order — one payment" },
          node: "У2",
          violator: "agent",
          protector: "none",
          happened: [rec(5, "второе «оплачено»")],
          where: ["Т4"],
          rules: ["Ж03"],
          consequences: { ru: "клиент платит дважды", en: "the client pays twice" },
          todo: { ru: "остановить и разобрать", en: "stop and review" },
          guarantees: [{ ru: "Приостановленный агент остановлен (403) — кто защитил: платёжная система (Платформа)", en: "The suspended agent was stopped (403) — protected by: payment system (Platform)" }],
        },
        {
          kind: "protection",
          guarantee: "agent_suspended",
          title: { ru: "Приостановленный агент остановлен (403)", en: "The suspended agent was stopped (403)" },
          violator: "none",
          protector: "platform",
          happened: [rec(6, "403")],
          where: ["Т3"],
          rules: ["А06"],
          consequences: { ru: "процесс остановлен", en: "process stopped" },
          todo: { ru: "сообщить клиенту", en: "tell the client" },
          guarantees: [{ ru: "403 — Платформа", en: "403 — Platform" }],
        },
      ],
      waits: [],
      chain: Array.from({ length: 40 }, (_, i) => rec(100 + i, `запись ${i}`)),
      chainTotal: 55,
      chainLimit: 40,
    },
  ];
  const msg = (causes: unknown) => ({ type: "board", board: { now: NOW, cards: [card("T2", "done")], jumps: [], control: CTL, causes } });

  it("система — блоки без разбора; щелчок — фокус; в фокусе — что случилось, где, правило, почему, последствия, что делать, гарантии, цепочка «из N»; данные — текстом", () => {
    for (const lang of ["ru", "en"] as const) {
      const env = start({ lang });
      env.sources[0]!.send(msg(CAUSES));
      const box = $(env, "b-int");
      expect(box.querySelector(".note")!.textContent).toBe(PULT["int.note.system"][lang]);
      const head = box.querySelector(".cb-h")!;
      expect(head.textContent).toBe(`T2 · ${PULT["outcome.paid"][lang]}`);
      expect(box.querySelectorAll(".cause").length).toBe(2);
      expect(box.querySelectorAll("dt").map((d) => d.textContent)).not.toContain(PULT["int.happened"][lang]);
      expect(box.querySelector(".chain")).toBeNull();
      // Щелчок по заголовку — фокус на транзакцию, разбор полностью.
      head.click();
      expect($(env, "grid").dataset.focusTx).toBe("T2");
      expect(box.querySelector(".note")!.textContent).toBe(PULT["int.note.tx"][lang]);
      const dts = box.querySelectorAll("dt").map((d) => d.textContent);
      for (const k of ["int.violator", "int.happened", "int.where", "int.rule", "int.why", "int.consequences", "int.todo", "int.guarantees", "int.protector"] as const) expect(dts, k).toContain(PULT[k][lang]);
      // Гарантии, правила и точки — из данных: правило по номеру — текст справочника страницы, точка — с названием.
      const dds = box.querySelectorAll("dd").map((d) => d.textContent);
      expect(dds.some((t) => t.includes(lang === "ru" ? "кто защитил: платёжная система" : "protected by: payment system"))).toBe(true);
      const zh = RULES89.find((r) => r.id === "Ж03")!;
      expect(dds.some((t) => t.includes("Ж03 " + (lang === "en" ? zh.en!.rule : zh.ru.rule)))).toBe(true);
      expect(dds.some((t) => t.startsWith("Т4 "))).toBe(true);
      // «Кто защитил» у нарушения без защиты — словами «защиты не было».
      expect(dds).toContain(PULT["int.protector.none"][lang]);
      // Цепочка — 40 строк и пометка «показаны последние 40 из 55» (Р-1519).
      expect(box.querySelectorAll(".ch-r")).toHaveLength(40);
      expect(box.querySelector(".chain-cut")!.textContent).toContain("55");
      expect(box.querySelector(".chain-cut")!.textContent).toContain("40");
      // Данные — текстом.
      expect(box.querySelectorAll("b")).toEqual([]);
      expect(box.textContent).toContain(lang === "ru" ? "<b>Один заказ — одна оплата</b>" : "One order — one payment");
    }
  });

  it("ревью П-5.1 № 4: экран не объявляет транзакцию правильной — «вердиктов по транзакции нет»; движок не отработал — так и сказано", () => {
    const env = start();
    env.sources[0]!.send(msg([]));
    expect($(env, "b-int").textContent).toContain(ru("int.none"));
    env.document.dispatchEvent(new FakeEvent("pult:select", { detail: { tx: "T9" } }));
    expect($(env, "b-int").textContent).toContain(ru("int.tx.none"));
    expect($(env, "b-int").textContent).not.toMatch(/правильн/);
    env.sources[0]!.send(msg(undefined));
    expect($(env, "b-int").textContent).toContain(ru("int.no_engine"));
  });
});

// П-8.1 «Кнопки реакции» на подменённом DOM (Р-1526, Р-1527): режимы, два шага отзыва, «Напомнить» без стенда у R08 / R18.
describe("кнопки реакции пульта (П-8.1)", () => {
  const T0 = "2026-11-10T11:59:00.000Z";
  const ctl = {
    passports: [{ obj: "CT1", findings: [{ cond: "R46", violator: "agent" }, { cond: "R09", violator: "undetermined" }] }],
    waits: [
      { kind: "sign", cond: "R08", obj: "IM1", since: T0 },
      { kind: "confirmation", cond: "R21", obj: "CT1", confirmationId: "Q1", since: T0 },
    ],
    waitMs: 15_000,
    active: [{ id: "CT1", column: "confirmation", since: T0 }],
    counts: { txs: 1, wrong: 1 },
  };
  const msg = { type: "board", board: { now: NOW, cards: [{ ...card("CT1", "confirmation"), intentId: "IT1", cartMandateId: "CT1" }], jumps: [], control: ctl } };
  const withFetch = (env: PageEnv) => {
    const calls: string[] = [];
    env.window.fetch = (url: string) => {
      calls.push(url);
      return Promise.resolve({ json: () => Promise.resolve({ action: "x", obj: "x", outcome: "refused", result: { ok: false, status: 409, code: "MANDATE_NOT_ACTIVE" } }) });
    };
    return calls;
  };
  const btn = (env: PageEnv, act: string) => $(env, "b-ctl").querySelectorAll("button[data-act]").filter((b) => b.dataset.act === act);

  it("В2: без режима показа или сбоев кнопок нет — экран прежний", () => {
    const env = start();
    env.sources[0]!.send(msg);
    expect($(env, "b-ctl").querySelectorAll("button[data-act]")).toEqual([]);
    expect($(env, "b-ctl").textContent).toContain(ru("ctl.wait.action"));
  });

  it("условие 3 Р-1527 (В4): одно нажатие «Отозвать» стенд не вызывает; запрос — только после «Да, отозвать»; «Отмена» — без запроса", async () => {
    const env = start({ actions: true });
    const calls = withFetch(env);
    env.sources[0]!.send(msg);
    btn(env, "revoke")[0]!.click();
    expect(calls).toEqual([]);
    expect($(env, "b-ctl").textContent).toContain(ru("act.revoke.ask"));
    $(env, "b-ctl").querySelector("button[data-act-cancel]")!.click();
    expect(calls).toEqual([]);
    btn(env, "revoke")[0]!.click();
    const second = btn(env, "revoke").find((b) => b.dataset.second === "1")!;
    second.click();
    expect(calls).toEqual(["/pult/act/revoke?mandate=IT1"]);
    // Условие 1: ответ стенда «отказано» — на экране отказ с кодом, не «сделано».
    await new Promise((r) => setTimeout(r, 0));
    const res = $(env, "b-ctl").querySelectorAll(".act-result").map((x) => x.textContent).join(" ");
    expect(res).toContain(`${ru("act.refused")} · 409 · MANDATE_NOT_ACTIVE`);
    expect(res).not.toContain(ru("act.done"));
  });

  it("Р-1542: конфликт звеньев (несколько корзин, одно намерение) — «Остановить» и «Отозвать» неактивны с пояснением, запросов нет; «Напомнить» по номеру запроса и «Передать на разбор» — доступны", () => {
    for (const lang of ["ru", "en"] as const) {
      const env = start({ actions: true, lang });
      const calls = withFetch(env);
      const conflict = { ...msg, board: { ...msg.board, cards: [{ ...card("CT1", "confirmation"), intentId: "IT1", linkConflict: true }] } };
      env.sources[0]!.send(conflict);
      const box = $(env, "b-ctl");
      expect(btn(env, "stop"), lang).toEqual([]);
      expect(btn(env, "revoke"), lang).toEqual([]);
      const off = box.querySelectorAll(".act-off").map((x) => x.textContent);
      expect(off.filter((t) => t.includes(PULT["act.conflict"][lang])), lang).toHaveLength(2);
      expect(off.some((t) => t.startsWith(PULT["act.revoke"][lang]) && t.includes(PULT["act.conflict"][lang])), lang).toBe(true);
      expect(off.some((t) => t.startsWith(PULT["act.stop"][lang]) && t.includes(PULT["act.conflict"][lang])), lang).toBe(true);
      // Нажатие неактивной кнопки — без запроса.
      for (const b of box.querySelectorAll(".act-off").flatMap((x) => x.querySelectorAll("button"))) b.click();
      expect(calls, lang).toEqual([]);
      // «Напомнить» — по однозначному номеру запроса (Q1), «Передать на разбор» — у паспорта.
      expect(btn(env, "remind").map((b) => b.dataset.params), lang).toEqual(["confirmation=Q1"]);
      expect(btn(env, "review").length, lang).toBeGreaterThan(0);
    }
  });

  it("Р-1542, ревью № 1, 2: «Отозвать» нажато до конфликта — ответ стенда остаётся под строкой, начатый первый шаг снимается", async () => {
    const env = start({ actions: true });
    withFetch(env);
    env.sources[0]!.send(msg);
    btn(env, "revoke")[0]!.click();
    btn(env, "revoke").find((b) => b.dataset.second === "1")!.click();
    await new Promise((r) => setTimeout(r, 0));
    // Первый шаг снова — и тут транзакция стала конфликтной.
    btn(env, "revoke")[0]!.click();
    const conflict = { ...msg, board: { ...msg.board, cards: [{ ...card("CT1", "confirmation"), intentId: "IT1", linkConflict: true }] } };
    env.sources[0]!.send(conflict);
    const res = $(env, "b-ctl").querySelectorAll(".act-result").map((x) => x.textContent).join(" ");
    expect(res).toContain(`${ru("act.refused")} · 409 · MANDATE_NOT_ACTIVE`);
    expect($(env, "b-ctl").textContent).not.toContain(ru("act.revoke.ask"));
    // Конфликт снят — вопрос «Да, отозвать» не всплывает сам.
    env.sources[0]!.send(msg);
    expect($(env, "b-ctl").textContent).not.toContain(ru("act.revoke.ask"));
  });

  it("условие 2 Р-1527 (В1 (а)): «Напомнить» у R08 уходит на «remind_note» (без стенда), у R21 — на стенд; «Повторить уведомление» неактивна; разбор при «не определён» — неактивен", () => {
    const env = start({ actions: true });
    const calls = withFetch(env);
    env.sources[0]!.send(msg);
    const reminds = btn(env, "remind_note");
    expect(reminds).toHaveLength(1);
    reminds[0]!.click();
    expect(calls).toEqual(["/pult/act/remind_note?obj=IM1&cond=R08"]);
    btn(env, "remind")[0]!.click();
    expect(calls[1]).toBe("/pult/act/remind?confirmation=Q1");
    const off = $(env, "b-ctl").querySelectorAll("button[disabled]").map((b) => b.textContent);
    expect(off).toEqual(expect.arrayContaining([ru("act.notify"), ru("act.review")]));
    expect($(env, "b-ctl").textContent).toContain(ru("act.notify.none"));
    expect($(env, "b-ctl").textContent).toContain(ru("act.review.undetermined"));
    expect(btn(env, "review").map((b) => b.dataset.params)).toEqual(["mandate_id=CT1&condition=R46&violator=AGENT"]);
  });

  it("ревью П-8.1 № 1, 2: разбор — поле по типу номера (`cart:` → mandate_id, `order:` → order_id, `op:` → op_ref), «Остановить» — только при поручении корзины", () => {
    const env = start({ actions: true });
    withFetch(env);
    const c2 = {
      ...ctl,
      passports: [
        { obj: "cart:CA", findings: [{ cond: "R26", violator: "merchant" }] },
        { obj: "order:ORD-1", findings: [{ cond: "R26", violator: "merchant" }] },
        { obj: "op:P1", findings: [{ cond: "R46", violator: "agent" }] },
        { obj: "CT1", findings: [{ cond: "R46", violator: "agent" }] },
      ],
      waits: [],
      active: [
        { id: "CT1", column: "confirmation", since: T0 },
        { id: "op:P1", column: "confirmation", since: T0 },
      ],
    };
    // Номер корзины нарочно не равен номеру карточки (повторное ревью № 3): в стенд уходит именно `cartMandateId`.
    const cards = [{ ...card("CT1", "confirmation"), cartMandateId: "CART-9" }, card("op:P1", "confirmation")];
    env.sources[0]!.send({ type: "board", board: { now: NOW, cards, jumps: [], control: c2 } });
    expect(btn(env, "review").map((b) => b.dataset.params)).toEqual([
      "mandate_id=CA&condition=R26&violator=MERCHANT",
      "order_id=ORD-1&condition=R26&violator=MERCHANT",
      "op_ref=P1&condition=R46&violator=AGENT",
      "mandate_id=CT1&condition=R46&violator=AGENT",
    ]);
    expect(btn(env, "stop").map((b) => b.dataset.params)).toEqual(["cart=CART-9"]);
  });

  it("ревью П-8.1 № 5: «Напомнить» без продления — не «сделано», а «срок не продлён» с прежним сроком", async () => {
    const env = start({ actions: true });
    env.window.fetch = () =>
      Promise.resolve({ json: () => Promise.resolve({ action: "remind", obj: "Q1", outcome: "done", result: { ok: true, expiresAt: "2026-11-10T12:05:00.000Z", extended: false } }) });
    env.sources[0]!.send(msg);
    btn(env, "remind")[0]!.click();
    await new Promise((r) => setTimeout(r, 0));
    const res = $(env, "b-ctl").querySelectorAll(".act-result").map((x) => x.textContent).join(" ");
    expect(res).toContain(ru("act.not_extended"));
    expect(res).not.toContain(ru("act.done"));
  });
});

// Видимая часть П-11.2 / П-11.4 (Р-1482, Р-1514): блок «Поломки» и строка эмулятора клиента — только в режиме сбоев.
describe("«Поломки» и «Авто» на пульте (видимая часть П-11.2 / П-11.4)", () => {
  const H03 = encodeURIComponent("Н-03");
  const withFetch = (env: PageEnv, answer: (url: string) => unknown) => {
    const calls: string[] = [];
    env.window.fetch = (url: string) => {
      calls.push(url);
      return Promise.resolve({ json: () => Promise.resolve(answer(url)) });
    };
    return calls;
  };
  const faultBtn = (env: PageEnv, test: string, op: "arm" | "disarm") =>
    $(env, "pult-faults").querySelectorAll("button[data-fault]").find((b) => b.dataset.fault === test && b.dataset.faultOp === op)!;
  const result = (env: PageEnv, test: string) => $(env, "pult-faults").querySelectorAll("[data-fault-result]").find((x) => x.dataset.faultResult === test)!.textContent;
  const tick = () => new Promise((r) => setTimeout(r, 0));

  it("без режима сбоев блока нет — ни кнопок, ни строки «Авто»", () => {
    for (const lang of ["ru", "en"] as const) {
      const env = start({ lang });
      expect(env.document.getElementById("pult-faults"), lang).toBeNull();
      expect(env.document.getElementById("client-auto"), lang).toBeNull();
      expect(env.document.querySelectorAll("button[data-fault]"), lang).toEqual([]);
    }
  });

  // Ответ сервера по форме `StandFaultResult`: тест из адреса, витрина — какую взвёл сервер (выбранную им самим тоже).
  const testOf = (url: string) => decodeURIComponent(url.split("/")[2]!);
  const serverAnswer = (url: string) =>
    url.includes("/disarm")
      ? { ok: false, code: "NOT_ARMED" }
      : { ok: true, test: testOf(url), options: url.includes("merchant_id=") ? { merchant_id: new URLSearchParams(url.split("?")[1]).get("merchant_id") } : testOf(url) === "Н-02" ? {} : { merchant_id: "m-chosen" } };

  it("в режиме сбоев: шесть тестов «П» стенда; витрина — только у Н-03…Н-05 и только при транзакции в фокусе; ответ — как есть, с витриной из ответа", async () => {
    const env = start({ faults: true });
    const calls = withFetch(env, serverAnswer);
    expect(new Set($(env, "pult-faults").querySelectorAll("button[data-fault]").map((b) => b.dataset.fault))).toEqual(new Set(STAND_FAULT_TESTS));
    env.sources[0]!.send({ type: "board", board: { now: NOW, cards: [{ ...card("T1", "pay"), merchantIds: ["m-shop1"] }], jumps: [] } });
    // Без фокуса — витрину выбирает сервер; на экране — его выбор из ответа (ревью № 3).
    faultBtn(env, "Н-04", "arm").click();
    await tick();
    expect(result(env, "Н-04")).toBe(`${ru("faults.armed")} · m-chosen`);
    env.document.dispatchEvent(new FakeEvent("pult:select", { detail: { tx: "T1" } }));
    faultBtn(env, "Н-03", "arm").click();
    faultBtn(env, "Н-02", "arm").click();
    expect(calls).toEqual([`/stand-fault/${encodeURIComponent("Н-04")}/arm`, `/stand-fault/${H03}/arm?merchant_id=m-shop1`, `/stand-fault/${encodeURIComponent("Н-02")}/arm`]);
    await tick();
    expect(result(env, "Н-03")).toBe(`${ru("faults.armed")} · m-shop1`);
    expect(result(env, "Н-02")).toBe(ru("faults.armed"));
    // Отказ сервера — «отказано» с кодом, не «сделано»; ответ не JSON (403 текстом) — «отказано · HTTP 403» (ревью № 6).
    faultBtn(env, "Н-03", "disarm").click();
    await tick();
    expect(result(env, "Н-03")).toBe(`${ru("faults.refused")} · NOT_ARMED`);
    env.window.fetch = () => Promise.resolve({ status: 403, json: () => Promise.reject(new SyntaxError("text")) });
    faultBtn(env, "Н-11", "arm").click();
    await tick();
    expect(result(env, "Н-11")).toBe(`${ru("faults.refused")} · HTTP 403`);
  });

  it("ревью № 2, 3, 7: ответ — только на последнее нажатие и только о своём тесте; витрина в фокусе не определена — запроса нет", async () => {
    const env = start({ faults: true });
    // Ответы приходят в обратном порядке: сначала на «снять», потом на «взвести».
    const pending: Array<{ url: string; resolve: (v: unknown) => void }> = [];
    env.window.fetch = (url: string) => new Promise((resolve) => pending.push({ url, resolve: (v) => resolve({ json: () => Promise.resolve(v) }) }));
    faultBtn(env, "Н-12", "arm").click();
    faultBtn(env, "Н-12", "disarm").click();
    pending[1]!.resolve({ ok: true, test: "Н-12", options: {} });
    await tick();
    pending[0]!.resolve({ ok: true, test: "Н-12", options: {} });
    await tick();
    expect(result(env, "Н-12")).toBe(ru("faults.disarmed"));
    // Ответ «ok» о другом тесте — не «сделано».
    faultBtn(env, "Н-11", "arm").click();
    pending[2]!.resolve({ ok: true, test: "Н-02", options: {} });
    await tick();
    expect(result(env, "Н-11")).toBe(ru("act.failed"));
    // Транзакция в фокусе с двумя продавцами или без карточки — запрос не уходит, человеку сказано почему.
    env.sources[0]!.send({ type: "board", board: { now: NOW, cards: [{ ...card("T2", "pay"), merchantIds: ["m-a", "m-b"] }], jumps: [] } });
    env.document.dispatchEvent(new FakeEvent("pult:select", { detail: { tx: "T2" } }));
    faultBtn(env, "Н-05", "arm").click();
    env.document.dispatchEvent(new FakeEvent("pult:select", { detail: { tx: "T-нет" } }));
    faultBtn(env, "Н-03", "arm").click();
    expect(pending).toHaveLength(3);
    expect(result(env, "Н-05")).toBe(ru("faults.shop_ambiguous"));
    expect(result(env, "Н-03")).toBe(ru("faults.shop_ambiguous"));
  });

  it("строка «Авто»: начальный режим — с сервера (эмулятор), затем по доске; доска без шага режима известный режим не сбрасывает; переключатель — POST, ответ как есть", async () => {
    const unknown = start({ faults: true, lang: "en" });
    expect($(unknown, "client-auto").textContent).toBe(PULT["auto.unknown"].en);
    const env = start({ faults: true, lang: "en", clientAuto: true });
    const calls = withFetch(env, (url) => ({ auto: url.endsWith("/on") }));
    expect($(env, "client-auto").textContent).toBe(PULT["auto.on"].en);
    // Шаг режима ушёл из окна записей — доска без `clientAuto`: строка остаётся «авто» (ревью № 4, П5 п. 3).
    env.sources[0]!.send({ type: "board", board: { now: NOW, cards: [], jumps: [] } });
    expect($(env, "client-auto").textContent).toBe(PULT["auto.on"].en);
    env.sources[0]!.send({ type: "board", board: { now: NOW, cards: [], jumps: [], clientAuto: false } });
    expect($(env, "client-auto").textContent).toBe(PULT["auto.off"].en);
    $(env, "pult-faults").querySelector("button[data-auto='on']")!.click();
    expect(calls).toEqual(["/client/auto/on"]);
    await tick();
    expect($(env, "client-auto").textContent).toBe(PULT["auto.on"].en);
  });

  it("ревью № 11: переподключение после перезапуска стенда — режим из `hello` источника, а не запомненный страницей", () => {
    const env = start({ faults: true, clientAuto: true });
    const es = env.sources[0]!;
    es.send({ type: "hello", status: "live", faults: true, clientAuto: true });
    es.send({ type: "board", board: { now: NOW, cards: [], jumps: [], clientAuto: true } });
    expect($(env, "client-auto").textContent).toBe(ru("auto.on"));
    // Стенд перезапущен: новый эмулятор во «Вручную», шага режима нет; EventSource переподключился — новый `hello`.
    es.send({ type: "hello", status: "live", faults: true, clientAuto: false });
    es.send({ type: "board", board: { now: NOW, cards: [], jumps: [] } });
    expect($(env, "client-auto").textContent).toBe(ru("auto.off"));
    // `hello` без режима (эмулятора нет) известный режим не трогает.
    es.send({ type: "hello", status: "live", faults: true });
    expect($(env, "client-auto").textContent).toBe(ru("auto.off"));
  });
});

// П-6.1а: панель «Журнал» — журнал действий (нажатия и решения клиента строками, В1 (а)) и протокол П-NNN с фильтром.
describe("панель «Журнал» (П-6.1а)", () => {
  const T = (s: number) => new Date(Date.UTC(2026, 10, 13, 12, 0, s)).toISOString();
  const protocol = {
    entries: [
      { no: "П-001", type: "warn", cond: "R21", obj: "C1", at: T(15), status: "prevented", reactedAt: T(20), reaction: "remind", reactSec: 5, endedAt: T(40) },
      { no: "П-002", type: "fired", cond: "R17", obj: "I2", at: T(30), status: "stopped", protector: "agent" },
      { no: "П-003", type: "bad", cond: "R46", obj: "C3", at: T(35), status: "open", violator: "agent" },
    ],
    decisions: [{ obj: "C4", cond: "R09", at: T(10) }],
    counts: { open: 1, reacted: 0, prevented: 1, cleared: 0, closed: 0, stopped: 1 },
    avgReactSec: 5,
  };
  const reactions = [{ at: T(20), action: "remind", obj: "Q1", cond: "R21", outcome: "done", result: { ok: true, status: 200 }, link: { state: "linked", seq: 7, what: "CLIENT_REMINDED", at: T(20) } }];

  it("без движка — так и сказано; с протоколом — строки, счётчики, среднее до реакции, решение клиента в журнале действий; фильтр по статусу", () => {
    for (const lang of ["ru", "en"] as const) {
      const env = start({ lang });
      env.sources[0]!.send(boardMsg([]));
      expect($(env, "b-log").textContent, lang).toContain(PULT["int.no_engine"][lang]);
      env.sources[0]!.send({ type: "board", board: { now: NOW, cards: [], jumps: [], protocol, reactions } });
      const box = $(env, "b-log");
      const rows = box.querySelectorAll(".proto-row");
      // Новые — сверху.
      expect(rows.map((r) => r.dataset.status)).toEqual(["open", "stopped", "prevented"]);
      expect(rows[2]!.textContent).toContain(`П-001`);
      expect(rows[2]!.textContent).toContain(PULT["proto.st.prevented"][lang]);
      expect(rows[2]!.textContent).toContain(`${PULT["log.react"][lang]} 5 ${PULT["card.sec"][lang]}`);
      expect(rows[1]!.textContent).toContain(`${PULT["ctl.protector"][lang]}: ${PULT["subj.agent"][lang]}`);
      expect(box.textContent).toContain(`${PULT["log.avg"][lang]}: 5`);
      // Журнал действий: решение клиента (раньше по времени) — строкой, затем нажатие.
      const log = box.querySelectorAll(".log-row").map((r) => r.textContent);
      expect(log).toHaveLength(2);
      expect(log[0]).toContain(PULT["log.decision"][lang]);
      expect(log[1]).toContain(PULT["act.kind.remind"][lang]);
      // Решение клиента в протоколе не появляется (В1 (а)).
      expect(rows.some((r) => r.textContent.includes("C4"))).toBe(false);
      box.querySelectorAll("button[data-proto-filter]").find((b) => b.dataset.protoFilter === "stopped")!.click();
      expect(box.querySelectorAll(".proto-row").map((r) => r.dataset.status)).toEqual(["stopped"]);
      box.querySelectorAll("button[data-proto-filter]").find((b) => b.dataset.protoFilter === "")!.click();
      expect(box.querySelectorAll(".proto-row")).toHaveLength(3);
    }
  });

  it("П-6.2 «Отчёт»: по кнопке — запрос json, время сборки, итоги и строки акта текстом, три выгрузки ссылками на файл; отказ — с кодом; ru/en", async () => {
    for (const lang of ["ru", "en"] as const) {
      const env = start({ lang });
      const calls: string[] = [];
      const body = {
        builtAt: "2026-11-13T20:55:07.000Z",
        totals: { tests: 25, yes: 1, no: 1, noCase: 0, unchecked: 23 },
        agreeLabels: { yes: { ru: "да", en: "yes" }, no: { ru: "нет", en: "no" }, no_case: { ru: "нет случая", en: "no case" }, unchecked: { ru: "не проверено", en: "not checked" } },
        rows: [
          { test: "П-01", kind: { ru: "правильный", en: "correct" }, expected: { ru: "<b>x</b>", en: "<b>x</b>" }, fact: { ru: "ф", en: "f" }, agree: "yes", agreeLabel: { ru: "да", en: "yes" }, note: { ru: "", en: "" }, auto: false, violatorDriver: false, run: "run.purchase" },
          { test: "Н-08", kind: { ru: "неправильный", en: "incorrect" }, expected: { ru: "о", en: "e" }, fact: { ru: "ф", en: "f" }, agree: "no", agreeLabel: { ru: "нет", en: "no" }, note: { ru: "", en: "" }, auto: true, violatorDriver: true, run: "run.fault Н-08" },
        ],
        unlinked: 2,
      };
      env.window.fetch = (url: string) => {
        calls.push(url);
        return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
      };
      env.sources[0]!.send(boardMsg([]));
      const box = $(env, "b-log");
      expect(box.textContent, lang).toContain(PULT["report.none"][lang]);
      box.querySelectorAll("button[data-report]")[0]!.click();
      expect(calls, lang).toEqual([`/pult/report?format=json&lang=${lang}`]);
      await new Promise((r) => setTimeout(r, 0));
      const at = box.querySelectorAll(".report-at")[0]!.textContent;
      expect(at, lang).toContain(PULT["report.built"][lang]);
      // Само время сборки, а не только подпись (ревью П-6.2 № 10): минуты и секунды из `builtAt`.
      expect(at, lang).toMatch(/\d{2}:55:07/);
      expect(box.textContent, lang).toContain(`${PULT["report.tests"][lang]}: 25`);
      const rows = box.querySelectorAll(".report-row");
      expect(rows.map((r) => r.dataset.agree), lang).toEqual(["yes", "no"]);
      // Данные — текстом (инвариант 4): разметка в данных не становится разметкой.
      expect(rows[0]!.textContent, lang).toContain("<b>x</b>");
      expect(rows[1]!.textContent, lang).toContain(PULT["report.violator"][lang]);
      expect(box.textContent, lang).toContain(`${PULT["report.unlinked"][lang]}: 2`);
      const links = box.querySelectorAll("a");
      expect(links.map((a) => a.getAttribute("href")), lang).toEqual(["md", "csv", "csv_excel"].map((f) => `/pult/report?format=${f}&lang=${lang}`));
      expect(links.map((a) => a.textContent), lang).toEqual(ACC1_EXPORTS.map((f) => ACC1_EXPORT_LABEL[f][lang]));
      // Отказ сервера — «не собран» с кодом.
      env.window.fetch = () => Promise.resolve({ ok: false, json: () => Promise.resolve({ error: "NO_ENGINE" }) });
      box.querySelectorAll("button[data-report]")[0]!.click();
      await new Promise((r) => setTimeout(r, 0));
      expect(box.textContent, lang).toContain(`${PULT["report.failed"][lang]} · NO_ENGINE`);
    }
  });

  it("ревью П-8.2 № 5: код записи стенда в строке журнала — словами ru/en; перечень словаря — из источника (`REACTION_RECORDS`, Р-1511)", () => {
    for (const w of REACTION_RECORDS) for (const lang of ["ru", "en"] as const) expect(PULT[`act.what.${w}` as keyof typeof PULT]?.[lang], `${w} ${lang}`).toBeTruthy();
    const dict = Object.keys(PULT).filter((k) => k.startsWith("act.what.")).map((k) => k.slice("act.what.".length));
    expect(new Set(dict)).toEqual(new Set(REACTION_RECORDS));
    for (const lang of ["ru", "en"] as const) {
      const env = start({ lang });
      env.sources[0]!.send({ type: "board", board: { now: NOW, cards: [], jumps: [], reactions } });
      const row = $(env, "b-log").querySelectorAll(".log-row")[0]!.textContent;
      expect(row, lang).toContain(`(${PULT["act.what.CLIENT_REMINDED"][lang]})`);
      expect(row, lang).not.toContain("CLIENT_REMINDED");
    }
  });
});
