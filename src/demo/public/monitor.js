// Монитор операций демо-стенда (К1.3). Лента — SSE /events. Данные выводятся только через textContent (инвариант 4):
// элементы создаются createElement, разметка из строк не собирается, строки не исполняются.
/* global document, EventSource */
"use strict";

(function () {
  const cfg = JSON.parse(document.getElementById("i18n").textContent);
  const lang = cfg.lang;
  const m = cfg.messages;
  const tbody = document.querySelector("#monitor tbody");
  const consoleList = document.getElementById("console");
  const status = document.getElementById("status");
  const MAX_ROWS = 500;

  const cell = (text, cls) => {
    const td = document.createElement("td");
    td.textContent = text === undefined || text === null ? "" : String(text);
    if (cls) td.className = cls;
    return td;
  };

  const time = (iso) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleTimeString(lang === "ru" ? "ru-RU" : "en-GB");
  };

  const ids = (o) =>
    Object.keys(o || {})
      .map((k) => k + "=" + o[k])
      .join(" ");

  function addEvent(e) {
    const tr = document.createElement("tr");
    tr.className = "cls-" + e.cls;
    tr.appendChild(cell(time(e.at)));
    tr.appendChild(cell(m["class." + e.cls] || e.cls, "cls"));
    tr.appendChild(cell(m["source." + e.source] || e.source));
    tr.appendChild(cell(e.what, "what"));
    tr.appendChild(cell(e.status));
    tr.appendChild(cell(e.code, "code"));
    tr.appendChild(cell(e.amount && e.amount.text ? e.amount.text[lang] : "", "amount"));
    tr.appendChild(cell(ids(e.ids), "ids"));
    tbody.insertBefore(tr, tbody.firstChild);
    while (tbody.childElementCount > MAX_ROWS) tbody.removeChild(tbody.lastChild);
    document.getElementById("monitor-empty").hidden = true;
  }

  function addLine(l) {
    const li = document.createElement("li");
    const parts = [time(l.at), l.kind];
    for (const k of ["result", "status", "check", "method", "reason", "detail", "ref", "mandate", "merchant"]) {
      if (l[k] !== undefined) parts.push(k + "=" + l[k]);
    }
    li.textContent = parts.join("  ");
    if (l.result === "fail" || l.status === "fail" || l.reason !== undefined) li.className = "warn";
    consoleList.insertBefore(li, consoleList.firstChild);
    while (consoleList.childElementCount > MAX_ROWS) consoleList.removeChild(consoleList.lastChild);
    document.getElementById("console-empty").hidden = true;
  }

  let seen = 0;
  function connect() {
    const es = new EventSource("/events");
    es.onopen = () => {
      status.hidden = true;
    };
    es.onmessage = (msg) => {
      const item = JSON.parse(msg.data);
      const seq = item.stream === "monitor" ? item.event.seq : item.line.seq;
      if (seq <= seen) return; // история при переподключении — без повторов
      seen = seq;
      if (item.stream === "monitor") addEvent(item.event);
      else addLine(item.line);
    };
    es.onerror = () => {
      status.textContent = m["monitor.lost"];
      status.hidden = false;
    };
  }
  connect();
})();
