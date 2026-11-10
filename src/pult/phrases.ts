// Словарь пульта DEMO-2 (П-1, модель пульта 1.23): подписи интерфейса ru/en целиком (правило совместимости 3, П6 п. 1).
// Тексты справочника 89 правил — отдельно, `rules89.ts` (П-3.1, П6 п. 2).
import type { WireLang } from "../dashboards/wire.js";

export type Phrase = Readonly<Record<WireLang, string>>;
const p = (ru: string, en: string): Phrase => ({ ru, en });

/** Панели пульта: порядок — раскладка модели 1.18 (сверху Ход и Контроль, снизу Интерпретатор и Журнал). */
export const PANES = ["proc", "ctl", "int", "log"] as const;
export type Pane = (typeof PANES)[number];

/** Подписи страницы пульта. */
export const PULT = {
  title: p("Пульт", "Console"),
  subtitle: p(
    "Сделки демо-стенда по транзакциям: ход по стадиям, контроль условий, причины и журнал — по событиям шины",
    "Demo stand deals by transaction: progress by stage, condition control, causes and log — from bus events",
  ),
  lang: p("Язык", "Language"),
  "layout.label": p("Раскладка", "Layout"),
  "layout.grid": p("Сетка 2×2", "2×2 grid"),
  "layout.tabs": p("Вкладки", "Tabs"),
  "pane.maximize": p("Развернуть", "Maximize"),
  "pane.restore": p("Свернуть", "Restore"),
  "pane.proc": p("Ход", "Progress"),
  "pane.proc.hint": p("транзакции по стадиям", "transactions by stage"),
  "pane.ctl": p("Контроль", "Control"),
  "pane.ctl.hint": p("паспорта, условия, «идёт к нарушению»", "passports, conditions, “heading for a breach”"),
  "pane.int": p("Интерпретатор", "Interpreter"),
  "pane.int.hint": p("причины и ленты простыми словами", "causes and feeds in plain words"),
  "pane.log": p("Журнал", "Log"),
  "pane.log.hint": p("действия, протокол, отчёт", "actions, protocol, report"),
  "empty.proc": p("Транзакций пока нет — запустите сюжет на мониторе операций", "No transactions yet — start a scenario on the operations monitor"),
  "empty.ctl": p("Нарушений и предупреждений нет", "No breaches or warnings"),
  "empty.int": p("Событий пока нет", "No events yet"),
  "empty.log": p("Записей журнала пока нет", "No log entries yet"),
  "status.connecting": p("подключение к шине…", "connecting to the bus…"),
  "status.open": p("шина подключена", "bus connected"),
  "status.reset": p("стенд перезапущен — лента начата заново", "stand restarted — feed started over"),
  "status.closed": p("шина отключена", "bus disconnected"),
  "status.screen_offline": p("пульт потерял связь с сервером стенда — переподключение…", "the console lost the stand server — reconnecting…"),
  "mode.faults": p("режим сбоев: вкл.", "fault mode: on"),
  "mode.faults_note": p("прогон тестов пульта: сбои стенда по кнопкам, срок подтверждения 45 с", "console test run: stand faults by buttons, confirmation deadline 45 s"),
  "status.pult_closed": p("пульт отключён от сервера стенда — обновите страницу", "the console is disconnected from the stand server — reload the page"),
} as const;

/** Переключатель «Пульт · Экран · Монитор» (Р-1332 в. 2): пульт — основной для управления; экраны (простые виды
 *  «Интерпретация» и «Контроль») и монитор — отладка и текущие задачи. */
export const SWITCH = {
  pult: p("Пульт", "Console"),
  screen: p("Экран", "Screen"),
  "screen.interpret": p("Интерпретация", "Interpretation"),
  "screen.control": p("Контроль", "Control"),
  monitor: p("Монитор", "Monitor"),
} as const;
