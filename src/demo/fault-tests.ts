// Перечень тестов «ПР» драйвера нарушителя (П7) и закрытая таблица их нарушений — без кода драйвера и без ключа: перечень
// импортирует сервер экранов для маршрута `/fault/<Н-xx>`, а сам модуль драйвера — только сборка демо-стенда и автотесты.
import type { DemoLogEntry, DemoTest } from "agentic-ps-platform/stand";

/** Тесты «ПР», которые разыгрывает драйвер (ответ Платформы по #112 п. 3; Н-05 — ветка «ПР»). */
export const FAULT_TESTS = ["Н-01", "Н-05", "Н-06", "Н-07", "Н-08", "Н-09"] as const satisfies readonly DemoTest[];
export type FaultTest = (typeof FAULT_TESTS)[number];

export const isFaultTest = (s: string): s is FaultTest => (FAULT_TESTS as readonly string[]).includes(s);

export type FaultStart = { ok: true } | { ok: false; code: "BUSY" | "NOT_READY" | "CLOSED" };

/** Ожидаемая защита: код и HTTP-статус ответа на нарушение. */
export interface Guard {
  readonly code: string;
  readonly status: number;
}

/** Операция нарушения: «МЕТОД /путь» по шаблону (`{x}` — один сегмент пути). Запросы к ПАО — шаблон ПАО; к витрине — путь
 *  витрины. */
export type ViolationOp = string;

export interface FaultPlanEntry {
  /** Какими операциями нарушение может быть отправлено (`c.violate.*`); иная — BAD_VIOLATION, запрос не уходит. */
  readonly violations: readonly ViolationOp[];
  /** Какие ответы на нарушение — «защита сработала». Иной код — «не разыграно» UNEXPECTED_<код>. */
  readonly expect: readonly Guard[];
  /** Сбой стенда этого теста взводит **драйвер** на витрину нарушителя на время ветки и снимает при любом исходе (сбой
   *  ветки, «прервать», закрытие драйвера); взведённый до прогона (человеком) — не трогает (решение владельца по В1
   *  П-11.3д, чат 12.11). */
  readonly arm?: true;
  /** Только записи стенда, без нарушающего запроса (Р-1483): итог `fault.recorded` «записи стенда сделаны» — строго при
   *  записи `record` по витрине нарушителя и пометке за прогон; иначе «не разыграно» `missing`. Не «защита сработала» и не
   *  «совершено» (решение владельца по В2 П-11.3д). */
  readonly recordOnly?: {
    readonly record: DemoLogEntry["what"];
    readonly missing: string;
    /** Каким своим успешным запросом подготовки ветка вызывает запись (витрина — нарушителя); иной запрос итог не делает. */
    readonly via: ViolationOp;
  };
}

/** Закрытая таблица нарушений «ПР» (ревью П-11.3а-3 № 3; решение владельца, чат 11.11): по п. 4 ответа Платформы по #112
 *  (kuzin4u/agentic-ps-platform #issuecomment-6736990698) — к MVP по одной ветке с кодом защиты на тест (Р-1481). Роль и
 *  ожидаемую защиту ветка не объявляет — драйвер берёт их отсюда. Н-05 «ПР» — без кода защиты (ловит пульт, R47) и к MVP
 *  без нарушающего запроса: только записи стенда «инструкция отдана» и «пометка» (Р-1483); заказ «по инструкции» —
 *  видимое исполнение — после MVP. */
export const FAULT_PLAN: Readonly<Record<FaultTest, FaultPlanEntry>> = {
  // повторная оплата оплаченного заказа — витрина
  "Н-01": { violations: ["POST /v1/shops/{shop_id}/orders/{order_id}/payment"], expect: [{ code: "ORDER_NOT_PAYABLE", status: 409 }] },
  // инструкция продавца агенту в карточке каталога — к MVP только записи стенда (Р-1483); защиты в таблице нет
  "Н-05": { violations: [], expect: [], arm: true, recordOnly: { record: "INSTRUCTION_SERVED", missing: "INSTRUCTION_NOT_SERVED", via: "GET /v1/shops/{shop_id}/catalog" } },
  // новый реквизит по отозванному CART — Платформа, выдача реквизита
  "Н-06": { violations: ["POST /pao/v1/credentials"], expect: [{ code: "MANDATE_REVOKED", status: 409 }] },
  // реквизит по CART, не подписанному клиентом — Платформа, выдача реквизита
  "Н-07": { violations: ["POST /pao/v1/credentials"], expect: [{ code: "PRINCIPAL_SIGNATURE_PENDING", status: 409 }] },
  // реквизит на сумму больше amount_limit CART — Платформа, выдача реквизита (ветка MANDATE_SCOPE, Р-1459 В5)
  "Н-08": { violations: ["POST /pao/v1/credentials"], expect: [{ code: "MANDATE_SCOPE", status: 409 }] },
  // новый реквизит по CART продавца А на продавца Б — Платформа, выдача реквизита (ветка MANDATE_SCOPE)
  "Н-09": { violations: ["POST /pao/v1/credentials"], expect: [{ code: "MANDATE_SCOPE", status: 409 }] },
};

/** Подходит ли запрос «МЕТОД /путь» под операцию таблицы (`{x}` — один непустой сегмент без `/`). */
export function matchesOp(op: ViolationOp, method: string, path: string): boolean {
  const [m, tpl] = op.split(" ");
  if (m !== method || tpl === undefined) return false;
  const re = new RegExp(`^${tpl.split(/\{[a-z_]+\}/).map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[^/]+")}$`);
  return re.test(path);
}
