// «Причины» пульта DEMO-2 (П-5.1; модель пульта 1.23 — `causesFor`, `deepCause`, `evidenceChain`, «Паспорт полностью»).
// Чистая функция над вердиктами (`verdict.ts`), моделью транзакций и записями шины: что показать человеку по транзакции —
// без своих решений (инвариант 2: вид, нарушитель и защитник — из вердикта; итог — только по событию Платформы, инвариант 6).
// У каждого вердикта — все восемь полей разбора (план П-5.1, Р-1521): что случилось, кто нарушил / кто защитил, где
// проявилось, правило, почему неправильно (по номеру правила — тексты на странице, `#rules89`), последствия, что делать,
// гарантии. Считается только для транзакций и поручений с вердиктом; цепочка — последние `CHAIN_LIMIT` записей и все
// доказательства разбора (Р-1519). Запись с похожим на номер карты — «скрыта» здесь, на сервере: номер не уходит ни на
// экран, ни в ленту (инвариант 1; ревью П-5.1 № 5).
import type { Interpretation, Kind, Role } from "../dashboards/interpret.js";
import { GUARANTEE_INFO, safePhrase, type Guarantee, type Stopper } from "./engine.js";
import { PULT, type Phrase } from "./phrases.js";
import { CONDITIONS, RULES89, type CheckableCondition, type ConditionId, type NodeId, type Point } from "./rules89.js";
import type { TxModel } from "./tx.js";
import type { Subject, Verdict, VerdictKind } from "./verdict.js";
import type { WaitCandidate } from "./control.js";

const p = (ru: string, en: string): Phrase => ({ ru, en });

/** Последствия нарушения в узле — тексты модели 1.23 (`deepCause`), ru/en. */
export const NODE_CONSEQUENCES: Readonly<Record<NodeId, Phrase>> = {
  У1: p("агент действует по чужой команде — обман клиента, переплата", "the agent acts on someone else's command — the client is deceived or overpays"),
  У2: p("клиент платит дважды за один заказ", "the client pays twice for one order"),
  У3: p("товар выдан без оплаты или «оплачено» без денег", "goods released without payment, or “paid” without money"),
  У4: p("оператор и клиент видят неверный итог", "the operator and the client see a wrong outcome"),
  У5: p("покупка без воли клиента после отзыва", "a purchase without the client's will after revocation"),
};
/** Последствия по виду вердикта, когда узла нет (или вердикт — не нарушение). */
export const KIND_CONSEQUENCES: Readonly<Record<VerdictKind, Phrase>> = {
  violation: p("нарушение правильности транзакции; возможен спор с клиентом", "the transaction is not correct; a dispute with the client is possible"),
  protection: p("процесс остановлен до вреда — деньги клиента не списаны", "the process was stopped before harm — the client's money was not debited"),
  client_decision: p("покупки нет — по воле клиента", "no purchase — by the client's will"),
};
/** «Что делать» у сработавшей защиты без проверяемого условия (у условий — `CONDITIONS.todo`). */
export const GUARANTEE_TODO: Readonly<Record<Guarantee, Phrase>> = {
  mandate_scope: p("ничего срочного — покупка остановлена; разобрать, почему агент вышел за пределы поручения", "nothing urgent — the purchase was stopped; find out why the agent went outside the mandate"),
  agent_suspended: p("ничего срочного — агент остановлен; клиенту сообщить о начатых покупках", "nothing urgent — the agent was stopped; inform the client about purchases in progress"),
  revoke: p("ничего срочного — покупка остановлена: поручение отозвано или не действует; проверить, что клиент видит итог", "nothing urgent — the purchase was stopped: the mandate is revoked or inactive; check that the client sees the outcome"),
  limit_client: p("сообщить клиенту: лимит в банке; повтор — после изменения лимита", "tell the client: the bank limit; retry after the limit is changed"),
  pay_refused: p("ничего срочного — второе списание не прошло; разобрать, почему агент повторил оплату", "nothing urgent — the second debit did not go through; find out why the agent repeated the payment"),
};
/** Последствия нарушения, которое остановила защита (Р-1524: попытка была, вреда нет). */
export const STOPPED_CONSEQUENCES = p("попытка остановлена защитой — вред не наступил", "the attempt was stopped by a protection — no harm was done");
/** Условия справочника, правила которых объясняют защиту (по номеру правила, ревью П-5.1 № 6): вне пределов — R17 (Г06,
 *  Ж02); приостановка — R05 (А06, Л04); отзыв — R09, R37, R38 (Б06, Л01, Л02); лимит банка — R29 (Е06). */
