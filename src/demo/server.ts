// Сервер экранов демо-стенда (П2 п. 2): node:http, только 127.0.0.1. Страница монитора на ru или en (?lang=), бренд из
// конфигурации, лента — SSE (/events). CSP — только 'self': скрипт, стили и цвета бренда отдаются файлами, без inline.
// На странице нет данных витрин в разметке: ленту строит скрипт через textContent (инвариант 4).
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { extname, resolve, sep } from "node:path";
import { parseBrand, type Brand } from "../brand.js";
import { INSTANCE_HEADER, type DiagSnapshot } from "../dashboards/wire.js";
import type { MonitorBus } from "./bus.js";
import { MESSAGES, langOf, t, type Lang } from "./i18n.js";
import { formatMoney } from "./money.js";
import type { IntentCard, ScenarioName, ScenarioStart } from "./scenarios.js";
import type { DemoUrls } from "./stand.js";

const PUBLIC = (name: string) => readFileSync(new URL(`./public/${name}`, import.meta.url), "utf8");

const CSP = "default-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

/** Экранирование текста для HTML: словари и бренд — значения конфигурации, а не разметка. */
export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** JSON внутри <script type="application/json">: без «<», чтобы строка данных не закрыла тег. */
const jsonForScript = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c");

/** Бренд из файла конфигурации. Логотип — только файл внутри config/ (на стенде нет внешних адресов); иначе — без картинки. */
export function loadBrand(path: string): { brand: Brand; logoFile: string | null } {
  const brand = parseBrand(JSON.parse(readFileSync(path, "utf8")));
  const configDir = resolve("config");
  const file = resolve(brand.logo);
  const logoFile = file.startsWith(configDir + sep) && [".svg", ".png"].includes(extname(file)) ? file : null;
  return { brand, logoFile };
}

export interface MonitorServerOptions {
  bus: MonitorBus;
  urls: DemoUrls;
  agentCode: string;
  brandPath: string;
  defaultLang?: Lang;
  port?: number;
  /** Сюжеты (К2.1); нет — кнопок нет, POST /scenario/* — 405. */
  scenarios?: { start(name: ScenarioName): ScenarioStart; answerCart(agree: boolean): ScenarioStart; abort(): ScenarioStart };
  /** Карточка поручения сюжета 1 — показывается человеку до нажатия кнопки (Т3а: keyTermsShown, ревью К2.1 № 1). */
  intentCard?: IntentCard;
  /** Карточка поручения сюжета 4 — у кнопки 4. */
  intentCardUpk?: IntentCard;
  /** Новая одноразовая ссылка входа на экран мандатов банка стенда (полный адрес). Нет — ссылка ведёт на экран без входа. */
  bankLogin?: () => string;
  /** Снимок реестров диагностики для дашбордов DEMO-2 (`GET /api/diag`, Р-1273 п. 3). Нет — 404. */
  diag?: DiagSnapshot;
}

export interface MonitorServer {
  readonly url: string;
  readonly server: Server;
  close(): Promise<void>;
}

/** Карточка поручения (Т3а): видна до кнопки сюжета, значения — из конфигурации сюжета, не из данных витрин. */
function intentCardHtml(lang: Lang, card: IntentCard, id: string, titleKey: Parameters<typeof t>[1]): string {
  const e = (k: Parameters<typeof t>[1]) => escapeHtml(t(lang, k));
  return `<dl class="card" id="${id}">
    <dt>${e(titleKey)}</dt>
    <dd>${e("card.subject")}: ${escapeHtml(card.subject)}</dd>
    <dd>${e("card.limit")}: ${escapeHtml(formatMoney({ minor: card.limit.amount, currency: card.limit.currency }, lang))}</dd>
    <dd>${e("card.valid_days")}: ${card.validDays}</dd>
    <dd>${e("card.merchants")}: ${card.merchants}</dd>
    <dd>${e("card.single_use")}</dd>
  </dl>`;
}

