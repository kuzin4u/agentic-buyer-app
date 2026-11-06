// К1.2 (Р-1246 п. 3, Р-1275 п. 2): адаптер «локальный стенд» — лента SSE и снимок реестров по HTTP, только чтение.
// Поддельный сервер: история и живые записи, номера не по порядку, запись не по форме, обрыв и переподключение без
// повторов, перезапуск стенда, перенаправление, предел записи, сбой слушателя.
import { createServer, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { localStandSource, SourceError, type DashboardSource } from "../../src/dashboards/source.js";
import { INSTANCE_HEADER, parseDiagSnapshot, parseWireItem, type WireItem } from "../../src/dashboards/wire.js";

const AT = "2026-11-06T00:00:00.000Z";
const money = { minor: 50000, currency: "RUB", text: { ru: "500,00 ₽", en: "RUB 500.00" } };
const mon = (seq: number, extra: Record<string, unknown> = {}) => ({
  stream: "monitor",
  event: { seq, at: AT, source: "agent_platform", cls: "check", what: "GET /pao/v1/agent", status: 200, ids: {}, ...extra },
});
const sse = (o: unknown) => `data: ${typeof o === "string" ? o : JSON.stringify(o)}\n\n`;
const seqs = (got: WireItem[]) => got.map((i) => (i.stream === "monitor" ? i.event.seq : i.line.seq));

interface FakeOpts {
  diag?: unknown;
  diagType?: string;
  redirect?: string;
}

interface Fake {
  url: string;
  server: Server;
  conns: ServerResponse[];
  history: string[];
  instance: string;
  close(): Promise<void>;
}

async function fake(history: string[], o: FakeOpts = {}): Promise<Fake> {
  const conns: ServerResponse[] = [];
  const server = createServer((req, res) => {
    if (o.redirect) {
      res.writeHead(302, { location: o.redirect });
      return res.end();
    }
    if (req.url === "/api/diag" && o.diag !== null) {
      res.writeHead(200, { "content-type": o.diagType ?? "application/json" });
      return res.end(JSON.stringify(o.diag ?? { v: 1, registries: [] }));
    }
    if (req.url === "/events") {
      res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", [INSTANCE_HEADER]: f.instance });
      for (const h of f.history) res.write(h);
      conns.push(res);
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const f: Fake = {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    server,
    conns,
    history,
    instance: "i1",
    close: () =>
      new Promise((ok) => {
        for (const c of conns) c.destroy();
        server.closeAllConnections();
        server.close(() => ok());
      }),
  };
  return f;
}

const until = async (cond: () => boolean, ms = 3000) => {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error("timeout");
    await new Promise((r) => setTimeout(r, 10));
  }
};

const extra: { src?: DashboardSource; srv?: Fake }[] = [];
let src: DashboardSource | undefined;
let srv: Fake | undefined;
afterEach(async () => {
  await src?.close();
  await srv?.close();
  for (const e of extra.splice(0)) {
    await e.src?.close();
    await e.srv?.close();
  }
  src = srv = undefined;
});

describe("формат линии", () => {
  it("запись монитора: поля из перечня переносятся, лишние — нет (инвариант 1)", () => {
    const r = parseWireItem(mon(1, { amount: money, code: "LIMIT_EXCEEDED", codeDetail: "CLIENT", ids: { op_ref: "op_1" }, token_ref: "t", pan: "x" }));
    expect(r).toEqual({ stream: "monitor", event: { ...mon(1).event, amount: money, code: "LIMIT_EXCEEDED", codeDetail: "CLIENT", ids: { op_ref: "op_1" } } });
  });

  it.each([
    ["seq не число", { ...mon(1), event: { ...mon(1).event, seq: "1" } }],
    ["время не ISO", mon(1, { at: "вчера" })],
    ["источник вне перечня", mon(1, { source: "shop" })],
    ["код — не машинный (текст продавца)", mon(1, { code: "<b>оплачено</b>" })],
    ["идентификатор с разметкой", mon(1, { ids: { order_id: "<img src=x>" } })],
    ["сумма без валюты", mon(1, { amount: { minor: 1, text: money.text } })],
    ["поток вне перечня", { stream: "raw", event: mon(1).event }],
    ["консоль: kind не по форме", { stream: "console", line: { seq: 1, at: AT, kind: "<script>" } }],
    ["сюжет: параметр-объект не сумма", { stream: "scenario", line: { seq: 1, at: AT, step: "x", params: { title: { b: 1 } } } }],
    ["сюжет: шаг «SMS банка» (инвариант 3)", { stream: "scenario", line: { seq: 1, at: AT, step: "upk.sms", params: { code: "123456" } } }],
  ])("не по форме: %s", (_, raw) => {
    expect(parseWireItem(raw)).toBeUndefined();
  });

  it("консоль и сюжет: только поля и параметры перечня (upk_url и неизвестный ключ не переносятся); сумма в параметрах", () => {
    expect(parseWireItem({ stream: "console", line: { seq: 2, at: AT, kind: "pao.call", reason: "R", secret: "s" } })).toEqual({
      stream: "console",
      line: { seq: 2, at: AT, kind: "pao.call", reason: "R" },
    });
    expect(
      parseWireItem({ stream: "scenario", line: { seq: 3, at: AT, step: "upk.required", params: { confirmation_id: "cf_1", upk_url: "http://127.0.0.1/c/cf_1", token_ref: "t" } } }),
    ).toEqual({ stream: "scenario", line: { seq: 3, at: AT, step: "upk.required", params: { confirmation_id: "cf_1" } } });
    expect(parseWireItem({ stream: "scenario", line: { seq: 4, at: AT, step: "intent.created", params: { mandate_id: "mdt_1", limit: money } } })).toEqual({
      stream: "scenario",
      line: { seq: 4, at: AT, step: "intent.created", params: { mandate_id: "mdt_1", limit: money } },
    });
  });

  it("снимок реестров: запись не по форме отброшена и посчитана; не та версия — undefined", () => {
    const good = { code: "MANDATE_REVOKED", component: "pao", source: ["client"], action: "stop", human: { ru: "р", en: "e" }, operator: { ru: "о" }, norm: "n", since: "1.4.0" };
    const r = parseDiagSnapshot({
      v: 1,
      registries: [
        { id: "agent", status: "ready", components: ["pao"], entries: [good, { ...good, source: ["shop"] }, { ...good, human: { en: "e" } }] },
        { id: "platform", status: "pending", components: ["platform", "pi"], entries: [] },
        { id: "other", status: "ready", components: [], entries: [] },
      ],
    })!;
    expect(r.rejected).toBe(3);
    expect(r.snapshot.registries.map((x) => [x.id, x.status, x.entries.length])).toEqual([
      ["agent", "ready", 1],
      ["platform", "pending", 0],
    ]);
    expect(parseDiagSnapshot({ v: 2, registries: [] })).toBeUndefined();
  });
});

describe("localStandSource", () => {
  it("только http://127.0.0.1 (не localhost, не https, не чужой адрес) — машинный код ошибки", () => {
    for (const u of ["https://127.0.0.1:1", "http://example.org", "http://localhost:1"]) {
      expect(() => localStandSource(u)).toThrow(SourceError);
      try {
        localStandSource(u);
      } catch (e) {
        expect((e as SourceError).code).toBe("SOURCE_NOT_LOCAL");
      }
    }
  });

  it("история и живые записи; запись не по форме и не JSON отброшены и посчитаны", async () => {
    srv = await fake([sse(mon(1)), sse("{не json"), sse(mon(2, { source: "shop" })), sse(mon(3))]);
    src = localStandSource(srv.url);
    const got: WireItem[] = [];
    src.subscribe((i) => got.push(i));
    await until(() => got.length === 2);
    srv.conns[0]!.write(sse(mon(4)));
    await until(() => got.length === 3);
    expect(seqs(got)).toEqual([1, 3, 4]);
    expect(src.rejected).toBe(2);
  });

  it("номер меньше уже полученного доставляется (событие Платформы ждёт суммы — блокер ревью К1.2 № 1)", async () => {
    srv = await fake([sse(mon(1)), sse(mon(3))]);
    src = localStandSource(srv.url, { retryMs: 20 });
    const got: WireItem[] = [];
    src.subscribe((i) => got.push(i));
    await until(() => got.length === 2);
    srv.conns[0]!.write(sse(mon(2, { source: "pao_event", cls: "outcome", what: "operation.authorized", status: undefined, amount: money })));
    await until(() => got.length === 3);
    expect(seqs(got)).toEqual([1, 3, 2]);
    // Переподключение: история отсортирована (1, 2, 3) — ни одна запись не повторяется и не теряется.
    srv.history.splice(0, srv.history.length, sse(mon(1)), sse(mon(2)), sse(mon(3)), sse(mon(4)));
    srv.conns[0]!.destroy();
    await until(() => got.length === 4);
    expect(seqs(got)).toEqual([1, 3, 2, 4]);
  });

  it("шумная консоль не вытесняет номер монитора: после переподключения итог не повторяется (ревью К1.2 Н1)", async () => {
    const con = (seq: number) => ({ stream: "console", line: { seq, at: AT, kind: "pao.call" } });
    const outcome = mon(1, { source: "pao_event", cls: "outcome", what: "operation.authorized", status: undefined, amount: money });
    srv = await fake([sse(outcome), ...[2, 3, 4, 5, 6].map((n) => sse(con(n)))]);
    src = localStandSource(srv.url, { retryMs: 20, seenLimit: 2 });
    const got: WireItem[] = [];
    src.subscribe((i) => got.push(i));
    await until(() => got.length === 6);
    // История шины по потокам: в консоли — последние записи, в мониторе — итог по-прежнему.
    srv.history.splice(0, srv.history.length, sse(outcome), sse(con(5)), sse(con(6)), sse(con(7)));
    srv.conns[0]!.destroy();
    await until(() => got.length === 7);
    await new Promise((r) => setTimeout(r, 100));
    expect(got.filter((i) => i.stream === "monitor").length).toBe(1);
    expect(seqs(got).at(-1)).toBe(7);
  });

  it("шаг «SMS банка» скрыт по правилу и не считается испорченной записью (ревью К1.2 Н3)", async () => {
    srv = await fake([sse({ stream: "scenario", line: { seq: 1, at: AT, step: "upk.sms", params: { code: "123456" } } }), sse(mon(2))]);
    src = localStandSource(srv.url);
    const got: WireItem[] = [];
    src.subscribe((i) => got.push(i));
    await until(() => got.length === 1);
    expect(seqs(got)).toEqual([2]);
    expect(src.rejected).toBe(0);
  });

  it("обрыв ленты — переподключение; история второй раз не повторяется", async () => {
    srv = await fake([sse(mon(1)), sse(mon(2))]);
    src = localStandSource(srv.url, { retryMs: 20 });
    const got: WireItem[] = [];
    const states: string[] = [];
    src.onStatus((s) => states.push(s));
    src.subscribe((i) => got.push(i));
    await until(() => got.length === 2);
    srv.history.push(sse(mon(3)));
    srv.conns[0]!.destroy();
    await until(() => got.length === 3);
    expect(seqs(got)).toEqual([1, 2, 3]);
    expect(srv.conns.length).toBe(2);
    expect(states).toContain("open");
    expect(states).not.toContain("reset");
  });

  it("перезапуск стенда (новый экземпляр шины) — статус reset, номера с 1 снова доставляются", async () => {
    srv = await fake([sse(mon(1)), sse(mon(2))]);
    src = localStandSource(srv.url, { retryMs: 20 });
    const got: WireItem[] = [];
    const states: string[] = [];
    src.onStatus((s) => states.push(s));
    src.subscribe((i) => got.push(i));
    await until(() => got.length === 2);
    srv.instance = "i2";
    srv.history.splice(0, srv.history.length, sse(mon(1, { what: "после перезапуска" })));
    srv.conns[0]!.destroy();
    await until(() => got.length === 3);
    expect(states).toContain("reset");
    expect(got[2]).toMatchObject({ event: { seq: 1, what: "после перезапуска" } });
  });

  it("перенаправление не выполняется: лента не открывается, снимок — ошибка (только 127.0.0.1)", async () => {
    const target = await fake([sse(mon(1))]);
    srv = await fake([], { redirect: `${target.url}/events` });
    extra.push({ srv: target });
    src = localStandSource(srv.url, { retryMs: 10_000 });
    const got: WireItem[] = [];
    src.subscribe((i) => got.push(i));
    await new Promise((r) => setTimeout(r, 200));
    expect(got).toEqual([]);
    expect(target.conns.length).toBe(0);
    await expect(src.diag()).rejects.toMatchObject({ code: "SOURCE_UNAVAILABLE" });
  });

  it("diag: тайм-аут, отказ соединения и слишком большой снимок — машинные коды (ревью К1.2 Н2)", async () => {
    const hang = createServer(() => undefined);
    await new Promise<void>((ok) => hang.listen(0, "127.0.0.1", ok));
    const hangUrl = `http://127.0.0.1:${(hang.address() as AddressInfo).port}`;
    try {
      const a = localStandSource(hangUrl, { diagTimeoutMs: 100 });
      await expect(a.diag()).rejects.toMatchObject({ code: "SOURCE_DIAG_TIMEOUT" });
      await a.close();
    } finally {
      hang.closeAllConnections();
      await new Promise((ok) => hang.close(ok));
    }
    const b = localStandSource(hangUrl);
    await expect(b.diag()).rejects.toMatchObject({ code: "SOURCE_UNAVAILABLE" });
    await b.close();
    srv = await fake([], { diag: { v: 1, registries: [], pad: "x".repeat(5000) } });
    src = localStandSource(srv.url, { maxDiagChars: 1024 });
    await expect(src.diag()).rejects.toMatchObject({ code: "SOURCE_DIAG_TOO_LARGE" });
  });

  it("запись длиннее предела отброшена; незавершённый остаток длиннее предела — линия рвётся", async () => {
    srv = await fake([sse(mon(1, { what: "x".repeat(1500) })), sse(mon(2)), `data: ${"x".repeat(5000)}`]);
    src = localStandSource(srv.url, { maxEventChars: 1024, retryMs: 10_000 });
    const got: WireItem[] = [];
    src.subscribe((i) => got.push(i));
    await until(() => src!.rejected === 2);
    expect(seqs(got)).toEqual([2]);
  });

  it("сбой одного слушателя не обрывает линию и не мешает другому", async () => {
    srv = await fake([sse(mon(1)), sse(mon(2))]);
    src = localStandSource(srv.url);
    const got: WireItem[] = [];
    src.subscribe(() => {
      throw new Error("сбой экрана");
    });
    src.subscribe((i) => got.push(i));
    await until(() => got.length === 2);
    expect(srv.conns.length).toBe(1);
  });

  it("diag: снимок по форме; 404, не JSON по типу — машинные коды", async () => {
    srv = await fake([], { diag: { v: 1, registries: [{ id: "platform", status: "pending", components: ["platform"], entries: [] }] } });
    src = localStandSource(srv.url);
    expect((await src.diag()).registries[0]).toMatchObject({ id: "platform", status: "pending" });
    const none = await fake([], { diag: null });
    const html = await fake([], { diagType: "text/html" });
    const a = localStandSource(none.url);
    const b = localStandSource(html.url);
    extra.push({ src: a, srv: none }, { src: b, srv: html });
    await expect(a.diag()).rejects.toMatchObject({ code: "SOURCE_DIAG_STATUS" });
    await expect(b.diag()).rejects.toMatchObject({ code: "SOURCE_DIAG_TYPE" });
  });

  it("close: линия закрыта, состояние closed; diag после close — SOURCE_CLOSED", async () => {
    srv = await fake([sse(mon(1))]);
    src = localStandSource(srv.url);
    const states: string[] = [];
    src.onStatus((s) => states.push(s));
    src.subscribe(() => undefined);
    await until(() => states.includes("open"));
    await src.close();
    expect(states.at(-1)).toBe("closed");
    await expect(src.diag()).rejects.toMatchObject({ code: "SOURCE_CLOSED" });
  });
});
