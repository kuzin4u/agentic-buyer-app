// Кнопки выгрузки акта ACC-1 на экране «Отчёт» пульта: каким путём щелчок попадает в `downloadExport`, что с кнопками на
// паузе и что в панели «Журнал» нет ни одной ссылки. Здесь лежат случаи, которые нельзя положить в
// `tests/demo/pult-client.test.ts`: тот файл до слияния PR #20 вело окно Б (решение владельца 16.11,
// #issuecomment-6917815893), а эти случаи появились в кирпиче К1.3 окна А. Обратно файлы не сводятся (П21 — долгов не
// заводим): предмет этого файла — пути щелчка по выгрузке и её состояние на паузе.
//
// **Файл переписан при слиянии PR #20** (прежнее имя — `pult-export-links.test.ts`, переименован через `git mv`). К1.3
// перехватывал `auxclick` у `a[data-export]`, потому что у ссылки оставался браузерный путь мимо `downloadExport`:
// средняя кнопка и «сохранить ссылку как» открывали адрес сами, и при 409 человек получал ошибку загрузки или файл с
// `{"error":"SNAPSHOT_GONE"}` вместо подсказки «соберите заново» (ревью Б2 № 7). Б-К5 окна Б убрало **причину**: выгрузка
// стала кнопкой, адреса в разметке нет, и перехватывать нечего — обработчик `auxclick` снят как оставшийся без предмета.
// Проверки сохранены по смыслу, а не по букве: доказывается, что пути мимо `downloadExport` нет ни у одного жеста.
//  - ревью Б2 № 7 целиком: в панели «Журнал» нет ни одной ссылки, поэтому «сохранить ссылку как» не предлагается.
//  - ревью К1.3 № 1 (П12 — «смотреть, не действовать»): правая кнопка и «назад / вперёд» ничего не отправляют и кнопки
//    с экрана не снимают; средняя — тоже, и событие не отменяется: отменять нечего, навигации у кнопки нет.
//  - К1.3 (Х1 № 8): на паузе кнопок в разметке нет вовсе, и ни один путь щелчка по панели запроса не отправляет (П12 п. 5).
//    Прямой вызов на паузе закреплён в `pult-client.test.ts` (окно Б) — здесь проверяются пути щелчка.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ACC1_EXPORTS, ACC1_EXPORT_LABEL } from "../../src/pult/acc1.js";
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
/** Номер снимка — опознаватель выгрузки (К2.1): без него кнопок нет вовсе, адрес строится от номера, а не от времени. */
const SNAP_NO = 21;

function start(): PageEnv {
  const env = pageEnv(pultPage("ru", brand, false, {}), {});
  env.run(PULT_JS);
  return env;
}
const cards: PultCard[] = [{ id: "T1", kind: "tx", column: "pay", worst: "norm", order: 1, since: NOW }];
const boardMsg = { type: "board", board: { now: NOW, cards, jumps: [] } };
const SNAP = { no: SNAP_NO, builtAt: BUILT_AT, totals: { tests: 25 }, agreeLabels: {}, rows: [], unlinked: 0 };
const tick = () => new Promise((r) => setTimeout(r, 0));
const pause = (env: PageEnv, paused: boolean) => env.document.dispatchEvent(new FakeEvent("pult:pause", { detail: { paused } }));

/** Собранный отчёт с кнопками выгрузки; `calls` — обращения к `fetch` (сборка и выгрузки). */
async function withReport(env: PageEnv, snap: unknown = SNAP): Promise<string[]> {
  const calls: string[] = [];
  env.window.fetch = (url: string) => {
    calls.push(url);
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(snap) });
  };
  env.sources[0]!.send(boardMsg);
  env.document.getElementById("b-log")!.querySelectorAll("button[data-report]")[0]!.click();
  await tick();
  return calls;
}

