// ИН-П1, кирпич К4 — `POST /ui/v1/consent` (§ 5.19) на сервере.
//
// Проверяется **ответ на запросе**: правило 2 целиком (ключ, повтор, конфликт, запоминание **каждого** исхода),
// четыре отказа § 5.19, признак «кто нажал» от сервера, запись неизменяемой версии по владельцу сессии.
//
// Почему тест живёт здесь, а не рядом с модулем: идемпотентность исполняет **общий слой** сервера, а не модуль
// знакомства (решение К4: второй механизм внутри модуля дал бы одному действию два правила повтора). Значит и
// проверять её надо на границе, через запрос.
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, test } from "vitest";
import { IDEMPOTENCY_HEADER, UI_RETRY } from "../../src/contract/ui-v1/index.js";
import {
  createConsentStore,
  parseOnboardingCatalog,
  termsView,
  type ConsentAcceptedEntry,
  type ConsentRefusedEntry,
} from "../../src/onboarding/index.js";
import { Sessions, startUiServer, type CorePurchase, type UiCorePort, type UiServer } from "../../src/ui-server/index.js";

const catalog = parseOnboardingCatalog(
  JSON.parse(readFileSync(new URL("../../config/onboarding.default.json", import.meta.url), "utf8")) as unknown,
);

const core: UiCorePort = { purchase: async () => null as unknown as CorePurchase | null, subscribe: () => () => undefined };

/** Провенанс нажатия: время **по часам устройства**, версия текстов показанной карточки (П26). */
const press = { at: "2026-11-21T12:04:31.120Z", device: "mobile", text_version: "onboarding@1.0", gesture: "tap" } as const;

const hashFor = (model: "M1" | "M2", lang: "ru" | "en" = "ru"): string =>
  termsView(model, lang, { catalog, viewId: "vw_p3_1" }).hash;

let server: UiServer;
let sessions: Sessions;
let jar: string;
let store: ReturnType<typeof createConsentStore>;
let written: ConsentAcceptedEntry[];
let refusals: ConsentRefusedEntry[];

const start = async (by?: () => "human" | "emulator" | "test"): Promise<void> => {
  sessions = new Sessions();
  store = createConsentStore();
  written = [];
  refusals = [];
  server = await startUiServer({
    core,
    owner: (req) => sessions.ownerOf(req),
    shell: { brandPath: "config/brand.demo.json", sessions, ownerOnPage: () => "own_1" },
    onboarding: {
      catalog,
      viewId: "vw_p3_1",
      store,
      journal: { write: (e) => void written.push(e), refused: (e) => void refusals.push(e) },
      now: () => "2026-11-21T12:04:32.000Z",
    },
    ...(by === undefined ? {} : { provenance: { faults: true, by } }),
  });
  const page = await fetch(`${server.url}/ui`);
  jar = page.headers.get("set-cookie")!.split(";")[0]!;
};

beforeEach(() => start());

afterEach(async () => {
  await server.close();
});

const post = (body: unknown, key: string | null = randomUUID(), cookie = jar): Promise<Response> =>
  fetch(`${server.url}/ui/v1/consent`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json", ...(key === null ? {} : { [IDEMPOTENCY_HEADER]: key }) },
    body: JSON.stringify(body),
  });

const good = (model: "M1" | "M2" = "M1") =>
  ({ model, accepted: ["TERMS", "DATA"], shown_hash: hashFor(model), press }) as const;

test("хэш в ответе — от карточки § 5.18, а не от того же кода, что его считал", async () => {
  // `hashFor` зовёт `termsView`, то есть ту же сборку, что и сервер: выкинь из карточки поле — ожидание сдвинется
  // вместе с кодом, и правило 1 останется незакреплённым (находка ревью К4 № 9). Поэтому хэш берётся **с ответа
  // § 5.18** — из того, что экран реально получил, — и он обязан совпасть с принятым в § 5.19.
  const card = await fetch(`${server.url}/ui/v1/onboarding/terms?model=M1`, { headers: { cookie: jar } });
  const shown = (await card.json()) as { view: { hash: string; text_version: string } };
  const res = await post({ model: "M1", accepted: ["TERMS", "DATA"], shown_hash: shown.view.hash, press });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { consent: { shown: unknown } };
  expect(body.consent.shown).toEqual({ hash: shown.view.hash, text_version: shown.view.text_version });
});

