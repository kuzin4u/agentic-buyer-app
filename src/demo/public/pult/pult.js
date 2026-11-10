// Пульт DEMO-2 (П-1.1, модель пульта 1.23): каркас — раскладка «сетка 2×2 / вкладки», разворот одной панели, состояние
// ленты. Панели наполняют следующие кирпичи (П-1.2 и дальше). Данные выводятся только через createElement и
// textContent (инвариант 4): разметка из строк не собирается. Выбор раскладки помнит браузер (localStorage) — только
// удобство зрителя: без хранилища пульт работает так же.
/* global document, window, Element, EventSource, CustomEvent, localStorage, setInterval */
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
  // mode — вид панели «Ход»: board (доска) или graph («График», П-2.2).
  const MODES = ["board", "graph"];
  const state = { layout: "grid", max: null, tab: PANES[0], mode: "board" };

  function load() {
    try {
      const v = JSON.parse(localStorage.getItem(STORE) || "null");
      if (v && (v.layout === "grid" || v.layout === "tabs")) state.layout = v.layout;
      if (v && MODES.indexOf(v.mode) >= 0) state.mode = v.mode;
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
    for (const m of document.querySelectorAll("[data-mode]")) m.setAttribute("aria-pressed", String(m.dataset.mode === state.mode));
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
    } else if (t.dataset.mode && MODES.indexOf(t.dataset.mode) >= 0) {
      state.mode = t.dataset.mode;
      save();
      render();
      renderProc();
      return;
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

  // ---- фокус «система → транзакция» (П-1.4): состояние — focus.js, строка крошек — здесь, панели — по событию ----
  // Скрипт фокуса не загрузился — строка фокуса скрыта, остальной пульт работает (ревью П-1.4 № 5).
  const F = window.PultFocus;
  const focusBar = document.getElementById("focusbar");
  const crumbsBox = document.getElementById("crumbs");
  const focusUp = document.getElementById("focus-up");
  let focus = F ? F.initial() : null;

  function renderFocus() {
    if (!F) {
      focusBar.hidden = true;
      return;
    }
    while (crumbsBox.firstChild) crumbsBox.removeChild(crumbsBox.firstChild);
    for (const c of F.crumbs(focus, L)) {
      // Текущая крошка — текст с aria-current="location", переход — только кнопкой выше (ревью П-1.4 № 4).
      const b = document.createElement(c.current ? "span" : "button");
      if (!c.current) b.type = "button";
      b.className = "crumb" + (c.current ? " cur" : "");
      b.dataset.crumb = c.level;
      if (c.current) b.setAttribute("aria-current", "location");
      // Длинный номер обрезается стилем (многоточие), полный — в подсказке (ревью П-1.4 № 8).
      b.textContent = c.label;
      b.title = c.label;
      crumbsBox.appendChild(b);
    }
    focusUp.hidden = focus.level === "system";
    // Связанные панели: каждая получает фокус событием `pult:focus` и сама решает, что показать (П-2 и дальше).
    // Контракт для панели, подключённой позже первого события (ревью П-1.4 № 6): текущее состояние — атрибуты `#grid`
    // `data-focus` (system | tx) и `data-focus-tx` (номер транзакции).
    grid.dataset.focus = focus.level;
    if (focus.tx) grid.dataset.focusTx = focus.tx;
    else delete grid.dataset.focusTx;
    document.dispatchEvent(new CustomEvent("pult:focus", { detail: { level: focus.level, tx: focus.tx } }));
  }

  function setFocus(next) {
    if (next === focus) return;
    focus = next;
    renderFocus();
  }

  // Esc в поле ввода, при наборе через IME и уже обработанный — не фокус пульта (ревью П-1.4 № 1).
  const typing = (t) => t instanceof Element && (t.closest("input, textarea, select, [contenteditable]:not([contenteditable='false'])") !== null);

  // Уровень выше по действию человека: кнопка или крошка, на которой стоял фокус клавиатуры, исчезает — фокус клавиатуры
  // переходит на строку фокуса, а не теряется на body (ревью П-1.4 № 3).
  function goUp() {
    const before = focus;
    setFocus(F.up(focus));
    if (focus !== before) focusBar.focus();
  }

  if (F) {
    // Панели ставят фокус на транзакцию событием `pult:select` с номером транзакции (П-2: карточка доски).
    document.addEventListener("pult:select", (ev) => setFocus(F.focusTx(focus, ev.detail && ev.detail.tx)));
    crumbsBox.addEventListener("click", (ev) => {
      const b = ev.target instanceof Element ? ev.target.closest("[data-crumb]") : null;
      if (b && b.dataset.crumb === "system" && b.tagName === "BUTTON") goUp();
    });
    focusUp.addEventListener("click", goUp);
    document.addEventListener("keydown", (ev) => {
      if (ev.key !== "Escape" || ev.defaultPrevented || ev.isComposing || typing(ev.target)) return;
      goUp();
    });
  }

  // ---- доска «Ход по стадиям» (П-2.1, модель 1.23 v1.20) ----
  const lang = cfg.lang;
  const COLUMNS = ["mandate", "select", "cart", "confirmation", "pay", "result", "post", "done"];
  const DONE_SHOWN = 12;
  const procBox = document.getElementById("b-proc");
  let board = null;
  let boardAt = 0;

  const el = (tag, text, cls) => {
    const e = document.createElement(tag);
    if (text !== undefined && text !== null) e.textContent = String(text);
    if (cls) e.className = cls;
    return e;
  };
  const clock = (iso) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString(lang === "ru" ? "ru-RU" : "en-GB");
  };
  // «В стадии N с» — по часам шины на момент пересчёта плюс время, прошедшее у экрана с прихода доски.
  const secondsIn = (since) => {
    const base = Date.parse(board.now) - Date.parse(since);
    return Math.max(0, Math.round((base + (Date.now() - boardAt)) / 1000));
  };
  const stageText = (since) => label("card.in_stage") + " " + secondsIn(since) + " " + label("card.sec");
  const WORST = { norm: "", conflict: " warn", error: " bad", fraud: " bad" };

  function card(c) {
    const b = el("button", undefined, "bcard" + (WORST[c.worst] || "") + (focus && focus.tx === c.id ? " cur" : ""));
    b.type = "button";
    b.dataset.card = c.id;
    b.title = label("card.select_hint");
    const h = el("div", undefined, "bc-h");
    h.appendChild(el("b", c.id, "bc-id"));
    b.appendChild(h);
    if (c.kind === "mandate") b.appendChild(el("div", label("card.mandate"), "bc-k"));
    if (c.linkConflict) b.appendChild(el("div", label("card.conflict"), "bc-w"));
    else if (c.outcome) b.appendChild(el("div", label("outcome." + c.outcome) + (c.code ? " · " + c.code : ""), "bc-o"));
    else if (c.kind === "mandate" && c.column === "done") b.appendChild(el("div", label("outcome.mandate_revoked"), "bc-o"));
    else {
      const t = el("div", stageText(c.since), "bc-t");
      t.dataset.since = c.since;
      b.appendChild(t);
    }
    if (c.unconfirmed) b.appendChild(el("div", label("card.unconfirmed"), "bc-w"));
    if (c.last) b.appendChild(el("div", clock(c.last.at) + " " + (c.last.phrase[lang] || c.last.phrase.ru), "bc-e"));
    return b;
  }

  // Доска перестраивается только по событию (новая доска, смена фокуса); карточка, на которой стоял фокус клавиатуры,
  // получает его обратно (ревью П-2.1 № 4). Пустая доска — с подсказкой «запустите сюжет» (№ 14).
  function renderBoard() {
    if (!board) return;
    const active = document.activeElement;
    const keep = active && procBox.contains(active) && active.dataset ? active.dataset.card : undefined;
    const wrap = document.createDocumentFragment();
    if (board.cards.length === 0) wrap.appendChild(el("p", label("empty.proc"), "empty"));
    wrap.appendChild(el("p", label("board.note"), "note"));
    const jl = el("div", undefined, "bjumps");
    jl.appendChild(el("span", label("board.jumps") + ": ", "muted"));
    const recent = board.jumps.slice(-6).reverse();
    if (recent.length === 0) jl.appendChild(el("span", label("board.no_jumps"), "muted"));
    for (const j of recent) jl.appendChild(el("span", clock(j.at) + " " + j.id + ": " + label("col." + j.from) + " → " + label("col." + j.to), "bj"));
    wrap.appendChild(jl);
    const grid2 = el("div", undefined, "board");
    for (const k of COLUMNS) {
      let cs = board.cards.filter((c) => c.column === k);
      const n = cs.length;
      const col = el("section", undefined, "bcol" + (k === "done" ? " fin" : ""));
      col.dataset.col = k;
      col.appendChild(el("h3", label("col." + k) + " · " + n, "bcol-h"));
      // «Завершены» — по времени итога, последние сначала (повторное ревью П-2.1 № 4); не больше DONE_SHOWN, остальное —
      // числом. У поручения без покупки итога нет — по первой записи.
      const doneKey = (c) => (typeof c.outcomeSeq === "number" ? c.outcomeSeq : c.order);
      if (k === "done") cs = cs.slice().sort((a, b) => doneKey(b) - doneKey(a)).slice(0, DONE_SHOWN);
      for (const c of cs) col.appendChild(card(c));
      if (n > cs.length) col.appendChild(el("p", label("board.more") + " " + (n - cs.length), "muted"));
      grid2.appendChild(col);
    }
    wrap.appendChild(grid2);
    while (procBox.firstChild) procBox.removeChild(procBox.firstChild);
    procBox.appendChild(wrap);
    if (keep !== undefined) {
      for (const b of procBox.querySelectorAll("[data-card]")) {
        if (b.dataset.card === keep) {
          b.focus();
          break;
        }
      }
    }
  }

  // Выбор карточки — фокус на транзакцию (событие `pult:select`, П-1.4). Мышь — по нажатию (`pointerdown`): доска могла
  // перестроиться до отпускания, и `click` ушёл бы общему предку (повторное ревью П-2.1 № 3); клавиатура — по `click`
  // (Enter, пробел). Повторный выбор той же карточки — то же состояние фокуса, без лишней перерисовки (П-1.4 № 2).
  const select = (ev) => {
    const b = ev.target instanceof Element ? ev.target.closest("[data-card]") : null;
    if (b) document.dispatchEvent(new CustomEvent("pult:select", { detail: { tx: b.dataset.card } }));
  };
  procBox.addEventListener("pointerdown", select);
  procBox.addEventListener("click", select);

  // ---- «График» (П-2.2, модель 1.23 `renderGraph`): строки — транзакции, отрезки стадий по времени, «сейчас» ----
  // Узлы строятся по событию (новая доска, смена фокуса, смена вида); раз в секунду — только положения (layoutGraph):
  // отрезок, идущий до «сейчас», растёт, узлы и фокус клавиатуры не пересоздаются.
  const nowMs = () => Date.parse(board.now) + (Date.now() - boardAt);

  function renderGraph() {
    if (!board) return;
    const rows = board.graph && Array.isArray(board.graph.rows) ? board.graph.rows : [];
    const active = document.activeElement;
    const keep = active && procBox.contains(active) && active.dataset ? active.dataset.card : undefined;
    const wrap = document.createDocumentFragment();
    if (rows.length === 0) wrap.appendChild(el("p", label("empty.proc"), "empty"));
    wrap.appendChild(el("p", label("graph.note"), "note"));
    const legend = el("div", undefined, "glegend");
    legend.appendChild(el("span", label("graph.legend") + ": ", "muted"));
    for (const k of COLUMNS) {
      const it = el("span", label("col." + k), "gl col-" + k);
      legend.appendChild(it);
    }
    wrap.appendChild(legend);
    const g = el("div", undefined, "graph");
    const axis = el("div", undefined, "gaxis");
    axis.appendChild(el("span", "", "gax-start"));
    axis.appendChild(el("span", label("graph.now"), "gax-now"));
    g.appendChild(axis);
    for (const r of rows) {
      const row = el("button", undefined, "grow" + (focus && focus.tx === r.id ? " cur" : ""));
      row.type = "button";
      row.dataset.card = r.id;
      const lastSeg = r.segs[r.segs.length - 1];
      if (lastSeg && lastSeg.col === "done") row.dataset.done = "1";
      row.appendChild(el("span", r.id, "gname"));
      const track = el("span", undefined, "gtrack");
      for (const sg of r.segs) {
        const s = el("span", undefined, "seg col-" + sg.col);
        s.dataset.from = sg.from;
        if (sg.to) s.dataset.to = sg.to;
        s.title = label("col." + sg.col);
        track.appendChild(s);
      }
      for (const mk of r.marks) {
        const m = el("span", undefined, "gmark k-" + mk.kind);
        m.dataset.at = mk.at;
        m.title = label("mark." + mk.kind);
        track.appendChild(m);
      }
      track.appendChild(el("span", undefined, "gnow"));
      row.appendChild(track);
      g.appendChild(row);
    }
    wrap.appendChild(g);
    while (procBox.firstChild) procBox.removeChild(procBox.firstChild);
    procBox.appendChild(wrap);
    layoutGraph();
    if (keep !== undefined) {
      for (const b of procBox.querySelectorAll("[data-card]")) {
        if (b.dataset.card === keep) {
          b.focus();
          break;
        }
      }
    }
  }

  /** Положения отрезков и меток в процентах ширины дорожки. Шкала — от начала самой ранней незавершённой строки (нет
   *  таких — самой ранней строки) до «сейчас», но не дальше GRAPH_WINDOW_MS назад: давние строки и открытые «Завершены»
   *  не сжимают идущие покупки; ранние отрезки обрезаются у левого края (ревью П-2.2 № 2). */
  const GRAPH_WINDOW_MS = 10 * 60 * 1000;
  function layoutGraph() {
    if (!board) return;
    const segs = procBox.querySelectorAll(".seg");
    const marksEls = procBox.querySelectorAll(".gmark");
    if (segs.length === 0 && marksEls.length === 0) return;
    const end = nowMs();
    const rowStart = (row) => {
      const first = row.querySelector(".seg");
      return first ? Date.parse(first.dataset.from) : end;
    };
    const rowsEls = procBox.querySelectorAll(".grow");
    const open = Array.prototype.filter.call(rowsEls, (r) => !r.dataset.done);
    const pool = open.length > 0 ? open : Array.prototype.slice.call(rowsEls);
    let start = end;
    for (const r of pool) start = Math.min(start, rowStart(r));
    start = Math.max(start, end - GRAPH_WINDOW_MS);
    const span = Math.max(1000, end - start);
    const pct = (t) => Math.max(0, Math.min(100, ((t - start) / span) * 100));
    for (const s of segs) {
      const a = pct(Date.parse(s.dataset.from));
      const b = s.dataset.to ? pct(Date.parse(s.dataset.to)) : 100;
      s.style.left = a + "%";
      // Отрезок целиком левее шкалы — нулевой ширины (обрезан), иначе не уже 0,5 % (см. «Открыто», П-9: № 4).
      s.style.width = (b <= 0 ? 0 : Math.max(0.5, b - a)) + "%";
    }
    for (const m of marksEls) m.style.left = pct(Date.parse(m.dataset.at)) + "%";
    const st = procBox.querySelector(".gax-start");
    if (st) st.textContent = clock(new Date(start).toISOString());
  }

  function renderProc() {
    if (state.mode === "graph") renderGraph();
    else renderBoard();
  }

  document.addEventListener("pult:focus", renderProc);
  // Раз в секунду — только текст счётчиков доски и положения «Графика»: узлы не пересоздаются, фокус и щелчок не теряются
  // (ревью П-2.1 № 4).
  setInterval(() => {
    if (!board) return;
    if (state.mode === "graph") {
      layoutGraph();
      return;
    }
    for (const t of procBox.querySelectorAll(".bc-t")) {
      if (t.dataset.since) t.textContent = stageText(t.dataset.since);
    }
  }, 1000);

  load();
  render();
  renderFocus();
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
    else if (e.type === "board" && e.board && Array.isArray(e.board.cards)) {
      board = e.board;
      boardAt = Date.now();
      renderProc();
    }
  };
  // Обрыв связи пульта с сервером — не то же, что отключение шины у источника; EventSource переподключится сам. Если
  // браузер закрыл ленту окончательно (ответ не SSE: 404, 421), переподключения не будет — отключён пульт, а не шина
  // (ревью № 6, повторное ревью № 1).
  es.onerror = () => setStatus(es.readyState === EventSource.CLOSED ? "pult_closed" : "screen_offline");
})();
