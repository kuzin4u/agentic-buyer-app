// Клавиши пульта (П-9.1). Раскладка принята владельцем (Р-1523, В13 (а)) и записана в STATUS «Открыто» — на неё опираются
// справка П-9.2 и П-11.5, а не этот код:
//   1–4 — панели «Ход», «Контроль», «Интерпретатор», «Журнал»: во вкладках — открыть вкладку, в сетке — развернуть
//         (повторное нажатие — свернуть);
//   5–6 — виды «Хода» (доска, «График»); 7–8 — виды «Контроля» («Приоритет», «Все 89»);
//   ?   — справка по панелям (событие `pult:help`, справка — П-9.2);
//   пробел — пауза ленты: событие `pult:pause` с `detail.paused` (вкл. / выкл.). Источник истины — последнее событие
//         `pult:pause` от кого угодно (кнопка окна А в П-8.1 тоже): пробел переключает от него. «Ленты» (П-5.2) встают сразу,
//         доска и «Контроль» — в П-8.1 окна А (Р-1523, В14 (а)).
//   Esc — фокус выше — по-прежнему у `pult.js`.
// Клавиши нажимают существующие кнопки страницы (`.click()`): логика раскладки, видов и их хранения — у `pult.js`, здесь её
// нет. Кнопку на скрытой панели (вкладка не открыта) клавиша не нажимает — невидимое изменение запомненного вида.
// Не действуют: в полях ввода, при наборе (IME), с Ctrl / Alt / Meta, если событие уже отменено слушателем, сработавшим
// раньше (`keys.js` подключается после `pult.js`, П-9.4), и **если клавиши выключены** (WCAG 2.1.4: однобуквенные клавиши
// можно отключить) — признак `pult.keys.v1` `{ on: false }` в localStorage, переключатель — в справке (П-9.2). Пробел не
// перехватывается на кнопках, ссылках, полях и элементах с ролями (вкладка, флажок, переключатель и т. п.) — там он
// нажимает сам элемент; удержание пробела страницу не прокручивает.
/* global document, Element, CustomEvent, localStorage */
"use strict";

(function () {
  const PANES = ["proc", "ctl", "int", "log"];
  const VIEWS = ["[data-mode='board']", "[data-mode='graph']", "[data-ctl-view='prio']", "[data-ctl-view='all']"];
  const TYPING = "input, textarea, select, [contenteditable]:not([contenteditable='false']), [role='textbox'], [role='searchbox'], [role='combobox']";
  const PRESSABLE =
    "button, a, summary, input, select, textarea, [role='button'], [role='tab'], [role='checkbox'], [role='switch'], [role='radio'], [role='menuitem'], [role='option']";
  const typing = (t) => t instanceof Element && t.closest(TYPING) !== null;
  const pressable = (t) => t instanceof Element && t.closest(PRESSABLE) !== null;
  const STORE = "pult.keys.v1";
  const enabled = () => {
    try {
      const v = JSON.parse(localStorage.getItem(STORE) || "null");
      return !(v && v.on === false);
    } catch {
      return true; // хранилище недоступно — клавиши как по умолчанию
    }
  };
  let paused = false;
  document.addEventListener("pult:pause", (ev) => {
    paused = Boolean(ev && ev.detail && ev.detail.paused === true);
  });

  /** Видна ли панель кнопки: `pult.js` скрывает панели классами — во вкладках видна только `is-tab`, при развороте — только
   *  `is-max` (раскладка — у `pult.js`, здесь только чтение классов). Кнопка вне панели — видна. */
  const paneShown = (b) => {
    const pane = b.closest("[data-pane]");
    const grid = document.getElementById("grid");
    if (!pane || !grid) return true;
    if (grid.classList.contains("tabs")) return pane.classList.contains("is-tab");
    if (grid.classList.contains("max")) return pane.classList.contains("is-max");
    return true;
  };
  /** `view` — кнопка вида (5–8): на скрытой панели не нажимается. Кнопки панелей (1–4) сами переключают панели — им видимость
   *  своей панели не нужна (иначе при развёрнутой панели нельзя было бы развернуть другую). */
  const press = (selector, view) => {
    const b = document.querySelector(selector);
    if (!b || b.hidden || b.disabled || b.closest("[hidden]") !== null || (view && !paneShown(b))) return false;
    b.click();
    return true;
  };

  document.addEventListener("keydown", (ev) => {
    if (ev.defaultPrevented || ev.isComposing || ev.ctrlKey || ev.altKey || ev.metaKey || typing(ev.target) || !enabled()) return;
    const k = ev.key;
    if (k >= "1" && k <= "4" && k.length === 1) {
      const pane = PANES[Number(k) - 1];
      const grid = document.getElementById("grid");
      const done = press(grid && grid.classList.contains("tabs") ? "[data-tab='" + pane + "']" : "[data-max='" + pane + "']", false);
      // Фокус клавиатуры — на заголовок выбранной панели, только если нажатие сработало: чтец экрана называет, куда перешли
      // (ревью П-9.1 № 6, П-9.4 № 5).
      const h = done ? document.getElementById("h-" + pane) : null;
      if (h) {
        if (!h.hasAttribute("tabindex")) h.setAttribute("tabindex", "-1");
        h.focus();
      }
    } else if (k >= "5" && k <= "8" && k.length === 1) {
      press(VIEWS[Number(k) - 5], true);
    } else if (k === "?") {
      document.dispatchEvent(new CustomEvent("pult:help", { detail: { toggle: true } }));
    } else if (k === " " || k === "Spacebar") {
      if (pressable(ev.target)) return;
      if (!ev.repeat) document.dispatchEvent(new CustomEvent("pult:pause", { detail: { paused: !paused } }));
    } else return;
    ev.preventDefault();
  });
})();
