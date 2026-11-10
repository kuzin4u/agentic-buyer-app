// Монитор операций демо-стенда (К1.3). Лента — SSE /events. Данные выводятся только через textContent (инвариант 4):
// элементы создаются createElement, разметка из строк не собирается, строки не исполняются.
/* global document, EventSource, fetch */
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
    const what = cell(e.what, "what");
    what.title = e.what; // путь в одну строку, полный — во всплывающей подсказке (поправка владельца (в))
    tr.appendChild(what);
    tr.appendChild(cell(e.status));
    // Код — как есть; пояснение из словаря: сначала уточнённое (code.<КОД>.<чей предел>), иначе общее (code.<КОД>).
    const note = e.code ? (e.codeDetail && m["code." + e.code + "." + e.codeDetail]) || m["code." + e.code] : undefined;
    tr.appendChild(cell(e.code ? (note ? e.code + " — " + note : e.code) : "", "code"));
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

  // Шаг сюжета: текст из словаря, {параметр} → значение; сумма — готовый текст на языке страницы. Всё — textContent.
  const param = (v) => (v && typeof v === "object" && v.text ? v.text[lang] : String(v));
  const fill = (tpl, params) => String(tpl).replace(/\{([a-z_]+)\}/g, (_, k) => (params && params[k] !== undefined ? param(params[k]) : m["value.none"]));
  function addStep(l) {
    const text = fill(m["step." + l.step] || l.step, l.params);
    const li = document.createElement("li");
    // Остановка покупки — с пометкой: сбой сюжета, отказ корзины в банке (сюжет 6 и сюжеты 2–4; ревью П-11.1а № 4) и
    // покупка не подтверждена (сюжет 7 и сюжет 4).
    const stop = l.step === "failed" || l.step === "cart.rejected" || l.step === "upk.declined";
    li.className = stop ? "step warn" : l.step === "outcome" ? "step outcome" : "step";
    li.textContent = time(l.at) + "  " + text;
    consoleList.insertBefore(li, consoleList.firstChild);
    while (consoleList.childElementCount > MAX_ROWS) consoleList.removeChild(consoleList.lastChild);
    document.getElementById("console-empty").hidden = true;
  }

  // Карточка корзины (Р-1248 п. 1): заполняется из шага cart.card через textContent; любой другой шаг её скрывает.
  const cartCard = document.getElementById("cart-card");
  function cartCardFor(l) {
    if (!cartCard) return;
    if (l.step !== "cart.card") {
      cartCard.hidden = true;
      return;
    }
    const p = Object.assign({}, l.params);
    if (p.delivery_method !== undefined) p.delivery_method = m["delivery." + p.delivery_method] || String(p.delivery_method);
    for (const el of cartCard.querySelectorAll("[data-tpl]")) {
      const none = el.dataset.tplNone;
      const useNone = none && el.dataset.tpl === "card.line.delivery" && p.delivery_method === undefined;
      el.textContent = fill(m[useNone ? none : el.dataset.tpl], p);
    }
    cartCard.hidden = false;
  }

  // Панель УПК (сюжет 4): ссылка на страницу УПК и код из «эмулятора SMS банка» — из шагов upk.required и upk.sms.
  // Ссылка — только на 127.0.0.1 (страница УПК стенда); код — textContent. Любой другой шаг, кроме этих и notice,
  // скрывает панель после итога.
  const upkPanel = document.getElementById("upk-panel");
  function upkFor(l) {
    if (!upkPanel) return;
    if (l.step === "upk.required") {
      const url = String(l.params && l.params.upk_url);
      const a = document.getElementById("upk-link");
      if (/^http:\/\/127\.0\.0\.1:\d+\//.test(url)) a.href = url;
      else a.removeAttribute("href");
      document.getElementById("upk-code").textContent = "";
      upkPanel.hidden = false;
    } else if (l.step === "upk.sms") {
      document.getElementById("upk-code").textContent = String(l.params && l.params.code);
    } else if (l.step === "outcome" || l.step === "failed" || l.step === "aborted" || l.step === "upk.aborted" || l.step === "upk.declined") {
      upkPanel.hidden = true;
    }
  }

  // Заказы в витрине продавца (К2.3): строка — по order.placed; ответ витрины — order.shop_reply (слова продавца);
  // итог — только шаги итога сюжета (по событию Платформы). Всё — textContent.
  const ordersBody = document.querySelector("#orders tbody");
  const orders = new Map();
  function ordersFor(l) {
    if (!ordersBody) return;
    const p = l.params || {};
    if (l.step === "order.placed") {
      const tr = document.createElement("tr");
      const item = fill(m["orders.item"], p);
      const cells = [p.order_id, p.merchant_id, item, p.total ? param(p.total) : "", m["value.none"], m["orders.pending"]].map((v) => cell(v));
      for (const c of cells) tr.appendChild(c);
      ordersBody.insertBefore(tr, ordersBody.firstChild);
      orders.set(p.order_id, { reply: cells[4], outcome: cells[5], tr });
      document.getElementById("orders-empty").hidden = true;
      return;
    }
    const o = p.order_id !== undefined ? orders.get(p.order_id) : undefined;
    if (!o) return;
    // Подпись — из словаря, код — рядом (ревью К2.3 № 5).
    const label = (prefix, code) => (m[prefix + code] ? m[prefix + code] + " (" + code + ")" : String(code));
    if (l.step === "order.shop_reply") o.reply.textContent = m["reply." + p.reply] ? label("reply.", p.reply) : fill(m["reply.other"], { code: p.reply });
    else if (l.step === "outcome") {
      o.outcome.textContent = label("status.", p.status) + (p.amount ? ", " + param(p.amount) : "");
      o.tr.className = p.status === "DECLINED" ? "cls-decline" : "cls-outcome";
    } else if (l.step === "limit.declined" || (l.step === "failed" && /^DECLINED_/.test(String(p.code)))) {
      // «Отказ» — только отказ по событию Платформы (DECLINED_*), ревью К2.3 № 2.
      o.outcome.textContent = m["orders.outcome.declined"] + " — " + String(p.code);
      o.tr.className = "cls-decline";
    } else if (l.step === "failed") {
      // Остановка без события об итоге (например, итог не подтверждён) — не «отказ».
      o.outcome.textContent = m["orders.outcome.unconfirmed"] + " — " + String(p.code);
      o.tr.className = "";
    } else if (l.step === "upk.declined") {
      // Покупку не подтвердили (сюжет 7): решение или срок запроса Платформы — не «отказ продавца» и не «оплачено».
      o.outcome.textContent = m["orders.outcome.not_confirmed"] + " — " + String(p.code);
      o.tr.className = "";
    } else if (l.step === "upk.aborted") {
      // Запрос в банке открыт: итог — в приложении банка, не «не состоялась» (ревью К2.3 № 1).
      o.outcome.textContent = m["orders.outcome.confirmation_aborted"] + " — " + String(p.code);
      o.tr.className = "";
    }
  }

  const msg = document.getElementById("scenario-msg");
  const answer = (r) => {
    msg.hidden = false;
    msg.textContent = r.ok ? m["scenario.started"] : r.code === "BUSY" ? m["scenario.busy"] : r.code === "NEED_INTENT" ? m["scenario.need_intent"] : r.code === "NOT_AWAITING" ? m["scenario.not_awaiting"] : m["scenario.error"];
  };
  for (const b of document.querySelectorAll("button[data-cart]")) {
    b.addEventListener("click", () => {
      fetch("/scenario/cart/" + b.dataset.cart, { method: "POST" })
        .then((r) => r.json().catch(() => ({ ok: false })))
        .then((r) => {
          // Принято или карточка уже не ждёт ответа (отмена, повтор) — карточку скрыть (ревью К2.1а № 4).
          if (r.ok || r.code === "NOT_AWAITING") cartCard.hidden = true;
          if (!r.ok) answer(r);
        })
        .catch(() => answer({ ok: false }));
    });
  }
  for (const b of document.querySelectorAll("button[data-scenario]")) {
    b.addEventListener("click", () => {
      fetch("/scenario/" + b.dataset.scenario, { method: "POST" })
        .then((r) => r.json().catch(() => ({ ok: false })))
        .then((r) => {
          if (b.dataset.scenario !== "abort") return answer(r);
          msg.hidden = false;
          msg.textContent = r.ok ? m["scenario.aborting"] : r.code === "PAYING" ? m["scenario.paying"] : m["scenario.not_running"];
        })
        .catch(() => answer({ ok: false }));
    });
  }

  const seen = new Set();
  function connect() {
    const es = new EventSource("/events");
    es.onopen = () => {
      status.hidden = true;
    };
    es.onmessage = (msg) => {
      const item = JSON.parse(msg.data);
      const seq = item.stream === "monitor" ? item.event.seq : item.line.seq;
      // История при переподключении — без повторов; номера могут прийти не по возрастанию (строка события ждёт суммы).
      if (seen.has(seq)) return;
      seen.add(seq);
      if (item.stream === "monitor") addEvent(item.event);
      else if (item.stream === "scenario") {
        addStep(item.line);
        cartCardFor(item.line);
        upkFor(item.line);
        ordersFor(item.line);
      }
      else addLine(item.line);
    };
    es.onerror = () => {
      status.textContent = m["monitor.lost"];
      status.hidden = false;
    };
  }
  connect();
})();
