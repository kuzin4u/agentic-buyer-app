// Раздача каркаса и словарь `GET /ui/shell` (ИН-0, кирпич К4; кирпичи К3, К3а, К3б, К3в).
//
// Главное здесь — не разметка, а два правила: экран не получает ничего, что сам должен был бы вывести (правило 3), и
// ни одна строка человеку не живёт без пары ru/en (правило планов № 3). Плюс закрытые перечни сверяются **с
// источником**, а не с копией в тесте (Р-1511).
import { PURCHASE_STATES } from "agentic-buyer-ref/src/agent/pipeline/machine.js";
import { afterEach, beforeEach, expect, test } from "vitest";
import { STEP_OF_STATE, UI_STEPS, type UiLang } from "../../src/contract/ui-v1/index.js";
import { PARTIES, PARTY_LABEL } from "../../src/pult/rules89.js";
import {
  BOOT_KEYS,
  bootAttr,
  bootDatasetKey,
  DONE_TEXT,
  LANG_NAME,
  page as uiPage,
  purchaseResponse,
  Sessions,
  SHELL_PLACES,
  SHELL_TEXT,
  shellData,
  startUiServer,
  UI_LANGS,
  UI_TEXT,
  type CorePurchase,
  type ShellData,
  type UiCorePort,
  type UiServer,
} from "../../src/ui-server/index.js";

const corePurchase = (state: CorePurchase["state"], stoppable: boolean): CorePurchase =>
  ({
    purchase_id: "pur_71",
    state,
    intent: {
      mandate_id: "mnd_14",
      status: "ACTIVE",
      amount_left: { amount: 632000, currency: "RUB" },
      valid_to: "2026-12-01T00:00:00Z",
      as_of: "2026-11-20T10:00:00Z",
      revocation_id: null,
    },
    stops: [],
    stoppable,
  }) as unknown as CorePurchase;

const core: UiCorePort = {
  purchase: async (id, owner) => (id === "pur_71" && owner === "own_1" ? corePurchase("OFFERS", true) : null),
  subscribe: () => () => undefined,
};

let server: UiServer;
let sessions: Sessions;

beforeEach(async () => {
  sessions = new Sessions();
  server = await startUiServer({
    core,
    owner: (req) => sessions.ownerOf(req),
    shell: { brandPath: "config/brand.demo.json", sessions, ownerOnPage: () => "own_1" },
  });
});

afterEach(async () => {
  await server.close();
});

const page = (query = ""): Promise<Response> => fetch(`${server.url}/ui${query}`);
const cookieOf = async (): Promise<string> => (await page()).headers.get("set-cookie")!.split(";")[0]!;

// ── Страница ────────────────────────────────────────────────────────────────────────────────────────────────────────

test("страница: нет inline-скрипта и inline-стиля, код и стили — файлами (CSP 'self')", async () => {
  const html = await (await page("?lang=en")).text();
  expect(html).toContain('<link rel="stylesheet" href="/ui.css">');
  expect(html).toContain('<link rel="stylesheet" href="/brand.css">');
  expect(html).toContain('<script type="module" src="/ui.js"></script>');
  // Ни одного `<style>`, ни одного `<script>` с телом, ни одного `on*=`, ни одного `data:`-ресурса.
  expect(html).not.toMatch(/<style[\s>]/);
  expect(html).not.toMatch(/<script(?![^>]*\ssrc=)/);
  expect(html).not.toMatch(/\son\w+=/);
  expect(html).not.toContain("data:");
});

test("страница: язык выбирает сервер и объявляет его разметкой", async () => {
  expect(await (await page("?lang=en")).text()).toContain('<div id="app" data-lang="en"');
  expect(await (await page("?lang=robot")).text()).toContain('data-lang="ru"');
  expect(await (await page("?lang=en")).text()).toContain('<html lang="en">');
});

