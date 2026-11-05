// К1.3 (П2): монитор операций — классы, суммы, словари, отсутствие реквизитов, страница и SSE на живом стенде.
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { connect, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MonitorBus, classifyCall, classifyFeedItem, consoleLine, type BusItem, type BusSources, type CallRecord } from "../../src/demo/bus.js";
import { MESSAGES, langOf } from "../../src/demo/i18n.js";
import { formatMoney, moneyView } from "../../src/demo/money.js";
import { startDemo, type Demo } from "../../src/demo/run.js";
import { loadBrand, startMonitorServer } from "../../src/demo/server.js";
import type { FeedItem } from "agentic-buyer-ref/src/agent/ports/events.js";
import type { JournalEntry } from "agentic-buyer-ref/src/agent/journal/index.js";

const call = (method: string, path: string, status = 200, code?: string): CallRecord => ({
  method,
  path,
  status,
  source: "network",
  ...(code !== undefined && { code }),
});

describe("классы обращений", () => {
  it.each([
    ["POST", "/pao/v1/mandates", "mandate"],
    ["GET", "/pao/v1/mandates/mdt_1", "mandate"],
    ["POST", "/pao/v1/mandates/mdt_1/verify", "check"],
    ["GET", "/pao/v1/agent", "check"],
    ["POST", "/pao/v1/credentials", "credential"],
    ["POST", "/adp/v1/decide", "payment"],
    ["GET", "/pao/v1/operations/op_1", "check"],
    ["POST", "/participants/v1/mandates/mdt_1/sign", "mandate"],
    ["POST", "/participants/v1/mandates/mdt_1/revoke", "mandate"],
  ])("%s %s → %s", (method, path, cls) => {
    expect(classifyCall(call(method, path), "pao")?.cls).toBe(cls);
  });

  it("4xx с кодом — отказ с кодом; CONFIRMATION_REQUIRED — проверка (решение у человека)", () => {
    expect(classifyCall(call("POST", "/pao/v1/credentials", 403, "MANDATE_REVOKED"), "pao")).toMatchObject({ cls: "decline", code: "MANDATE_REVOKED", status: 403 });
    expect(classifyCall(call("POST", "/pao/v1/credentials", 403, "CONFIRMATION_REQUIRED"), "pao")?.cls).toBe("check");
  });

  it("путь — шаблоном; показываются только разрешённые идентификаторы, ссылка реквизита — нет", () => {
    const k = classifyCall(call("GET", "/pao/v1/credentials/tok_secret_ref"), "pao");
    expect(k?.what).toBe("GET /pao/v1/credentials/{credential_ref}");
    expect(JSON.stringify(k)).not.toContain("tok_secret_ref");
    expect(classifyCall(call("POST", "/pao/v1/mandates/mdt_9/verify"), "pao")?.ids).toEqual({ mandate_id: "mdt_9" });
  });

  it("витрины: заказ и оплата — «оплата», id витрины и заказа видны", () => {
    expect(classifyCall(call("POST", "/v1/shops/sh_1/orders/ord_2/payment"), "merchants")).toMatchObject({
      cls: "payment",
      ids: { shop_id: "sh_1", order_id: "ord_2" },
    });
  });

  it("битый «%» в пути — идентификатор не выводится, шина не падает", () => {
    expect(classifyCall(call("GET", "/v1/shops/%E0/catalog"), "merchants")).toMatchObject({ cls: "other", ids: {} });
  });

  it("код не машинный (текст продавца) — не выводится", () => {
    expect(classifyCall(call("POST", "/v1/shops/s/orders", 400, "<b>скидка</b>"), "merchants")).not.toHaveProperty("code");
  });

  it("источник: «агент» — только с keyid ключа нашего агента; чужой keyid и без подписи — «по сети»", () => {
    const sources: BusSources = {
      calls: () => [
        { ...call("GET", "/pao/v1/agent"), kid: "k1" },
        { ...call("GET", "/pao/v1/agent"), kid: "forged" },
        call("GET", "/pao/v1/agent"),
        { ...call("POST", "/adp/v1/decide"), source: "inject" },
      ],
      merchantCalls: () => [{ ...call("GET", "/v1/shops"), kid: "k1" }, { ...call("GET", "/v1/shops"), kid: "forged" }, call("GET", "/v1/shops")],
      journal: () => [],
      listenFeed: () => () => undefined,
      isAgentKid: (kid) => kid === "k1",
      confirmation: async () => undefined,
      now: () => new Date(),
    };
    const bus = new MonitorBus(sources);
    bus.poll();
    const src = bus.history().flatMap((i) => (i.stream === "monitor" ? [i.event.source] : []));
    expect(src).toEqual(["agent_platform", "network_platform", "network_platform", "stand", "agent_merchant", "network_merchant", "network_merchant"]);
  });

  it("история по потокам раздельно: поток консоли не вытесняет события монитора", () => {
    const entries = Array.from({ length: 50 }, (_, i) => ({ at: `2026-11-05T10:00:${String(i % 60).padStart(2, "0")}Z`, kind: "purchase.stage" }) as JournalEntry);
    const bus = new MonitorBus(
      {
        calls: () => [call("GET", "/pao/v1/agent")],
        merchantCalls: () => [],
        journal: () => entries,
        listenFeed: () => () => undefined,
        isAgentKid: () => false,
        confirmation: async () => undefined,
        now: () => new Date(),
      },
      { historyLimit: 5 },
    );
    bus.poll();
    const h = bus.history();
    expect(h.filter((i) => i.stream === "monitor")).toHaveLength(1);
    expect(h.filter((i) => i.stream === "console")).toHaveLength(5);
  });

  it("опрос ленты и подписка — не в ленте; неизвестный путь — без пути", () => {
    expect(classifyCall(call("GET", "/pao/v1/events"), "pao")).toBeNull();
    expect(classifyCall(call("GET", "/somewhere/secret_x"), "pao")?.what).toBe("GET (pao)");
  });
});

