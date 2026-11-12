// П-4.4 (ревью П-1.1 № 12, ревью П-2.1а № 2; Р-1493, Р-1516): соединение `/pult/events` снимает свою подписку на ленту пульта
// при обрыве клиента — и только свою. Без правки `src/demo/server.ts`: живые подписки считает обёртка над настоящей лентой
// (`createPultFeed`), сервер, маршрут и лента — настоящие. Обрыв — разрывом сокета (`req.destroy()`), а не закрытием читателя
// (урок К1.4в, Р-1339: отмена чтения не обрывала соединение).
import { request, type ClientRequest, type IncomingMessage } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { startDemo, type Demo } from "../../src/demo/run.js";
import { driver } from "./drive.js";

const live = vi.hoisted(() => ({ n: 0 }));

vi.mock("../../src/pult/feed.js", async (orig) => {
  const m = await orig<typeof import("../../src/pult/feed.js")>();
  return {
    ...m,
    createPultFeed: (...a: Parameters<typeof m.createPultFeed>) => {
      const real = m.createPultFeed(...a);
      return {
        ...real,
        subscribe(l: Parameters<typeof real.subscribe>[0]) {
          const off = real.subscribe(l);
          live.n++;
          let done = false;
          return () => {
            if (!done) live.n--;
            done = true;
            return off();
          };
        },
      };
    },
  };
});

/** Соединение SSE: сообщения по мере прихода, обрыв — разрывом сокета. */
function connect(url: string): Promise<{ req: ClientRequest; types: string[]; next: (type: string, after: number, ms?: number) => Promise<void> }> {
  return new Promise((ok, fail) => {
    const types: string[] = [];
    const waiters: (() => void)[] = [];
    const req = request(url, (res: IncomingMessage) => {
      let buf = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => {
        buf += chunk;
        let i: number;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const block = buf.slice(0, i);
          buf = buf.slice(i + 2);
          if (block.startsWith("data: ")) types.push((JSON.parse(block.slice(6)) as { type: string }).type);
          for (const w of waiters.splice(0)) w();
        }
      });
      res.on("error", () => undefined);
      ok({
        req,
        types,
        // Ждать сообщение типа `type` с номером больше `after` (номер — позиция в списке).
        next: (type, after, ms = 10_000) =>
          new Promise((done, timeout) => {
            const t = setTimeout(() => timeout(new Error(`нет сообщения ${type} за ${ms} мс`)), ms);
            const check = () => {
              if (types.slice(after).includes(type)) {
                clearTimeout(t);
                done();
              } else waiters.push(check);
            };
            check();
          }),
      });
    });
    req.on("error", (e) => (e.message === "socket hang up" ? undefined : fail(e)));
    req.end();
  });
}

const until = async (cond: () => boolean, ms = 2_000) => {
  const end = Date.now() + ms;
  while (!cond() && Date.now() < end) await new Promise((r) => setTimeout(r, 20));
  return cond();
};

describe("лента пульта /pult/events: снятие подписки при обрыве клиента (П-4.4)", { timeout: 120_000 }, () => {
  let demo: Demo;
  beforeAll(async () => {
    demo = await startDemo();
  }, 60_000);
  afterAll(async () => {
    await demo?.close();
  });

  it("два соединения — две подписки; обрыв одного — одна, оставшееся получает доску; обрыв второго — ноль", async () => {
    const url = `${demo.monitor.url}/pult/events`;
    const base = live.n;
    const a = await connect(url);
    const b = await connect(url);
    // Сокеты закрываются и при падении теста (ревью П-4.4 № 3).
    try {
      await a.next("board", 0);
      await b.next("board", 0);
      expect(live.n - base).toBe(2);
      // Шаг 2: обрыв первого — разрывом сокета.
      a.req.destroy();
      expect(await until(() => live.n - base === 1)).toBe(true);
      // Шаг 4 (Р-1516 — сразу после шага 2): оставшееся соединение получает новую доску — отписан только оборванный.
      const seen = b.types.length;
      await driver(demo).run(1);
      await b.next("board", seen);
      // Шаг 3: обрыв второго — подписок не осталось.
      b.req.destroy();
      expect(await until(() => live.n - base === 0)).toBe(true);
    } finally {
      a.req.destroy();
      b.req.destroy();
    }
  });
});
