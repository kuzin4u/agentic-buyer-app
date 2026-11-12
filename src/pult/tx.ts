// Модель транзакций пульта DEMO-2 (П-1.2, модель пульта 1.23: поручения MD и транзакции TX; Р-1442). Чистая функция над
// интерпретациями шины: транзакция собирается **по идентификаторам, а не по времени** (Р-1396 п. 2) — звенья, которые
// встречаются в одной записи, принадлежат одной транзакции (объединение множеств):
//   поручение корзины (`mandate_id` шагов `cart.*` и `order.placed`) ↔ заказ (`order_id`) ↔ операция (`op_ref`)
//   ↔ запрос подтверждения (`confirmation_id`); поручение-намерение — `intent_id` шага `cart.created`.
// Связки на шине — П-1.2: `order.placed` и шаги итога (`outcome`, `failed`, `limit.declined`) несут поручение корзины —
// операция связана с корзиной не только через номер заказа, который называет витрина (Р-1444); `operation.*` — заказ
// операции, прочитанной ядром; `limit.declined` и `failed` — `op_ref` из журнала ядра. Две корзины или два намерения в одной
// транзакции — «конфликт звеньев», итог не присваивается. Витрина (`merchant_id`, `shop_id`) звеном не считается: она общая
// у разных покупок. Записи без звеньев (поиск, служебные обращения) — у поручения-намерения или вне транзакций.
// Итог транзакции — только по событию Платформы (`source: pao_event`), не по шагу сюжета и не по ответу продавца
// (инвариант 6). Пределы и остатки модель не считает (инвариант 2).
import type { Interpretation, Kind, Stage } from "../dashboards/interpret.js";

/** Итог транзакции по событию Платформы. */
export type TxOutcomeKind = "paid" | "settled" | "declined" | "rejected" | "revoked";

export interface TxOutcome {
  readonly kind: TxOutcomeKind;
  /** Код отказа события, если он есть (квалификация интерпретатора). */
  readonly code?: string;
  readonly seq: number;
  readonly at: string;
}

/** Итог одной операции по событию Платформы (П-3.2а, Р-1444). */
export type TxOpKind = "paid" | "settled" | "declined";

/** Операция транзакции, связанная с корзиной шагом агента (Р-1458): итог — по её событиям Платформы; нет события — `kind` нет. */
export interface TxOperation {
  readonly opRef: string;
  readonly kind?: TxOpKind;
  readonly code?: string;
  /** seq и время события, давшего итог операции («проведено» уточняет «оплачено», время — «оплачено»). */
  readonly seq?: number;
  readonly at?: string;
}

export interface PultTx {
  /** Номер транзакции на пульте: поручение корзины, если оно известно, иначе первое звено с типом (`cart:…` — при конфликте
   *  звеньев, `order:…`, `op:…`, `confirmation:…`) — не совпадёт с номером корзины (ревью П-1.2 № 8). */
  readonly id: string;
  readonly intentId?: string;
  readonly cartMandateId?: string;
  /** Конфликт звеньев: в транзакцию попали две корзины или два поручения-намерения — например, витрина повторила номер
   *  заказа другой покупки. Звенья не сливаются молча: итог не присваивается, решает человек (ревью П-1.2 № 1, Р-1444). */
  readonly linkConflict?: { readonly carts: readonly string[]; readonly intents: readonly string[] };
  /** Операции с событием Платформы, не связанные с корзиной: корзина есть, запись агента по этой операции пришла, но с
   *  корзиной её не связала — «связь не подтверждена», итога по ним нет (Р-1458; П-3.2а — только при корзине и после шага). */
  readonly unconfirmedOps?: readonly string[];
  /** То же, но записи агента по операции ещё нет (или корзины нет): «ждём шаг агента» — событие Платформы обычно приходит
   *  раньше шага (повторное ревью П-2.1 № 1). Паузы нет — модель без часов; «шаг не пришёл за N с» — П-4.1. */
  readonly pendingOps?: readonly string[];
  /** Запросы подтверждения с итоговым событием (`confirmation.rejected`, `confirmation.expired`), где нет поручения
   *  корзины: «связь не подтверждена», итога нет (Р-1460; поручение к событию и итог «истёк» — П-8.1). */
  readonly unconfirmedConfirmations?: readonly string[];
  /** Операции, связанные с корзиной шагом агента, — по порядку первой записи; итог каждой — по её событиям (В6). */
  readonly ops: readonly TxOperation[];
  /** «Оплачено» пришло после события отзыва поручения корзины: итог — «оплачено», деньги ушли (В5; R09, R37 — П-3.2б). */
  readonly afterRevoke?: true;
  /** Две и больше операций с «оплачено» по одной корзине — два списания (для R46, П-3.2б). */
  readonly doubleDebit?: true;
  readonly orderIds: readonly string[];
  readonly opRefs: readonly string[];
  readonly confirmationIds: readonly string[];
  /** Продавцы записей транзакции, по алфавиту: все, а не первый встреченный (ревью П-2.3 № 4). */
  readonly merchantIds: readonly string[];
  /** Обращения к витринам: номер заказа → витрины (`shop_id`) — уточнение привязки журнала стенда (П-3.2г). */
  readonly shopsByOrder: Readonly<Record<string, readonly string[]>>;
  /** Стадия — по последней ключевой записи транзакции. */
  readonly stage: Stage;
  readonly outcome?: TxOutcome;
  /** Худший тип записей транзакции: фрод > ошибка > конфликт > норма. */
  readonly worst: Kind;
  /** seq записей транзакции по возрастанию. */
  readonly seqs: readonly number[];
  readonly firstAt: string;
  readonly lastAt: string;
}

