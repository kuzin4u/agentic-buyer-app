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
  "board.note": p(
    "Транзакция стоит в стадии, пока не придёт событие, и перескакивает в следующую колонку в момент события. Завершена — только по событию Платформы.",
    "A transaction stays in its stage until an event arrives and jumps to the next column at that moment. Done — only by a Platform event.",
  ),
  "board.jumps": p("Переходы (скачком, по событию)", "Jumps (on event)"),
  "board.no_jumps": p("переходов пока нет", "no jumps yet"),
  "board.more": p("ещё", "more"),
  "col.mandate": p("Поручение", "Mandate"),
  "col.select": p("Подбор", "Selection"),
  "col.cart": p("Корзина", "Cart"),
  "col.confirmation": p("Подтверждение", "Confirmation"),
  "col.pay": p("Реквизит и оплата", "Credential & payment"),
  "col.result": p("Итог", "Outcome"),
  "col.post": p("После операции", "After operation"),
  "col.done": p("Завершены", "Done"),
  "card.mandate": p("поручение, покупки нет", "mandate, no purchase"),
  "card.in_stage": p("в стадии", "in stage"),
  "card.sec": p("с", "s"),
  "card.select_hint": p("щелчок — фокус на транзакцию", "click — focus on the transaction"),
  "outcome.paid": p("оплачено — по событию Платформы", "paid — by Platform event"),
  "outcome.settled": p("проведено — по событию Платформы", "settled — by Platform event"),
  "outcome.declined": p("отказ — по событию Платформы", "declined — by Platform event"),
  "outcome.rejected": p("подтверждение отклонено", "confirmation rejected"),
  "outcome.revoked": p("поручение отозвано", "mandate revoked"),
  "outcome.mandate_revoked": p("поручение отозвано, покупки не было", "mandate revoked, no purchase"),
  "card.conflict": p("конфликт звеньев — итог не присвоен, решает человек", "link conflict — no outcome assigned, a human decides"),
  "card.unconfirmed": p(
    "итоговое событие связано с корзиной только номером заказа — связь не подтверждена, итог не присвоен",
    "the outcome event is linked to the cart only by the order number — link not confirmed, no outcome assigned",
  ),
  "focus.label": p("Фокус", "Focus"),
  "focus.system": p("Система", "System"),
  "focus.tx": p("Транзакция", "Transaction"),
  "focus.up": p("↑ выше", "↑ up"),
  "focus.hint": p("Esc — уровень выше; панели показывают то, что в фокусе", "Esc — one level up; panes show what is in focus"),
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
