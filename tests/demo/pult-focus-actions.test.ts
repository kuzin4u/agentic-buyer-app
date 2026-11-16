// Клавиатурный фокус на кнопках реакции «Контроля» при перестройке панели. Эти случаи нельзя положить в
// `tests/demo/pult-client.test.ts`: тот файл до слияния PR #20 правит окно Б (решение владельца 16.11,
// #issuecomment-6917815893), а случаи появились в кирпиче К1.5 окна А. Обратно файлы не сводятся (П21 — долгов не
// заводим): предмет этого файла — куда уходит фокус кнопки реакции после перестройки «Контроля».
//  - К1.5 (Х4а № 8): у «Отозвать поручение» ключ — поручение, поэтому при одном намерении на двух покупках кнопки разных
//    строк несут один `actKey`; фокус возвращается только в свою строку. Своей строки не стало (покупка ушла с экрана или
//    её кнопки погасил конфликт звеньев) — фокус в чужую строку не уходит и теряется, как на паузе (ревью К1.5 № 1).
//  - К1.6 (Х4а № 9): на паузе кнопок реакции в разметке нет и фокус уходит на `body`; после снятия паузы он возвращается
//    на первый шаг той же кнопки своей строки — начатый отзыв пауза снимает, поэтому «Да, отозвать» под Enter не окажется.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { pultPage } from "../../src/demo/dash-pult.js";
import { loadBrand } from "../../src/demo/server.js";
import { PULT } from "../../src/pult/phrases.js";
import type { PultCard } from "../../src/pult/feed.js";
import { FakeEvent, pageEnv, type FakeElement, type PageEnv } from "../support/fake-dom.js";

const PULT_JS = readFileSync("src/demo/public/pult/pult.js", "utf8");
const { brand } = loadBrand("config/brand.demo.json");
const ru = (k: keyof typeof PULT) => PULT[k].ru;
const NOW = "2026-11-16T12:00:10.000Z";
const T0 = "2026-11-16T11:59:00.000Z";

function start(): PageEnv {
  const env = pageEnv(pultPage("ru", brand, false, { actions: true }), {});
  env.run(PULT_JS);
  return env;
}
/** Покупка поручения `IT1`; поручение корзины отличается от идентификатора покупки — иначе подмена признака строки
 *  поручением корзины прошла бы незаметно (ревью К1.5 № 3). `cart: false` — покупка без корзины (`op:…`, `order:…`). */
const tx = (id: string, cart = true): PultCard => ({ id, kind: "tx", column: "pay", worst: "norm", order: 1, since: T0, intentId: "IT1", ...(cart && { cartMandateId: "MC-" + id }) });
/** Доска с двумя покупками одного поручения `IT1`: у кнопок «Отозвать» обеих строк один `actKey` (`revoke:IT1`). */
const boardMsg = (counts: { txs: number; wrong: number }, cards: PultCard[] = [tx("CT1"), tx("CT2")]) => ({
  type: "board",
  board: {
    now: NOW,
    cards,
    jumps: [],
    control: {
      passports: [],
      waits: [],
      waitMs: 15_000,
      active: cards.map((c) => ({ id: c.id, column: "pay", since: T0 })),
      counts,
    },
  },
});
const revokeButtons = (env: PageEnv): FakeElement[] =>
  env.document.getElementById("b-ctl")!.querySelectorAll("button[data-act]").filter((b) => b.dataset.act === "revoke");

const pause = (env: PageEnv, paused: boolean) => env.document.dispatchEvent(new FakeEvent("pult:pause", { detail: { paused } }));

