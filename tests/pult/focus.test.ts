// П-1.4 (модель пульта 1.23 v1.15): фокус пульта «система → транзакция» — чистые функции скрипта страницы
// `public/pult/focus.js`, без браузера: начальное состояние, фокус на транзакцию, уровень выше (Esc), крошки ru/en.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PULT } from "../../src/pult/phrases.js";

interface FocusState {
  readonly level: "system" | "tx";
  readonly tx: string | null;
}
interface Crumb {
  readonly level: string;
  readonly label: string;
  readonly current: boolean;
}
interface PultFocus {
  initial(): FocusState;
  focusTx(s: FocusState, id: unknown): FocusState;
  up(s: FocusState): FocusState;
  crumbs(s: FocusState, labels: Record<string, string>): Crumb[];
}

function load(): PultFocus {
  const win: { PultFocus?: PultFocus } = {};
  new Function("window", readFileSync("src/demo/public/pult/focus.js", "utf8"))(win);
  return win.PultFocus!;
}
const labels = (lang: "ru" | "en") => Object.fromEntries(Object.entries(PULT).map(([k, v]) => [k, v[lang]]));

describe("фокус пульта (П-1.4)", () => {
  const F = load();

  it("начало — система; фокус на транзакцию; Esc (up) — снова система; у системы up ничего не меняет", () => {
    const s0 = F.initial();
    expect(s0).toEqual({ level: "system", tx: null });
    const s1 = F.focusTx(s0, "mnd_c1");
    expect(s1).toEqual({ level: "tx", tx: "mnd_c1" });
    expect(F.up(s1)).toEqual({ level: "system", tx: null });
    expect(F.up(s0)).toBe(s0);
  });

  it("фокус на другую транзакцию заменяет прежнюю; пустой или не строковый номер состояние не меняет", () => {
    const s1 = F.focusTx(F.initial(), "A");
    expect(F.focusTx(s1, "B")).toEqual({ level: "tx", tx: "B" });
    for (const bad of ["", "   ", undefined, null, 42, {}]) expect(F.focusTx(s1, bad)).toBe(s1);
  });

  it("тот же номер — то же состояние (без перерисовки и события: панель, отвечающая выбором на фокус, не зациклится); номер — без пробелов по краям (ревью П-1.4 № 2, № 8)", () => {
    const s1 = F.focusTx(F.initial(), "  A1 ");
    expect(s1).toEqual({ level: "tx", tx: "A1" });
    expect(F.focusTx(s1, "A1")).toBe(s1);
    expect(F.focusTx(s1, " A1")).toBe(s1);
    expect(F.focusTx(s1, "A2")).not.toBe(s1);
  });

  it("крошки ru и en: «Система» и «Транзакция <номер>», текущая — последняя", () => {
    for (const lang of ["ru", "en"] as const) {
      const L = labels(lang);
      expect(F.crumbs(F.initial(), L)).toEqual([{ level: "system", label: PULT["focus.system"][lang], current: true }]);
      expect(F.crumbs(F.focusTx(F.initial(), "op:P1"), L)).toEqual([
        { level: "system", label: PULT["focus.system"][lang], current: false },
        { level: "tx", label: `${PULT["focus.tx"][lang]} op:P1`, current: true },
      ]);
    }
  });

  it("состояние не изменяется на месте: функции возвращают новые объекты", () => {
    const s0 = F.initial();
    const s1 = F.focusTx(s0, "X");
    expect(s0).toEqual({ level: "system", tx: null });
    expect(s1).not.toBe(s0);
    expect(Object.isFrozen(F)).toBe(true);
  });
});
