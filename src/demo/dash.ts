// Страница экрана «Интерпретация» DEMO-2 (К1.4): разметка без данных шины — ленту строит скрипт
// `public/dash/interpret.js` через textContent (инвариант 4). Язык ru/en и бренд из конфигурации (правило совместимости 3,
// инвариант 7). Подписи — словарь дашбордов; заголовки карточек С-xx — из библиотеки ситуаций.
import type { Brand } from "../brand.js";
import { CONTROL, LABELS, SCREEN } from "../dashboards/phrases.js";
import type { WireLang } from "../dashboards/wire.js";

import { escapeHtml, jsonForScript } from "./html.js";

/** Словарь одного языка: { "kind.fraud": "фрод", … }. */
function dictionary(lang: WireLang): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [group, entries] of Object.entries(LABELS)) {
    if ("ru" in entries && "en" in entries) out[group] = (entries as Record<WireLang, string>)[lang];
    else for (const [k, v] of Object.entries(entries as Record<string, Record<WireLang, string>>)) out[`${group}.${k}`] = v[lang];
  }
  for (const [k, v] of Object.entries(SCREEN)) out[k] = v[lang];
  return out;
}

export function interpretPage(lang: WireLang, brand: Brand, hasLogo: boolean, situations: Readonly<Record<string, string>>): string {
  const s = (k: keyof typeof SCREEN) => escapeHtml(SCREEN[k][lang]);
  const other: WireLang = lang === "ru" ? "en" : "ru";
  const col = (k: keyof typeof SCREEN) => `<th>${s(k)}</th>`;
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
  <nav><a href="/?lang=${lang}">${s("monitor")}</a> <a href="/dash/control?lang=${lang}">${escapeHtml(CONTROL.title[lang])}</a> <span class="lang-switch">${s("lang")}: <strong>${lang}</strong> · <a href="/dash/interpret?lang=${other}">${other}</a></span></nav>
</header>
<main>
  <p class="subtitle">${s("subtitle")}</p>
  <p class="status"><span id="conn" class="conn conn-wait"><span id="status-icon" class="conn-icon" aria-hidden="true">◌</span> <span id="status">${s("status.connecting")}</span></span> · <span id="diag">${s("diag.loading")}</span></p>
  <label class="toggle"><input type="checkbox" id="details"> ${s("details")}</label>
  <table id="feed">
    <thead><tr>${col("col.time")}${col("col.stage")}${col("col.actor")}${col("col.kind")}${col("col.phrase")}${col("col.who")}${col("col.situation")}</tr></thead>
    <tbody></tbody>
  </table>
  <p id="empty" class="empty">${s("empty")}</p>
</main>
<script id="i18n" type="application/json">${jsonForScript({ lang, labels: dictionary(lang), situations })}</script>
<script src="/dash/interpret.js"></script>
</body>
</html>`;
}