export const GUARANTEE_CONDS: Readonly<Record<Guarantee, readonly ConditionId[]>> = {
  mandate_scope: ["R17"],
  agent_suspended: ["R05"],
  revoke: ["R09", "R37", "R38"],
  limit_client: ["R29"],
  pay_refused: ["R46"],
};
/** Решение клиента без условия и без защиты (отказ от корзины, П-03): правила — согласие корзины (R18), что делать — своё,
 *  гарантия — «защиты не требовалось» (повторное ревью П-5.1 № 1). */
const DECISION_CONDS: readonly ConditionId[] = ["R18"];
export const DECISION_TODO = p("ничего — покупки нет по воле клиента; показать клиенту итог", "nothing — no purchase by the client's will; show the client the outcome");
export const NO_GUARD_NEEDED = p("защиты не требовалось — решение клиента", "no protection needed — the client's decision");
/** Условие сработавшей защиты → вид защиты для «что делать»: у защиты не «остановить», а разобрать (повторное № 8). */
const COND_GUARANTEE: Partial<Record<CheckableCondition, Guarantee>> = { R17: "mandate_scope", R09: "revoke", R37: "revoke" };

/** П-06 на стенде (ревью П-5.1а № 7): защита «вне области» (`mandate_scope_*`) у поручения без покупки — корзины нет.
 *  Формулировка R17 («сумма совпадает с итогом корзины») к ней не подходит: заголовок — у любой такой защиты, причина —
 *  нейтрально; «что делать» об отказе агента — только когда остановил агент (`mandate_scope_agent`). */
// Нейтрально «вне области»: ядро даёт `MANDATE_OUT_OF_SCOPE` на любой статус поручения, кроме ACTIVE (ревью П-6.1б № 6).
export const SCOPE_NO_CART_TITLE = p(
  "Вне области поручения — агент отказался до корзины",
  "Outside the mandate's scope — the agent refused before a cart",
);
export const SCOPE_NO_CART_TODO = p(
  "ничего — агент сам не пошёл к продавцу вне поручения; показать клиенту, что покупка не начата",
  "nothing — the agent itself did not go to a seller outside the mandate; show the client that no purchase was started",
);

/** Сколько последних записей транзакции в цепочке (Р-1519). */
export const CHAIN_LIMIT = 40;
/** Сколько записей-доказательств в «что случилось». */
const HAPPENED_LIMIT = 4;

export interface ChainRecord {
  readonly seq: number;
  readonly at: string;
  readonly actor: Role;
  readonly kind: Kind;
  readonly phrase: Phrase;
}

/** Разбор одного вердикта: восемь полей, ни одно не пустое. */
export interface CauseItem {
  readonly kind: VerdictKind;
  readonly cond?: CheckableCondition;
  readonly guarantee?: Guarantee;
  /** Формулировка условия или название сработавшей защиты. */
  readonly title: Phrase;
  readonly node?: NodeId;
  readonly note?: "race_c28";
  /** 1. Что случилось — до 4 последних записей-доказательств (нет доказательств — последние записи объекта). */
  readonly happened: readonly ChainRecord[];
  /** 2. Кто нарушил и кто защитил; «none» — нарушителя нет / защиты не было. */
  readonly violator: Subject | "none";
  readonly protector: Stopper | "none";
  /** 3. Где проявилось — точки контроля правил (названия — на странице). */
  readonly where: readonly Point[];
  /** 4–5. Правило и почему неправильно — номера правил справочника (тексты — на странице, `#rules89`). */
  readonly rules: readonly string[];
  /** 6. Последствия. */
  readonly consequences: Phrase;
  /** 7. Что делать. */
  readonly todo: Phrase;
  /** 8. Гарантии: у нарушения — сработавшие защиты транзакции или «система не остановила»; у защиты — она сама. */
  readonly guarantees: readonly Phrase[];
}