test("согласие принято: неизменяемая версия, провенанс и хэш показанного", async () => {
  const res = await post(good("M2"));
  expect(res.status).toBe(200);
  const body = (await res.json()) as { consent: Record<string, unknown>; path: unknown };
  expect(body.consent).toEqual({
    version: 1,
    model: "M2",
    accepted: ["TERMS", "DATA"],
    by: "human",
    received_at: "2026-11-21T12:04:32.000Z",
    shown: { hash: hashFor("M2"), text_version: "onboarding@1.0" },
  });
  expect(body.path).toEqual({ n: 3, of: 8 });
  // Версия легла в хранилище этого человека, и журнал написан ровно один раз.
  expect(store.last("own_1")?.no).toBe(1);
  expect(written.length).toBe(1);
  expect(written[0]!.event).toBe("consent.accepted");
});

test("повтор тем же ключом и тем же телом — тот же ответ, второй версии нет", async () => {
  const key = randomUUID();
  const first = await post(good(), key);
  const second = await post(good(), key);
  expect(first.status).toBe(200);
  expect(second.status).toBe(200);
  expect(await second.text()).toBe(await first.text());
  // Главное: действие **не выполнилось второй раз** — ни версии, ни строки журнала.
  expect(store.all("own_1").length).toBe(1);
  expect(written.length).toBe(1);
});

test("тот же ключ с другим телом — IDEMPOTENCY_CONFLICT, и согласия не появилось", async () => {
  const key = randomUUID();
  await post(good("M1"), key);
  const res = await post(good("M2"), key);
  expect(res.status).toBe(409);
  const body = (await res.json()) as { error: { code: string; retry: string } };
  expect(body.error.code).toBe("IDEMPOTENCY_CONFLICT");
  expect(body.error.retry).toBe(UI_RETRY.IDEMPOTENCY_CONFLICT);
  expect(store.all("own_1").length).toBe(1);
});

test("POST без ключа повтора — IDEMPOTENCY_REQUIRED, и ключ он не занимает", async () => {
  const res = await post(good(), null);
  expect(res.status).toBe(400);
  const body = (await res.json()) as { error: { code: string; retry: string } };
  expect(body.error.code).toBe("IDEMPOTENCY_REQUIRED");
  // Класс `same_key`: «добавьте ключ и повторяйте с ним же» — повтор обязан пройти, а не получить прежний отказ.
  expect(body.error.retry).toBe("same_key");
  const retry = await post(good(), randomUUID());
  expect(retry.status).toBe(200);
});

test("отказ занимает ключ: повтор того же тела отдаёт тот же отказ, а не выполняет действие", async () => {
  const key = randomUUID();
  const first = await post({ ...good(), accepted: ["TERMS"] }, key);
  expect(first.status).toBe(400);
  const second = await post({ ...good(), accepted: ["TERMS"] }, key);
  expect(second.status).toBe(400);
  expect(await second.text()).toBe(await first.text());
  // Ровно то, что требует правило 2: исправленное тело идёт **новым** ключом, а не этим же.
  expect(store.last("own_1")).toBeNull();
  expect(written).toEqual([]);
});

test("не все обязательные пункты — CONSENT_INVALID 400 after_fix, причина экрану не уходит", async () => {
  for (const accepted of [["TERMS"], ["DATA"], [], ["TERMS", "TERMS"], ["TERMS", "DATA", "MARKETING"]]) {
    const res = await post({ ...good(), accepted });
    expect(res.status, JSON.stringify(accepted)).toBe(400);
    const body = (await res.json()) as { error: { code: string; retry: string; text: string } };
    expect(body.error.code, JSON.stringify(accepted)).toBe("CONSENT_INVALID");
    expect(body.error.retry).toBe("after_fix");
    expect(body.error.text).toBe("Согласие не принято. Посмотрите условия и отметьте оба пункта заново");
    // Причина (`problem`) — для журнала и разбора; экрану от неё пользы нет, и в теле её быть не должно.
    expect(JSON.stringify(body)).not.toContain("REQUIRED_MISSING");
    expect(JSON.stringify(body)).not.toContain("problem");
  }
});

