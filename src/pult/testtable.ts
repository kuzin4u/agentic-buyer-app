// Таблица тестирования пульта (П-11.5а, окно Б; Р-1533, Р-1534, Р-1538): 25 тестов «Задания на тестирование пульта» v1.0
// (`docs/reference/2026-11-07-zadanie-testirovanie-pulta-v1.0.xlsx`, лист «Задание на тестирование») ↔ вердикты движка и
// паспорта ↔ ожидания задания; колонки задания «MVP — факт» и «MVP — сходится», итоги — как лист «Итоги». Чистая функция:
// факты — только из интерпретаций, модели транзакций, вердиктов, журнала стенда и журнала реакций; время — параметром. UI
// таблицы и живой прогон 25 тестов — П-11.5б окна А.
//
// Ожидания — **структурой** (Р-1534, В1): условия, узел, нарушитель, защитник, итог. Текст колонки E не разбирается — разбор
// текста ломается на первой новой формулировке. Перенос из файла сверен скриптом (PR #15, #issuecomment-6835117541: 25 строк,
// 0 расхождений); файл v1.0 сменился — тест sha256 краснеет, структура пересверяется. Колонка «Ожидание на стенде (MVP)»
// задания v1.1 — параметром `mvp` (данные — отдельным кирпичом, когда владелец положит файл); без неё — v1.0 и отступление
// там, где оно записано в STATUS: В7 (Н-03, Н-12), В8 (Н-08), «Расхождения» № 7 (Н-06, П-09) и № 8 (П-06).
//
// Привязка теста к фактам (Р-1534, В2) — закрытым перечнем, тест сверяет его с метками сюжетов, перечнем драйвера «ПР» и
// тестами стенда (Р-1511): П-xx и У-xx — последний прогон сюжета по метке `run.<имя>` без взведённого сбоя «П»; Н-xx «ПР» —
// прогон драйвера `run.fault` с этим кодом теста; Н-xx «П» — от шага взвода `stand_fault.armed` до снятия. **Вердикт относится
// к окну**, если его объект создан в окне (первая запись) или его доказательство (`seqs`) лежит в окне; вердикт без
// доказательств на шине (пометка «ПР», сбой «П» — запись журнала стенда) — если запись журнала стенда этого теста лежит в окне
// по времени (Р-1538, ревью № 5).
//
// «Сходится» (Р-1534, В3; Р-1538): П-xx — ожидаемый итог (событие Платформы или вердикт решения клиента / защиты) и **ни
// одного паспорта** в окне; Н-xx — хотя бы один паспорт с ожидаемым условием, узлом и нарушителем и ни одного паспорта того
// же условия с другим нарушителем («каждая транзакция поймана» пульту не проверить — примечание таблицы); У-01…У-03 —
// ожидание объекта прогона дошло до порога; У-04 — «напомнено» по R21 раньше «оплачено» и отметка движка «упреждено
// реакцией» (П-8.2). «Авто» (В4): у У-01…У-04 — «не засчитано: прогон не по П5 доп. 1 п. 5», у остальных — пометка, на
// «сходится» не влияет.
import { faultOf, splitRuns, type FaultOutcome, type Run } from "../dashboards/control.js";
import { markdownCell } from "../dashboards/control-feed.js";
import type { Interpretation } from "../dashboards/interpret.js";
import { NOT_REPRODUCIBLE_LABEL, STAND_TEST_TABLE } from "../dashboards/stand-tests.js";
import type { Reaction } from "./actions.js";
import { hasPassport, WAIT_MS, waits, type WaitKind } from "./control.js";
import { GUARANTEE_INFO, type Guarantee } from "./engine.js";
import type { Phrase } from "./phrases.js";
import { PARTY_LABEL, type CheckableCondition, type NodeId, type Party } from "./rules89.js";
import type { StandLogEntry, StandLogWhat } from "./standlog.js";
import { buildTxModel, type PultTx, type TxModel, type TxOutcomeKind } from "./tx.js";
import type { Verdict } from "./verdict.js";

const p = (ru: string, en: string): Phrase => ({ ru, en });

/** 25 тестов задания по порядку листа. */
export const TEST_CODES = [
  "П-01", "П-02", "П-03", "П-04", "П-05", "П-06", "П-07", "П-08", "П-09",
  "Н-01", "Н-02", "Н-03", "Н-04", "Н-05", "Н-06", "Н-07", "Н-08", "Н-09", "Н-10", "Н-11", "Н-12",
  "У-01", "У-02", "У-03", "У-04",
] as const;
export type TestCode = (typeof TEST_CODES)[number];

/** Вид теста — колонка B задания. */
export type TestKind = "correct" | "incorrect" | "toward" | "prevented";
export const TEST_KIND_LABEL: Readonly<Record<TestKind, Phrase>> = {
  correct: p("правильная", "correct"),
  incorrect: p("неправильная", "incorrect"),
  toward: p("идёт к нарушению", "heading to a violation"),
  prevented: p("упреждение реакцией", "prevented by a reaction"),
};

/** Сюжет теста П-xx и У-xx — имя метки прогона `run.<имя>` (Р-1534, В2). Сверяется тестом с метками и номерами сюжетов
 *  демо-стенда (`RUN_STEP`, `MORE_SCENARIOS`). */
export const TEST_SCENARIO = {
  "П-01": "purchase", "П-02": "upk", "П-03": "reject", "П-04": "unconfirmed", "П-05": "limit",
  "П-06": "scope", "П-07": "suspended", "П-08": "revoke", "П-09": "expired",
  "У-01": "intent", "У-02": "purchase", "У-03": "upk", "У-04": "upk",
} as const satisfies Partial<Record<TestCode, string>>;

