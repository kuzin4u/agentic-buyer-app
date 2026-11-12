// Маршрут кнопок реакции пульта `POST /pult/act/<действие>` (П-8.1; Р-1526, Р-1527): разбор действия и параметров адреса,
// вызов порта `PultActions`, запись в журнал реакций ленты пульта. Ответ стенда — как есть: отказ стенда — «отказано» (409),
// не «сделано» (инвариант 2). «Напомнить» у У-01 / У-02 (`remind_note`) стенд не вызывает вовсе — только «напомнено» (В1 (а)).
// Отзыв в два шага (В4) — на экране: сюда приходит уже подтверждённый отзыв.
import { PULT_ACTIONS, REVIEW_ID_FIELDS, REVIEW_VIOLATORS, type ActionResult, type PultActionKind, type PultActions, type Reaction, type ReviewIds, type ReviewViolator } from "../pult/actions.js";
import type { PultFeed } from "../pult/feed.js";

/** Номер объекта стенда: латиница, цифры, `_ - : .`, до 128 знаков. Иное — 400. */
const ID = /^[A-Za-z0-9_.:-]{1,128}$/;
/** Условие, по которому напоминают без стенда: только R08 (У-01) и R18 (У-02). */
const NOTE_CONDS = new Set(["R08", "R18"]);
/** Номер транзакции пульта с типом звена (`cart:…`, `order:…`, `op:…`, `confirmation:…` — `NODE_TYPE` в `src/pult/tx.ts`) —
 *  не номер стенда: в `stop` и `review` — 400 (ревью П-8.1 № 1, 2; повторное № 1). Экран переводит его в поле разбора по типу. */
const PULT_PREFIX = /^(cart|order|op|confirmation):/;

export interface PultActReply {
  readonly status: number;
  readonly body: unknown;
}

const isAction = (s: string): s is PultActionKind => (PULT_ACTIONS as readonly string[]).includes(s);
const isViolator = (s: string): s is ReviewViolator => (REVIEW_VIOLATORS as readonly string[]).includes(s);

export async function pultAct(what: string, q: URLSearchParams, actions: PultActions, feed: Pick<PultFeed, "react">, now: () => Date): Promise<PultActReply> {
  if (!isAction(what)) return { status: 404, body: { error: "UNKNOWN_ACTION" } };
  const id = (k: string) => {
    const v = q.get(k);
    return v !== null && ID.test(v) ? v : undefined;
  };
  const bad: PultActReply = { status: 400, body: { error: "BAD_PARAMS" } };
  const record = (obj: string, result: ActionResult, cond?: string): PultActReply => {
    const reaction: Reaction = { at: now().toISOString(), action: what, obj, ...(cond !== undefined && { cond }), outcome: result.ok ? "done" : "refused", result };
    feed.react(reaction);
    return { status: result.ok ? 200 : 409, body: reaction };
  };
  switch (what) {
    case "stop": {
      const cart = id("cart");
      return cart && !PULT_PREFIX.test(cart) ? record(cart, await actions.stopPurchase(cart)) : bad;
    }
    case "remind": {
      const c = id("confirmation");
      return c ? record(c, await actions.remindClient(c), "R21") : bad;
    }
    case "remind_note": {
      // В1 (а): у стенда действия нет — запись «напомнено», стенд не вызывается.
      const obj = id("obj");
      const cond = q.get("cond") ?? "";
      if (!obj || !NOTE_CONDS.has(cond)) return bad;
      const reaction: Reaction = { at: now().toISOString(), action: what, obj, cond, outcome: "noted" };
      feed.react(reaction);
      return { status: 200, body: reaction };
    }
    case "revoke": {
      const m = id("mandate");
      return m ? record(m, await actions.revokeMandate(m)) : bad;
    }
    case "review": {
      const tx: Record<string, string> = {};
      for (const f of REVIEW_ID_FIELDS) {
        const v = id(f);
        if (v && PULT_PREFIX.test(v)) return bad;
        if (v) tx[f] = v;
      }
      const condition = q.get("condition") ?? "";
      const violator = q.get("violator") ?? "";
      if (Object.keys(tx).length === 0 || !/^R\d{2}$/.test(condition) || !isViolator(violator)) return bad;
      const obj = tx.op_ref ?? tx.order_id ?? tx.mandate_id ?? Object.values(tx)[0]!;
      return record(obj, await actions.sendToReview({ tx: tx as ReviewIds, condition, violator }), condition);
    }
  }
}
