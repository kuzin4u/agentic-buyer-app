// ВР-1, К1 — граница модуля каталога (решение **П38** от 22.11.2026, п. 1–3; правило планов № 1 «только через порт»).
//
// Модуль каталога работает с ядром **через порт** и не держит ни адаптера платформы, ни подмодулей ядра с протоколом.
// Проверяется обходом графа импортов, а не доверием к комментарию: запрещённое может приехать не прямо, а через свой
// же файл, и тогда комментарий в шапке порта останется верным, а граница — нет.
//
// Что здесь закрыто сверх границы `src/order` (`tests/order/boundary.test.ts`):
//
// 1. **`@kuzin4u/agentic-core` целиком** — и основной вход, и подмодули (`/catalog`, `/pao`, `/diag`, `/merchant`).
//    Соблазн прямой: каноническая модель К8 лежит именно в `@kuzin4u/agentic-core/catalog`, и ввезти её оттуда короче
//    на одну ссылку. Запрет **повторён** здесь сознательно: общий страж границы (П7 дополнение 2,
//    `tests/demo/faulty.test.ts`) те же два запрета уже держит и на файлах `src/catalog/`, но смотрит он **только
//    прямые спецификаторы** каждого файла — по графу он не ходит. Повтор на месте нужен, чтобы запрет читался там,
//    где стоит модуль, и чтобы он держался на ссылке через свои файлы (находка ревью К1 № 4: «без этой строки путь
//    был бы открыт» — неверно, без неё он был бы виден только в общем страже).
//    Короткий путь закрыт **и по имени пакета, и по пути**: относительная ссылка, уходящая за `src/` в
//    `node_modules/`, читается как ссылка на пакет и проходит те же перечни (находка ревью К1 № 3) — иначе
//    `import … from "../../node_modules/@kuzin4u/agentic-core/catalog/index.js"` был бы зелёным и здесь, и в общем
//    страже, который ловит только спецификатор пакета.
// 2. **`agentic-buyer-ref/src/agent/adapters/**`** — адаптер витрин ядра лежит там же, где адаптер ПАО, и именно он
//    переводит форму эмулятора в К8 (Р42 п. 2). «Чтобы не дублировать перевод» его ввезли бы в приложение — и
//    адаптер конкретной платформы оказался бы здесь при зелёной границе.
// 3. **`src/onboarding/`, `src/ui-server/`, `src/ui-client/`** — файлы окна Б (ИН-П2, сессия 26): их окно А не трогает.
// 4. **`src/order/`, `src/intent/`, `src/principles/`** — соседние задачи, а не источник форм каталога: общее лежит в
//    `src/contract/ui-v1/` и `src/config-parse.ts`.
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { DYNAMIC, filesUnder, specifiers } from "../support/imports.js";

const ROOT = resolve(import.meta.dirname, "../..");
const CATALOG = join(ROOT, "src/catalog");

/** Пакеты и пути пакетов, которые модулю каталога ввозить нельзя. Ядро агента целиком не запрещено — модель К8, домен
 *  и порты берутся у него, — но запрещены его адаптеры платформ и **пакет `@kuzin4u/agentic-core` в любом виде**. */
const FORBIDDEN_PACKAGES = [
  /^agentic-ps-platform(\/|$)/,
  /^vitest(\/|$)/,
  /^agentic-buyer-ref\/src\/agent\/adapters(\/|$)/,
  /^@kuzin4u\/agentic-core(\/|$)/,
];

const FORBIDDEN_LOCAL = [
  /^src\/demo\//,
  /^src\/dashboards\//,
  /^src\/pult\//,
  /^src\/ui-server\//,
  /^src\/ui-client\//,
  /^src\/onboarding\//,
  /^src\/order\//,
  /^src\/intent\//,
  /^src\/principles\//,
];

/** Обход графа импортов от файлов модуля: своя ссылка под `src/` — в стек, чужая — проверяется перечнями.
 *  Отдельной функцией, чтобы тот же обход прогонялся на подложном дереве (красная фикстура ниже). */
function scan(files: readonly string[], root: string): string[] {
  const bad: string[] = [];
  const seen = new Set<string>();
  const stack = [...files];
  while (stack.length > 0) {
    const f = stack.pop()!;
    if (seen.has(f)) continue;
    seen.add(f);
    const src = readFileSync(f, "utf8");
    const name = relative(root, f);
    if (DYNAMIC.test(src)) bad.push(`${name} → динамическая ссылка на модуль`);
    for (const s of specifiers(src)) {
      if (s.startsWith("node:")) continue;
      if (!s.startsWith(".")) {
        if (FORBIDDEN_PACKAGES.some((re) => re.test(s))) bad.push(`${name} → ${s}`);
        continue;
      }
      const target = resolve(dirname(f), s).replace(/\.js$/, ".ts");
      const rel = relative(root, target);
      // Относительная ссылка, уходящая в `node_modules/`, — это ссылка на **пакет**, записанная путём: без этой
      // ветви `../../node_modules/@kuzin4u/agentic-core/catalog/index.js` не подошёл бы ни под один
      // `FORBIDDEN_LOCAL` (все начинаются с `^src/`) и не попал бы в стек (находка ревью К1 № 3).
      const inModules = /(?:^|\/)node_modules\//.exec(rel);
      if (inModules !== null) {
        const pkg = rel.slice(inModules.index + inModules[0].length);
        if (FORBIDDEN_PACKAGES.some((re) => re.test(pkg))) bad.push(`${name} → ${pkg} (путём через node_modules)`);
        continue;
      }
      // Любой другой выход за `src/` своей ссылкой — тоже нарушение: за `src/` лежат `tests/`, `config/`, `dist/`
      // и корень, и модулю там делать нечего. Без этой ветви такая ссылка молча не проверялась бы.
      if (!rel.startsWith("src/")) {
        bad.push(`${name} → ${rel} (за пределами src/)`);
        continue;
      }
      if (FORBIDDEN_LOCAL.some((re) => re.test(rel))) bad.push(`${name} → ${rel}`);
      else stack.push(target);
    }
  }
  return bad;
}