/** Сбой стенда «П» → что пишет стенд (причина вердикта `fault`); у Н-12 — ещё сводная причина R31 «потеряно». Сверяется
 *  тестом с `STAND_LOG_WHAT` и с тестами «П» `STAND_TEST_TABLE`. */
export const FAULT_WHAT = {
  "Н-02": ["SECOND_CREDENTIAL_ISSUED"],
  "Н-03": ["PAID_BEFORE_OUTCOME"],
  "Н-04": ["FULFILLED_BEFORE_OUTCOME"],
  "Н-05": ["INSTRUCTION_SERVED"],
  "Н-11": ["UPK_CODE_LEAKED"],
  "Н-12": ["OUTCOME_EVENT_DELAYED", "OUTCOME_EVENTS_REORDERED"],
} as const satisfies Partial<Record<TestCode, readonly StandLogWhat[]>>;

/** Паспорт, которого ждёт тест «неправильная»: хотя бы одно из условий, узел (если задание его называет), нарушитель. */
export interface ExpectFinding {
  readonly conds: readonly CheckableCondition[];
  readonly node?: NodeId;
  readonly violator: Party;
  /** Защитник — только там, где его называет ожидание на стенде (Н-03, В7). */
  readonly protector?: Party;
  /** Условия, которые должны остаться без паспорта (Н-03 на стенде: R28, R30 — «ok», В7). */
  readonly okConds?: readonly CheckableCondition[];
}
export type Expect =
  | {
      readonly kind: "correct";
      /** Итог транзакции прогона по событию Платформы. */
      readonly outcome?: { readonly kind: TxOutcomeKind; readonly code?: string };
      /** Вердикт решения клиента или защиты в окне. `cond` и `guarantee` — равноправные признаки: подходит вердикт по
       *  условию или по гарантии (П-06: R17 после П-5.1а или гарантия `mandate_scope`; Р-1538). Защитник — из вердикта. */
      readonly decision?: {
        readonly kind: "client_decision" | "protection";
        readonly cond?: CheckableCondition;
        readonly guarantee?: Guarantee;
        readonly protector?: Party;
      };
      /** Операции не было: поручение без покупки. */
      readonly noOperation?: true;
    }
  /** `passport: null` — паспорта нет. `fired` — сбой обязан сработать: запись журнала стенда в окне, итог по её операции
   *  есть (Н-12 на стенде, В7); не сработал или итога ещё нет — «не проверено». */
  | { readonly kind: "incorrect"; readonly passport: ExpectFinding | null; readonly fired?: readonly StandLogWhat[] }
  | { readonly kind: "toward"; readonly wait: Exclude<WaitKind, "agent_step">; readonly cond: "R08" | "R18" | "R21" }
  | { readonly kind: "prevented"; readonly cond: "R21" };

/** Отступление от задания v1.0 на стенде — номером записи STATUS. */
export type DeviationRef = "В7" | "В8" | "№ 7" | "№ 8";
/** Кирпич окна А, до которого строка заведомо «не сходится» (Р-1534, Р-1538). */
export type PendingRef = "П-5.1а" | "П-8.1";

interface Spec {
  readonly test: TestCode;
  readonly kind: TestKind;
  /** Ожидание задания v1.0 (колонки E и C) структурой. */
  readonly v10: Expect;
  readonly stand?: { readonly expect: Expect; readonly ref: DeviationRef };
  readonly pending?: PendingRef;
}

const ok = (outcome: TxOutcomeKind, code?: string) => ({ kind: outcome, ...(code !== undefined && { code }) });
const bad = (conds: readonly CheckableCondition[], violator: Party, node?: NodeId): Expect => ({
  kind: "incorrect",
  passport: { conds, violator, ...(node !== undefined && { node }) },
});

