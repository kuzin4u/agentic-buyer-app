// Переключатель «Пульт · Экран · Монитор» (П-1.1, Р-1332 в. 2) — один на все страницы демо-стенда: пульт, простые
// экраны «Интерпретация» и «Контроль», монитор операций. Текущая страница — текстом с aria-current, остальные — ссылки
// с тем же языком. Подписи — словарь пульта (правило совместимости 3).
import { SWITCH } from "../pult/phrases.js";
import type { WireLang } from "../dashboards/wire.js";
import { escapeHtml } from "./html.js";

export type SwitchPage = "pult" | "interpret" | "control" | "monitor";

const HREF: Readonly<Record<SwitchPage, string>> = {
  pult: "/pult",
  interpret: "/dash/interpret",
  control: "/dash/control",
  monitor: "/",
};

export function switcherHtml(current: SwitchPage, lang: WireLang): string {
  const s = (k: keyof typeof SWITCH) => escapeHtml(SWITCH[k][lang]);
  const item = (page: SwitchPage, label: string) =>
    page === current
      ? `<strong aria-current="page">${label}</strong>`
      : `<a href="${HREF[page]}?lang=${lang}">${label}</a>`;
  // Без своей роли навигации: переключатель стоит внутри <nav> шапки — две вложенные области диктору не нужны (ревью П-1.1 № 5).
  return `<span class="view-switch">${item("pult", s("pult"))} · ${s("screen")}: ${item("interpret", s("screen.interpret"))}, ${item("control", s("screen.control"))} · ${item("monitor", s("monitor"))}</span>`;
}
