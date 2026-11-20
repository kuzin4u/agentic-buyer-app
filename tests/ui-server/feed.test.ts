// Поток `GET /ui/v1/feed` (ИН-0, кирпич К4; К-Б § 5.9 и **правило 4** «поток — только сигнал», инвариант 6 / П31).
//
// Проверяется главное: из события нельзя узнать итог. Ни статуса, ни суммы, ни «оплачено» в нём нет — и даже если
// источник пришлёт лишнее поле, до экрана оно не доедет. Иначе «Оплачено» можно было бы нарисовать по событию, а это
// прямо против инварианта 6: итог — только по прочитанному у Платформы.
import { afterEach, beforeEach, expect, test } from "vitest";
import type { UiFeedEvent } from "../../src/contract/ui-v1/index.js";
import { feedChunk, feedSignal, Sessions, startUiServer, UI_FEED_EVENT, type CorePurchase, type UiCorePort, type UiServer } from "../../src/ui-server/index.js";

// Вид сигнала — из закрытого перечня контракта (`UiFeedKind`), а не выдуманная строка: иначе тест «только сигнал»
// проходил бы на событии, которого в контракте не бывает.
const signal: UiFeedEvent = { event_id: "evt_31", purchase_id: "pur_71", kind: "STATE", at: "2026-11-20T10:00:00Z" };

test("сигнал — ровно четыре поля; лишнее поле источника до экрана не доезжает", () => {
  const dirty = { ...signal, state: "DONE", amount: { amount: 632000, currency: "RUB" }, paid: true } as unknown as UiFeedEvent;
  const clean = feedSignal(dirty);
  expect(Object.keys(clean).sort()).toEqual(["at", "event_id", "kind", "purchase_id"]);
  const text = JSON.stringify(clean);
  for (const forbidden of ["DONE", "amount", "paid", "632000"]) expect(text).not.toContain(forbidden);
});

test("строка SSE несёт id события и имя события § 5.9", () => {
  const chunk = feedChunk(signal);
  expect(chunk).toContain(`id: ${signal.event_id}\n`);
  expect(chunk).toContain(`event: ${UI_FEED_EVENT}\n`);
  expect(chunk.endsWith("\n\n")).toBe(true);
  // Повторную доставку («не менее одного раза») экран отбрасывает по тому же `event_id`.
  expect(chunk).toContain(`"event_id":"${signal.event_id}"`);
});

// ── Живой поток ─────────────────────────────────────────────────────────────────────────────────────────────────────

let server: UiServer;
let sessions: Sessions;
let listeners: { owner: string; send: (e: UiFeedEvent) => void }[];

const core = (): UiCorePort => ({
  purchase: async () => null as unknown as CorePurchase | null,
  subscribe: (owner, listener) => {
    const entry = { owner, send: listener };
    listeners.push(entry);
    return () => {
      listeners = listeners.filter((l) => l !== entry);
    };
  },
});

beforeEach(async () => {
  listeners = [];
  sessions = new Sessions();
  server = await startUiServer({
    core: core(),
    owner: (req) => sessions.ownerOf(req),
    shell: { brandPath: "config/brand.demo.json", sessions, ownerOnPage: () => "own_1" },
  });
});

afterEach(async () => {
  await server.close();
});

test("поток: пауза переподключения приходит с сервера, подписка — по владельцу", async () => {
  const cookie = (await (await fetch(`${server.url}/ui`)).headers.get("set-cookie"))!.split(";")[0]!;
  const res = await fetch(`${server.url}/ui/v1/feed`, { headers: { cookie } });
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("text/event-stream");
  const reader = res.body!.getReader();
  const first = new TextDecoder().decode((await reader.read()).value);
  // Паузу перед повторным подключением назначает сервер: поток сам ничего не досылает (правило 4).
  expect(first).toContain("retry: ");
  // Подписка оформлена на **этого** владельца: поток по всем покупкам выдавал бы чужие опознаватели (ревью К2 № 5).
  expect(listeners).toHaveLength(1);
  expect(listeners[0]!.owner).toBe("own_1");

  listeners[0]!.send({ ...signal, state: "DONE" } as unknown as UiFeedEvent);
  const got = new TextDecoder().decode((await reader.read()).value);
  expect(got).toContain(`event: ${UI_FEED_EVENT}`);
  expect(got).not.toContain("DONE");
  await reader.cancel();
});

test("в поток одного владельца чужие сигналы не попадают", async () => {
  // Положительного случая мало: без отрицательного «подписка по владельцу» держалась бы только тем, что в тесте один
  // владелец (находка ревью К4 № 13). Два потока двух владельцев: чужой сигнал уходит **только** в свой поток, и
  // проверяется это не ожиданием тишины (оно упирается в срок теста), а тем, что следующая порция своего потока —
  // своя, а не чужая.
  const mineCookie = (await fetch(`${server.url}/ui`)).headers.get("set-cookie")!.split(";")[0]!;
  const alienCookie = `ui_session=${sessions.issue("own_2").id}`;
  const open = async (cookie: string): Promise<ReadableStreamDefaultReader<Uint8Array>> => {
    const res = await fetch(`${server.url}/ui/v1/feed`, { headers: { cookie } });
    const reader = res.body!.getReader();
    // Первая порция — строка `retry:` от сервера.
    expect(new TextDecoder().decode((await reader.read()).value)).toContain("retry: ");
    return reader;
  };
  const mine = await open(mineCookie);
  const alien = await open(alienCookie);
  expect(listeners.map((l) => l.owner).sort()).toEqual(["own_1", "own_2"]);

  const alienSignal = { ...signal, event_id: "evt_77", purchase_id: "pur_92" };
  listeners.find((l) => l.owner === "own_2")!.send(alienSignal);
  expect(new TextDecoder().decode((await alien.read()).value)).toContain("evt_77");

  listeners.find((l) => l.owner === "own_1")!.send(signal);
  const got = new TextDecoder().decode((await mine.read()).value);
  // Если бы чужой сигнал затёк в наш поток, здесь была бы **его** порция — она пришла бы раньше нашей.
  expect(got).toContain(signal.event_id);
  expect(got).not.toContain("evt_77");
  expect(got).not.toContain("pur_92");
  await mine.cancel();
  await alien.cancel();
});

test("поток без сессии не открывается и подписки не создаёт", async () => {
  const res = await fetch(`${server.url}/ui/v1/feed`);
  expect(res.headers.get("content-type")).not.toContain("text/event-stream");
  expect(listeners).toHaveLength(0);
  await res.text();
});

test("поток только читается: другой метод — 405 с перечнем", async () => {
  const cookie = (await (await fetch(`${server.url}/ui`)).headers.get("set-cookie"))!.split(";")[0]!;
  const res = await fetch(`${server.url}/ui/v1/feed`, { method: "PUT", headers: { cookie } });
  expect(res.status).toBe(405);
  expect(res.headers.get("allow")).toBe("GET");
});
