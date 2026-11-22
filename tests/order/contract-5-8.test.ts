// Н-3, К2а — тело итога сверяется **с документом** К-Б § 5.8 (находка ревью К2а № 5).
//
// **Путь к документу — из одного места** (`tests/support/contract-doc.ts`), с кирпича К-Ба ИН-П2. Прежде у этого файла
// был свой путь: он завёлся в Н-3, пока общий помощник стоял на v1.0, а шапка обещала «перевод на v1.4 окном Б».
// Перевода на v1.4 не было и не будет — v1.4 выпущена и отменена v1.5 в один день 22.11, и код переведён с v1.3 сразу
// на v1.5 (кирпич К-Б). Свой путь к отменённому файлу — ровно тот разъезд, против которого один путь и завели
// (находка ревью К7 № 8 ИН-П1): правка § 5.8 в следующей версии этот файл не затронула бы, и он остался бы зелёным
// против документа, сверяться с которым запрещено. Расхождение № 26 STATUS закрыто этим кирпичом.
//
// Сверяется **документ против собранного тела**, а не тело против своих же ожиданий: имена полей и перечень причин
// берутся из файла разбором, а не переписываются литералами (Р-1511).
import { describe, expect, it } from "vitest";
import { ORDER_ABSENCE_REASONS } from "../../src/contract/ui-v1/methods.js";
import { orderBody } from "../../src/order/response.js";
import { contractDoc } from "../support/contract-doc.js";
import { deps as depsOf, read, texts, unsettled } from "./fixture.js";

const doc = contractDoc();

/** Раздел § 5.8 целиком — от его заголовка до заголовка § 5.9. */
const section = (() => {
  const from = doc.indexOf("## 5.8 ");
  const to = doc.indexOf("## 5.9 ");
  expect(from).toBeGreaterThan(0);
  expect(to).toBeGreaterThan(from);
  return doc.slice(from, to);
})();

// Тексты, заглушка каркаса и зависимости — из **общей** фикстуры модуля (находка ревью К4 № 6).
const deps = depsOf();

/**
 * Имена полей верхнего уровня из **первого** примера § 5.8 (полное тело).
 *
 * Разбор берёт **все** поля строки, а не первое (кирпич К-Ба, находка ревью К-Ба № 3). Прежняя регулярка
 * `^\s{2}"…"\s*:` видела по одному полю на строку, а в примере v1.5 они стоят парами — `"state": "DONE", "step":
 * "U7",` и `"reason": null, "reason_text": null,`. Из двенадцати полей в перечень попадали десять: **`step` и
 * `reason_text` не требовались вовсе**, и довод «поле названо примером документа» на них не держался.
 *
 * Строка обрезается по первой `{` или `[`: дальше идут **вложенные** поля (`operation.status`, `fulfilment.final`),
 * а они не поля тела — требовать их у верхнего уровня значило бы ждать от тела плоской формы, которой у него нет.
 * Строки-продолжения вложенного объекта начинаются с большего отступа и в перечень не попадают.
 */