export type MandateStatus = "created" | "awaiting_signature" | "active" | "revoked";

export interface PultMandate {
  readonly id: string;
  readonly status: MandateStatus;
  /** Транзакции этого поручения (по `intent_id`). */
  readonly txIds: readonly string[];
  /** Стадия конвейера покупки по поручению — по последней ключевой записи поручения. */
  readonly stage: Stage;
  readonly worst: Kind;
  readonly seqs: readonly number[];
  readonly firstAt: string;
  readonly lastAt: string;
}

export interface TxModel {
  readonly mandates: readonly PultMandate[];
  readonly txs: readonly PultTx[];
  /** seq записей вне поручений и транзакций (служебные обращения, запуск стенда, метки прогонов). */
  readonly unattached: readonly number[];
}

const KIND_RANK: Readonly<Record<Kind, number>> = { norm: 0, conflict: 1, error: 2, fraud: 3 };
const worse = (a: Kind, b: Kind): Kind => (KIND_RANK[b] > KIND_RANK[a] ? b : a);

/** Событие Платформы об операции → итог операции. Только `pao_event`: шаг сюжета `outcome` и ответ витрины итогом не
 *  являются (инвариант 6). */
const OP_EVENT: Readonly<Record<string, TxOpKind>> = {
  "operation.authorized": "paid",
  "operation.settled": "settled",
  "operation.declined": "declined",
};

/** Итоговые события запроса подтверждения: итог транзакции — только с поручением корзины в событии (П-8.1). */
const CONFIRMATION_FINAL = new Set(["confirmation.rejected", "confirmation.expired"]);

/** Шаги сюжета, которыми агент сообщает итог покупки по операции (`op_ref`): после них операция без связи с корзиной —
 *  «связь не подтверждена», до них — «ждём шаг агента» (П-3.2а). Это же определение «шага агента» — у «Контроля»
 *  (`control.ts`, ревью П-4.1 № 17). */
export const OUTCOME_STEPS: ReadonlySet<string> = new Set(["outcome", "limit.declined", "failed"]);