/** 25 строк задания. Источник — колонки E и C листа «Задание на тестирование» v1.0 (сверка скриптом — PR #15); отступления — STATUS. */
export const TEST_SPECS: readonly Spec[] = [
  { test: "П-01", kind: "correct", v10: { kind: "correct", outcome: ok("paid") } },
  { test: "П-02", kind: "correct", v10: { kind: "correct", outcome: ok("paid") } },
  // Ложный паспорт R09 `inactive_agent_stop` после отказа клиента от корзины — четвёртый ложный вердикт окна А (Р-1538).
  { test: "П-03", kind: "correct", v10: { kind: "correct", decision: { kind: "client_decision" } }, pending: "П-8.1" },
  { test: "П-04", kind: "correct", v10: { kind: "correct", outcome: ok("rejected") } },
  {
    test: "П-05",
    kind: "correct",
    v10: { kind: "correct", outcome: ok("declined", "LIMIT_EXCEEDED"), decision: { kind: "client_decision", guarantee: "limit_client", protector: "bank" } },
  },
  {
    test: "П-06",
    kind: "correct",
    v10: { kind: "correct", decision: { kind: "protection", cond: "R17", guarantee: "mandate_scope", protector: "platform" } },
    // № 8: на стенде агент сам отказывается от продавца вне поручения, до корзины и без запроса к Платформе; после П-5.1а —
    // R17 «сработало, защитил агент» (заметка чата #issuecomment-6834520498).
    stand: { expect: { kind: "correct", noOperation: true, decision: { kind: "protection", cond: "R17", guarantee: "mandate_scope", protector: "agent" } }, ref: "№ 8" },
    pending: "П-5.1а",
  },
  { test: "П-07", kind: "correct", v10: { kind: "correct", decision: { kind: "protection", guarantee: "agent_suspended", protector: "platform" } } },
  // Отзыв — гарантией `revoke` или условием R09 (гарантию подавляет вердикт R09 в том же объекте, `COVERED` в `verdict.ts`).
  { test: "П-08", kind: "correct", v10: { kind: "correct", decision: { kind: "client_decision", cond: "R09", guarantee: "revoke", protector: "agent" } } },
  {
    test: "П-09",
    kind: "correct",
    v10: { kind: "correct", noOperation: true, decision: { kind: "protection" } },
    // № 7: на стенде — поручение без покупки, агент остановился по сроку; после П-5.1а — R09 «сработало, срок, защитил агент».
    stand: { expect: { kind: "correct", noOperation: true, decision: { kind: "protection", cond: "R09", protector: "agent" } }, ref: "№ 7" },
    pending: "П-5.1а",
  },
  { test: "Н-01", kind: "incorrect", v10: bad(["R46"], "agent", "У2") },
  { test: "Н-02", kind: "incorrect", v10: bad(["R23", "R25"], "platform", "У2") },
  {
    test: "Н-03",
    kind: "incorrect",
    v10: bad(["R27", "R28", "R30"], "operator", "У3"),
    // В7: пульт по инварианту 6 слова продавца итогом не берёт — R27 «сработало», нарушил продавец, защитил пульт; R28, R30 — «ok».
    stand: { expect: { kind: "incorrect", passport: { conds: ["R27"], node: "У3", violator: "merchant", protector: "operator", okConds: ["R28", "R30"] } }, ref: "В7" },
  },
  { test: "Н-04", kind: "incorrect", v10: bad(["R32"], "merchant", "У3") },
  { test: "Н-05", kind: "incorrect", v10: bad(["R47"], "agent", "У1") },
  // № 7: R09 «оплачено после отзыва» — «не определён» (гонка С-28); R37 по пометке «ПР» — агент, У5.
  { test: "Н-06", kind: "incorrect", v10: bad(["R37", "R09", "R18"], "agent", "У5"), stand: { expect: bad(["R37"], "agent", "У5"), ref: "№ 7" } },
  { test: "Н-07", kind: "incorrect", v10: bad(["R18"], "agent") },
  // В8: R17 «сработало» при отказе Платформы, иначе «нарушено» — нарушил агент в обоих случаях, паспорт есть.
  { test: "Н-08", kind: "incorrect", v10: bad(["R17"], "agent"), stand: { expect: bad(["R17"], "agent"), ref: "В8" } },
  { test: "Н-09", kind: "incorrect", v10: bad(["R26"], "agent") },
  { test: "Н-10", kind: "incorrect", v10: bad(["R41"], "agent") },
  { test: "Н-11", kind: "incorrect", v10: bad(["R20"], "bank") },
  // В7: позднее событие пульт учитывает — R31 «ok, позднее событие учтено»: сбой сработал, итог есть, паспорта нет.
  {
    test: "Н-12",
    kind: "incorrect",
    v10: bad(["R31"], "operator", "У4"),
    stand: { expect: { kind: "incorrect", passport: null, fired: FAULT_WHAT["Н-12"] }, ref: "В7" },
  },
  { test: "У-01", kind: "toward", v10: { kind: "toward", wait: "sign", cond: "R08" } },
  { test: "У-02", kind: "toward", v10: { kind: "toward", wait: "consent", cond: "R18" } },
  { test: "У-03", kind: "toward", v10: { kind: "toward", wait: "confirmation", cond: "R21" } },
  { test: "У-04", kind: "prevented", v10: { kind: "prevented", cond: "R21" } },
];

/** «MVP — сходится»: закрытый перечень задания («да», «нет», «нет случая») и «не проверено» — как лист «Итоги»; «не
 *  засчитано» — У-xx при «Авто» (П5 доп. 1 п. 5). В итогах «не засчитано» входит в «не проверено» (формула листа B−C−D−E). */
export type Agree = "yes" | "no" | "no_case" | "unchecked" | "not_counted";
export const AGREE_LABEL: Readonly<Record<Agree, Phrase>> = {
  yes: p("да", "yes"),
  no: p("нет", "no"),
  no_case: p("нет случая", "no case"),
  unchecked: p("не проверено", "not checked"),
  not_counted: p("не засчитано: прогон не по П5 доп. 1 п. 5", "not counted: the run is not per П5 add. 1 item 5"),
};

export type ExpectSource = { readonly kind: "v1.0" } | { readonly kind: "v1.1" } | { readonly kind: "deviation"; readonly ref: DeviationRef };

export interface TestRow {
  readonly test: TestCode;
  readonly kind: TestKind;
  readonly expected: Phrase;
  readonly source: ExpectSource;
  /** «MVP — факт»: только идентификаторы, коды и подписи (инварианты 1, 4). */
  readonly fact: Phrase;
  readonly agree: Agree;
  /** В прогоне работал эмулятор клиента «Авто» (П5 п. 3). */
  readonly auto: boolean;
  /** Строка «нет» до кирпича окна А — адрес. */
  readonly pending?: PendingRef;
  /** Объекты прогона: транзакции и поручения. */
  readonly objs: readonly string[];
}
export interface TestTotals {
  readonly tests: number;
  readonly yes: number;
  readonly no: number;
  readonly noCase: number;
  /** «Не проверено» — как формула листа «Итоги»: тестов − да − нет − нет случая. */
  readonly unchecked: number;
}
export interface TestTable {
  readonly rows: readonly TestRow[];
  readonly totals: TestTotals;
}

/** Реакция пульта; `preempted` — отметка движка «упреждено реакцией» у R21 по записи стенда этой реакции (П-8.2,
 *  `linkReactions`). */
