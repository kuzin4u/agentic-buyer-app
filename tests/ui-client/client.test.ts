// Экран каркаса (ИН-0, кирпич К4).
//
// Три рода проверок, и у каждого своя причина:
// 1. **Исходники** — то, чего в коде экрана быть не должно: `{@html}` и вставка разметки из данных (инвариант 4),
//    арифметика над деньгами (инвариант 2), имя банка литералом (инвариант 7), своя таблица шагов и свои перечни
//    (правило 3), импорты у `boot-text.ts` (иначе в браузерный бандл поедет серверный код).
// 2. **Собранное** — то, чего не должно быть в `dist/ui`: inline-скрипт, inline-стиль, `data:`-ресурс (CSP `'self'`,
//    П4 п. 3), и мобильная раскладка 360–430 (Р-1601).
// 3. **Логика** — `view.ts` и `api.ts` прямо: порядок наложенных чтений, разделение причин неудачи, выбор строк.
//
// **Чего здесь нет, и это открытый пункт, а не умолчание.** Обещанного в К4 «рендера на ширине 360 подменённым DOM»
// нет: рукописный подменённый DOM (`tests/support/fake-dom.ts`) рантайм Svelte не поднимает, а новая зависимость
// (`svelte-check`, `jsdom`, `happy-dom`) — решение владельца, не выбор окна Б. Пока раскладка закрыта проверкой
// собранного CSS и разметки страницы, а поведение — логикой ниже; сама разметка типами и рендером не покрыта.
// Вопрос владельцу — в отчёте по К4 в PR #26; закроется либо акцептом на отступление, либо своим кирпичом.
import { readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { expect, test } from "vitest";
import { UI_STEPS } from "../../src/contract/ui-v1/index.js";
import { UI_SIGNED_BY } from "../../src/contract/ui-v1/index.js";
import { BOOT_KEYS, bootAttr, bootDatasetKey, SHELL_PLACES, type ShellData } from "../../src/ui-server/index.js";
import { IDEMPOTENCY_HEADER } from "../../src/contract/ui-v1/idempotency.js";
import {
  mountBootText,
  mountLang,
  openFeed,
  pressNow,
  sendConsent,
  type ReadFailPlain,
  type UiFailure,
} from "../../src/ui-client/api.js";
import {
  acceptKeys,
  bootLine,
  canAccept,
  canRetryInPlace,
  failLine,
  isPlace,
  labelOf,
  latest,
  needsPage,
  pathLine,
  retry,
  retryLine,
  signedByLine,
  triggers,
} from "../../src/ui-client/view.js";

const read = (path: string): string => readFileSync(path, "utf8");

/** Исходник **без комментариев**: проверки вида «в коде экрана нет `{@html}`» ищут код, а не объяснение, почему его
 *  там нет. Иначе собственный комментарий «`{@html}` в каркасе нет» ронял бы тест — и правилом стало бы «не называй
 *  запрещённое по имени», то есть запрет на объяснение. Снимаются разметочные `<!-- -->`, блочные и строчные. */
const code = (path: string): string =>
  read(path)
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1 ");

const CLIENT = ["src/ui-client/App.svelte", "src/ui-client/api.ts", "src/ui-client/main.ts", "src/ui-client/view.ts"];

// ── 1. Исходники экрана ─────────────────────────────────────────────────────────────────────────────────────────────

test("инвариант 4: ни {@html}, ни innerHTML, ни eval — данные показываются как текст", () => {
  for (const file of CLIENT) {
    const text = code(file);
    expect(text, file).not.toContain("{@html");
    expect(text, file).not.toContain("innerHTML");
    expect(text, file).not.toContain("outerHTML");
    expect(text, file).not.toMatch(/\beval\s*\(|new\s+Function\s*\(/);
    expect(text, file).not.toContain("insertAdjacentHTML");
  }
});

test("инвариант 2: в коде экрана нет арифметики над деньгами и нет знака валюты", () => {
  for (const file of CLIENT) {
    const text = code(file);
    // Суммы приходят готовыми строками (`done_line`), поэтому делению на 100, умножению и сложению сумм взяться
    // неоткуда: любое появление `amount` рядом с арифметикой — дефект, даже если тест состояний зелёный.
    expect(text, file).not.toMatch(/amount\s*[-+*/]|[-+*/]\s*amount|\/\s*100\b|10\s*\*\*/);
    expect(text, file).not.toContain("₽");
    expect(text, file).not.toContain("toFixed");
    expect(text, file).not.toContain("Intl.NumberFormat");
  }
});

test("инвариант 7: имени, цветов и логотипа банка в коде экрана нет — только из конфигурации", () => {
  const brand = JSON.parse(read("config/brand.demo.json")) as { name: string; colors: Record<string, string>; logo: string };
  for (const file of CLIENT) {
    const text = code(file);
    expect(text, file).not.toContain(brand.name);
    for (const colour of Object.values(brand.colors)) expect(text.toLowerCase(), file).not.toContain(colour.toLowerCase());
    expect(text, file).not.toContain(brand.logo);
  }
  // Цвета берутся переменными `/brand.css`, и у каждой есть нейтральный запас на случай, если файл не доехал.
  const markup = read("src/ui-client/App.svelte");
  expect(markup).toContain("var(--brand-primary");
  expect(markup).toContain("var(--brand-on-primary");
});

test("правило 3: у экрана нет ни таблицы шагов, ни своих перечней, ни своих текстов человеку", () => {
  for (const file of CLIENT) {
    const text = code(file);
    // Перечни шагов и мест, состояния ядра и таблица «состояние → шаг» живут у сервера; у экрана — только поле `step`.
    for (const step of UI_STEPS) expect(text, file).not.toContain(`"${step}"`);
    for (const place of SHELL_PLACES) expect(text, file).not.toContain(`"${place}"`);
    expect(text, file).not.toContain("STEP_OF_STATE");
    expect(text, file).not.toContain("PURCHASE_STATES");
  }
});

test("язык экран не выбирает и не сверяет с перечнем — отдаёт строку сервера обратно", () => {
  const api = read("src/ui-client/api.ts");
  expect(api).not.toContain("UI_LANGS");
  expect(api).not.toMatch(/"ru"|"en"/);
  // Строка берётся из атрибута страницы как есть; негодное значение отбрасывает сервер (`langOf`).
  const host = { dataset: { lang: "robot" } } as unknown as HTMLElement;
  expect(mountLang(host)).toBe("robot");
  expect(mountLang({ dataset: {} } as unknown as HTMLElement)).toBe("");
});

test("boot-text.ts не импортирует ничего: иначе в браузерный бандл поедет серверный код", () => {
  const text = read("src/ui-server/boot-text.ts");
  expect(text).not.toMatch(/^\s*import\s/m);
  expect(text).not.toMatch(/\brequire\s*\(/);
  // Это единственный модуль `src/ui-server/`, который читает собранный экран, — граница держится его пустотой.
  expect(read("src/ui-client/api.ts")).toContain('from "../ui-server/boot-text.js"');
});

test("из экрана в сервер ведёт одна значимая ссылка — boot-text; остальное только типами", () => {
  // Обещанная проверка графа импортов (находка ревью К4 № 12): сейчас `ShellData` ввозится из `ui-server/shell.js`
  // как **тип** и при сборке исчезает, но держится это одним словом `type`. Если слово потеряется, в браузерный
  // бандл поедет `node:fs` — здесь это покраснеет, а не выяснится на сборке.
  for (const file of CLIENT) {
    const text = code(file);
    for (const [whole, kind, spec] of [...text.matchAll(/import\s+(type\s+)?([\s\S]*?)from\s+"([^"]+)"/g)].map((m) => [m[0]!, m[1], m[3]!] as const)) {
      if (!spec.startsWith("../ui-server/") && !spec.startsWith("../contract/")) continue;
      const typeOnly = kind !== undefined || /^\s*\{\s*type\s/.test(whole.slice(whole.indexOf("{")));
      const everyNameTyped = /\{([\s\S]*?)\}/.exec(whole)?.[1]?.split(",").every((n) => n.trim() === "" || n.trim().startsWith("type ")) ?? false;
      // Значением можно ввозить только модули из этого перечня, и **каждый обязан быть пустым по зависимостям**:
      // проверка ниже читает их исходники. Иначе исключение превратилось бы в лазейку — именно так в браузерный
      // бандл чуть не уехала канонизация ядра через индекс контракта (кирпич К5: `IDEMPOTENCY_HEADER` ввозился из
      // `../contract/ui-v1/index.js`, и бандл вырос на 7 КБ).
      if (VALUE_IMPORTS_ALLOWED.includes(spec)) continue;
      expect(typeOnly || everyNameTyped, `${file}: ${spec} ввозится значимо`).toBe(true);
    }
  }
});

/** Модули, которые экрану можно ввозить **значением**. Каждый — с доводом, и довод проверяется тестом ниже. */
const VALUE_IMPORTS_ALLOWED: readonly string[] = [
  // имена атрибутов страницы: один перечень на сервер и на экран (находка ревью К3а № 4)
  "../ui-server/boot-text.js",
  // имя заголовка ключа повтора (§ 3, правило 2): нужно экрану, чтобы послать POST
  "../contract/ui-v1/idempotency.js",
];

/** Ввозы одного файла: обычные, **побочные** (`import "…";`) и **динамические** (`await import("…")`). Прежняя
 *  регулярка требовала `from "…"` и двух последних не видела вовсе. */
export const importsOf = (text: string): readonly string[] => [
  ...[...text.matchAll(/import\s+(?:type\s+)?[\s\S]*?from\s+"([^"]+)"/g)].map((m) => m[1]!),
  ...[...text.matchAll(/^\s*import\s+"([^"]+)"/gm)].map((m) => m[1]!),
  ...[...text.matchAll(/\bimport\(\s*"([^"]+)"/g)].map((m) => m[1]!),
];

/**
 * Первая тяжёлая зависимость **по всей цепочке** ввоза, с путём до неё — или `null`.
 *
 * Тяжёлая — это `node:*` и любой пакет: и то и другое уехало бы в браузерный бандл. Отдельной функцией с подменяемым
 * чтением, потому что второй проход ревью поймал две вещи: тело обхода **ни разу не исполнялось** (у обоих
 * разрешённых модулей ввозов нет вовсе), и пути разрешались неверно — `../` отрезался, а `./common.js` склеивался в
 * чужой файл, то есть проверка могла читать не тот модуль и зеленеть зря. Теперь путь считается **от каталога
 * ввозящего файла**, ненайденный файл — внятная ошибка, а сам обход закрыт фикстурой ниже.
 */
export function firstHeavyImport(
  entry: string,
  readSource: (file: string) => string,
): { readonly dep: string; readonly chain: readonly string[] } | null {
  const seen = new Set<string>();
  const walk = (file: string, chain: readonly string[]): { dep: string; chain: string[] } | null => {
    if (seen.has(file)) return null;
    seen.add(file);
    const here = [...chain, file];
    for (const dep of importsOf(readSource(file))) {
      if (dep.startsWith("node:") || !dep.startsWith(".")) return { dep, chain: here };
      const next = resolve(dirname(file), dep).replace(/\.js$/, ".ts");
      const found = walk(next, here);
      if (found !== null) return found;
    }
    return null;
  };
  return walk(entry, []);
}

test("модули, разрешённые экрану значением, сами ничего тяжёлого не ввозят — **и по всей цепочке**", () => {
  for (const spec of VALUE_IMPORTS_ALLOWED) {
    const entry = resolve(import.meta.dirname, "../..", "src", spec.replace(/^\.\.\//, "")).replace(/\.js$/, ".ts");
    const heavy = firstHeavyImport(entry, (file) => {
      const text = readFileSync(file, "utf8");
      // Файл есть: иначе `readFileSync` бросит, и это внятнее тихого пропуска.
      return text;
    });
    expect(heavy, `${spec}: цепочка ввоза тянет ${heavy?.dep ?? ""} (${heavy?.chain.join(" → ") ?? ""})`).toBeNull();
  }
});

test("обход цепочки ввоза ловит тяжёлое на **втором** уровне — проверено фикстурой", () => {
  // Сам обход закрыт фикстурой, потому что на настоящих файлах его тело не исполняется: у разрешённых модулей
  // ввозов нет. Без этого теста правильность обхода держалась бы ни на чём (блокер второго прохода ревью К5).
  const files: Record<string, string> = {
    "/s/a.ts": 'import { b } from "./b.js";\n',
    "/s/b.ts": 'import { readFileSync } from "node:fs";\n',
    "/s/clean.ts": 'import { x } from "./deep/x.js";\n',
    "/s/deep/x.ts": 'import type { T } from "../t.js";\n',
    "/s/t.ts": "export type T = string;\n",
    "/s/pkg.ts": 'import { z } from "some-package";\n',
    "/s/side.ts": 'import "./b.js";\n',
    "/s/dyn.ts": 'const m = await import("./b.js");\n',
    "/s/loop.ts": 'import { a } from "./loop2.js";\n',
    "/s/loop2.ts": 'import { b } from "./loop.js";\n',
  };
  const readSource = (file: string): string => {
    const text = files[file];
    if (text === undefined) throw new Error(`фикстура: нет файла ${file}`);
    return text;
  };

  // Тяжёлое на втором уровне — находится, и путь к нему назван целиком.
  expect(firstHeavyImport("/s/a.ts", readSource)).toEqual({ dep: "node:fs", chain: ["/s/a.ts", "/s/b.ts"] });
  // Путь считается от каталога ввозящего файла: `../t.js` из `/s/deep/` это `/s/t.ts`, а не `/s/../t.ts`.
  expect(firstHeavyImport("/s/clean.ts", readSource)).toBeNull();
  // Пакет — тоже тяжёлое.
  expect(firstHeavyImport("/s/pkg.ts", readSource)?.dep).toBe("some-package");
  // Побочный и динамический ввоз видны.
  expect(firstHeavyImport("/s/side.ts", readSource)?.dep).toBe("node:fs");
  expect(firstHeavyImport("/s/dyn.ts", readSource)?.dep).toBe("node:fs");
  // Кольцо не вешает обход.
  expect(firstHeavyImport("/s/loop.ts", readSource)).toBeNull();
});

/** Потолок размера собранного каркаса. Назван числом, а не «примерно»: рост на 7 КБ от случайно уехавшей в бандл
 *  канонизации ядра я в первый раз заметил **руками**, и потолок — то, что заметит это вместо меня. Поднимается
 *  осознанно, вместе с кирпичом, который добавил экраны. */
const UI_BUNDLE_LIMIT_BYTES = 56 * 1024;

test("в собранном каркасе нет канонизации ядра: проверяется **результат**, а не только импорты", () => {
  // Второй проход ревью поймал, что прежняя проверка была **тождественно зелёной**: бандл минифицирован (`var
  // e=Array.isArray,…`), и ни `canonicalJson`, ни `sha256Hex`, ни имени пакета в нём не бывает **никогда** — ни в
  // здоровой сборке, ни в той, куда канонизация уехала. Проверять надо то, что переживает минификацию: **строковые
  // литералы**. У канонизации ядра это `createHash("sha256")` и ввоз `node:crypto` — оба уцелеют.
  const js = read("dist/ui/ui.js");
  for (const mark of ["sha256", "node:crypto", "createHash"]) expect(js, mark).not.toContain(mark);
  // И потолок размера: он ловит этот класс дефектов независимо от того, какие именно строки уедут.
  expect(statSync("dist/ui/ui.js").size, "бандл каркаса вырос — что в него уехало?").toBeLessThanOrEqual(
    UI_BUNDLE_LIMIT_BYTES,
  );
});

test("экран берёт имена атрибутов страницы из одного перечня, а не литералами", () => {
  const api = read("src/ui-client/api.ts");
  expect(api).toContain("bootDatasetKey");
  for (const key of BOOT_KEYS) expect(api).not.toContain(bootAttr(key));
  // Атрибута нет — показывается сам ключ: пустая строка дала бы кнопку без подписи (находка ревью К3б № 7).
  const dataset: Record<string, string> = {};
  for (const key of BOOT_KEYS) dataset[bootDatasetKey(key)] = `текст ${key}`;
  const full = mountBootText({ dataset } as unknown as HTMLElement);
  for (const key of BOOT_KEYS) expect(full[key]).toBe(`текст ${key}`);
  const empty = mountBootText({ dataset: {} } as unknown as HTMLElement);
  for (const key of BOOT_KEYS) expect(empty[key]).toBe(key);
});

// ── 2. Собранное ────────────────────────────────────────────────────────────────────────────────────────────────────

test("сборка не старее исходников экрана: иначе проверки собранного зеленеют на вчерашнем коде", () => {
  // В CI порядок верный (`build` перед `test`), а локально устаревшая сборка давала зелёные проверки на коде, который
  // их бы не прошёл (находка ревью К4 № 9). Сообщение называет, что делать.
  const built = statSync("dist/ui/ui.js").mtimeMs;
  const newest = Math.max(...CLIENT.map((f) => statSync(f).mtimeMs));
  expect(built, "сборка каркаса устарела — запустите npm run build:ui").toBeGreaterThanOrEqual(newest);
});

test("в собранном каркасе нет inline-стиля, нет data:-ресурсов и нет исполняемого куска разметки", () => {
  const js = read("dist/ui/ui.js");
  const css = read("dist/ui/ui.css");
  // Стили вынесены файлом (`cssCodeSplit: false`), а не вставляются скриптом: иначе страница потребовала бы
  // `'unsafe-inline'` — а по П4 п. 3 политика не ослабляется ни на знак.
  expect(js).not.toContain("document.createElement('style')");
  expect(js).not.toContain('document.createElement("style")');
  expect(js).not.toContain("appendChild(style");
  expect(js).not.toContain("data:");
  expect(css.length).toBeGreaterThan(0);
  expect(css).not.toContain("data:");
});

test("собранный CSS — мобильная раскладка 360–430 без фиксированных ширин (Р-1601)", () => {
  const css = read("dist/ui/ui.css");
  expect(css).toContain("max-width:430px");
  // Ни одной фиксированной ширины шире телефона и ни одного `position:fixed`: страница растёт вверх, а не ломается.
  const widths = [...css.matchAll(/[^-]width:\s*(\d+)px/g)].map((m) => Number(m[1]));
  for (const w of widths) expect(w).toBeLessThanOrEqual(430);
  expect(css).not.toContain("position:fixed");
  // Касание пальцем: у действий есть минимальный размер попадания.
  expect(css).toContain("min-height:44px");
});

test("страница ссылается на собранные файлы и не содержит их содержимого", () => {
  // Образец — `page()` раздачи; здесь проверяется, что ссылка и файл не разошлись именами.
  const shell = read("src/ui-server/shell.ts");
  expect(shell).toContain('href="/ui.css"');
  expect(shell).toContain('src="/ui.js"');
  const vite = read("vite.ui.config.ts");
  expect(vite).toContain('entryFileNames: "ui.js"');
  expect(vite).toContain('assetFileNames: "ui.[ext]"');
  expect(vite).toContain("cssCodeSplit: false");
  expect(vite).toContain("assetsInlineLimit: 0");
});

// ── 3. Логика экрана ────────────────────────────────────────────────────────────────────────────────────────────────

const failure = (retry: string): UiFailure => ({ code: "SHOWN_STALE", retry, text: "текст", view: null }) as unknown as UiFailure;

const shellLike = {
  lang: "ru",
  langs: ["ru", "en"],
  other: "en",
  other_name: "English",
  brand: { name: "Б", logo: null },
  steps: [{ id: "U1", label: "Поручение" }],
  places: [{ id: "U9", label: "Спор" }],
  parties: {},
  text: {
    "state.offline": "нет связи",
    "state.broken": "сбой",
    "state.session_gone": "вход истёк",
    "state.soon": "скоро",
  },
  retry: { same_key: "повторите", after_fix: "исправьте", after_human: "решите заново", never: "не поможет" },
} as unknown as ShellData;

test("порядок чтений: применяется ответ последнего чтения, обогнанный отбрасывается", async () => {
  const reads = latest();
  let slowDone: (v: string) => void = () => undefined;
  const slow = reads.run(() => new Promise<string>((done) => (slowDone = done)));
  // Второе чтение начинается позже и заканчивается раньше: его ответ и есть текущее состояние.
  const fast = await reads.run(() => Promise.resolve("новое"));
  slowDone("старое");
  // Старый ответ пришёл последним — и не применяется: иначе показ откатился бы на более раннее состояние (правило 4).
  expect(await slow).toBeNull();
  expect(fast).toBe("новое");
});

test("порядок чтений: признак «чтение идёт» снимается и после отказа", async () => {
  const reads = latest();
  expect(reads.busy).toBe(false);
  const going = reads.run(() => Promise.resolve(1));
  expect(reads.busy).toBe(true);
  await going;
  expect(reads.busy).toBe(false);
  await expect(reads.run(() => Promise.reject(new Error("сбой")))).rejects.toThrow("сбой");
  // Иначе после одной неудачи поток больше никогда не перечитывал бы покупку.
  expect(reads.busy).toBe(false);
});

// ── Пометка «подписывает не человек» (К6) ───────────────────────────────────────────────────────────────────────────

const withBy = (signed_by: string, text: Record<string, string> = {}): ShellData =>
  ({
    ...shellLike,
    signed_by,
    text: {
      ...shellLike.text,
      "signed.test": "подписано прогоном",
      "signed.emulator": "подписано эмулятором",
      "signed.other": "подписано не вами",
      ...text,
    },
  }) as unknown as ShellData;

test("пометка о подписи: есть у прогона и эмулятора, нет у человека", () => {
  expect(signedByLine(withBy("test"))).toBe("подписано прогоном");
  expect(signedByLine(withBy("emulator"))).toBe("подписано эмулятором");
  // У человека пометки нет: лишняя пометка у обычного человека обесценила бы её там, где она важна.
  expect(signedByLine(withBy("human"))).toBeNull();
});

test("пометка не теряется у нового значения признака — перечень сверяется с источником", () => {
  // Условие в экране — «не человек», а не перечисление поимённо: `test` уже появился решением владельца 19.11, и
  // перечисление однажды потеряло бы пометку молча (находка ревью К5 № 3). Перечень берётся у контракта, не из копии.
  for (const by of UI_SIGNED_BY) {
    const line = signedByLine(withBy(by));
    if (by === "human") expect(line, by).toBeNull();
    else expect(line, by).toBeTruthy();
  }
  // Значение, которого экран не знает: пометка общая, но она **есть** — «не человек» терять нельзя.
  expect(signedByLine(withBy("робот"))).toBe("подписано не вами");
});

test("пометка показывается в шапке и строками из словаря, а не словами экрана", () => {
  const markup = code("src/ui-client/App.svelte");
  // Пометка выводится до навигации и содержимого: она относится ко всему, что будет подписано в этом окне.
  expect(markup.indexOf("signedByLine(shell)")).toBeLessThan(markup.indexOf('aria-label={shell.text["nav.steps"]}'));
  expect(markup).toContain('<p class="signed" role="status">{signedByLine(shell)}</p>');
  // Своих слов о том, кто подписывает, у экрана нет (правило 3). Проверяются оба файла клиента, где могла бы
  // появиться формулировка; в `view.ts` слова `test` и `emulator` встречаются только как **значения признака** —
  // имена из контракта, а не слова человеку (находка ревью К7 № 11).
  for (const word of ["прогон", "эмулятор", "test run", "client emulator"]) {
    expect(markup.toLowerCase(), word).not.toContain(word.toLowerCase());
    expect(code("src/ui-client/view.ts").toLowerCase(), word).not.toContain(word.toLowerCase());
  }
});

test("выход из «вход истёк» — «Открыть заново», а в прочих отказах «Повторить»", () => {
  // Обещанное действие кирпича К7 (находка ревью К7 № 8): в разметке оно должно брать именно `action.reopen`, иначе
  // человеку предлагалось бы повторить то, что повтором не лечится.
  const markup = code("src/ui-client/App.svelte");
  // Вторая ветка стала `{:else if again.has}`: кнопка повтора показывается, только когда есть что повторять
  // (кирпич К5 по находке № 1 — прежде она звала чтение покупки и на знакомстве не делала ничего). Поэтому
  // разделитель ветвей здесь `{:else` с любым продолжением, а не ровно `{:else}`.
  const reopen = [...markup.matchAll(/needsPage\(fail\)\}([\s\S]{0,400}?)\{:else(?: if [^}]*)?\}([\s\S]{0,300}?)\{\/if\}/g)];
  expect(reopen.length, "ветки needsPage в разметке не найдены").toBe(2);
  for (const [, page, other] of reopen) {
    expect(page).toContain("action.reopen");
    expect(page).toContain("pageHref()");
    expect(other).toContain("action.retry");
    expect(other).not.toContain("action.reopen");
  }
  // И повтор зовёт **последнее обращение**, а не чтение покупки: иначе на знакомстве кнопка снова стала бы пустой.
  expect(markup).not.toMatch(/action\.retry[\s\S]{0,80}readPurchase\(\)/);
  expect(markup).toContain("again.run()");
});

test("разводка экранов знакомства: каждый загрузчик регистрирует себя, пометки и выходы на месте", () => {
  // Правки обоих блокеров живут в `.svelte`, где юнитом их не взять (рендер — в ИН-ВЕБ, Р-1669). Поэтому
  // проверяется **разводка по исходнику**: иначе «каждый загрузчик регистрируется» и «пометка над новой карточкой»
  // держались бы ничем — ровно тем обещанием, из-за которого блокеры и были зелёными (находка второго прохода К5
  // № 5). Правила внутри (`retry`, `acceptKeys`, `canAccept`, `pathLine`) закрыты юнитами выше.
  const markup = code("src/ui-client/App.svelte");

  // Каждое обращение знакомства регистрирует себя как последнее — иначе кнопка «Повторить» повторит чужое.
  for (const loader of ["readOnboarding", "() => choose(model)", "() => send(body, key)"])
    expect(markup, `нет again.set для ${loader}`).toContain(`again.set(${loader})`);

  // Оба чтения знакомства идут через порядок чтений: обогнанный ответ состояние не меняет (правило 4).
  for (const call of ["loadOnboarding(lang)", "loadTerms(model, lang)"])
    expect(markup, `${call} мимо reads.run`).toContain(`reads.run(() => ${call})`);

  // Пометка о смене условий ставится **до** перечитывания и не сбрасывается в `choose`.
  expect(markup).toMatch(/termsChanged = true;\s*\n\s*await choose\(/);
  const chooseBody = markup.slice(markup.indexOf("async function choose"), markup.indexOf("function backToModels"));
  expect(chooseBody, "choose гасит пометку о смене условий").not.toContain("termsChanged");

  // Отказ по контракту на П3: есть возврат к той же карточке при `after_fix` и выход к выбору вида при любом отказе.
  expect(markup).toContain('fail.error.retry === "after_fix"');
  expect(markup).toContain('shell.text["action.back_to_terms"]');
  expect(markup).toContain('shell.text["action.other_model"]');

  // «Условия изменились» показывается внутри ветки карточки, а не где-нибудь.
  const termsBranch = markup.slice(markup.indexOf("{:else if terms !== null}"), markup.indexOf("{:else if onboarding !== null}"));
  expect(termsBranch).toContain('shell.text["state.terms_changed"]');

  // Навигация покупки на пути знакомства скрыта: кнопка без ответа — ложное обещание.
  expect(markup).toMatch(/\{#if purchaseId !== null\}\s*\n\s*<nav class="rail"/);
});

// ── Поводы перечитать покупку ───────────────────────────────────────────────────────────────────────────────────────

const plan = (o: { purchase?: boolean; closed?: boolean; busy?: boolean } = {}) => {
  const calls = { read: 0, listen: 0 };
  const fire = triggers({
    purchaseId: "pur_71",
    hasPurchase: () => o.purchase ?? true,
    feedClosed: () => o.closed ?? false,
    busy: () => o.busy ?? false,
    read: async () => {
      calls.read += 1;
    },
    listen: () => {
      calls.listen += 1;
    },
  });
  return { fire, calls };
};

test("сигнал потока перечитывает только свою покупку", () => {
  const { fire, calls } = plan();
  fire.signal("pur_92");
  expect(calls.read).toBe(0);
  fire.signal("pur_71");
  expect(calls.read).toBe(1);
});

test("возврат потока перечитывает, но не поверх идущего чтения", async () => {
  const idle = plan();
  idle.fire.back();
  expect(idle.calls.read).toBe(1);
  // `open` наступает сразу после открытия потока, и на каждое «Обновить» уходило по два одинаковых запроса
  // (находка ревью К3б № 3; сама проводка не проверялась ничем — находка ревью К4 № 5).
  const busy = plan({ busy: true });
  busy.fire.back();
  expect(busy.calls.read).toBe(0);
  // Покупки нет — перечитывать нечего.
  const empty = plan({ purchase: false });
  empty.fire.back();
  expect(empty.calls.read).toBe(0);
});

test("«Обновить» перечитывает всегда, а поток поднимает только закрытый", async () => {
  const live = plan({ closed: false });
  await live.fire.refresh();
  expect(live.calls).toEqual({ read: 1, listen: 0 });
  const dead = plan({ closed: true });
  await dead.fire.refresh();
  // Живой поток рвать незачем: при временном обрыве браузер восстановит его сам.
  expect(dead.calls).toEqual({ read: 1, listen: 1 });
});

test("причины неудачи не смешиваются — ни до словаря, ни после", () => {
  // Ключ строки про вход — `state.session_gone`: на странице «вход не выполнен» это **другая** причина с другим
  // лечением, и путать их нельзя (находка ревью К7 № 1).
  const boot = { "state.offline": "нет связи", "state.broken": "сбой", "state.session_gone": "вход истёк", "action.retry": "повторить" };
  const cases: { fail: ReadFailPlain; boot: string; shell: string }[] = [
    { fail: { reason: "offline", error: null }, boot: "нет связи", shell: "нет связи" },
    { fail: { reason: "broken", error: null }, boot: "сбой", shell: "сбой" },
    { fail: { reason: "no_session", error: null }, boot: "вход истёк", shell: "вход истёк" },
  ];
  for (const c of cases) {
    expect(bootLine(boot, c.fail)).toBe(c.boot);
    expect(failLine(shellLike, c.fail)).toBe(c.shell);
  }
  // Выход через страницу — только у «вход не выполнен»: повтор того же чтения крутился бы без толку.
  expect(needsPage({ reason: "no_session", error: null })).toBe(true);
  expect(needsPage({ reason: "offline", error: null })).toBe(false);
  expect(needsPage({ reason: "broken", error: null })).toBe(false);
  expect(needsPage({ reason: "contract", error: failure("same_key") })).toBe(false);
  // Четвёртая причина — отказ по контракту — в эти две функции попасть **не может**: у неё своё тело § 3 с кодом и
  // «что делать», и общая строка его скрыла бы. Случай закрыт типом, а не договорённостью (находка ревью К4 № 14).
  // @ts-expect-error — `contract` не входит в `ReadFailPlain`
  void (() => failLine(shellLike, { reason: "contract", error: failure("same_key") }));
  // @ts-expect-error — то же для строк со страницы
  void (() => bootLine(boot, { reason: "contract", error: failure("same_key") }));
});

test("повтор на месте — только при same_key", () => {
  expect(canRetryInPlace(failure("same_key"))).toBe(true);
  for (const retry of ["after_fix", "after_human", "never"]) expect(canRetryInPlace(failure(retry))).toBe(false);
});

test("«что делать» — из перечня сервера, неизвестный класс показывается собой", () => {
  expect(retryLine(shellLike, failure("after_human"))).toBe("решите заново");
  // Ядро добавит новый класс — человек увидит сам класс, а не пустое место (находка ревью К3а № 6).
  expect(retryLine(shellLike, failure("after_full_moon"))).toBe("after_full_moon");
});

test("подпись раздела — из перечней сервера; неизвестный опознаватель показывается собой", () => {
  expect(labelOf(shellLike, "U1")).toBe("Поручение");
  expect(labelOf(shellLike, "U9")).toBe("Спор");
  expect(labelOf(shellLike, "U42")).toBe("U42");
  expect(labelOf(shellLike, null)).toBe("");
  expect(labelOf(null, "U1")).toBe("U1");
});

test("раздел пути отличается от шага покупки — по перечню сервера, а не по виду опознавателя", () => {
  expect(isPlace(shellLike, "U9")).toBe(true);
  expect(isPlace(shellLike, "U1")).toBe(false);
  expect(isPlace(shellLike, "U10")).toBe(false);
  expect(isPlace(null, "U9")).toBe(false);
});

// ── Чтение: разбор ответов сервера ──────────────────────────────────────────────────────────────────────────────────

const withFetch = async <T>(answer: { status: number; body: unknown; json?: boolean }, run: () => Promise<T>): Promise<T> => {
  const was = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(answer.json === false ? String(answer.body) : JSON.stringify(answer.body), {
      status: answer.status,
      headers: { "content-type": answer.json === false ? "text/plain" : "application/json" },
    })) as typeof fetch;
  try {
    return await run();
  } finally {
    globalThis.fetch = was;
  }
};

test("повтор: повторяется последнее обращение, а не всегда покупка", async () => {
  // Корень блокера К5 № 1: кнопка «Повторить» звала чтение покупки, а на знакомстве покупки нет — она не делала
  // ничего, и человек оставался на экране без выхода.
  const r = retry();
  expect(r.has).toBe(false);
  // Пока повторять нечего, кнопки быть не должно — и вызов ничего не ломает.
  await r.run();

  const calls: string[] = [];
  r.set(async () => void calls.push("знакомство"));
  expect(r.has).toBe(true);
  await r.run();
  await r.run();
  expect(calls).toEqual(["знакомство", "знакомство"]);

  // Следующее обращение становится последним: повторяется **оно**, а не первое.
  r.set(async () => void calls.push("условия"));
  await r.run();
  expect(calls).toEqual(["знакомство", "знакомство", "условия"]);
});

test("попытка приёма: ключ **и провенанс** живут вместе, пока действие то же", () => {
  // Корень блокера К5 № 3: ключ жил от показа карточки до успеха, и после правки отметок сервер отвечал
  // `IDEMPOTENCY_CONFLICT` навсегда — класс `after_fix`, кнопки повтора нет, ключ не сбрасывался.
  // Второй проход добавил вторую половину: провенанс обязан приходить **из той же попытки**, иначе повтор послал бы
  // другое тело при том же ключе, а сервер считает отпечаток по всему телу, включая `press.at`.
  let n = 0;
  let t = 0;
  const keys = acceptKeys(
    () => `key-${++n}`,
    () => ({ at: `t-${++t}`, device: "web", text_version: "p3@1.0", gesture: "tap" }),
  );
  const both = "M1|DATA,TERMS|sha256:aa";

  // Повтор того же нажатия (обрыв связи) идёт тем же ключом **и тем же телом**: иначе либо второе согласие, либо
  // конфликт по отпечатку.
  expect(keys.for(both)).toEqual({ key: "key-1", press: { at: "t-1", device: "web", text_version: "p3@1.0", gesture: "tap" } });
  expect(keys.for(both).key).toBe("key-1");
  expect(keys.for(both).press.at).toBe("t-1");

  // Действие изменилось (сняли пункт) — своя попытка: новый ключ и новое время нажатия.
  const one = "M1|TERMS|sha256:aa";
  expect(keys.for(one).key).toBe("key-2");
  expect(keys.for(one).press.at).toBe("t-2");
  // Другой хэш показанного — тоже другое действие, даже при том же наборе отметок.
  expect(keys.for("M1|DATA,TERMS|sha256:bb").key).toBe("key-3");

  // Сброс: следующее нажатие получает новую попытку (новая карточка по `SHOWN_STALE`, конфликт ключа).
  keys.reset();
  expect(keys.for(both).key).toBe("key-4");
  expect(keys.for(both).press.at).toBe("t-4");
});

test("строка шага пути — из словаря сервера, с подстановкой чисел", () => {
  // Своего формата «1 / 8» у экрана нет: без слова он не читается и не имеет парности ru/en (находка К5 № 8).
  const shell = { text: { "path.step": "Шаг {n} из {of}" } } as unknown as ShellData;
  expect(pathLine(shell, { n: 1, of: 8 })).toBe("Шаг 1 из 8");
  expect(pathLine(shell, { n: 3, of: 8 })).toBe("Шаг 3 из 8");
  const en = { text: { "path.step": "Step {n} of {of}" } } as unknown as ShellData;
  expect(pathLine(en, { n: 3, of: 8 })).toBe("Step 3 of 8");
});

test("провенанс нажатия: версия текстов — из показанной карточки, поля `by` нет", () => {
  // Непокрытое место, названное ревью: возьми `text_version` из `onboarding.text_version` (он там есть) — тесты
  // остались бы зелёными, а сервер отвечал бы `SHOWN_STALE` на верные нажатия.
  const press = pressNow("p3@1.0");
  expect(press.text_version).toBe("p3@1.0");
  expect(press.device).toBe("web");
  // `tap` — наблюдение, а не умолчание: на П3 человек нажимает кнопку, жест `swipe` там не бывает.
  expect(press.gesture).toBe("tap");
  // Признак «кто нажал» ставит сервер: в теле его нет и быть не может (П26 доп. 2).
  expect(Object.keys(press).sort()).toEqual(["at", "device", "gesture", "text_version"]);
  // Время — по часам устройства, в форме § 3 (ISO 8601 UTC).
  expect(press.at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
});

test("отправка согласия: ключ уходит заголовком, тело § 3 разбирается общим путём", async () => {
  // Непокрытое место, названное ревью: именно из-за него второй разбор ответа в `sendConsent` был не виден.
  const seen: { url?: string; init?: RequestInit } = {};
  const answer = (status: number, body: unknown): Response =>
    ({ status, ok: status < 400, json: async () => body }) as unknown as Response;

  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    seen.url = url;
    seen.init = init;
    return answer(200, { consent: { version: 1 }, path: { n: 3, of: 8 } });
  }) as unknown as typeof fetch;
  try {
    const body = {
      model: "M1",
      accepted: ["TERMS", "DATA"],
      shown_hash: `sha256:${"a".repeat(64)}`,
      press: pressNow("p3@1.0"),
    };
    const ok = await sendConsent(body, "9f1c3b7e-5a24-4d8f-9b31-2c6f0ab4e7d5", "ru");
    expect(ok.ok).toBe(true);
    expect(seen.url).toBe("/ui/v1/consent?lang=ru");
    expect(seen.init?.method).toBe("POST");
    expect((seen.init?.headers as Record<string, string>)[IDEMPOTENCY_HEADER]).toBe(
      "9f1c3b7e-5a24-4d8f-9b31-2c6f0ab4e7d5",
    );
    // Тело уходит как есть: поля `by` в нём нет — его ставит сервер.
    expect(JSON.parse(seen.init?.body as string)).toEqual(body);

    // Отказ § 3 разбирается тем же путём, что у чтений: код, класс повтора и текст доходят до экрана.
    globalThis.fetch = (async () =>
      answer(400, { error: { code: "CONSENT_INVALID", retry: "after_fix", text: "нет", view: null } })) as unknown as typeof fetch;
    const bad = await sendConsent(body, "9f1c3b7e-5a24-4d8f-9b31-2c6f0ab4e7d5", "ru");
    expect(bad.ok).toBe(false);
    if (!bad.ok && bad.reason === "contract") expect(bad.error.code).toBe("CONSENT_INVALID");
    else expect.unreachable("ожидался отказ по контракту");

    // Негодное тело отказа — «сбой», а не ветка отказа: та же проверка формы, что в чтениях (К3а № 3).
    globalThis.fetch = (async () => answer(400, { error: null })) as unknown as typeof fetch;
    const broken = await sendConsent(body, "9f1c3b7e-5a24-4d8f-9b31-2c6f0ab4e7d5", "ru");
    expect(broken.ok).toBe(false);
    if (!broken.ok) expect(broken.reason).toBe("broken");

    // Сессии нет — своя причина и своё лечение (открыть страницу заново), а не «сбой».
    globalThis.fetch = (async () => answer(401, null)) as unknown as typeof fetch;
    const noSession = await sendConsent(body, "9f1c3b7e-5a24-4d8f-9b31-2c6f0ab4e7d5", "ru");
    // Сначала утверждается сам исход: без этой строки проверка причины была бы пропущена, если 401 однажды
    // разберётся как удачный ответ, и тест остался бы зелёным без единой проверки (находка второго прохода К5 № 11).
    expect(noSession.ok).toBe(false);
    if (!noSession.ok) expect(noSession.reason).toBe("no_session");
  } finally {
    globalThis.fetch = original;
  }
});

test("П3: кнопка доступна, только когда отмечены **все** обязательные пункты", () => {
  // Единственная мерка экрана П3, и она разрешена прямо: сервер отдаёт перечень обязательных и готовый текст
  // причины, экран сверяет отмеченное (постановка ИН-П1, § 5.18). Окончательно решает § 5.19.
  const consents = [
    { id: "TERMS", required: true },
    { id: "DATA", required: true },
  ];
  expect(canAccept(consents, new Set())).toBe(false);
  expect(canAccept(consents, new Set(["TERMS"]))).toBe(false);
  expect(canAccept(consents, new Set(["DATA"]))).toBe(false);
  expect(canAccept(consents, new Set(["TERMS", "DATA"]))).toBe(true);
  // Лишняя отметка не мешает: «из этого перечня» проверяет сервер, а не экран.
  expect(canAccept(consents, new Set(["TERMS", "DATA", "MARKETING"]))).toBe(true);
});

test("П3: обязательность приходит полем, а своего перечня у экрана нет", () => {
  // Пункт, помеченный необязательным, кнопку не держит — экран не выдумывает обязательность по опознавателю.
  const withOptional = [
    { id: "TERMS", required: true },
    { id: "NEWS", required: false },
  ];
  expect(canAccept(withOptional, new Set(["TERMS"]))).toBe(true);
  // Пустой перечень кнопку **не** открывает: «обязательных нет» — это не «со всем согласен», а неверно собранная
  // сервером карточка, и подтверждать в ней нечего.
  expect(canAccept([], new Set())).toBe(false);
  expect(canAccept([{ id: "NEWS", required: false }], new Set(["NEWS"]))).toBe(false);
});

test("чтение: тело § 3 — отказ по контракту; служебный текст — «сбой»; 403 — «вход не выполнен»", async () => {
  const { loadShell } = await import("../../src/ui-client/api.js");
  const contract = await withFetch({ status: 409, body: { error: { code: "SHOWN_STALE", retry: "after_human", text: "т", view: null } } }, () => loadShell("ru"));
  expect(contract.ok).toBe(false);
  expect(contract.ok === false && contract.reason).toBe("contract");

  const plain = await withFetch({ status: 500, body: "Сбой на нашей стороне.", json: false }, () => loadShell("ru"));
  expect(plain.ok === false && plain.reason).toBe("broken");

  const noSession = await withFetch({ status: 403, body: "Вход не выполнен.", json: false }, () => loadShell("ru"));
  expect(noSession.ok === false && noSession.reason).toBe("no_session");
});

test("чтение: тело без полей отказа — «сбой», а не ветка отказа (находка ревью К3а № 3)", async () => {
  const { loadShell } = await import("../../src/ui-client/api.js");
  for (const body of [{ error: null }, { error: {} }, { error: { code: "X" } }, {}, []]) {
    const got = await withFetch({ status: 409, body }, () => loadShell("ru"));
    // `{"error": null}` проходило проверку «нет поля» и валило отрисовку — то есть давало пустой экран без выхода.
    expect(got.ok === false && got.reason, JSON.stringify(body)).toBe("broken");
  }
});

test("чтение: сети нет — «нет связи», и это не «сбой»", async () => {
  const { loadPurchase } = await import("../../src/ui-client/api.js");
  const was = globalThis.fetch;
  globalThis.fetch = (() => Promise.reject(new TypeError("сети нет"))) as typeof fetch;
  try {
    const got = await loadPurchase("pur_71", "ru");
    expect(got.ok === false && got.reason).toBe("offline");
  } finally {
    globalThis.fetch = was;
  }
});

// ── Поток у экрана ──────────────────────────────────────────────────────────────────────────────────────────────────

class FakeSource {
  static readonly CLOSED = 2;
  readyState = 1;
  readonly handlers = new Map<string, ((e: unknown) => void)[]>();
  closed = false;
  constructor(readonly url: string) {}
  addEventListener(name: string, fn: (e: unknown) => void): void {
    this.handlers.set(name, [...(this.handlers.get(name) ?? []), fn]);
  }
  fire(name: string, e?: unknown): void {
    for (const fn of this.handlers.get(name) ?? []) fn(e);
  }
  close(): void {
    this.closed = true;
  }
}

const withSource = async (run: (made: FakeSource[]) => void | Promise<void>): Promise<void> => {
  const was = (globalThis as { EventSource?: unknown }).EventSource;
  const made: FakeSource[] = [];
  (globalThis as { EventSource?: unknown }).EventSource = class extends FakeSource {
    constructor(url: string) {
      super(url);
      made.push(this);
    }
  };
  try {
    await run(made);
  } finally {
    (globalThis as { EventSource?: unknown }).EventSource = was;
  }
};

test("поток у экрана: из сигнала берётся только опознаватель покупки", async () => {
  await withSource(async (made) => {
    const signals: string[] = [];
    openFeed((id) => signals.push(id), () => undefined, () => undefined);
    const source = made[0]!;
    expect(source.url).toBe("/ui/v1/feed");
    source.fire("purchase", { data: JSON.stringify({ event_id: "evt_1", purchase_id: "pur_71", kind: "STATE", at: "t", state: "DONE" }) });
    expect(signals).toEqual(["pur_71"]);
    // Негодная строка сигнала не роняет экран и сигналом не считается.
    source.fire("purchase", { data: "{не json" });
    source.fire("purchase", { data: JSON.stringify({ purchase_id: 7 }) });
    expect(signals).toEqual(["pur_71"]);
  });
});

test("поток у экрана: закрытый поток отличается от временного обрыва", async () => {
  await withSource(async (made) => {
    const breaks: boolean[] = [];
    let backs = 0;
    openFeed(() => undefined, (closed) => breaks.push(closed), () => (backs += 1));
    const source = made[0]!;
    source.readyState = 1;
    source.fire("error");
    source.readyState = FakeSource.CLOSED;
    source.fire("error");
    // Временный обрыв браузер лечит сам; закрытый поток не вернётся никогда, и человеку это должно быть видно.
    expect(breaks).toEqual([false, true]);
    source.fire("open");
    expect(backs).toBe(1);
  });
});
