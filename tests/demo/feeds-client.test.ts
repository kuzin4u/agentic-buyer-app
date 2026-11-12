// П-5.2: скрипт «Лент» `public/pult/feeds.js` на подменённом DOM — разметка настоящая (`pultPage`). Ленты в панели
// «Интерпретатор», переключатель «Простыми словами / Шина», сводка транзакции в фокусе (`pult:focus`), пауза (`pult:pause`),
// сброс; данные — только текстом (инвариант 4).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { pultPage } from "../../src/demo/dash-pult.js";
import { loadBrand } from "../../src/demo/server.js";
import { feedsLabels, type FeedsView } from "../../src/pult/feeds.js";
import { FakeEvent, pageEnv, type PageEnv } from "../support/fake-dom.js";

const FEEDS_JS = readFileSync("src/demo/public/pult/feeds.js", "utf8");
const { brand } = loadBrand("config/brand.demo.json");
const at = (s: number) => new Date(Date.UTC(2026, 10, 12, 12, 0, s)).toISOString();

const VIEW: FeedsView = {
  plain: [
    { seq: 1, at: at(1), actor: "agent", emulated: false, kind: "norm", stage: "mandate", phrase: { ru: "Агент передал поручение", en: "The agent submitted a mandate" } },
    { seq: 2, at: at(2), actor: "merchant", emulated: true, kind: "conflict", stage: "payment", phrase: { ru: "<img src=x onerror=1>", en: "<b>x</b>" }, tx: "cart-1" },
  ],
  bus: [
    { seq: 1, at: at(1), stream: "monitor", ref: "POST /pao/v1/mandates", source: "agent_platform" },
    { seq: 2, at: at(2), stream: "monitor", ref: "operation.authorized", source: "pao_event", ids: { op_ref: "op-1", order_id: "ORD-1" }, tx: "cart-1" },
  ],
  txs: { "cart-1": { id: "cart-1", stage: "outcome", outcome: "paid", worst: "conflict", merchantIds: ["MRC-1"], records: 2, firstAt: at(1), lastAt: at(2), linkConflict: false } },
};

function start(o: { lang?: "ru" | "en"; storage?: "ok" | "throws"; stored?: Record<string, string> } = {}): PageEnv {
  const env = pageEnv(pultPage(o.lang ?? "ru", brand, false), o);
  env.run(FEEDS_JS);
  return env;
}
const send = (env: PageEnv, data: unknown) => env.sources.find((s) => s.url.startsWith("/pult/feeds"))!.send(data);
const rows = (env: PageEnv) => env.document.getElementById("int-feeds")!.querySelector(".feeds-list")!.querySelectorAll("li");
const fire = (env: PageEnv, type: string, detail: unknown) => env.document.dispatchEvent(new FakeEvent(type, { detail }));