export type TableReaction = Reaction & { readonly preempted?: "R21" };

export interface TestTableInput {
  readonly items: readonly Interpretation[];
  readonly model: TxModel;
  readonly verdicts: readonly Verdict[];
  /** Журнал стенда (режим сбоев, П-8.2); нет — пометки «ПР» и сбои «П» без доказательств на шине к окну не относятся. */
  readonly standLog?: readonly StandLogEntry[];
  /** Журнал реакций пульта, связанный с протоколом стенда (П-8.2). */
  readonly reactions?: readonly TableReaction[];
  /** «Сейчас» по часам шины. */
  readonly now: string;
  readonly waitMs?: number;
  /** Колонка «Ожидание на стенде (MVP)» задания v1.1 — когда файл есть (Р-1534, В1). */
  readonly mvp?: Partial<Readonly<Record<TestCode, Expect>>>;
}

// ——— подписи ———

const OUTCOME_LABEL: Readonly<Record<TxOutcomeKind, Phrase>> = {
  paid: p("оплачено", "paid"),
  settled: p("проведено", "settled"),
  declined: p("отказ", "declined"),
  rejected: p("подтверждение отклонено", "confirmation rejected"),
  revoked: p("отозвано", "revoked"),
};
/** Исходы драйвера «ПР» — по закрытому перечню `FAULT_OUTCOMES` (Р-1511): новый исход без подписи — ошибка tsc. */
const FAULT_OUTCOME_LABEL: Readonly<Record<FaultOutcome, Phrase>> = {
  marked: p("совершено и помечено", "committed and marked"),
  refused: p("остановлено защитой", "stopped by a protection"),
  recorded: p("записи стенда сделаны", "stand records made"),
  unplayed: p("помечено, но не разыграно", "marked but not played"),
  failed: p("не разыграно", "not played"),
};
const WAIT_LABEL: Readonly<Record<Exclude<WaitKind, "agent_step">, Phrase>> = {
  sign: p("поручение ждёт подписи клиента", "the mandate awaits the client's signature"),
  consent: p("корзина ждёт согласия", "the cart awaits consent"),
  confirmation: p("подтверждение ждёт клиента", "the confirmation awaits the client"),
};
const party = (x: Party | "undetermined"): Phrase => (x === "undetermined" ? p("не определён", "undetermined") : PARTY_LABEL[x]);
const DEVIATION_LABEL: Readonly<Record<DeviationRef, Phrase>> = {
  В7: p("на стенде — отступление В7 (STATUS «Открыто»)", "on the stand — deviation В7 (STATUS, open items)"),
  В8: p("на стенде — отступление В8 (STATUS «Открыто»)", "on the stand — deviation В8 (STATUS, open items)"),
  "№ 7": p("на стенде — «Расхождения» № 7", "on the stand — discrepancy № 7"),
  "№ 8": p("на стенде — «Расхождения» № 8", "on the stand — discrepancy № 8"),
};
export const sourceLabel = (s: ExpectSource): Phrase =>
  s.kind === "deviation" ? DEVIATION_LABEL[s.ref] : s.kind === "v1.1" ? p("задание v1.1", "task v1.1") : p("задание v1.0", "task v1.0");
export const PENDING_LABEL: Readonly<Record<PendingRef, Phrase>> = {
  "П-5.1а": p("ждёт кирпича окна А П-5.1а (вердикт защиты на стенде)", "awaits window A brick П-5.1а (protection verdict on the stand)"),
  "П-8.1": p("ждёт правки окна А (хвосты П-8.1): ложный паспорт R09 после отказа от корзины", "awaits window A fix (П-8.1 tail): false R09 passport after a cart refusal"),
};
/** Примечание таблицы (Р-1534, В3): ограничение пульта — не молча. */
export const TABLE_NOTE: Phrase = p(
  "Н-xx: «сходится» — хотя бы один паспорт с ожидаемым условием, узлом и нарушителем. «Каждая транзакция поймана» пульт не проверяет: на какой транзакции сработал сбой, знает стенд, а не пульт.",
  "Н-xx: «yes» means at least one passport with the expected condition, node and violator. The pult does not check that every transaction was caught: only the stand knows which transactions a fault hit.",
);

const join = (parts: readonly Phrase[], sep = " · "): Phrase => p(parts.map((x) => x.ru).join(sep), parts.map((x) => x.en).join(sep));
const lit = (s: string): Phrase => p(s, s);
const secs = (n: number): Phrase => p(`${n} с`, `${n} s`);

