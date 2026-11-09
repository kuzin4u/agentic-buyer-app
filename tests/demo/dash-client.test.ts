// К1.4а: скрипт экрана «Интерпретация» (`public/dash/interpret.js`) на фальшивом DOM — без браузера. Проверяется, что
// показывает скрипт: ситуация у нормы — нейтрально (З1), текст реестра — только в служебном виде (З2), значок и класс
// состояния ленты (З7), пометка учебной витрины (З10); шапка и переключатель языка — по разметке и CSS (З11, Р-1364).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Interpretation } from "../../src/dashboards/interpret.js";
import { CONTROL, SCREEN } from "../../src/dashboards/phrases.js";
import { interpretPage } from "../../src/demo/dash.js";

const SCRIPT = readFileSync(new URL("../../src/demo/public/dash/interpret.js", import.meta.url), "utf8");
const CSS = readFileSync(new URL("../../src/demo/public/dash/dash.css", import.meta.url), "utf8");

/** Узел фальшивого DOM: только то, чем пользуется скрипт экрана. */
class Node {
  readonly children: Node[] = [];
  parent: Node | null = null;
  textContent = "";
  className = "";
  hidden = false;
  checked = false;
  readonly dataset: Record<string, string> = {};
  readonly listeners: Record<string, (() => void)[]> = {};
  constructor(readonly tag: string, readonly id = "") {}
  readonly classList = {
    add: (c: string) => {
      if (!this.classes().includes(c)) this.className = [...this.classes(), c].join(" ");
    },
    contains: (c: string) => this.classes().includes(c),
    toggle: (c: string, on: boolean) => {
      const rest = this.classes().filter((x) => x !== c);
      this.className = (on ? [...rest, c] : rest).join(" ");
    },
  };
  classes(): string[] {
    return this.className.split(/\s+/).filter(Boolean);
  }
  appendChild(n: Node): Node {
    n.parent = this;
    this.children.push(n);
    return n;
  }
  insertBefore(n: Node, ref: Node | null): Node {
    n.parent = this;
    const i = ref ? this.children.indexOf(ref) : this.children.length;
    this.children.splice(i < 0 ? this.children.length : i, 0, n);
    return n;
  }
  removeChild(n: Node): Node {
    this.children.splice(this.children.indexOf(n), 1);
    n.parent = null;
    return n;
  }
  get firstChild(): Node | null {
    return this.children[0] ?? null;
  }
  get lastElementChild(): Node | null {
    return this.children[this.children.length - 1] ?? null;
  }
  get nextSibling(): Node | null {
    const s = this.parent?.children;
    return s ? s[s.indexOf(this) + 1] ?? null : null;
  }
  get previousElementSibling(): Node | null {
    const s = this.parent?.children;
    return s ? s[s.indexOf(this) - 1] ?? null : null;
  }
  addEventListener(type: string, fn: () => void): void {
    (this.listeners[type] ??= []).push(fn);
  }
  /** Все потомки (в глубину). */
  all(): Node[] {
    return this.children.flatMap((c) => [c, ...c.all()]);
  }
  text(): string {
    return this.textContent + this.children.map((c) => c.text()).join("");
  }
}

interface Screen {
  tbody: Node;
  status: Node;
  icon: Node;
  conn: Node;
  details: Node;
  send(m: unknown): void;
  error(): void;
}

function screen(lang: "ru" | "en", labels: Record<string, string>): Screen {
  const nodes: Record<string, Node> = {};
  for (const id of ["status", "diag", "details", "empty", "status-icon", "conn"]) nodes[id] = new Node("span", id);
  nodes["i18n"] = new Node("script", "i18n");
  nodes["i18n"]!.textContent = JSON.stringify({ lang, labels, situations: { "С-25": "Карточка корзины" } });
  const tbody = new Node("tbody");
  let es: { onmessage?: (m: { data: string }) => void; onerror?: () => void } = {};
  const document = {
    getElementById: (id: string) => nodes[id] ?? null,
    querySelector: (q: string) => (q === "#feed tbody" ? tbody : null),
    createElement: (tag: string) => new Node(tag),
  };
  class EventSource {
    constructor() {
      es = this as typeof es;
    }
  }
  new Function("document", "EventSource", SCRIPT)(document, EventSource);
  return {
    tbody,
    status: nodes["status"]!,
    icon: nodes["status-icon"]!,
    conn: nodes["conn"]!,
    details: nodes["details"]!,
    send: (m) => es.onmessage!({ data: JSON.stringify(m) }),
    error: () => es.onerror!(),
  };
}