describe("«Ленты» на подменённом DOM (П-5.2)", () => {
  it("ленты — в панели «Интерпретатор»; лента /pult/feeds на языке страницы; подписи из первого сообщения; новые строки сверху; данные — текстом", () => {
    const env = start();
    expect(env.sources.map((s) => s.url)).toContain("/pult/feeds?lang=ru");
    const box = env.document.getElementById("int-feeds")!;
    expect(env.document.getElementById("b-int")!.querySelector(".feeds")).toBe(box);
    send(env, { type: "hello", labels: feedsLabels("ru") });
    send(env, { type: "feeds", view: VIEW });
    const li = rows(env);
    expect(li.length).toBe(2);
    expect(li[0]!.textContent).toContain("<img src=x onerror=1>"); // текстом, разметки нет
    expect(li[0]!.querySelector("img")).toBeNull();
    expect(li[0]!.textContent).toContain("продавец · эмулятор");
    expect(li[1]!.textContent).toContain("Агент передал поручение");
    expect(box.querySelector("[data-feeds-view='plain']")!.getAttribute("aria-pressed")).toBe("true");
  });

  it("вид «Шина»: поток, что пришло, идентификаторы; выбор помнит браузер, без хранилища — тоже работает", () => {
    for (const storage of ["ok", "throws"] as const) {
      const env = start({ storage });
      send(env, { type: "hello", labels: feedsLabels("ru") });
      send(env, { type: "feeds", view: VIEW });
      env.document.querySelector("[data-feeds-view='bus']")!.click();
      const li = rows(env);
      expect(li[0]!.textContent).toContain("operation.authorized");
      expect(li[0]!.textContent).toContain("op_ref=op-1 order_id=ORD-1");
      expect(li[0]!.textContent).toContain("монитор");
      if (storage === "ok") expect(env.storage.get("pult.feeds.v1")).toBe(JSON.stringify({ view: "bus" }));
    }
    const again = start({ stored: { "pult.feeds.v1": JSON.stringify({ view: "bus" }) } });
    expect(again.document.querySelector("[data-feeds-view='bus']")!.getAttribute("aria-pressed")).toBe("true");
  });

  it("фокус на транзакцию: сводка (стадия, итог по событию, худшее, продавцы, записей) и только её строки; фокус выше — вся система", () => {
    const env = start();
    send(env, { type: "hello", labels: feedsLabels("ru") });
    send(env, { type: "feeds", view: VIEW });
    fire(env, "pult:focus", { level: "tx", tx: "cart-1" });
    const sum = env.document.getElementById("int-feeds")!.querySelector(".feeds-tx")!;
    expect(sum.textContent).toContain("Транзакция cart-1");
    for (const t of ["итог", "оплачено", "конфликт", "MRC-1", "2"]) expect(sum.textContent).toContain(t);
    expect(rows(env).length).toBe(1);
    fire(env, "pult:focus", { level: "tx", tx: "чужая" });
    expect(sum.textContent).toContain("транзакции в ленте экранов нет");
    fire(env, "pult:focus", { level: "system", tx: null });
    expect(rows(env).length).toBe(2);
    expect(sum.textContent).toContain("Сводка — при транзакции в фокусе");
  });

  it("пауза: новый вид копится, «лента на паузе»; снятие — последний вид; сброс — пусто", () => {
    const env = start();
    send(env, { type: "hello", labels: feedsLabels("ru") });
    send(env, { type: "feeds", view: { ...VIEW, plain: [VIEW.plain[0]!], bus: [VIEW.bus[0]!] } });
    expect(rows(env).length).toBe(1);
    fire(env, "pult:pause", { paused: true });
    const note = env.document.getElementById("int-feeds")!.querySelector(".feeds-paused")!;
    expect(note.hidden).toBe(false);
    expect(note.textContent).toBe("лента на паузе");
    send(env, { type: "feeds", view: VIEW });
    expect(rows(env).length).toBe(1);
    fire(env, "pult:pause", { paused: false });
    expect(note.hidden).toBe(true);
    expect(rows(env).length).toBe(2);
    send(env, { type: "reset" });
    expect(rows(env).length).toBe(1);
    expect(rows(env)[0]!.textContent).toBe("Записей пока нет");
  });

  it("en: подписи на английском; сообщение не по форме и не JSON — пропускается", () => {
    const env = start({ lang: "en" });
    expect(env.sources.map((s) => s.url)).toContain("/pult/feeds?lang=en");
    send(env, { type: "hello", labels: feedsLabels("en") });
    env.sources.find((s) => s.url.startsWith("/pult/feeds"))!.onmessage?.({ data: "{не json" });
    send(env, { type: "feeds", view: { plain: "x" } });
    send(env, { type: "feeds", view: VIEW });
    expect(env.document.querySelector("[data-feeds-view='plain']")!.textContent).toBe("In plain words");
    expect(rows(env)[1]!.textContent).toContain("The agent submitted a mandate");
  });
});