describe("граница src/catalog (правило 1 планов: только через порт)", () => {
  const files = filesUnder(CATALOG);

  it("файлы модуля найдены — иначе проверка ничего не проверяет", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("ни один файл модуля не ввозит адаптеры ядра, @kuzin4u/agentic-core, экраны и сервер окна Б, стенд и пульт", () => {
    expect(scan(files, ROOT)).toEqual([]);
  });

  // Р-1698: проверку, которую никто не видел красной, проверкой не считаем. Фикстура — подложное дерево с теми
  // ссылками, которые соблазнительнее всего завести в модуле каталога; она **остаётся** в тестах.
  it("проверка ловит подделку: короткий путь к К8 мимо ядра агента и адаптер витрин — красные", () => {
    const root = mkdtempSync(join(tmpdir(), "vr1-boundary-"));
    mkdirSync(join(root, "src/catalog"), { recursive: true });

    // Соблазн № 1: модель К8 ввезена прямо из подмодуля пакета ядра, минуя ядро агента (П38 п. 2).
    writeFileSync(
      join(root, "src/catalog/short.ts"),
      `import type { CatalogProduct } from "@kuzin4u/agentic-core/catalog";\nexport type P = CatalogProduct;\n`,
    );
    // Соблазн № 2: перевод формы витрины взят у адаптера ядра «чтобы не дублировать» (правило планов № 1).
    writeFileSync(
      join(root, "src/catalog/adapter.ts"),
      `import { ShopsAdapter } from "agentic-buyer-ref/src/agent/adapters/shops/adapter.js";\nexport const a = ShopsAdapter;\n`,
    );
    // Соблазн № 3: запрещённое приехало **не прямо**, а через свои файлы вне модуля каталога — в стартовый набор
    // они не попадают, и поймать их может только обход по графу.
    mkdirSync(join(root, "src/deep"), { recursive: true });
    writeFileSync(join(root, "src/catalog/via.ts"), `export { P } from "../deep/mid.js";\n`);
    writeFileSync(join(root, "src/deep/mid.ts"), `export { P } from "./far.js";\n`);
    writeFileSync(
      join(root, "src/deep/far.ts"),
      `import type { CatalogShop } from "@kuzin4u/agentic-core/catalog";\nexport type P = CatalogShop;\n`,
    );
    // Соблазн № 4: словарь каркаса окна Б вместо своих текстов.
    writeFileSync(join(root, "src/catalog/lang.ts"), `export { L } from "../ui-server/lang.js";\n`);
    // Соблазн № 5: ссылка, которую статически не прочитать.
    writeFileSync(join(root, "src/catalog/dyn.ts"), `const m = "@kuzin4u/agentic-core/catalog";\nexport const c = import(m);\n`);
    // Соблазн № 6 (находка ревью К1 № 3): тот же подмодуль, но **путём** — мимо запрета по имени пакета.
    writeFileSync(
      join(root, "src/catalog/by-path.ts"),
      `import type { CatalogShop } from "../../node_modules/@kuzin4u/agentic-core/catalog/index.js";\nexport type S = CatalogShop;\n`,
    );
    // Соблазн № 7: ссылка за `src/` — фикстура тестов как источник форм.
    writeFileSync(join(root, "src/catalog/from-tests.ts"), `export { x } from "../../tests/support/card-like.js";\n`);

    const bad = scan(filesUnder(join(root, "src/catalog")), root);

    expect(bad).toContain("src/catalog/short.ts → @kuzin4u/agentic-core/catalog");
    expect(bad).toContain("src/catalog/adapter.ts → agentic-buyer-ref/src/agent/adapters/shops/adapter.js");
    // Через два чужих файла — тот же запрет: обход идёт по графу, а не по одному файлу.
    expect(bad).toContain("src/deep/far.ts → @kuzin4u/agentic-core/catalog");
    expect(bad).toContain("src/catalog/lang.ts → src/ui-server/lang.ts");
    expect(bad).toContain("src/catalog/dyn.ts → динамическая ссылка на модуль");
    expect(bad).toContain("src/catalog/by-path.ts → @kuzin4u/agentic-core/catalog/index.ts (путём через node_modules)");
    expect(bad).toContain("src/catalog/from-tests.ts → tests/support/card-like.ts (за пределами src/)");
  });

  it("разрешённое не запрещено: модель К8 и порты у ядра агента, контракт и общий разбор config — свои", () => {
    expect(FORBIDDEN_PACKAGES.some((re) => re.test("agentic-buyer-ref/src/agent/catalog/index.js"))).toBe(false);
    expect(FORBIDDEN_PACKAGES.some((re) => re.test("agentic-buyer-ref/src/agent/ports/shop.js"))).toBe(false);
    expect(FORBIDDEN_PACKAGES.some((re) => re.test("agentic-buyer-ref/src/shared/domain.js"))).toBe(false);
    expect(FORBIDDEN_LOCAL.some((re) => re.test("src/contract/ui-v1/common.ts"))).toBe(false);
    expect(FORBIDDEN_LOCAL.some((re) => re.test("src/config-parse.ts"))).toBe(false);
    expect(FORBIDDEN_LOCAL.some((re) => re.test("src/card-guard.ts"))).toBe(false);
  });
});
