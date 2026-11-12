// П-1.1 (модель пульта 1.23, Р-1318, Р-1332 в. 2): страница пульта на живом стенде — ru/en, бренд из конфигурации, CSP
// 'self', четыре панели, раскладка «сетка / вкладки»; переключатель «Пульт · Экран · Монитор» на всех страницах; лента
// /pult/events отдаёт состояние; скрипт пульта выводит данные только через textContent (инвариант 4).
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PANES, PULT, SWITCH } from "../../src/pult/phrases.js";
import { startDemo, type Demo } from "../../src/demo/run.js";
import { sseWrite } from "../../src/demo/server.js";
import type { PultBoardState } from "../../src/pult/feed.js";
import { driver } from "./drive.js";

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

/** Inline-код страницы: открывающий <script> без `src` и не JSON словаря, тег <style>, атрибут style. Имена тегов и
 *  атрибутов в HTML — без учёта регистра: `<SCRIPT>` и `STYLE=` тоже ловятся (CodeQL js/bad-tag-filter на 08fa035, П-1.1а). */
function inlineCode(html: string): string[] {
  const scripts = (html.match(/<script\b[^>]*>/gi) ?? []).filter((t) => !/\ssrc\s*=|\stype\s*=\s*"application\/json"/i.test(t));
  const styles = html.match(/<style\b[^>]*>|\sstyle\s*=/gi) ?? [];
  return [...scripts, ...styles];
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
      // Фокус (П-1.4): строка крошек и кнопка «↑ выше»; скрипт фокуса подключён до скрипта пульта.
      expect(html).toContain(`<nav class="focusbar" id="focusbar" tabindex="-1" aria-label="${PULT["focus.label"][lang]}">`);
      expect(html).toContain(`id="crumbs"`);
      expect(html).toContain(`id="focus-up" hidden>${PULT["focus.up"][lang]}</button>`);
      const focusTag = html.match(/<script\b[^>]*\ssrc="\/pult\/focus\.js"[^>]*>/);
      const pultTag = html.match(/<script\b[^>]*\ssrc="\/pult\/pult\.js"[^>]*>/);
      expect(focusTag).not.toBeNull();
      expect(pultTag).not.toBeNull();
      expect(focusTag!.index!).toBeLessThan(pultTag!.index!);
      // Без inline-скриптов и стилей: <script> — только файл (src) или JSON словаря (ревью П-1.1 № 11, П-1.1а).
      expect(html).toMatch(/<script\b[^>]*\ssrc="\/pult\/pult\.js"/);
      expect(inlineCode(html)).toEqual([]);
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
    const focus = await fetch(`${demo.monitor.url}/pult/focus.js`);
    expect(focus.status).toBe(200);
    expect(focus.headers.get("content-type")).toContain("text/javascript");
    expect(await focus.text()).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function/);
    const css = await fetch(`${demo.monitor.url}/pult/pult.css`);
    expect(css.status).toBe(200);
    expect(css.headers.get("content-type")).toContain("text/css");
  });

  it("лента /pult/events: первое сообщение — состояние шины", async () => {
    const hello = (await firstSse(`${demo.monitor.url}/pult/events`)) as { type: string; status: string };
    expect(hello.type).toBe("hello");
    expect(["connecting", "open"]).toContain(hello.status);
  });

  it("проверка inline-кода ловит поломки в любом регистре и пропускает файл и JSON словаря (П-1.1а)", () => {
    const ok = `<script id="i18n" type="application/json">{}</script><script src="/pult/pult.js"></script>`;
    expect(inlineCode(ok)).toEqual([]);
    for (const bad of [
      `<script>alert(1)</script>`,
      `<SCRIPT>alert(1)</SCRIPT>`,
      `<Script type="module">x()</Script>`,
      `<script >x()</script >`,
      `<script type="text/javascript">x()</script>`,
      `<style>p{}</style>`,
      `<STYLE>p{}</STYLE>`,
      `<p style="color:red">`,
      `<p STYLE="color:red">`,
    ]) {
      expect(inlineCode(ok + bad), bad).not.toEqual([]);
    }
  });

  it("словарь пульта: у каждой подписи есть ru и en, непустые", () => {
    for (const dict of [PULT, SWITCH]) {
      for (const [k, v] of Object.entries(dict)) {
        expect(v.ru.trim(), k).not.toBe("");
        expect(v.en.trim(), k).not.toBe("");
      }
    }
  });

  it("П-1.3: без DEMO_FAULTS режима сбоев нет — stand.demo нет, строки «режим сбоев» на мониторе и пульте нет", async () => {
    expect(demo.stand.faults).toBe(false);
    expect(demo.stand.stand.demo).toBeUndefined();
    // Показ людям — обычное удержание 900 с (ответ Платформы по #112, п. 1).
    expect(demo.stand.stand.params.order_hold_sec).toBe(900);
    for (const lang of ["ru", "en"] as const) {
      for (const path of ["/", "/pult"]) {
        const html = await (await fetch(`${demo.monitor.url}${path}?lang=${lang}`)).text();
        // Словарь монитора уходит в JSON страницы целиком — проверяется разметка строки, а не текст словаря.
        expect(html, path).not.toContain(`class="faults-mode"`);
        expect(html, path).not.toContain(`<strong>${PULT["mode.faults"][lang]}</strong>`);
      }
    }
    const hello = (await firstSse(`${demo.monitor.url}/pult/events`)) as { faults: boolean };
    expect(hello.faults).toBe(false);
  });

  it("П-1.3, ревью П-8.0 № 3: страницы витрин для человека и запросы браузера — не на шину; протокол /v1 — на шине", async () => {
    const base = demo.stand.urls.merchants;
    const before = demo.stand.merchantCalls().length;
    for (const path of ["/shops?lang=ru", "/shops/SHOP-2210?lang=en", "/shops/NO-SUCH-SHOP", "/favicon.ico"]) await fetch(`${base}${path}`);
    expect(demo.stand.merchantCalls().slice(before)).toEqual([]);
    await fetch(`${base}/v1/shops`);
    expect(demo.stand.merchantCalls().slice(before).map((c) => c.path)).toEqual(["/v1/shops"]);
    // Подписанный ключом агента запрос вне /v1/ — на шине: обращение агента не по протоколу видно (ревью П-1.3 № 2).
    // keyid агента — из журнала стенда (обращение агента при допуске и работе); подпись хук не проверяет.
    const agentKid = demo.stand.stand.calls().map((c) => c.kid).find((k): k is string => k !== undefined && demo.stand.isAgentKid(k));
    expect(agentKid).toBeDefined();
    await fetch(`${base}/shops/SHOP-2210`, { headers: { "signature-input": `sig1=("@method");keyid="${agentKid}"` } });
    const last = demo.stand.merchantCalls().at(-1)!;
    expect(last).toMatchObject({ method: "GET", path: "/shops/SHOP-2210", kid: agentKid });
  });

  it("П-1.3, П5 п. 5: страница пульта ходит только к своему серверу — CSP connect-src 'self' (скрипты каталога — тест границы)", async () => {
    const csp = (await fetch(`${demo.monitor.url}/pult`)).headers.get("content-security-policy") ?? "";
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("default-src 'self'");
    expect(csp).not.toMatch(/connect-src[^;]*(\*|https?:)/);
  });
});

