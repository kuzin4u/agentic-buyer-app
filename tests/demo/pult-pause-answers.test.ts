// Ответ стенда на реакцию, запрошенную до паузы, приходит уже на паузе. Эти случаи нельзя положить в
// `tests/demo/pult-client.test.ts`: тот файл до слияния PR #20 правит окно Б (решение владельца 16.11,
// #issuecomment-6917815893), а случай закрывается кирпичом К2.2 окна А. Обратно файлы не сводятся (П21 — долгов не заводим):
// предмет этого файла — что видно на паузе из ответов, запрошенных до неё.
//  - К2.2 (Х1 № 10, прежняя пометка «к сведению»): ответ показывается под строкой «Контроля» и поверх замороженной доски.
//    Это допустимо по смыслу паузы «смотреть, не действовать» (П12): запрос ушёл по действию человека до паузы, пауза
//    останавливает действия и пересчёт, а не прячет то, что человек уже вызвал. Здесь это закреплено, а не оставлено словом.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { pultPage } from "../../src/demo/dash-pult.js";
import { loadBrand } from "../../src/demo/server.js";
import { PULT } from "../../src/pult/phrases.js";
import type { PultCard } from "../../src/pult/feed.js";
import { FakeEvent, pageEnv, type PageEnv } from "../support/fake-dom.js";

const PULT_JS = readFileSync("src/demo/public/pult/pult.js", "utf8");
const { brand } = loadBrand("config/brand.demo.json");
const ru = (k: keyof typeof PULT) => PULT[k].ru;
const NOW = "2026-11-16T12:00:10.000Z";
const T0 = "2026-11-16T11:59:00.000Z";

function start(): PageEnv {
  const env = pageEnv(pultPage("ru", brand, false, { actions: true }), {});
  env.run(PULT_JS);
  return env;
}
const card: PultCard = { id: "CT1", kind: "tx", column: "pay", worst: "norm", order: 1, since: T0, intentId: "IT1", cartMandateId: "MC-CT1" };
const boardMsg = {
  type: "board",
  board: {
    now: NOW,
    cards: [card],
    jumps: [],
    control: { passports: [], waits: [], waitMs: 15_000, active: [{ id: "CT1", column: "pay", since: T0 }], counts: { txs: 1, wrong: 0 } },
  },
};
const pause = (env: PageEnv, paused: boolean) => env.document.dispatchEvent(new FakeEvent("pult:pause", { detail: { paused } }));
const ctl = (env: PageEnv) => env.document.getElementById("b-ctl")!;
const results = (env: PageEnv) => ctl(env).querySelectorAll(".act-result").map((x) => x.textContent).join(" ");
const stopButton = (env: PageEnv) => ctl(env).querySelectorAll("button[data-act]").find((b) => b.dataset.act === "stop");

describe("ответы реакций, пришедшие на паузе (К2.2)", () => {
  it("Х1 № 10: запрос ушёл до паузы, ответ пришёл на паузе — показывается, кнопки при этом неактивны", async () => {
    const env = start();
    let reply!: (v: unknown) => void;
    const calls: string[] = [];
    env.window.fetch = (url: string) => {
      calls.push(url);
      return new Promise((ok) => (reply = ok));
    };
    env.sources[0]!.send(boardMsg);
    stopButton(env)!.click();
    expect(calls).toHaveLength(1);
    pause(env, true);
    expect(stopButton(env)).toBeUndefined(); // на паузе кнопок реакции нет (П12)
    // Ответ стенда по запросу, который человек отправил сам до паузы.
    reply({ json: () => Promise.resolve({ action: "stop", obj: "MC-CT1", outcome: "done", result: { ok: true, status: 200 } }) });
    await new Promise((r) => setTimeout(r, 0));
    expect(results(env)).toContain(ru("act.done"));
    expect(ctl(env).textContent).toContain(ru("act.paused"));
    // Новых запросов пауза не допускает: ответ — не повод для действия.
    expect(calls).toHaveLength(1);
  });

  it("ответ остаётся на экране и после снятия паузы, второго запроса не возникает", async () => {
    const env = start();
    let reply!: (v: unknown) => void;
    const calls: string[] = [];
    env.window.fetch = (url: string) => {
      calls.push(url);
      return new Promise((ok) => (reply = ok));
    };
    env.sources[0]!.send(boardMsg);
    stopButton(env)!.click();
    pause(env, true);
    reply({ json: () => Promise.resolve({ action: "stop", obj: "MC-CT1", outcome: "refused", result: { ok: false, status: 409, code: "MANDATE_NOT_ACTIVE" } }) });
    await new Promise((r) => setTimeout(r, 0));
    expect(results(env)).toContain("MANDATE_NOT_ACTIVE");
    pause(env, false);
    expect(results(env)).toContain("MANDATE_NOT_ACTIVE");
    expect(stopButton(env)).toBeDefined();
    expect(calls).toHaveLength(1);
  });
});
