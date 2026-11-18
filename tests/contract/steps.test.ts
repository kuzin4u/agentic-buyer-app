// КТ-0, К2.2 (контракт К-Б § 4; П30): таблица «состояние ядра → шаг экрана» полна в обе стороны.
// Смысл теста — не в том, что таблица заполнена, а в том, что **новое состояние ядра роняет его**, а не выпадает тихо:
// состояние без шага означало бы экран, который не знает, где он, и показывал бы прежний.
import { describe, expect, it } from "vitest";
import { PURCHASE_STATES, type PurchaseState } from "agentic-buyer-ref/src/agent/pipeline/machine.js";
import { UI_STEPS, type UiStep } from "../../src/contract/ui-v1/common.js";
import { STEP_OF_STATE, statesOfStep, stepOfState } from "../../src/contract/ui-v1/steps.js";

describe("К2.2: состояние ядра → шаг экрана (§ 4 К-Б)", () => {
  it("каждое состояние ядра отображено — ключи таблицы это ровно PURCHASE_STATES, по порядку", () => {
    expect(Object.keys(STEP_OF_STATE)).toEqual([...PURCHASE_STATES]);
  });

  it("лишних состояний в таблице нет: каждый ключ — состояние ядра", () => {
    const known = new Set<string>(PURCHASE_STATES);
    for (const k of Object.keys(STEP_OF_STATE)) expect(known.has(k), k).toBe(true);
  });

  it("каждое значение — шаг из перечня U1…U7", () => {
    const steps = new Set<string>(UI_STEPS);
    for (const s of PURCHASE_STATES) expect(steps.has(STEP_OF_STATE[s]), s).toBe(true);
  });

  it("`stepOfState` отдаёт то же, что таблица, для всех состояний", () => {
    for (const s of PURCHASE_STATES) expect(stepOfState(s)).toBe(STEP_OF_STATE[s]);
  });

  it("чтение двух строк документа, названных диапазоном, закреплено (§ 4, оговорка КТ1)", () => {
    // «У2 → У3»: вариантов ещё нет — человек остаётся на У2
    expect(stepOfState("INTENT_ACTIVE")).toBe("U2");
    // «У4–У5»: состояния внутри POST /ui/v1/cart — человек смотрит на карточку корзины
    expect(stepOfState("CART_PENDING")).toBe("U5");
    expect(stepOfState("CART_ACTIVE")).toBe("U5");
  });

  it("У4 — шаг показа без состояния ядра: живая проверка идёт при OFFERS (§ 5.5, предварительный показ)", () => {
    expect(statesOfStep("U4")).toEqual([]);
    expect(statesOfStep("U3")).toEqual(["OFFERS"]);
  });

  it("`statesOfStep` разбивает состояния без потерь и без пересечений", () => {
    const seen: PurchaseState[] = [];
    for (const step of UI_STEPS) seen.push(...statesOfStep(step));
    expect([...seen].sort()).toEqual([...PURCHASE_STATES].sort());
    expect(new Set(seen).size).toBe(PURCHASE_STATES.length);
  });

  it("итог и остановка — один шаг У7: экран итога показывает и «оплачено», и «остановлено»", () => {
    const u7: readonly UiStep[] = [stepOfState("SETTLING"), stepOfState("DONE"), stepOfState("STOPPED")];
    expect(u7).toEqual(["U7", "U7", "U7"]);
  });
});