describe("кнопки выгрузки акта: пути щелчка и пауза (К1.3, Б-К5)", () => {
  it("ревью Б2 № 7: обычный щелчок идёт через `downloadExport`, адрес строится от номера снимка", async () => {
    const env = start();
    const calls = await withReport(env);
    const box = env.document.getElementById("b-log")!;
    const out = box.querySelectorAll("button[data-export]")[0]!;
    expect(calls).toHaveLength(1); // пока только сборка отчёта
    out.click();
    await tick();
    expect(calls[1]).toBe(out.dataset.exportUrl);
    // Опознаватель — номер снимка, а не время сборки: по времени два снимка совпали бы при замороженных часах стенда.
    expect(calls[1]).toContain(`at=${SNAP_NO}`);
    expect(calls[1]).not.toContain(BUILT_AT);
  });

  it("ревью Б2 № 7 целиком: в панели «Журнал» нет ни одной ссылки — «сохранить ссылку как» не предлагается", async () => {
    const env = start();
    await withReport(env);
    const box = env.document.getElementById("b-log")!;
    expect(box.querySelectorAll("button[data-export]")).toHaveLength(3);
    // Ни ссылок вообще, ни адреса у кнопок: браузерного пути мимо `downloadExport` не осталось.
    expect(box.querySelectorAll("a")).toEqual([]);
    expect(box.querySelectorAll("button[data-export]").map((b) => b.getAttribute("href"))).toEqual([null, null, null]);
  });

  it("ревью К1.3 № 1: непервичные кнопки мыши (средняя, правая, «назад / вперёд») ничего не отправляют", async () => {
    const env = start();
    const calls = await withReport(env);
    const box = env.document.getElementById("b-log")!;
    const out = box.querySelectorAll("button[data-export]")[0]!;
    for (const button of [1, 2, 3, 4]) {
      const aux = new FakeEvent("auxclick", { bubbles: true, button });
      out.dispatchEvent(aux);
      await tick();
      // Обработчика `auxclick` больше нет: отменять нечего, навигации у кнопки тоже нет.
      expect(aux.defaultPrevented, `кнопка ${button}`).toBe(false);
      expect(calls, `кнопка ${button}`).toHaveLength(1); // запроса выгрузки нет
    }
    // Кнопки с экрана не снялись: жест «посмотреть» ничего не изменил.
    expect(box.querySelectorAll("button[data-export]")).toHaveLength(3);
  });

  it("ревью слияния PR #20 № 1: негодный номер снимка — подписи без действия, запроса нет", async () => {
    // Годен только вид токена, который строит сервер (`String(PultReport.no)`): цифры без знака и точки. Иначе выгрузка
    // уходила бы живым запросом и человек получал подсказку «соберите заново» вместо отсутствия действия — код расходился
    // бы с правилом П12 «смотреть, не действовать».
    for (const no of ["abc", "", -3, 1.5, Number.NaN, null]) {
      const env = start();
      const calls = await withReport(env, { ...SNAP, no });
      const box = env.document.getElementById("b-log")!;
      const ex = box.querySelector(".report-export")!;
      expect(box.querySelectorAll("button[data-export]"), String(no)).toEqual([]);
      // Подписи выгрузок на месте — человек видит, что выгрузка есть, но она недоступна.
      for (const f of ACC1_EXPORTS) expect(ex.textContent, String(no)).toContain(ACC1_EXPORT_LABEL[f].ru);
      expect(calls, String(no)).toHaveLength(1); // только сборка отчёта
    }
  });

  it("Х1 № 8: на паузе кнопок выгрузки нет, и щелчки по панели запроса не отправляют", async () => {
    const env = start();
    const calls = await withReport(env);
    const box = env.document.getElementById("b-log")!;
    const out = box.querySelectorAll("button[data-export]")[0]!;
    expect(box.querySelectorAll("button[data-export]")).toHaveLength(3);
    pause(env, true);
    expect(box.querySelectorAll("button[data-export]")).toEqual([]);
    expect(box.textContent).toContain(ru("act.paused"));
    // Узел кнопки, снятый с экрана, у человека мог остаться под курсором: оба пути щелчка по нему молчат.
    out.dispatchEvent(new FakeEvent("click", { bubbles: true }));
    out.dispatchEvent(new FakeEvent("auxclick", { bubbles: true, button: 1 }));
    // И кнопка «Собрать отчёт» на паузе тоже не отправляет (П12 п. 5).
    box.querySelectorAll("button[data-report]")[0]!.click();
    await tick();
    expect(calls).toHaveLength(1);
    pause(env, false);
    expect(box.querySelectorAll("button[data-export]")).toHaveLength(3);
  });
});