describe("события ПАО", () => {
  const ev = (type: string, extra: Record<string, string | null> = {}): FeedItem =>
    ({ kind: "event", event: { eventId: "e1", type, at: "2026-11-05T10:00:00Z", mandateId: null, opRef: null, confirmationId: null, declineReason: null, ...extra } }) as FeedItem;
  it.each([
    ["mandate.signed", "mandate"],
    ["mandate.revoked", "mandate"],
    ["confirmation.required", "check"],
    ["operation.authorized", "outcome"],
    ["operation.declined", "decline"],
  ])("%s → %s", (type, cls) => {
    expect(classifyFeedItem(ev(type)).cls).toBe(cls);
  });
  it("отказ операции — с кодом причины и op_ref", () => {
    expect(classifyFeedItem(ev("operation.declined", { opRef: "op_7", declineReason: "LIMIT_EXCEEDED" }))).toMatchObject({
      code: "LIMIT_EXCEEDED",
      ids: { op_ref: "op_7" },
    });
  });
});

describe("суммы — минимальные единицы и валюта", () => {
  it("рубли на двух языках, без литерала знака в коде", () => {
    const ru = formatMoney({ minor: 123450, currency: "RUB" }, "ru");
    const en = formatMoney({ minor: 123450, currency: "RUB" }, "en");
    expect(ru.replace(/\s/g, " ")).toContain("1 234,50");
    expect(en).toContain("1,234.50");
  });
  it("валюта без дробной части — по ISO 4217", () => {
    expect(formatMoney({ minor: 1234, currency: "JPY" }, "en")).toMatch(/1,234(?!\.)/);
  });
  it("знаки — по ISO 4217, а не по CLDR: IQD — три знака", () => {
    expect(formatMoney({ minor: 1234, currency: "IQD" }, "en")).toContain("1.234");
  });
  it("не целое, не ISO или валюты нет в таблице — ошибка", () => {
    expect(() => formatMoney({ minor: 1.5, currency: "RUB" }, "ru")).toThrow();
    expect(() => formatMoney({ minor: 1, currency: "rub" }, "ru")).toThrow();
    expect(() => formatMoney({ minor: 1, currency: "XXX" }, "ru")).toThrow();
  });
});

describe("словари ru/en", () => {
  it("одинаковые ключи, строки не пустые", () => {
    expect(Object.keys(MESSAGES.en).sort()).toEqual(Object.keys(MESSAGES.ru).sort());
    for (const lang of ["ru", "en"] as const) for (const v of Object.values(MESSAGES[lang])) expect(v.trim()).not.toBe("");
  });
  it("язык — только ru или en", () => {
    expect(langOf("en")).toBe("en");
    expect(langOf("de")).toBe("ru");
    expect(langOf(undefined, "en")).toBe("en");
  });
});

