// К2.2а: кнопка «прервать сюжет» (ревью К2.1 № 6) и надпись режима сюжета 2 (Р-1251 п. 2) на живом стенде.
// Подпись в автотесте — эмулятором банка (П2 п. 5).
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { BusItem, ScenarioLine } from "../../src/demo/bus.js";
import { MESSAGES } from "../../src/demo/i18n.js";
import { PLATFORM_VERSION, platformPackageVersion } from "../../src/demo/platform.js";
import { startDemo, type Demo } from "../../src/demo/run.js";

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until<T>(f: () => T | undefined, ms = 20_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = f();
    if (v !== undefined) return v;
    if (Date.now() > end) throw new Error("не дождались");
    await pause(50);
  }
}

describe("прервать сюжет; надпись режима сюжета 2", { timeout: 60_000 }, () => {
  let demo: Demo;
  const steps = (): ScenarioLine[] => demo.bus.history().flatMap((i: BusItem) => (i.stream === "scenario" ? [i.line] : []));
  const after = (n: number, name: string) => () => steps().slice(n).find((s) => s.step === name);
  const post = (name: string) => fetch(`${demo.monitor.url}/scenario/${name}`, { method: "POST", headers: { origin: demo.monitor.url } });

  beforeAll(async () => {
    demo = await startDemo();
  }, 30_000);
  afterAll(async () => {
    await demo?.close();
  });

  it("надпись режима — у кнопки сюжета 2 на обоих языках; версия Платформы — из пакета стенда, не литералом (З8, К3.1а)", async () => {
    // Версия — из package.json установленного пакета, прочитанного здесь напрямую, а не из модуля под проверкой.
    const installed = (JSON.parse(readFileSync(new URL("../../node_modules/agentic-ps-platform/package.json", import.meta.url), "utf8")) as { version: string }).version;
    expect(platformPackageVersion()).toBe(installed);
    expect(PLATFORM_VERSION).toBe(`v${installed}`);
    for (const [lang, url] of [["ru", "/"], ["en", "/?lang=en"]] as const) {
      const html = await (await fetch(`${demo.monitor.url}${url}`)).text();
      expect(MESSAGES[lang]["scenario.purchase_note"]).toContain("{platform}");
      // Видимая надпись — с версией; в словаре скрипта (JSON) шаблон {platform} остаётся для шага консоли.
      const note = /<p class="hint mode-note">(.*?)<\/p>/s.exec(html)?.[1];
      expect(note).toBe(MESSAGES[lang]["scenario.purchase_note"].replace("{platform}", `v${installed}`));
    }
    // Литерала версии Платформы в словаре нет (было «v0.40.0» при стенде v0.41.0).
    expect(readFileSync(new URL("../../src/demo/i18n.ts", import.meta.url), "utf8")).not.toMatch(/Платформе v\d|Platform v\d/);
  });

  it("прервать без сюжета — 409", async () => {
    expect((await post("abort")).status).toBe(409);
  });

  it("прервано на подписи поручения — шаг «прервано», повторное прерывание — 409, следующий сюжет 1 запускается", async () => {
    const n = steps().length;
    expect((await post("intent")).status).toBe(202);
    await until(after(n, "intent.awaiting_signature"));
    expect((await post("abort")).status).toBe(202);
    expect((await post("abort")).status).toBe(409);
    await until(after(n, "aborted"));
    await demo.scenarios.settled();
    expect((await post("purchase")).status).toBe(409); // поручение не подписано — покупки нет
  });

  it("прервано на карточке корзины — корзины нет, поручение не использовано; в консоли — надпись режима", async () => {
    let n = steps().length;
    expect((await post("intent")).status).toBe(202);
    const w = await until(after(n, "intent.awaiting_signature"));
    expect((await demo.stand.stand.issuer.sign(String(w.params.mandate_id))).statusCode).toBe(200);
    await until(after(n, "intent.signed"));
    await demo.scenarios.settled();

    n = steps().length;
    expect((await post("purchase")).status).toBe(202);
    await until(after(n, "cart.card"));
    expect(steps().slice(n)[0]).toMatchObject({ step: "purchase.mode_note", params: { platform: PLATFORM_VERSION } });
    // В консоли монитора шаг идёт по шаблону словаря: {platform} подставляется из параметра шага.
    expect(MESSAGES.ru["step.purchase.mode_note"]).toContain("{platform}");
    expect(MESSAGES.en["step.purchase.mode_note"]).toContain("{platform}");
    const posts = demo.stand.stand.calls().filter((c) => c.method === "POST" && c.path === "/pao/v1/mandates").length;
    expect((await post("abort")).status).toBe(202);
    await until(after(n, "aborted"));
    await demo.scenarios.settled();
    expect((await post("cart/accept")).status).toBe(409);
    await pause(300);
    expect(demo.stand.stand.calls().filter((c) => c.method === "POST" && c.path === "/pao/v1/mandates").length).toBe(posts);
    // поручение не использовано — сюжет 2 запускается снова
    n = steps().length;
    expect((await post("purchase")).status).toBe(202);
    await until(after(n, "cart.card"));
    // Прервано на подписи корзины: корзина уже запрошена — поручение использовано, нужен новый сюжет 1.
    expect((await post("cart/accept")).status).toBe(202);
    await until(after(n, "cart.awaiting_signature"));
    expect((await post("abort")).status).toBe(202);
    await until(after(n, "aborted"));
    await demo.scenarios.settled();
    expect((await post("purchase")).status).toBe(409);
  });
});
