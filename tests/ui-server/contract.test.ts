// Сервер `/ui/v1` — общий слой (ИН-0, кирпич К4; контракт К-Б § 3, § 5.3, § 6, правила 2 и 4).
//
// Проверяется **ответ на запросе**, а не внутренности: тело ошибки одной формы, правило 2 на каждом POST, один
// `PURCHASE_NOT_FOUND` на чужую, неизвестную и не по форме покупку, язык по `?lang=`, класс повтора кода ядра — из
// таблицы ядра. Плюс два случая, которые валили процесс до ревью К2 (`%E0` в адресе и `1e999` в теле): после них
// сервер обязан **жить** — в одном процессе с ним монитор, пульт и стенд (П4 п. 4).
import { randomUUID } from "node:crypto";
import { ruleForFailure } from "agentic-buyer-ref/src/agent/declines/table.js";
import { afterEach, beforeEach, expect, test } from "vitest";
import { IDEMPOTENCY_HEADER, STEP_OF_STATE, UI_ERROR_STATUS } from "../../src/contract/ui-v1/index.js";
import { RepeatStore, Sessions, startUiServer, type CorePurchase, type UiCorePort, type UiServer } from "../../src/ui-server/index.js";

/** Покупка стенда: поля ровно те, из которых собирается § 5.3. Значения **разные у разных сущностей** (решение
 *  владельца 16.11): опознаватель покупки, поручения и отзыва не совпадают, иначе подмена поля не ловится. */
const purchaseOf = (owner: string, state: CorePurchase["state"] = "OFFERS"): CorePurchase =>
  ({
    purchase_id: owner === "own_1" ? "pur_71" : "pur_92",
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
    stoppable: true,
  }) as unknown as CorePurchase;

let server: UiServer;
let sessions: Sessions;
let jar: string;

const core: UiCorePort = {
  // Покупка `pur_71` — только своя для `own_1`; `pur_92` принадлежит другому. Ядро различает, сервер — нет.
  purchase: async (id, owner) => (id === "pur_71" && owner === "own_1" ? purchaseOf(owner) : null),
  subscribe: () => () => undefined,
};

beforeEach(async () => {
  sessions = new Sessions();
  server = await startUiServer({
    core,
    owner: (req) => sessions.ownerOf(req),
    shell: { brandPath: "config/brand.demo.json", sessions, ownerOnPage: () => "own_1" },
  });
  const page = await fetch(`${server.url}/ui`);
  jar = page.headers.get("set-cookie")!.split(";")[0]!;
});

afterEach(async () => {
  await server.close();
});

const get = (path: string, cookie = jar): Promise<Response> => fetch(`${server.url}${path}`, { headers: { cookie } });

