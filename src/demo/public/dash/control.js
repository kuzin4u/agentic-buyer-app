// Экран «Контроль» DEMO-2 (К2.3б). Лента — SSE /dash/control/events: прогоны сюжетов с итогом контролёра К2.2. Вердикт
// владельца — кнопкой, POST /dash/control/verdict (только после срока ожидания; сервер фиксирует итог, при котором он
// поставлен). Данные выводятся только через textContent (инвариант 4): элементы — createElement, разметка из строк не
// собирается.
/* global document, EventSource, fetch */
"use strict";

(function () {
  const cfg = JSON.parse(document.getElementById("i18n").textContent);
  const lang = cfg.lang;
  const L = cfg.labels;
  const box = document.getElementById("runs");
  const empty = document.getElementById("empty");
  const status = document.getElementById("status");
  const statusIcon = document.getElementById("status-icon");
  const conn = document.getElementById("conn");

  const label = (key) => (Object.prototype.hasOwnProperty.call(L, key) ? L[key] : key);

  const el = (tag, text, cls) => {
    const e = document.createElement(tag);
    if (text !== undefined && text !== null) e.textContent = String(text);
    if (cls) e.className = cls;
    return e;
  };

  const time = (iso) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleTimeString(lang === "ru" ? "ru-RU" : "en-GB");
  };

  // Состояние — значок, класс и текст (как З7): цвет не единственный носитель смысла.
  const STATE_ICON = { accepted: "✓", waiting: "◌", rejected: "✕" };

  function stateBadge(state) {
    const s = el("span", undefined, "run-state run-" + state);
    s.appendChild(el("span", STATE_ICON[state] || "?", "conn-icon"));
    s.appendChild(el("span", " " + label("state." + state)));
    return s;
  }

  function verdictBlock(v) {
    const d = el("div", undefined, "verdict-box");
    d.appendChild(el("strong", label("verdict.title") + ": "));
    if (v.verdict) {
      const w = v.verdict;
      d.appendChild(el("span", label(w.decision === "accepted" ? "verdict.accepted" : "verdict.rejected"), "verdict-" + w.decision));
      d.appendChild(
        el("span", " · " + time(w.at) + " · " + label("verdict.at") + " " + label("q.open") + label("state." + w.state) + label("q.close") + ", " + w.accepted + " " + label("of") + " " + w.total),
      );
      if (w.early.next || w.early.prev) d.appendChild(el("div", [w.early.next && label("early.next"), w.early.prev && label("early.prev")].filter(Boolean).join("; "), "early"));
      return d;
    }
    // Кнопки — только когда срок ожидания вышел (ревью К2.3б № 1): «не принято» бывает и до срока.
    if (!v.result || !v.closed) {
      d.appendChild(el("span", label("verdict.wait"), "note"));
      return d;
    }
    for (const decision of ["accepted", "rejected"]) {
      const b = el("button", label(decision === "accepted" ? "verdict.accept" : "verdict.reject"), "verdict-btn");
      b.type = "button";
      b.dataset.key = String(v.key);
      b.dataset.decision = decision;
      b.addEventListener("click", () => send(v.key, decision, d));
      d.appendChild(b);
    }
    return d;
  }

  // Поколение ленты: с вердиктом уходит поколение, при котором страница его показала (ревью К2.3б № 7).
  let epoch = "";

  function send(key, decision, d) {
    fetch("/dash/control/verdict", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ epoch, key, decision }) })
      .then((r) => {
        if (!r.ok) d.appendChild(el("div", label("verdict.failed"), "early"));
      })
      .catch(() => d.appendChild(el("div", label("verdict.failed"), "early")));
  }

  function runCard(v) {
    const card = el("section", undefined, "run");
    card.dataset.key = String(v.key);
    const head = el("h2", undefined, "run-head");
    // Прогон драйвера нарушителя «ПР» (П-4.1а): «Нарушитель (ПР) — Н-xx» вместо имени метки; код и исход — поля ленты.
    const fault = v.fault && typeof v.fault === "object" ? v.fault : null;
    head.appendChild(el("span", fault ? label("fault.title") + " — " + (fault.test || label("fault.test.missing")) : v.title ? v.title[lang] : v.name));
    card.appendChild(head);
    card.appendChild(el("div", label("started") + ": " + time(v.startedAt) + " · " + label("seq") + " " + v.key, "note"));
    if (!v.result && fault) {
      const out = el("div", label("fault.outcome." + (fault.outcome || "none")) + (fault.code ? " — " + fault.code : ""), "fault-outcome");
      out.dataset.outcome = fault.outcome || "none";
      card.appendChild(out);
      // Пометки раннего запуска — как у прогона с паспортом и в выгрузке ACC-1 (ревью П-4.1а № 5).
      if (v.early && v.early.next) card.appendChild(el("div", label("early.next"), "early"));
      if (v.early && v.early.prev) card.appendChild(el("div", label("early.prev"), "early"));
      return card;
    }
    if (!v.result) {
      card.appendChild(el("div", label("no.passport"), "no-passport"));
      return card;
    }
    const r = v.result;
    const sum = el("div", undefined, "run-sum");
    sum.appendChild(stateBadge(r.state));
    const n = r.state === "waiting" ? label("met") + " " + r.met : label("accepted") + " " + r.accepted;
    sum.appendChild(el("span", " · " + n + " " + label("of") + " " + r.total + " · " + label("deadline") + " " + time(r.deadline)));
    card.appendChild(sum);
    if (v.early.next) card.appendChild(el("div", label("early.next"), "early"));
    if (v.early.prev) card.appendChild(el("div", label("early.prev"), "early"));
    const list = el("ul", undefined, "checks");
    for (const it of r.items) {
      if (it.state === "accepted" || (it.state === "waiting" && it.met)) continue; // принятое и выполненное до срока — свёрнуто
      const li = el("li", undefined, "check check-" + it.state);
      li.appendChild(el("span", it.what[lang]));
      const why = it.reasons.map((x) => label("reason." + x)).join(", ");
      li.appendChild(el("span", " — " + label("state." + it.state) + (why ? " (" + why + ")" : ""), "note"));
      list.appendChild(li);
    }
    if (list.children.length > 0) card.appendChild(list);
    card.appendChild(verdictBlock(v));
    return card;
  }

  function render(runs) {
    while (box.firstChild) box.removeChild(box.firstChild);
    for (let i = runs.length - 1; i >= 0; i--) box.appendChild(runCard(runs[i])); // новые — сверху
    empty.hidden = runs.length > 0;
  }

  const CONN = { open: ["ok", "●"], connecting: ["wait", "◌"], lost: ["lost", "✕"] };
  function setStatus(s) {
    const c = CONN[s] || CONN.connecting;
    status.textContent = label("status." + s);
    statusIcon.textContent = c[1];
    conn.className = "conn conn-" + c[0];
  }

  setStatus("connecting");
  const es = new EventSource("/dash/control/events");
  es.onmessage = (m) => {
    let e;
    try {
      e = JSON.parse(m.data);
    } catch {
      return;
    }
    if (e.type === "runs") {
      epoch = String(e.epoch);
      setStatus("open");
      render(e.runs);
    }
  };
  es.onerror = () => setStatus("lost");
})();
