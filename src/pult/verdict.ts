// «Кто нарушил / кто защитил» (П-3.3; модель пульта 1.23 — `CULPRIT_COND`, `enrichProto`; задание на тестирование v1.0,
// колонка «Что ожидать в „Контроле“»). Субъект вердикта — **явной таблицей по причине** статуса (`Cause` движка, закрытый
// перечень), а не разбором текста правила: модель искала слова «агент», «банк», «продав» в строке «кто» — это ломается на
// первой формулировке с двумя участниками и даёт тихо неверный субъект. Причина без строки в таблице — «не определён» с
// пометкой, а не субъект по умолчанию. «Решение клиента» — отдельная категория: выбор человека, а не чьё-то нарушение
// (П-03, П-04, П-05, П-08; в акте ACC-1 читается как выбор человека). Узел У1–У5 — по `NODES.conds` справочника.
// Отступления от задания v1.0 — STATUS «Открыто» (В7: Н-03, Н-12; В8: Н-08) и «Расхождения» № 7 (Н-06, строки таблицы,
// которых нет в задании). Вердикты по сработавшим защитам (`view.guarantees`; П-05, П-07, отзыв без покупки) — сделаны в
// П-5.1 (Р-1484, Р-1519): защитник — по источнику остановки (`stoppedBy`), одна остановка — одна защита.
import type { Interpretation } from "../dashboards/interpret.js";
import type { Cause, CondResult, EngineView, Guarantee, RuleCause } from "./engine.js";
import type { Phrase } from "./phrases.js";
import { CHECKABLE_CONDITIONS, NODES, type CheckableCondition, type NodeId, type Party } from "./rules89.js";
import type { StandLogWhat, StandTest } from "./standlog.js";
import type { TxModel } from "./tx.js";

const p = (ru: string, en: string): Phrase => ({ ru, en });

/** Вид вердикта: нарушение, защита сработала, решение клиента. */
export type VerdictKind = "violation" | "protection" | "client_decision";
/** Субъект: участник, «решение клиента» или «не определён» (причина без строки в таблице субъектов). */
export type Subject = Party | "client_decision" | "undetermined";

export const VERDICT_LABEL: Readonly<Record<VerdictKind, Phrase>> = {
  violation: p("нарушение", "violation"),
  protection: p("сработала защита", "protection triggered"),
  client_decision: p("решение клиента", "client's decision"),
};
export const SUBJECT_LABEL: Readonly<Record<"client_decision" | "undetermined", Phrase>> = {
  client_decision: p("решение клиента", "client's decision"),
  undetermined: p("не определён — у причины нет строки в таблице субъектов", "undetermined — the cause has no row in the subject table"),
};

interface Row {
  readonly violator?: Subject;
  readonly protector?: Party | "undetermined";
  /** Почему субъект «не определён» — для человека и акта. */
  readonly note?: "race_c28";
}

/** Причина по записям шины → субъекты. Источник — задание v1.0 (тест в скобках) и решения владельца; строки, которых в
 *  задании нет, — STATUS «Расхождения» № 7. */
