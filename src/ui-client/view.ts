// Логика каркаса, вынесенная из разметки (ИН-0, кирпич К4).
//
// Зачем отдельным модулем: в `.svelte` эту логику нечем закрыть тестом — смонтировать собранный компонент в
// рукописном подменённом DOM (`tests/support/fake-dom.ts`) нельзя, а новая зависимость для рендера в тестах это
// решение владельца, а не выбор окна Б (вопрос задан в отчёте по К4 в PR #26). Вынесенная сюда, логика проверяется
// прямо, а в `App.svelte` остаются разметка и состояние.
//
// Ничего, кроме выбора готовых строк и порядка чтений, здесь нет (правило 3 К-Б «Экран ничего не считает»): ни суммы,
// ни шага, ни доступности действия этот модуль не выводит.
import type { ShellData } from "../ui-server/shell.js";
import type { ReadFail, ReadFailPlain, UiFailure } from "./api.js";

/**
 * Порядок чтений: применяется ответ **последнего** чтения.
 *
 * Чтение покупки запускают четыре повода (сигнал потока, возврат потока, «Обновить», «Повторить»), и они
 * накладываются. Ответ более старого чтения, пришедший последним, перезаписал бы показанное более ранним состоянием —
 * вплоть до откатa с итогового шага на предыдущий (находка ревью К3б № 1). Это прямо против правила 4: показывается
 * то, что прочитано, и именно **последнее** прочитанное.
 */
export interface Latest {
  /** Выполнить чтение; `null` — ответ обогнало более новое чтение, применять его нельзя. */
  run<T>(read: () => Promise<T>): Promise<T | null>;
  /** Идёт ли чтение прямо сейчас: второго поверх идущего не запускаем. */
  readonly busy: boolean;
}

export function latest(): Latest {
  let generation = 0;
  let pending = 0;
  return {
    async run<T>(read: () => Promise<T>): Promise<T | null> {
      const mine = ++generation;
      pending += 1;
      try {
        const value = await read();
        return mine === generation ? value : null;
      } finally {
        pending -= 1;
      }
    },
    get busy(): boolean {
      return pending > 0;
    },
  };
}

/** Раздел ли это пути (У8–У10), а не шаг покупки. Перечни — с сервера, своих у экрана нет. */
export const isPlace = (shell: ShellData | null, id: string | null): boolean =>
  id !== null && shell !== null && shell.places.some((p) => p.id === id);

/** Подпись раздела по опознавателю — из перечней сервера. Опознавателя в перечнях нет (сервер и экран разошлись
 *  версиями) — показывается сам опознаватель, а не пустой заголовок (находка ревью К3 № 13). */
export const labelOf = (shell: ShellData | null, id: string | null): string => {
  if (id === null) return "";
  if (shell === null) return id;
  return [...shell.steps, ...shell.places].find((x) => x.id === id)?.label ?? id;
};

/** Строка о неудаче **до словаря** — из трёх строк, положенных на страницу сервером. Причины не смешиваются: «нет
 *  связи», «вход не выполнен» и «сбой на нашей стороне» это разные случаи (находки ревью К3 № 2 и К3а № 1). */
export const bootLine = (boot: Readonly<Record<string, string>>, fail: ReadFailPlain): string =>
  fail.reason === "offline" ? boot["state.offline"]! : fail.reason === "no_session" ? boot["state.no_session"]! : boot["state.broken"]!;

/** Та же строка **из словаря**, когда он уже доехал. Отказ по контракту сюда не попадает: у него своё тело § 3. */
export const failLine = (shell: ShellData, fail: ReadFailPlain): string =>
  fail.reason === "offline" ? shell.text["state.offline"] : fail.reason === "no_session" ? shell.text["state.no_session"] : shell.text["state.broken"];

/** «Что делать» по классу повтора. Класса нет в перечне сервера (ядро добавило новый) — показывается сам класс, а не
 *  пустое место (находка ревью К3а № 6). */
export const retryLine = (shell: ShellData, failure: UiFailure): string =>
  (shell.retry as Readonly<Record<string, string>>)[failure.retry] ?? failure.retry;

/** Можно ли повторить **то же чтение** на месте. Только `same_key`: при `after_fix` и `after_human` повтор расходился
 *  бы с подписью действия, а при `never` не помог бы никогда (находка ревью К3 № 8). */
export const canRetryInPlace = (failure: UiFailure): boolean => failure.retry === "same_key";

/** Нужен ли выход через страницу, а не повтор чтения: сессию выдаёт раздача каркаса, и повтор того же запроса
 *  крутился бы без выхода (находка ревью К3а № 1). */
export const needsPage = (fail: ReadFail): boolean => fail.reason === "no_session";

/**
 * Пометка «подписывает не человек» (кирпич К6; П26, П5 п. 3).
 *
 * `null` — подписывает человек, и пометки нет: лишняя пометка у обычного человека обесценила бы её там, где она
 * важна. Строку выбирает **не экран по смыслу**, а словарь по признаку, который поставил сервер: своих слов о том,
 * кто нажал, у экрана нет (правило 3). Признак, которого экран не знает, пометки не даёт — врать про него нельзя.
 */
export const signedByLine = (shell: ShellData): string | null => {
  if (shell.signed_by === "test") return shell.text["signed.test"];
  if (shell.signed_by === "emulator") return shell.text["signed.emulator"];
  return null;
};

/**
 * Поводы перечитать покупку — одним местом.
 *
 * Было в разметке, и там это ничем не держалось: убери `!busy` из `App.svelte` — все тесты оставались бы зелёными, а
 * два запроса на одно «Обновить» вернулись бы (находка ревью К4 № 5). Правил здесь ровно три, и каждое названо:
 * - **сигнал потока** — перечитывать только **свою** покупку: по чужому опознавателю читать нечего;
 * - **возврат потока** — перечитать, потому что пока он молчал, покупка могла измениться (правило 4), но не поверх
 *   уже идущего чтения: `open` наступает сразу после открытия потока;
 * - **«Обновить»** — перечитать и поднять поток заново **только если он закрыт**: живой поток рвать незачем, при
 *   временном обрыве браузер восстановит его сам.
 */
export interface ReadTriggers {
  signal(purchaseId: string): void;
  back(): void;
  refresh(): Promise<void>;
}

export function triggers(o: {
  readonly purchaseId: string | null;
  readonly hasPurchase: () => boolean;
  readonly feedClosed: () => boolean;
  readonly busy: () => boolean;
  readonly read: () => Promise<void>;
  readonly listen: () => void;
}): ReadTriggers {
  return {
    signal: (purchaseId) => {
      if (purchaseId === o.purchaseId) void o.read();
    },
    back: () => {
      if (o.hasPurchase() && !o.busy()) void o.read();
    },
    refresh: async () => {
      await o.read();
      if (o.feedClosed()) o.listen();
    },
  };
}