test("страница: мобильная раскладка объявлена (Р-1601)", async () => {
  const html = await (await page()).text();
  expect(html).toContain('name="viewport" content="width=device-width, initial-scale=1"');
});

test("страница отдаёт все строки загрузки из BOOT_KEYS, и клиент читает ровно их", async () => {
  const html = await (await page("?lang=ru")).text();
  for (const key of BOOT_KEYS) {
    expect(html).toContain(`${bootAttr(key)}="`);
    // Имя в `dataset` выводится из имени атрибута, второй таблицы имён нет (находка ревью К3а № 4).
    expect(bootAttr(key)).toBe(`data-${bootDatasetKey(key).replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`);
    expect(html).toContain(SHELL_TEXT[key].ru);
  }
});

test("бренд в разметке — из конфигурации, и подставляется экранированным", async () => {
  const html = await (await page()).text();
  const { brand } = await import("../../src/ui-server/shell.js").then((m) => m.loadShellBrand("config/brand.demo.json"));
  expect(html).toContain(`<title>${brand.name} — `);
  // Экранирование проверяется на враждебном названии, а не обещается названием теста (находка ревью К4 № 11):
  // название банка приходит из конфигурации, то есть из данных, и в разметку идёт как текст (инвариант 4).
  const hostile = { name: '<script>alert(1)</script> & "Банк"', colors: brand.colors, logo: brand.logo };
  const made = uiPage("ru", hostile);
  expect(made).not.toContain("<script>alert(1)</script>");
  expect(made).toContain("&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;Банк&quot;");
  // И ни одного исполняемого куска на странице от этого не появилось.
  expect(made).not.toMatch(/<script(?![^>]*\ssrc=)/);
});

// ── Сессия при раздаче ──────────────────────────────────────────────────────────────────────────────────────────────

test("страница выдаёт сессию, а своя живая сессия переиспользуется", async () => {
  const first = await page();
  expect(first.headers.get("set-cookie")).toContain("HttpOnly");
  expect(sessions.size).toBe(1);
  const cookie = first.headers.get("set-cookie")!.split(";")[0]!;
  const again = await fetch(`${server.url}/ui`, { headers: { cookie } });
  // Иначе каждая перезагрузка и каждое переключение языка плодили бы записи, а на пределе вытеснялась бы живая
  // сессия **другого** человека (находка ревью К3 № 3).
  expect(again.headers.get("set-cookie")).toBeNull();
  expect(sessions.size).toBe(1);
});

test("чужая или негодная cookie — выдаётся новая сессия, а не переиспользуется", async () => {
  await page();
  // Опознаватель — ASCII: заголовок `Cookie` байтовый, и небайтовое значение до сервера не доедет вовсе.
  const other = await fetch(`${server.url}/ui`, { headers: { cookie: "ui_session=sid_other" } });
  expect(other.headers.get("set-cookie")).toContain("ui_session=");
  expect(sessions.size).toBe(2);
});

test("страницу некому отдать — 403, и сессия не выпускается", async () => {
  const closed = await startUiServer({
    core,
    owner: () => null,
    shell: { brandPath: "config/brand.demo.json", sessions: new Sessions(), ownerOnPage: () => null },
  });
  try {
    expect((await fetch(`${closed.url}/ui`)).status).toBe(403);
  } finally {
    await closed.close();
  }
});

test("словарь, бренд и логотип — только с сессией", async () => {
  for (const path of ["/ui/shell", "/brand.css", "/brand/logo"]) {
    expect((await fetch(`${server.url}${path}`)).status).toBe(403);
  }
  const cookie = await cookieOf();
  for (const path of ["/ui/shell", "/brand.css", "/brand/logo"]) {
    expect((await fetch(`${server.url}${path}`, { headers: { cookie } })).status).toBe(200);
  }
});