test("тело с полем `by` — негодное тело: признак из тела не берётся ни в каком режиме", async () => {
  const res = await post({ ...good(), by: "human" });
  expect(res.status).toBe(400);
  // Отклоняется **до** памяти повторов и до разбора: экран недоверенная среда, и присланное «я человек» ничего
  // не доказывает (П26 доп. 2).
  expect(store.last("own_1")).toBeNull();
});

test("лишнее поле и негодный провенанс — CONSENT_INVALID", async () => {
  for (const body of [
    { ...good(), extra: 1 },
    { ...good(), press: { ...press, device: "robot" } },
    { ...good(), press: { ...press, gesture: "nod" } },
    { ...good(), press: { ...press, at: "" } },
    { ...good(), press: { at: press.at, device: press.device, gesture: press.gesture } },
    { model: "M1", accepted: ["TERMS", "DATA"], shown_hash: hashFor("M1") },
  ]) {
    const res = await post(body);
    expect(res.status, JSON.stringify(body)).toBe(400);
    const got = (await res.json()) as { error: { code: string } };
    expect(got.error.code, JSON.stringify(body)).toBe("CONSENT_INVALID");
  }
});

test("невыбираемая и неизвестная модель — MODEL_NOT_AVAILABLE 409 never", async () => {
  for (const model of ["M3", "M4", ""]) {
    const res = await post({ ...good(), model });
    expect(res.status, model).toBe(409);
    const body = (await res.json()) as { error: { code: string; retry: string } };
    expect(body.error.code, model).toBe("MODEL_NOT_AVAILABLE");
    expect(body.error.retry, model).toBe("never");
  }
  expect(store.last("own_1")).toBeNull();
});

test("хэш показанного не совпал — SHOWN_STALE 409 с новой карточкой", async () => {
  const res = await post({ ...good(), shown_hash: `sha256:${"0".repeat(64)}` });
  expect(res.status).toBe(409);
  const body = (await res.json()) as { error: { code: string; retry: string; view: { hash: string } | null } };
  expect(body.error.code).toBe("SHOWN_STALE");
  expect(body.error.retry).toBe("after_human");
  // Новая карточка приходит с ответом: человек смотрит, что изменилось, и решает заново.
  expect(body.error.view?.hash).toBe(hashFor("M1"));
  expect(store.last("own_1")).toBeNull();
});

test("хэш от другой модели не подходит: подтверждают ровно показанное", async () => {
  const res = await post({ ...good("M1"), shown_hash: hashFor("M2") });
  expect(res.status).toBe(409);
  const body = (await res.json()) as { error: { code: string } };
  expect(body.error.code).toBe("SHOWN_STALE");
});

test("версия текстов провенанса разошлась с показанной — SHOWN_STALE", async () => {
  // Та же величина, что `view.text_version` (§ 3): расходится — человек подтверждал не те тексты.
  const res = await post({ ...good(), press: { ...press, text_version: "onboarding@0.9" } });
  expect(res.status).toBe(409);
  const body = (await res.json()) as { error: { code: string } };
  expect(body.error.code).toBe("SHOWN_STALE");
});

test("хэш другого языка не подходит, и отказ приходит на языке запроса", async () => {
  const res = await fetch(`${server.url}/ui/v1/consent?lang=en`, {
    method: "POST",
    headers: { cookie: jar, "content-type": "application/json", [IDEMPOTENCY_HEADER]: randomUUID() },
    body: JSON.stringify({ ...good(), shown_hash: hashFor("M1", "ru") }),
  });
  expect(res.status).toBe(409);
  const body = (await res.json()) as { error: { code: string; text: string } };
  expect(body.error.code).toBe("SHOWN_STALE");
  expect(body.error.text).toBe("The terms have changed. Read them again and tick the items once more");
});

