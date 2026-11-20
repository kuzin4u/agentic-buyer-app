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
import { expect, test } from "vitest";
import { UI_STEPS } from "../../src/contract/ui-v1/index.js";
import { BOOT_KEYS, bootAttr, bootDatasetKey, SHELL_PLACES, type ShellData } from "../../src/ui-server/index.js";
import { mountBootText, mountLang, openFeed, type ReadFailPlain, type UiFailure } from "../../src/ui-client/api.js";
import { bootLine, canRetryInPlace, failLine, isPlace, labelOf, latest, needsPage, retryLine, triggers } from "../../src/ui-client/view.js";

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
      if (spec === "../ui-server/boot-text.js") continue;
      expect(typeOnly || everyNameTyped, `${file}: ${spec} ввозится значимо`).toBe(true);
    }
  }
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
    "state.no_session": "вход истёк",
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
  const boot = { "state.offline": "нет связи", "state.broken": "сбой", "state.no_session": "вход истёк", "action.retry": "повторить" };
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