test("код и стили каркаса отдаются файлами, неизвестный адрес раздачи — 404, а не словарь", async () => {
  const cookie = await cookieOf();
  const js = await fetch(`${server.url}/ui.js`);
  expect(js.status).toBe(200);
  expect(js.headers.get("content-type")).toContain("javascript");
  expect((await fetch(`${server.url}/ui.css`)).status).toBe(200);
  const unknown = await fetch(`${server.url}/ui/unknown`, { headers: { cookie } });
  expect(unknown.status).toBe(404);
  expect(unknown.headers.get("content-type")).toContain("text/plain");
});

test("раздача не перехватывает адреса контракта", async () => {
  const cookie = await cookieOf();
  // Даже если в раздаче появится новый маршрут, он пробуется только для адресов вне `/ui/v1`.
  const contract = await fetch(`${server.url}/ui/v1/purchase/pur_71`, { headers: { cookie } });
  expect(contract.headers.get("content-type")).toContain("application/json");
  expect(contract.status).toBe(200);
});

test("заголовки безопасности — те же, что у /ui/v1, на каждом ответе раздачи", async () => {
  const cookie = await cookieOf();
  for (const path of ["/ui", "/ui.js", "/ui.css", "/brand.css", "/ui/shell"]) {
    const res = await fetch(`${server.url}${path}`, { headers: { cookie } });
    expect(res.headers.get("content-security-policy")).toContain("default-src 'self'");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("cache-control")).toBe("no-store");
  }
});

// ── Словарь каркаса ─────────────────────────────────────────────────────────────────────────────────────────────────

const shellOf = async (lang: UiLang): Promise<ShellData> => {
  const cookie = await cookieOf();
  return (await (await fetch(`${server.url}/ui/shell?lang=${lang}`, { headers: { cookie } })).json()) as ShellData;
};

test("перечень шагов — из UI_STEPS контракта, подписи — из словаря, и каждая своя", async () => {
  for (const lang of UI_LANGS) {
    const data = await shellOf(lang);
    expect(data.steps.map((s) => s.id)).toEqual([...UI_STEPS]);
    // Подпись сверяется **со словарём по своему ключу**: «не пусто» пропускало перепутанные между собой подписи,
    // например U3 на месте U4 (находка ревью К4 № 6).
    for (const s of data.steps) expect(s.label).toBe(SHELL_TEXT[`step.${s.id}`][lang]);
    for (const p of data.places) expect(p.label).toBe(SHELL_TEXT[`place.${p.id}`][lang]);
    // Ни одна подпись не повторяется: две одинаковые в навигации неразличимы для человека.
    const labels = [...data.steps, ...data.places].map((x) => x.label);
    expect(new Set(labels).size).toBe(labels.length);
  }
  // У перечня мест внешнего источника **нет**: У8–У10 это разделы приложения, в `UiStep` контракта их не бывает.
  // Поэтому сверять его не с чем, кроме самого объявления, и это названо прямо, а не выдано за сверку с источником
  // (находка ревью К4 № 6).
  expect((await shellOf("ru")).places.map((p) => p.id)).toEqual([...SHELL_PLACES]);
  expect(SHELL_PLACES.every((p) => !(UI_STEPS as readonly string[]).includes(p))).toBe(true);
});

test("подписи ролей равны PARTY_LABEL на оба языка (поле parties не разъезжается молча)", async () => {
  // Поле отдаётся **для будущих экранов** и ни на одном экране К3 не показывается; без этой сверки словарь разошёлся
  // бы с пультом до того, как подпись впервые появится на экране (находка ревью К3 № 5).
  for (const lang of UI_LANGS) {
    const data = await shellOf(lang);
    expect(Object.keys(data.parties).sort()).toEqual([...PARTIES].sort());
    for (const p of PARTIES) expect(data.parties[p]).toBe(PARTY_LABEL[p][lang]);
  }
});

test("название другого языка — на нём самом, и оба языка названы", async () => {
  expect((await shellOf("ru")).other_name).toBe(LANG_NAME.en);
  expect((await shellOf("en")).other_name).toBe(LANG_NAME.ru);
  for (const lang of UI_LANGS) expect(LANG_NAME[lang].length).toBeGreaterThan(0);
});