test("без сессии — SESSION_REQUIRED 401, и ни согласия, ни записи в памяти повторов", async () => {
  const key = randomUUID();
  const res = await post(good(), key, "ui_session=no-such-session");
  expect(res.status).toBe(401);
  const body = (await res.json()) as { error: { code: string; retry: string } };
  expect(body.error.code).toBe("SESSION_REQUIRED");
  expect(body.error.retry).toBe("after_human");
  // Ключ не занят: со своей сессией то же тело тем же ключом обязано выполниться.
  const ok = await post(good(), key);
  expect(ok.status).toBe(200);
});

test("согласие принадлежит человеку: нумерация версий по своему владельцу", async () => {
  await post(good("M1"));
  await post(good("M2"));
  expect(store.all("own_1").map((v) => v.no)).toEqual([1, 2]);
  // Прежде здесь стояло только `store.last("own_2") === null` — проверка пустая: `own_2` никогда ничего не писал, и
  // она зеленела бы даже на общем списке без ключа по человеку (находка ревью К4 № 8). Теперь второй человек
  // **приходит со своей сессией**: его согласие обязано быть первой версией, а не третьей.
  const other = sessions.issue("own_2");
  const res = await post(good("M1"), randomUUID(), other.setCookie.split(";")[0]!);
  expect(res.status).toBe(200);
  expect(((await res.json()) as { consent: { version: number } }).consent.version).toBe(1);
  expect(store.all("own_2").map((v) => v.no)).toEqual([1]);
  // И чужая история не поехала.
  expect(store.all("own_1").map((v) => v.no)).toEqual([1, 2]);
});

test("ключ повтора чужого человека не находит мой ответ", async () => {
  // Память повторов ключуется парой «владелец + ключ» (находка ревью К2 № 4 ИН-0). Если бы ключ был общим, второй
  // человек, случайно взявший тот же UUID, получил бы **мой** ответ — то есть увидел бы, что я согласился.
  const key = randomUUID();
  const mine = await post(good("M1"), key);
  expect(mine.status).toBe(200);

  const other = sessions.issue("own_2");
  // Второй человек выбирает **другой** вид агента: тогда подменённый (мой) ответ виден прямо в теле, а не только по
  // числу записей в хранилище (находка ревью К6 № 9) — иначе различающая сила держалась бы на одной строке.
  const theirs = await post(good("M2"), key, other.setCookie.split(";")[0]!);
  expect(theirs.status).toBe(200);
  const body = (await theirs.json()) as { consent: { version: number; model: string } };
  // Его первое действие, а не повтор моего: версия первая **и модель своя**.
  expect(body.consent.version).toBe(1);
  expect(body.consent.model).toBe("M2");
  expect(store.all("own_1").length).toBe(1);
  expect(store.all("own_2").length).toBe(1);
  expect(store.last("own_2")?.owner).toBe("own_2");
  expect(store.last("own_2")?.model).toBe("M2");
  // И моя запись не поехала.
  expect(store.last("own_1")?.model).toBe("M1");
});

test("в режиме прогона тестов признак ставит сервер, а не тело", async () => {
  await server.close();
  await start(() => "test");
  const res = await post(good());
  expect(res.status).toBe(200);
  const body = (await res.json()) as { consent: { by: string } };
  // Человек на экране увидит пометку «подписано прогоном, не вами» — признак обязателен и умолчания у него нет.
  expect(body.consent.by).toBe("test");
  expect(store.last("own_1")?.by).toBe("test");
  expect(written[0]!.by).toBe("test");
});

test("отказ пишется в журнал с причиной, а экрану причина не уходит", async () => {
  const res = await post({ ...good(), accepted: ["TERMS"] });
  expect(res.status).toBe(400);
  // Причина нужна разбору: иначе «человек жаловался, что не смог согласиться» нечем посмотреть (находка ревью № 7).
  expect(refusals.length).toBe(1);
  expect(refusals[0]).toEqual({
    event: "consent.refused",
    owner: "own_1",
    code: "CONSENT_INVALID",
    reason: "REQUIRED_MISSING",
    model: "M1",
    by: "human",
    received_at: "2026-11-21T12:04:32.000Z",
  });
  // А в ответе её нет.
  expect(await res.text()).not.toContain("REQUIRED_MISSING");
});

