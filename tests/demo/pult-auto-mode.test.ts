// К1.2 (переносы «после MVP»: ревью Б2 № 3 и Х1 № 9): режим «Авто» на пульте при переподключении и на паузе. Правило — по
// номерам прихода сообщений ленты: `hello` берёт режим у источника, доска пересказывает шаг режима на шине; посчитанной до
// `hello` может быть только одна доска — первая пришедшая после него (пауза пересчёта на сервере), её режим не ставится
// (узкое ревью № 15). Доска, пришедшая раньше `hello`, тоже не ставит (ревью Х1 № 9); любая следующая — ставит, в том числе
// когда на паузе накопились две и показана последняя (ревью Б2 № 3). Часы стенда в правиле не участвуют.
// Файл отдельный: `tests/demo/pult-client.test.ts` до слияния PR окна Б не правится (решение владельца 16.11,
// #issuecomment-6917815893).
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

/** Страница пульта с блоком «Поломки стенда»: только при нём есть строка «Эмулятор клиента». */
function start(clientAuto?: boolean): PageEnv {
  const env = pageEnv(pultPage("ru", brand, false, { faults: true, ...(clientAuto !== undefined && { clientAuto }) }), {});
  env.run(PULT_JS);
  return env;
}
const auto = (env: PageEnv) => env.document.getElementById("client-auto")!.textContent;
const pause = (env: PageEnv, paused: boolean) => env.document.dispatchEvent(new FakeEvent("pult:pause", { detail: { paused } }));
const cards: PultCard[] = [{ id: "T1", kind: "tx", column: "pay", worst: "norm", order: 1, since: NOW }];
/** Сообщение доски: скрипту нужны `cards` и признак режима, остальные части доски в правиле не участвуют. */
const board = (clientAuto: boolean) => ({ type: "board", board: { now: NOW, cards, jumps: [], clientAuto } });
const hello = (clientAuto?: boolean) => ({ type: "hello", status: "open", ...(clientAuto !== undefined && { clientAuto }) });

describe("режим «Авто»: доска и `hello` по порядку прихода (К1.2)", () => {
  it("ревью Б2 № 3: на паузе накопились две доски — показанная последняя ставит свой режим", () => {
    const env = start();
    const es = env.sources[0]!;
    es.send(hello(true));
    expect(auto(env)).toBe(ru("auto.on"));
    pause(env, true);
    es.send(board(true)); // первая после `hello` — её вытеснит вторая
    es.send(board(false)); // посчитана уже после `hello`
    expect(auto(env)).toBe(ru("auto.on")); // на паузе показ не меняется
    pause(env, false);
    expect(auto(env)).toBe(ru("auto.off"));
  });

  it("одна накопленная доска — первая после `hello`: режим из `hello` главнее (сомнительный случай — в его пользу)", () => {
    const env = start();
    const es = env.sources[0]!;
    es.send(hello(true));
    pause(env, true);
    es.send(board(false));
    pause(env, false);
    expect(auto(env)).toBe(ru("auto.on"));
  });

  it("ревью Х1 № 9: доска пришла на паузе до `hello` — при снятии паузы режим из `hello` держится", () => {
    const env = start();
    const es = env.sources[0]!;
    pause(env, true);
    es.send(board(false));
    es.send(hello(true)); // переподключение на паузе: режим взят у источника
    expect(auto(env)).toBe(ru("auto.on"));
    pause(env, false);
    expect(auto(env)).toBe(ru("auto.on"));
  });

  it("узкое ревью № 15: первая доска после `hello` прежний режим не возвращает; следующая — по доске", () => {
    const env = start();
    const es = env.sources[0]!;
    es.send(hello(true));
    es.send(board(false));
    expect(auto(env)).toBe(ru("auto.on"));
    es.send(board(false));
    expect(auto(env)).toBe(ru("auto.off"));
  });

  it("без `hello` с режимом доска ставит свой режим; `hello` без режима — «нет данных», дальше снова по доскам (№ 16)", () => {
    const env = start(true);
    const es = env.sources[0]!;
    es.send(board(false));
    expect(auto(env)).toBe(ru("auto.off"));
    es.send(hello());
    expect(auto(env)).toBe(ru("auto.unknown"));
    es.send(board(true));
    expect(auto(env)).toBe(ru("auto.on"));
  });

  it("ревью К1.2 № 1: второй `hello` с режимом — защита первой доски заводится заново", () => {
    const env = start();
    const es = env.sources[0]!;
    es.send(hello(true));
    es.send(board(false)); // первая после первого `hello` — не ставит
    es.send(hello(true));
    es.send(board(false)); // первая после второго `hello` — тоже не ставит
    expect(auto(env)).toBe(ru("auto.on"));
    es.send(board(false));
    expect(auto(env)).toBe(ru("auto.off"));
  });

  it("ревью К1.2 № 2: `hello` без режима после `hello` с режимом — следующая доска сразу ставит свой режим", () => {
    const env = start();
    const es = env.sources[0]!;
    es.send(hello(true));
    expect(auto(env)).toBe(ru("auto.on"));
    es.send(hello()); // режима нет — «нет данных», защита первой доски снята
    expect(auto(env)).toBe(ru("auto.unknown"));
    es.send(board(false));
    expect(auto(env)).toBe(ru("auto.off"));
  });

  it("ревью К1.2 № 3: ответ переключателя «Авто» — доска, посчитанная до нажатия, его не откатывает", async () => {
    const env = start();
    const es = env.sources[0]!;
    es.send(board(false)); // режим до нажатия — «вручную»
    expect(auto(env)).toBe(ru("auto.off"));
    env.window.fetch = () => Promise.resolve({ status: 200, json: () => Promise.resolve({ auto: true }) });
    env.document.querySelector("[data-auto='on']")!.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(auto(env)).toBe(ru("auto.on"));
    es.send(board(false)); // первая доска после нажатия — могла быть посчитана до него
    expect(auto(env)).toBe(ru("auto.on"));
    es.send(board(false)); // следующая — уже после нажатия
    expect(auto(env)).toBe(ru("auto.off"));
  });
});
