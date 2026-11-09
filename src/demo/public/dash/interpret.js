// Экран «Интерпретация» DEMO-2 (К1.4). Лента — SSE /dash/interpret/events: интерпретации по правилам К1.3, которые
// сервер строит из шины через сменный адаптер источника (Р-1246 п. 3). Данные выводятся только через textContent
// (инвариант 4): элементы создаются createElement, разметка из строк не собирается, строки не исполняются.
/* global document, EventSource */
"use strict";

(function () {
  const cfg = JSON.parse(document.getElementById("i18n").textContent);
  const lang = cfg.lang;
  const L = cfg.labels;
  const titles = cfg.situations;
  const tbody = document.querySelector("#feed tbody");
  const empty = document.getElementById("empty");
  const status = document.getElementById("status");
  const diag = document.getElementById("diag");
  const details = document.getElementById("details");
  const MAX_ROWS = 1000;

  // Нет ключа в словаре — показывается сам ключ, не текст на другом языке (ревью К1.4 № 5); полноту словаря сверяет тест.
  const label = (key) => (Object.prototype.hasOwnProperty.call(L, key) ? L[key] : key);

  const time = (iso) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleTimeString(lang === "ru" ? "ru-RU" : "en-GB");
  };

  const el = (tag, text, cls) => {
    const e = document.createElement(tag);
    if (text !== undefined && text !== null) e.textContent = String(text);
    if (cls) e.className = cls;
    return e;
  };

  function whoCell(w) {
    const td = el("td", undefined, "who");
    if (!w) return td;
    td.appendChild(el("code", w.codeDetail ? w.code + " / " + w.codeDetail : w.code));
    const side = (w.side || []).map((s) => label("role." + s)).join(", ");
    td.appendChild(el("div", side ? label("who.side") + ": " + side : label("who.none"), "side"));
    td.appendChild(el("div", label("verdict." + w.verdict), "verdict verdict-" + w.verdict));
    if (w.status === "pending") td.appendChild(el("div", label("pending"), "pending"));
    if (w.operator) {
      // Текст для оператора — из реестра, с именами полей и сырыми значениями: только в служебном виде (З2, Р-1361);
      // английского нет — показывается русский, не выдумывается.
      const text = lang === "en" && w.operator.en ? w.operator.en : w.operator.ru;
      td.appendChild(el("div", text, "operator service-only"));
    }
    return td;
  }

  // Цветом выделяется только ситуация у конфликта и фрода; у нормы и ошибки — нейтрально, серым (З1, Р-1361).
  const ALERT_KINDS = ["conflict", "fraud"];

  function situationCell(id, kind) {
    const td = el("td", undefined, "situation");
    if (!id) return td;
    const alert = ALERT_KINDS.indexOf(kind) >= 0;
    td.classList.add(alert ? "situation-alert" : "situation-neutral");
    td.appendChild(el(alert ? "strong" : "span", label("situation.label") + " " + id, "situation-id"));
    if (Object.prototype.hasOwnProperty.call(titles, id)) {
      td.appendChild(el("div", titles[id], "situation-title"));
      const note = label("situation.ru_only");
      if (note) td.appendChild(el("div", note, "note"));
    }
    return td;
  }

  function row(r) {
    const tr = document.createElement("tr");
    tr.className = "kind-" + r.kind + " level-" + r.level;
    tr.dataset.seq = String(r.seq);
    tr.appendChild(el("td", time(r.at), "time"));
    tr.appendChild(el("td", label("stage." + r.stage)));
    const actor = el("td", label("role." + r.actor));
    if (r.emulated) actor.appendChild(el("span", label("emulated"), "badge"));
    tr.appendChild(actor);
    const kind = el("td", label("kind." + r.kind), "kind");
    // Учебная витрина стенда: сбой задуман (З10).
    if (r.training) kind.appendChild(el("div", label("training"), "training"));
    tr.appendChild(kind);
    tr.appendChild(el("td", r.phrase && r.phrase[lang], "phrase"));
    tr.appendChild(whoCell(r.who));
    tr.appendChild(situationCell(r.situation, r.kind));
    return tr;
  }

  // Состояние ленты — значок, цвет и текст (З7): цвет не единственный носитель смысла.
  const CONN = { open: "ok", connecting: "wait", reset: "wait", closed: "lost", screen_offline: "lost" };
  const CONN_ICON = { ok: "●", wait: "◌", lost: "✕" };
  const statusIcon = document.getElementById("status-icon");
  const statusBox = document.getElementById("conn");

  function setStatus(s) {
    const state = Object.prototype.hasOwnProperty.call(CONN, s) ? CONN[s] : "wait";
    status.textContent = label("status." + s);
    statusIcon.textContent = CONN_ICON[state];
    statusBox.className = "conn conn-" + state;
  }

  // По seq: событие Платформы может прийти после записей с большим номером. Поиск места — с конца: seq почти всегда
  // растёт (ревью К1.4 № 7). refresh — отдельно: на снимке один раз на все записи.
  function insert(r) {
    const tr = row(r);
    let after = tbody.lastElementChild;
    while (after && Number(after.dataset.seq) > r.seq) after = after.previousElementSibling;
    tbody.insertBefore(tr, after ? after.nextSibling : tbody.firstChild);
    while (tbody.children.length > MAX_ROWS) tbody.removeChild(tbody.firstChild);
  }

  function refresh() {
    tbody.classList.toggle("show-details", details.checked);
    const visible = Array.prototype.some.call(tbody.children, (x) => details.checked || x.classList.contains("level-key"));
    empty.hidden = visible;
  }

  function setDiag(d) {
    diag.textContent = label("diag." + d.state) + (d.state === "failed" && d.code ? " (" + d.code + ")" : "");
  }

  details.addEventListener("change", refresh);
  setStatus("connecting");

  const es = new EventSource("/dash/interpret/events");
  es.onmessage = (m) => {
    let e;
    try {
      e = JSON.parse(m.data);
    } catch {
      return;
    }
    if (e.type === "snapshot") {
      while (tbody.firstChild) tbody.removeChild(tbody.firstChild);
      for (const r of e.items) insert(r);
      setStatus(e.status);
      setDiag(e.diag);
      refresh();
    } else if (e.type === "item") {
      insert(e.item);
      refresh();
    } else if (e.type === "reset") {
      while (tbody.firstChild) tbody.removeChild(tbody.firstChild);
      refresh();
    } else if (e.type === "status") setStatus(e.status);
    else if (e.type === "diag") setDiag(e.diag);
  };
  // Обрыв связи экрана с сервером — не то же, что отключение шины у источника (ревью К1.4 № 9); EventSource переподключится
  // и получит снимок заново.
  es.onerror = () => {
    setStatus("screen_offline");
  };
})();
