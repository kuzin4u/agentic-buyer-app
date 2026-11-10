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

export interface PultTx {
  /** Номер транзакции на пульте: поручение корзины, если оно известно, иначе первое звено с типом (`order:…`, `op:…`,
   *  `confirmation:…`) — не совпадёт с номером корзины (ревью П-1.2 № 8). */
  readonly id: string;
  readonly intentId?: string;
  readonly cartMandateId?: string;
  /** Конфликт звеньев: в транзакцию попали две корзины или два поручения-намерения — например, витрина повторила номер
   *  заказа другой покупки. Звенья не сливаются молча: итог не присваивается, решает человек (ревью П-1.2 № 1, Р-1444). */
  readonly linkConflict?: { readonly carts: readonly string[]; readonly intents: readonly string[] };
  /** Операции с событием Платформы, связанные с корзиной только через номер заказа витрины (нет записи агента с op_ref и
   *  поручением корзины): «связь не подтверждена», итога по ним нет (Р-1458). */
  readonly unconfirmedOps?: readonly string[];
  /** Запросы подтверждения с итоговым событием (`confirmation.rejected`), где нет поручения корзины: «связь не
   *  подтверждена», итога нет (Р-1460; поручение к событию через шину — П-8.1). */
  readonly unconfirmedConfirmations?: readonly string[];
  readonly orderIds: readonly string[];
  readonly opRefs: readonly string[];
  readonly confirmationIds: readonly string[];
  readonly merchantId?: string;
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

/** Событие Платформы → итог транзакции. Только `pao_event`: шаг сюжета `outcome` и ответ витрины итогом не являются. */
const OUTCOME_EVENT: Readonly<Record<string, TxOutcomeKind>> = {
  "operation.authorized": "paid",
  "operation.settled": "settled",
  "operation.declined": "declined",
  "confirmation.rejected": "rejected",
};

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
    merchantId?: string;
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
      if (!acc) txAcc.set(root, (acc = { nodes: new Set(), intents: new Set(), items: [] }));
      for (const x of n) acc.nodes.add(x);
      const i = id(r.ids?.intent_id);
      if (i !== undefined) acc.intents.add(i);
      const mer = id(r.ids?.merchant_id);
      if (mer !== undefined && acc.merchantId === undefined) acc.merchantId = mer;
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
    if (cart !== undefined)
      for (const r of acc.items) {
        if (r.stream === "monitor" && r.source !== "pao_event") continue;
        const p = id(r.ids?.op_ref);
        if (p !== undefined && id(r.ids?.mandate_id) === cart) confirmedOps.add(p);
      }
    const unconfirmed = new Set<string>();
    const unconfirmedConf = new Set<string>();
    let outcome: TxOutcome | undefined;
    let worst: Kind = conflict ? "conflict" : "norm";
    for (const r of acc.items) {
      worst = worse(worst, r.kind);
      if (conflict || r.source !== "pao_event") continue;
      if (r.ref.startsWith("operation.")) {
        const p = id(r.ids?.op_ref);
        if (p === undefined || !confirmedOps.has(p)) {
          if (p !== undefined) unconfirmed.add(p);
          continue;
        }
      }
      // Подтверждение — итог только с поручением этой корзины в самом событии. По ПАО 1.4.0 событие несёт только
      // `confirmation_id`, шина добавляет номер заказа из записи подтверждения — связь только номером заказа: «связь не
      // подтверждена», итога нет (ревью П-2.1 № 1, Р-1460). Поручение корзины к событию через шину — П-8.1.
      if (r.ref.startsWith("confirmation.") && OUTCOME_EVENT[r.ref] !== undefined && (cart === undefined || id(r.ids?.mandate_id) !== cart)) {
        const c = id(r.ids?.confirmation_id);
        if (c !== undefined) unconfirmedConf.add(c);
        continue;
      }
      const k = OUTCOME_EVENT[r.ref] ?? (r.ref === "mandate.revoked" && cart !== undefined && r.ids?.mandate_id === cart ? "revoked" : undefined);
      // Первый итог остаётся итогом; «проведено» (settled) — уточнение «оплачено», а не новый исход. Итог после отзыва и
      // повтор операции — правила движка условий (STATUS «Открыто», П-3.2).
      // Время итога — первого итогового события: «проведено» уточняет вид, но «Завершены» — с «оплачено» (ревью П-2.2 № 1).
      if (k !== undefined && (outcome === undefined || (outcome.kind === "paid" && k === "settled")))
        outcome = {
          kind: k,
          ...(r.who?.code !== undefined && k !== "paid" && k !== "settled" && { code: r.who.code }),
          seq: outcome?.seq ?? r.seq,
          at: outcome?.at ?? r.at,
        };
    }
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
      ...(unconfirmedConf.size > 0 && { unconfirmedConfirmations: [...unconfirmedConf].sort() }),
      orderIds: pick("o:"),
      opRefs: pick("p:"),
      confirmationIds: pick("c:"),
      ...(acc.merchantId !== undefined && { merchantId: acc.merchantId }),
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

/** Стадия по последней ключевой записи, не служебной; ключевых нет — по последней записи. */
function stageOf(items: readonly Interpretation[]): Stage {
  for (let i = items.length - 1; i >= 0; i--) {
    const r = items[i]!;
    if (r.level === "key" && r.stage !== "service") return r.stage;
  }
  return items[items.length - 1]?.stage ?? "service";
}
