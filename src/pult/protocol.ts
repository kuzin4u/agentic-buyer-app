// Протокол негативных значений П-NNN и журнал действий пульта (П-6.1а; модель пульта 1.23, раздел 1.10 — `protoAdd`,
// `protoTick`, `PSTAT`: переносятся правила, не код). План — PR #9 #issuecomment-6852219472, ответ #issuecomment-6852564814.
//
// Записи трёх типов: предупреждение («Идёт к нарушению», `control.waits` после порога), нарушение (вердикт `violation`),
// сработавшая гарантия (вердикт `protection` — и защиты, что живут только в условиях: П-06 по R17, П-09 по R09; ревью
// П-5.1а № 3). Ключ — тип + условие (или гарантия) + объект: одна остановка — одна запись, второй раз не заводится.
// Решение клиента (П-03, П-04, П-05, П-08) — не негативное значение: в протокол не идёт, в «Журнале действий» — строкой (В1 (а)).
//
// Статусы: гарантия — сразу `stopped`; остальное — `open`; реакция пульта по тому же объекту и тому же условию или узлу, не
// раньше появления записи, — `reacted`. Предупреждение ушло: с нарушением того же условия по объекту — `closed`; без нарушения —
// `prevented`, только если движок отметил «упреждено реакцией» (`preempted_by_reaction`, доказательство — запись стенда,
// Р-1531), иначе `cleared` (В2 (а); в модели `prevented` ставился по уходу предупреждения после реакции — сознательное
// отступление, STATUS «Расхождения» № 11). Нарушение с реакцией — `closed`, когда у транзакции есть итог.
//
// Время появления — по данным, а не по моменту пересчёта (пересчёт идёт по новым записям, а предупреждение созревает и без
// них): предупреждение — начало ожидания + порог; нарушение и гарантия — время последней записи-доказательства. Время до
// реакции — от появления до первой связанной реакции.
import type { Interpretation } from "../dashboards/interpret.js";
import type { Reaction } from "./actions.js";
import type { WaitCandidate } from "./control.js";
import { GUARANTEE_INFO, type EngineView, type Guarantee } from "./engine.js";
import type { Phrase } from "./phrases.js";
import { NODES, type NodeId, type Party } from "./rules89.js";
import type { TxModel } from "./tx.js";
import type { Subject, Verdict } from "./verdict.js";

export const PROTO_TYPES = ["warn", "bad", "fired"] as const;
export type ProtoType = (typeof PROTO_TYPES)[number];
export const PROTO_STATUSES = ["open", "reacted", "prevented", "cleared", "closed", "stopped"] as const;
export type ProtoStatus = (typeof PROTO_STATUSES)[number];

export interface ProtoEntry {
  /** `П-001`… по порядку появления. */
  readonly no: string;
  readonly type: ProtoType;
  /** Условие (R08…R47) или гарантия без условия. */
  readonly cond?: string;
  readonly guarantee?: Guarantee;
  /** Название гарантии без условия — ru/en из `GUARANTEE_INFO`. */
  readonly guaranteeText?: Phrase;
  /** Транзакция или поручение; запись системы — "". */
  readonly obj: string;
  /** Номер запроса подтверждения у предупреждения R21. */
  readonly confirmationId?: string;
  readonly at: string;
  readonly status: ProtoStatus;
  readonly reactedAt?: string;
  readonly reaction?: Reaction["action"];
  /** Секунд от появления до реакции. */
  readonly reactSec?: number;
  readonly endedAt?: string;
  readonly violator?: Subject;
  readonly protector?: Party | "undetermined";
}

/** Решение клиента — строкой «Журнала действий» (В1 (а)). */
export interface ClientDecisionRow {
  readonly obj: string;
  readonly cond?: string;
  readonly at: string;
}

