// Страница экрана «Контроль» DEMO-2 (К2.3б): разметка без данных — прогоны строит скрипт `public/dash/control.js` через
// textContent (инвариант 4). Язык ru/en и бренд из конфигурации (правило совместимости 3, инвариант 7). Простой вид рядом
// с пультом (Р-1332 в. 2); переключатель «Пульт · Экран · Монитор» — П-1.1.
import type { Brand } from "../brand.js";
import { CONTROL } from "../dashboards/phrases.js";
import type { WireLang } from "../dashboards/wire.js";
import { escapeHtml, jsonForScript } from "./html.js";
import { switcherHtml } from "./switcher.js";

export function controlPage(lang: WireLang, brand: Brand, hasLogo: boolean): string {
  const s = (k: keyof typeof CONTROL) => escapeHtml(CONTROL[k][lang]);
  const other: WireLang = lang === "ru" ? "en" : "ru";
  const labels = Object.fromEntries(Object.entries(CONTROL).map(([k, v]) => [k, v[lang]]));
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${s("title")} — ${escapeHtml(brand.name)}</title>
<link rel="stylesheet" href="/brand.css">
<link rel="stylesheet" href="/dash/dash.css">
</head>
<body>
<header>
  ${hasLogo ? `<img class="logo" src="/brand/logo" alt="${escapeHtml(brand.name)}">` : ""}
  <div class="brand-name">${escapeHtml(brand.name)}</div>
  <h1>${s("title")}</h1>
  <nav>${switcherHtml("control", lang)} <span class="lang-switch">${s("lang")}: <strong>${lang}</strong> · <a href="/dash/control?lang=${other}">${other}</a></span></nav>
</header>
<main>
  <p class="subtitle">${s("subtitle")}</p>
  <p class="status"><span id="conn" class="conn conn-wait"><span id="status-icon" class="conn-icon" aria-hidden="true">◌</span> <span id="status">${s("status.connecting")}</span></span> · <a href="/dash/control/acc1.md?lang=${lang}">${s("export")}</a></p>
  <div id="runs"></div>
  <p id="empty" class="empty">${s("empty")}</p>
</main>
<script id="i18n" type="application/json">${jsonForScript({ lang, labels })}</script>
<script src="/dash/control.js"></script>
</body>
</html>`;
}