/** Словарь экрана одного языка — как его отдаёт страница (`dash.ts`). */
function labels(lang: "ru" | "en"): Record<string, string> {
  const page = interpretPage(lang, { name: "Банк", colors: {} } as never, false, {});
  const json = /<script id="i18n" type="application\/json">(.*?)<\/script>/s.exec(page)![1]!;
  return (JSON.parse(json) as { labels: Record<string, string> }).labels;
}

const base = { at: "2026-11-09T10:54:03.200Z", stream: "scenario", ref: "cart.card", level: "key", stage: "cart", actor: "agent", emulated: false } as const;
const norm: Interpretation = { ...base, seq: 1, kind: "norm", phrase: { ru: "Клиенту показана карточка корзины", en: "The client sees the cart card" }, situation: "С-25" };
const conflict: Interpretation = {
  ...base,
  seq: 2,
  stream: "console",
  stage: "search",
  kind: "conflict",
  phrase: { ru: "Агент отметил предложение: цена в описании не совпадает с ценой витрины", en: "x" },
  who: { code: "A5_PRICE_MISMATCH", status: "found", side: ["merchant"], verdict: "expected", operator: { ru: "Правило A5: цена не та, что в price; found — null" } },
  situation: "С-25",
};
const training: Interpretation = {
  ...base,
  seq: 3,
  stream: "console",
  stage: "search",
  kind: "error",
  phrase: { ru: "Агент исключил предложения продавца MER-5501: в карточке продавца не заполнено обязательное поле", en: "x" },
  who: { code: "REQUIRED", status: "found", side: ["merchant"], verdict: "failure" },
  training: true,
};

const rowCells = (s: Screen, seq: number) => s.tbody.children.find((r) => r.dataset["seq"] === String(seq))!.children;