/** Первые n сообщений ленты SSE. */
async function sseMessages(url: string, n: number, ms = 10_000): Promise<unknown[]> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ms);
  let text = "";
  try {
    const res = await fetch(url, { signal: ac.signal });
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    while (text.split("\n\n").length <= n) {
      const { value, done } = await reader.read();
      if (done) break;
      text += dec.decode(value, { stream: true });
    }
    await reader.cancel();
  } finally {
    clearTimeout(timer);
    ac.abort();
  }
  return text
    .split("\n\n")
    .filter((b) => b.startsWith("data: "))
    .slice(0, n)
    .map((b) => JSON.parse(b.slice(6)) as unknown);
}

describe("пульт: доска «Ход по стадиям» на живом стенде (П-2.1)", { timeout: 120_000 }, () => {
  let demo: Demo;
  let run2: Awaited<ReturnType<ReturnType<typeof driver>["run"]>>;

  beforeAll(async () => {
    demo = await startDemo();
    const d = driver(demo);
    await d.run(1);
    run2 = await d.run(2);
    // Пересчёт доски — с паузой после записи (200 мс).
    await new Promise((r) => setTimeout(r, 400));
  }, 120_000);
  afterAll(async () => {
    await demo?.close();
  });

  it("П-01 задания: после сюжета 2 покупка — в «Завершены» с итогом «оплачено» по событию Платформы; поручение сюжета 1 — карточкой поручения", async () => {
    const [hello, first] = (await sseMessages(`${demo.monitor.url}/pult/events`, 2)) as [{ type: string }, { type: string; board: PultBoardState }];
    expect(hello.type).toBe("hello");
    expect(first.type).toBe("board");
    const cards = first.board.cards;
    const tx = cards.filter((c) => c.kind === "tx");
    expect(tx).toHaveLength(1);
    expect(tx[0]).toMatchObject({ column: "done", outcome: "paid" });
    expect(tx[0]!.linkConflict).toBeUndefined();
    expect(tx[0]!.unconfirmed).toBeUndefined();
    // П-3.2а: после сюжета 2 с настоящим агентом нет ни «ждём шаг агента», ни признаков; операция одна — списка нет.
    for (const k of ["pending", "afterRevoke", "doubleDebit", "ops"] as const) expect(tx[0]![k], k).toBeUndefined();
    // Поручение сюжета 2 показывает его транзакция; поручение сюжета 1 (покупки по нему нет) — карточка поручения.
    expect(cards.filter((c) => c.kind === "mandate")).toEqual([expect.objectContaining({ column: "mandate" })]);
    expect(cards.some((c) => c.kind === "mandate" && c.id === tx[0]!.intentId)).toBe(false);
    // Переход в «Завершены» — по событию: лента пульта считала доску по ходу сюжета, в журнале переходов есть приход в
    // done, и время в стадии — время этого перехода.
    const toDone = first.board.jumps.find((j) => j.id === tx[0]!.id && j.to === "done");
    expect(toDone).toBeDefined();
    // Ревью П-2.1 № 10: время перехода и «в стадии с» — время события итога Платформы на шине, а не значение из того же
    // расчёта (сравнение с `toDone.at` было тавтологией).
    const authorized = run2.find((i) => i.stream === "monitor" && i.event.source === "pao_event" && i.event.what === "operation.authorized");
    expect(authorized?.stream === "monitor" && authorized.event.at).toBe(tx[0]!.since);
    expect(toDone!.at).toBe(tx[0]!.since);
    // «График» (П-2.2): у покупки — отрезки по стадиям, последний — «Завершены», открытый, предыдущие закрыты.
    const row = first.board.graph.rows.find((r) => r.id === tx[0]!.id)!;
    expect(row.kind).toBe("tx");
    expect(row.segs.length).toBeGreaterThanOrEqual(2);
    expect(row.segs.at(-1)).toMatchObject({ col: "done" });
    expect(row.segs.at(-1)!.to).toBeUndefined();
    expect(row.segs.slice(0, -1).every((s) => s.to !== undefined)).toBe(true);
    expect(first.board.graph.rows.some((r) => r.kind === "mandate")).toBe(true);
    // Монотонность по всем строкам (ревью П-2.2 № 10): from ≤ to, конец отрезка — начало следующего.
    for (const r of first.board.graph.rows) {
      r.segs.forEach((s, i) => {
        if (s.to) expect(Date.parse(s.to), r.id).toBeGreaterThanOrEqual(Date.parse(s.from));
        if (i > 0) expect(s.from, r.id).toBe(r.segs[i - 1]!.to);
      });
    }
  });
});