/** Объединение множеств со сжатием пути. */
class Links {
  readonly #parent = new Map<string, string>();
  find(x: string): string {
    let r = x;
    while (this.#parent.has(r) && this.#parent.get(r) !== r) r = this.#parent.get(r)!;
    let c = x;
    while (c !== r) {
      const next = this.#parent.get(c)!;
      this.#parent.set(c, r);
      c = next;
    }
    if (!this.#parent.has(r)) this.#parent.set(r, r);
    return r;
  }
  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.#parent.set(rb, ra);
  }
}

/** Поручение корзины: шаги корзины и заказа сюжета несут его `mandate_id`. */
const isCartStep = (r: Interpretation) => r.stream === "scenario" && (r.ref.startsWith("cart.") || r.ref === "order.placed");
const isIntentStep = (r: Interpretation) => r.stream === "scenario" && r.ref.startsWith("intent.");

export function buildTxModel(items: readonly Interpretation[]): TxModel {
  const list = [...items].sort((a, b) => a.seq - b.seq);
  // Пустая строка идентификатором не считается: иначе две покупки с order_id "" склеились бы (ревью П-1.2 № 6).
  const id = (v: string | undefined): string | undefined => (v === undefined || v === "" ? undefined : v);
  const carts = new Set<string>();
  const intents = new Set<string>();
  for (const r of list) {
    const m = id(r.ids?.mandate_id);
    if (m !== undefined && isCartStep(r)) carts.add(m);
    if (m !== undefined && isIntentStep(r)) intents.add(m);
    const i = id(r.ids?.intent_id);
    if (i !== undefined) intents.add(i);
  }

  // Звенья записи: поручение корзины, заказ, операция, запрос подтверждения. Поручение-намерение звеном не бывает.
  const links = new Links();
  const nodesOf = (r: Interpretation): string[] => {
    const ids = r.ids ?? {};
    const out: string[] = [];
    const m = id(ids.mandate_id);
    if (m !== undefined && carts.has(m)) out.push(`m:${m}`);
    const o = id(ids.order_id);
    if (o !== undefined) out.push(`o:${o}`);
    const p = id(ids.op_ref);
    if (p !== undefined) out.push(`p:${p}`);
    const c = id(ids.confirmation_id);
    if (c !== undefined) out.push(`c:${c}`);
    return out;
  };
  for (const r of list) {
    const n = nodesOf(r);
    for (let i = 1; i < n.length; i++) links.union(n[0]!, n[i]!);
  }

  interface TxAcc {
    nodes: Set<string>;
    intents: Set<string>;
    merchants: Set<string>;
    items: Interpretation[];
  }
  const txAcc = new Map<string, TxAcc>();
  const mdAcc = new Map<string, Interpretation[]>();
  const unattached: number[] = [];
  for (const r of list) {
    const n = nodesOf(r);
    if (n.length > 0) {
      const root = links.find(n[0]!);
      let acc = txAcc.get(root);
      if (!acc) txAcc.set(root, (acc = { nodes: new Set(), intents: new Set(), merchants: new Set(), items: [] }));
      for (const x of n) acc.nodes.add(x);
      const i = id(r.ids?.intent_id);
      if (i !== undefined) acc.intents.add(i);
      const mer = id(r.ids?.merchant_id);
      if (mer !== undefined) acc.merchants.add(mer);
      acc.items.push(r);
      continue;
    }
    const m = id(r.ids?.mandate_id);
    if (m !== undefined && intents.has(m)) {
      const l = mdAcc.get(m) ?? [];
      l.push(r);
      mdAcc.set(m, l);
      continue;
    }
    unattached.push(r.seq);
  }

  const txs: PultTx[] = [];
  for (const acc of txAcc.values()) {
    const pick = (prefix: string) => [...acc.nodes].filter((x) => x.startsWith(prefix)).map((x) => x.slice(2)).sort();
    const cartList = pick("m:");
    const intentList = [...acc.intents].sort();
    // Две корзины или два намерения в одной транзакции — звенья сцепились через чужой идентификатор (например, повтор
    // номера заказа витриной). Молча не сливаем и итог не присваиваем: «оплачено» по чужой операции хуже, чем «конфликт».
    const conflict = cartList.length > 1 || intentList.length > 1;
    const cart = conflict ? undefined : cartList[0];
    const first = acc.items[0]!;
    const last = acc.items[acc.items.length - 1]!;
    // Операции, связанные с корзиной самим агентом: запись, где есть и op_ref, и поручение этой корзины (шаги итога
    // `outcome`, `limit.declined`, `failed`; событие с поручением). Связь только через номер заказа витрины — не
    // подтверждена: итога по такой операции нет (повторное ревью П-1.2 № 1, инвариант 6; Р-1458).
    // Источник связки — шаг сюжета, журнал агента или событие Платформы; обращение «по сети» (чужое) связку не
    // подтверждает (ревью П-2.1 № 5).
    const confirmedOps = new Set<string>();
    // Операции, по которым пришёл шаг итога агента — шаг сюжета `outcome`, `limit.declined`, `failed` с этим op_ref, — по
    // каждой операции отдельно. Нет шага по операции — «ждём шаг агента»; шаг есть, но с корзиной не связал — «связь не
    // подтверждена» (П-3.2а; ревью П-3.2а № 1: при повторе шаг P1 не делает событие P2 «не подтверждённым» до шага P2).
    // Строка журнала агента `operation.status` (чтение операции, только op_ref) шагом итога не считается (ревью № 11).
    const agentOps = new Set<string>();
    for (const r of acc.items) {
      const p = id(r.ids?.op_ref);
      if (p !== undefined && r.stream === "scenario" && OUTCOME_STEPS.has(r.ref)) agentOps.add(p);
      if (cart === undefined || (r.stream === "monitor" && r.source !== "pao_event")) continue;
      if (p !== undefined && id(r.ids?.mandate_id) === cart) confirmedOps.add(p);
    }
    const unlinked = new Set<string>();
    const unconfirmedConf = new Set<string>();
    // Итог каждой операции — по её событиям (Р-1444): первый итог операции остаётся, «проведено» уточняет «оплачено».
    const ops = new Map<string, { opRef: string; kind?: TxOpKind; code?: string; seq?: number; at?: string }>();
    for (const r of acc.items) {
      const p = id(r.ids?.op_ref);
      if (p !== undefined && confirmedOps.has(p) && !ops.has(p)) ops.set(p, { opRef: p });
    }
    let revokedAt: { seq: number; at: string; code?: string } | undefined;
    let rejected: TxOutcome | undefined;
    let worst: Kind = conflict ? "conflict" : "norm";
    for (const r of acc.items) {
      worst = worse(worst, r.kind);
      if (conflict || r.source !== "pao_event") continue;
      if (r.ref.startsWith("operation.")) {
        const p = id(r.ids?.op_ref);
        if (p === undefined || !confirmedOps.has(p)) {
          if (p !== undefined && OP_EVENT[r.ref] !== undefined) unlinked.add(p);
          continue;
        }
        const k = OP_EVENT[r.ref];
        const op = ops.get(p)!;
        if (k === undefined) continue;
        if (op.kind === undefined) {
          op.kind = k;
          op.seq = r.seq;
          op.at = r.at;
          if (k === "declined" && r.who?.code !== undefined) op.code = r.who.code;
        } else if (op.kind === "paid" && k === "settled") op.kind = "settled";
        continue;
      }
      // Подтверждение — итог только с поручением этой корзины в самом событии. По ПАО 1.4.0 событие несёт только
      // `confirmation_id`, шина добавляет номер заказа из записи подтверждения — связь только номером заказа: «связь не
      // подтверждена», итога нет (ревью П-2.1 № 1, Р-1460). Поручение корзины к событию и итог «истёк» — П-8.1.
      if (CONFIRMATION_FINAL.has(r.ref)) {
        if (cart === undefined || id(r.ids?.mandate_id) !== cart) {
          const c = id(r.ids?.confirmation_id);
          if (c !== undefined) unconfirmedConf.add(c);
        } else if (r.ref === "confirmation.rejected" && rejected === undefined)
          rejected = { kind: "rejected", ...(r.who?.code !== undefined && { code: r.who.code }), seq: r.seq, at: r.at };
        // `confirmation.expired` с поручением корзины в событии — до П-8.1 не итог (по ПАО 1.4.0 недостижимо: поручения в
        // событии подтверждения нет); итог «истёк» — П-8.1 (ревью П-3.2а № 7).
        continue;
      }
      if (r.ref === "mandate.revoked" && cart !== undefined && id(r.ids?.mandate_id) === cart && revokedAt === undefined)
        revokedAt = { seq: r.seq, at: r.at, ...(r.who?.code !== undefined && { code: r.who.code }) };
    }
    // Итог транзакции из итогов операций (П-3.2а): «оплачено» по любой операции — итог «оплачено», даже после отказа
    // другой (повтор, В6) и после отзыва поручения (деньги ушли — признак «после отзыва», В5); время — первого «оплачено».
    // Иначе — первый по времени итог: отказ операции, отклонённое подтверждение, отзыв поручения.
    const opList = [...ops.values()];
    const paidOps = opList.filter((o) => o.kind === "paid" || o.kind === "settled").sort((a, b) => a.seq! - b.seq!);
    let outcome: TxOutcome | undefined;
    let afterRevoke = false;
    if (paidOps.length > 0) {
      const first = paidOps[0]!;
      outcome = { kind: paidOps.some((o) => o.kind === "settled") ? "settled" : "paid", seq: first.seq!, at: first.at! };
      // Любое «оплачено» после события отзыва: P1 до отзыва, P2 после — деньги P2 ушли после отзыва (ревью П-3.2а № 2).
      afterRevoke = revokedAt !== undefined && paidOps.some((o) => o.seq! > revokedAt!.seq);
    } else {
      const finals: TxOutcome[] = [];
      for (const o of opList)
        if (o.kind === "declined") finals.push({ kind: "declined", ...(o.code !== undefined && { code: o.code }), seq: o.seq!, at: o.at! });
      if (rejected) finals.push(rejected);
      if (revokedAt) finals.push({ kind: "revoked", ...(revokedAt.code !== undefined && { code: revokedAt.code }), seq: revokedAt.seq, at: revokedAt.at });
      finals.sort((a, b) => a.seq - b.seq);
      outcome = finals[0];
    }
    // Без связи с корзиной: корзина есть и запись агента по этой операции пришла — «связь не подтверждена»; иначе — «ждём
    // шаг агента» (без корзины про корзину не говорим). Срок ожидания шага — «Идёт к нарушению», П-4.1.
    const unconfirmed = new Set([...unlinked].filter((p) => cart !== undefined && agentOps.has(p)));
    const pending = new Set([...unlinked].filter((p) => !unconfirmed.has(p)));
    const NODE_TYPE: Readonly<Record<string, string>> = { m: "cart", o: "order", p: "op", c: "confirmation" };
    const firstNode = [...acc.nodes].sort()[0]!;
    const txId = cartList.length === 1 ? cartList[0]! : `${NODE_TYPE[firstNode[0]!]}:${firstNode.slice(2)}`;
    const intentId = intentList.length === 1 ? intentList[0] : undefined;
    txs.push({
      id: txId,
      ...(intentId !== undefined && { intentId }),
      ...(cart !== undefined && { cartMandateId: cart }),
      ...(conflict && { linkConflict: { carts: cartList, intents: intentList } }),
      ...(unconfirmed.size > 0 && { unconfirmedOps: [...unconfirmed].sort() }),
      ...(pending.size > 0 && { pendingOps: [...pending].sort() }),
      ...(unconfirmedConf.size > 0 && { unconfirmedConfirmations: [...unconfirmedConf].sort() }),
      ops: opList.map((o) => ({ ...o })),
      ...(afterRevoke && { afterRevoke: true as const }),
      ...(paidOps.length > 1 && { doubleDebit: true as const }),
      orderIds: pick("o:"),
      opRefs: pick("p:"),
      confirmationIds: pick("c:"),
      merchantIds: [...acc.merchants].sort(),
      shopsByOrder: shopsByOrder(acc.items),
      stage: stageOf(acc.items),
      ...(outcome && { outcome }),
      worst,
      seqs: acc.items.map((r) => r.seq),
      firstAt: first.at,
      lastAt: last.at,
    });
  }
  txs.sort((a, b) => a.seqs[0]! - b.seqs[0]!);

  const mandates: PultMandate[] = [];
  for (const mid of intents) {
    const own = mdAcc.get(mid) ?? [];
    if (own.length === 0) continue;
    let status: MandateStatus = "created";
    let worst: Kind = "norm";
    for (const r of own) {
      worst = worse(worst, r.kind);
      if (r.ref === "intent.awaiting_signature" && status === "created") status = "awaiting_signature";
      // Состояние поручения — по событиям Платформы (подпись — человеком в банке, отзыв — клиентом).
      if (r.source === "pao_event" && r.ref === "mandate.signed" && status !== "revoked") status = "active";
      if (r.source === "pao_event" && r.ref === "mandate.revoked") status = "revoked";
    }
    mandates.push({
      id: mid,
      status,
      // Транзакция с конфликтом звеньев видна у каждого своего поручения — чтобы человек её не потерял.
      txIds: txs.filter((t) => t.intentId === mid || t.linkConflict?.intents.includes(mid)).map((t) => t.id),
      stage: stageOf(own),
      worst,
      seqs: own.map((r) => r.seq),
      firstAt: own[0]!.at,
      lastAt: own[own.length - 1]!.at,
    });
  }
  mandates.sort((a, b) => a.seqs[0]! - b.seqs[0]!);
  return { mandates, txs, unattached };
}

/** Номер заказа → витрины (`shop_id`) обращений к витрине с этим номером в пути. */
function shopsByOrder(items: readonly Interpretation[]): Record<string, string[]> {
  const out: Record<string, Set<string>> = {};
  for (const r of items) {
    const o = r.ids?.order_id;
    const s = r.ids?.shop_id;
    if (o && s) (out[o] ??= new Set()).add(s);
  }
  return Object.fromEntries(Object.entries(out).map(([o, s]) => [o, [...s].sort()]));
}

/** Стадия по последней ключевой записи, не служебной; ключевых нет — по последней записи. */
function stageOf(items: readonly Interpretation[]): Stage {
  for (let i = items.length - 1; i >= 0; i--) {
    const r = items[i]!;
    if (r.level === "key" && r.stage !== "service") return r.stage;
  }
  return items[items.length - 1]?.stage ?? "service";
}
