// «Контроль» пульта DEMO-2 (П-4.1; модель пульта 1.23 — «Паспорта», «Идёт к нарушению», «В работе сейчас»). Чистые
// функции над вердиктами (`verdict.ts`), моделью транзакций и записями шины — что показать человеку, без решений за ядро
// (инвариант 2) и без действий (кнопки реакции — П-8.1, решение владельца по плану П-4.1).
// Правило паспорта (решение владельца по П-3.3, 3): паспорт «неправильная» есть, если нарушитель — участник или «не
// определён»; паспорта нет, если нарушителя нет или это «решение клиента». «Идёт к нарушению» — предупреждения до
// нарушения с порогом ожидания (по умолчанию 15 с — модель 1.23, тесты задания У-01…У-03); «операция без шага агента N с —
// возможно, чужая операция» (условие Р-1478) — предположение, не вердикт: в паспорт не превращается.
import type { Interpretation } from "../dashboards/interpret.js";
import type { BoardColumn } from "./board.js";
import type { Phrase } from "./phrases.js";
import { CONDITIONS, NODES, type CheckableCondition, type NodeId, type Party } from "./rules89.js";
import { OUTCOME_STEPS, type TxModel } from "./tx.js";
import type { Subject, Verdict } from "./verdict.js";

/** Порог «Идёт к нарушению» по умолчанию, мс: модель 1.23 — клиент медлит 15 с (тесты задания У-01, У-02, У-03). */
export const WAIT_MS = 15_000;

/** Есть ли паспорт «неправильная» у вердикта — правило паспорта (решение по П-3.3, 3). */
export const hasPassport = (v: Pick<Verdict, "violator">): boolean => v.violator !== undefined && v.violator !== "client_decision";

export interface PassportFinding {
  readonly cond?: CheckableCondition;
  /** Формулировка условия ru/en — из справочника (`CONDITIONS`). */
  readonly condText?: Phrase;
  readonly node?: NodeId;
  readonly nodeText?: Phrase;
  readonly violator: Exclude<Subject, "client_decision">;
  readonly protector?: Party | "undetermined";
  /** Гонка С-28 — вердикт владельца (В5). */
  readonly note?: "race_c28";
}
export interface PultPassport {
  /** Транзакция или поручение; нет — запись системы. */
  readonly obj?: string;
  readonly findings: readonly PassportFinding[];
}

/** Паспорта «неправильная» — по объекту, находки — вердикты с паспортом. */
export function passports(vs: readonly Verdict[]): PultPassport[] {
  const by = new Map<string, PassportFinding[]>();
  for (const v of vs) {
    if (!hasPassport(v)) continue;
    const c = v.cond !== undefined ? CONDITIONS.find((x) => x.id === v.cond) : undefined;
    const f: PassportFinding = {
      violator: v.violator as Exclude<Subject, "client_decision">,
      ...(v.cond !== undefined && { cond: v.cond }),
      ...(c && { condText: c.rule }),
      ...(v.node !== undefined && { node: v.node, nodeText: NODES[v.node].name }),
      ...(v.protector !== undefined && { protector: v.protector }),
      ...(v.note !== undefined && { note: v.note }),
    };
    const key = v.obj ?? "";
    by.set(key, [...(by.get(key) ?? []), f]);
  }
  return [...by.entries()].map(([obj, findings]) => ({ ...(obj !== "" && { obj }), findings }));
}

/** Ожидание, которое может стать нарушением: экран показывает строку, когда прошло не меньше порога. */
export type WaitKind = "sign" | "consent" | "confirmation" | "agent_step";
export interface WaitCandidate {
  readonly kind: WaitKind;
  /** Условие, к нарушению которого идёт ожидание; у «шага агента» — нет (предположение, не условие). */
  readonly cond?: "R08" | "R18" | "R21";
  /** Поручение, транзакция или операция. */
  readonly obj: string;
  /** У R21 — номер запроса подтверждения: в одной транзакции их может быть несколько (повтор после отказа). */
  readonly confirmationId?: string;
  /** С какого времени ждём (время записи, с которой ожидание началось). */
  readonly since: string;
}

const isEvent = (x: Interpretation | undefined, ref: string) => x?.source === "pao_event" && x.ref === ref;
/** Итог, после которого ждать уже нечего: оплачено, проведено, отозвано. Отказ и отклонённое подтверждение — не такие:
 *  после них возможен повтор (В6), и его запрос подтверждения ждёт ответа (ревью П-4.1 № 2). */
const FINAL: ReadonlySet<string> = new Set(["paid", "settled", "revoked"]);

/** Кандидаты «Идёт к нарушению». Порог экран применяет сам по «сейчас» (часы шины + время у экрана), чтобы строка
 *  появилась и без новой записи. Строка — только при доказанном ожидании: запрос есть, ответа (события) нет.
 *
 *  Правило вердикта при конфликте звеньев (решение владельца по ревью П-4.1, п. 3; в П-11.5 читать из документа, не из
 *  кода): R21 по номеру подтверждения показывается и при конфликте — клиент действительно ждёт ответа на этот запрос, это
 *  факт, а не вывод о транзакции; «операция без шага агента» и R18 при конфликте не показываются — конфликт виден на
 *  карточке, решает человек. */
