// Фокус пульта DEMO-2 (П-1.4, модель пульта 1.23 v1.15 — «связанные экраны»): уровни «система → транзакция». Чистые
// функции без DOM и без сети: состояние фокуса и «хлебные крошки». Строку фокуса рисует pult.js через textContent
// (инвариант 4); панели узнают о фокусе событием `pult:focus`. Уровни «точка / участник» и «условие» модели — после MVP
// (план PR #9, список «после MVP» № 10).
/* global window */
"use strict";

(function (root) {
  /** Начальное состояние — вся система. */
  const initial = () => ({ level: "system", tx: null });

  /** Фокус на транзакцию: номер — строка без пустоты (хранится без пробелов по краям); пустой номер или тот же, что уже в
   *  фокусе, — то же состояние: без перерисовки и нового события (иначе панель, отвечающая на фокус выбором, зациклилась
   *  бы; ревью П-1.4 № 2, № 8). */
  function focusTx(state, id) {
    if (typeof id !== "string") return state;
    const tx = id.trim();
    if (tx === "" || (state.level === "tx" && state.tx === tx)) return state;
    return { level: "tx", tx };
  }

  /** Уровень выше (Esc, кнопка «↑ выше»): с транзакции — к системе; у системы — без изменений. */
  function up(state) {
    return state.level === "tx" ? initial() : state;
  }

  /** «Хлебные крошки»: подпись, уровень, текущая ли. Подписи — из словаря страницы (labels). */
  function crumbs(state, labels) {
    const out = [{ level: "system", label: labels["focus.system"], current: state.level === "system" }];
    if (state.level === "tx") out.push({ level: "tx", label: labels["focus.tx"] + " " + state.tx, current: true });
    return out;
  }

  root.PultFocus = Object.freeze({ initial, focusTx, up, crumbs });
})(window);