describe("инвариант 1: в ленте только поля из перечня", () => {
  it("лишние поля записи журнала (реквизит) в консоль не попадают", () => {
    const entry = { at: "2026-11-05T10:00:00Z", kind: "purchase.stage", detail: "CART", cryptogram: "CRYPTO-LEAK-1", pan_like: "LEAK-2" } as unknown as JournalEntry;
    const line = consoleLine(1, entry);
    expect(line).toEqual({ seq: 1, at: entry.at, kind: "purchase.stage", detail: "CART" });
  });

  it("сумма события подтверждения — из записи П6 стенда; заказ — как order_id", async () => {
    let listener: ((i: FeedItem) => void) | undefined;
    const src: BusSources = {
      calls: () => [],
      merchantCalls: () => [],
      journal: () => [],
      listenFeed: (l) => ((listener = l), () => undefined),
      isAgentKid: () => false,
      confirmation: async () => ({ amount: 340000, currency: "RUB", order_ref: "ord_5" }),
      now: () => new Date("2026-11-05T10:00:00Z"),
    };
    const bus = new MonitorBus(src);
    const got: BusItem[] = [];
    bus.subscribe((i) => got.push(i));
    bus.start(10_000);
    listener!({
      kind: "event",
      event: { eventId: "e", type: "confirmation.required", at: "2026-11-05T10:00:01Z", mandateId: "mdt_1", opRef: null, confirmationId: "cnf_1", declineReason: null },
    });
    await new Promise((r) => setTimeout(r, 10));
    bus.stop();
    const e = got.find((i) => i.stream === "monitor");
    expect(e?.stream === "monitor" && e.event).toMatchObject({
      cls: "check",
      amount: moneyView({ minor: 340000, currency: "RUB" }),
      ids: { mandate_id: "mdt_1", confirmation_id: "cnf_1", order_id: "ord_5" },
    });
  });

  it("скрипт страницы не строит разметку из строк", () => {
    const js = readFileSync("src/demo/public/monitor.js", "utf8");
    expect(js).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function/);
  });
});

/** Читать SSE, пока условие не выполнится или не выйдет срок. */
async function readSse(url: string, until: (text: string) => boolean, ms = 5000): Promise<string> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ms);
  let text = "";
  try {
    const res = await fetch(url, { signal: ac.signal });
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    while (!until(text)) {
      const { value, done } = await reader.read();
      if (done) break;
      text += dec.decode(value, { stream: true });
    }
    ac.abort();
  } catch (e) {
    if (!ac.signal.aborted) throw e;
  } finally {
    clearTimeout(timer);
  }
  return text;
}