export interface ProtocolView {
  readonly entries: readonly ProtoEntry[];
  readonly decisions: readonly ClientDecisionRow[];
  readonly counts: Readonly<Record<ProtoStatus, number>>;
  /** Среднее время до реакции, с; реакций нет — нет. */
  readonly avgReactSec?: number;
}

export interface ProtocolState {
  readonly entries: readonly ProtoEntry[];
  readonly seq: number;
  /** Ключи записей, вытесненных пределом `PROTO_KEPT`: живой вердикт не заводит их заново под новым номером (ревью № 4). */
  readonly gone: readonly string[];
}
export const emptyProtocol = (): ProtocolState => ({ entries: [], seq: 0, gone: [] });

/** Реакция пульта; у напоминания журнал реакций знает, упредила ли его запись стенда R21 (`reactions.ts`, П-8.2). */
export type ProtoReaction = Reaction & { readonly preempted?: "R21" };

export interface ProtocolInput {
  readonly verdicts: readonly Verdict[];
  /** Все кандидаты «Идёт к нарушению» (до порога тоже): ушёл из кандидатов — предупреждение снято. */
  readonly waits: readonly WaitCandidate[];
  readonly waitMs: number;
  readonly now: string;
  readonly reactions: readonly ProtoReaction[];
  readonly model: TxModel;
  readonly items: readonly Interpretation[];
  /** Результат движка (для входа ленты; «упреждено» берётся из связанной реакции, а не из пометки на всей транзакции). */
  readonly ev?: EngineView;
}

/** Сколько записей протокола помнить: старые закрытые уходят первыми (как окно ленты). */
export const PROTO_KEPT = 500;
/** Сколько ключей вытесненных записей помнить. */
const GONE_KEPT = 20_000;
/** Реакция без условия (`stop`, `revoke`) связывается с записью не позже 15 с после её появления (модель 1.23, стр. 2402,
 *  `a.t - e.t <= 15`; ревью № 1): иначе отзыв через десять минут «отреагировал» бы на любое нарушение транзакции. */
export const UNCONDITIONED_REACT_MS = 15_000;

/** Ключ записи: тип + условие (или гарантия) + объект; у R21 — ещё номер запроса подтверждения (повтор после отказа — своя
 *  запись, ревью № 2); у записи системы — ещё первое доказательство (разные остановки не сливаются, ревью № 3). */
const keyOf = (type: ProtoType, cond: string | undefined, obj: string, sub?: string) => `${type}|${cond ?? ""}|${obj}${sub !== undefined ? `#${sub}` : ""}`;
const entryKey = (e: Pick<ProtoEntry, "type" | "cond" | "guarantee" | "obj" | "confirmationId"> & { readonly sysSeq?: number }) =>
  keyOf(e.type, e.cond ?? e.guarantee, e.obj, e.confirmationId ?? (e.sysSeq !== undefined ? String(e.sysSeq) : undefined));
const nodeOf = (cond: string | undefined): NodeId | undefined =>
  cond === undefined ? undefined : (Object.keys(NODES) as NodeId[]).find((n) => (NODES[n].conds as readonly string[]).includes(cond));
const iso = (ms: number) => new Date(ms).toISOString();

