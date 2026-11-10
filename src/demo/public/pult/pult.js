// Пульт DEMO-2 (П-1.1, модель пульта 1.23): каркас — раскладка «сетка 2×2 / вкладки», разворот одной панели, состояние
// ленты. Панели наполняют следующие кирпичи (П-1.2 и дальше). Данные выводятся только через createElement и
// textContent (инвариант 4): разметка из строк не собирается. Выбор раскладки помнит браузер (localStorage) — только
// удобство зрителя: без хранилища пульт работает так же.
/* global document, Element, EventSource, localStorage */
"use strict";

(function () {
  const cfg = JSON.parse(document.getElementById("i18n").textContent);
  const L = cfg.labels;
  const PANES = cfg.panes;
  const label = (key) => (Object.prototype.hasOwnProperty.call(L, key) ? L[key] : key);

  const grid = document.getElementById("grid");
  const tabbar = document.getElementById("tabbar");
  const status = document.getElementById("status");
  const statusIcon = document.getElementById("status-icon");
  const statusBox = document.getElementById("conn");

  // ---- раскладка ----
  const STORE = "pult.layout.v1";
  const state = { layout: "grid", max: null, tab: PANES[0] };

  function load() {
    try {
      const v = JSON.parse(localStorage.getItem(STORE) || "null");
      if (v && (v.layout === "grid" || v.layout === "tabs")) state.layout = v.layout;
      if (v && PANES.indexOf(v.tab) >= 0) state.tab = v.tab;
      if (v && PANES.indexOf(v.max) >= 0) state.max = v.max;
    } catch {
      // Хранилище недоступно (приватное окно, запрет сайта) — раскладка по умолчанию.
    }
  }

  function save() {
    try {
      localStorage.setItem(STORE, JSON.stringify(state));
    } catch {
      // Не сохранилось — не страшно: раскладка — удобство, не данные.
    }
  }

  function render() {
    const tabs = state.layout === "tabs";
    grid.classList.toggle("tabs", tabs);
    grid.classList.toggle("max", !tabs && state.max !== null);
    tabbar.hidden = !tabs;
    for (const b of document.querySelectorAll("[data-layout]")) b.setAttribute("aria-pressed", String(b.dataset.layout === state.layout));
    for (const p of PANES) {
      const pane = document.getElementById("p-" + p);
      pane.classList.toggle("is-tab", tabs && state.tab === p);
      pane.classList.toggle("is-max", !tabs && state.max === p);
      // Кнопка разворота — смена подписи, без aria-pressed (ревью П-1.1 № 2); какая панель — по aria-describedby.
      const btn = pane.querySelector("[data-max]");
      const on = !tabs && state.max === p;
      btn.hidden = tabs;
      btn.textContent = label(on ? "pane.restore" : "pane.maximize");
    }
    for (const t of tabbar.querySelectorAll("[data-tab]")) t.setAttribute("aria-pressed", String(t.dataset.tab === state.tab));
  }

  document.addEventListener("click", (ev) => {
    const t = ev.target instanceof Element ? ev.target.closest("button") : null;
    if (!t) return;
    if (t.dataset.layout) {
      state.layout = t.dataset.layout === "tabs" ? "tabs" : "grid";
      state.max = null;
    } else if (t.dataset.max) {
      state.max = state.max === t.dataset.max ? null : t.dataset.max;
    } else if (t.dataset.tab) {
      state.tab = t.dataset.tab;
    } else return;
    save();
    render();
  });

  // ---- состояние ленты: значок, цвет и текст (как З7 экрана К1.4) ----
  const CONN = { open: "ok", connecting: "wait", reset: "wait", closed: "lost", screen_offline: "lost", pult_closed: "lost" };
  const CONN_ICON = { ok: "●", wait: "◌", lost: "✕" };

  // Незнакомое состояние источника — нейтральной подписью «подключение», а не служебным ключом (ревью П-1.1 № 7).
  // То же состояние повторно не пишется: onerror при переподключении срабатывает раз в ≈ 3 с, а role="status" диктор
  // объявлял бы по кругу (повторное ревью П-1.1 № 2).
  let shown = null;
  function setStatus(s) {
    if (s === shown) return;
    shown = s;
    const known = Object.prototype.hasOwnProperty.call(CONN, s);
    const st = known ? CONN[s] : "wait";
    status.textContent = label("status." + (known ? s : "connecting"));
    statusIcon.textContent = CONN_ICON[st];
    statusBox.className = "conn conn-" + st;
  }

  load();
  render();
  setStatus("connecting");

  const es = new EventSource("/pult/events");
  es.onmessage = (m) => {
    let e;
    try {
      e = JSON.parse(m.data);
    } catch {
      return;
    }
    if (e.type === "hello" || e.type === "status") setStatus(e.status);
  };
  // Обрыв связи пульта с сервером — не то же, что отключение шины у источника; EventSource переподключится сам. Если
  // браузер закрыл ленту окончательно (ответ не SSE: 404, 421), переподключения не будет — отключён пульт, а не шина
  // (ревью № 6, повторное ревью № 1).
  es.onerror = () => setStatus(es.readyState === EventSource.CLOSED ? "pult_closed" : "screen_offline");
})();
