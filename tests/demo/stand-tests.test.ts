// П-11.4а (Р-1500): закрытая таблица 12 тестов Н-xx по виду — сверка со стендом Платформы, драйвером нарушителя и движком
// пульта. Вид проверяется поведением стенда в режиме сбоев (`createStand` в том же процессе), а не списком: «П» — стенд принимает `arm`, «ПР» — принимает `mark`;
// Н-10 — стенд отказывает в обоих (не воспроизводится по инварианту 1).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createStand, DEMO_TESTS, type DemoTest, type Stand } from "agentic-ps-platform/stand";
import { FAULT_TESTS } from "../../src/demo/fault-tests.js";
import { DEMO_SHOPS } from "../../src/demo/shops.js";
import { STAND_TESTS } from "../../src/pult/standlog.js";
import {
  NOT_REPRODUCIBLE_LABEL,
  NOT_REPRODUCIBLE_REASONS,
  STAND_TEST_KIND_LABEL,
  STAND_TEST_KINDS,
  STAND_TEST_TABLE,
} from "../../src/dashboards/stand-tests.js";

const rows = STAND_TEST_TABLE as readonly { test: string; kind: string; reason?: string }[];
const ofKind = (...k: string[]) => rows.filter((r) => k.includes(r.kind)).map((r) => r.test);

describe("П-11.4а: таблица тестов Н-xx по виду", () => {
  it("12 строк — ровно перечень стенда DEMO_TESTS и движка пульта STAND_TESTS, по порядку", () => {
    expect(rows.map((r) => r.test)).toEqual([...DEMO_TESTS]);
    expect(rows.map((r) => r.test)).toEqual([...STAND_TESTS]);
  });

  it("«ПР» (и Н-05 — оба вида) — ровно перечень драйвера нарушителя FAULT_TESTS", () => {
    expect(ofKind("violator", "stand_fault_and_violator")).toEqual([...FAULT_TESTS]);
  });

  it("Н-10 — единственный «не воспроизводится», причина — инвариант 1", () => {
    expect(rows.filter((r) => r.kind === "not_reproducible")).toEqual([{ test: "Н-10", kind: "not_reproducible", reason: "INVARIANT_1" }]);
  });

  it("подписи видов — ru и en, у каждого вида свои метки «(П)» / «(ПР)» (перестановка подписей — красный)", () => {
    const want: Record<string, { p: boolean; pr: boolean }> = {
      stand_fault: { p: true, pr: false },
      violator: { p: false, pr: true },
      stand_fault_and_violator: { p: true, pr: true },
      not_reproducible: { p: false, pr: false },
    };
    for (const k of STAND_TEST_KINDS)
      for (const l of ["ru", "en"] as const) {
        const s = STAND_TEST_KIND_LABEL[k][l];
        expect(s.trim(), `${k} ${l}`).not.toBe("");
        expect({ p: s.includes("(П)"), pr: s.includes("(ПР)") }, `${k} ${l}`).toEqual(want[k]);
      }
  });

  it("причина «не воспроизводится» — ru и en, со ссылкой на инвариант 1", () => {
    for (const r of NOT_REPRODUCIBLE_REASONS) {
      expect(NOT_REPRODUCIBLE_LABEL[r].ru).toMatch(/инвариант[а-я]* 1/);
      expect(NOT_REPRODUCIBLE_LABEL[r].en).toMatch(/invariant 1/);
    }
  });
});

describe("П-11.4а: вид — по поведению стенда в режиме сбоев (`createStand`, в том же процессе)", () => {
  let stand: Stand;
  beforeAll(() => {
    stand = createStand({ shops: DEMO_SHOPS, demo: { faults: true } });
  });
  afterAll(async () => {
    await stand?.close();
  });

  /** Принял ли стенд вызов. Отказ засчитывается только с причиной «не тот вид» (`refusal`); любой иной отказ (сбои
   *  выключены, неверные ids, настройка) — исключение теста, а не «не тот вид» (ревью П-11.4а № 4). */
  const accepts = (f: () => void, refusal: RegExp) => {
    try {
      f();
      return true;
    } catch (e) {
      if (e instanceof Error && refusal.test(e.message)) return false;
      throw e;
    }
  };
  const NOT_ARMABLE = /не сбой Платформы \(РП75 п\. 3\)/;
  const NOT_MARKABLE = /пометка только у нарушений.*\(РП75 п\. 3\)/;

  it.each(rows.map((r) => [r.test, r.kind] as const))("%s — %s", (test, kind) => {
    const t = test as DemoTest;
    const demo = stand.demo;
    if (!demo) throw new Error("стенд без режима сбоев: stand.demo нет");
    const armed = accepts(() => demo.arm(t), NOT_ARMABLE);
    if (armed) demo.disarm(t);
    const marked = accepts(() => demo.mark(t, { order_id: "ORD-stand-tests" }), NOT_MARKABLE);
    expect({ armed, marked }).toEqual({
      armed: kind === "stand_fault" || kind === "stand_fault_and_violator",
      marked: kind === "violator" || kind === "stand_fault_and_violator",
    });
  });
});