/** Ожидание словами (ru/en) — из той же структуры, по которой считается «сходится». */
export function expectPhrase(e: Expect): Phrase {
  switch (e.kind) {
    case "correct": {
      const parts: Phrase[] = [];
      if (e.outcome)
        parts.push(join([p("итог по событию Платформы:", "outcome by a Platform event:"), OUTCOME_LABEL[e.outcome.kind], ...(e.outcome.code ? [lit(e.outcome.code)] : [])], " "));
      if (e.decision) {
        const d = e.decision;
        parts.push(
          join([
            d.kind === "client_decision" ? p("решение клиента", "client's decision") : p("сработала защита", "protection triggered"),
            ...(d.cond ? [lit(d.cond)] : []),
            ...(d.guarantee ? [GUARANTEE_INFO[d.guarantee].name] : []),
            ...(d.protector ? [join([p("защитил:", "protected by:"), party(d.protector)], " ")] : []),
          ]),
        );
      }
      if (e.noOperation) parts.push(p("операции нет", "no operation"));
      parts.push(p("паспорта нет", "no passport"));
      return join(parts, "; ");
    }
    case "incorrect":
      if (e.passport === null)
        return e.fired ? join([p("сбой сработал:", "the fault fired:"), lit(e.fired.join(" / ")), p("итог учтён, паспорта нет", "outcome counted, no passport")], " ") : p("паспорта нет", "no passport");
      return join([
        join([p("паспорт:", "passport:"), lit(e.passport.conds.join(" / "))], " "),
        ...(e.passport.node ? [join([p("узел", "node"), lit(e.passport.node)], " ")] : []),
        join([p("нарушил:", "violator:"), party(e.passport.violator)], " "),
        ...(e.passport.protector ? [join([p("защитил:", "protected by:"), party(e.passport.protector)], " ")] : []),
        ...(e.passport.okConds ? [join([lit(e.passport.okConds.join(", ")), p("— без паспорта", "— no passport")], " ")] : []),
      ]);
    case "toward":
      return join([p("«Идёт к нарушению»:", "«Heading to a violation»:"), lit(e.cond), WAIT_LABEL[e.wait]], " ");
    case "prevented":
      return p(
        `«Напомнить клиенту» по ${e.cond}, затем оплачено; паспорта нет; «упреждено реакцией»`,
        `«Remind the client» on ${e.cond}, then paid; no passport; «prevented by a reaction»`,
      );
  }
}

// ——— окна ———

/** Окно теста: записи шины с `from` ≤ seq < `to`; время окна — от записи `from` до записи `to` (нет — без конца). */
interface Window {
  readonly from: number;
  readonly to: number;
  readonly fromAt: number;
  readonly toAt: number;
  readonly auto: boolean;
}
const firstSeq = (seqs: readonly number[]) => (seqs.length ? Math.min(...seqs) : Infinity);
const inWin = (w: Window, s: number) => s >= w.from && s < w.to;

/** Объекты, первая запись которых лежит в окне: транзакции и поручения. */
function objsIn(model: TxModel, w: Window): { txs: PultTx[]; ids: string[] } {
  const txs = model.txs.filter((t) => inWin(w, firstSeq(t.seqs)));
  const mandates = model.mandates.filter((m) => inWin(w, firstSeq(m.seqs))).map((m) => m.id);
  return { txs, ids: [...new Set([...txs.map((t) => t.id), ...mandates])] };
}

/** Запись журнала стенда этого теста в окне по времени: пометка «ПР» или сбой «П». */
function standOfTest(log: readonly StandLogEntry[] | undefined, test: TestCode, w: Window, what: readonly string[]): StandLogEntry[] {
  return (log ?? []).filter((e) => {
    const at = Date.parse(e.at);
    return at >= w.fromAt && at < w.toAt && ((e.what === "MARKED" && e.test === test) || what.includes(e.what));
  });
}

// ——— «сходится» по видам ———

interface Judged {
  readonly agree: Agree;
  readonly fact: Phrase;
}

const passportsOf = (vs: readonly Verdict[]) => vs.filter(hasPassport);
/** Причина вердикта — запись журнала стенда, а не записи шины. */
const standCause = (v: Verdict) => v.cause !== undefined && (v.cause.kind === "mark" || v.cause.kind === "fault" || (v.cause.kind === "rule" && v.cause.rule === "late_lost"));
const findingPhrase = (v: Verdict): Phrase =>
  join([
    lit([v.obj ?? "—", v.cond ?? v.guarantee ?? ""].filter(Boolean).join(": ")),
    ...(v.node ? [lit(v.node)] : []),
    join([p("нарушил:", "violator:"), party(v.violator === "client_decision" || v.violator === undefined ? "undetermined" : v.violator)], " "),
  ]);

function judgeCorrect(e: Extract<Expect, { kind: "correct" }>, txs: readonly PultTx[], vs: readonly Verdict[]): Judged {
  const facts: Phrase[] = [];
  let good = true;
  for (const t of txs) facts.push(join([lit(t.id), t.outcome ? OUTCOME_LABEL[t.outcome.kind] : p("итога нет", "no outcome"), ...(t.outcome?.code ? [lit(t.outcome.code)] : [])], " "));
  if (e.outcome) {
    const want = e.outcome;
    good &&= txs.some((t) => t.outcome !== undefined && (t.outcome.kind === want.kind || (want.kind === "paid" && t.outcome.kind === "settled")) && (want.code === undefined || t.outcome.code === want.code));
  }
  if (e.decision) {
    const d = e.decision;
    // Условие и гарантия — равноправные признаки (Р-1538: П-06 — защитник из вердикта R17, а не из гарантии).
    const sign = (v: Verdict) => (d.cond === undefined && d.guarantee === undefined) || (d.cond !== undefined && v.cond === d.cond) || (d.guarantee !== undefined && v.guarantee === d.guarantee);
    const hit = vs.find((v) => v.kind === d.kind && sign(v) && (d.protector === undefined || v.protector === d.protector));
    const seen = vs.filter((v) => v.kind === "client_decision" || v.kind === "protection");
    for (const v of seen)
      facts.push(
        join([
          v.kind === "client_decision" ? p("решение клиента", "client's decision") : p("сработала защита", "protection triggered"),
          ...(v.cond ? [lit(v.cond)] : []),
          ...(v.guarantee ? [lit(v.guarantee)] : []),
          ...(v.protector ? [join([p("защитил:", "protected by:"), party(v.protector)], " ")] : []),
        ]),
      );
    if (!seen.length) facts.push(p("вердикта решения или защиты нет", "no decision or protection verdict"));
    good &&= hit !== undefined;
  }
  if (e.noOperation) {
    const withOps = txs.filter((t) => t.ops.length > 0);
    if (withOps.length) facts.push(p("операция была", "there was an operation"));
    good &&= withOps.length === 0;
  }
  const pass = passportsOf(vs);
  facts.push(pass.length ? join([p("паспорт:", "passport:"), ...pass.map(findingPhrase)], " ") : p("паспортов нет", "no passports"));
  good &&= pass.length === 0;
  return { agree: good ? "yes" : "no", fact: join(facts, "; ") };
}

