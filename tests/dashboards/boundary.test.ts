// К1.2 (Р-1246 п. 3, Р-1275 п. 2): экраны DEMO-2 не импортируют код агента, Платформы, ядра и сборки стенда — ни прямо,
// ни через свои модули. Граф импортов обходится от каждого файла src/dashboards; `import type` тоже считается.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "../..");

/** Формы ссылки на модуль: from, побочный импорт, динамический импорт, require/createRequire, `/// <reference types>`. */
const SPEC =
  /(?:^|[\s;])(?:import|export)\s[^"'`;]*?from\s*["'`]([^"'`]+)["'`]|(?:^|[\s;])import\s*["'`]([^"'`]+)["'`]|import\(\s*["'`]([^"'`]+)["'`]\s*\)|\brequire(?:\.resolve)?\(\s*["'`]([^"'`]+)["'`]\s*\)|\/\/\/\s*<reference\s+(?:types|path)\s*=\s*["']([^"']+)["']/g;
/** Динамическая ссылка, которую статически не прочитать, — сама нарушение. */
const DYNAMIC = /import\(\s*[^"'`\s)]|\brequire\(\s*[^"'`\s)]|\bcreateRequire\(/;

export function specifiers(source: string): string[] {
  const out: string[] = [];
  for (const m of source.matchAll(SPEC)) out.push((m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5])!);
  return out;
}

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? filesUnder(p) : /\.(ts|mts|cts|tsx|js)$/.test(n) ? [p] : [];
  });
}

/** Относительный импорт `./x.js` → файл .ts рядом (NodeNext). */
function resolveLocal(from: string, spec: string): string {
  const p = resolve(dirname(from), spec);
  for (const c of [p.replace(/\.js$/, ".ts"), p, `${p}.ts`, join(p, "index.ts")]) if (existsSync(c) && statSync(c).isFile()) return c;
  return p;
}

/** Нарушения границы: `dash` — каталог экранов, `allowed` — файлы вне его, которые можно импортировать. */
export function violations(dash: string, allowed: ReadonlySet<string>, root = ROOT): string[] {
  const bad: string[] = [];
  const seen = new Set<string>();
  const stack = filesUnder(dash);
  while (stack.length) {
    const f = stack.pop()!;
    if (seen.has(f)) continue;
    seen.add(f);
    const src = readFileSync(f, "utf8");
    if (DYNAMIC.test(src)) bad.push(`${relative(root, f)} → динамическая ссылка на модуль`);
    for (const s of specifiers(src)) {
      if (s.startsWith("node:")) continue;
      if (!s.startsWith(".")) {
        bad.push(`${relative(root, f)} → ${s}`);
        continue;
      }
      const target = resolveLocal(f, s);
      if (target.startsWith(dash + "/") || allowed.has(target)) stack.push(target);
      else bad.push(`${relative(root, f)} → ${relative(root, target)}`);
    }
  }
  return bad;
}

describe("граница экранов DEMO-2 (Р-1246 п. 3)", () => {
  it("src/dashboards импортирует только node:*, свои модули и бренд (у бренда импортов нет)", () => {
    const dash = join(ROOT, "src/dashboards");
    expect(filesUnder(dash).length).toBeGreaterThan(0);
    expect(violations(dash, new Set([join(ROOT, "src/brand.ts")]))).toEqual([]);
  });

  it("разбор видит все формы: from, import type, export from, побочный, динамический, require, reference types", () => {
    const src = [
      `import { a } from "agentic-buyer-ref/src/agent/compose.js";`,
      `import type { StandCall } from "agentic-ps-platform/stand";`,
      `export { b } from "../demo/bus.js";`,
      `import "@kuzin4u/agentic-core/diag";`,
      `const m = await import("agentic-ps-platform/fixtures");`,
      `import {\n  c,\n  d,\n} from "./wire.js";`,
      `const r = require("agentic-buyer-ref");`,
      `/// <reference types="agentic-ps-platform" />`,
    ].join("\n");
    expect(specifiers(src)).toEqual([
      "agentic-buyer-ref/src/agent/compose.js",
      "agentic-ps-platform/stand",
      "../demo/bus.js",
      "@kuzin4u/agentic-core/diag",
      "agentic-ps-platform/fixtures",
      "./wire.js",
      "agentic-buyer-ref",
      "agentic-ps-platform",
    ]);
  });

  it("поломки ловятся на временном дереве: относительный выход к стенду, пакет через свой модуль, динамическая ссылка", () => {
    const root = mkdtempSync(join(tmpdir(), "dash-boundary-"));
    try {
      const dash = join(root, "src/dashboards");
      mkdirSync(join(root, "src/demo"), { recursive: true });
      mkdirSync(dash, { recursive: true });
      writeFileSync(join(root, "src/demo/bus.ts"), `export const x = 1;\n`);
      writeFileSync(join(dash, "a.ts"), `import { x } from "../demo/bus.js";\nimport { y } from "./b.js";\nexport const z = x + y;\n`);
      writeFileSync(join(dash, "b.ts"), `import type { Shop } from "agentic-ps-platform/stand";\nexport const y = 2;\n`);
      writeFileSync(join(dash, "c.ts"), "const n = 'agentic-buyer-ref';\nexport const m = import(n);\n");
      const v = violations(dash, new Set(), root);
      expect(v).toEqual(
        expect.arrayContaining([
          "src/dashboards/a.ts → src/demo/bus.ts",
          "src/dashboards/b.ts → agentic-ps-platform/stand",
          "src/dashboards/c.ts → динамическая ссылка на модуль",
        ]),
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
