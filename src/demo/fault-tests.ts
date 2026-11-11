// Перечень тестов «ПР» драйвера нарушителя (П7) — без кода драйвера и без ключа: его импортирует сервер экранов для
// маршрута `/fault/<Н-xx>`, а сам модуль драйвера — только сборка демо-стенда и автотесты.
import type { DemoTest } from "agentic-ps-platform/stand";

/** Тесты «ПР», которые разыгрывает драйвер (ответ Платформы по #112 п. 3; Н-05 — ветка «ПР»). */
export const FAULT_TESTS = ["Н-01", "Н-05", "Н-06", "Н-07", "Н-08", "Н-09"] as const satisfies readonly DemoTest[];
export type FaultTest = (typeof FAULT_TESTS)[number];

export const isFaultTest = (s: string): s is FaultTest => (FAULT_TESTS as readonly string[]).includes(s);

export type FaultStart = { ok: true } | { ok: false; code: "BUSY" | "NOT_READY" | "CLOSED" };
