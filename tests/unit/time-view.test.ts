// П-11.1д-а (ревью П-11.1д № 3): момент времени в шагах сюжета — текст по языку страницы в поясе процесса стенда и
// машинное значение; на линии дашбордов — разбор с проверкой формы. Без стенда.
import { describe, expect, it } from "vitest";
import { parseWireItem } from "../../src/dashboards/wire.js";
import { timeView } from "../../src/demo/money.js";
import { formatInstant } from "../../src/format.js";

const ISO = "2026-11-11T07:23:45.000Z";

describe("момент времени шага сюжета (П-11.1д-а)", () => {
  it("ru «ДД.ММ.ГГГГ, ЧЧ:ММ», en «ДД/ММ/ГГГГ, ЧЧ:ММ» — местное время процесса, до минут; машинное значение — ISO", () => {
    const v = timeView(ISO);
    expect(v.iso).toBe(ISO);
    const d = new Date(ISO);
    const two = (n: number) => String(n).padStart(2, "0");
    const date = [two(d.getDate()), two(d.getMonth() + 1), String(d.getFullYear())];
    const hm = `${two(d.getHours())}:${two(d.getMinutes())}`;
    expect(v.text.ru).toBe(`${date.join(".")}, ${hm}`);
    expect(v.text.en).toBe(`${date.join("/")}, ${hm}`);
    // Не сырой ISO в UTC.
    for (const t of Object.values(v.text)) expect(t).not.toMatch(/T|Z/);
  });

  it("время не по форме — исключение (шина выводит шаг без него)", () => {
    expect(() => timeView("завтра")).toThrow(RangeError);
  });

  /** К6 П-К4 (решение владельца Р-1668, находка ревью К3 В3): показ времени в приложении **один** — `formatInstant`
   *  (`src/format.ts`). Монитор зовёт его, а не держит вторую копию той же формулы; пояс монитора — пояс процесса
   *  стенда, и он передаётся названным. Сверяется с `formatInstant` **на тех же входах**: это не сравнение функции с
   *  собой — слева величина монитора, справа общий показ, и расхождение формул станет красным. */
  it("монитор и общий показ времени дают одну величину на обоих языках", () => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const v = timeView(ISO);
    expect(v.text.ru).toBe(formatInstant(ISO, "ru", zone));
    expect(v.text.en).toBe(formatInstant(ISO, "en", zone));
  });

  it("линия дашбордов: valid_to — момент {iso, text}; строкой или без текста на языке — запись отбрасывается", () => {
    const line = (valid_to: unknown) => ({ stream: "scenario", line: { seq: 1, at: ISO, step: "expiry.wait", params: { mandate_id: "mnd_1", valid_to } } });
    const ok = parseWireItem(line(timeView(ISO)));
    expect(ok?.stream === "scenario" && ok.line.params.valid_to).toEqual(timeView(ISO));
    expect(parseWireItem(line(ISO))).toBeUndefined();
    expect(parseWireItem(line({ iso: ISO, text: { ru: "x" } }))).toBeUndefined();
    expect(parseWireItem(line({ iso: "вчера", text: { ru: "x", en: "y" } }))).toBeUndefined();
  });
});
