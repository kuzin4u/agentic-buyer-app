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
import { orderBody } from "../../src/order/response.js";
import { deps as depsOf, read, texts, unsettled } from "./fixture.js";

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

// Тексты, заглушка каркаса и зависимости — из **общей** фикстуры модуля (находка ревью К4 № 6).
const deps = depsOf();

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

/**
 * Поле, которое есть в теле **раньше документа** — по решению владельца, а не самовольно: `reason_text` добавлен
 * совместимым расширением § 5.8 (**Р-1697**, кирпич К3а) и входит в документ выпуском **v1.5**. Форма — та же, что у
 * пары `status` + `decline_text` в этом же теле: код машине, текст человеку, без вложенности.
 *
 * Список назван здесь, чтобы «поля нет в документе» не стало тихим исключением: пока поле в этом списке, тест
 * требует, чтобы оно в теле **было** — иначе решение владельца осталось бы только на словах.
 */
const ADDED_BY_OWNER: readonly string[] = ["reason_text"];

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

  it("лишних полей у тела нет: каждое поле ответа названо документом или решением владельца", () => {
    const body = orderBody(read(), deps) as unknown as Record<string, unknown>;
    // `reason` стоит во втором примере § 5.8 (случай «итога ещё нет»), а не в первом — его ищем во всём разделе.
    for (const name of Object.keys(body)) {
      if (ADDED_BY_OWNER.includes(name)) continue;
      expect(section, name).toContain(`"${name}"`);
    }
  });

  it("поля, добавленные решением владельца раньше документа, в теле есть — решение не осталось на словах", () => {
    const body = orderBody(read(), deps) as unknown as Record<string, unknown>;
    for (const name of ADDED_BY_OWNER) expect(Object.keys(body), name).toContain(name);
    // И они действительно ещё не в документе: попадут туда с v1.5, и тогда строка списка снимается. Ищем **и в
    // примере, и в прозе** (имя в бэктиках): v1.5 может назвать поле словами, не поставив его в пример, и тогда
    // исключение задержалось бы в коде после того, как перестало быть исключением (находка ревью К3а № 5).
    for (const name of ADDED_BY_OWNER) {
      expect(section, name).not.toContain(`"${name}"`);
      expect(section, name).not.toContain(`\`${name}\``);
    }
  });

  it("списки исключений не пересекаются: имя не может быть и снятым, и добавленным", () => {
    // Иначе правка одного списка молча задвоила бы имя, и смысл исключения стал бы непонятен (находка ревью К3а № 6).
    expect(DROPPED_BY_OWNER.filter((n) => ADDED_BY_OWNER.includes(n))).toEqual([]);
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
    // **Расхождение с примером документа, названное в STATUS** (находка ревью К3а № 3): во втором примере § 5.8 стоит
    // текст «Запись об исполнении Платформы» при `fulfilment: null`, а код даёт второй код источника — «записи об
    // исполнении ещё нет». Прав код: сам же абзац v1.4 запрещает подставлять ближайшее известное. Ожидание —
    // **значением из источника**, чтобы приведение к примеру задним числом покраснело здесь; документ правит владелец
    // выпуском v1.5.
    expect(body.source.text).toBe(texts.sources.PLATFORM_OPERATION.ru);
    expect(body.source.text).not.toBe(texts.sources.PLATFORM_FULFILMENT.ru);
  });

  it("документ говорит, что кода отказа у случая нет — и приложение его не заводит", () => {
    expect(section).toMatch(/Кода отказа у этого случая \*\*нет\*\*/);
    // Тело собирается, а не подменяется ошибкой: проверка на то, что ответ остаётся телом § 5.8.
    expect(orderBody(read({ operation: unsettled(), state: "SETTLING" }), deps).step).toBe("U7");
  });
});