export function waits(model: TxModel, items: readonly Interpretation[]): WaitCandidate[] {
  const bySeq = new Map(items.map((x) => [x.seq, x] as const));
  const recs = (seqs: readonly number[]) => seqs.map((s) => bySeq.get(s)).filter((x): x is Interpretation => x !== undefined);
  const out: WaitCandidate[] = [];
  // R08 (У-01): поручение ждёт подписи клиента. Отклонил — решение клиента, не ожидание (ревью П-4.1 № 1).
  for (const m of model.mandates) {
    if (m.status !== "awaiting_signature") continue;
    const own = recs(m.seqs);
    if (own.some((x) => isEvent(x, "mandate.rejected") && x.ids?.mandate_id === m.id)) continue;
    const w = own.find((x) => x.stream === "scenario" && x.ref === "intent.awaiting_signature");
    if (w) out.push({ kind: "sign", cond: "R08", obj: m.id, since: w.at });
  }
  const revokedIntents = new Set(model.mandates.filter((m) => m.status === "revoked").map((m) => m.id));
  for (const t of model.txs) {
    if (t.outcome && FINAL.has(t.outcome.kind)) continue;
    const r = recs(t.seqs);
    // R18 (У-02): корзина ждёт согласия — подписи поручения корзины клиентом (событие Платформы, П-3.2б). Не при итоге,
    // не при конфликте и не после отзыва поручения-намерения (ревью П-4.1 № 14).
    const cart = t.cartMandateId;
    if (cart !== undefined && !t.outcome && !t.linkConflict && !(t.intentId !== undefined && revokedIntents.has(t.intentId))) {
      const asked = r.find((x) => x.stream === "scenario" && x.ref === "cart.awaiting_signature" && x.ids?.mandate_id === cart);
      const signed = r.some((x) => (isEvent(x, "mandate.signed") || isEvent(x, "mandate.rejected")) && x.ids?.mandate_id === cart);
      if (asked && !signed) out.push({ kind: "consent", cond: "R18", obj: t.id, since: asked.at });
    }
    // R21 (У-03): подтверждение ждёт ответа клиента — по каждому запросу (повтор после отказа — свой запрос). Время — с
    // запроса, не остаток: срока запроса на шине нет; остаток — после слияния PR #11 (решение владельца по плану П-4.1).
    // При итоге «отказ» или «подтверждение отклонено» — только запросы после события итога (ревью П-4.1 № 15): повтор виден,
    // а открытый запрос отклонённой операции — нет. Гарантии, что Платформа всегда закрывает запрос событием (в том числе в
    // режиме сбоев), нет — вопрос в STATUS «Открыто»; до ответа правило остаётся.
    // Отсечка — по последнему событию итога (отказ операции, отклонённое подтверждение), а не по `t.outcome` — тот первый
    // (ревью П-4.1 № 20: запрос второго повтора после второго отказа иначе висел бы).
    const after = t.outcome
      ? Math.max(t.outcome.seq, ...r.filter((x) => isEvent(x, "operation.declined") || isEvent(x, "confirmation.rejected")).map((x) => x.seq))
      : undefined;
    for (const q of t.confirmationIds) {
      const req = r.find((x) => isEvent(x, "confirmation.required") && x.ids?.confirmation_id === q);
      const done = r.some((x) => x.source === "pao_event" && x.ref !== "confirmation.required" && x.ref.startsWith("confirmation.") && x.ids?.confirmation_id === q);
      if (req && !done && (after === undefined || req.seq > after)) out.push({ kind: "confirmation", cond: "R21", obj: t.id, confirmationId: q, since: req.at });
    }
  }
  // Условие Р-1478: событие операции есть, шага агента по ней нет — «возможно, чужая операция» (предположение). Только
  // при доказанном отсутствии шага: `pendingOps` включает и операции транзакции без корзины, где шаг уже мог прийти
  // (ревью П-4.1 № 4), — поэтому шаг агента с этим `op_ref` проверяется здесь. «Шаг агента» — то же определение, что у
  // модели транзакций (`OUTCOME_STEPS`, ревью П-4.1 № 17): два определения разошлись бы молча при новом шаге сюжета.
  for (const t of model.txs) {
    if (t.linkConflict) continue;
    const r = recs(t.seqs);
    for (const p of t.pendingOps ?? []) {
      if (r.some((x) => x.stream === "scenario" && OUTCOME_STEPS.has(x.ref) && x.ids?.op_ref === p)) continue;
      const ev = r.find((x) => x.source === "pao_event" && x.ref.startsWith("operation.") && x.ids?.op_ref === p);
      if (ev) out.push({ kind: "agent_step", obj: p, since: ev.at });
    }
  }
  return out;
}

/** Строки «Идёт к нарушению» на момент `now`: прошло не меньше порога. Тот же расчёт делает экран раз в секунду. */
export const dueWaits = (ws: readonly WaitCandidate[], now: string, waitMs = WAIT_MS): WaitCandidate[] =>
  ws.filter((w) => Date.parse(now) - Date.parse(w.since) >= waitMs);

export interface ActiveTx {
  readonly id: string;
  readonly column: BoardColumn;
  readonly since: string;
}
export interface ControlState {
  readonly passports: readonly PultPassport[];
  readonly waits: readonly WaitCandidate[];
  /** Порог «Идёт к нарушению», мс — экран применяет его сам. */
  readonly waitMs: number;
  readonly active: readonly ActiveTx[];
  /** Строка состояния: транзакций, из них с паспортом. */
  readonly counts: { readonly txs: number; readonly wrong: number };
}

/** Состояние панели «Контроль». `active` — незавершённые транзакции доски (колонка и время входа в неё). */
export function controlView(
  model: TxModel,
  items: readonly Interpretation[],
  vs: readonly Verdict[],
  active: readonly ActiveTx[],
  waitMs = WAIT_MS,
): ControlState {
  const ps = passports(vs);
  const wrongTx = new Set(ps.map((p) => p.obj).filter((x): x is string => x !== undefined && model.txs.some((t) => t.id === x)));
  return { passports: ps, waits: waits(model, items), waitMs, active, counts: { txs: model.txs.length, wrong: wrongTx.size } };
}