export interface TxCauses {
  /** Транзакция или поручение без покупки. */
  readonly id: string;
  /** Итог — только по событию Платформы (вид итога модели транзакций). */
  readonly outcome?: string;
  readonly items: readonly CauseItem[];
  /** «Идёт к нарушению» по этой транзакции (П-4.1). */
  readonly waits: readonly WaitCandidate[];
  /** Цепочка событий: последние `chainLimit` записей и все доказательства разбора (Р-1519). */
  readonly chain: readonly ChainRecord[];
  /** Сколько всего записей у транзакции — для пометки «показаны последние 40 из N». */
  readonly chainTotal: number;
  readonly chainLimit: number;
}

const chainRecord = (x: Interpretation): ChainRecord => ({ seq: x.seq, at: x.at, actor: x.actor, kind: x.kind, phrase: safePhrase(x) });
const subjectPhrase = (s: Stopper | Subject): Phrase => PULT[`subj.${s}` as keyof typeof PULT];
const sameTitle = (v: Verdict): Phrase =>
  v.cond !== undefined ? CONDITIONS.find((c) => c.id === v.cond)!.rule : v.guarantee !== undefined ? GUARANTEE_INFO[v.guarantee].name : PULT["subj.client_decision"];
const guardPhrase = (v: Verdict, title?: Phrase): Phrase => {
  const t = title ?? sameTitle(v);
  const by = subjectPhrase(v.protector ?? "undetermined");
  return { ru: `${t.ru} — ${PULT["int.protector"].ru}: ${by.ru}`, en: `${t.en} — ${PULT["int.protector"].en}: ${by.en}` };
};

