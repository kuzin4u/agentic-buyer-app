// «Ленты» пульта (П-5.2): панель «Интерпретатор» — «Простыми словами» (фраза, участник, вид) и «Шина» (поток, что пришло,
// идентификаторы); при транзакции в фокусе — её сводка (К1.4 № 6) и только её строки. Лента — SSE `/pult/feeds` (Р-1523,
// В17 (а)): подписи на языке страницы, вид лент, сброс. Данные выводятся только через createElement и textContent
// (инвариант 4). Фокус — событие `pult:focus` (`pult.js`), начальное — `#grid` `data-focus` / `data-focus-tx`; пауза — событие
// `pult:pause` с `detail.paused: boolean` (источник — клавиша «пробел», П-9.1; контракт — STATUS «Открыто», раскладка
// клавиш): на паузе новые виды копятся, показывается последний после снятия паузы. Выбор вида
// помнит браузер (localStorage) — только удобство зрителя.
/* global document, Element, EventSource, localStorage */
"use strict";

(function () {
  const host = document.getElementById("b-int");
  const cfgEl = document.getElementById("i18n");
  if (!host || !cfgEl) return;
  let lang = "ru";
  try {
    const c = JSON.parse(cfgEl.textContent);
    if (c && c.lang === "en") lang = "en";
  } catch {
    // словарь страницы не по форме — русский
  }
  // Подписи — сразу со страницей (`#feeds-i18n`, П-9.4): до первого сообщения ленты и при оборванной ленте не видны ключи;
  // первое сообщение `hello` их подтверждает.
  let L = {};
  try {
    const own = document.getElementById("feeds-i18n");
    const v = own ? JSON.parse(own.textContent) : null;
    if (v && typeof v === "object") L = v;
  } catch {
    // нет подписей со страницей — до `hello` ключи
  }
  const label =(k) => (Object.prototype.hasOwnProperty.call(L, k) && typeof L[k] === "string" ? L[k] : k);
  const str = (v) => (typeof v === "string" ? v : "");

  const VIEWS = ["plain", "bus"];
  const STORE = "pult.feeds.v1";
  const state = { view: "plain", focus: null, paused: false, data: null, pending: null };
  try {
    const v = JSON.parse(localStorage.getItem(STORE) || "null");
    if (v && VIEWS.indexOf(v.view) >= 0) state.view = v.view;
  } catch {
    // хранилище недоступно или повреждено — вид по умолчанию
  }
  const grid = document.getElementById("grid");
  if (grid && grid.dataset.focus === "tx" && typeof grid.dataset.focusTx === "string" && grid.dataset.focusTx !== "") state.focus = grid.dataset.focusTx;

  const el = (tag, text, cls) => {
    const n = document.createElement(tag);
    if (text !== undefined) n.textContent = text;
    if (cls) n.className = cls;
    return n;
  };
  const clear = (n) => {
    while (n.firstChild) n.removeChild(n.firstChild);
  };

  // ---- разметка панели ----
  const box = el("div", undefined, "feeds");
  box.setAttribute("id", "int-feeds");
  const bar = el("div", undefined, "feeds-bar");
  bar.setAttribute("role", "group");
  const btns = {};
  for (const v of VIEWS) {
    const b = el("button", "", "feeds-view");
    b.type = "button";
    b.dataset.feedsView = v;
    btns[v] = b;
    bar.appendChild(b);
  }
  const pausedNote = el("span", "", "feeds-paused");
  pausedNote.setAttribute("role", "status");
  pausedNote.hidden = true;
  bar.appendChild(pausedNote);
  const summary = el("div", undefined, "feeds-tx");
  const list = el("ol", undefined, "feeds-list");
  box.appendChild(bar);
  box.appendChild(summary);
  box.appendChild(list);
  for (const p of host.querySelectorAll(".empty")) p.hidden = true;
  host.appendChild(box);

  const time = (iso) => {
    const d = new Date(str(iso));
    return isNaN(d.getTime()) ? "" : d.toLocaleTimeString(lang === "en" ? "en-GB" : "ru-RU");
  };

  function plainRow(r) {
    const li = el("li", undefined, "feeds-row kind-" + str(r.kind));
    li.appendChild(el("time", time(r.at), "feeds-at"));
    li.appendChild(el("span", label("actor." + str(r.actor)) + (r.emulated === true ? " · " + label("feeds.emulated") : ""), "feeds-actor"));
    li.appendChild(el("span", label("kind." + str(r.kind)), "feeds-kind"));
    const ph = r.phrase && typeof r.phrase === "object" ? str(r.phrase[lang]) : "";
    li.appendChild(el("span", ph, "feeds-text"));
    return li;
  }

  function busRow(r) {
    const li = el("li", undefined, "feeds-row");
    li.appendChild(el("time", time(r.at), "feeds-at"));
    li.appendChild(el("span", label("stream." + str(r.stream)), "feeds-stream"));
    li.appendChild(el("code", str(r.ref), "feeds-ref"));
    if (typeof r.status === "string") li.appendChild(el("code", r.status, "feeds-status"));
    if (r.ids && typeof r.ids === "object") {
      const ids = Object.keys(r.ids)
        .filter((k) => typeof r.ids[k] === "string")
        .map((k) => k + "=" + r.ids[k])
        .join(" ");
      if (ids !== "") li.appendChild(el("span", ids, "feeds-ids"));
    }
    return li;
  }

  function renderSummary(d) {
    clear(summary);
    if (state.focus === null) {
      summary.appendChild(el("p", label("feeds.tx.none"), "muted"));
      return;
    }
    const s = d && d.txs && Object.prototype.hasOwnProperty.call(d.txs, state.focus) ? d.txs[state.focus] : null;
    summary.appendChild(el("h3", label("feeds.tx") + " " + state.focus, "feeds-tx-h"));
    if (!s) {
      summary.appendChild(el("p", label("feeds.tx.missing"), "muted"));
      return;
    }
    const dl = el("dl", undefined, "feeds-tx-dl");
    const pair = (k, v) => {
      dl.appendChild(el("dt", label(k)));
      dl.appendChild(el("dd", v));
    };
    pair("feeds.tx.stage", label("stage." + str(s.stage)));
    pair("feeds.tx.outcome", typeof s.outcome === "string" ? label("outcome." + s.outcome) : label("feeds.tx.outcome.none"));
    pair("feeds.tx.worst", label("kind." + str(s.worst)));
    pair("feeds.tx.merchants", Array.isArray(s.merchantIds) ? s.merchantIds.filter((m) => typeof m === "string").join(", ") : "");
    pair("feeds.tx.records", String(typeof s.records === "number" ? s.records : 0));
    summary.appendChild(dl);
    if (s.linkConflict === true) summary.appendChild(el("p", label("feeds.tx.conflict"), "feeds-conflict"));
  }

  function render() {
    bar.setAttribute("aria-label", label("feeds.views"));
    for (const v of VIEWS) {
      btns[v].textContent = label("feeds.view." + v);
      btns[v].setAttribute("aria-pressed", String(state.view === v));
    }
    pausedNote.textContent = label("feeds.paused");
    pausedNote.hidden = !state.paused;
    const d = state.data;
    renderSummary(d);
    clear(list);
    const rows = d ? (state.view === "bus" ? d.bus : d.plain) : [];
    const shown = rows.filter((r) => r && typeof r === "object" && (state.focus === null || r.tx === state.focus)).slice().reverse();
    if (shown.length === 0) list.appendChild(el("li", label("feeds.empty"), "empty"));
    for (const r of shown) list.appendChild(state.view === "bus" ? busRow(r) : plainRow(r));
  }

  bar.addEventListener("click", (ev) => {
    const t = ev.target instanceof Element ? ev.target.closest("[data-feeds-view]") : null;
    if (!t || VIEWS.indexOf(t.dataset.feedsView) < 0) return;
    state.view = t.dataset.feedsView;
    try {
      localStorage.setItem(STORE, JSON.stringify({ view: state.view }));
    } catch {
      // без хранилища выбор живёт до перезагрузки
    }
    render();
  });

  document.addEventListener("pult:focus", (ev) => {
    const d = ev && ev.detail;
    state.focus = d && d.level === "tx" && typeof d.tx === "string" && d.tx !== "" ? d.tx : null;
    render();
  });

  document.addEventListener("pult:pause", (ev) => {
    state.paused = Boolean(ev && ev.detail && ev.detail.paused === true);
    if (!state.paused && state.pending) {
      state.data = state.pending;
      state.pending = null;
    }
    render();
  });

  const es = new EventSource("/pult/feeds?lang=" + lang);
  es.onmessage = (m) => {
    let e;
    try {
      e = JSON.parse(m.data);
    } catch {
      return;
    }
    if (!e || typeof e !== "object") return;
    if (e.type === "hello" && e.labels && typeof e.labels === "object") {
      L = e.labels;
      render();
    } else if (e.type === "feeds" && e.view && Array.isArray(e.view.plain) && Array.isArray(e.view.bus)) {
      if (state.paused) state.pending = e.view;
      else {
        state.data = e.view;
        render();
      }
    } else if (e.type === "reset") {
      state.data = null;
      state.pending = null;
      render();
    }
  };
  render();
})();