describe("пульт: режим сбоев DEMO_FAULTS=1 (П-1.3)", { timeout: 60_000 }, () => {
  let demo: Demo;

  beforeAll(async () => {
    demo = await startDemo({ faults: true });
  }, 60_000);
  afterAll(async () => {
    await demo?.close();
  });

  it("стенд — demo: { faults: true } (срок подтверждения 45 с); строка «режим сбоев: вкл.» на мониторе и пульте, ru и en", async () => {
    expect(demo.stand.faults).toBe(true);
    expect(demo.stand.stand.demo).toBeDefined();
    // Именно режим сбоев, а не «только действия» (П-8.1): удержание заказа и срок запроса — короткие, 45 с, а не 900 с
    // (ревью П-1.3 № 1). demo_order_hold_sec в параметрах есть в любом режиме — проверяется действующий order_hold_sec.
    expect(demo.stand.stand.params.order_hold_sec).toBe(demo.stand.stand.params.demo_order_hold_sec);
    expect(demo.stand.stand.params.order_hold_sec).toBe(45);
    for (const lang of ["ru", "en"] as const) {
      for (const path of ["/", "/pult"]) {
        const html = await (await fetch(`${demo.monitor.url}${path}?lang=${lang}`)).text();
        expect(html, `${path} ${lang}`).toContain(`<p class="faults-mode"`);
        expect(html, `${path} ${lang}`).toContain(`<strong>${PULT["mode.faults"][lang]}</strong>`);
        // Срок — из `stand.params.order_hold_sec`, а не литерал словаря (ревью П-1.3 № 5, П-8.1).
        const line = /<p class="faults-mode"[^>]*>.*?<\/p>/s.exec(html)![0];
        expect(line, `${path} ${lang}`).toContain(`${demo.stand.stand.params.order_hold_sec} ${lang === "ru" ? "с" : "s"}`);
        expect(line, `${path} ${lang}`).not.toContain("{sec}");
      }
    }
    const hello = (await firstSse(`${demo.monitor.url}/pult/events`)) as { faults: boolean };
    expect(hello.faults).toBe(true);
  });
});

