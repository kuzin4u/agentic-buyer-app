// «Вход истёк» своим кодом (ИН-0, кирпич К7; решение владельца 20.11.2026 — **Р-1665**).
//
// До этого кирпича истёкшая сессия выглядела для человека как `PURCHASE_NOT_FOUND` — «покупка не найдена», то есть
// неверная причина, и пути войти заново у него не было. Теперь на любой адрес под `/ui/v1` без действующей сессии
// отвечает **`SESSION_REQUIRED` 401** с классом повтора `after_human`: лечится открытием страницы, а не повтором.
//
// Главное, что здесь проверяется: ответ **один и тот же** на все причины и на все адреса, и по нему **не видно**,
// существует ли покупка. `PURCHASE_NOT_FOUND` остаётся для чужой, неизвестной и не по форме покупки — но только при
// своей действующей сессии.
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, test } from "vitest";
import { IDEMPOTENCY_HEADER, UI_ERROR_STATUS } from "../../src/contract/ui-v1/index.js";
import { PAO_IDEMPOTENCY_WINDOW_MS, RepeatStore, Sessions, startUiServer, type CorePurchase, type UiCorePort, type UiServer } from "../../src/ui-server/index.js";

const purchase = {
  purchase_id: "pur_71",
  state: "OFFERS",
  intent: {
    mandate_id: "mnd_14",
    status: "ACTIVE",
    amount_left: { amount: 632_000, currency: "RUB" },
    valid_to: "2026-12-01T00:00:00Z",
    as_of: "2026-11-20T10:00:00Z",
    revocation_id: null,
  },
  stops: [],
  stoppable: false,
} as unknown as CorePurchase;

const core: UiCorePort = {
  purchase: async (id, owner) => (id === "pur_71" && owner === "own_1" ? purchase : null),
  subscribe: () => () => undefined,
};

let server: UiServer;
let sessions: Sessions;
let repeats: RepeatStore;
let now: number;

beforeEach(async () => {
  now = 1_000_000;
  sessions = new Sessions({ now: () => now });
  repeats = new RepeatStore();
  server = await startUiServer({
    core,
    owner: (req) => sessions.ownerOf(req),
    repeats,
    shell: { brandPath: "config/brand.demo.json", sessions, ownerOnPage: () => "own_1" },
  });
});

afterEach(async () => {
  await server.close();
});

const mine = async (): Promise<string> => (await fetch(`${server.url}/ui`)).headers.get("set-cookie")!.split(";")[0]!;

const ask = (path: string, cookie: string): Promise<Response> => fetch(`${server.url}${path}`, { headers: { cookie } });

const ADDRESSES = ["/ui/v1/purchase/pur_71", "/ui/v1/purchase/pur_000", "/ui/v1/feed", "/ui/v1/offers", "/ui/v1/purchase/%E0"];

test("сессии не было: 401 SESSION_REQUIRED одним телом на всех адресах", async () => {
  const answers = await Promise.all(
    ADDRESSES.map(async (p) => {
      const res = await ask(p, "");
      return { status: res.status, body: await res.text() };
    }),
  );
  const first = answers[0]!;
  expect(first.status).toBe(UI_ERROR_STATUS.SESSION_REQUIRED);
  expect(first.status).toBe(401);
  for (const a of answers) {
    expect(a.status).toBe(first.status);
    // Тело **одинаковое**: иначе по разнице ответов стало бы видно, какие адреса зарегистрированы и какие покупки
    // существуют — то же требование, что у § 6 к `PURCHASE_NOT_FOUND`.
    expect(a.body).toBe(first.body);
  }
  const body = JSON.parse(first.body) as { error: { code: string; retry: string; text: string; view: null } };
  expect(body.error.code).toBe("SESSION_REQUIRED");
  // Лечится действием человека — открыть страницу заново; повтор того же запроса сессии не создаст.
  expect(body.error.retry).toBe("after_human");
  expect(body.error.view).toBeNull();
  expect(body.error.text).toMatch(/истёк/i);
});

test.each([
  { как: "сессии не было", cookie: () => "" },
  { как: "cookie есть, а сессии такой нет", cookie: () => "ui_session=sid_unknown" },
  { как: "подкинутый дубль имени", cookie: (own: string) => `ui_session=sid_planted; ${own}` },
])("$как — тот же 401 с тем же телом", async ({ cookie }) => {
  const own = await mine();
  const expected = await (await ask("/ui/v1/purchase/pur_71", "")).text();
  const res = await ask("/ui/v1/purchase/pur_71", cookie(own));
  expect(res.status).toBe(401);
  expect(await res.text()).toBe(expected);
});

test("истёкшая сессия — 401, а не «покупка не найдена»", async () => {
  const cookie = await mine();
  expect((await ask("/ui/v1/purchase/pur_71", cookie)).status).toBe(200);
  now += PAO_IDEMPOTENCY_WINDOW_MS + 1;
  const res = await ask("/ui/v1/purchase/pur_71", cookie);
  expect(res.status).toBe(401);
  expect(((await res.json()) as { error: { code: string } }).error.code).toBe("SESSION_REQUIRED");
});

test("закрытая сессия — 401", async () => {
  const cookie = await mine();
  sessions.close(cookie.slice("ui_session=".length));
  expect((await ask("/ui/v1/purchase/pur_71", cookie)).status).toBe(401);
});

test("своя действующая сессия: чужая, неизвестная и не по форме покупка — по-прежнему 404 одним ответом", async () => {
  const cookie = await mine();
  const answers = await Promise.all(
    ["/ui/v1/purchase/pur_92", "/ui/v1/purchase/pur_000", "/ui/v1/purchase/%E0"].map(async (p) => {
      const res = await ask(p, cookie);
      return { status: res.status, body: await res.text() };
    }),
  );
  for (const a of answers) {
    expect(a.status).toBe(UI_ERROR_STATUS.PURCHASE_NOT_FOUND);
    expect(a.body).toBe(answers[0]!.body);
    expect(JSON.parse(a.body).error.code).toBe("PURCHASE_NOT_FOUND");
  }
});

test("проверка сессии идёт до памяти повторов: отказ не запоминается ключом", async () => {
  const key = randomUUID();
  const res = await fetch(`${server.url}/ui/v1/anything`, {
    method: "POST",
    headers: { "content-type": "application/json", [IDEMPOTENCY_HEADER]: key },
    body: JSON.stringify({ a: 1 }),
  });
  expect(res.status).toBe(401);
  // Иначе повтор экрана после входа получил бы на свой ключ сохранённый отказ вместо действия.
  expect(repeats.size).toBe(0);
});

test("по ответу без сессии не видно, существует ли покупка и есть ли такой метод", async () => {
  // Своя сессия отвечает по-разному на живую покупку (200), чужую (404) и неизвестный адрес (404 с текстом);
  // без сессии все три ответа тождественны — это и есть требование § 3 «Авторизация».
  const cookie = await mine();
  const withSession = await Promise.all(["/ui/v1/purchase/pur_71", "/ui/v1/purchase/pur_92", "/ui/v1/offers"].map(async (p) => (await ask(p, cookie)).status));
  expect(new Set(withSession).size).toBeGreaterThan(1);
  const without = await Promise.all(["/ui/v1/purchase/pur_71", "/ui/v1/purchase/pur_92", "/ui/v1/offers"].map(async (p) => (await ask(p, "")).status));
  expect(new Set(without)).toEqual(new Set([401]));
});