test("все тексты обоих словарей есть парами ru и en — одинаково строго", () => {
  // Один цикл на оба словаря: у `UI_TEXT` проверка была слабее — только «не пусто», — и русская строка, забытая в
  // поле `en`, проходила (находка ревью К4 № 8).
  for (const [name, dict] of [
    ["SHELL_TEXT", SHELL_TEXT as Readonly<Record<string, { ru: string; en: string }>>],
    ["UI_TEXT", UI_TEXT as Readonly<Record<string, { ru: string; en: string }>>],
  ] as const) {
    for (const [key, phrase] of Object.entries(dict)) {
      for (const lang of UI_LANGS) {
        expect(phrase[lang], `${name}.${key}.${lang}`).toBeTruthy();
        expect(phrase[lang].trim(), `${name}.${key}.${lang}`).toBe(phrase[lang]);
      }
      // Одинаковые строки на двух языках — признак забытого перевода.
      expect(phrase.ru, `${name}.${key}`).not.toBe(phrase.en);
      // Кириллица в английской строке — тот же забытый перевод, только незаметный глазами.
      expect(phrase.en, `${name}.${key}`).not.toMatch(/[А-Яа-яЁё]/);
    }
  }
});

test("словарь каркаса отдаётся на языке запроса целиком", async () => {
  const ru = await shellOf("ru");
  const en = await shellOf("en");
  for (const key of Object.keys(SHELL_TEXT) as (keyof typeof SHELL_TEXT)[]) {
    expect(ru.text[key]).toBe(SHELL_TEXT[key].ru);
    expect(en.text[key]).toBe(SHELL_TEXT[key].en);
  }
  // Перечень классов повтора берётся **из кода ядра** (`FAILURE_RULES`), а не вписывается копией в тест (Р-1511,
  // находка ревью К4 № 7): появится у ядра новый класс — покраснеет здесь, а не промолчит. `new_key` экрану не
  // отдаётся (§ 3), поэтому он из перечня исключён.
  const { FAILURE_RULES } = await import("agentic-buyer-ref/src/agent/declines/table.js");
  const theirs = new Set(Object.values(FAILURE_RULES).map((r) => (r.retry === "new_key" ? "same_key" : r.retry)));
  for (const cls of theirs) expect(Object.keys(ru.retry), cls).toContain(cls);
  for (const cls of Object.keys(ru.retry)) expect([...theirs, "after_fix"], cls).toContain(cls);
});

test("в словаре каркаса нет ни сумм, ни состояний, ни шагов покупки — экран их не выводит", async () => {
  const data = await shellOf("ru");
  const json = JSON.stringify(data);
  // Если бы сюда попали состояния ядра или таблица шагов, экран смог бы вывести шаг сам — против правила 3.
  for (const state of PURCHASE_STATES) expect(json).not.toContain(`"${state}"`);
  expect(json).not.toContain("amount");
  expect(json).not.toContain("STEP_OF_STATE");
});

// ── § 5.3: строка «что сделано» и доступность действия ──────────────────────────────────────────────────────────────

test("строка «что сделано» есть у каждого состояния ядра (перечень — из кода источника)", () => {
  // Появится у ядра новое состояние — тест покраснеет здесь, а строка не выйдет `undefined` (Р-1511).
  expect(Object.keys(DONE_TEXT).sort()).toEqual([...PURCHASE_STATES].sort());
  for (const state of PURCHASE_STATES) for (const lang of UI_LANGS) expect(DONE_TEXT[state][lang]).toBeTruthy();
});

test("шаг экрана — по таблице КТ-0, включая развилку Р-1641", () => {
  expect(STEP_OF_STATE.CART_PENDING).toBe("U4");
  expect(STEP_OF_STATE.CART_ACTIVE).toBe("U5");
  // Ни один шаг контракта не остаётся недостижимым: мёртвый шаг — это дефект таблицы, а не особенность.
  const reached = new Set(PURCHASE_STATES.map((s) => STEP_OF_STATE[s]));
  expect([...UI_STEPS].filter((s) => !reached.has(s))).toEqual([]);
});