function judgeIncorrect(e: Extract<Expect, { kind: "incorrect" }>, vs: readonly Verdict[], fired: readonly StandLogEntry[], model: TxModel): Judged {
  const pass = passportsOf(vs);
  const factPass = pass.length ? join([join([p("паспортов:", "passports:"), lit(String(pass.length))], " "), ...pass.slice(0, 5).map(findingPhrase)], "; ") : p("паспортов нет", "no passports");
  if (e.passport === null) {
    if (e.fired) {
      // Сбой обязан сработать, и итог по его операции должен прийти (В7, Н-12; ревью № 2).
      const recs = fired.filter((x) => e.fired!.includes(x.what));
      if (!recs.length) return { agree: "unchecked", fact: join([p("сбой не сработал", "the fault did not fire"), factPass], "; ") };
      const refs = recs.map((x) => x.ids.op_ref).filter((x): x is string => x !== undefined);
      const done = refs.length > 0 && refs.every((r) => model.txs.some((t) => t.opRefs.includes(r) && t.outcome !== undefined));
      if (!done && pass.length === 0) return { agree: "unchecked", fact: join([p("сбой сработал, итога по операции ещё нет", "the fault fired, no outcome for the operation yet"), factPass], "; ") };
      const head = done ? p("сбой сработал, итог учтён", "the fault fired, outcome counted") : p("сбой сработал, итога по операции нет", "the fault fired, no outcome for the operation");
      return { agree: done && pass.length === 0 ? "yes" : "no", fact: join([head, factPass], "; ") };
    }
    return { agree: pass.length === 0 ? "yes" : "no", fact: factPass };
  }
  const w = e.passport;
  const caught = pass.filter(
    (v) =>
      v.cond !== undefined &&
      w.conds.includes(v.cond) &&
      v.violator === w.violator &&
      (w.node === undefined || v.node === w.node) &&
      (w.protector === undefined || v.protector === w.protector),
  );
  // Паспорт того же условия с другим нарушителем и паспорт условия, которое должно остаться «ok», — «нет» (Р-1534 В3, ревью № 7).
  const other = pass.filter((v) => v.cond !== undefined && ((w.conds.includes(v.cond) && v.violator !== w.violator) || (w.okConds ?? []).includes(v.cond)));
  const objs = new Set(caught.map((v) => v.obj ?? "—"));
  const head = caught.length ? join([p("поймано:", "caught:"), lit(String(objs.size))], " ") : p("ожидаемого паспорта нет", "no expected passport");
  return { agree: caught.length && !other.length ? "yes" : "no", fact: join([head, factPass], "; ") };
}

/** Ожидания «Идёт к нарушению» по истории прогона: ожидание видно только пока клиент медлит, поэтому записи окна
 *  проигрываются по порядку — `waits()` по префиксу ленты. Берутся только ожидания объектов окна, начатые в окне (ревью
 *  № 3); ожидание показано, если от его начала до момента, когда оно ушло (следующая запись окна, у последней — первая
 *  запись после окна), или до «сейчас» прошло не меньше порога (ревью № 4). */
export function seenWaits(
  items: readonly Interpretation[],
  w: Window,
  objs: ReadonlySet<string>,
  kind: Exclude<WaitKind, "agent_step">,
  now: string,
  waitMs = WAIT_MS,
): { obj: string; sec: number }[] {
  const list = [...items].sort((a, b) => a.seq - b.seq);
  const points = list.filter((x) => inWin(w, x.seq));
  const after = list.find((x) => x.seq >= w.to);
  const end = Math.min(Date.parse(now), after ? Date.parse(after.at) : Infinity);
  const seen = new Map<string, number>();
  for (let i = 0; i < points.length; i++) {
    const prefix = list.filter((x) => x.seq <= points[i]!.seq);
    const until = Math.min(points[i + 1] ? Date.parse(points[i + 1]!.at) : end, end);
    for (const c of waits(buildTxModel(prefix), prefix)) {
      if (c.kind !== kind || !objs.has(c.obj) || Date.parse(c.since) < w.fromAt) continue;
      const ms = until - Date.parse(c.since);
      const key = `${c.obj}|${c.confirmationId ?? ""}`;
      if (ms >= waitMs) seen.set(key, Math.max(seen.get(key) ?? 0, ms));
    }
  }
  return [...seen].map(([k, ms]) => ({ obj: k.split("|")[0]!, sec: Math.floor(ms / 1000) }));
}

function judgeToward(e: Extract<Expect, { kind: "toward" }>, items: readonly Interpretation[], w: Window, objs: ReadonlySet<string>, now: string, waitMs: number): Judged {
  const seen = seenWaits(items, w, objs, e.wait, now, waitMs);
  if (!seen.length) return { agree: "no", fact: join([lit(e.cond), p("ожидание до порога не дошло", "the wait did not reach the threshold")], " · ") };
  return { agree: "yes", fact: join(seen.map((s) => join([lit(e.cond), lit(s.obj), WAIT_LABEL[e.wait], secs(s.sec)], " · ")), "; ") };
}

