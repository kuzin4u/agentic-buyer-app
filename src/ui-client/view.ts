// Логика каркаса, вынесенная из разметки (ИН-0, кирпич К4).
//
// Зачем отдельным модулем: в `.svelte` эту логику нечем закрыть тестом — смонтировать собранный компонент в
// рукописном подменённом DOM (`tests/support/fake-dom.ts`) нельзя, а новой зависимости ради проверок окно Б не
// заводит (это решение владельца, вопрос в PR). Вынесенная сюда, она проверяется прямо, а в `App.svelte` остаётся
// разметка и состояние.
//
// Ничего, кроме выбора готовых строк и порядка чтений, здесь нет (правило 3 К-Б «Экран ничего не считает»): ни суммы,
// ни шага, ни доступности действия этот модуль не выводит.
import type { ShellData } from "../ui-server/shell.js";
import type { ReadFail, UiFailure } from "./api.js";

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
export const bootLine = (boot: Readonly<Record<string, string>>, fail: ReadFail): string =>
  fail.reason === "offline" ? boot["state.offline"]! : fail.reason === "no_session" ? boot["state.no_session"]! : boot["state.broken"]!;

/** Та же строка **из словаря**, когда он уже доехал. Отказ по контракту сюда не попадает: у него своё тело § 3. */
export const failLine = (shell: ShellData, fail: ReadFail): string =>
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
