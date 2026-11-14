// Реализация порта кнопок реакции пульта (П-8.1; Р-1526, Р-1527) для локального демо-стенда: вызывает `stand.demo.*` и
// возвращает ответ стенда как есть. Адаптер стенда живёт здесь, в сборке демо-стенда, а не в пульте (правило совместимости 1).
// Исключение стенда (неверный аргумент: неизвестный мандат, не CART, не PENDING) — отказ с текстом стенда, а не «сделано».
import type { StandDemo } from "agentic-ps-platform/stand";
import type { ActionResult, PultActions } from "../pult/actions.js";

const refused = (e: unknown): ActionResult => ({ ok: false, code: e instanceof Error ? e.message : String(e) });
const reply = (r: { readonly statusCode: number; readonly body: unknown }): ActionResult => {
  const b = r.body as { code?: unknown; error?: { code?: unknown } } | null;
  const code = typeof b?.code === "string" ? b.code : typeof b?.error?.code === "string" ? b.error.code : undefined;
  return { ok: r.statusCode < 400, status: r.statusCode, ...(code !== undefined && { code }) };
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
        demo.sendToReview(r);
        return { ok: true };
      } catch (e) {
        return refused(e);
      }
    },
  };
}