function judgePrevented(e: Extract<Expect, { kind: "prevented" }>, txs: readonly PultTx[], ids: readonly string[], vs: readonly Verdict[], reactions: readonly TableReaction[]): Judged {
  const objs = new Set([...ids, ...txs.flatMap((t) => t.confirmationIds)]);
  const paid = txs.filter((t) => t.outcome?.kind === "paid" || t.outcome?.kind === "settled");
  const firstPaid = Math.min(...paid.map((t) => Date.parse(t.outcome!.at)));
  // «Напомнено» раньше «оплачено» (ревью № 12).
  const reminded = reactions.filter((r) => r.action === "remind" && r.outcome === "done" && r.cond === e.cond && objs.has(r.obj) && Date.parse(r.at) < firstPaid);
  const preempted = reminded.filter((r) => r.preempted === e.cond);
  const pass = passportsOf(vs);
  const facts: Phrase[] = [
    reminded.length ? join([p("напомнено:", "reminded:"), lit(reminded.map((r) => r.obj).join(", "))], " ") : p("«Напомнить клиенту» до оплаты не нажато", "«Remind the client» not pressed before payment"),
    paid.length ? join([p("оплачено:", "paid:"), lit(paid.map((t) => t.id).join(", "))], " ") : p("оплаты нет", "not paid"),
    pass.length ? join([p("паспорт:", "passport:"), ...pass.map(findingPhrase)], " ") : p("паспортов нет", "no passports"),
    preempted.length ? p("«упреждено реакцией»", "«prevented by a reaction»") : p("отметки «упреждено реакцией» нет", "no «prevented by a reaction» mark"),
  ];
  return { agree: preempted.length > 0 && paid.length > 0 && pass.length === 0 ? "yes" : "no", fact: join(facts, "; ") };
}

// ——— таблица ———

const NO_RUN: Judged = { agree: "unchecked", fact: p("прогона нет", "no run") };

export function testTable(input: TestTableInput): TestTable {
  const { items, model, verdicts: vs, now, standLog } = input;
  const waitMs = input.waitMs ?? WAIT_MS;
  const sorted = [...items].sort((a, b) => a.seq - b.seq);
  const atOf = (seq: number) => {
    const x = sorted.find((r) => r.seq >= seq);
    return x ? Date.parse(x.at) : Infinity;
  };
  const win = (from: number, to: number, auto: boolean): Window => ({ from, to, fromAt: atOf(from), toAt: to === Infinity ? Infinity : atOf(to), auto });
  const runs = splitRuns(items);
  const windows = new Map<Run, Window>(runs.map((r, i) => [r, win(r.startSeq, runs[i + 1]?.startSeq ?? Infinity, r.clientAuto)]));
  const lastRun = (pred: (r: Run) => boolean) => [...runs].reverse().find(pred);
  const standKind = new Map<string, string>(STAND_TEST_TABLE.map((r) => [r.test, r.kind]));
  // Окна взвода сбоев «П»: от `stand_fault.armed` до `stand_fault.disarmed` того же теста.
  const armedSpans = sorted
    .filter((x) => x.stream === "scenario" && x.ref === "stand_fault.armed")
    .map((a) => ({ from: a.seq, to: sorted.find((x) => x.seq > a.seq && x.stream === "scenario" && x.ref === "stand_fault.disarmed" && x.test === a.test)?.seq ?? Infinity }));
  const armedIn = (w: Window) => armedSpans.some((s) => s.from < w.to && s.to > w.from);

  const rows = TEST_SPECS.map((spec): TestRow => {
    const mvp = input.mvp?.[spec.test];
    const expect = mvp ?? spec.stand?.expect ?? spec.v10;
    const source: ExpectSource = mvp ? { kind: "v1.1" } : spec.stand ? { kind: "deviation", ref: spec.stand.ref } : { kind: "v1.0" };
    const expected = expectPhrase(expect);
    const row = (j: Judged, auto: boolean, objs: readonly string[]): TestRow => ({
      test: spec.test,
      kind: spec.kind,
      expected,
      source,
      fact: j.fact,
      agree: j.agree,
      auto,
      objs,
      ...(spec.pending && j.agree === "no" && { pending: spec.pending }),
    });

    // Н-10 — не воспроизводится по инварианту 1 (`stand-tests.ts`).
    if (standKind.get(spec.test) === "not_reproducible") return row({ agree: "no_case", fact: NOT_REPRODUCIBLE_LABEL.INVARIANT_1 }, false, []);

    // Окно теста.
    let w: Window | undefined;
    let note: Phrase | undefined;
    if (spec.kind === "incorrect") {
      const k = standKind.get(spec.test);
      const fr = k === "violator" || k === "stand_fault_and_violator" ? lastRun((r) => faultOf(r)?.test === spec.test) : undefined;
      const armed = k === "stand_fault" || k === "stand_fault_and_violator" ? [...sorted].reverse().find((x) => x.stream === "scenario" && x.ref === "stand_fault.armed" && x.test === spec.test) : undefined;
      if (fr && (!armed || fr.startSeq > armed.seq)) {
        w = windows.get(fr)!;
        const f = faultOf(fr)!;
        note = join([lit(`run.fault ${spec.test}:`), f.outcome ? FAULT_OUTCOME_LABEL[f.outcome] : p("идёт", "running"), ...(f.code ? [lit(f.code)] : [])], " ");
        if (f.outcome === "unplayed" || f.outcome === "failed" || f.outcome === undefined) return row({ agree: "unchecked", fact: note }, w.auto, []);
      } else if (armed) {
        const off = armedSpans.find((s) => s.from === armed.seq)!.to;
        const run = lastRun((r) => r.startSeq <= armed.seq);
        w = win(armed.seq, off, sorted.some((x) => x.seq > armed.seq && x.seq < off && x.stream === "scenario" && x.ref === "client.auto_on") || (run?.clientAuto ?? false));
        note = lit(`stand_fault.armed ${spec.test}`);
      }
    } else {
      // П-xx и У-xx — «поломки все выключены» (задание, колонка D): прогон, в окне которого взведён сбой «П», не считается.
      const name = TEST_SCENARIO[spec.test as keyof typeof TEST_SCENARIO];
      const all = runs.filter((r) => r.name === name);
      const clean = all.filter((r) => !armedIn(windows.get(r)!));
      const r = clean[clean.length - 1];
      if (r) {
        w = windows.get(r)!;
        note = lit(`run.${name}${all.length > 1 ? ` ×${all.length}` : ""}`);
      } else if (all.length)
        return row({ agree: "unchecked", fact: join([lit(`run.${name} ×${all.length}`), p("все прогоны — со взведённым сбоем стенда", "every run had a stand fault armed")], " — ") }, false, []);
    }
    if (!w) return row(NO_RUN, false, []);
    const W = w;

    const { txs, ids: own } = objsIn(model, W);
    const ownSet = new Set(own);
    // Вердикт окна: объект создан в окне или доказательство в окне — и у вердикта без объекта тоже (ревью № 6). Защита и
    // решение клиента по поручению сюжета 1 из другого прогона (П-07, П-08) — по доказательству. Вердикт с причиной из
    // журнала стенда (пометка «ПР», сбой «П», R31 «потеряно») по `seqs` к окну не относится: у сводного вердикта там остаются
    // доказательства шины прежнего «соблюдено» (ревью П-3.2в № 7 — подпись и оплата обычной покупки); его окно — запись
    // журнала стенда этого теста (ревью № 5).
    let mine = vs.filter((v) => (v.obj !== undefined && ownSet.has(v.obj)) || (!standCause(v) && v.seqs.some((s) => inWin(W, s))));
    const what: readonly string[] = (FAULT_WHAT as Partial<Record<TestCode, readonly string[]>>)[spec.test] ?? [];
    const fired = standOfTest(standLog, spec.test, W, what);
    if (spec.kind === "incorrect" && fired.length) {
      const extra = vs.filter(
        (v) =>
          !mine.includes(v) &&
          v.cause !== undefined &&
          ((v.cause.kind === "mark" && v.cause.test === spec.test) ||
            (v.cause.kind === "fault" && what.includes(v.cause.what)) ||
            (spec.test === "Н-12" && v.cause.kind === "rule" && v.cause.rule === "late_lost")),
      );
      mine = [...mine, ...extra];
    }
    const ids = [...new Set([...own, ...mine.flatMap((v) => (v.obj !== undefined ? [v.obj] : []))])];

    // У-01…У-04 при «Авто» — не засчитано (П5 доп. 1 п. 5; Р-1534, В4).
    if ((spec.kind === "toward" || spec.kind === "prevented") && W.auto) return row({ agree: "not_counted", fact: note! }, true, ids);

    let j: Judged;
    switch (expect.kind) {
      case "correct":
        j = judgeCorrect(expect, txs, mine);
        break;
      case "incorrect":
        j = judgeIncorrect(expect, mine, fired, model);
        break;
      case "toward":
        j = judgeToward(expect, items, W, new Set(ids), now, waitMs);
        break;
      case "prevented":
        j = judgePrevented(expect, txs, ids, mine, input.reactions ?? []);
        break;
    }
    return row({ agree: j.agree, fact: join([note!, j.fact], " — ") }, W.auto, ids);
  });

  const count = (a: Agree) => rows.filter((r) => r.agree === a).length;
  const yes = count("yes");
  const no = count("no");
  const noCase = count("no_case");
  return { rows, totals: { tests: rows.length, yes, no, noCase, unchecked: rows.length - yes - no - noCase } };
}

