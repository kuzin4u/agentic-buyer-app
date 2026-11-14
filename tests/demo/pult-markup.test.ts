// Х5 (повторное ревью Х2 № 2): браузерная ветка `markupKey` (`src/demo/public/pult/pult.js`) — текстовые узлы
// (`nodeType` 3), `childNodes`, атрибуты `Attr` ({ name, value }), фрагмент без тега. Подменённый DOM тестов
// (`tests/support/fake-dom.ts`) этих свойств не имеет и идёт другой веткой, поэтому функция берётся из файла как есть
// (тот же текст, что работает в браузере) и исполняется на объектах браузерной формы.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SRC = readFileSync("src/demo/public/pult/pult.js", "utf8");
const start = SRC.indexOf("  function markupKey(n) {");
const end = SRC.indexOf("\n  }\n", start);
if (start < 0 || end < 0) throw new Error("markupKey не найден в pult.js");
const body = SRC.slice(start, end + 4);
type Node = { nodeType: number; nodeValue?: string; tagName?: string; className?: unknown; attributes?: { name: string; value: string }[]; childNodes?: Node[] };
// Перечень бегущих классов — из того же `pult.js` (ключи `CTL_TICKING`), не литералом (ревью Х5 № 5).
const tickStart = SRC.indexOf("const CTL_TICKING = {");
const tickEnd = SRC.indexOf("\n  };", tickStart);
if (tickStart < 0 || tickEnd < 0) throw new Error("CTL_TICKING не найден в pult.js");
const TICKING = [...SRC.slice(tickStart, tickEnd).matchAll(/^\s+"([a-z-]+)":/gm)].map((m) => m[1]!);
if (TICKING.length === 0) throw new Error("CTL_TICKING пуст");
const markupKey = new Function("CTL_TICKING", `${body}\nreturn markupKey;`)(Object.fromEntries(TICKING.map((c) => [c, () => ""]))) as (n: Node) => string;

const text = (s: string): Node => ({ nodeType: 3, nodeValue: s });
const elem = (tag: string, attrs: Record<string, string>, kids: Node[] = []): Node => ({
  nodeType: 1,
  tagName: tag.toUpperCase(),
  className: attrs.class ?? "",
  attributes: Object.entries(attrs).map(([name, value]) => ({ name, value })),
  childNodes: kids,
});
const frag = (kids: Node[]): Node => ({ nodeType: 11, childNodes: kids });

describe("markupKey в браузерной форме узлов (Х5)", () => {
  const row = (params: string, secs: string, label = "Остановить") =>
    frag([elem("div", { class: "row" }, [text("T1 · "), elem("button", { class: "act-btn", "data-params": params, type: "button" }, [text(label)]), elem("span", { class: "wait-s", "data-since": "x" }, [text(secs)])])]);

  it("перечень бегущих классов взят из `pult.js`: `wait-s`, `active-t`", () => {
    expect(TICKING.sort()).toEqual(["active-t", "wait-s"]);
  });

  it("та же разметка — тот же ключ; порядок атрибутов не важен", () => {
    expect(markupKey(row("cart=C1", "10 с"))).toBe(markupKey(row("cart=C1", "10 с")));
    const a = frag([elem("button", { type: "button", class: "x" }, [text("y")])]);
    const b = frag([{ ...elem("button", { class: "x", type: "button" }, [text("y")]) }]);
    expect(markupKey(a)).toBe(markupKey(b));
  });

  it("бегущие секунды (`wait-s`) — вне сравнения; атрибут, текст и `disabled` — в сравнении", () => {
    expect(markupKey(row("cart=C1", "10 с"))).toBe(markupKey(row("cart=C1", "73 с")));
    expect(markupKey(row("cart=C1", "10 с"))).not.toBe(markupKey(row("cart=C2", "10 с")));
    expect(markupKey(row("cart=C1", "10 с"))).not.toBe(markupKey(row("cart=C1", "10 с", "Отозвать")));
    const on = frag([elem("button", { class: "act-btn" }, [text("Остановить")])]);
    const off = frag([elem("button", { class: "act-btn", disabled: "" }, [text("Остановить")])]);
    expect(markupKey(on)).not.toBe(markupKey(off));
  });

  it("текст в кавычках — данные с разметкой не путаются со структурой; узлы разной глубины различаются", () => {
    const flat = frag([elem("p", {}, [text("<b>x</b>")])]);
    const deep = frag([elem("p", {}, [elem("b", {}, [text("x")])])]);
    expect(markupKey(flat)).not.toBe(markupKey(deep));
    expect(markupKey(frag([elem("p", {}, [text("a"), text("b")])]))).not.toBe(markupKey(frag([elem("p", {}, [text("ab")])])));
  });
});
