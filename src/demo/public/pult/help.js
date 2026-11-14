// Справка пульта (П-9.2): окно со строками по панелям, клавишами и переключателем «клавиши пульта» (WCAG 2.1.4 — однобуквенные
// клавиши можно выключить: признак `pult.keys.v1` в localStorage читает `keys.js`). Тексты — со страницы (`#pult-help`, на её
// языке, `src/pult/help.ts`); вывод — только createElement / textContent (инвариант 4).
// Открывается кнопкой `[data-help]` и событием `pult:help` (клавиша «?», `keys.js`); закрывается кнопкой, Esc и повторным «?».
// Esc внутри окна закрывает окно и отменяет событие — `pult.js` по отменённому Esc фокус не поднимает. Фокус при открытии — на
// кнопку закрытия, при закрытии — туда, где был.
/* global document, localStorage */
"use strict";

(function () {
  const src = document.getElementById("pult-help");
  if (!src) return;
  let H;
  try {
    H = JSON.parse(src.textContent);
  } catch {
    return;
  }
  if (!H || typeof H !== "object" || !H.labels) return;
  const L = (k) => (typeof H.labels[k] === "string" ? H.labels[k] : "");
  const STORE = "pult.keys.v1";

  const el = (tag, text, cls) => {
    const n = document.createElement(tag);
    if (text !== undefined) n.textContent = text;
    if (cls) n.className = cls;
    return n;
  };

  const dialog = el("div", undefined, "help");
  dialog.setAttribute("id", "pult-help-dialog");
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-labelledby", "pult-help-title");
  dialog.hidden = true;
  const head = el("div", undefined, "help-h");
  const title = el("h2", L("help.title"));
  title.setAttribute("id", "pult-help-title");
  const close = el("button", L("help.close"), "help-close");
  close.type = "button";
  head.appendChild(title);
  head.appendChild(close);
  dialog.appendChild(head);

  for (const line of Array.isArray(H.general) ? H.general : []) if (typeof line === "string") dialog.appendChild(el("p", line, "help-general"));
  for (const p of Array.isArray(H.panes) ? H.panes : []) {
    if (!p || typeof p.title !== "string" || !Array.isArray(p.lines)) continue;
    dialog.appendChild(el("h3", p.title));
    const ul = el("ul");
    for (const line of p.lines) if (typeof line === "string") ul.appendChild(el("li", line));
    dialog.appendChild(ul);
  }
  dialog.appendChild(el("h3", L("help.keys")));
  const dl = el("dl", undefined, "help-keys");
  for (const k of Array.isArray(H.keys) ? H.keys : []) {
    if (!k || typeof k.key !== "string" || typeof k.what !== "string") continue;
    dl.appendChild(el("dt", k.key));
    dl.appendChild(el("dd", k.what));
  }
  dialog.appendChild(dl);
  const toggleLabel = el("label", undefined, "help-toggle");
  const toggle = el("input");
  toggle.type = "checkbox";
  toggle.setAttribute("id", "pult-keys-on");
  toggleLabel.appendChild(toggle);
  toggleLabel.appendChild(el("span", " " + L("help.keys.on")));
  dialog.appendChild(toggleLabel);
  dialog.appendChild(el("p", L("help.keys.why"), "muted"));
  dialog.appendChild(el("p", L("help.keys.note"), "muted"));
  document.body.appendChild(dialog);

  const keysOn = () => {
    try {
      const v = JSON.parse(localStorage.getItem(STORE) || "null");
      return !(v && v.on === false);
    } catch {
      return true;
    }
  };
  toggle.addEventListener("change", () => {
    try {
      localStorage.setItem(STORE, JSON.stringify({ on: toggle.checked === true }));
    } catch {
      // без хранилища выбор не запоминается — клавиши по умолчанию
    }
  });

  // Пока окно открыто, фон недоступен (`inert` на шапке, полосе и основной части): Tab не уходит за окно, а клавиши пульта
  // (кроме «?») молчат — `keys.js` проверяет открытое окно (ревью П-9.2 № 2).
  const background = () => [...document.querySelectorAll("header, .bar, main")];
  let back = null;
  const open = () => {
    if (!dialog.hidden) return;
    back = document.activeElement;
    toggle.checked = keysOn();
    dialog.hidden = false;
    for (const n of background()) n.setAttribute("inert", "");
    close.focus();
  };
  const shut = () => {
    if (dialog.hidden) return;
    dialog.hidden = true;
    for (const n of background()) n.removeAttribute("inert");
    if (back && typeof back.focus === "function") back.focus();
    back = null;
  };

  close.addEventListener("click", shut);
  dialog.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") {
      ev.preventDefault();
      shut();
    }
  });
  document.addEventListener("pult:help", () => (dialog.hidden ? open() : shut()));
  document.addEventListener("click", (ev) => {
    const t = ev.target && typeof ev.target.closest === "function" ? ev.target.closest("[data-help]") : null;
    if (t) open();
  });
})();