function item(v: Verdict, own: readonly Verdict[], objRecs: readonly Interpretation[], bySeq: ReadonlyMap<number, Interpretation>, noCart = false): CauseItem {
  // П-06: защита агента «вне пределов» у поручения без покупки — свой заголовок и «что делать» (ревью П-5.1а № 7).
  // Заголовок — у любой защиты «вне области» без покупки (кто остановил — в поле «кто защитил»; ревью П-6.1б № 5); «что
  // делать» про отказ агента — только когда остановил агент.
  const scopeNoCart = noCart && v.kind === "protection" && v.cond === "R17" && v.cause?.kind === "rule" && v.cause.rule.startsWith("mandate_scope_");
  const agentNoCart = scopeNoCart && v.cause?.kind === "rule" && v.cause.rule === "mandate_scope_agent";
  const title = scopeNoCart ? SCOPE_NO_CART_TITLE : sameTitle(v);
  const evidence = v.seqs.map((s) => bySeq.get(s)).filter((x): x is Interpretation => x !== undefined);
  // Нет доказательств шины (пометка «ПР», сбой стенда) — последние записи объекта с ошибкой, конфликтом или фродом, иначе
  // последняя запись: «что случилось» не пустое.
  const fallback = objRecs.filter((x) => x.kind !== "norm");
  const happened = (evidence.length > 0 ? evidence : fallback.length > 0 ? fallback : objRecs).slice(-HAPPENED_LIMIT).map(chainRecord);
  const conds: readonly ConditionId[] = v.cond !== undefined ? [v.cond] : v.guarantee !== undefined ? GUARANTEE_CONDS[v.guarantee] : DECISION_CONDS;
  const rules = RULES89.filter((r) => (r.conds as readonly ConditionId[]).some((c) => conds.includes(c)));
  // Защиты транзакции; у нарушения со своим защитником (Р-1541 № 3: нарушил агент, защитила Платформа) — и оно само:
  // попытка остановлена, карточка не противоречит себе (ревью П-6.1б № 3).
  const guards = own.filter((x) => (x.kind !== "violation" || x === v) && x.protector !== undefined);
  // «Что делать»: у нарушения — из справочника условий; у защиты — по виду защиты (покупка уже остановлена); у решения
  // клиента без защиты — своё.
  const asGuarantee = v.guarantee ?? (v.cond !== undefined ? COND_GUARANTEE[v.cond] : undefined);
  const todo = agentNoCart
    ? SCOPE_NO_CART_TODO
    : v.kind === "violation" && v.cond !== undefined
      ? CONDITIONS.find((c) => c.id === v.cond)!.todo
      : asGuarantee !== undefined
        ? GUARANTEE_TODO[asGuarantee]
        : v.kind === "client_decision"
          ? DECISION_TODO
          : CONDITIONS.find((c) => c.id === v.cond)?.todo ?? DECISION_TODO;
  return {
    kind: v.kind,
    ...(v.cond !== undefined && { cond: v.cond }),
    ...(v.guarantee !== undefined && { guarantee: v.guarantee }),
    title,
    ...(v.node !== undefined && { node: v.node }),
    ...(v.note !== undefined && { note: v.note }),
    happened,
    violator: v.violator ?? "none",
    protector: v.protector ?? "none",
    where: [...new Set(rules.map((r) => r.point))],
    rules: rules.map((r) => r.id),
    // Нарушение, которое остановила защита той же транзакции (Н-01 — отказ продавца): вреда нет (Р-1524).
    consequences:
      v.kind === "violation" && guards.length > 0 ? STOPPED_CONSEQUENCES : v.kind === "violation" && v.node !== undefined ? NODE_CONSEQUENCES[v.node] : KIND_CONSEQUENCES[v.kind],
    todo,
    guarantees:
      v.kind === "violation"
        ? guards.length > 0
          ? guards.map((g) => guardPhrase(g, g === v ? title : undefined))
          : [PULT["int.guarantees.none"]]
        : v.protector !== undefined
          ? [guardPhrase(v, title)]
          : [NO_GUARD_NEEDED],
  };
}

/** «Причины» по транзакциям и поручениям с вердиктом. `waits` — кандидаты «Идёт к нарушению» (П-4.1). */
export function causesView(model: TxModel, items: readonly Interpretation[], vs: readonly Verdict[], waits: readonly WaitCandidate[]): TxCauses[] {
  const bySeq = new Map(items.map((x) => [x.seq, x] as const));
  const objs = [...new Set(vs.map((v) => v.obj).filter((x): x is string => x !== undefined))];
  return objs.map((id): TxCauses => {
    const t = model.txs.find((x) => x.id === id);
    const m = t ? undefined : model.mandates.find((x) => x.id === id);
    const seqs = t?.seqs ?? m?.seqs ?? [];
    const own = vs.filter((v) => v.obj === id);
    const recs = seqs.map((s) => bySeq.get(s)).filter((x): x is Interpretation => x !== undefined).sort((a, b) => a.seq - b.seq);
    // Последние 40 записей объекта и все доказательства разбора — даже старше 40-й и даже из записей намерения
    // (ревью П-5.1 № 3, Р-1519): разбор не ссылается на невидимое.
    const evidence = own.flatMap((v) => v.seqs).map((s) => bySeq.get(s)).filter((x): x is Interpretation => x !== undefined);
    const shown = new Map<number, Interpretation>([...recs.slice(-CHAIN_LIMIT), ...evidence].map((x) => [x.seq, x] as const));
    return {
      id,
      ...(t?.outcome && { outcome: t.outcome.kind }),
      items: own.map((v) => item(v, own, recs, bySeq, m !== undefined)),
      waits: waits.filter((w) => w.obj === id),
      chain: [...shown.values()].sort((a, b) => a.seq - b.seq).map(chainRecord),
      chainTotal: recs.length,
      chainLimit: CHAIN_LIMIT,
    };
  });
}