const BY_RULE: Readonly<Record<RuleCause, Row>> = {
  card_number_agent: { violator: "agent" }, // Н-10: номер в записи агента
  card_number_other: { violator: "undetermined" }, // номер в записи не агента — по источнику не определить
  sign_by_agent: { violator: "agent" }, // подпись поручения обращением агента
  sign_by_other: { violator: "undetermined" }, // подпись не эмулятором банка и не агентом
  no_signature: { violator: "agent" }, // покупка без подписи поручения
  pay_before_consent: { violator: "agent" }, // Н-07
  // В5, решение по П-3.3, 2: порядок при гонке С-28 не доказан — «не определён», вердикт владельца (расхождение № 7).
  paid_after_revoke: { violator: "undetermined", note: "race_c28" },
  revoked_agent_stop: { violator: "client_decision", protector: "agent" }, // П-08: отзыв — выбор клиента
  revoked_platform_decline: { violator: "client_decision", protector: "platform" },
  expired_agent_stop: { protector: "agent" }, // П-09: срок поручения — не нарушение
  expired_platform_decline: { protector: "platform" },
  inactive_agent_stop: { violator: "undetermined", protector: "agent" }, // MANDATE_NOT_ACTIVE: отзыв или срок — не различить
  inactive_platform_decline: { violator: "undetermined", protector: "platform" },
  // П-03 (Р-1538): MANDATE_NOT_ACTIVE после отказа клиента от корзины в банке — решение клиента, паспорта нет.
  rejected_agent_stop: { violator: "client_decision", protector: "agent" },
  rejected_platform_decline: { violator: "client_decision", protector: "platform" },
  rejected_undetermined: { violator: "client_decision", protector: "undetermined" },
  // Остановка только в шаге сюжета — рассказ стенда, не доказательство: защитник «не определён» (П-5.1, Р-1519).
  revoked_undetermined: { violator: "client_decision", protector: "undetermined" },
  expired_undetermined: { protector: "undetermined" },
  inactive_undetermined: { violator: "undetermined", protector: "undetermined" },
  // П-06: не нарушение — защита сработала; кто остановил — по источнику (ревью П-5.1 № 1); Н-08 — по пометке.
  mandate_scope_platform: { protector: "platform" },
  mandate_scope_agent: { protector: "agent" },
  mandate_scope_undetermined: { protector: "undetermined" },
  agent_pay_after_expiry: { violator: "agent" }, // агент начал оплату после срока подтверждения
  operation_after_expiry: { violator: "platform" }, // операция после срока подтверждения — Платформа должна была отказать
  confirmation_expired: { violator: "client_decision", protector: "platform" }, // П-04: клиент не подтвердил
  wrong_shop: { violator: "agent" }, // Н-09
  agent_after_revoke: { violator: "agent" }, // Н-06
  double_debit: { violator: "agent" }, // Н-01
  double_pay: { violator: "agent" }, // Н-01
  idempotency: { protector: "platform" }, // повтор отклонён
  late_lost: { violator: "operator" }, // Н-12 (В7): адаптер пульта потерял событие
  instruction_excluded: { violator: "merchant", protector: "agent" }, // Н-05 после передачи agentic-buyer-ref#113
};
/** Сбой стенда «П» → субъекты. */
const BY_FAULT: Partial<Record<StandLogWhat, Row>> = {
  UPK_CODE_LEAKED: { violator: "bank" }, // Н-11
  SECOND_CREDENTIAL_ISSUED: { violator: "platform" }, // Н-02: платёжная система не отсекла повтор
  PAID_BEFORE_OUTCOME: { violator: "merchant", protector: "operator" }, // Н-03 (В7): защитил пульт
  FULFILLED_BEFORE_OUTCOME: { violator: "merchant" }, // Н-04
};
/** Сработавшая защита без вердикта условия → нарушитель (защитник — по источнику остановки, `GuaranteeHit.protector`).
 *  Задание v1.0: П-05 — решение клиента (лимит в банке), защитил банк; П-07 — защитила Платформа (403); отзыв поручения без
 *  покупки — решение клиента. */
const BY_GUARANTEE: Readonly<Record<Guarantee, { readonly violator?: Subject }>> = {
  limit_client: { violator: "client_decision" },
  agent_suspended: {},
  revoke: { violator: "client_decision" },
  mandate_scope: {},
  // Р-1524: отказ витрины на повтор оплаты — защита, нарушитель — по вердикту условия R46 (пометка Н-01).
  pay_refused: {},
};

/** Пометка «ПР» (нарушение, разыгранное приложением ключом агента) → субъекты. */
const BY_MARK: Partial<Record<StandTest, Row>> = {
  "Н-01": { violator: "agent" },
  "Н-05": { violator: "agent" },
  "Н-06": { violator: "agent" },
  "Н-07": { violator: "agent" },
  // В8 и решение по П-3.3, 1: защитник «Платформа» — только если на шине был её отказ MANDATE_SCOPE (`subjectsOf`).
  "Н-08": { violator: "agent" },
  "Н-09": { violator: "agent" },
};

/** Строка таблицы по причине; нет строки — `undefined` (тогда «не определён»). У пометки «ПР» защитник — по причине по
 *  шине того же условия, а не по умолчанию. */
export function subjectsOf(cause: Cause | undefined): Row | undefined {
  if (cause === undefined) return undefined;
  if (cause.kind === "rule") return BY_RULE[cause.rule];
  if (cause.kind === "fault") return BY_FAULT[cause.what];
  const row = BY_MARK[cause.test];
  if (row === undefined) return undefined;
  // Защитник из причины по шине — только Н-08 при отказе Платформы MANDATE_SCOPE (решение по П-3.3, 1); у других
  // пометок — нет (повторное ревью П-3.3 № 2: иначе Н-05 после #113 дал бы «нарушил агент, защитил агент»).
  // Защитник — по источнику остановки (ревью П-5.1 № 1): только ответ Платформы даёт «Платформа».
  const protector = cause.test === "Н-08" && cause.bus?.startsWith("mandate_scope_") ? BY_RULE[cause.bus].protector : undefined;
  return { ...row, ...(protector && { protector }) };
}

export interface Verdict {
  readonly kind: VerdictKind;
  /** Транзакция или поручение; нет — запись системы. */
  readonly obj?: string;
  readonly cond?: CheckableCondition;
  readonly guarantee?: Guarantee;
  readonly violator?: Subject;
  readonly protector?: Party | "undetermined";
  readonly node?: NodeId;
  readonly cause?: Cause;
  /** Почему субъект «не определён»: гонка С-28 — вердикт владельца (В5). */
  readonly note?: "race_c28";
  /** Доказательства: seq записей шины. */
  readonly seqs: readonly number[];
}

const nodeOf = (c: CheckableCondition): NodeId | undefined =>
  (Object.keys(NODES) as NodeId[]).find((n) => (NODES[n].conds as readonly string[]).includes(c));

