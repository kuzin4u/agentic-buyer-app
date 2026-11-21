// Контракт К-Б `/ui/v1`, § 3, правило 1 — **провенанс нажатия** (`press`) и его проверка.
//
// Проверка одна на все методы: её спрашивают подпись принципов (§ 5.14, К1.3 П-К1) и отправка поручения на подпись
// (§ 5.2, К5 П-К4). Две копии разошлись бы молча — одна приняла бы `device: "robot"`, другая отвергла; поэтому форма
// провенанса сказана здесь один раз (тот же довод, что у общих примитивов разбора `config/` — находка ревью К3 З6).
//
// П26: **умолчания у провенанса нет.** Провенанс, который ничего не доказывает (пустое время, чужое устройство,
// лишнее поле), — это отсутствие провенанса, а не «почти провенанс».
import { isUiDevice, isUiGesture, type UiPress } from "./common.js";

/** Поля провенанса — ровно те, что в § 3. */
export const PRESS_KEYS: readonly string[] = ["at", "device", "text_version", "gesture"];

/** Что не так с провенансом. Код `/ui` и текст человеку приставляет вызывающий: у подписи принципов это
 *  `PRINCIPLES_ORDER_INVALID`, у отправки поручения — `INTENT_DRAFT_INVALID`, и текст у них разный. */
export type UiPressProblem =
  | { readonly kind: "missing" }
  | { readonly kind: "invalid"; readonly field: string }
  | { readonly kind: "unknown_field"; readonly field: string };

/** `null` — провенанс годный. */
export function checkUiPress(press: unknown): UiPressProblem | null {
  if (press === undefined || press === null || typeof press !== "object") return { kind: "missing" };
  for (const key of Object.keys(press)) if (!PRESS_KEYS.includes(key)) return { kind: "unknown_field", field: key };
  const p = press as Record<string, unknown>;
  for (const key of PRESS_KEYS) if (p[key] === undefined) return { kind: "missing" };
  if (typeof p["at"] !== "string" || p["at"] === "") return { kind: "invalid", field: "at" };
  if (typeof p["text_version"] !== "string" || p["text_version"] === "") return { kind: "invalid", field: "text_version" };
  if (!isUiDevice(p["device"])) return { kind: "invalid", field: "device" };
  if (!isUiGesture(p["gesture"])) return { kind: "invalid", field: "gesture" };
  return null;
}

export const isUiPress = (press: unknown): press is UiPress => checkUiPress(press) === null;