describe("скрипт экрана «Интерпретация» (К1.4а)", () => {
  for (const lang of ["ru", "en"] as const) {
    it(`${lang}: ситуация у нормы — нейтрально, без класса предупреждения; у конфликта — с ним (З1)`, () => {
      const s = screen(lang, labels(lang));
      s.send({ type: "snapshot", items: [norm, conflict], status: "open", diag: { state: "ready" } });
      const normSit = rowCells(s, 1)[6]!;
      expect(normSit.classList.contains("situation-neutral")).toBe(true);
      expect(normSit.classList.contains("situation-alert")).toBe(false);
      expect(normSit.all().some((n) => n.tag === "strong")).toBe(false);
      expect(normSit.text()).toContain(`${SCREEN["situation.label"][lang]} С-25`);
      const conflictSit = rowCells(s, 2)[6]!;
      expect(conflictSit.classList.contains("situation-alert")).toBe(true);
    });

    it(`${lang}: текст реестра для оператора — только в служебном виде; код — в «Кто ошибся» (З2)`, () => {
      const s = screen(lang, labels(lang));
      s.send({ type: "snapshot", items: [conflict], status: "open", diag: { state: "ready" } });
      const who = rowCells(s, 2)[5]!;
      expect(who.all().find((n) => n.tag === "code")!.textContent).toBe("A5_PRICE_MISMATCH");
      const op = who.all().find((n) => n.classList.contains("operator"))!;
      expect(op.classList.contains("service-only")).toBe(true);
      // CSS: служебное скрыто, пока не отмечено «Показать служебные обращения».
      expect(CSS).toMatch(/\.service-only\s*\{\s*display:\s*none;/);
      expect(CSS).toMatch(/tbody\.show-details \.service-only\s*\{\s*display:\s*block;/);
    });

    it(`${lang}: состояние ленты — значок, класс и текст на каждый статус; обрыв — «потеряна связь» (З7)`, () => {
      const L = labels(lang);
      const s = screen(lang, L);
      expect(s.conn.className).toBe("conn conn-wait");
      for (const [status, cls, icon] of [
        ["open", "conn-ok", "●"],
        ["connecting", "conn-wait", "◌"],
        ["reset", "conn-wait", "◌"],
        ["closed", "conn-lost", "✕"],
      ] as const) {
        s.send({ type: "status", status });
        expect(s.conn.className).toBe(`conn ${cls}`);
        expect(s.icon.textContent).toBe(icon);
        expect(s.status.textContent).toBe(L[`status.${status}`]);
      }
      s.error();
      expect(s.conn.className).toBe("conn conn-lost");
      expect(s.status.textContent).toBe(L["status.screen_offline"]);
    });

    it(`${lang}: учебная витрина — пометка «учебный сбой витрины» (З10); у нормы пометки нет`, () => {
      const s = screen(lang, labels(lang));
      s.send({ type: "snapshot", items: [norm, training], status: "open", diag: { state: "ready" } });
      expect(rowCells(s, 3)[3]!.text()).toContain(SCREEN.training[lang]);
      expect(rowCells(s, 1)[3]!.all().some((n) => n.classList.contains("training"))).toBe(false);
    });
  }

  it("шапка: переключатель языка — отдельным блоком, не сжимается и не переносится внутри; шапка переносится; узкий экран — своя строка (З11)", () => {
    for (const lang of ["ru", "en"] as const) {
      const page = interpretPage(lang, { name: "Банк", colors: {} } as never, false, {});
      const other = lang === "ru" ? "en" : "ru";
      expect(page).toMatch(new RegExp(`<span class="lang-switch">[^<]*<strong>${lang}</strong> · <a href="/dash/interpret\\?lang=${other}">${other}</a></span>`));
      expect(page).toContain('<span id="conn" class="conn conn-wait"><span id="status-icon" class="conn-icon" aria-hidden="true">◌</span>');
    }
    expect(CSS).toMatch(/header\s*\{[^}]*flex-wrap:\s*wrap/);
    expect(CSS).toMatch(/header nav\s*\{[^}]*flex-wrap:\s*wrap/);
    expect(CSS).toMatch(/header \.lang-switch\s*\{[^}]*flex-shrink:\s*0;[^}]*white-space:\s*nowrap/);
    expect(CSS).toMatch(/@media \(max-width: 400px\)\s*\{[^@]*header nav\s*\{[^}]*width:\s*100%/);
    // Ничего в шапке не прячется и не обрезается.
    const header = CSS.split("\n").filter((l) => l.startsWith("header"));
    expect(header.join("\n")).not.toMatch(/display:\s*none|overflow:\s*hidden|text-overflow/);
  });
});

// --- К2.3б: скрипт экрана «Контроль» (public/dash/control.js) на том же фальшивом DOM ---

const CONTROL_SCRIPT = readFileSync(new URL("../../src/demo/public/dash/control.js", import.meta.url), "utf8");

function controlScreen(lang: "ru" | "en") {
  const nodes: Record<string, Node> = {};
  for (const id of ["runs", "empty", "status", "status-icon", "conn"]) nodes[id] = new Node("div", id);
  nodes["i18n"] = new Node("script", "i18n");
  nodes["i18n"]!.textContent = JSON.stringify({ lang, labels: Object.fromEntries(Object.entries(CONTROL).map(([k, v]) => [k, v[lang]])) });
  let es: { onmessage?: (m: { data: string }) => void; onerror?: () => void } = {};
  const posts: unknown[] = [];
  const document = { getElementById: (id: string) => nodes[id] ?? null, createElement: (tag: string) => new Node(tag) };
  class EventSource {
    constructor() {
      es = this as typeof es;
    }
  }
  const fetch = (url: string, init: { body: string }) => (posts.push({ url, body: JSON.parse(init.body) }), Promise.resolve({ ok: true }));
  new Function("document", "EventSource", "fetch", CONTROL_SCRIPT)(document, EventSource, fetch);
  return { box: nodes["runs"]!, empty: nodes["empty"]!, conn: nodes["conn"]!, posts, send: (runs: unknown[]) => es.onmessage!({ data: JSON.stringify({ type: "runs", epoch: "e1", runs }) }), error: () => es.onerror!() };
}

const item = (id: string, state: string, met: boolean, reasons: string[] = []) => ({ id, what: { ru: `пункт ${id}`, en: `item ${id}` }, type: "expect", state, reasons, met, count: 0, seqs: [] });
const result = (state: string, items: unknown[]) => ({ no: 1, state, accepted: state === "accepted" ? 2 : 0, met: 2, total: 2, items, deadline: "2026-11-09T12:00:15.000Z" });
const view = (key: number, extra: Record<string, unknown>) => ({ key, name: "intent", no: 1, title: { ru: "1. Подпись поручения", en: "1. Mandate signature" }, startedAt: "2026-11-09T12:00:00.000Z", early: { next: false, prev: false }, ...extra });

describe("скрипт экрана «Контроль» (К2.3б)", () => {
  for (const lang of ["ru", "en"] as const) {
    it(`${lang}: до срока — «ждёт», «выполнено N из N», кнопок вердикта нет; «не принято» до срока — тоже без кнопок; после срока — кнопки; пункты — с причинами словами`, () => {
      const s = controlScreen(lang);
      s.send([view(10, { closed: false, result: result("waiting", [item("a", "waiting", true), item("b", "waiting", true)]) })]);
      const card = s.box.children[0]!;
      expect(card.text()).toContain(CONTROL["state.waiting"][lang]);
      expect(card.text()).toContain(`${CONTROL.met[lang]} 2 ${CONTROL.of[lang]} 2`);
      expect(card.text()).toContain(CONTROL["verdict.wait"][lang]);
      expect(card.all().some((n) => n.tag === "button")).toBe(false);
      expect(s.empty.hidden).toBe(true);

      // «Не принято» до срока (ревью К2.3б № 1, № 2): кнопок нет — вердикт только после срока.
      s.send([view(10, { closed: false, result: result("rejected", [item("b", "rejected", false, ["forbidden"])]) })]);
      expect(s.box.children[0]!.all().some((n) => n.tag === "button")).toBe(false);
      expect(s.box.children[0]!.text()).toContain(CONTROL["verdict.wait"][lang]);

      s.send([view(10, { closed: true, result: result("rejected", [item("a", "accepted", true), item("b", "rejected", false, ["missing"])]) })]);
      const c2 = s.box.children[0]!;
      expect(c2.text()).toContain(`${lang === "ru" ? "пункт b" : "item b"} — ${CONTROL["state.rejected"][lang]} (${CONTROL["reason.missing"][lang]})`);
      expect(c2.text()).not.toContain(lang === "ru" ? "пункт a" : "item a"); // принятое — свёрнуто
      const buttons = c2.all().filter((n) => n.tag === "button");
      expect(buttons.map((b) => b.dataset["decision"])).toEqual(["accepted", "rejected"]);
      buttons[1]!.listeners["click"]![0]!();
      expect(s.posts).toEqual([{ url: "/dash/control/verdict", body: { epoch: "e1", key: 10, decision: "rejected" } }]);
    });

    it(`${lang}: вердикт поставлен — решение, итог при вердикте и пометка раннего запуска; прогон без паспорта — «паспорта нет», без кнопок`, () => {
      const s = controlScreen(lang);
      const verdict = { decision: "accepted", at: "2026-11-09T12:00:20.000Z", state: "accepted", accepted: 2, total: 2, early: { next: true, prev: false } };
      s.send([view(10, { closed: true, result: result("accepted", []), verdict, early: { next: true, prev: false } }), { key: 30, name: "unknown", startedAt: "2026-11-09T12:01:00.000Z", closed: true, early: { next: false, prev: false } }]);
      const [unknown, run] = s.box.children; // новые — сверху
      expect(unknown!.text()).toContain(CONTROL["no.passport"][lang]);
      expect(unknown!.all().some((n) => n.tag === "button")).toBe(false);
      expect(run!.text()).toContain(CONTROL["verdict.accepted"][lang]);
      expect(run!.text()).toContain(`${CONTROL["verdict.at"][lang]} ${CONTROL["q.open"][lang]}${CONTROL["state.accepted"][lang]}${CONTROL["q.close"][lang]}, 2 ${CONTROL.of[lang]} 2`);
      if (lang === "en") expect(run!.text()).not.toMatch(/[«»]/);
      expect(run!.text()).toContain(CONTROL["early.next"][lang]);
      expect(run!.all().some((n) => n.tag === "button")).toBe(false);
      s.error();
      expect(s.conn.className).toBe("conn conn-lost");
    });
  }
});