describe("монитор на живом стенде", () => {
  let demo: Demo;
  beforeAll(async () => {
    demo = await startDemo();
  }, 30_000);
  afterAll(async () => {
    await demo?.close();
  });

  it("сервер монитора — только 127.0.0.1", () => {
    expect(demo.monitor.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect((demo.monitor.server.address() as AddressInfo).address).toBe("127.0.0.1");
  });

  it("страница: ru по умолчанию, en по ?lang=en, бренд из конфигурации, эмуляторы помечены, CSP 'self'", async () => {
    const brand = JSON.parse(readFileSync("config/brand.demo.json", "utf8")) as { name: string };
    const ru = await fetch(`${demo.monitor.url}/`);
    expect(ru.headers.get("content-security-policy")).toContain("default-src 'self'");
    const ruHtml = await ru.text();
    expect(ruHtml).toContain('<html lang="ru">');
    expect(ruHtml).toContain(MESSAGES.ru["monitor.title"]);
    expect(ruHtml).toContain(brand.name);
    // Пометка «эмулятор» — у бренда банка в шапке и у каждой ссылки на эмулятор: банк, УПК, витрины (ревью К1.3 № 9).
    const badge = `<span class="badge emu">${MESSAGES.ru["badge.emulator"]}</span>`;
    expect(ruHtml.split(badge).length - 1).toBe(4);
    for (const [url, key] of [
      [demo.stand.urls.bankApp, "link.bank"],
      [demo.stand.urls.upk, "link.upk"],
      [`${demo.stand.urls.merchants}/v1/shops`, "link.merchants"],
    ] as const) {
      expect(ruHtml).toContain(`<a href="${url}" target="_blank" rel="noopener">${MESSAGES.ru[key]}</a> ${badge}`);
    }
    expect(ruHtml).toContain(`<span class="badge real">${MESSAGES.ru["badge.real"]}</span>`);
    const enHtml = await (await fetch(`${demo.monitor.url}/?lang=en`)).text();
    expect(enHtml).toContain('<html lang="en">');
    expect(enHtml).toContain(MESSAGES.en["monitor.title"]);
    expect(enHtml).not.toContain(MESSAGES.ru["monitor.title"]);
    expect(enHtml.split(`<span class="badge emu">${MESSAGES.en["badge.emulator"]}</span>`).length - 1).toBe(4);
  });

  it("бренд: цвета из конфигурации в /brand.css, логотип — файл из config/", async () => {
    const cfg = JSON.parse(readFileSync("config/brand.demo.json", "utf8")) as { colors: Record<string, string> };
    const css = await (await fetch(`${demo.monitor.url}/brand.css`)).text();
    for (const c of Object.values(cfg.colors)) expect(css).toContain(c);
    const logo = await fetch(`${demo.monitor.url}/brand/logo`);
    expect(logo.status).toBe(200);
    expect(logo.headers.get("content-type")).toBe("image/svg+xml");
  });

  it("чужой Host (подмена DNS) — 421, ленту не отдаёт", async () => {
    const { port } = demo.monitor.server.address() as AddressInfo;
    const status = await new Promise<number>((ok, fail) => {
      const req = request({ host: "127.0.0.1", port, path: "/events", headers: { host: `evil.example:${port}` } }, (res) => {
        res.resume();
        ok(res.statusCode ?? 0);
      });
      req.on("error", fail);
      req.end();
    });
    expect(status).toBe(421);
  });

  it("неразбираемый адрес запроса — 400, сервер продолжает работать", async () => {
    const { port } = demo.monitor.server.address() as AddressInfo;
    const head = await new Promise<string>((ok, fail) => {
      const s = connect(port, "127.0.0.1", () => s.write(`GET http://[ HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: close\r\n\r\n`));
      let buf = "";
      s.on("data", (d) => (buf += d.toString()));
      s.on("end", () => ok(buf));
      s.on("error", fail);
    });
    expect(head).toMatch(/^HTTP\/1\.1 400/);
    expect((await fetch(`${demo.monitor.url}/`)).status).toBe(200);
  });

  it("SSE: допуск агента — «проверка» от агента к Платформе; консоль — самопроверка агента", async () => {
    const text = await readSse(`${demo.monitor.url}/events`, (t) => t.includes("GET /pao/v1/agent") && t.includes("agent.selfcheck"));
    const items = text
      .split("\n\n")
      .filter((b) => b.startsWith("data: "))
      .map((b) => JSON.parse(b.slice(6)) as BusItem);
    const admission = items.find((i) => i.stream === "monitor" && i.event.what === "GET /pao/v1/agent");
    expect(admission?.stream === "monitor" && admission.event).toMatchObject({ cls: "check", source: "agent_platform", status: 200 });
    expect(items.some((i) => i.stream === "console" && i.line.kind === "agent.selfcheck")).toBe(true);
  });

  it("лента живого стенда не пуста", async () => {
    const sse = await readSse(`${demo.monitor.url}/events`, (t) => t.includes("agent.selfcheck"));
    expect(sse).toContain("agent.selfcheck");
  });

  it("до сюжетов реквизиты не выданы — живая проверка утечки переписывается в К2.1 (STATUS «Открыто»)", () => {
    // Утечку по всем полям сейчас проверяет синтетический прогон ниже (ревью К1.3 № 1, № 12). Когда К2.1 даст первый
    // выпуск реквизита, эта проверка упадёт и должна стать проверкой: криптограмма и token_ref — не в SSE и не на странице.
    expect(demo.stand.stand.issuedCredentials()).toHaveLength(0);
  });
});

describe("инвариант 1: синтетический прогон шины и сервера с метками утечки во всех запрещённых полях", () => {
  const LEAK = ["LEAK_KID", "LEAK_NONCE", "LEAK_IDEM", "LEAK_CREDREF", "LEAK_CRYPTO", "LEAK_LINK", "LEAK_CONFREF", "LEAK_BODY", "LEAK_AGENTFIELD"];
  const brandCopy = () => {
    const p = join(mkdtempSync(join(tmpdir(), "demo-brand-")), "brand.json");
    writeFileSync(p, readFileSync("config/brand.demo.json"));
    return p;
  };

  it("ни одна метка не доходит до SSE и страницы", async () => {
    let listener: ((i: FeedItem) => void) | undefined;
    const src: BusSources = {
      calls: () =>
        [
          { method: "POST", path: "/pao/v1/credentials", status: 201, source: "network", kid: "LEAK_KID", nonce: "LEAK_NONCE", idempotency_key: "LEAK_IDEM" },
          { method: "GET", path: "/pao/v1/credentials/LEAK_CREDREF", status: 200, source: "network", kid: "LEAK_KID" },
          { method: "POST", path: "/pao/v1/credentials", status: 403, source: "network", code: "LEAK_BODY says no" },
        ] as unknown as CallRecord[],
      merchantCalls: () => [{ method: "POST", path: "/v1/shops/s1/orders", status: 400, source: "network", code: "<i>LEAK_BODY</i>" }],
      journal: () => [{ at: "2026-11-05T10:00:00Z", kind: "purchase.stage", agent: "LEAK_AGENTFIELD", kid: "LEAK_KID", cryptogram: "LEAK_CRYPTO" } as unknown as JournalEntry],
      listenFeed: (l) => ((listener = l), () => undefined),
      isAgentKid: () => true,
      confirmation: async () =>
        ({ amount: 100, currency: "RUB", order_ref: "ord_1", link: "LEAK_LINK", confirmation_ref: "LEAK_CONFREF", cryptogram: "LEAK_CRYPTO" }) as unknown as {
          amount: number;
          currency: string;
          order_ref: string;
        },
      now: () => new Date("2026-11-05T10:00:00Z"),
    };
    const bus = new MonitorBus(src);
    bus.start(10_000);
    listener!({
      kind: "event",
      event: { eventId: "e", type: "confirmation.required", at: "2026-11-05T10:00:01Z", mandateId: "mdt_1", opRef: null, confirmationId: "cnf_1", declineReason: null },
    });
    await new Promise((r) => setTimeout(r, 10));
    const server = await startMonitorServer({
      bus,
      urls: { pao: "http://127.0.0.1:1", merchants: "http://127.0.0.1:2", bankApp: "http://127.0.0.1:3", upk: "http://127.0.0.1:4" },
      agentCode: "agent:x",
      brandPath: brandCopy(),
    });
    try {
      const sse = await readSse(`${server.url}/events`, (t) => t.includes("confirmation.required"));
      const html = await (await fetch(`${server.url}/`)).text();
      expect(sse).toContain("confirmation.required");
      expect(sse).toContain("purchase.stage");
      expect(sse).toContain("POST /pao/v1/credentials");
      for (const m of LEAK) {
        expect(sse).not.toContain(m);
        expect(html).not.toContain(m);
      }
    } finally {
      bus.stop();
      await server.close();
    }
  });

  it("ошибка суммы (валюты нет в таблице) — событие без суммы, процесс не падает", async () => {
    let listener: ((i: FeedItem) => void) | undefined;
    const bus = new MonitorBus({
      calls: () => [],
      merchantCalls: () => [],
      journal: () => [],
      listenFeed: (l) => ((listener = l), () => undefined),
      isAgentKid: () => false,
      confirmation: async () => ({ amount: 1, currency: "XXX", order_ref: "o" }),
      now: () => new Date(),
    });
    bus.start(10_000);
    listener!({
      kind: "event",
      event: { eventId: "e", type: "confirmation.required", at: "2026-11-05T10:00:01Z", mandateId: null, opRef: null, confirmationId: "c", declineReason: null },
    });
    await new Promise((r) => setTimeout(r, 10));
    bus.stop();
    const e = bus.history().find((i) => i.stream === "monitor");
    expect(e?.stream === "monitor" && e.event.what).toBe("confirmation.required");
    expect(e?.stream === "monitor" && e.event.amount).toBeUndefined();
  });

  it("логотип вне config/ не отдаётся", () => {
    const p = brandCopy();
    const cfg = JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>;
    writeFileSync(p, JSON.stringify({ ...cfg, logo: "/etc/passwd" }));
    expect(loadBrand(p).logoFile).toBeNull();
    writeFileSync(p, JSON.stringify({ ...cfg, logo: "config/../package.json" }));
    expect(loadBrand(p).logoFile).toBeNull();
  });
});
