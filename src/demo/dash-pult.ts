// Страница пульта DEMO-2 (П-1.1, модель пульта 1.23): каркас — четыре панели в сетке 2×2 или вкладками, разворот
// панели, переключатель «Пульт · Экран · Монитор». Разметка без данных шины — панели наполняет скрипт
// `public/pult/pult.js` через createElement и textContent (инвариант 4, П2 п. 2). Язык ru/en, бренд из конфигурации
// (правило совместимости 3, инвариант 7).
import type { Brand } from "../brand.js";
import type { WireLang } from "../dashboards/wire.js";
import { BOARD_COLUMNS } from "../pult/board.js";
import { PANES, PULT, type Pane } from "../pult/phrases.js";
import { escapeHtml, jsonForScript } from "./html.js";
import { switcherHtml } from "./switcher.js";

function paneHtml(pane: Pane, lang: WireLang): string {
  // Ключи панели — шаблонные типы `pane.${Pane}`: новая панель без подписей не соберётся (повторное ревью П-1.1 № 4).
  const s = (k: keyof typeof PULT) => escapeHtml(PULT[k][lang]);
  const title = s(`pane.${pane}` as const);
  const hint = s(`pane.${pane}.hint` as const);
  // Виды панели «Ход» (модель 1.23 `PROC_MODES`): на MVP — «Ход по стадиям» и «График» (П-2.2); остальные — после MVP.
  const modes =
    pane === "proc"
      ? `<span class="pmodes" role="group" aria-label="${s("mode.label")}"><button type="button" data-mode="board" aria-pressed="true">${s("mode.board")}</button> <button type="button" data-mode="graph" aria-pressed="false">${s("mode.graph")}</button></span>`
      : "";
  // Разрезы панели «Ход» (П-2.3, модель 1.23 `buildFilters`): стадия, продавец, тип записи, поручения без покупки.
  // Клиент на стенде один (эмулятор банка, П2) — разреза по клиенту нет.
  const cols = BOARD_COLUMNS.map((c) => `<option value="${c}">${s(`col.${c}` as const)}</option>`).join("");
  const kinds = (["norm", "conflict", "error", "fraud"] as const)
    .map((k) => `<button type="button" data-cut-kind="${k}" aria-pressed="true">${s(`kind.${k}` as const)}</button>`)
    .join(" ");
  const cuts =
    pane === "proc"
      ? `<div class="cuts" id="cuts" role="group" aria-label="${s("cut.label")}"><label>${s("cut.stage")} <select id="cut-stage"><option value="">${s("cut.all")}</option>${cols}</select></label> <label>${s("cut.merchant")} <select id="cut-merchant"><option value="">${s("cut.all")}</option></select></label> <span class="cut-kinds">${s("cut.kind")}: ${kinds}</span> <label><input type="checkbox" id="cut-mandates" checked> ${s("cut.mandates")}</label> <button type="button" id="cut-reset">${s("cut.reset")}</button> <span class="muted" id="cut-hidden"></span></div>`
      : "";
  return `<section class="pane" id="p-${pane}" data-pane="${pane}" aria-labelledby="h-${pane}">
    <div class="ph"><h2 id="h-${pane}">${title}</h2><span class="hint">${hint}</span>${modes}<button type="button" class="icon" data-max="${pane}" aria-describedby="h-${pane}">${s("pane.maximize")}</button></div>
    ${cuts}
    <div class="pb" id="b-${pane}"><p class="empty">${s(`empty.${pane}` as const)}</p></div>
  </section>`;
}

/** `faults` — режим сбоев стенда (`DEMO_FAULTS=1`, П-1.3): строка «режим сбоев: вкл.» под шапкой. */
export function pultPage(lang: WireLang, brand: Brand, hasLogo: boolean, o: { faults?: boolean } = {}): string {
  const s = (k: keyof typeof PULT) => escapeHtml(PULT[k][lang]);
  const other: WireLang = lang === "ru" ? "en" : "ru";
  const labels = Object.fromEntries(Object.entries(PULT).map(([k, v]) => [k, v[lang]]));
  const tabs = PANES.map(
    // Вкладки — кнопки-переключатели с aria-pressed, а не роли tab/tabpanel без стрелок (ревью П-1.1 № 3).
    (p) => `<button type="button" data-tab="${p}" aria-controls="p-${p}" aria-pressed="false">${s(`pane.${p}` as const)}</button>`,
  ).join("");
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${s("title")} — ${escapeHtml(brand.name)}</title>
<link rel="stylesheet" href="/brand.css">
<link rel="stylesheet" href="/pult/pult.css">
</head>
<body>
<header>
  ${hasLogo ? `<img class="logo" src="/brand/logo" alt="${escapeHtml(brand.name)}">` : ""}
  <div class="brand-name">${escapeHtml(brand.name)}</div>
  <h1>${s("title")}</h1>
  <nav>${switcherHtml("pult", lang)} <span class="lang-switch">${s("lang")}: <strong>${lang}</strong> · <a href="/pult?lang=${other}">${other}</a></span></nav>
</header>
<div class="bar">
  ${o.faults ? `<p class="faults-mode"><strong>${s("mode.faults")}</strong> — ${s("mode.faults_note")}</p>` : ""}
  <p class="status"><span id="conn" class="conn conn-wait" role="status"><span id="status-icon" class="conn-icon" aria-hidden="true">◌</span> <span id="status">${s("status.connecting")}</span></span></p>
  <span class="layout">${s("layout.label")}:<button type="button" data-layout="grid" aria-pressed="true">${s("layout.grid")}</button> <button type="button" data-layout="tabs" aria-pressed="false">${s("layout.tabs")}</button></span>
</div>
<main>
  <p class="subtitle">${s("subtitle")}</p>
  <nav class="focusbar" id="focusbar" tabindex="-1" aria-label="${s("focus.label")}"><span class="fl-l">${s("focus.label")}:</span> <span id="crumbs"></span> <button type="button" id="focus-up" hidden>${s("focus.up")}</button> <span class="hint">${s("focus.hint")}</span></nav>
  <div class="tabbar" id="tabbar" role="group" aria-label="${s("layout.tabs")}" hidden>${tabs}</div>
  <div class="grid" id="grid">
  ${PANES.map((p) => paneHtml(p, lang)).join("\n  ")}
  </div>
</main>
<script id="i18n" type="application/json">${jsonForScript({ lang, labels, panes: PANES })}</script>
<script src="/pult/focus.js"></script>
<script src="/pult/pult.js"></script>
</body>
</html>`;
}