// ——— выгрузка для акта ACC-1 ———

const MD_HEAD: Readonly<Record<"ru" | "en", readonly string[]>> = {
  ru: ["№", "Вид", "Ожидание", "Источник ожидания", "MVP — факт", "MVP — сходится", "Эмулятор клиента", "Адрес"],
  en: ["#", "Kind", "Expected", "Expectation source", "MVP — fact", "MVP — agrees", "Client emulator", "Address"],
};
const AUTO_LABEL: Phrase = p("эмулятор клиента: авто", "client emulator: auto");

/** Таблица в Markdown для акта ACC-1: каждая ячейка — через `markdownCell` (данные шины — текстом, инвариант 4). */
export function testTableMarkdown(t: TestTable, lang: "ru" | "en"): string {
  const line = (cells: readonly string[]) => `| ${cells.map(markdownCell).join(" | ")} |`;
  const head = MD_HEAD[lang];
  const out = [line(head), `|${head.map(() => "---").join("|")}|`];
  for (const r of t.rows)
    out.push(
      line([
        r.test,
        TEST_KIND_LABEL[r.kind][lang],
        r.expected[lang],
        sourceLabel(r.source)[lang],
        r.fact[lang],
        AGREE_LABEL[r.agree][lang],
        r.auto ? AUTO_LABEL[lang] : "",
        r.pending ? PENDING_LABEL[r.pending][lang] : "",
      ]),
    );
  const s = t.totals;
  out.push(
    "",
    lang === "ru"
      ? `Итого: тестов ${s.tests}, сходится ${s.yes}, не сходится ${s.no}, нет случая ${s.noCase}, не проверено ${s.unchecked}.`
      : `Total: ${s.tests} tests, ${s.yes} agree, ${s.no} do not agree, ${s.noCase} no case, ${s.unchecked} not checked.`,
    "",
    markdownCell(TABLE_NOTE[lang]),
  );
  return out.join("\n");
}
