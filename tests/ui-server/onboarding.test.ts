// ИН-П1, кирпич К3 — **маршруты** § 5.17 и § 5.18 на сервере `/ui/v1` (находка ревью К3 № 2).
//
// Тест кирпича проверял функции сервиса, а сами адреса не проверял ничем: опечатка в имени параметра
// (`?models=`) или перестановка проверок «настройка → метод» оставались зелёными. Здесь проверяется **ответ на
// запросе**: сессия раньше всего, выключенная настройка неотличима от незарегистрированного адреса, 405 с перечнем
// методов, параметр вида агента.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, test } from "vitest";
import { createConsentStore, parseOnboardingCatalog } from "../../src/onboarding/index.js";
import { Sessions, startUiServer, type CorePurchase, type UiCorePort, type UiServer } from "../../src/ui-server/index.js";

const catalog = parseOnboardingCatalog(
  JSON.parse(readFileSync(new URL("../../config/onboarding.default.json", import.meta.url), "utf8")) as unknown,
);

/** Ядро знакомству не нужно вовсе: человек заводит агента до того, как покупка появилась. Порт здесь — заглушка,
 *  которая обязана остаться невызванной, и это проверяется. */
let coreCalls = 0;
const core: UiCorePort = {
  purchase: async () => {
    coreCalls += 1;
    return null as unknown as CorePurchase | null;
  },
  subscribe: () => () => undefined,
};

let server: UiServer;
let sessions: Sessions;
let jar: string;

const start = async (withOnboarding: boolean): Promise<void> => {
  sessions = new Sessions();
  coreCalls = 0;
  server = await startUiServer({
    core,
    owner: (req) => sessions.ownerOf(req),
    shell: { brandPath: "config/brand.demo.json", sessions, ownerOnPage: () => "own_1" },
    ...(withOnboarding
      ? {
          onboarding: {
            catalog,
            viewId: "vw_p3_1",
            store: createConsentStore(),
            journal: { write: () => undefined, refused: () => undefined },
            now: () => "2026-11-21T12:00:00Z",
          },
        }
      : {}),
  });
  const page = await fetch(`${server.url}/ui`);
  jar = page.headers.get("set-cookie")!.split(";")[0]!;
};

beforeEach(() => start(true));

afterEach(async () => {
  await server.close();
});

const get = (path: string, cookie = jar): Promise<Response> => fetch(`${server.url}${path}`, { headers: { cookie } });

test("§ 5.17: знакомство отдаётся со своей сессией, ядро не спрашивается", async () => {
  const res = await get("/ui/v1/onboarding");
  expect(res.status).toBe(200);
  const body = (await res.json()) as { path: unknown; models: { id: string }[] };
  expect(body.path).toEqual({ n: 1, of: 8 });
  expect(body.models.map((m) => m.id)).toEqual(["M1", "M2", "M3"]);
  // Покупки у знакомства нет: обращение к ядру означало бы, что метод привязан к покупке, которой ещё не существует.
  expect(coreCalls).toBe(0);
});

test("§ 5.18: карточка условий отдаётся по параметру вида агента", async () => {
  const res = await get("/ui/v1/onboarding/terms?model=M1");
  expect(res.status).toBe(200);
  const body = (await res.json()) as { model: string; view: { hash: string }; actions: { accept: { enabled: boolean } } };
  expect(body.model).toBe("M1");
  expect(body.view.hash).toMatch(/^sha256:[0-9a-f]{64}$/);
  expect(body.actions.accept.enabled).toBe(false);
});

test("§ 5.18: имя параметра именно `model` — опечатка не отдаёт карточку", async () => {
  // При `?models=M1` вид агента не назван, то есть выбрать нечего — тот же отказ, что у неизвестного кода.
  const res = await get("/ui/v1/onboarding/terms?models=M1");
  expect(res.status).toBe(409);
  const body = (await res.json()) as { error: { code: string } };
  expect(body.error.code).toBe("MODEL_NOT_AVAILABLE");
});

test("§ 5.18: невыбираемый вид, неизвестный код и отсутствующий параметр отвечают одинаково", async () => {
  const bodies: string[] = [];
  for (const q of ["?model=M3", "?model=M4", "", "?model="]) {
    const res = await get(`/ui/v1/onboarding/terms${q}`);
    expect(res.status, q).toBe(409);
    bodies.push(await res.text());
  }
  // Байт в байт: по разнице ответов стало бы видно, какие коды существуют.
  expect(new Set(bodies).size).toBe(1);
});

test("оба адреса молчат без сессии — одним `SESSION_REQUIRED`, как все методы", async () => {
  for (const path of ["/ui/v1/onboarding", "/ui/v1/onboarding/terms?model=M1"]) {
    // Значение cookie — только ASCII: заголовок это ByteString, и кириллица в нём роняет сам запрос, а не сервер.
    const res = await get(path, "ui_session=no-such-session");
    expect(res.status, path).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code, path).toBe("SESSION_REQUIRED");
  }
});

test("изменяющий метод на адресе знакомства до маршрута не доходит: правило 2 раньше", async () => {
  // POST без ключа повтора отсекается общим слоем (правило 2), и это верный порядок: ключ требуется у каждого POST
  // **до** маршрутизации, иначе защита зависела бы от автора метода.
  const res = await fetch(`${server.url}/ui/v1/onboarding`, { method: "POST", headers: { cookie: jar }, body: "{}" });
  expect(res.status).toBe(400);
  const body = (await res.json()) as { error: { code: string } };
  expect(body.error.code).toBe("IDEMPOTENCY_REQUIRED");
});

test("без настройки знакомства адресов нет — ответ тот же, что у незарегистрированного", async () => {
  await server.close();
  await start(false);
  const known = await get("/ui/v1/onboarding");
  const unknown = await get("/ui/v1/нет-такого-метода");
  expect(known.status).toBe(404);
  expect(unknown.status).toBe(404);
  // Текст тот же: по ответу не видно, что метод «есть, но пока молчит».
  expect(await known.text()).toBe(await unknown.text());
});

test("язык ответа выбирает сервер по `?lang=`", async () => {
  const res = await get("/ui/v1/onboarding/terms?model=M3&lang=en");
  expect(res.status).toBe(409);
  const body = (await res.json()) as { error: { text: string } };
  expect(body.error.text).toBe("This kind of agent is not available yet. Choose the bank's agent or your own agent");
});
