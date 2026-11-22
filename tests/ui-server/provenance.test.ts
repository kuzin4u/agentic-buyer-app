// Признак «кто нажал» (ИН-0, кирпич К5; **П26** с дополнением 2, решение владельца 20.11.2026 — Р-1648).
//
// Тест живёт там же, где провайдер правила, — у сервера `/ui/v1`: так требует и сама строка контракта («носитель
// ограничения… у `/ui` его пока нет»). Проверяется не наличие поля, а три запрета:
// вне режима нельзя пометить подпись не человеком; в режиме нельзя **не** пометить; из тела запроса признак не
// берётся ни в каком режиме.
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { IDEMPOTENCY_HEADER, UI_SIGNED_BY, type UiSignedBy } from "../../src/contract/ui-v1/index.js";
import { claimsSignedBy, createProvenance, createUiHandler, faultsFromEnv, RepeatStore, Sessions, startUiServer, type CorePurchase, type ShellData, type UiCorePort } from "../../src/ui-server/index.js";

const core: UiCorePort = { purchase: async () => null as CorePurchase | null, subscribe: () => () => undefined };

// ── Правило: признак ставит сервер ──────────────────────────────────────────────────────────────────────────────────

test("вне режима прогона сервер ставит human — и другого значения там быть не может", () => {
  expect(createProvenance({ faults: false })()).toBe("human");
  // Провайдер вне режима — ошибка сборки: это была бы попытка пометить подпись не человеком там, где прогона нет.
  expect(() => createProvenance({ faults: false, by: () => "test" })).toThrow(TypeError);
});

test("в режиме прогона признак обязателен: умолчания нет", () => {
  // Умолчание «подставим human» записало бы прогон человеком, и в акте появилось бы ложное «да» (расхождение № 15).
  expect(() => createProvenance({ faults: true })).toThrow(TypeError);
});

test("в режиме прогона принимается любое значение закрытого перечня контракта", () => {
  for (const by of UI_SIGNED_BY) {
    expect(createProvenance({ faults: true, by: () => by })()).toBe(by);
  }
  // Перечень берётся у контракта (`UI_SIGNED_BY`, кирпич К0а окна А) — своего у сервера нет.
  expect([...UI_SIGNED_BY]).toEqual(["human", "emulator", "test"]);
});

test("негодное значение провайдера — исключение, а не human", () => {
  const bad = createProvenance({ faults: true, by: () => "прогон" as unknown as UiSignedBy });
  // Опечатка в сборке стенда не должна превращать прогон в человека.
  expect(() => bad()).toThrow(TypeError);
});

test("негодная настройка не доживает до запроса: обработчик не собирается", () => {
  expect(() => createUiHandler({ core, owner: () => "own_1", provenance: { faults: true } })).toThrow(TypeError);
  expect(() => createUiHandler({ core, owner: () => "own_1", provenance: { faults: false, by: () => "test" } })).toThrow(TypeError);
  // Обычная сборка (режима нет) поднимается молча.
  expect(() => createUiHandler({ core, owner: () => "own_1" })).not.toThrow();
});

test("режим прогона — это переменная DEMO_FAULTS=1, а не поле в сборке (находка ревью К5 № 5)", () => {
  // Пока режим был просто полем, разрешение на `emulator` и `test` держалось на добросовестности точки сборки: можно
  // было поднять сервер «в режиме» без всякого режима и пометить подпись прогоном.
  expect(faultsFromEnv({ DEMO_FAULTS: "1" })).toBe(true);
  // Форма разбора — та же, что у демо-стенда (`envFlag`): включено только «1», без догадок.
  for (const value of ["true", "0", "", "yes", undefined]) expect(faultsFromEnv({ DEMO_FAULTS: value })).toBe(false);
  expect(faultsFromEnv({})).toBe(false);
  const standForm = readFileSync("src/demo/flags.ts", "utf8");
  expect(standForm).toContain('v === "1"');
});

test("без переменной окружения признак не принимается, даже если его передали", () => {
  // Это и есть привязка: `faults` по умолчанию читается из окружения, и в обычном прогоне (переменной нет) провайдер
  // признака — ошибка сборки.
  const was = process.env["DEMO_FAULTS"];
  delete process.env["DEMO_FAULTS"];
  try {
    expect(() => createProvenance({ by: () => "test" })).toThrow(TypeError);
    expect(createProvenance({})()).toBe("human");
    process.env["DEMO_FAULTS"] = "1";
    // С переменной — обязателен, и принимается.
    expect(() => createProvenance({})).toThrow(TypeError);
    expect(createProvenance({ by: () => "test" })()).toBe("test");
  } finally {
    if (was === undefined) delete process.env["DEMO_FAULTS"];
    else process.env["DEMO_FAULTS"] = was;
  }
});

// ── Правило: из тела запроса признак не берётся ─────────────────────────────────────────────────────────────────────

test.each([
  { как: "на первом уровне", body: { by: "human" } },
  { как: "внутри провенанса нажатия", body: { press: { at: "t", device: "mobile", text_version: "v", gesture: "tap", by: "human" } } },
  { как: "глубже в объекте", body: { a: { b: { c: { by: "test" } } } } },
  { как: "в элементе перечня", body: { items: [{ code: "PRICE" }, { by: "emulator" }] } },
  { как: "со значением null", body: { by: null } },
  {
    как: "глубже прежнего предела в шесть уровней",
    // Предел глубины снят (находка ревью К5 № 6): он обещал «где угодно», а на седьмом уровне поле проходило.
    // Структуры, ссылающейся на себя, у `JSON.parse` не бывает, поэтому предел ничего не защищал.
    body: JSON.parse(`${"{\"a\":".repeat(12)}{"by":"test"}${"}".repeat(12)}`) as unknown,
  },
])("тело с полем by отклоняется: $как", ({ body }) => {
  // Поле `by` не бывает законным ни у одного метода `/ui/v1`: в ответах признак приходит в `signed.by`, и ставит его
  // сервер. Поэтому проверяется имя, а не место, — иначе хватило бы завернуть поле в лишний объект.
  expect(claimsSignedBy(body)).toBe(true);
});