/** Шаг протокола: новые записи по входу, переходы статусов, связь с реакциями. Чистая функция: прежние записи не меняются. */
export function protocolStep(prev: ProtocolState, input: ProtocolInput): ProtocolState {
  const bySeq = new Map(input.items.map((x) => [x.seq, x] as const));
  const txById = new Map(input.model.txs.map((t) => [t.id, t] as const));
  const evidenceAt = (seqs: readonly number[]): string => {
    const ms = seqs.map((s) => bySeq.get(s)).filter((x): x is Interpretation => x !== undefined).map((x) => Date.parse(x.at));
    return ms.length > 0 ? iso(Math.max(...ms)) : input.now;
  };
  const entries: (ProtoEntry & { readonly sysSeq?: number })[] = [...prev.entries];
  const index = new Set(entries.map(entryKey));
  const gone = new Set(prev.gone);
  let seq = prev.seq;
  const add = (e: Omit<ProtoEntry, "no" | "status"> & { readonly sysSeq?: number }) => {
    const k = entryKey(e);
    if (index.has(k) || gone.has(k)) return;
    // Номер — идентификатор записи модели 1.23 («П-NNN»), одинаковый в ru и en (запись в GLOSSARY — STATUS «Открыто», № 8).
    const no = `П-${String(++seq).padStart(3, "0")}`;
    index.add(k);
    entries.push({ ...e, no, status: e.type === "fired" ? "stopped" : "open" });
  };

  // Нарушения и гарантии — по вердиктам (не только по `GuaranteeHit`); решение клиента — мимо протокола.
  for (const v of input.verdicts) {
    if (v.kind === "client_decision") continue;
    add({
      type: v.kind === "violation" ? "bad" : "fired",
      ...(v.cond !== undefined && { cond: v.cond }),
      ...(v.guarantee !== undefined && { guarantee: v.guarantee, guaranteeText: GUARANTEE_INFO[v.guarantee].name }),
      obj: v.obj ?? "",
      ...(v.obj === undefined && v.seqs.length > 0 && { sysSeq: Math.min(...v.seqs) }),
      at: evidenceAt(v.seqs),
      ...(v.violator !== undefined && { violator: v.violator }),
      ...(v.protector !== undefined && { protector: v.protector }),
    });
  }
  // Предупреждения — созревшие ожидания с условием (у «шага агента» условия нет — предположение, не условие).
  const nowMs = Date.parse(input.now);
  const live = new Set<string>();
  for (const w of input.waits) {
    if (w.cond === undefined) continue;
    const e = { type: "warn" as const, cond: w.cond, obj: w.obj, ...(w.confirmationId !== undefined && { confirmationId: w.confirmationId }) };
    live.add(entryKey(e));
    const dueAt = Date.parse(w.since) + input.waitMs;
    if (dueAt > nowMs) continue;
    add({ ...e, at: iso(dueAt) });
  }

  /** Объекты, которыми реакция может назвать запись: сама запись, её транзакция (поручения корзины и намерения, заказы,
   *  операции, запросы подтверждения — ревью № 5), транзакция, чьё намерение — объект записи (R08). */
  const sameObject = (r: ProtoReaction, e: ProtoEntry): boolean => {
    if (r.obj === e.obj || (e.confirmationId !== undefined && r.obj === e.confirmationId)) return true;
    const t = txById.get(e.obj);
    // Запись по запросу подтверждения не принимает реакцию по другому запросу той же транзакции (ревью П-6.1а № 12).
    if (e.confirmationId !== undefined && t?.confirmationIds.includes(r.obj)) return false;
    if (t && (r.obj === t.cartMandateId || r.obj === t.intentId || t.confirmationIds.includes(r.obj) || t.orderIds.includes(r.obj) || t.opRefs.includes(r.obj))) return true;
    return txById.get(r.obj)?.intentId === e.obj;
  };
  const linked = (r: ProtoReaction, e: ProtoEntry) => {
    const dt = Date.parse(r.at) - Date.parse(e.at);
    // Реакция после конца записи с ней не связана: иначе снятая запись получала бы «время до реакции» через час (№ 12).
    if (dt < 0 || (e.endedAt !== undefined && Date.parse(r.at) > Date.parse(e.endedAt)) || !sameObject(r, e)) return false;
    if (r.cond === undefined) return dt <= UNCONDITIONED_REACT_MS;
    return r.cond === e.cond || (nodeOf(r.cond) !== undefined && nodeOf(r.cond) === nodeOf(e.cond));
  };

  // Нарушение того же условия по тому же звену: предупреждение R08 стоит на поручении-намерении, вердикт — на транзакции.
  const sameLink = (vObj: string, obj: string) => {
    if (vObj === obj) return true;
    const t = txById.get(vObj);
    return t !== undefined && (t.intentId === obj || t.cartMandateId === obj);
  };
  const violated = (cond: string | undefined, obj: string) => input.verdicts.some((v) => v.kind === "violation" && v.cond === cond && sameLink(v.obj ?? "", obj));
  // «Упреждено» — только напоминание, которое журнал реакций связал с записью стенда R21 (`preempted`), по тому же запросу
  // подтверждения (ревью № 6; В2 (а)): не пометка на всей транзакции и не любая реакция.
  const preemptedBy = (e: ProtoEntry) =>
    input.reactions.some((r) => r.action === "remind" && r.preempted === "R21" && linked(r, e) && (e.confirmationId === undefined || r.obj === e.confirmationId));
  // Итог — у транзакции записи или (нарушение на поручении-намерении) у транзакций этого намерения (ревью № 9).
  const done = (obj: string) => txById.get(obj)?.outcome !== undefined || input.model.txs.some((t) => t.intentId === obj && t.outcome !== undefined);

  for (let i = 0; i < entries.length; i++) {
    let e = entries[i]!;
    if (e.type === "fired") continue;
    // Реакция — первая связанная, не раньше появления записи.
    if (e.reactedAt === undefined) {
      const r = input.reactions.find((x) => linked(x, e));
      if (r) {
        e = { ...e, reactedAt: r.at, reaction: r.action, reactSec: Math.max(0, Math.round((Date.parse(r.at) - Date.parse(e.at)) / 1000)) };
        if (e.status === "open") e = { ...e, status: "reacted" };
      }
    }
    if (e.endedAt === undefined) {
      if (e.type === "warn" && !live.has(entryKey(e))) {
        const status: ProtoStatus = violated(e.cond, e.obj) ? "closed" : e.status === "reacted" && e.cond === "R21" && preemptedBy(e) ? "prevented" : "cleared";
        e = { ...e, status, endedAt: input.now };
      } else if (e.type === "bad" && e.status === "reacted" && done(e.obj)) e = { ...e, status: "closed", endedAt: input.now };
    }
    entries[i] = e;
  }
  // Предел: уходят старые закончившиеся (и гарантии); открытые не вытесняются никогда — предел тогда превышается, а не
  // теряется живое нарушение (ревью № 14). Ключ ушедшей — в `gone` (ревью № 4).
  while (entries.length > PROTO_KEPT) {
    const j = entries.findIndex((e) => e.endedAt !== undefined || e.type === "fired");
    if (j < 0) break;
    const [out] = entries.splice(j, 1);
    gone.add(entryKey(out!));
  }
  return { entries, seq, gone: [...gone].slice(-GONE_KEPT) };
}

/** Вид для экрана: записи, решения клиента строками журнала, счётчики статусов и среднее время до реакции. */
export function protocolView(st: ProtocolState, verdicts: readonly Verdict[], items: readonly Interpretation[]): ProtocolView {
  const bySeq = new Map(items.map((x) => [x.seq, x] as const));
  const counts = Object.fromEntries(PROTO_STATUSES.map((s) => [s, 0])) as Record<ProtoStatus, number>;
  for (const e of st.entries) counts[e.status]++;
  const rt = st.entries.flatMap((e) => (e.reactSec !== undefined ? [e.reactSec] : []));
  const decisions = verdicts
    .filter((v) => v.kind === "client_decision")
    .map((v) => {
      const ms = v.seqs.map((s) => bySeq.get(s)).filter((x): x is Interpretation => x !== undefined).map((x) => Date.parse(x.at));
      return { obj: v.obj ?? "", ...(v.cond !== undefined && { cond: v.cond }), at: ms.length > 0 ? iso(Math.max(...ms)) : "" };
    });
  return { entries: st.entries, decisions, counts, ...(rt.length > 0 && { avgReactSec: Math.round((rt.reduce((a, b) => a + b, 0) / rt.length) * 10) / 10 }) };
}
