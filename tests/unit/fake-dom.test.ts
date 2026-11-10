// П-2.1а (ревью № 4): подменённый DOM не даёт ложно-зелёных тестов — неподдержанный селектор даёт ошибку, событие со
// снятого с дерева узла до document не всплывает; поддержанные селекторы находят то, что надо.
import { describe, expect, it } from "vitest";
import { FakeEvent, fromHtml } from "../support/fake-dom.js";

const doc = () =>
  fromHtml(`<!doctype html><html><body><div id="a" class="x y" data-card="C1"><span class="cur" aria-current="location">t</span><input type="text"></div></body></html>`);

describe("подменённый DOM (tests/support/fake-dom.ts)", () => {
  it("неподдержанный селектор — ошибка, а не совпадение", () => {
    const d = doc();
    for (const bad of ["#a", "div > span", "div span", "a + b", "a ~ b", "input:checked", ""]) {
      expect(() => d.querySelector(bad), bad).toThrow(/селектор не поддержан/);
    }
  });

  it("поддержанные: тег, класс, атрибут, атрибут со значением, :not, список; getElementById; dataset", () => {
    const d = doc();
    const a = d.getElementById("a")!;
    expect(a.tagName).toBe("DIV");
    expect(d.querySelector(".x.y")).toBe(a);
    expect(d.querySelector("[data-card='C1']")).toBe(a);
    expect(d.querySelector("span[aria-current='location']")!.textContent).toBe("t");
    expect(d.querySelectorAll("input, span").map((x) => x.tagName)).toEqual(["SPAN", "INPUT"]);
    expect(d.querySelector("div:not(.z)")).toBe(a);
    expect(d.querySelector("div:not(.x)")).toBeNull();
    expect(a.dataset.card).toBe("C1");
    expect(d.querySelector("input")!.closest("[data-card]")).toBe(a);
  });

  it("select.value — только из списка option (вне списка — пусто, как в браузере); без выбора — первый option (ревью П-2.3 № 10)", () => {
    const d = fromHtml(`<!doctype html><html><body><select id="s"><option value="">все</option><option value="M1">M1</option></select></body></html>`);
    const s = d.getElementById("s")!;
    expect(s.value).toBe("");
    s.value = "M1";
    expect(s.value).toBe("M1");
    s.value = "НЕТ-ТАКОГО";
    expect(s.value).toBe("");
  });

  it("событие со снятого узла до document не всплывает; с узла в документе — всплывает", () => {
    const d = doc();
    let atDoc = 0;
    d.addEventListener("click", () => atDoc++);
    const span = d.querySelector("span")!;
    span.click();
    expect(atDoc).toBe(1);
    span.parentNode!.removeChild(span);
    span.dispatchEvent(new FakeEvent("click", { bubbles: true }));
    expect(atDoc).toBe(1);
  });
});