test("удачный исход и отказ приходят на обоих языках", async () => {
  // Прежде английский был закрыт только у `SHOWN_STALE` (находка ревью К4 № 14).
  const en = await fetch(`${server.url}/ui/v1/consent?lang=en`, {
    method: "POST",
    headers: { cookie: jar, "content-type": "application/json", [IDEMPOTENCY_HEADER]: randomUUID() },
    body: JSON.stringify({ ...good("M1"), shown_hash: hashFor("M1", "en") }),
  });
  expect(en.status).toBe(200);
  const bad = await fetch(`${server.url}/ui/v1/consent?lang=en`, {
    method: "POST",
    headers: { cookie: jar, "content-type": "application/json", [IDEMPOTENCY_HEADER]: randomUUID() },
    body: JSON.stringify({ model: "M3", accepted: ["TERMS", "DATA"], shown_hash: hashFor("M1", "en"), press }),
  });
  expect(bad.status).toBe(409);
  expect(((await bad.json()) as { error: { text: string } }).error.text).toBe(
    "This kind of agent is not available yet. Choose the bank's agent or your own agent",
  );
});

test("язык входит в отпечаток: тем же ключом другое действие не проходит", async () => {
  // У `/consent` язык решает, по какой карточке сверяется хэш, значит одно и то же тело при `?lang=ru` и `?lang=en` —
  // **разные** действия (находка ревью К4 № 13). Пока язык в отпечаток не входил, второй запрос получал **ответ
  // первого**: отказ по-русски выдавался бы за ответ на английское действие.
  const key = randomUUID();
  const ru = await fetch(`${server.url}/ui/v1/consent?lang=ru`, {
    method: "POST",
    headers: { cookie: jar, "content-type": "application/json", [IDEMPOTENCY_HEADER]: key },
    body: JSON.stringify({ ...good("M1"), shown_hash: hashFor("M1", "en") }),
  });
  expect(ru.status).toBe(409);
  expect(((await ru.json()) as { error: { code: string } }).error.code).toBe("SHOWN_STALE");

  const en = await fetch(`${server.url}/ui/v1/consent?lang=en`, {
    method: "POST",
    headers: { cookie: jar, "content-type": "application/json", [IDEMPOTENCY_HEADER]: key },
    body: JSON.stringify({ ...good("M1"), shown_hash: hashFor("M1", "en") }),
  });
  // Правило 2 отвечает **конфликтом**, а не прежним ответом и не вторым действием: один ключ — одно действие, а это
  // уже другое. Это и есть правильный исход, а не «обе стороны выполнились».
  expect(en.status).toBe(409);
  expect(((await en.json()) as { error: { code: string } }).error.code).toBe("IDEMPOTENCY_CONFLICT");

  // Со **своим** ключом английское действие проходит.
  const fresh = await fetch(`${server.url}/ui/v1/consent?lang=en`, {
    method: "POST",
    headers: { cookie: jar, "content-type": "application/json", [IDEMPOTENCY_HEADER]: randomUUID() },
    body: JSON.stringify({ ...good("M1"), shown_hash: hashFor("M1", "en") }),
  });
  expect(fresh.status).toBe(200);
});

test("GET на адрес согласия — 405 с перечнем методов, а не 404", async () => {
  // Адрес зарегистрирован, значит чужой глагол это 405, как у `/purchase/{id}` и `/onboarding*` (находка № 11).
  const res = await fetch(`${server.url}/ui/v1/consent`, { headers: { cookie: jar } });
  expect(res.status).toBe(405);
  expect(res.headers.get("allow")).toBe("POST");
});

test("без настройки знакомства адреса нет — ответ тот же, что у незарегистрированного", async () => {
  await server.close();
  sessions = new Sessions();
  server = await startUiServer({
    core,
    owner: (req) => sessions.ownerOf(req),
    shell: { brandPath: "config/brand.demo.json", sessions, ownerOnPage: () => "own_1" },
  });
  const page = await fetch(`${server.url}/ui`);
  jar = page.headers.get("set-cookie")!.split(";")[0]!;
  const known = await post(good());
  expect(known.status).toBe(404);
});