function fromCond(c: CheckableCondition, res: CondResult, obj?: string): Verdict | undefined {
  if (res.status !== "bad" && res.status !== "fired") return undefined;
  const row = subjectsOf(res.cause);
  const base = { cond: c, seqs: res.seqs, ...(obj !== undefined && { obj }), ...(res.cause && { cause: res.cause }) };
  // Узел У1–У5 — у нарушения: нарушитель — участник или «не определён» (правило паспорта, решение по П-3.3, 3); у защиты
  // без нарушителя и у решения клиента узла нет.
  const node = nodeOf(c);
  const withNode = (v: Subject | undefined) => (node && v !== undefined && v !== "client_decision" ? { node } : {});
  // Причина без строки в таблице: «не определён» — не субъект по умолчанию.
  if (row === undefined)
    return res.status === "bad"
      ? { kind: "violation", ...base, ...withNode("undetermined"), violator: "undetermined" }
      : { kind: "protection", ...base, protector: "undetermined" };
  const kind: VerdictKind = res.status === "bad" ? "violation" : row.violator === "client_decision" ? "client_decision" : "protection";
  return {
    kind,
    ...base,
    ...withNode(row.violator),
    ...(row.violator && { violator: row.violator }),
    ...(row.protector && { protector: row.protector }),
    ...(row.note && { note: row.note }),
  };
}

/** Вердикты: по условиям объектов («нарушено», «сработало»), по записям системы без объекта и решения клиента (отказ от
 *  корзины — П-03) и по сработавшим защитам без вердикта условия (П-5.1). */
export function verdicts(view: EngineView, model: TxModel, items: readonly Interpretation[]): Verdict[] {
  const out: Verdict[] = [];
  for (const o of view.objs)
    for (const c of CHECKABLE_CONDITIONS) {
      const v = fromCond(c, o.conds[c], o.id);
      if (v) out.push(v);
    }
  // Сводные «нарушено» / «сработало», которых нет ни у одного объекта, — записи журнала без объекта.
  for (const c of CHECKABLE_CONDITIONS) {
    const s = view.system[c];
    if (out.some((v) => v.cond === c && (v.kind === "violation") === (s.status === "bad"))) continue;
    const v = fromCond(c, s);
    if (v) out.push(v);
  }
  // Вердикты по сработавшим защитам (П-5.1; Р-1484, ревью П-3.3 № 3): одна остановка — одна защита, «кто защитил» — по
  // источнику (`GuaranteeHit.protector`). Защита, у которой в том же объекте уже есть вердикт условия (вне пределов — R17,
  // отзыв в транзакции — R09), второй раз не считается.
  const COVERED: Readonly<Record<Guarantee, readonly CheckableCondition[]>> = {
    mandate_scope: ["R17"],
    agent_suspended: [],
    revoke: ["R09", "R37"],
    limit_client: [],
    // R46 — нарушение (попытка), а не та же защита: отказ продавца — отдельный вердикт защиты.
    pay_refused: [],
  };
  const bySeqG = new Map(items.map((x) => [x.seq, x] as const));
  for (const g of view.guarantees) {
    if (out.some((v) => v.obj === g.obj && v.cond !== undefined && COVERED[g.kind].includes(v.cond))) continue;
    // Отзыв или не действует — субъект по коду, как у R09 (`stopCause`; повторное ревью П-5.1 № 4): отзыв — решение
    // клиента; срок — нарушителя нет; один MANDATE_NOT_ACTIVE — не определён.
    const codes = new Set(g.seqs.map((s) => bySeqG.get(s)).flatMap((x) => (x?.who?.code !== undefined ? [x.who.code] : x?.ref === "revoke.refused" ? ["MANDATE_REVOKED"] : [])));
    const row =
      g.kind !== "revoke" ? BY_GUARANTEE[g.kind] : codes.has("MANDATE_REVOKED") ? BY_GUARANTEE.revoke : codes.has("MANDATE_EXPIRED") ? {} : { violator: "undetermined" as const };
    out.push({
      kind: row.violator === "client_decision" ? "client_decision" : "protection",
      ...(g.obj !== undefined && { obj: g.obj }),
      guarantee: g.kind,
      ...(row.violator && { violator: row.violator }),
      protector: g.protector,
      seqs: g.seqs,
    });
  }
  const bySeq = new Map(items.map((x) => [x.seq, x] as const));
  // П-03: клиент отказался подписать корзину — событие Платформы `mandate.rejected` по поручению корзины.
  for (const t of model.txs) {
    const rej = t.seqs.map((s) => bySeq.get(s)).find((x) => x?.source === "pao_event" && x.ref === "mandate.rejected" && x.ids?.mandate_id === t.cartMandateId);
    // Остановка после отказа уже дала R09 «решение клиента» (Р-1538) — тот же отказ второй раз не считается.
    const viaR09 = out.some((v) => v.obj === t.id && v.cond === "R09" && v.cause?.kind === "rule" && v.cause.rule.startsWith("rejected_"));
    if (rej && !viaR09) out.push({ kind: "client_decision", obj: t.id, violator: "client_decision", seqs: [rej.seq] });
  }
  return out;
}