const post = (path: string, body: unknown, key?: string, cookie = jar): Promise<Response> =>
  fetch(`${server.url}${path}`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json", ...(key === undefined ? {} : { [IDEMPOTENCY_HEADER]: key }) },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

// ── Правило 2: ключ повтора у каждого POST ──────────────────────────────────────────────────────────────────────────

test("правило 2: POST без ключа повтора — 400 IDEMPOTENCY_REQUIRED, и ответ по форме § 3", async () => {
  const res = await post("/ui/v1/anything", { a: 1 });
  expect(res.status).toBe(UI_ERROR_STATUS.IDEMPOTENCY_REQUIRED);
  const body = (await res.json()) as { error: { code: string; retry: string; text: string; view: unknown } };
  expect(body.error.code).toBe("IDEMPOTENCY_REQUIRED");
  expect(body.error.retry).toBe("after_fix");
  expect(body.error.text.length).toBeGreaterThan(0);
  expect(body.error.view).toBeNull();
  // Ровно одно поле `error` и ровно четыре поля внутри: лишнего в теле ошибки нет (§ 3).
  expect(Object.keys(body)).toEqual(["error"]);
  expect(Object.keys(body.error).sort()).toEqual(["code", "retry", "text", "view"]);
});

test("правило 2: тот же ключ с другим телом — 409 IDEMPOTENCY_CONFLICT, второго действия нет", async () => {
  const key = randomUUID();
  await post("/ui/v1/anything", { a: 1 }, key);
  const res = await post("/ui/v1/anything", { a: 2 }, key);
  expect(res.status).toBe(UI_ERROR_STATUS.IDEMPOTENCY_CONFLICT);
  expect(((await res.json()) as { error: { code: string } }).error.code).toBe("IDEMPOTENCY_CONFLICT");
});

test("правило 2: тот же ключ и то же тело — тот же ответ, как после обрыва связи", async () => {
  const key = randomUUID();
  const first = await post("/ui/v1/anything", { a: 1 }, key);
  const firstText = await first.text();
  // «Повтор после обрыва»: экран не знает, дошёл ли первый запрос, и посылает тот же ключ с тем же телом.
  const again = await post("/ui/v1/anything", { a: 1 }, key);
  expect(again.status).toBe(first.status);
  expect(await again.text()).toBe(firstText);
});

test("правило 2: тот же ключ на другом адресе — не повтор", async () => {
  const key = randomUUID();
  await post("/ui/v1/one", { a: 1 }, key);
  const other = await post("/ui/v1/two", { a: 1 }, key);
  // Отпечаток повтора включает адрес: иначе второе действие под тем же ключом молча не выполнилось бы.
  expect(other.status).toBe(UI_ERROR_STATUS.IDEMPOTENCY_CONFLICT);
});

test("правило 2: POST без сессии не пишет в память повторов", async () => {
  // Проверяется **память**, а не ответ: без сессии и на неизвестном адресе ответ один и тот же (404), поэтому
  // сравнение ответов здесь ничего не держит — тест оставался бы зелёным при сломанном коде (находка ревью К4 № 1).
  const repeats = new RepeatStore();
  const own = new Sessions();
  const s = await startUiServer({
    core,
    owner: (req) => own.ownerOf(req),
    repeats,
    shell: { brandPath: "config/brand.demo.json", sessions: own, ownerOnPage: () => "own_1" },
  });
  try {
    const cookie = (await fetch(`${s.url}/ui`)).headers.get("set-cookie")!.split(";")[0]!;
    const key = randomUUID();
    const send = (c: string): Promise<Response> =>
      fetch(`${s.url}/ui/v1/anything`, {
        method: "POST",
        headers: { cookie: c, "content-type": "application/json", [IDEMPOTENCY_HEADER]: key },
        body: JSON.stringify({ a: 1 }),
      });
    expect((await send("")).status).toBe(UI_ERROR_STATUS.PURCHASE_NOT_FOUND);
    expect(repeats.size).toBe(0);
    expect((await send(cookie)).status).toBe(404);
    expect(repeats.size).toBe(1);
  } finally {
    await s.close();
  }
});

// ── § 6: один ответ на чужую, неизвестную и не по форме покупку ─────────────────────────────────────────────────────

test("PURCHASE_NOT_FOUND одним ответом: чужая, неизвестная и не по форме покупка неразличимы", async () => {
  const bodies = await Promise.all(
    ["/ui/v1/purchase/pur_92", "/ui/v1/purchase/pur_000", "/ui/v1/purchase/%E0", "/ui/v1/purchase/a%2Fb", "/ui/v1/purchase/пусто"].map(async (p) => {
      const res = await get(p);
      return { status: res.status, body: await res.text() };
    }),
  );
  const first = bodies[0]!;
  expect(first.status).toBe(UI_ERROR_STATUS.PURCHASE_NOT_FOUND);
  for (const b of bodies) {
    expect(b.status).toBe(first.status);
    expect(b.body).toBe(first.body);
  }
});

test("адрес, перестающий быть адресом покупки, — это 404 адреса, а не ответ о покупке", async () => {
  // `/ui/v1/purchase/..` клиент приводит к `/ui/v1/`: запрос до разбора опознавателя уже не доходит, и ответ про
  // адрес ничего о покупке не сообщает. Случай назван отдельно, чтобы «одинаковый ответ» § 6 не читался шире, чем он
  // есть: правило § 6 про **опознаватель** покупки, а не про любой адрес под `/ui/v1`.
  const up = await get("/ui/v1/purchase/..");
  expect(up.status).toBe(404);
  expect(up.headers.get("content-type")).toContain("text/plain");
});

test("без сессии маршрут контракта не отличается от неизвестной покупки", async () => {
  const mine = await get("/ui/v1/purchase/pur_000");
  const none = await get("/ui/v1/purchase/pur_71", "");
  expect(none.status).toBe(mine.status);
  expect(await none.text()).toBe(await mine.text());
});

test("своя покупка: ответ § 5.3 с шагом из STEP_OF_STATE и без реквизитов", async () => {
  const res = await get("/ui/v1/purchase/pur_71");
  expect(res.status).toBe(200);
  const body = (await res.json()) as Record<string, unknown> & { state: keyof typeof STEP_OF_STATE; step: string };
  expect(body.step).toBe(STEP_OF_STATE[body.state]);
  // Инвариант 1: ни одного имени платёжного реквизита в ответе — проверка по именам полей, как К2.4 КТ-0.
  const names = JSON.stringify(body).toLowerCase();
  for (const forbidden of ["pan", "card_number", "cardnumber", "cvv", "cvc", "expiry", "exp_month", "kid", "cryptogram", "token_secret"])
    expect(names).not.toContain(forbidden);
});

// ── Негодный запрос: ответ, а не падение процесса ───────────────────────────────────────────────────────────────────

test("негодный адрес и негодное тело не валят процесс (находки ревью К2 № 1 и № 2)", async () => {
  await get("/ui/v1/purchase/%E0");
  const big = await post("/ui/v1/anything", "{\"a\": 1e999}", randomUUID());
  expect(big.status).toBe(400);
  const broken = await post("/ui/v1/anything", "{ не json", randomUUID());
  expect(broken.status).toBe(400);
  // Сервер жив: в его процессе живут монитор, пульт и стенд (П4 п. 4).
  const alive = await get("/ui/v1/purchase/pur_71");
  expect(alive.status).toBe(200);
});

// ── § 3: язык ───────────────────────────────────────────────────────────────────────────────────────────────────────

test("язык: ?lang=en меняет текст, негодный язык — ответ на языке по умолчанию, а не 400", async () => {
  const ru = (await (await get("/ui/v1/purchase/pur_000")).json()) as { error: { text: string } };
  const en = (await (await get("/ui/v1/purchase/pur_000?lang=en")).json()) as { error: { text: string } };
  const robot = await get("/ui/v1/purchase/pur_000?lang=robot");
  expect(en.error.text).not.toBe(ru.error.text);
  expect(robot.status).toBe(UI_ERROR_STATUS.PURCHASE_NOT_FOUND);
  expect(((await robot.json()) as { error: { text: string } }).error.text).toBe(ru.error.text);
});

// ── § 6: класс повтора кода ядра — у ядра ───────────────────────────────────────────────────────────────────────────

test("класс повтора кода ядра берётся у ядра, а не придумывается сервером", async () => {
  const { uiError } = await import("../../src/ui-server/errors.js");
  for (const code of ["STATE_UNAVAILABLE", "RATE_LIMITED", "UPSTREAM_UNAVAILABLE"] as const) {
    const out = uiError(code, "ru");
    const theirs = ruleForFailure(code).retry;
    expect(out.body.error.retry).toBe(theirs === "new_key" ? "same_key" : theirs);
    // Статус кода ядра — один названный (409): таблицы «код ядра → статус» ни у ядра, ни в К-Б v1.0 нет.
    expect(out.status).toBe(409);
  }
});

test("new_key экрану не отдаётся ни при каком коде ядра (§ 3)", async () => {
  const { uiError } = await import("../../src/ui-server/errors.js");
  const { FAILURE_RULES } = await import("agentic-buyer-ref/src/agent/declines/table.js");
  for (const code of Object.keys(FAILURE_RULES) as (keyof typeof FAILURE_RULES)[]) {
    expect(uiError(code, "ru").body.error.retry).not.toBe("new_key");
  }
});

// ── Прочие методы в ИН-0 не зарегистрированы ────────────────────────────────────────────────────────────────────────

test("метод не того рода — 405 с перечнем, прочие адреса под /ui/v1 — 404", async () => {
  const wrong = await fetch(`${server.url}/ui/v1/purchase/pur_71`, { method: "DELETE", headers: { cookie: jar } });
  expect(wrong.status).toBe(405);
  expect(wrong.headers.get("allow")).toBe("GET");
  expect((await get("/ui/v1/offers")).status).toBe(404);
});

test("заголовки безопасности стоят на каждом ответе — и на отказе тоже", async () => {
  for (const res of [await get("/ui/v1/purchase/pur_71"), await get("/ui/v1/purchase/pur_000"), await get("/ui/v1/offers")]) {
    expect(res.headers.get("content-security-policy")).toContain("default-src 'self'");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(res.headers.get("cache-control")).toBe("no-store");
  }
});
