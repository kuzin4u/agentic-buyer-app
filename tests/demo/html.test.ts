// К2.3в: одна функция экранирования страниц демо-стенда (Р-1406 п. 1–3) — пять символов `& < > " '`, каждый глобально,
// `&` без двойного экранирования; в тексте и в значении атрибута в кавычках. Страницы берут её из src/demo/html.ts.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { escapeHtml, jsonForScript } from "../../src/demo/html.js";

const CASES: [string, string][] = [
  ["&", "&amp;"],
  ["<", "&lt;"],
  [">", "&gt;"],
  ['"', "&quot;"],
  ["'", "&#39;"],
];

/** Значение атрибута в двойных кавычках: после экранирования внутри нет ни «"», ни «<», ни «>» — из атрибута не выйти. */
const attr = (v: string) => `<a title="${escapeHtml(v)}">${escapeHtml(v)}</a>`;

describe("escapeHtml (К2.3в)", () => {
  it.each(CASES)("символ %s — %s, все вхождения, в тексте и в атрибуте", (ch, ent) => {
    expect(escapeHtml(`${ch}x${ch}`)).toBe(`${ent}x${ent}`);
    expect(attr(ch)).toBe(`<a title="${ent}">${ent}</a>`);
  });

  it("строка со всеми пятью сразу; «&» не экранируется повторно; из атрибута не выйти", () => {
    const all = `&<>"'`;
    expect(escapeHtml(all)).toBe("&amp;&lt;&gt;&quot;&#39;");
    expect(escapeHtml("&lt;")).toBe("&amp;lt;");
    const evil = `" onmouseover="alert(1)' <script>x</script> &amp;`;
    const html = attr(evil);
    const inner = html.slice('<a title="'.length, html.indexOf('">'));
    expect(inner).not.toMatch(/["<>']/);
    expect(html.match(/<[a-z/]/g)).toEqual(["<a", "</"]);
  });

  it("одна функция на страницы: копий в server.ts, dash.ts, dash-control.ts нет, циклического импорта dash-control → server нет", () => {
    for (const f of ["server.ts", "dash.ts", "dash-control.ts"]) {
      const src = readFileSync(new URL(`../../src/demo/${f}`, import.meta.url), "utf8");
      expect(src, f).not.toMatch(/(function|const) escapeHtml\b/);
      expect(src, f).not.toMatch(/const jsonForScript\b/);
    }
    expect(readFileSync(new URL("../../src/demo/dash-control.ts", import.meta.url), "utf8")).not.toMatch(/from "\.\/server\.js"/);
  });

  it("JSON для <script>: «<» не закрывает тег", () => {
    expect(jsonForScript({ a: "</script><b>" })).toBe('{"a":"\\u003c/script>\\u003cb>"}');
  });
});