describe("фокус кнопок реакции при перестройке «Контроля» (К1.5, К1.6)", () => {
  it("Х4а № 8: одно поручение на двух покупках — фокус возвращается в свою строку, а не в чужую", () => {
    const env = start();
    const es = env.sources[0]!;
    es.send(boardMsg({ txs: 2, wrong: 0 }));
    const before = revokeButtons(env);
    expect(before).toHaveLength(2);
    expect(before[0]!.dataset.actKey).toBe("revoke:IT1");
    expect(before[1]!.dataset.actKey).toBe("revoke:IT1"); // ключ один — он у поручения, не у покупки
    expect(before[0]!.dataset.actObj).toBe("CT1"); // строка — отдельным признаком, у каждой своя
    expect(before[1]!.dataset.actObj).toBe("CT2");
    // Фокус во второй строке, затем доска с изменившейся разметкой — панель перестраивается.
    before[1]!.focus();
    es.send(boardMsg({ txs: 2, wrong: 1 }));
    const after = revokeButtons(env);
    expect(after).toHaveLength(2);
    expect(env.document.activeElement).toBe(after[1]);
    expect(env.document.activeElement.dataset.actObj).toBe("CT2");
  });

  it("ревью К1.5 № 1: своя покупка ушла с экрана — фокус в чужую строку не уходит", () => {
    const env = start();
    const es = env.sources[0]!;
    es.send(boardMsg({ txs: 2, wrong: 0 }));
    revokeButtons(env)[1]!.focus();
    // Вторая покупка ушла с экрана: осталась строка другой покупки с тем же поручением и такой же кнопкой.
    es.send(boardMsg({ txs: 1, wrong: 0 }, [tx("CT1")]));
    const after = revokeButtons(env);
    expect(after).toHaveLength(1);
    expect(after[0]!.dataset.actObj).toBe("CT1");
    expect(env.document.activeElement).not.toBe(after[0]);
    expect(env.document.activeElement).toBe(env.document.body);
  });

  it("ревью К1.5 № 1: конфликт звеньев погасил кнопки своей строки — фокус в чужую строку не уходит", () => {
    const env = start();
    const es = env.sources[0]!;
    es.send(boardMsg({ txs: 2, wrong: 0 }));
    revokeButtons(env)[1]!.focus();
    // У второй покупки конфликт звеньев (Р-1542): её кнопки неактивны и ключа не несут.
    es.send(boardMsg({ txs: 2, wrong: 0 }, [tx("CT1"), { ...tx("CT2"), linkConflict: true }]));
    const after = revokeButtons(env);
    expect(after).toHaveLength(1); // осталась только кнопка первой покупки
    expect(after[0]!.dataset.actObj).toBe("CT1");
    expect(env.document.activeElement).toBe(env.document.body);
  });

  it("покупка без поручения корзины: признак строки — покупка, а не поручение корзины", () => {
    const env = start();
    const es = env.sources[0]!;
    es.send(boardMsg({ txs: 2, wrong: 0 }, [tx("CT1", false), tx("CT2", false)]));
    const btns = revokeButtons(env);
    expect(btns).toHaveLength(2);
    expect(btns.map((b) => b.dataset.actObj)).toEqual(["CT1", "CT2"]);
    btns[1]!.focus();
    es.send(boardMsg({ txs: 2, wrong: 1 }, [tx("CT1", false), tx("CT2", false)]));
    expect(env.document.activeElement.dataset.actObj).toBe("CT2");
  });

  it("начатый отзыв: фокус на «Отмена» своей строки (В4 — двойной Enter не отзывает)", () => {
    const env = start();
    const es = env.sources[0]!;
    es.send(boardMsg({ txs: 2, wrong: 0 }));
    const second = revokeButtons(env)[1]!;
    second.focus();
    second.click(); // первый шаг отзыва — вопрос «Да, отозвать» / «Отмена»
    const box = env.document.getElementById("b-ctl")!;
    expect(box.textContent).toContain(ru("act.revoke.ask"));
    // Начатый отзыв привязан к поручению, поэтому вопрос показан у обеих покупок — фокус должен встать на «Отмену» своей.
    const cancel = box.querySelectorAll("button[data-act-cancel]");
    expect(cancel).toHaveLength(2);
    expect(env.document.activeElement).toBe(cancel[1]);
    expect(env.document.activeElement.dataset.actObj).toBe("CT2");
    // Перестройка доской при открытом вопросе: признак строки читается уже с самой «Отмены» (ревью К1.5 № 5).
    es.send(boardMsg({ txs: 2, wrong: 1 }));
    const again = env.document.getElementById("b-ctl")!.querySelectorAll("button[data-act-cancel]");
    expect(again).toHaveLength(2);
    expect(env.document.activeElement).toBe(again[1]);
    expect(env.document.activeElement.dataset.actObj).toBe("CT2");
  });

  it("Х4а № 9: пауза уводит фокус на `body`, снятие возвращает его на кнопку своей строки", () => {
    const env = start();
    const es = env.sources[0]!;
    es.send(boardMsg({ txs: 2, wrong: 0 }));
    revokeButtons(env)[1]!.focus();
    pause(env, true);
    expect(revokeButtons(env)).toEqual([]); // на паузе кнопок реакции нет (П12)
    expect(env.document.activeElement).toBe(env.document.body);
    pause(env, false);
    const after = revokeButtons(env);
    expect(after).toHaveLength(2);
    expect(env.document.activeElement).toBe(after[1]);
    expect(env.document.activeElement.dataset.actObj).toBe("CT2");
  });

  it("Х4а № 9 и В4: пауза при начатом отзыве — фокус возвращается на первый шаг, не на «Да, отозвать»", () => {
    const env = start();
    const es = env.sources[0]!;
    es.send(boardMsg({ txs: 2, wrong: 0 }));
    const second = revokeButtons(env)[1]!;
    second.focus();
    second.click(); // вопрос «Да, отозвать» / «Отмена», фокус на «Отмене» своей строки
    pause(env, true);
    pause(env, false);
    const box = env.document.getElementById("b-ctl")!;
    // Пауза сняла начатый отзыв (Х1 № 7): вопроса нет, Enter по возвращённому фокусу отзыв не завершает.
    expect(box.textContent).not.toContain(ru("act.revoke.ask"));
    const active = env.document.activeElement;
    expect(active.dataset.actKey).toBe("revoke:IT1");
    expect(active.dataset.actObj).toBe("CT2");
    expect(active.dataset.second).toBeUndefined();
    expect(active.dataset.actCancel).toBeUndefined();
  });

  it("Х4а № 9: накопленная на паузе доска убрала свою покупку — фокус в чужую строку не уходит", () => {
    const env = start();
    const es = env.sources[0]!;
    es.send(boardMsg({ txs: 2, wrong: 0 }));
    revokeButtons(env)[1]!.focus();
    pause(env, true);
    es.send(boardMsg({ txs: 1, wrong: 0 }, [tx("CT1")])); // копится на паузе, показывается при снятии
    pause(env, false);
    const after = revokeButtons(env);
    expect(after).toHaveLength(1);
    expect(after[0]!.dataset.actObj).toBe("CT1");
    expect(env.document.activeElement).toBe(env.document.body);
  });

  it("Х4а № 9: накопленная доска оставила свою покупку — фокус возвращается на её кнопку", () => {
    const env = start();
    const es = env.sources[0]!;
    es.send(boardMsg({ txs: 2, wrong: 0 }));
    revokeButtons(env)[1]!.focus();
    pause(env, true);
    es.send(boardMsg({ txs: 2, wrong: 1 }));
    pause(env, false);
    const after = revokeButtons(env);
    expect(after).toHaveLength(2);
    expect(env.document.activeElement).toBe(after[1]);
    expect(env.document.activeElement.dataset.actObj).toBe("CT2");
  });

  it("фокус был не на кнопке реакции — пауза и снятие его не перехватывают", () => {
    const env = start();
    const es = env.sources[0]!;
    es.send(boardMsg({ txs: 2, wrong: 0 }));
    pause(env, true);
    pause(env, false);
    expect(env.document.activeElement).toBe(env.document.body);
  });

  it("ревью К1.6 № 2: человек перевёл фокус за время паузы — возврат его не перебивает", () => {
    const env = start();
    const es = env.sources[0]!;
    es.send(boardMsg({ txs: 2, wrong: 0 }));
    revokeButtons(env)[1]!.focus();
    pause(env, true);
    // Так уводит фокус раскладка пульта (клавиши 1–4 — заголовок панели); снять паузу пробелом можно только отсюда.
    const head = env.document.getElementById("h-ctl")!;
    head.setAttribute("tabindex", "-1");
    head.focus();
    pause(env, false);
    // Иначе следующий пробел нажал бы кнопку реакции под вернувшимся фокусом, а не поставил паузу (П12).
    expect(env.document.activeElement).toBe(head);
    expect(revokeButtons(env)).toHaveLength(2);
  });

});
