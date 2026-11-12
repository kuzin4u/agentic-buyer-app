// Журнал реакций ↔ протокол (П-8.2, Р-1531): каждое нажатие кнопки пульта связывается с записью журнала стенда, которую
// стенд сделал по этому действию (`stand.demo.log()`, поток `stand` шины, Р-1514 — только в режиме сбоев). Нажатие — запись
// пульта о себе (Р-1519); доказательство — запись стенда. «Упреждено реакцией» (У-04) — не вывод пульта: отметка R21 движка
// (`preempted_by_reaction`), реакция только показывает, что её запись стенда в этом доказательстве участвует.
import type { Reaction } from "./actions.js";
import { REMIND_LOG, type EngineView } from "./engine.js";
import type { StandLogEntry, StandLogWhat } from "./standlog.js";

/** Связь реакции с протоколом: запись стенда; журнала стенда нет (режим показа); стенд не вызывался («напомнено» без стенда,
 *  В1 (а) Р-1526); записи по действию в журнале нет (стенд отказал исключением — без записи). */
export type ReactionLink =
  | { readonly state: "linked"; readonly seq: number; readonly what: StandLogWhat; readonly at: string }
  | { readonly state: "unavailable" }
  | { readonly state: "no_stand" }
  | { readonly state: "not_found" };

export interface LinkedReaction extends Reaction {
  readonly link: ReactionLink;
  /** Условие, у которого движок отметил «упреждено реакцией» по записи стенда этой реакции (У-04). */
  readonly preempted?: "R21";
}

/** Какие записи стенда пишет каждое действие (РП75 п. 6, `stand/demo-actions.js`); отказ шлюза — `ACTION_REFUSED`. */
const RECORD_OF: Readonly<Record<Exclude<Reaction["action"], "remind_note">, readonly StandLogWhat[]>> = {
  remind: REMIND_LOG,
  stop: ["PURCHASE_STOPPED"],
  revoke: ["MANDATE_REVOKED"],
  review: ["SENT_TO_REVIEW"],
};

/** Запись стенда относится к объекту реакции: у «Напомнить» — по номеру запроса подтверждения, у отзыва и остановки — по
 *  поручению, у разбора — по любому переданному номеру. */
function sameObj(r: Reaction, e: StandLogEntry): boolean {
  if (r.action === "remind") return e.ids.confirmation_id === r.obj;
  if (r.action === "stop" || r.action === "revoke") return e.ids.mandate_id === r.obj;
  return Object.values(e.ids).includes(r.obj);
}

/** Связать реакции (по порядку нажатий) с записями стенда: каждой — последняя ещё не взятая подходящая запись не позже
 *  нажатия (реакция пишется после ответа стенда, часы — те же, стенда). `log === undefined` — журнала нет. */
export function linkReactions(reactions: readonly Reaction[], log: readonly StandLogEntry[] | undefined, ev?: EngineView): LinkedReaction[] {
  const taken = new Set<number>();
  // Записи стенда, на которых движок поставил «упреждено реакцией» у R21.
  const preempted = new Set<number>();
  for (const o of ev?.objs ?? []) if (o.conds.R21.note === "preempted_by_reaction") for (const s of o.conds.R21.log ?? []) preempted.add(s);
  return reactions.map((r): LinkedReaction => {
    if (r.action === "remind_note") return { ...r, link: { state: "no_stand" } };
    if (log === undefined) return { ...r, link: { state: "unavailable" } };
    const kinds: readonly StandLogWhat[] = r.outcome === "refused" ? ["ACTION_REFUSED"] : RECORD_OF[r.action];
    const at = Date.parse(r.at);
    const e = log.filter((x) => !taken.has(x.seq) && kinds.includes(x.what) && sameObj(r, x) && Date.parse(x.at) <= at).at(-1);
    if (!e) return { ...r, link: { state: "not_found" } };
    taken.add(e.seq);
    return { ...r, link: { state: "linked", seq: e.seq, what: e.what, at: e.at }, ...(r.action === "remind" && preempted.has(e.seq) && { preempted: "R21" as const }) };
  });
}
