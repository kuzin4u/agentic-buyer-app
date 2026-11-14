// Тесты Н-xx демо-стенда по виду (П-11.4а, Р-1500): закрытая таблица 12 тестов «Задания на тестирование пульта» v1.0 —
// для таблицы тестирования пульта (П-11.5, окно А) и для демо-стенда. Лежит в `src/dashboards`: пульт импортирует только
// `src/dashboards` (граница П-1), а `src/demo` — нет.
//
// Вид — по стенду Платформы v0.48.0 (`agentic-ps-platform/dist/stand/demo.js`, РП75 п. 3): «П» — сбой стенда (`ARMABLE`,
// `stand.demo.arm`), «ПР» — нарушение агента разыгрывает драйвер приложения и ставит пометку (`MARKABLE`, `stand.demo.mark`;
// П7), Н-05 — оба вида, Н-10 — ни того ни другого. Пакет Платформы здесь не импортируется (граница экранов, Р-1246 п. 3):
// сверку со стендом, с перечнем тестов «ПР» драйвера нарушителя (`FAULT_TESTS` сборки демо-стенда; имя файла драйвера здесь не
// пишется — тест границы драйвера, П7 п. 6) и с перечнем движка пульта (`src/pult/standlog.ts`) делает тест. Новый тест или смена вида у стенда — правка этой таблицы и теста (смена версии стенда — П2 доп. 4 и 6).
//
// Коды задания «П» и «ПР» — идентификаторы вида, как `Н-01`: в en они остаются кириллицей (образец — пометка
// «violator (ПР) — app driver», П7 п. 4).
import type { Phrase } from "./phrases.js";

const p = (ru: string, en: string): Phrase => ({ ru, en });

/** Вид теста на демо-стенде. */
export const STAND_TEST_KINDS = ["stand_fault", "violator", "stand_fault_and_violator", "not_reproducible"] as const;
export type StandTestKind = (typeof STAND_TEST_KINDS)[number];

/** Почему тест на стенде не воспроизводится — закрытый перечень. */
export const NOT_REPRODUCIBLE_REASONS = ["INVARIANT_1"] as const;
export type NotReproducibleReason = (typeof NOT_REPRODUCIBLE_REASONS)[number];

export type StandTestRow =
  | { readonly test: string; readonly kind: Exclude<StandTestKind, "not_reproducible"> }
  | { readonly test: string; readonly kind: "not_reproducible"; readonly reason: NotReproducibleReason };

/** 12 тестов Н-xx по порядку задания. */
export const STAND_TEST_TABLE = [
  { test: "Н-01", kind: "violator" },
  { test: "Н-02", kind: "stand_fault" },
  { test: "Н-03", kind: "stand_fault" },
  { test: "Н-04", kind: "stand_fault" },
  { test: "Н-05", kind: "stand_fault_and_violator" },
  { test: "Н-06", kind: "violator" },
  { test: "Н-07", kind: "violator" },
  { test: "Н-08", kind: "violator" },
  { test: "Н-09", kind: "violator" },
  // Номер карты в записи агента (R41). Стенд номер карты агенту не выдаёт (инвариант 1 Платформы — ответ по #112); у
  // приложения — инвариант 1 и «Секреты» CLAUDE.md: номеров карт, даже тестовых, нет ни в коде, ни в тестах, ни в фикстурах.
  // Разыграть нечем. В подписи — «инвариант 1» по заданию: его закрывают оба инварианта.
  { test: "Н-10", kind: "not_reproducible", reason: "INVARIANT_1" },
  { test: "Н-11", kind: "stand_fault" },
  { test: "Н-12", kind: "stand_fault" },
] as const satisfies readonly StandTestRow[];

export type StandTestCode = (typeof STAND_TEST_TABLE)[number]["test"];

/** Подпись вида для таблицы тестирования (ru/en). */
export const STAND_TEST_KIND_LABEL: Readonly<Record<StandTestKind, Phrase>> = {
  stand_fault: p("сбой стенда (П)", "stand fault (П)"),
  violator: p("нарушитель (ПР) — драйвер приложения", "violator (ПР) — app driver"),
  stand_fault_and_violator: p("сбой стенда (П) и нарушитель (ПР) — драйвер приложения", "stand fault (П) and violator (ПР) — app driver"),
  not_reproducible: p("на стенде не воспроизводится", "not reproducible on the stand"),
};

/** Причина «не воспроизводится» — строка таблицы тестирования (ru/en). */
export const NOT_REPRODUCIBLE_LABEL: Readonly<Record<NotReproducibleReason, Phrase>> = {
  INVARIANT_1: p(
    "не воспроизводится по инварианту 1: стенд не выдаёт агенту номер карты, а в коде и фикстурах приложения номеров карт нет",
    "not reproducible under invariant 1: the stand never gives the agent a card number, and the app code and fixtures contain none",
  ),
};