test.each([
  { как: "тело без провенанса", body: { phrase: "кофе" } },
  { как: "провенанс без признака", body: { press: { at: "t", device: "mobile", text_version: "v", gesture: "tap" } } },
  { как: "похожее имя поля", body: { by_whom: "human", nearby: { byte: 1 } } },
  { как: "пустое тело", body: null },
  { как: "перечень без признака", body: [{ code: "PRICE" }, { code: "NEAR" }] },
])("законное тело проходит: $как", ({ body }) => {
  expect(claimsSignedBy(body)).toBe(false);
});

test("POST с полем by — 400, и в память повторов такое тело не попадает", async () => {
  const repeats = new RepeatStore();
  const sessions = new Sessions();
  const s = await startUiServer({
    core,
    owner: (req) => sessions.ownerOf(req),
    repeats,
    shell: { brandPath: "config/brand.demo.json", sessions, ownerOnPage: () => "own_1" },
  });
  try {
    const cookie = (await fetch(`${s.url}/ui`)).headers.get("set-cookie")!.split(";")[0]!;
    const key = randomUUID();
    const res = await fetch(`${s.url}/ui/v1/anything`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json", [IDEMPOTENCY_HEADER]: key },
      body: JSON.stringify({ press: { at: "t", device: "mobile", text_version: "v", gesture: "tap", by: "human" } }),
    });
    expect(res.status).toBe(400);
    /**
     * **Ожидание исправлено кирпичом К4 ИН-П1** (находка ревью К4 № 2). Прежде здесь стояло `repeats.size === 0` с
     * доводом «отклонённое тело не запоминается как ответ на ключ, иначе повтор экрана получил бы отказ вместо
     * действия». Довод неверен и противоречит правилу 2 (Р-1633, Р-1635): ключ занимает **любой** окончательный
     * ответ, кроме `IDEMPOTENCY_REQUIRED`. Иначе тот же ключ с исправленным телом выполняет действие **со второй
     * попытки** — это и есть то, что правило 2 запрещает; исправленное тело идёт новым ключом.
     */
    expect(repeats.size).toBe(1);
    /**
     * **Ожидание исправлено кирпичом К4 ИН-П2** (требование владельца 3 к К4). Прежде тот же ключ с телом, которое
     * отличается **только внутри `press`**, давал `IDEMPOTENCY_CONFLICT` — потому что отпечаток считался по всему
     * телу, вместе с провенансом. Правило 2 К-Б v1.5 говорит обратное дословно: «провенанс нажатия `press` в
     * отпечаток **не входит**» — иначе законный повтор (обрыв связи, второе нажатие) упирался бы в конфликт. Значит
     * два таких тела — **одно действие**, и второе получает прежний ответ, а не конфликт. Исправленное тело идёт
     * **новым** ключом, как и требует правило 2.
     */
    const again = await fetch(`${s.url}/ui/v1/anything`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json", [IDEMPOTENCY_HEADER]: key },
      body: JSON.stringify({ press: { at: "t", device: "mobile", text_version: "v", gesture: "tap" } }),
    });
    expect(again.status).toBe(400);
    // А тело, отличающееся **полем действия**, — по-прежнему конфликт: отпечаток обязан меняться от любого поля,
    // кроме провенанса, иначе два разных действия получили бы один ответ.
    const other = await fetch(`${s.url}/ui/v1/anything`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json", [IDEMPOTENCY_HEADER]: key },
      body: JSON.stringify({ shown_hash: `sha256:${"a".repeat(64)}`, press: { at: "t", device: "mobile", text_version: "v", gesture: "tap" } }),
    });
    expect(other.status).toBe(409);
    expect(((await other.json()) as { error: { code: string } }).error.code).toBe("IDEMPOTENCY_CONFLICT");
    // Повтор **того же** негодного тела тем же ключом отдаёт тот же отказ, второго разбора нет.
    const replay = await fetch(`${s.url}/ui/v1/anything`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json", [IDEMPOTENCY_HEADER]: key },
      body: JSON.stringify({ press: { at: "t", device: "mobile", text_version: "v", gesture: "tap", by: "human" } }),
    });
    expect(replay.status).toBe(400);
    expect(repeats.size).toBe(1);
  } finally {
    await s.close();
  }
});

// ── Признак виден человеку, а не только в журнале ───────────────────────────────────────────────────────────────────

const shellOf = async (provenance?: { faults: boolean; by?: () => UiSignedBy }): Promise<ShellData> => {
  const sessions = new Sessions();
  const s = await startUiServer({
    core,
    owner: (req) => sessions.ownerOf(req),
    ...(provenance === undefined ? {} : { provenance }),
    shell: { brandPath: "config/brand.demo.json", sessions, ownerOnPage: () => "own_1" },
  });
  try {
    const cookie = (await fetch(`${s.url}/ui`)).headers.get("set-cookie")!.split(";")[0]!;
    return (await (await fetch(`${s.url}/ui/shell`, { headers: { cookie } })).json()) as ShellData;
  } finally {
    await s.close();
  }
};

test("словарь каркаса несёт признак «кто нажал» — его ставит сервер, не экран", async () => {
  expect((await shellOf()).signed_by).toBe("human");
  expect((await shellOf({ faults: true, by: () => "test" })).signed_by).toBe("test");
  expect((await shellOf({ faults: true, by: () => "emulator" })).signed_by).toBe("emulator");
});