describe("запись в ленты SSE после r.end() (П-1.3, повторное ревью К1.4б № 1)", () => {
  it("sseWrite пишет только в открытый поток: после end и после destroy — ничего, false", () => {
    const writes: string[] = [];
    const res = { writableEnded: false, destroyed: false, write: (s: string) => (writes.push(s), true) };
    expect(sseWrite(res as never, { a: 1 })).toBe(true);
    expect(writes).toEqual([`data: {"a":1}\n\n`]);
    const ended = { ...res, writableEnded: true, write: () => expect.unreachable("запись после end") };
    expect(sseWrite(ended as never, { a: 2 })).toBe(false);
    const destroyed = { ...res, destroyed: true, write: () => expect.unreachable("запись после destroy") };
    expect(sseWrite(destroyed as never, { a: 3 })).toBe(false);
  });

  it("все ленты сервера пишут только через sseWrite: прямой res.write в server.ts — один, внутри sseWrite", () => {
    const src = readFileSync("src/demo/server.ts", "utf8");
    expect(src.match(/\bres\.write\(/g)).toHaveLength(1);
    expect(src).toMatch(/export function sseWrite[^]*?if \(res\.writableEnded \|\| res\.destroyed\) return false;\s*res\.write\(/);
    for (const route of ["/events", "/dash/interpret/events", "/dash/control/events", "/pult/events"]) expect(src).toContain(`case "${route}"`);
  });
});
