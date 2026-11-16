// Ссылки выгрузки акта ACC-1 на экране «Отчёт» пульта: каким путём щелчок попадает в `downloadExport` и что с ними на
// паузе. Здесь лежат случаи, которые нельзя положить в `tests/demo/pult-client.test.ts`: тот файл до слияния PR #20 правит
// окно Б (решение владельца 16.11, #issuecomment-6917815893), а эти случаи появились в кирпиче К1.3 окна А. Обратно файлы
// не сводятся (П21 — долгов не заводим): предмет этого файла — пути щелчка по ссылке выгрузки и её состояние на паузе.
//  - К1.3 (ревью Б2 № 7): средняя кнопка даёт `auxclick` — он тоже перехватывается, иначе браузер открыл бы адрес сам и
//    при 409 человек получил бы ошибку загрузки вместо подсказки «соберите заново». Cmd / Ctrl + щелчок сюда не относится:
//    это обычный `click` левой кнопкой, он перехватывался и до К1.3.
//  - К1.3 (ревью К1.3 № 1): правая кнопка и «назад / вперёд» тоже дают `auxclick` — по ним пульт не делает ничего, иначе
//    жест «посмотреть контекстное меню» отправлял бы запрос и снимал ссылки с экрана (П12 — «смотреть, не действовать»).
//  - К1.3 (Х1 № 8): на паузе ссылок в разметке нет вовсе, и ни один путь щелчка по панели запроса не отправляет (П12 п. 5).
//    Прямой вызов на паузе закреплён в `pult-client.test.ts:1578-1582` (окно Б) — здесь проверяются пути щелчка.
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
const BUILT_AT = "2026-11-16T12:00:00.000Z";

function start(): PageEnv {
  const env = pageEnv(pultPage("ru", brand, false, {}), {});
  env.run(PULT_JS);
  return env;
}
const cards: PultCard[] = [{ id: "T1", kind: "tx", column: "pay", worst: "norm", order: 1, since: NOW }];
const boardMsg = { type: "board", board: { now: NOW, cards, jumps: [] } };
const SNAP = { builtAt: BUILT_AT, totals: { tests: 25 }, agreeLabels: {}, rows: [], unlinked: 0 };
const tick = () => new Promise((r) => setTimeout(r, 0));
const pause = (env: PageEnv, paused: boolean) => env.document.dispatchEvent(new FakeEvent("pult:pause", { detail: { paused } }));

/** Собранный отчёт со ссылками выгрузки; `calls` — обращения к `fetch` (сборка и выгрузки). */
async function withReport(env: PageEnv): Promise<string[]> {
  const calls: string[] = [];
  env.window.fetch = (url: string) => {
    calls.push(url);
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(SNAP) });
  };
  env.sources[0]!.send(boardMsg);
  env.document.getElementById("b-log")!.querySelectorAll("button[data-report]")[0]!.click();
  await tick();
  return calls;
}

describe("ссылки выгрузки акта: пути щелчка и пауза (К1.3)", () => {
  it("ревью Б2 № 7: средняя кнопка (`auxclick`, button 1) идёт через `downloadExport`, браузер адрес сам не открывает", async () => {
    const env = start();
    const calls = await withReport(env);
    const box = env.document.getElementById("b-log")!;
    const link = box.querySelectorAll("a[data-export]")[0]!;
    const href = link.getAttribute("href")!;
    expect(calls).toHaveLength(1); // пока только сборка отчёта
    const aux = new FakeEvent("auxclick", { bubbles: true, button: 1 });
    link.dispatchEvent(aux);
    expect(aux.defaultPrevented).toBe(true); // браузер ссылку не откроет
    await tick();
    expect(calls[1]).toBe(href); // выгрузка ушла тем же путём, что по обычному щелчку
  });

  it("ревью К1.3 № 1: правая кнопка и «назад / вперёд» — пульт не делает ничего, контекстное меню остаётся браузеру", async () => {
    const env = start();
    const calls = await withReport(env);
    const box = env.document.getElementById("b-log")!;
    const link = box.querySelectorAll("a[data-export]")[0]!;
    for (const button of [2, 3, 4]) {
      const aux = new FakeEvent("auxclick", { bubbles: true, button });
      link.dispatchEvent(aux);
      await tick();
      expect(aux.defaultPrevented, `кнопка ${button}`).toBe(false);
      expect(calls, `кнопка ${button}`).toHaveLength(1); // запроса выгрузки нет
    }
    // Ссылки с экрана не снялись: жест «посмотреть» ничего не изменил.
    expect(box.querySelectorAll("a[data-export]")).toHaveLength(3);
  });

  it("`auxclick` средней кнопкой не по ссылке выгрузки ничего не отправляет и события не отменяет", async () => {
    const env = start();
    const calls = await withReport(env);
    const box = env.document.getElementById("b-log")!;
    const aux = new FakeEvent("auxclick", { bubbles: true, button: 1 });
    box.querySelectorAll("button[data-report]")[0]!.dispatchEvent(aux);
    await tick();
    expect(aux.defaultPrevented).toBe(false);
    expect(calls).toHaveLength(1);
  });

  it("Х1 № 8: на паузе ссылок выгрузки нет, и щелчки по панели запроса не отправляют", async () => {
    const env = start();
    const calls = await withReport(env);
    const box = env.document.getElementById("b-log")!;
    const link = box.querySelectorAll("a[data-export]")[0]!;
    expect(box.querySelectorAll("a[data-export]")).toHaveLength(3);
    pause(env, true);
    expect(box.querySelectorAll("a[data-export]")).toEqual([]);
    expect(box.textContent).toContain(ru("act.paused"));
    // Узел ссылки, снятый с экрана, у человека мог остаться под курсором: оба пути щелчка по нему молчат.
    link.dispatchEvent(new FakeEvent("click", { bubbles: true }));
    link.dispatchEvent(new FakeEvent("auxclick", { bubbles: true, button: 1 }));
    // И кнопка «Собрать отчёт» на паузе тоже не отправляет (П12 п. 5).
    box.querySelectorAll("button[data-report]")[0]!.click();
    await tick();
    expect(calls).toHaveLength(1);
    pause(env, false);
    expect(box.querySelectorAll("a[data-export]")).toHaveLength(3);
  });
});