test("доступность «Стопа» объявляет сервер: решение ядра только сужается", () => {
  // В ИН-0 метода остановки нет, поэтому `enabled` ложно и при разрешении ядра — но причина у двух случаев разная.
  const allowed = purchaseResponse(corePurchase("OFFERS", true), "ru");
  const denied = purchaseResponse(corePurchase("DONE", false), "ru");
  expect(allowed.actions.stop.enabled).toBe(false);
  expect(denied.actions.stop.enabled).toBe(false);
  expect(allowed.actions.stop.why_disabled).toBe(UI_TEXT["action.stop.not_yet"].ru);
  expect(denied.actions.stop.why_disabled).toBe(UI_TEXT["action.stop.why_disabled"].ru);
  // Экран ничего не считает: подпись кнопки тоже приходит с сервера.
  expect(allowed.actions.stop.label).toBe(UI_TEXT["action.stop"].ru);
});

test("включится метод — кнопка не останется мёртвой: признак и обработчик меняются вместе", async () => {
  // Задел на день включения метода (находка ревью К3б № 9): пока `STOP_METHOD_READY` ложно, у кнопки нет обработчика,
  // и это согласовано. Станет истинным — упадёт этот тест, а не поведение у человека.
  const source = await import("node:fs").then((fs) => fs.readFileSync("src/ui-server/purchase.ts", "utf8"));
  const ready = /STOP_METHOD_READY\s*=\s*(true|false)/.exec(source)![1];
  // Разметка **без комментариев** и только внутри узла кнопки: слово `onclick` в объяснении рядом меняло ответ
  // теста, не меняя поведения (находка ревью К4 № 10).
  const markup = (await import("node:fs"))
    .readFileSync("src/ui-client/App.svelte", "utf8")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ");
  const stopButton = /<button[^>]*>\s*\{purchase\.actions\.stop\.label\}/.exec(markup);
  expect(stopButton, "кнопка «Стоп» в разметке не найдена").not.toBeNull();
  const hasHandler = /\bonclick=/.test(stopButton![0]);
  expect(ready === "true" ? hasHandler : !hasHandler).toBe(true);
});

test("ответ § 5.3 не несёт реквизитов и собирается без арифметики над суммой", () => {
  const out = purchaseResponse(corePurchase("OFFERS", true), "ru");
  const json = JSON.stringify(out).toLowerCase();
  for (const forbidden of ["pan", "card_number", "cvv", "expiry", "kid", "cryptogram"]) expect(json).not.toContain(forbidden);
  // Формат суммы и обе его ошибки закрыты точными строками в `money.test.ts` (находка ревью К4 № 2): здесь — только
  // то, что величина дошла до ответа неизменной.
  expect(out.intent.amount_left).toEqual({ amount: 632000, currency: "RUB" });
});

test("данные словаря собираются одной функцией — без обращения к сети и к стенду", () => {
  // `shellData` вызывается напрямую: если бы в раздачу просочился стенд или адаптер ПАО, здесь была бы попытка связи.
  const brandLike = { name: "Б", colors: { primary: "#000000", onPrimary: "#FFFFFF", accent: "#123456" }, logo: "нет" };
  // Признак «кто нажал» передаётся **явно**: умолчания у него нет, иначе вызов, забывший аргумент, молча показал бы
  // человека там, где подписывает прогон (находка ревью К5 № 2).
  const data = shellData("en", brandLike, false, "human");
  expect(data.brand.name).toBe("Б");
  expect(data.brand.logo).toBeNull();
  expect(data.lang).toBe("en");
  expect(data.other).toBe("ru");
  expect(data.signed_by).toBe("human");
});
