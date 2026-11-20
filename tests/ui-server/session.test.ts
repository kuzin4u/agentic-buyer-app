// Сессия приложения (ИН-0, кирпич К4; К-Б § 3 «Авторизация», решение Р-1640, кирпичи К2а и К3а).
//
// Разбор `Cookie` проверяется **таблицей**: фиксация сессии подкинутой cookie — это не редкий случай, а обычная
// подмена (находка ревью К2а № 1), и каждая её форма должна быть названа отдельной строкой.
import { expect, test } from "vitest";
import { cookieValue, PAO_IDEMPOTENCY_WINDOW_MS, Sessions, UI_SESSION_COOKIE } from "../../src/ui-server/index.js";

const req = (cookie?: string): { headers: { cookie?: string } } => ({ headers: cookie === undefined ? {} : { cookie } });
const asReq = (cookie?: string) => req(cookie) as unknown as Parameters<Sessions["ownerOf"]>[0];

// ── Флаги cookie ────────────────────────────────────────────────────────────────────────────────────────────────────

test("флаги cookie: Path, HttpOnly, SameSite и Max-Age стоят всегда", () => {
  const s = new Sessions({ newId: () => "sid_1" });
  const cookie = s.issue("own_1").setCookie;
  expect(cookie).toContain(`${UI_SESSION_COOKIE}=sid_1`);
  expect(cookie).toContain("Path=/");
  expect(cookie).toContain("HttpOnly");
  expect(cookie).toContain("SameSite=Strict");
  expect(cookie).toContain(`Max-Age=${Math.floor(PAO_IDEMPOTENCY_WINDOW_MS / 1000)}`);
});

test("Secure — по признаку: на стенде нет, вне стенда есть", () => {
  expect(new Sessions().issue("own_1").setCookie).not.toContain("Secure");
  expect(new Sessions({ secure: true }).issue("own_1").setCookie).toContain("Secure");
});

test("срок сессии и окно повторов — из одного места", () => {
  // Два независимых «суток» в двух модулях разошлись бы молча, и сессия пережила бы ключи своих же действий.
  const s = new Sessions({ newId: () => "sid_1" });
  const max = /Max-Age=(\d+)/.exec(s.issue("own_1").setCookie)![1]!;
  expect(Number(max) * 1000).toBe(PAO_IDEMPOTENCY_WINDOW_MS);
});

test("в cookie — только опознаватель сессии: ни владельца, ни токена (инвариант 1)", () => {
  const s = new Sessions({ newId: () => "sid_1" });
  expect(s.issue("own_secret_1").setCookie).not.toContain("own_secret_1");
});

test("опознаватель владельца не по форме — отказ при выдаче, а не запись в память", () => {
  const s = new Sessions();
  // Без проверки формы раздача экрана положила бы в память имя, телефон или токен банка (находка ревью К2а № 5).
  for (const bad of ["", "own 1", "+7 999 000-00-00", "a".repeat(65), "own/1"]) expect(() => s.issue(bad)).toThrow();
  expect(s.size).toBe(0);
});

// ── Разбор `Cookie` — таблицей ──────────────────────────────────────────────────────────────────────────────────────

test.each([
  { как: "одна пара", header: "ui_session=sid_1", ждём: "sid_1" },
  { как: "несколько пар", header: "a=1; ui_session=sid_1; b=2", ждём: "sid_1" },
  // Пробелы вокруг знака равенства браузеры не присылают (RFC 6265 их не допускает), но разбор их терпит: имя
  // срезается по краям, иначе не работала бы обычная форма «a=1; ui_session=x» с пробелом после точки с запятой.
  { как: "пробелы вокруг имени и значения", header: "  ui_session = sid_1 ", ждём: "sid_1" },
  { как: "пробелы после точки с запятой", header: "a=1;   ui_session=sid_1", ждём: "sid_1" },
  { как: "закавыченное значение", header: 'ui_session="sid_1"', ждём: "sid_1" },
  { как: "имя-префикс не считается", header: "ui_session_other=sid_2", ждём: null },
  { как: "имя-продолжение не считается", header: "other_ui_session=sid_2", ждём: null },
  { как: "пара без знака равенства", header: "ui_session; a=1", ждём: null },
  { как: "пустое значение", header: "ui_session=", ждём: null },
  { как: "дубль имени — отказ, а не выбор одной", header: "ui_session=sid_2; ui_session=sid_1", ждём: null },
  { как: "дубль с пустым — тоже дубль", header: "ui_session=; ui_session=sid_1", ждём: null },
  { как: "заголовка нет", header: undefined, ждём: null },
])("разбор Cookie: $как", ({ header, ждём }) => {
  expect(cookieValue(header, UI_SESSION_COOKIE)).toBe(ждём);
});

test("подкинутая cookie с более длинным Path закрывает вход, а не навязывает опознаватель", () => {
  const s = new Sessions({ newId: () => "sid_mine" });
  s.issue("own_1");
  // Браузер присылает раньше cookie с более длинным `Path`, то есть именно подкинутую; cookie не разделяются по порту,
  // поэтому любое происхождение на 127.0.0.1 могло бы навязать свой опознаватель — это фиксация сессии.
  expect(s.ownerOf(asReq("ui_session=sid_planted; ui_session=sid_mine"))).toBeNull();
  // Своя cookie без дубля работает: человек войдёт заново, и чужой опознаватель не подойдёт никогда.
  expect(s.ownerOf(asReq("ui_session=sid_mine"))).toBe("own_1");
});

// ── Срок, закрытие, предел ──────────────────────────────────────────────────────────────────────────────────────────

test("истёкшая сессия — не владелец, и запись удаляется", () => {
  let now = 1_000;
  const s = new Sessions({ now: () => now, newId: () => "sid_1" });
  s.issue("own_1");
  now += PAO_IDEMPOTENCY_WINDOW_MS + 1;
  expect(s.ownerOf(asReq("ui_session=sid_1"))).toBeNull();
  expect(s.size).toBe(0);
});

test("срок не продлевается обращением (решение владельца Р-1665: вариант (а) отклонён)", () => {
  let now = 1_000;
  const s = new Sessions({ now: () => now, newId: () => "sid_1" });
  s.issue("own_1");
  now += PAO_IDEMPOTENCY_WINDOW_MS - 10;
  expect(s.ownerOf(asReq("ui_session=sid_1"))).toBe("own_1");
  now += 20;
  // Если бы обращение продлевало срок, здесь была бы живая сессия — а это ровно то же окно для украденной cookie.
  expect(s.ownerOf(asReq("ui_session=sid_1"))).toBeNull();
});

test("закрытая сессия не возвращается", () => {
  const s = new Sessions({ newId: () => "sid_1" });
  const { id } = s.issue("own_1");
  s.close(id);
  expect(s.ownerOf(asReq("ui_session=sid_1"))).toBeNull();
});

test("на пределе вытесняются истёкшие, а не живые сессии других людей", () => {
  let now = 1_000;
  let n = 0;
  const s = new Sessions({ now: () => now, newId: () => `sid_${++n}` });
  // Предел — 10 000; заполняем его записями, которые к моменту следующей выдачи истекут.
  for (let i = 0; i < 10_000; i++) s.issue("own_old");
  expect(s.size).toBe(10_000);
  now += PAO_IDEMPOTENCY_WINDOW_MS + 1;
  const live = s.issue("own_live");
  // Истёкшие сняты все, живая новая осталась одна: 10 000 выдач не выкидывают из системы настоящих людей.
  expect(s.size).toBe(1);
  expect(s.ownerOf(asReq(`ui_session=${live.id}`))).toBe("own_live");
});
