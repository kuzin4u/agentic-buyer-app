// Справка пульта (П-9.2; модель пульта 1.23 — 38 пояснений, на MVP — короткая справка по панелям, план PR #9): по каждой
// панели — что показывает и откуда данные, клавиши (раскладка — STATUS «Открыто», Р-1523 В13 (а)) и переключатель клавиш
// (WCAG 2.1.4: однобуквенные клавиши можно выключить). Тексты — ru/en (правило совместимости 3), без кодов задач и
// внутренних имён: справку читает человек на показе. Страница получает справку на своём языке (`helpForPage`).
import type { WireLang } from "../dashboards/wire.js";
import { PANES, PULT, type Pane } from "./phrases.js";

type Texts = Readonly<Record<WireLang, string>>;
const p = (ru: string, en: string): Texts => ({ ru, en });

/** Строки справки по панели: 2–4 короткие строки. */
export const HELP_PANES: Readonly<Record<Pane, readonly Texts[]>> = {
  proc: [
    p("Где сейчас каждая покупка: доска по стадиям или «График» — путь каждой транзакции во времени.", "Where each purchase is now: the stage board or the “Graph” — each transaction’s path over time."),
    p("Разрезы: стадия, продавец, тип записи, поручения без покупки.", "Filters: stage, merchant, record type, mandates without a purchase."),
    p("Нажатие на карточку — фокус на транзакцию: остальные панели покажут только её.", "Clicking a card focuses the transaction: the other panels show only it."),
    p("Итог «оплачено» — только по событию Платформы, не по словам продавца.", "The “paid” outcome comes only from a Platform event, not from the merchant’s words."),
  ],
  ctl: [
    p("Что идёт к нарушению и что уже нарушено: паспорта неправильных транзакций, строки «идёт к нарушению».", "What is heading to a violation and what is already violated: passports of wrong transactions, “heading to a violation” rows."),
    p("«Приоритет» — узлы и сектора правил; «Все 89» — справочник правил с поиском и фильтром.", "“Priority” — rule nodes and sectors; “All 89” — the rule reference with search and filters."),
    p("Статусы условий считает движок пульта по шине и журналу стенда — экран их не меняет.", "Condition statuses are computed by the console engine from the bus and the stand log — the screen does not change them."),
  ],
  int: [
    p("«Ленты»: каждая запись шины — простыми словами (кто, что, вид) или как есть (поток, что пришло, идентификаторы).", "“Feeds”: each bus record — in plain words (who, what, kind) or as is (stream, what arrived, identifiers)."),
    p("При транзакции в фокусе — её сводка: стадия, итог по событию, продавцы, число записей.", "With a transaction in focus — its summary: stage, outcome from the event, merchants, number of records."),
    p("На экране — только идентификаторы и коды; текст продавцов — как текст, без разметки.", "Only identifiers and codes are shown; merchants’ text is shown as text, without markup."),
  ],
  // На MVP панель пуста до журнала окна А (П-6): справка не обещает того, чего нет (ревью П-9.2 № 1).
  log: [
    p("Журнал действий и протокол прогона появятся здесь позже; пока панель пуста.", "The action log and the run protocol will appear here later; for now the panel is empty."),
    p("Решения эмулятора клиента и нарушителя уже видны в «Лентах» с пометкой.", "Client emulator and violator decisions are already visible in the “Feeds”, marked."),
  ],
};

/** Общие строки справки. «Одна вкладка» (Р-1530): у вкладки пульта два постоянных потока, а браузер держит 6 соединений на
 *  адрес стенда — вторая вкладка пульта или монитора может задержать кнопки; один поток — после MVP (STATUS «Открыто»). */
export const HELP_GENERAL: readonly Texts[] = [
  p("Пульт — в одной вкладке; вторая вкладка пульта или монитора может задержать кнопки.", "Keep the console in one tab; a second console or monitor tab may delay the buttons."),
];

/** Клавиши — по принятой раскладке (STATUS «Открыто», Р-1523 В13 (а)). */
const same = (k: string): Texts => p(k, k);
export const HELP_KEYS: readonly { readonly key: Texts; readonly what: Texts }[] = [
  { key: same("1–4"), what: p("панели «Ход», «Контроль», «Интерпретатор», «Журнал»: открыть или развернуть, повторно — свернуть", "panels: open or maximize, again — restore") },
  { key: same("5–6"), what: p("виды «Хода»: доска, «График»", "process views: board, graph") },
  { key: same("7–8"), what: p("виды «Контроля»: «Приоритет», «Все 89»", "control views: priority, all 89") },
  { key: same("?"), what: p("эта справка", "this help") },
  // П12 (Р-1557): пауза — весь пульт, «смотреть, не действовать» (правка окна А по Р-1493).
  {
    key: p("пробел", "Space"),
    what: p(
      "пауза пульта: «Ход», «Контроль», «Интерпретатор» и «Журнал» стоят, часы тоже; новые данные копятся и показываются после снятия паузы; кнопки, отправляющие запрос, на паузе неактивны",
      "pause the console: Process, Control, Interpreter and Log stand still, clocks too; new data accumulates and shows after resuming; buttons that send a request are disabled while paused",
    ),
  },
  { key: same("Esc"), what: p("закрыть справку; фокус — уровнем выше", "close the help; focus — one level up") },
];

export const HELP_LABELS = {
  "help.title": p("Справка по пульту", "Console help"),
  "help.open": p("Справка (?)", "Help (?)"),
  "help.close": p("Закрыть", "Close"),
  "help.keys": p("Клавиши", "Keys"),
  "help.keys.on": p("Клавиши пульта", "Console keys"),
  "help.keys.why": p("Снимите флажок, если клавиши мешают — например, при голосовом вводе.", "Clear the box if the keys get in the way — e.g. with voice input."),
  "help.keys.note": p("Клавиши не действуют в полях ввода и с Ctrl, Alt, Meta.", "Keys do not act in input fields or with Ctrl, Alt, Meta."),
} as const satisfies Readonly<Record<string, Texts>>;

/** Справка на одном языке для страницы. */
export function helpForPage(lang: WireLang): {
  readonly labels: Readonly<Record<string, string>>;
  readonly general: readonly string[];
  readonly panes: readonly { readonly pane: Pane; readonly title: string; readonly lines: readonly string[] }[];
  readonly keys: readonly { readonly key: string; readonly what: string }[];
} {
  return {
    labels: Object.fromEntries(Object.entries(HELP_LABELS).map(([k, v]) => [k, v[lang]])),
    general: HELP_GENERAL.map((t) => t[lang]),
    panes: PANES.map((pane) => ({ pane, title: PULT[`pane.${pane}`][lang], lines: HELP_PANES[pane].map((t) => t[lang]) })),
    keys: HELP_KEYS.map((k) => ({ key: k.key[lang], what: k.what[lang] })),
  };
}
