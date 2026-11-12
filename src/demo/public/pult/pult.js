// Пульт DEMO-2 (П-1.1, модель пульта 1.23): каркас — раскладка «сетка 2×2 / вкладки», разворот одной панели, состояние
// ленты. Панели наполняют следующие кирпичи (П-1.2 и дальше). Данные выводятся только через createElement и
// textContent (инвариант 4): разметка из строк не собирается. Выбор раскладки помнит браузер (localStorage) — только
// удобство зрителя: без хранилища пульт работает так же.
/* global document, window, Element, EventSource, CustomEvent, localStorage, setInterval, URLSearchParams */
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
  // ctlView — вид «Контроля» (П-4.2): «Приоритет» или «Все 89».
  const CTL_VIEWS = ["prio", "all"];
  const state = { layout: "grid", max: null, tab: PANES[0], mode: "board", ctlView: "prio" };

  function load() {
    try {
      const v = JSON.parse(localStorage.getItem(STORE) || "null");
      if (v && (v.layout === "grid" || v.layout === "tabs")) state.layout = v.layout;
      if (v && MODES.indexOf(v.mode) >= 0) state.mode = v.mode;
      if (v && CTL_VIEWS.indexOf(v.ctlView) >= 0) state.ctlView = v.ctlView;
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
    for (const v of document.querySelectorAll("[data-ctl-view]")) v.setAttribute("aria-pressed", String(v.dataset.ctlView === state.ctlView));
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
    // Признаки итога (П-3.2а): «оплачено» после отзыва (В5), два списания (R46); операции — при повторе (В6).
    if (c.afterRevoke) b.appendChild(el("div", label("card.after_revoke"), "bc-w"));
    if (c.doubleDebit) b.appendChild(el("div", label("card.double_debit"), "bc-w"));
    if (Array.isArray(c.ops))
      b.appendChild(el("div", label("card.ops") + ": " + c.ops.map((o) => o.opRef + " — " + label(o.kind ? "op." + o.kind : "op.none")).join(" · "), "bc-ops"));
    if (c.unconfirmed) b.appendChild(el("div", label("card.unconfirmed"), "bc-w"));
    if (c.pending) b.appendChild(el("div", label("card.pending"), "bc-p"));
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
      let cs = board.cards.filter((c) => c.column === k && pass(c));
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
    const byId = new Map(board.cards.map((c) => [c.id, c]));
    const rows = (board.graph && Array.isArray(board.graph.rows) ? board.graph.rows : []).filter((r) => pass(byId.get(r.id)));
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
      const name = el("span", r.id, "gname");
      // Пометки строки (П-3.2а): «оплачено» после отзыва (В5), два списания (R46) — строкой под номером, в ячейке имени.
      if (r.afterRevoke) name.appendChild(el("span", label("card.after_revoke"), "gflag"));
      if (r.doubleDebit) name.appendChild(el("span", label("card.double_debit"), "gflag"));
      row.appendChild(name);
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

  // ---- разрезы (П-2.3, модель 1.23 `buildFilters`): стадия, продавец, тип, поручения без покупки ----
  // Один фильтр на доску и «График»; строка «Графика» проверяется по карточке с тем же номером. Разрез — удобство
  // зрителя: данные не меняются, число скрытых показано.
  const cutStage = document.getElementById("cut-stage");
  const cutMerchant = document.getElementById("cut-merchant");
  const cutMandates = document.getElementById("cut-mandates");
  const cutHidden = document.getElementById("cut-hidden");
  const cut = { stage: "", merchant: "", kinds: { norm: true, conflict: true, error: true, fraud: true }, mandates: true };

  function pass(c) {
    if (!c) return true;
    if (cut.stage && c.column !== cut.stage) return false;
    // Продавцов у транзакции может быть несколько (конфликт звеньев) — видна в разрезе любого своего (ревью П-2.3 № 4).
    if (cut.merchant && !(Array.isArray(c.merchantIds) && c.merchantIds.indexOf(cut.merchant) >= 0)) return false;
    if (cut.kinds[c.worst] === false) return false;
    if (!cut.mandates && c.kind === "mandate") return false;
    return true;
  }

  /** Список продавцов — по карточкам доски; обновляется на месте, выбранный остаётся (даже если ушёл с доски). */
  function syncMerchants() {
    if (!cutMerchant || !board) return;
    const all = [];
    for (const c of board.cards) if (Array.isArray(c.merchantIds)) for (const m of c.merchantIds) if (typeof m === "string") all.push(m);
    const ids = Array.from(new Set(all)).sort();
    if (cut.merchant && ids.indexOf(cut.merchant) < 0) ids.push(cut.merchant);
    const have = Array.prototype.slice.call(cutMerchant.querySelectorAll("option")).map((o) => o.getAttribute("value"));
    for (const id of ids) {
      if (have.indexOf(id) >= 0) continue;
      const o = document.createElement("option");
      o.setAttribute("value", id);
      o.textContent = id;
      cutMerchant.appendChild(o);
    }
  }

  function renderProc() {
    const all = board ? board.cards : [];
    const shown = all.filter(pass);
    if (cutHidden) cutHidden.textContent = all.length > shown.length ? label("cut.hidden") + ": " + (all.length - shown.length) : "";
    if (state.mode === "graph") renderGraph();
    else renderBoard();
  }

  // Нет хотя бы одного поля разрезов — разрезы не подключаются, пульт работает без них (ревью П-2.3 № 5).
  const cutReset = document.getElementById("cut-reset");
  if (cutStage && cutMerchant && cutMandates && cutReset) {
    cutStage.addEventListener("change", () => {
      cut.stage = cutStage.value;
      renderProc();
    });
    cutMerchant.addEventListener("change", () => {
      cut.merchant = cutMerchant.value;
      renderProc();
    });
    cutMandates.addEventListener("change", () => {
      cut.mandates = cutMandates.checked;
      renderProc();
    });
    for (const b of document.querySelectorAll("[data-cut-kind]")) {
      b.addEventListener("click", () => {
        const k = b.dataset.cutKind;
        cut.kinds[k] = !cut.kinds[k];
        b.setAttribute("aria-pressed", String(cut.kinds[k]));
        renderProc();
      });
    }
    cutReset.addEventListener("click", () => {
      cut.stage = "";
      cut.merchant = "";
      cut.mandates = true;
      for (const k of Object.keys(cut.kinds)) cut.kinds[k] = true;
      cutStage.value = "";
      cutMerchant.value = "";
      cutMandates.checked = true;
      for (const b of document.querySelectorAll("[data-cut-kind]")) b.setAttribute("aria-pressed", "true");
      renderProc();
    });
  }

  // ---- «Контроль» (П-4.1): паспорта по правилу паспорта, «Идёт к нарушению», «В работе сейчас» ----
  // Порог «Идёт к нарушению» применяет экран по «сейчас» (часы шины + время у экрана): строка появляется и без новой
  // записи. «Операция без шага агента — возможно, чужая операция» — предположение, не паспорт (условие Р-1478).
  const ctlBox = document.getElementById("b-ctl");
  const txt = (t) => (t && typeof t === "object" ? t[lang === "en" ? "en" : "ru"] || t.ru || "" : "");
  const subj = (s) => label("subj." + s);
  let ctlDueKey = "";
  const dueWaits = () => {
    const c = board && board.control;
    if (!c || !Array.isArray(c.waits)) return [];
    const now = nowMs();
    return c.waits.filter((w) => now - Date.parse(w.since) >= c.waitMs);
  };
  // Ключ набора строк: два запроса подтверждения одной транзакции различаются номером (ревью П-4.1 № 9).
  const dueKey = (ws) => ws.map((w) => w.kind + ":" + w.obj + ":" + (w.confirmationId || "")).join("|");
  const waitSeconds = (since) => Math.max(0, Math.round((nowMs() - Date.parse(since)) / 1000));

  // ---- «Условия» (П-4.2, модель 1.23 `nodeTiles`, `sectLights`, `list89`): «Приоритет» и «Все 89» ----
  // Справочник 89 правил — данными страницы (`#rules89`), статусы — только из `board.conditions` (движок, инвариант 2): экран
  // статус не считает. «Внимание» у сектора — признак экрана по строкам «Идёт к нарушению» за порогом: значок, цвет сектора
  // от него не меняется (уточнение 3 к плану П-4.2). Панель инструментов «Все 89» (поиск, зоны, сектор) строится один раз —
  // перестройка по новой доске не трогает поле поиска; перестраивается только тело.
  let R89 = null;
  try {
    R89 = JSON.parse(document.getElementById("rules89").textContent);
  } catch {
    R89 = null; // справочника нет — «Контроль» без «Условий», как в П-4.1
  }
  const cv = { q: "", zone: "", sector: "", open: "", groups: {} };
  const ctlBar = el("div", undefined, "cv-bar");
  const allBar = el("div", undefined, "c89bar");
  const ctlBody = el("div", undefined, "ctl-body");
  const qInput = el("input");
  const secChip = el("button", undefined, "cv-sec");
  const countsEl = el("span", undefined, "muted c89-count");
  const has = (o, k) => o && Object.prototype.hasOwnProperty.call(o, k);
  const stName = (s) => (R89 && has(R89.statuses, s) ? R89.statuses[s] : String(s));
  if (ctlBox) {
    if (R89) {
      ctlBar.setAttribute("role", "group");
      ctlBar.setAttribute("aria-label", label("cv.label"));
      ctlBar.appendChild(el("span", label("cv.label") + ": ", "muted"));
      for (const v of CTL_VIEWS) {
        const b = el("button", label("cv." + v));
        b.type = "button";
        b.dataset.ctlView = v;
        ctlBar.appendChild(b);
      }
      qInput.type = "search";
      qInput.setAttribute("aria-label", label("cv.search"));
      qInput.setAttribute("placeholder", label("cv.search"));
      allBar.appendChild(qInput);
      const zones = el("span", label("cv.zone") + ": ", "cv-zones");
      for (const z of [{ id: "", name: label("cv.zone.all") }].concat(R89.zones)) {
        const b = el("button", z.name, "chip" + (z.id ? " z-" + z.id : ""));
        b.type = "button";
        b.dataset.zone = z.id;
        zones.appendChild(b);
      }
      allBar.appendChild(zones);
      secChip.type = "button";
      secChip.dataset.sectorClear = "1";
      secChip.title = label("cv.sector.clear");
      secChip.hidden = true;
      allBar.appendChild(secChip);
      allBar.appendChild(countsEl);
      allBar.hidden = true;
      qInput.addEventListener("input", () => {
        cv.q = qInput.value;
        cv.groups = {};
        renderCtl();
      });
    }
    while (ctlBox.firstChild) ctlBody.appendChild(ctlBox.firstChild);
    if (R89) ctlBox.appendChild(ctlBar);
    if (R89) ctlBox.appendChild(allBar);
    ctlBox.appendChild(ctlBody);
  }

  /** Плитки узлов У1–У5: статус узла, объекты с «нарушено» / «сработало», пометки, правила и условия, «к нарушению». */
  function renderNodes(wrap, C) {
    wrap.appendChild(el("h3", label("cv.nodes"), "ctl-h"));
    const box = el("div", undefined, "tiles");
    for (const n of R89.nodes) {
      const t = (Array.isArray(C.nodes) ? C.nodes : []).find((x) => x && x.id === n.id);
      // Узла нет в данных движка — статуса нет («—»), экран его не подставляет (ревью П-4.2 № 6).
      const st = t ? t.status : null;
      const hit = st === "bad" || st === "fired";
      const objs = t && Array.isArray(t.objs) ? t.objs : [];
      const where = objs.slice();
      // Часть записью системы (П-3.2г) — «система», одна или рядом с объектами (уточнение 1; ревью П-4.2 № 2).
      if (hit && (t.system || objs.length === 0)) where.push(label("cv.node.system"));
      const tile = el("div", undefined, "tile st-" + (st || "none"));
      tile.dataset.node = n.id;
      tile.appendChild(el("div", n.id + " " + n.name, "tl-h"));
      tile.appendChild(el("div", (st ? stName(st) : "—") + (hit ? ": " + where.join(" · ") : ""), "tl-s"));
      for (const nt of (t && Array.isArray(t.notes) ? t.notes : [])) tile.appendChild(el("div", has(R89.notes, nt) ? R89.notes[nt] : String(nt), "tl-n"));
      tile.appendChild(el("div", label("cv.node.rules") + " " + n.rules.join(", ") + " · " + label("cv.node.conds") + " " + n.conds.join(", "), "tl-r muted"));
      // Кнопка — только у «нарушено»: сработавшая защита — не нарушение, кнопки нет (ревью П-4.2 № 1, Р-1505).
      if (st === "bad") {
        const noTx = objs.length === 0;
        const b = el("button", label(noTx ? "cv.node.no_tx" : "cv.node.go"), "tl-go");
        b.type = "button";
        if (noTx) b.setAttribute("disabled", "");
        else b.dataset.go = String(objs[0]);
        tile.appendChild(b);
      }
      box.appendChild(tile);
    }
    wrap.appendChild(box);
  }

  /** Светофоры секторов: статус — из движка; «внимание» — значком по строкам «Идёт к нарушению» за порогом. */
  function renderSectors(wrap, C, due) {
    wrap.appendChild(el("h3", label("cv.sectors"), "ctl-h"));
    const box = el("div", undefined, "sects");
    for (const s of R89.sectors) {
      const l = (Array.isArray(C.sectors) ? C.sectors : []).find((x) => x && x.id === s.id);
      const st = l ? l.status : null;
      const b = el("button", undefined, "sect st-" + (st || "none"));
      b.type = "button";
      b.dataset.sector = s.id;
      b.title = label("cv.sector.hint");
      b.appendChild(el("i", undefined, "dot"));
      b.appendChild(el("span", s.name));
      b.appendChild(el("span", " · " + (st ? stName(st) : "—"), "muted"));
      const att = due.filter((w) => w.cond && s.conds.indexOf(w.cond) >= 0).length;
      if (att > 0) b.appendChild(el("span", " ⚑ " + label("cv.attention") + ": " + att, "sect-att"));
      box.appendChild(b);
    }
    wrap.appendChild(box);
  }

  const ruleMatch = (r, q) =>
    r.id.toLowerCase().indexOf(q) >= 0 ||
    r.conds.some((c) => c.toLowerCase().indexOf(q) >= 0) ||
    r.text.rule.toLowerCase().indexOf(q) >= 0 ||
    r.text.evidence.toLowerCase().indexOf(q) >= 0;

  function ruleCard(r) {
    const d = el("dl", undefined, "c89card");
    d.dataset.card89 = r.id;
    const add = (k, v) => {
      if (v === undefined || v === null || v === "") return;
      d.appendChild(el("dt", label("cv.card." + k)));
      d.appendChild(el("dd", String(v)));
    };
    const node = r.node ? R89.nodes.find((n) => n.id === r.node) : undefined;
    const sector = r.sector ? R89.sectors.find((s) => s.id === r.sector) : undefined;
    add("who", r.text.who);
    add("evidence", r.text.evidence);
    add("owner", r.owner);
    add("kind", r.kind);
    add("control", r.control);
    add("conds", r.conds.join(", "));
    add("node", node ? node.id + " " + node.name : undefined);
    add("sector", sector ? sector.name : undefined);
    add("point", r.point);
    add("coverage", r.coverage);
    add("score", r.v + " × " + r.c + " = " + r.score);
    add("why_vuln", r.text.whyVuln);
    add("why_crit", r.text.whyCrit);
    return d;
  }

  /** «Все 89»: поиск, зона, сектор; группы А–Р; строка — статус из движка, номер, зона с баллом, формулировка. */
  function renderAll(wrap, C) {
    const counts = C && C.counts ? C.counts : null;
    countsEl.textContent = counts
      ? label("cv.counts") + ": " + Object.keys(R89.statuses).filter((k) => counts[k] > 0).map((k) => stName(k) + " " + counts[k]).join(" · ")
      : label("cv.no_data");
    for (const b of allBar.querySelectorAll("[data-zone]")) b.setAttribute("aria-pressed", String(b.dataset.zone === cv.zone));
    const sec = cv.sector ? R89.sectors.find((s) => s.id === cv.sector) : undefined;
    secChip.hidden = !sec;
    secChip.textContent = sec ? label("cv.sector") + ": " + sec.name + " ×" : "";
    const q = cv.q.trim().toLowerCase();
    const rows = R89.rules.filter((r) => (!cv.zone || r.zone === cv.zone) && (!cv.sector || r.sector === cv.sector) && (!q || ruleMatch(r, q)));
    const stOf = (r) => (C && C.rules && has(C.rules, r.id) ? C.rules[r.id] : undefined);
    const zoneName = (z) => {
      const x = R89.zones.find((y) => y.id === z);
      return x ? x.name : z;
    };
    for (const g of R89.groups) {
      const gr = rows.filter((r) => r.group === g.id);
      if (gr.length === 0) continue;
      const nb = gr.filter((r) => stOf(r) === "bad").length;
      const auto = Boolean(q || cv.zone || cv.sector || nb > 0 || gr.some((r) => r.id === cv.open));
      const open = has(cv.groups, g.id) ? cv.groups[g.id] : auto;
      const box = el("section", undefined, "cgroup");
      const h = el("button", g.id + ". " + g.name + " · " + gr.length + (nb > 0 ? " · " + label("cv.group.bad") + " " + nb : ""), "cg-h");
      h.type = "button";
      h.dataset.group = g.id;
      h.setAttribute("aria-expanded", String(open));
      box.appendChild(h);
      if (open) {
        for (const r of gr) {
          const s = stOf(r);
          const row = el("button", undefined, "r89 z-" + r.zone + (s === "bad" ? " bad" : "") + (cv.open === r.id ? " open" : ""));
          row.type = "button";
          row.dataset.rule = r.id;
          row.setAttribute("aria-expanded", String(cv.open === r.id));
          row.appendChild(el("span", s ? stName(s) : "—", "s89 st-" + (s || "none")));
          row.appendChild(el("span", r.id, "cid"));
          row.appendChild(el("span", zoneName(r.zone) + " " + r.score, "zb z-" + r.zone));
          row.appendChild(el("span", r.text.rule + (r.enLater ? " (" + R89.enLater + ")" : ""), "cru"));
          box.appendChild(row);
          if (cv.open === r.id) box.appendChild(ruleCard(r));
        }
      }
      wrap.appendChild(box);
    }
    if (rows.length === 0) wrap.appendChild(el("p", label("cv.empty"), "muted"));
  }

  const FOCUS_KEYS = ["rule", "group", "go", "sector"];
  function renderCtl() {
    if (!ctlBox || !board || !board.control) return;
    const view = R89 ? state.ctlView : "prio";
    for (const b of ctlBar.querySelectorAll("[data-ctl-view]")) b.setAttribute("aria-pressed", String(b.dataset.ctlView === view));
    allBar.hidden = view !== "all";
    // Кнопка, на которой стоял фокус клавиатуры, получает его обратно после перестройки (как карточка доски).
    const active = document.activeElement;
    const keepKey = active && ctlBody.contains(active) && active.dataset ? FOCUS_KEYS.find((k) => active.dataset[k] !== undefined) : undefined;
    const keepVal = keepKey ? active.dataset[keepKey] : undefined;
    const wrap = document.createDocumentFragment();
    const due = dueWaits();
    ctlDueKey = dueKey(due);
    if (view === "all") renderAll(wrap, board.conditions);
    else renderPrio(wrap, due);
    while (ctlBody.firstChild) ctlBody.removeChild(ctlBody.firstChild);
    ctlBody.appendChild(wrap);
    if (keepKey) {
      for (const b of ctlBody.querySelectorAll("[data-" + keepKey + "]")) {
        if (b.dataset[keepKey] === keepVal) {
          b.focus();
          break;
        }
      }
    }
  }

  if (ctlBox) {
    // Переходы «Условий». «К нарушению» — фокус на транзакцию (`pult:select`), и по нажатию мыши: тело могло перестроиться
    // до отпускания (как у карточки доски); повторный выбор той же транзакции — без перерисовки (П-1.4 № 2).
    ctlBox.addEventListener("pointerdown", (ev) => {
      const b = ev.target instanceof Element ? ev.target.closest("[data-go]") : null;
      if (b) document.dispatchEvent(new CustomEvent("pult:select", { detail: { tx: b.dataset.go } }));
    });
    ctlBox.addEventListener("click", (ev) => {
      const b = ev.target instanceof Element ? ev.target.closest("button") : null;
      if (!b || !ctlBox.contains(b) || b.hasAttribute("disabled")) return;
      const d = b.dataset;
      // Кнопки реакции (П-8.1): отзыв — второй шаг только кнопкой «Да, отозвать» (В4); «Отмена» — без запроса.
      if (d.actCancel !== undefined) {
        actState.pending = "";
        renderCtl();
        return;
      }
      if (d.act !== undefined) {
        if (d.act === "revoke" && d.second === undefined) {
          actState.pending = d.actKey;
          renderCtl();
          return;
        }
        actState.pending = "";
        sendAct(d.act, d.params || "", d.actKey);
        return;
      }
      if (d.ctlView !== undefined) {
        if (CTL_VIEWS.indexOf(d.ctlView) < 0) return;
        state.ctlView = d.ctlView;
        save();
      } else if (d.zone !== undefined) {
        cv.zone = d.zone;
        cv.groups = {};
      } else if (d.sectorClear !== undefined) {
        cv.sector = "";
        cv.groups = {};
      } else if (d.sector !== undefined) {
        // Щелчок по сектору — «Все 89» с правилами этого сектора (поле справочника, а не поиск по тексту).
        cv.sector = d.sector;
        cv.zone = "";
        cv.q = "";
        qInput.value = "";
        cv.groups = {};
        state.ctlView = "all";
        save();
      } else if (d.group !== undefined) {
        cv.groups[d.group] = b.getAttribute("aria-expanded") !== "true";
      } else if (d.rule !== undefined) {
        cv.open = cv.open === d.rule ? "" : d.rule;
      } else if (d.go !== undefined) {
        document.dispatchEvent(new CustomEvent("pult:select", { detail: { tx: d.go } }));
        return;
      } else return;
      renderCtl();
    });
  }

  // ---- кнопки реакции (П-8.1; модель «Кнопки реакции» v1.0, Р-1526, Р-1527) ----
  // Только в режиме показа или сбоев (`cfg.actions`, В2): иначе экран прежний. Ответ стенда — как есть: «отказано» с кодом,
  // не «сделано» (инвариант 2). У R08 / R18 «Напомнить» — запись «напомнено» без стенда (В1 (а)). Отзыв — в два шага (В4):
  // первое нажатие запрос не шлёт. «Повторить уведомление» — неактивна, «на стенде нет» (В3).
  const ACTIONS = cfg.actions === true;
  const actState = { pending: "", results: {} };
  const VIOLATOR = { agent: "AGENT", merchant: "MERCHANT", bank: "BANK", platform: "PLATFORM", operator: "OPERATOR" };
  function actButton(key, text, act, params, cls) {
    const b = el("button", text, "act-btn" + (cls ? " " + cls : ""));
    b.type = "button";
    b.dataset.act = act;
    b.dataset.actKey = key;
    b.dataset.params = new URLSearchParams(params).toString();
    return b;
  }
  function disabledButton(text, note) {
    const box = el("span", undefined, "act-off");
    const b = el("button", text, "act-btn");
    b.type = "button";
    b.setAttribute("disabled", "");
    box.appendChild(b);
    box.appendChild(el("span", " " + note, "muted"));
    return box;
  }
  function describeReaction(x) {
    if (!x || typeof x !== "object") return label("act.failed");
    if (typeof x.error === "string") return label("act.refused") + " · " + x.error;
    if (x.outcome === "noted") return label("act.noted");
    const r = x.result && typeof x.result === "object" ? x.result : {};
    // Напоминание без продления (стенд уже продлевал срок): не «сделано», а отдельный итог (ревью П-8.1 № 5).
    if (x.outcome === "done" && r.extended === false) return label("act.not_extended") + " " + (typeof r.expiresAt === "string" ? clock(r.expiresAt) : "—");
    const parts = [label(x.outcome === "done" ? "act.done" : "act.refused")];
    if (typeof r.status === "number") parts.push(String(r.status));
    if (typeof r.code === "string") parts.push(r.code);
    if (typeof r.expiresAt === "string" && r.extended) parts.push(label("act.extended") + " " + clock(r.expiresAt));
    if (Array.isArray(r.rejected) && r.rejected.length > 0) parts.push(label("act.closed") + ": " + r.rejected.join(", "));
    return parts.join(" · ");
  }
  /** Поле разбора по типу номера на пульте (ревью П-8.1 № 1; повторное № 1): `cart:` — поручение корзины (транзакция с
   *  конфликтом звеньев, первое звено — корзина), `order:` — номер заказа, `op:` — операция, `confirmation:` — запрос
   *  подтверждения, иначе — поручение; префикс пульта стенду не отправляется. Перечень — `NODE_TYPE` в `src/pult/tx.ts`. */
  const REVIEW_PREFIX = [
    ["cart:", "mandate_id"],
    ["order:", "order_id"],
    ["op:", "op_ref"],
    ["confirmation:", "confirmation_id"],
  ];
  function reviewIds(obj) {
    for (const [p, field] of REVIEW_PREFIX) if (obj.indexOf(p) === 0) return { [field]: obj.slice(p.length) };
    return { mandate_id: obj };
  }
  function sendAct(act, query, key) {
    actState.results[key] = label("act.sending");
    renderCtl();
    const f = window.fetch;
    if (typeof f !== "function") {
      actState.results[key] = label("act.failed");
      renderCtl();
      return;
    }
    f("/pult/act/" + act + "?" + query, { method: "POST" })
      .then((r) => r.json())
      .then((body) => {
        actState.results[key] = describeReaction(body);
        renderCtl();
      })
      .catch(() => {
        actState.results[key] = label("act.failed");
        renderCtl();
      });
  }
  const resultOf = (key) => (actState.results[key] ? el("div", actState.results[key], "act-result") : null);
  const append = (box, node) => {
    if (node) box.appendChild(node);
  };
  /** Кнопки транзакции в «В работе сейчас»: остановить покупку, отозвать поручение (два шага), повторить уведомление. */
  function txButtons(row, id) {
    const card = board.cards.find((x) => x.id === id);
    const bar = el("div", undefined, "act-bar");
    // «Остановить покупку» — только при известном поручении корзины (ревью П-8.1 № 2): у `op:…`, `confirmation:…`,
    // `order:…` корзины нет — стенд заведомо отказал бы.
    const cart = card && card.kind === "tx" && typeof card.cartMandateId === "string" ? card.cartMandateId : "";
    if (cart) bar.appendChild(actButton("stop:" + id, label("act.stop"), "stop", { cart: cart }));
    const intent = card && typeof card.intentId === "string" ? card.intentId : "";
    if (intent) {
      const key = "revoke:" + intent;
      if (actState.pending === key) {
        bar.appendChild(el("span", label("act.revoke.ask") + " ", "act-ask"));
        const yes = actButton(key, label("act.revoke.yes"), "revoke", { mandate: intent }, "act-second");
        yes.dataset.second = "1";
        bar.appendChild(yes);
        const no = el("button", label("act.cancel"), "act-btn");
        no.type = "button";
        no.dataset.actCancel = "1";
        bar.appendChild(no);
      } else bar.appendChild(actButton(key, label("act.revoke"), "revoke", { mandate: intent }));
    }
    bar.appendChild(disabledButton(label("act.notify"), label("act.notify.none")));
    row.appendChild(bar);
    append(row, resultOf("stop:" + id));
    if (intent) append(row, resultOf("revoke:" + intent));
  }

  /** «Приоритет»: строка состояния, плитки узлов, сектора, затем блоки П-4.1 — паспорта, «Идёт к нарушению», «В работе». */
  function renderPrio(wrap, due) {
    const c = board.control;
    wrap.appendChild(
      el("p", label("ctl.status") + ": " + c.counts.txs + " · " + label("ctl.status.wrong") + ": " + c.counts.wrong + " · " + label("ctl.status.waits") + ": " + due.length, "ctl-status"),
    );
    if (R89 && board.conditions) {
      renderNodes(wrap, board.conditions);
      renderSectors(wrap, board.conditions, due);
    } else if (R89) wrap.appendChild(el("p", label("cv.no_data"), "muted"));
    wrap.appendChild(el("h3", label("ctl.passports"), "ctl-h"));
    if (c.passports.length === 0) wrap.appendChild(el("p", label("ctl.passports.none"), "muted"));
    for (const ps of c.passports) {
      const box = el("div", undefined, "passport");
      box.dataset.obj = ps.obj || "";
      box.appendChild(el("div", ps.obj || label("ctl.system"), "pp-h"));
      for (const f of ps.findings) {
        const parts = [];
        if (f.cond) parts.push(f.cond + (f.condText ? " " + txt(f.condText) : ""));
        if (f.node) parts.push(label("ctl.node") + " " + f.node + (f.nodeText ? " " + txt(f.nodeText) : ""));
        parts.push(label("ctl.violator") + ": " + subj(f.violator));
        if (f.protector) parts.push(label("ctl.protector") + ": " + subj(f.protector));
        if (f.note === "race_c28") parts.push(label("ctl.race_c28"));
        const line = el("div", parts.join(" · "), "pp-f");
        // «Передать на разбор» — условие и нарушитель из вердикта; нарушитель не определён — разбор владельцем.
        if (ACTIONS && f.cond && ps.obj) {
          const key = "review:" + ps.obj + ":" + f.cond;
          if (Object.prototype.hasOwnProperty.call(VIOLATOR, f.violator)) {
            const ids = reviewIds(ps.obj);
            ids.condition = f.cond;
            ids.violator = VIOLATOR[f.violator];
            line.appendChild(actButton(key, label("act.review"), "review", ids));
          }
          else line.appendChild(disabledButton(label("act.review"), label("act.review.undetermined")));
          append(line, resultOf(key));
        }
        box.appendChild(line);
      }
      wrap.appendChild(box);
    }
    wrap.appendChild(el("h3", label("ctl.waits"), "ctl-h"));
    if (due.length === 0) wrap.appendChild(el("p", label("ctl.waits.none"), "muted"));
    for (const w of due) {
      const row = el("div", undefined, "wait-row");
      row.dataset.wait = w.kind;
      row.appendChild(el("span", (w.cond ? w.cond + " · " : "") + label("ctl.wait." + w.kind) + " · " + w.obj + (w.confirmationId ? " · " + w.confirmationId : "") + " · "));
      const s = el("span", waitSeconds(w.since) + " " + label("card.sec"), "wait-s");
      s.dataset.since = w.since;
      row.appendChild(s);
      // «Возможно, чужая операция» — предположение, не нарушение: реакции нет (условие Р-1478). Реакция «Напомнить
      // клиенту» — только у подтверждения: стенд продлевает срок запроса подтверждения (ревью П-4.1 № 10).
      if (w.kind === "agent_step") row.appendChild(el("span", " — " + label("ctl.wait.agent_step.note")));
      else if (ACTIONS && w.kind === "confirmation" && w.confirmationId) {
        // У-03: стенд продлевает срок запроса подтверждения.
        const key = "remind:" + w.confirmationId;
        row.appendChild(actButton(key, label("act.remind"), "remind", { confirmation: w.confirmationId }));
        append(row, resultOf(key));
      } else if (ACTIONS && (w.cond === "R08" || w.cond === "R18")) {
        // У-01, У-02 (В1 (а)): только «напомнено» в журнале пульта — стенд не вызывается.
        const key = "note:" + w.obj + ":" + w.cond;
        row.appendChild(actButton(key, label("act.remind"), "remind_note", { obj: w.obj, cond: w.cond }));
        append(row, resultOf(key));
      } else if (w.kind === "confirmation") row.appendChild(el("div", label("ctl.wait.action"), "muted"));
      wrap.appendChild(row);
    }
    wrap.appendChild(el("h3", label("ctl.active"), "ctl-h"));
    if (!Array.isArray(c.active) || c.active.length === 0) wrap.appendChild(el("p", label("ctl.active.none"), "muted"));
    for (const a of c.active || []) {
      const row = el("div", a.id + " · " + label("col." + a.column) + " · ", "active-row");
      // Время в стадии тикает раз в секунду, как на карточках доски (ревью П-4.1 № 8).
      const t = el("span", stageText(a.since), "active-t");
      t.dataset.since = a.since;
      row.appendChild(t);
      if (ACTIONS) txButtons(row, a.id);
      wrap.appendChild(row);
    }
    // Журнал реакций (П-8.1; связь с протоколом и «упреждено реакцией» — П-8.2): последние нажатия и ответ стенда.
    if (ACTIONS && Array.isArray(board.reactions) && board.reactions.length > 0) {
      wrap.appendChild(el("h3", label("act.log"), "ctl-h"));
      for (const x of board.reactions.slice(-5).reverse()) wrap.appendChild(el("div", clock(x.at) + " · " + label("act.kind." + x.action) + " · " + x.obj + " · " + describeReaction(x), "react-row"));
    }
  }

  // ---- «Причины» (П-5.1, модель 1.23 `causesFor`, `deepCause`, `evidenceChain`) — панель «Интерпретатор» ----
  // Разбор — из `board.causes` (вердикты движка, инвариант 2): экран вид, нарушителя и защитника не выводит сам. В фокусе
  // «транзакция» — её паспорт полностью, разбор каждого вердикта, «Идёт к нарушению» и цепочка событий (последние 40 из N и
  // все доказательства, Р-1519); в фокусе «система» — блоки транзакций с вердиктом, щелчок — фокус. Место под переключатель
  // видов «Лента простыми словами» / «Лента шины» — `.int-modes` (П-5.2 окна Б, Р-1504).
  const intBox = document.getElementById("b-int");
  const intModes = el("div", undefined, "int-modes");
  const intBody = el("div", undefined, "int-body");
  if (intBox) {
    while (intBox.firstChild) intBody.appendChild(intBox.firstChild);
    intBox.appendChild(intModes);
    intBox.appendChild(intBody);
  }
  const fill = (s, vars) => String(s).replace(/\{(\w+)\}/g, (_m, k) => (Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : ""));
  const recLine = (r, cls) => {
    const d = el("div", undefined, cls + " k-" + r.kind);
    d.appendChild(el("span", clock(r.at) + " ", "tm"));
    d.appendChild(el("span", label("role." + r.actor) + ": ", "ch-a"));
    d.appendChild(el("span", txt(r.phrase)));
    return d;
  };
  const dtdd = (dl, k, node) => {
    dl.appendChild(el("dt", label("int." + k)));
    const dd = el("dd");
    if (typeof node === "string") dd.textContent = node;
    else dd.appendChild(node);
    dl.appendChild(dd);
  };

  // Правила и точки — номером из `board.causes`, тексты — справочник страницы (`#rules89`; ревью П-5.1 № 6).
  const ruleById = (id) => (R89 ? R89.rules.find((r) => r.id === id) : undefined);
  const pointName = (id) => {
    const x = R89 && Array.isArray(R89.points) ? R89.points.find((pt) => pt.id === id) : undefined;
    return x ? id + " " + x.name : id;
  };
  const who = (s, none) => label(s === "none" ? none : "subj." + s);

  /** Разбор одного вердикта — восемь полей (план П-5.1): кратко — вид и субъекты, полностью — всё. */
  function causeItem(it, deep) {
    const box = el("div", undefined, "cause k-" + it.kind);
    const head = [label("int.kind." + it.kind)];
    if (it.cond) head.push(it.cond);
    head.push(txt(it.title));
    if (it.node) head.push(label("ctl.node") + " " + it.node);
    box.appendChild(el("div", head.join(" · "), "ca-h"));
    const dl = el("dl", undefined, "ca-d");
    dtdd(dl, "violator", who(it.violator, "int.violator.none"));
    dtdd(dl, "protector", who(it.protector, "int.protector.none"));
    if (it.note === "race_c28") dl.appendChild(el("dd", label("ctl.race_c28"), "note"));
    if (deep) {
      const happened = el("div");
      for (const r of Array.isArray(it.happened) ? it.happened : []) happened.appendChild(recLine(r, "ha-r"));
      if (!happened.firstChild) happened.textContent = label("int.happened.none");
      dtdd(dl, "happened", happened);
      dtdd(dl, "where", (Array.isArray(it.where) ? it.where : []).map(pointName).join("; ") || "—");
      const rules = el("div");
      const why = el("div");
      for (const id of Array.isArray(it.rules) ? it.rules : []) {
        const r = ruleById(id);
        if (!r) {
          rules.appendChild(el("div", id));
          continue;
        }
        rules.appendChild(el("div", r.id + " " + r.text.rule + (r.enLater ? " (" + R89.enLater + ")" : "")));
        why.appendChild(el("div", r.id + ": " + label("int.why.crit") + " — " + r.text.whyCrit + "; " + label("int.why.vuln") + " — " + r.text.whyVuln));
      }
      dtdd(dl, "rule", rules);
      dtdd(dl, "why", why);
      dtdd(dl, "consequences", txt(it.consequences));
      dtdd(dl, "todo", txt(it.todo));
      dtdd(dl, "guarantees", (Array.isArray(it.guarantees) ? it.guarantees : []).map(txt).join("; "));
    }
    box.appendChild(dl);
    return box;
  }

  function txBlock(c, deep) {
    const box = el("section", undefined, "cblock");
    box.dataset.intTx = c.id;
    const h = el("button", c.id + " · " + (c.outcome ? label("outcome." + c.outcome) : label("int.outcome.none")), "cb-h");
    h.type = "button";
    h.dataset.intTx = c.id;
    box.appendChild(h);
    for (const it of Array.isArray(c.items) ? c.items : []) box.appendChild(causeItem(it, deep));
    if (deep && Array.isArray(c.waits) && c.waits.length > 0) {
      box.appendChild(el("h4", label("int.waits"), "ctl-h"));
      for (const w of c.waits) box.appendChild(el("div", (w.cond ? w.cond + " · " : "") + label("ctl.wait." + w.kind) + " · " + clock(w.since), "wait-row"));
    }
    if (deep && Array.isArray(c.chain)) {
      box.appendChild(el("h4", label("int.chain"), "ctl-h"));
      if (c.chainTotal > c.chainLimit) box.appendChild(el("p", fill(label("int.chain.cut"), { n: c.chainLimit, total: c.chainTotal }), "muted chain-cut"));
      const ch = el("div", undefined, "chain");
      for (const r of c.chain) ch.appendChild(recLine(r, "ch-r"));
      box.appendChild(ch);
    }
    return box;
  }

  function renderInt() {
    if (!intBox || !board) return;
    const list = Array.isArray(board.causes) ? board.causes : [];
    const wrap = document.createDocumentFragment();
    const tx = focus && focus.level === "tx" ? focus.tx : null;
    wrap.appendChild(el("p", label(tx ? "int.note.tx" : "int.note.system"), "note"));
    // Нейтрально: экран не объявляет транзакцию правильной — вердиктов нет или движок ещё не отработал (ревью П-5.1 № 4).
    if (!Array.isArray(board.causes)) wrap.appendChild(el("p", label("int.no_engine"), "muted"));
    else if (tx) {
      const c = list.find((x) => x && x.id === tx);
      wrap.appendChild(c ? txBlock(c, true) : el("p", label("int.tx.none"), "muted"));
    } else if (list.length === 0) wrap.appendChild(el("p", label("int.none"), "muted"));
    else for (const c of list) wrap.appendChild(txBlock(c, false));
    while (intBody.firstChild) intBody.removeChild(intBody.firstChild);
    intBody.appendChild(wrap);
  }
  if (intBox) {
    // Щелчок по заголовку блока — фокус на транзакцию (как карточка доски).
    const pick = (ev) => {
      const b = ev.target instanceof Element ? ev.target.closest("button[data-int-tx]") : null;
      if (b) document.dispatchEvent(new CustomEvent("pult:select", { detail: { tx: b.dataset.intTx } }));
    };
    intBox.addEventListener("pointerdown", pick);
    intBox.addEventListener("click", pick);
  }

  document.addEventListener("pult:focus", renderProc);
  document.addEventListener("pult:focus", renderInt);
  // Раз в секунду — только текст счётчиков доски и положения «Графика»: узлы не пересоздаются, фокус и щелчок не теряются
  // (ревью П-2.1 № 4).
  setInterval(() => {
    if (!board) return;
    // «Контроль»: набор строк «Идёт к нарушению» сменился (порог пройден) — перестроить; иначе — только секунды.
    if (dueKey(dueWaits()) !== ctlDueKey) renderCtl();
    else if (ctlBox) {
      for (const s of ctlBox.querySelectorAll(".wait-s")) s.textContent = waitSeconds(s.dataset.since) + " " + label("card.sec");
      for (const t of ctlBox.querySelectorAll(".active-t")) t.textContent = stageText(t.dataset.since);
    }
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
      syncMerchants();
      renderProc();
      renderCtl();
      renderInt();
    }
  };
  // Обрыв связи пульта с сервером — не то же, что отключение шины у источника; EventSource переподключится сам. Если
  // браузер закрыл ленту окончательно (ответ не SSE: 404, 421), переподключения не будет — отключён пульт, а не шина
  // (ревью № 6, повторное ревью № 1).
  es.onerror = () => setStatus(es.readyState === EventSource.CLOSED ? "pult_closed" : "screen_offline");
})();