const docFields = (): readonly string[] => {
  const json = section.slice(section.indexOf("```json") + 7, section.indexOf("```", section.indexOf("```json") + 7));
  const names = json
    .split("\n")
    .filter((line) => /^ {2}"/.test(line))
    .flatMap((line) => {
      const flat = line.split(/[{[]/)[0] as string;
      return [...flat.matchAll(/"([a-z_]+)"\s*:/g)].map((m) => m[1] as string);
    });
  // Число названо: пропади половина полей из-за правки разбора или примера — покраснеет здесь, а не «тихо сойдётся»
  // на меньшем перечне. Ровно это и прошло незамеченным до находки № 3.
  expect(names).toEqual([
    ...["state", "step", "operation", "fulfilment", "reason", "reason_text"],
    ...["source", "done_line", "refund", "stops", "agent_fee", "act"],
  ]);
  return names;
};

// **Списков исключений больше нет — и это усиление, а не послабление** (кирпич К-Ба ИН-П2). Было два:
//   `DROPPED_BY_OWNER = ["path"]` — поле документа, которого в теле нет по решению владельца (Р-1700);
//   `ADDED_BY_OWNER = ["reason_text"]` — поле тела, которого ещё не было в документе (Р-1697).
// Выпуск **v1.5** внёс оба решения в § 5.8: обёртка `path` из раздела снята, `reason_text` в нём есть. Поэтому обе
// нормы теперь сверяются **напрямую**, без списка: `reason_text` требует от тела первый случай (поле названо
// примером документа — после правки разбора в этом же кирпиче, см. `docFields`), а появись в теле `path` —
// покраснеет второй («лишних полей нет»: в § 5.8 имени `path` нет). Список, переживший своё условие, читался бы как
// действующее исключение — та же находка, что К3а № 5.

describe("К2а: тело § 5.8 сходится с действующим документом", () => {
  it("каждое поле примера документа есть в собранном теле", () => {
    const body = orderBody(read(), deps) as unknown as Record<string, unknown>;
    for (const name of docFields()) expect(Object.keys(body), name).toContain(name);
  });

  it("лишних полей у тела нет: каждое поле ответа названо документом", () => {
    const body = orderBody(read(), deps) as unknown as Record<string, unknown>;
    // `reason` стоит во втором примере § 5.8 (случай «итога ещё нет»), а не в первом — его ищем во всём разделе.
    for (const name of Object.keys(body)) expect(section, name).toContain(`"${name}"`);
  });

  it("`reason_text` и `withheld` названы документом, а не только решением владельца", () => {
    // Два поля, которые до v1.5 стояли в коде раньше документа (Р-1697 и Р-1707, кирпичи К3а и К4а). Проверка
    // оставлена отдельным случаем: именно она покраснеет, если путь к документу однажды снова уедет на версию, где
    // этих полей нет, — то есть сторожок сменил смысл с «поля ещё нет» на «поле есть и там, и там».
    expect(section).toContain(`"reason_text"`);
    expect(section).toContain("`withheld`");
    const absent = orderBody(read({ operation: unsettled(), state: "SETTLING" }), deps);
    expect(Object.keys(absent)).toContain("reason_text");
  });

  it("обёртки линии пути в теле нет — её снял выпуск v1.5 (Р-1700)", () => {
    // Прежде это держал список исключений; теперь — сам документ: имени `path` в § 5.8 нет, поэтому поле в теле
    // поймал бы и случай «лишних полей нет». Случай оставлен прямым, чтобы правило читалось без разбора двух других.
    const body = orderBody(read(), deps) as unknown as Record<string, unknown>;
    expect(Object.keys(body)).not.toContain("path");
    expect(section).not.toContain(`"path"`);
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
    expect(body.source.checked_at).toBe("2026-11-21T20:15:00.000Z");
    // **Расхождение закрыто выпуском v1.5** (пункт 5 «Что изменилось»; было — находка ревью К3а № 3): во втором
    // примере § 5.8 v1.4 стоял текст «Запись об исполнении Платформы» при `fulfilment: null`, хотя сам же абзац
    // запрещает подставлять ближайшее известное. Прав оказался код, и документ приведён к нему — теперь источников в
    // § 5.8 два. Ожидание остаётся **значением из источника**: приведение текста к одному источнику задним числом
    // покраснеет здесь.
    expect(body.source.text).toBe(texts.sources.PLATFORM_OPERATION.ru);
    expect(body.source.text).not.toBe(texts.sources.PLATFORM_FULFILMENT.ru);
  });

  it("документ говорит, что кода отказа у случая нет — и приложение его не заводит", () => {
    expect(section).toMatch(/Кода отказа у этого случая \*\*нет\*\*/);
    // Тело собирается, а не подменяется ошибкой: проверка на то, что ответ остаётся телом § 5.8.
    expect(orderBody(read({ operation: unsettled(), state: "SETTLING" }), deps).step).toBe("U7");
  });
});