function page(lang: Lang, o: MonitorServerOptions, brand: Brand, hasLogo: boolean): string {
  const e = (k: Parameters<typeof t>[1]) => escapeHtml(t(lang, k));
  const emu = `<span class="badge emu">${e("badge.emulator")}</span>`;
  const real = `<span class="badge real">${e("badge.real")}</span>`;
  const link = (href: string, label: string, badge: string) =>
    `<li><a href="${escapeHtml(href)}" target="_blank" rel="noopener">${label}</a> ${badge}</li>`;
  const other: Lang = lang === "ru" ? "en" : "ru";
  const cols = (["col.time", "col.class", "col.source", "col.what", "col.status", "col.code", "col.amount", "col.ids"] as const)
    .map((k) => `<th>${e(k)}</th>`)
    .join("");
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${e("page.title")}</title>
<link rel="stylesheet" href="/brand.css">
<link rel="stylesheet" href="/monitor.css">
</head>
<body>
<header>
  ${hasLogo ? `<img class="logo" src="/brand/logo" alt="${escapeHtml(brand.name)}">` : ""}
  <div class="brand-name">${escapeHtml(brand.name)} ${emu}</div>
  <h1>${e("page.title")}</h1>
  <nav class="lang">${e("page.lang")}: <strong>${lang}</strong> · <a href="/?lang=${other}">${other}</a></nav>
</header>
<p class="subtitle">${e("page.subtitle")}</p>
<ul class="links">
  <li>${e("link.agent")}: <code>${escapeHtml(o.agentCode)}</code> ${real}</li>
  ${link(o.bankLogin ? "/bank-login" : o.urls.bankApp, e("link.bank"), emu)}
  ${link(o.urls.upk, e("link.upk"), emu)}
  ${link(`${o.urls.merchants}/v1/shops`, e("link.merchants"), emu)}
</ul>
${
  o.scenarios
    ? `<section class="scenarios">
  <h2>${e("scenario.title")}</h2>
  <p class="hint">${e("scenario.hint")}</p>
  ${o.intentCard ? intentCardHtml(lang, o.intentCard, "intent-card", "card.intent.title") : ""}
  <button type="button" data-scenario="intent">${e("scenario.intent")}</button>
  <button type="button" data-scenario="purchase">${e("scenario.purchase")}</button>
  <p class="hint mode-note">${e("scenario.purchase_note")}</p>
  <button type="button" data-scenario="limit">${e("scenario.limit")}</button>
  <p class="hint">${e("scenario.limit_note")}</p>
  ${o.intentCardUpk ? intentCardHtml(lang, o.intentCardUpk, "intent-card-upk", "card.intent_upk.title") : ""}
  <button type="button" data-scenario="upk">${e("scenario.upk")}</button>
  <p class="hint">${e("scenario.upk_note")}</p>
  <button type="button" data-scenario="revoke">${e("scenario.revoke")}</button>
  <p class="hint">${e("scenario.revoke_note")}</p>
  <div id="upk-panel" class="card" hidden>
    <dl>
      <dt>${e("upk.panel.title")} <span class="badge emu">${e("badge.emulator")}</span></dt>
      <dd><a id="upk-link" target="_blank" rel="noopener">${e("upk.link")}</a> <span class="badge emu">${e("badge.emulator")}</span></dd>
      <dd>${e("upk.sms")}: <strong id="upk-code"></strong></dd>
      <dd>${e("upk.hint")}</dd>
    </dl>
  </div>
  <div id="cart-card" class="card" hidden>
    <dl>
      <dt>${e("card.cart.title")}</dt>
      <dd data-tpl="card.line.item"></dd>
      <dd data-tpl="card.line.merchant"></dd>
      <dd data-tpl="card.line.price"></dd>
      <dd data-tpl="card.line.total"></dd>
      <dd data-tpl="card.line.delivery" data-tpl-none="card.line.no_delivery"></dd>
      <dd>${e("card.delivery_note")}</dd>
    </dl>
    <button type="button" data-cart="accept">${e("card.accept")}</button>
    <button type="button" data-cart="decline" class="secondary">${e("card.decline")}</button>
  </div>
  <button type="button" data-scenario="abort" class="secondary">${e("scenario.abort")}</button>
  <p id="scenario-msg" class="status" hidden></p>
</section>`
    : ""
}
<main>
  <section>
    <h2>${e("monitor.title")}</h2>
    <p id="status" class="status" hidden></p>
    <table id="monitor"><thead><tr>${cols}</tr></thead><tbody></tbody></table>
    <p id="monitor-empty" class="empty">${e("monitor.empty")}</p>
  </section>
  <section>
    <h2>${e("orders.title")} <span class="badge emu">${e("badge.emulator")}</span></h2>
    <p class="hint">${e("orders.hint")}</p>
    <table id="orders"><thead><tr><th>${e("orders.col.order")}</th><th>${e("orders.col.merchant")}</th><th>${e("orders.col.item")}</th><th>${e("orders.col.total")}</th><th>${e("orders.col.shop_reply")}</th><th>${e("orders.col.outcome")}</th></tr></thead><tbody></tbody></table>
    <p id="orders-empty" class="empty">${e("orders.empty")}</p>
  </section>
  <section>
    <h2>${e("console.title")}</h2>
    <ol id="console"></ol>
    <p id="console-empty" class="empty">${e("console.empty")}</p>
  </section>
</main>
<script id="i18n" type="application/json">${jsonForScript({ lang, messages: MESSAGES[lang] })}</script>
<script src="/monitor.js"></script>
</body>
</html>`;
}

function brandCss(b: Brand): string {
  // Значения цветов уже проверены parseBrand (#RRGGBB) — подстановка в CSS безопасна.
  return `:root{--brand-primary:${b.colors.primary};--brand-on-primary:${b.colors.onPrimary};--brand-accent:${b.colors.accent}}\n`;
}

export async function startMonitorServer(o: MonitorServerOptions): Promise<MonitorServer> {
  const { brand, logoFile } = loadBrand(o.brandPath);
  const js = PUBLIC("monitor.js");
  const css = PUBLIC("monitor.css");
  const logo = logoFile ? readFileSync(logoFile) : null;
  // Снимок неизменен за время работы стенда — сериализуется один раз.
  const diagJson = o.diag ? JSON.stringify(o.diag) : null;
  // Номер экземпляра шины: адаптер дашбордов по нему видит, что стенд перезапущен и номера seq начались заново.
  const instance = randomUUID();
  const sse = new Set<ServerResponse>();

  const send = (res: ServerResponse, status: number, type: string, body: string | Buffer) => {
    res.writeHead(status, {
      "content-type": type,
      "content-security-policy": CSP,
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "cache-control": "no-store",
    });
    res.end(body);
  };

  // Служебные ответы (400, 404, 405, 421) человек тоже может увидеть в браузере — текст из словаря (ревью К1.3 № 8).
  const plain = "text/plain; charset=utf-8";
  const fallback: Lang = o.defaultLang ?? "ru";
  let hosts: ReadonlySet<string> = new Set();
  let origins: ReadonlySet<string> = new Set();
  const handle = (req: IncomingMessage, res: ServerResponse) => {
    // Только Host самого монитора: чужая страница через подмену DNS (DNS rebinding) ленту не прочитает (ревью К1.3 № 11).
    if (!hosts.has(req.headers.host ?? "")) return send(res, 421, plain, t(fallback, "http.misdirected"));
    // Неразбираемый адрес запроса — 400, а не исключение, которое уронит процесс (повторное ревью К1.3, находка 1).
    let u: URL;
    try {
      u = new URL(req.url ?? "/", "http://127.0.0.1");
    } catch {
      return send(res, 400, plain, t(fallback, "http.bad_request"));
    }
    const lang = langOf(u.searchParams.get("lang"), fallback);
    // Запуск сюжета — только со страницы монитора: Origin — адрес самого монитора (чужая страница кнопку не нажмёт).
    const scenario = /^\/scenario\/(intent|purchase|limit|upk|revoke|cart\/accept|cart\/decline|abort)$/.exec(u.pathname);
    if (req.method === "POST" && scenario && o.scenarios) {
      if (!origins.has(req.headers.origin ?? "")) return send(res, 403, plain, t(lang, "http.forbidden"));
      const what = scenario[1]!;
      // Ответ на карточку корзины — действие человека на этой странице (Р-1248 п. 1); сюжет его только ждёт.
      const r =
        what === "abort"
          ? o.scenarios.abort()
          : what.startsWith("cart/")
            ? o.scenarios.answerCart(what === "cart/accept")
            : o.scenarios.start(what as ScenarioName);
      return send(res, r.ok ? 202 : 409, "application/json; charset=utf-8", JSON.stringify(r));
    }
    if (req.method !== "GET") return send(res, 405, plain, t(lang, "http.method_not_allowed"));
    if (u.pathname === "/bank-login" && o.bankLogin) {
      // Вход — только переходом со страницы монитора или вводом адреса: чужая страница (ссылка, <img>, предзагрузка)
      // сессию банка не создаёт (ревью К2.1 № 3). Без заголовка — не браузер (тест, curl): пропускается.
      const site = req.headers["sec-fetch-site"];
      if (site !== undefined && site !== "same-origin" && site !== "none") return send(res, 403, plain, t(lang, "http.forbidden"));
      // Одноразовая ссылка входа: в ленту и журнал не пишется, страница монитора её не хранит.
      res.writeHead(303, { location: o.bankLogin(), "cache-control": "no-store", "referrer-policy": "no-referrer" });
      return res.end();
    }
    switch (u.pathname) {
      case "/":
        return send(res, 200, "text/html; charset=utf-8", page(lang, o, brand, logo !== null));
      case "/monitor.js":
        return send(res, 200, "text/javascript; charset=utf-8", js);
      case "/monitor.css":
        return send(res, 200, "text/css; charset=utf-8", css);
      case "/brand.css":
        return send(res, 200, "text/css; charset=utf-8", brandCss(brand));
      case "/brand/logo":
        if (!logo || !logoFile) return send(res, 404, plain, t(lang, "http.not_found"));
        return send(res, 200, extname(logoFile) === ".svg" ? "image/svg+xml" : "image/png", logo);
      case "/api/diag":
        if (!diagJson) return send(res, 404, plain, t(lang, "http.not_found"));
        return send(res, 200, "application/json; charset=utf-8", diagJson);
      case "/events": {
        res.writeHead(200, {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
          connection: "keep-alive",
          [INSTANCE_HEADER]: instance,
        });
        for (const item of o.bus.history()) res.write(`data: ${JSON.stringify(item)}\n\n`);
        const off = o.bus.subscribe((item) => res.write(`data: ${JSON.stringify(item)}\n\n`));
        sse.add(res);
        req.on("close", () => {
          off();
          sse.delete(res);
        });
        return;
      }
      default:
        return send(res, 404, plain, t(lang, "http.not_found"));
    }
  };

  const server = createServer(handle);
  await new Promise<void>((ok, fail) => {
    server.once("error", fail);
    server.listen(o.port ?? 0, "127.0.0.1", () => ok());
  });
  const { port } = server.address() as AddressInfo;
  hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  origins = new Set([...hosts].map((h) => `http://${h}`));
  return {
    url: `http://127.0.0.1:${port}`,
    server,
    close: () =>
      new Promise<void>((ok) => {
        for (const r of sse) r.end();
        server.close(() => ok());
      }),
  };
}
