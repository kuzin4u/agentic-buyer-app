// Реализация порта кнопок реакции пульта (П-8.1; Р-1526, Р-1527) для локального демо-стенда: вызывает `stand.demo.*` и
// возвращает ответ стенда как есть. Адаптер стенда живёт здесь, в сборке демо-стенда, а не в пульте (правило совместимости 1).
// Исключение стенда (неверный аргумент: неизвестный мандат, не CART, не PENDING) — отказ с текстом стенда, а не «сделано».
import type { StandDemo } from "agentic-ps-platform/stand";
import type { ActionResult, PultActions } from "../pult/actions.js";

/** Длина текста отказа стенда на экране и в журнале реакций (Б1, ревью П-8.1 № 4). */
const CODE_MAX = 120;
/** Отказ стенда исключением (`Error` стенда: неверный аргумент) — «отказано» с текстом, не длиннее `CODE_MAX`; прочее
 *  (`TypeError` и др. — сбой адаптера или стенда, а не отказ по правилам) — `failed`, маршрут отвечает 500 (ревью П-8.1 № 4). */
const refused = (e: unknown): ActionResult =>
  e instanceof Error && e.constructor === Error
    ? { ok: false, code: Array.from(e.message).slice(0, CODE_MAX).join("") } // по знакам, не по единицам UTF-16 (ревью Б1 № 8)
    : { ok: false, failed: true, code: "ADAPTER_FAILED" };
const reply = (r: { readonly statusCode: number; readonly body: unknown }): ActionResult => {
  const b = r.body as { code?: unknown; error?: { code?: unknown } } | null;
  const code = typeof b?.code === "string" ? b.code : typeof b?.error?.code === "string" ? b.error.code : undefined;
  // «Сделано» — только 200: стенд пишет запись действия только при 200, иначе — ACTION_REFUSED (ревью Б1 № 6).
  return { ok: r.statusCode === 200, status: r.statusCode, ...(code !== undefined && { code }) };
};

export function pultActions(demo: StandDemo): PultActions {
  return {
    async stopPurchase(cart) {
      try {
        const r = await demo.stopPurchase(cart);
        return { ...reply(r), rejected: r.rejected };
      } catch (e) {
        return refused(e);
      }
    },
    async remindClient(confirmationId) {
      try {
        const r = await demo.remindClient(confirmationId);
        return { ok: true, expiresAt: r.expires_at, extended: r.extended };
      } catch (e) {
        return refused(e);
      }
    },
    async revokeMandate(mandateId) {
      try {
        return reply(await demo.revokeMandate(mandateId));
      } catch (e) {
        return refused(e);
      }
    },
    async sendToReview(r) {
      try {
        // Номер и время записи стенда — в ответ и журнал реакций (ревью П-8.1 № 6).
        const e = demo.sendToReview(r);
        return { ok: true, recordSeq: e.seq, recordAt: e.at };
      } catch (e) {
        return refused(e);
      }
    },
  };
}
