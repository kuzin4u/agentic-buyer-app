// Н-3, К2а — тело итога сверяется **с документом** К-Б v1.4 § 5.8 (находка ревью К2а № 5).
//
// Зачем свой файл сверки: общий контрактный тест (`tests/contract/ui-v1.test.ts`) и помощник `tests/support/
// contract-doc.ts` привязаны к документу v1.0, и переводит их на v1.4 **окно Б** после слияния PR #28 — их в этой
// ветке не трогают (указание владельца 22.11.2026). Но файл v1.4 уже в репозитории, сверять есть с чем, и молчать
// нельзя: иначе новые поля § 5.8 (`reason`, нулевые `fulfilment` и `amount`, `path`) не привязаны к документу ничем,
// и расхождение кода с действующей версией не покраснеет.
//
// Сверяется **документ против собранного тела**, а не тело против своих же ожиданий: имена полей и перечень причин
// берутся из файла разбором, а не переписываются литералами (Р-1511).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ORDER_ABSENCE_REASONS } from "../../src/contract/ui-v1/methods.js";
import { orderBody, type OrderBodyDeps } from "../../src/order/response.js";
import { parseOrderTexts, type OrderTexts } from "../../src/order/texts.js";
import type { ShellText } from "../../src/order/port.js";
import { read, unsettled } from "./fixture.js";

const DOC = new URL("../../docs/reference/2026-11-21-kontrakt-K-B-ui-v1-v1.4.md", import.meta.url);
const doc = readFileSync(DOC, "utf8");

/** Раздел § 5.8 целиком — от его заголовка до заголовка § 5.9. */
const section = (() => {
  const from = doc.indexOf("## 5.8 ");
  const to = doc.indexOf("## 5.9 ");
  expect(from).toBeGreaterThan(0);
  expect(to).toBeGreaterThan(from);
  return doc.slice(from, to);
})();

const texts: OrderTexts = parseOrderTexts(
  JSON.parse(readFileSync(new URL("../../config/order.default.json", import.meta.url), "utf8")),
);

const shell: ShellText = { notSpent: () => "не списано", done: () => "сделано" };
const deps: OrderBodyDeps = { lang: "ru", texts, shell };

/** Имена полей верхнего уровня из **первого** примера § 5.8 (полное тело). */
const docFields = (): readonly string[] => {
  const json = section.slice(section.indexOf("```json") + 7, section.indexOf("```", section.indexOf("```json") + 7));
  const names = [...json.matchAll(/^\s{2}"([a-z_]+)"\s*:/gm)].map((m) => m[1] as string);
  expect(names.length).toBeGreaterThan(5);
  return names;
};

/**
 * Поле документа, которого в теле нет **по решению владельца**, а не по забывчивости: обёртка линии пути `path`
 * уйдёт из разделов использования выпуском v1.5 (решение 22.11.2026 в ответ на находку ревью К2а № 3). Числа в
 * примерах § 5.2, § 5.3, § 5.6 и § 5.8 выведены из самого примера, а не из источника (Р-1511), а по Р-1601
 * знаменателей два — «из 5» и «из 8». Исключение названо здесь **одним списком**: появится ещё одно, и его придётся
 * назвать так же, а не умолчать.
 */
const DROPPED_BY_OWNER: readonly string[] = ["path"];

describe("К2а: тело § 5.8 сходится с документом v1.4", () => {
  it("каждое поле примера документа есть в собранном теле, кроме снятого решением владельца", () => {
    const body = orderBody(read(), deps) as unknown as Record<string, unknown>;
    for (const name of docFields()) {
      if (DROPPED_BY_OWNER.includes(name)) continue;
      expect(Object.keys(body), name).toContain(name);
    }
    // Снятое — действительно снято: иначе исключение прикрывало бы поле, которое в теле есть.
    for (const name of DROPPED_BY_OWNER) expect(Object.keys(body), name).not.toContain(name);
  });

  it("лишних полей у тела нет: каждое поле ответа названо документом", () => {
    const body = orderBody(read(), deps) as unknown as Record<string, unknown>;
    // `reason` стоит во втором примере § 5.8 (случай «итога ещё нет»), а не в первом — его ищем во всём разделе.
    for (const name of Object.keys(body)) expect(section, name).toContain(`"${name}"`);
  });

  it("перечень причин — ровно тот, что назван документом", () => {
    for (const reason of ORDER_ABSENCE_REASONS) expect(section).toContain(reason);
    // И наоборот: причина, названная в документе, заведена в коде. Имена причин в § 5.8 — заглавными с подчёркиванием.
    const inDoc = new Set([...section.matchAll(/`([A-Z][A-Z_]+_ABSENT)`/g)].map((m) => m[1] as string));
    expect([...inDoc].sort()).toEqual([...ORDER_ABSENCE_REASONS].sort());
  });

  it("документ требует источник и время сверки **всегда** — и в случае без записи об исполнении тоже", () => {
    expect(section).toMatch(/`source` и `checked_at` есть всегда/);
    const body = orderBody(read({ operation: unsettled(), state: "SETTLING" }), deps);
    expect(body.fulfilment).toBeNull();
    expect(body.source.checked_at).toBeTruthy();
    expect(body.source.text).toBeTruthy();
  });

  it("документ говорит, что кода отказа у случая нет — и приложение его не заводит", () => {
    expect(section).toMatch(/Кода отказа у этого случая \*\*нет\*\*/);
    // Тело собирается, а не подменяется ошибкой: проверка на то, что ответ остаётся телом § 5.8.
    expect(orderBody(read({ operation: unsettled(), state: "SETTLING" }), deps).step).toBe("U7");
  });
});
