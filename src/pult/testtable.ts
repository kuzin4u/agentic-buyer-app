// Таблица тестирования пульта (П-11.5а, окно Б; Р-1533, Р-1534, Р-1538): 25 тестов «Задания на тестирование пульта» v1.1
// (`docs/reference/2026-11-13-zadanie-testirovanie-pulta-v1.1.xlsx`, лист «Задание на тестирование»; решение владельца
// 13.11) ↔ вердикты движка и паспорта ↔ ожидания задания; колонки задания «MVP — факт» и «MVP — сходится», итоги — как лист
// «Итоги». Чистая функция: факты — только из интерпретаций, модели транзакций, вердиктов, журнала стенда и журнала реакций;
// время — параметром. UI таблицы и живой прогон 25 тестов — П-11.5б окна А.
//
// Ожидания — **структурой** (Р-1534, В1): условия, узел, нарушитель, защитник, итог. Текст задания не разбирается — разбор
// текста ломается на первой новой формулировке; xlsx при работе не читается. «Сходится» — по столбцу M «Ожидание на стенде
// (MVP)» задания v1.1, а не по E. Столбцы A–L v1.1 — те же, что в v1.0: `v10` — колонка E (сверка скриптом — PR #15,
// #issuecomment-6835117541), `mvp` — столбец M (сверка скриптом — PR #16, К1); нет `mvp` — M структурой совпадает с E.
// Файл v1.1 сменился — тест sha256 краснеет, структура пересверяется.
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
// «сходится» не влияет. Ситуация теста в прогоне не возникла — «не проверено», «нет» — только при расхождении (Р-1553, П8):
// У-01…У-03 — ожидание оператора до порога не дошло; У-04 — нажатий оператора по объектам прогона нет.
import { CLIENT_AUTO_OFF, CLIENT_AUTO_ON, DEFAULT_WAIT_MS, faultOf, runDeadline, splitRuns, type FaultOutcome, type Run } from "../dashboards/control.js";
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
  /** Защитник — только там, где его называет ожидание на стенде (Н-03, столбец M v1.1). */
  readonly protector?: Party;
  /** Ветка по исходу прогона драйвера «ПР» (Р-1545, Р-1546): отказ — только «сработало» с этим защитником; операция прошла —
   *  только «нарушено» без защитника (Н-08: отказала Платформа — защитила Платформа; паспорт в обоих случаях). Ветка
   *  «сработало» на стенде достижима с кирпича № 10 окна А (`cf35e9e`, Р-1548) — `tests/demo/acc1-n08-live.test.ts`. */
  readonly firedBy?: Party;
  /** Условия, которые должны остаться без паспорта (Н-03 на стенде: R28, R30 — «соблюдено», столбец M v1.1). */
  readonly okConds?: readonly CheckableCondition[];
}
/** Защитник ожидания: один или перечень допустимых (П-07, П-08 — «Платформа или агент», столбец M v1.1; Р-1545). Задан —
 *  вердикт с защитником «не определён» не подходит (Р-1519, Р-1522: «не определён» — не защита). */
export type ExpectProtector = Party | readonly Party[];
const protectorOk = (want: ExpectProtector | undefined, got: Party | "undetermined" | undefined): boolean =>
  want === undefined || (got !== undefined && got !== "undetermined" && (typeof want === "string" ? want === got : want.includes(got)));
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
        readonly protector?: ExpectProtector;
      };
      /** Операции не было: поручение без покупки. */
      readonly noOperation?: true;
    }
  /** `passport: null` — паспорта нет. `fired` — сбой обязан сработать: запись журнала стенда в окне (не сработал —
   *  ситуация не возникла, «не проверено»; П8, П11); при `passport: null` ещё и итог по её операции есть (Н-12 на стенде,
   *  столбец M v1.1), итога нет — «не проверено». */
  | { readonly kind: "incorrect"; readonly passport: ExpectFinding | null; readonly fired?: readonly StandLogWhat[] }
  | { readonly kind: "toward"; readonly wait: Exclude<WaitKind, "agent_step">; readonly cond: "R08" | "R18" | "R21" }
  | { readonly kind: "prevented"; readonly cond: "R21" }
  /** Нет случая на стенде (Н-10: данных карты нет нигде, инвариант 1). */
  | { readonly kind: "no_case" };

interface Spec {
  readonly test: TestCode;
  readonly kind: TestKind;
  /** Ожидание модели — колонки E и C задания (v1.0 = v1.1) структурой. */
  readonly v10: Expect;
  /** Ожидание на стенде — столбец M задания v1.1; нет — M структурой совпадает с E. */
  readonly mvp?: Expect;
}

const ok = (outcome: TxOutcomeKind, code?: string) => ({ kind: outcome, ...(code !== undefined && { code }) });
const bad = (conds: readonly CheckableCondition[], violator: Party, node?: NodeId): Expect => ({
  kind: "incorrect",
  passport: { conds, violator, ...(node !== undefined && { node }) },
});

/** 25 строк задания: `v10` — колонки E и C (сверка скриптом — PR #15), `mvp` — столбец M v1.1 (сверка скриптом — PR #16);
 *  у Н-02 `mvp` — M (= E) плюс условие П11 «сбой сработал», в задании его нет. */
export const TEST_SPECS: readonly Spec[] = [
  { test: "П-01", kind: "correct", v10: { kind: "correct", outcome: ok("paid") } },
  { test: "П-02", kind: "correct", v10: { kind: "correct", outcome: ok("paid") } },
  // M: R09 «сработало», причина «решение клиента» (`rejected_*`: MANDATE_NOT_ACTIVE после `mandate.rejected`), паспорта нет.
  {
    test: "П-03",
    kind: "correct",
    v10: { kind: "correct", decision: { kind: "client_decision" } },
    mvp: { kind: "correct", decision: { kind: "client_decision", cond: "R09" } },
  },
  // M: R21 «сработало» — срок подтверждения истёк без оплаты, решение клиента, защитила Платформа (`confirmation_expired`).
  // `confirmation.expired` итогом транзакции не становится (`tx.ts`) — итога в ожидании нет.
  {
    test: "П-04",
    kind: "correct",
    v10: { kind: "correct", outcome: ok("rejected") },
    mvp: { kind: "correct", decision: { kind: "client_decision", cond: "R21", protector: "platform" } },
  },
  // M: «защита „лимит клиента“, защитил банк» — «защита» здесь название гарантии `limit_client`; вид вердикта у неё — решение
  // клиента (`verdict.ts`, `BY_GUARANTEE.limit_client`), паспорта нет (ревью К1 № 6).
  {
    test: "П-05",
    kind: "correct",
    v10: { kind: "correct", outcome: ok("declined", "LIMIT_EXCEEDED"), decision: { kind: "client_decision", guarantee: "limit_client", protector: "bank" } },
  },
  // M: агент сам отказывает продавцу (журнал агента MANDATE_OUT_OF_SCOPE) раньше `valid_to` — R17 «сработало», защитил АГЕНТ.
  {
    test: "П-06",
    kind: "correct",
    v10: { kind: "correct", decision: { kind: "protection", cond: "R17", guarantee: "mandate_scope", protector: "platform" } },
    mvp: { kind: "correct", noOperation: true, decision: { kind: "protection", cond: "R17", guarantee: "mandate_scope", protector: "agent" } },
  },
  // M: защитник по источнику — Платформа (403) или агент (журнал агента); «не определён» — «нет» (Р-1545).
  {
    test: "П-07",
    kind: "correct",
    v10: { kind: "correct", decision: { kind: "protection", guarantee: "agent_suspended", protector: "platform" } },
    mvp: { kind: "correct", decision: { kind: "protection", guarantee: "agent_suspended", protector: ["platform", "agent"] } },
  },
  // Отзыв — гарантией `revoke` или условием R09 (гарантию подавляет вердикт R09 в том же объекте, `COVERED` в `verdict.ts`).
  // M: защитил агент или Платформа — засчитываются оба; «не определён» — «нет» (Р-1545).
  {
    test: "П-08",
    kind: "correct",
    v10: { kind: "correct", decision: { kind: "client_decision", cond: "R09", guarantee: "revoke", protector: "agent" } },
    mvp: { kind: "correct", decision: { kind: "client_decision", cond: "R09", guarantee: "revoke", protector: ["agent", "platform"] } },
  },
  // M: поручение без покупки, отказ ядра в момент `valid_to` или позже — R09 «сработало», срок, защитил агент.
  {
    test: "П-09",
    kind: "correct",
    v10: { kind: "correct", noOperation: true, decision: { kind: "protection" } },
    mvp: { kind: "correct", noOperation: true, decision: { kind: "protection", cond: "R09", protector: "agent" } },
  },
  { test: "Н-01", kind: "incorrect", v10: bad(["R46"], "agent", "У2") },
  // M = E; сбой обязан сработать (запись стенда в окне), иначе ситуация не возникла — «не проверено» (П11, Р-1556: честный
  // агент второго запроса реквизита по выданному заказу не делает). Разыгрывает нарушение драйвер нарушителя: с v0.49.0
  // стенд принимает пометку «ПР» по Н-02 (передача #120), ветка — `n02Branch`, живой прогон — `acc1-n02-live.test.ts`;
  // поэтому «не проверено» теперь означает «не разыграли в этом прогоне», а не «на стенде недостижимо».
  {
    test: "Н-02",
    kind: "incorrect",
    v10: bad(["R23", "R25"], "platform", "У2"),
    mvp: { kind: "incorrect", passport: { conds: ["R23", "R25"], violator: "platform", node: "У2" }, fired: FAULT_WHAT["Н-02"] },
  },
  // M: пульт по инварианту 6 слова продавца итогом не берёт — R27 «сработало», нарушил продавец, защитил пульт; R28, R30
  // «соблюдено»; паспорта «нарушил: оператор» нет.
  {
    test: "Н-03",
    kind: "incorrect",
    v10: bad(["R27", "R28", "R30"], "operator", "У3"),
    mvp: { kind: "incorrect", passport: { conds: ["R27"], node: "У3", violator: "merchant", protector: "operator", okConds: ["R28", "R30"] } },
  },
  { test: "Н-04", kind: "incorrect", v10: bad(["R32"], "merchant", "У3") },
  { test: "Н-05", kind: "incorrect", v10: bad(["R47"], "agent", "У1") },
  // M: «сходится» — по R37 + агент + У5. Правило вердикта остаётся: R09 «оплачено после отзыва» — нарушитель «не определён»
  // (гонка С-28, «Расхождения» № 7); R18 «нарушено» — только если шина покажет оплату без согласия.
  { test: "Н-06", kind: "incorrect", v10: bad(["R37", "R09", "R18"], "agent", "У5"), mvp: bad(["R37"], "agent", "У5") },
  { test: "Н-07", kind: "incorrect", v10: bad(["R18"], "agent") },
  // M: Платформа отказала MANDATE_SCOPE — R17 «сработало», защитила Платформа; не отказала — R17 «нарушено», защитника нет.
  // Нарушил агент (пометка «ПР») и паспорт есть в обоих случаях (П-4.1); статус и защитник разведены полем `firedBy` (Р-1545).
  { test: "Н-08", kind: "incorrect", v10: bad(["R17"], "agent"), mvp: { kind: "incorrect", passport: { conds: ["R17"], violator: "agent", firedBy: "platform" } } },
  { test: "Н-09", kind: "incorrect", v10: bad(["R26"], "agent") },
  { test: "Н-10", kind: "incorrect", v10: bad(["R41"], "agent"), mvp: { kind: "no_case" } },
  { test: "Н-11", kind: "incorrect", v10: bad(["R20"], "bank") },
  // M: итог пришёл до срока 75 с — R31 «соблюдено, позднее событие учтено»: сбой сработал, итог есть, паспорта нет.
  {
    test: "Н-12",
    kind: "incorrect",
    v10: bad(["R31"], "operator", "У4"),
    mvp: { kind: "incorrect", passport: null, fired: FAULT_WHAT["Н-12"] },
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

export interface TestRow {
  readonly test: TestCode;
  readonly kind: TestKind;
  /** Ожидание на стенде — столбец M задания v1.1. */
  readonly expected: Phrase;
  /** «MVP — факт»: только идентификаторы, коды и подписи (инварианты 1, 4). */
  readonly fact: Phrase;
  readonly agree: Agree;
  /** В прогоне работал эмулятор клиента «Авто» (П5 п. 3). */
  readonly auto: boolean;
  /** Метка прогона теста (`run.<имя>`, `run.fault Н-xx`, `stand_fault.armed Н-xx`); нет — прогона нет. */
  readonly run?: string;
  /** Исход прогона драйвера нарушителя «ПР», если строка судится по нему (`run.fault Н-xx`). */
  readonly driver?: FaultOutcome;
  /** Объекты прогона: транзакции, поручения и запросы подтверждения транзакций окна (реакции пульта бывают и на них). */
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
  /** Момент, на который посчитана таблица, — `TestTableInput.now` как есть; в акте ACC-1 — время сборки (Р-1553, П8). */
  readonly at: string;
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
const parties = (x: ExpectProtector): Phrase => (typeof x === "string" ? party(x) : join(x.map(party), " / "));
/** Примечание таблицы (Р-1534, В3): ограничение пульта — не молча. */
export const TABLE_NOTE: Phrase = p(
  "Н-xx: «сходится» — хотя бы один паспорт с ожидаемым условием, узлом и нарушителем. «Каждая транзакция поймана» пульт не проверяет: на какой транзакции сработал сбой, знает стенд, а не пульт.",
  'Н-xx: "yes" means at least one passport with the expected condition, node and violator. The console does not check that every transaction was caught: only the stand knows which transactions a fault hit.',
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
            ...(d.protector ? [join([p("защитил:", "protected by:"), parties(d.protector)], " ")] : []),
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
        ...(e.fired ? [join([p("сбой сработал (П11):", "the fault fired (П11):"), lit(e.fired.join(" / "))], " ")] : []),
        join([p("паспорт:", "passport:"), lit(e.passport.conds.join(" / "))], " "),
        ...(e.passport.node ? [join([p("узел", "node"), lit(e.passport.node)], " ")] : []),
        join([p("нарушил:", "violator:"), party(e.passport.violator)], " "),
        ...(e.passport.protector ? [join([p("защитил:", "protected by:"), party(e.passport.protector)], " ")] : []),
        ...(e.passport.firedBy
          ? [
              join([p("отказ — «сработало», защитил:", 'refused — "triggered", protected by:'), party(e.passport.firedBy)], " "),
              p("операция прошла — «нарушено», защитника нет", 'the operation went through — "violated", no protector'),
            ]
          : []),
        ...(e.passport.okConds ? [join([lit(e.passport.okConds.join(", ")), p("— без паспорта", "— no passport")], " ")] : []),
      ]);
    case "toward":
      return join([p("«Идёт к нарушению»:", '"Heading to a violation":'), lit(e.cond), WAIT_LABEL[e.wait]], " ");
    case "prevented":
      return p(
        `«Напомнить клиенту» по ${e.cond}, затем оплачено; паспорта нет; «упреждено реакцией»`,
        `"Remind the client" on ${e.cond}, then paid; no passport; "prevented by a reaction"`,
      );
    case "no_case":
      return join([AGREE_LABEL.no_case, NOT_REPRODUCIBLE_LABEL.INVARIANT_1], ": ");
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
    // Сбой «П» — по коду; у записи с тестом — ещё и по тесту: общий код у двух тестов не отнесёт чужую запись к строке
    // (повторное ревью П-11.5а № 5, Б5).
    return at >= w.fromAt && at < w.toAt && ((e.what === "MARKED" && e.test === test) || (what.includes(e.what) && (e.test === undefined || e.test === test)));
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
/** Вид вердикта в факте — ожидание Н-08 различается по нему (повторное ревью К1а № 3). */
const VERDICT_KIND_LABEL: Readonly<Record<Verdict["kind"], Phrase>> = {
  violation: p("«нарушено»", '"violated"'),
  protection: p("«сработало»", '"triggered"'),
  client_decision: p("решение клиента", "client's decision"),
};
const findingPhrase = (v: Verdict): Phrase =>
  join([
    lit([v.obj ?? "—", v.cond ?? v.guarantee ?? ""].filter(Boolean).join(": ")),
    VERDICT_KIND_LABEL[v.kind],
    ...(v.node ? [lit(v.node)] : []),
    join([p("нарушил:", "violator:"), party(v.violator === "client_decision" || v.violator === undefined ? "undetermined" : v.violator)], " "),
    ...(v.protector ? [join([p("защитил:", "protected by:"), party(v.protector)], " ")] : []),
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
    const hit = vs.find((v) => v.kind === d.kind && sign(v) && protectorOk(d.protector, v.protector));
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

function judgeIncorrect(e: Extract<Expect, { kind: "incorrect" }>, vs: readonly Verdict[], fired: readonly StandLogEntry[], model: TxModel, driver?: FaultOutcome): Judged {
  const pass = passportsOf(vs);
  const factPass = pass.length ? join([join([p("паспортов:", "passports:"), lit(String(pass.length))], " "), ...pass.slice(0, 5).map(findingPhrase)], "; ") : p("паспортов нет", "no passports");
  // Сбой обязан сработать, а записи стенда в окне нет — ситуация теста не возникла (П8; П11 — Н-02).
  if (e.fired && !fired.some((x) => e.fired!.includes(x.what)))
    return { agree: "unchecked", fact: join([p("сбой не сработал — ситуация не возникла", "the fault did not fire — the situation did not arise"), factPass], "; ") };
  if (e.passport === null) {
    if (e.fired) {
      // Сбой обязан сработать, и итог по его операции должен прийти (Н-12, столбец M v1.1; ревью № 2).
      const recs = fired.filter((x) => e.fired!.includes(x.what)); // не пусто: проверено выше
      const refs = recs.map((x) => x.ids.op_ref).filter((x): x is string => x !== undefined);
      const done = refs.length > 0 && refs.every((r) => model.txs.some((t) => t.opRefs.includes(r) && t.outcome !== undefined));
      // Хотя бы одна запись сбоя без номера операции — её итог сверить не с чем (столбец M; формулировка — как у R31
      // `late_unlinked`; ревью Б3 № 2, Б5). И в смешанном случае: записи с номером не дают «итог учтён» за запись без него
      // (ревью Б5 № 4 — ложное «да»).
      const unlinked = refs.length < recs.length;
      const noMatch = p("сбой сработал, запись стенда без номера операции — итог сверить не с чем", "the fault fired, the stand record has no operation number — nothing to match the outcome against");
      if (unlinked && pass.length === 0) return { agree: "unchecked", fact: join([noMatch, factPass], "; ") };
      if (!done && pass.length === 0) return { agree: "unchecked", fact: join([p("сбой сработал, итога по операции ещё нет", "the fault fired, no outcome for the operation yet"), factPass], "; ") };
      // Паспорта есть — «нет»; голова факта — по той же причине, что без паспортов (ревью Б5 № 5).
      const head = unlinked ? noMatch : done ? p("сбой сработал, итог учтён", "the fault fired, outcome counted") : p("сбой сработал, итога по операции нет", "the fault fired, no outcome for the operation");
      return { agree: done && !unlinked && pass.length === 0 ? "yes" : "no", fact: join([head, factPass], "; ") };
    }
    return { agree: pass.length === 0 ? "yes" : "no", fact: factPass };
  }
  const w = e.passport;
  // `firedBy` — по фактическому исходу прогона драйвера (Р-1546): отказ (`refused`) — только вердикт защиты с защитником
  // `firedBy`; операция прошла (`marked`) — только вердикт нарушения без защитника; другой исход — своей ветки нет.
  // «Любой из двух» не проходит.
  const ownBranch = (v: Verdict) =>
    w.firedBy === undefined ||
    (driver === "refused" ? v.kind === "protection" && v.protector === w.firedBy : driver === "marked" && v.kind === "violation" && v.protector === undefined);
  const sameFinding = (v: Verdict) => v.cond !== undefined && w.conds.includes(v.cond) && v.violator === w.violator;
  const caught = pass.filter(
    (v) => sameFinding(v) && (w.node === undefined || v.node === w.node) && protectorOk(w.protector, v.protector) && ownBranch(v),
  );
  // Паспорт того же условия с другим нарушителем, паспорт условия, которое должно остаться «ok», и при `firedBy` — паспорт
  // того же условия и нарушителя из чужой ветки (отказ, а пульт показывает «нарушено», и наоборот; повторное ревью К1а № 1)
  // — «нет» (Р-1534 В3, ревью № 7; Р-1546).
  const other = pass.filter(
    (v) =>
      v.cond !== undefined &&
      ((w.conds.includes(v.cond) && v.violator !== w.violator) || (w.okConds ?? []).includes(v.cond) || (w.firedBy !== undefined && sameFinding(v) && !ownBranch(v))),
  );
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

/** Начало ожидания на шине и его прямой ответ — по виду (записи начала и ответа — те же, что у `waits()` в `control.ts`, но
 *  без него: признак ситуации не зависит от проверяемой функции пульта; ответ владельца 14.11 «3 — да», ревью П-11.5б-1
 *  № 1). Прочие закрытия — шире, чем у `waits()`: см. `rawWaitArose` (ревью П-11.5б-4 № 3). */
const RAW_WAIT: Readonly<Record<Exclude<WaitKind, "agent_step">, { readonly start: (x: Interpretation) => string | undefined; readonly closes: (x: Interpretation, id: string) => boolean }>> = {
  sign: {
    start: (x) => (x.stream === "scenario" && x.ref === "intent.awaiting_signature" ? x.ids?.mandate_id : undefined),
    closes: (x, id) => x.source === "pao_event" && (x.ref === "mandate.signed" || x.ref === "mandate.rejected") && x.ids?.mandate_id === id,
  },
  consent: {
    start: (x) => (x.stream === "scenario" && x.ref === "cart.awaiting_signature" ? x.ids?.mandate_id : undefined),
    closes: (x, id) => x.source === "pao_event" && (x.ref === "mandate.signed" || x.ref === "mandate.rejected") && x.ids?.mandate_id === id,
  },
  confirmation: {
    start: (x) => (x.source === "pao_event" && x.ref === "confirmation.required" ? x.ids?.confirmation_id : undefined),
    closes: (x, id) => x.source === "pao_event" && x.ref !== "confirmation.required" && x.ref.startsWith("confirmation.") && x.ids?.confirmation_id === id,
  },
};

/** Итоговые шаги сюжета, которые тоже снимают ожидание (отзыв, отказ, итог, сбой сюжета). */
const RAW_TERMINAL_STEP = /(\.signed|\.rejected|\.revoked|\.declined|\.refused|^outcome|^failed)$/;

/** Ситуация У-01…У-03 по сырой шине: начало ожидания у объекта окна, закрытие — не раньше порога (или его нет до конца окна
 *  / «сейчас»). Признак есть — тест судится; нет — «не проверено» (П8 доп. 1).
 *
 *  Закрывает ожидание не только его ответ (`RAW_WAIT.closes`), но и **любое** событие Платформы или итоговый шаг сюжета по
 *  тому же объекту — поручению, его намерению, заказам и запросам подтверждения покупки (по модели транзакций, не по
 *  `waits()`). Это шире, чем снимает ожидание `waits()` (отзыв, итог, конфликт, отсечка по отказу — ревью П-11.5б-4 № 1):
 *  лишнее закрытие даёт лишь «не проверено» (дефект не пойман), а ложного «нет» не даёт. */
function rawWaitArose(
  items: readonly Interpretation[],
  w: Window,
  objs: ReadonlySet<string>,
  model: TxModel,
  kind: Exclude<WaitKind, "agent_step">,
  now: string,
  waitMs = WAIT_MS,
): boolean {
  const list = [...items].sort((a, b) => a.seq - b.seq);
  const after = list.find((x) => x.seq >= w.to);
  const end = Math.min(Date.parse(now), after ? Date.parse(after.at) : Infinity);
  const rule = RAW_WAIT[kind];
  const idsOf = (x: Interpretation) => Object.values(x.ids ?? {}).filter((v): v is string => typeof v === "string");
  for (const x of list) {
    if (!inWin(w, x.seq)) continue;
    const id = rule.start(x);
    if (id === undefined) continue;
    // Объект начала — транзакция или поручение модели; только объекты окна (ревью № 2).
    const tx = model.txs.find((t) => t.seqs.includes(x.seq) || t.confirmationIds.includes(id) || t.cartMandateId === id);
    const mand = model.mandates.find((m) => m.id === id);
    if (!objs.has(id) && !(tx !== undefined && objs.has(tx.id)) && !(mand !== undefined && objs.has(mand.id))) continue;
    const related = new Set<string>([id, ...idsOf(x), ...(tx ? [tx.intentId, tx.cartMandateId, ...tx.orderIds, ...tx.confirmationIds].filter((v): v is string => v !== undefined) : [])]);
    const closesOther = (y: Interpretation) => (y.source === "pao_event" || (y.stream === "scenario" && RAW_TERMINAL_STEP.test(y.ref))) && idsOf(y).some((v) => related.has(v));
    const close = list.find((y) => y.seq > x.seq && y !== x && (rule.closes(y, id) || closesOther(y)));
    const until = close ? Math.min(Date.parse(close.at), end) : end;
    if (until - Date.parse(x.at) >= waitMs) return true;
  }
  return false;
}

function judgeToward(e: Extract<Expect, { kind: "toward" }>, items: readonly Interpretation[], w: Window, objs: ReadonlySet<string>, model: TxModel, now: string, waitMs: number): Judged {
  const seen = seenWaits(items, w, objs, e.wait, now, waitMs);
  // Признак ситуации — по сырой шине, не через `waits()`: на шине ожидание до порога было, а пульт его не показал — «нет»
  // (дефект пульта не прячется под «не проверено»; ревью П-11.5б-1 № 1, решение владельца 14.11).
  if (!seen.length && rawWaitArose(items, w, objs, model, e.wait, now, waitMs))
    return { agree: "no", fact: join([lit(e.cond), p("на шине ожидание дошло до порога, а «Идёт к нарушению» пульт не показал", 'on the bus the wait reached the threshold, but the console did not show "Heading to a violation"')], " · ") };
  // Ожидание оператора до порога не дошло — ситуация теста не возникла: «не проверено», а не «нет» (Р-1553, П8).
  if (!seen.length) return { agree: "unchecked", fact: join([lit(e.cond), p("ожидание до порога не дошло — ситуация не возникла", "the wait did not reach the threshold — the situation did not arise")], " · ") };
  return { agree: "yes", fact: join(seen.map((s) => join([lit(e.cond), lit(s.obj), WAIT_LABEL[e.wait], secs(s.sec)], " · ")), "; ") };
}

function judgePrevented(e: Extract<Expect, { kind: "prevented" }>, txs: readonly PultTx[], ids: readonly string[], vs: readonly Verdict[], reactions: readonly TableReaction[]): Judged {
  const objs = new Set([...ids, ...txs.flatMap((t) => t.confirmationIds)]);
  const paid = txs.filter((t) => t.outcome?.kind === "paid" || t.outcome?.kind === "settled");
  const pass = passportsOf(vs);
  const paidFact = paid.length ? join([p("оплачено:", "paid:"), lit(paid.map((t) => t.id).join(", "))], " ") : p("оплаты нет", "not paid");
  const passFact = pass.length ? join([p("паспорт:", "passport:"), ...pass.map(findingPhrase)], " ") : p("паспортов нет", "no passports");
  // Нажатий оператора по объектам прогона нет (любой вид реакции, любой исход) — ситуация теста не возникла: «не
  // проверено» (Р-1553, П8; В2 (а) — нажал не ту кнопку — ситуация была, это «нет»). Оплата и паспорта прогона — в факте
  // и здесь (ревью Р-1553 № 2).
  if (!reactions.some((r) => objs.has(r.obj)))
    return {
      agree: "unchecked",
      fact: join([p("нажатий оператора по объектам прогона нет — ситуация не возникла", "no operator presses on the run's objects — the situation did not arise"), paidFact, passFact], "; "),
    };
  const firstPaid = Math.min(...paid.map((t) => Date.parse(t.outcome!.at)));
  // «Напомнено» раньше «оплачено» (ревью № 12).
  const reminded = reactions.filter((r) => r.action === "remind" && r.outcome === "done" && r.cond === e.cond && objs.has(r.obj) && Date.parse(r.at) < firstPaid);
  const preempted = reminded.filter((r) => r.preempted === e.cond);
  const facts: Phrase[] = [
    reminded.length ? join([p("напомнено:", "reminded:"), lit(reminded.map((r) => r.obj).join(", "))], " ") : p("«Напомнить клиенту» до оплаты не нажато", '"Remind the client" not pressed before payment'),
    paidFact,
    passFact,
    preempted.length ? p("«упреждено реакцией»", '"prevented by a reaction"') : p("отметки «упреждено реакцией» нет", 'no "prevented by a reaction" mark'),
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

  // Срок прогона сюжета (Б5; П-11.5а № 11) — как у «Контроля»: `runDeadline` с `DEFAULT_WAIT_MS`, а не порог оператора
  // `waitMs` (ревью Б5 № 6). Шаги взвода и снятия сбоев срок не сдвигают: взвод после прогона иначе тянул бы
  // срок за собой (ревью Б5 № 2). Срока не посчитать (время не читается) — `undefined`: прежнее правило, без отсечки.
  const nowMs = Date.parse(now);
  const deadlineOf = (r: Run): number | undefined => {
    try {
      return runDeadline(
        r.items.filter((x) => !(x.stream === "scenario" && x.ref.startsWith("stand_fault."))),
        r.startedAt,
        DEFAULT_WAIT_MS,
      );
    } catch {
      return undefined;
    }
  };
  // Завершён — только по сроку, как в «Контроле»: ранний запуск следующего сюжета прогон не завершает (ревью Б5 № 3).
  // Нечитаемое «сейчас» — прежнее правило (ревью Б5 № 9).
  const finished = (r: Run) => {
    const d = deadlineOf(r);
    return d === undefined || !Number.isFinite(nowMs) || d <= nowMs;
  };
  const atSeq = (seq: number) => Date.parse(sorted.find((x) => x.seq === seq)?.at ?? "");
  // Взвод сбоя «П» и включение «Авто» после срока завершённого прогона (до следующей метки) к нему не относятся: иначе
  // прогон задним числом становился «грязным» (строка уходила на старый чистый прогон — ложное «да») или «Авто» (ревью Б5 № 2).
  const afterDeadline = (r: Run, seq: number) => {
    const d = deadlineOf(r);
    return d !== undefined && seq > r.startSeq && atSeq(seq) > d;
  };
  const cleanRun = (r: Run) => {
    const w = windows.get(r)!;
    return !armedSpans.some((s) => s.from < w.to && s.to > w.from && !afterDeadline(r, s.from));
  };
  const autoOf = (r: Run) => {
    const w = windows.get(r)!;
    const steps = sorted.filter((x) => x.stream === "scenario" && (x.ref === CLIENT_AUTO_ON || x.ref === CLIENT_AUTO_OFF));
    const atLabel = [...steps].reverse().find((x) => x.seq < r.startSeq)?.ref === CLIENT_AUTO_ON;
    return atLabel || steps.some((x) => x.ref === CLIENT_AUTO_ON && x.seq > w.from && x.seq < w.to && !afterDeadline(r, x.seq));
  };

  const rows = TEST_SPECS.map((spec): TestRow => {
    const expect = spec.mvp ?? spec.v10;
    /** Метка прогона теста — для акта ACC-1 (К2): `run.<имя>`, `run.fault Н-xx`, `stand_fault.armed Н-xx`. */
    let runLabel: string | undefined;
    /** Исход прогона драйвера «ПР» — по нему `firedBy` выбирает ветку (Р-1546); в строке — для акта (К2). */
    let driver: FaultOutcome | undefined;
    const row = (j: Judged, auto: boolean, objs: readonly string[]): TestRow => ({
      test: spec.test,
      kind: spec.kind,
      expected: expectPhrase(expect),
      fact: j.fact,
      agree: j.agree,
      auto,
      objs,
      ...(runLabel !== undefined && { run: runLabel }),
      ...(driver !== undefined && { driver }),
    });

    // Н-10 — «нет случая» по столбцу M: не воспроизводится по инварианту 1 (`stand-tests.ts`; тест сверяет оба перечня).
    if (expect.kind === "no_case") return row({ agree: "no_case", fact: NOT_REPRODUCIBLE_LABEL.INVARIANT_1 }, false, []);

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
        driver = f.outcome;
        runLabel = `run.fault ${spec.test}`;
        note = join([lit(`${runLabel}:`), f.outcome ? FAULT_OUTCOME_LABEL[f.outcome] : p("идёт", "running"), ...(f.code ? [lit(f.code)] : [])], " ");
        if (f.outcome === "unplayed" || f.outcome === "failed" || f.outcome === undefined) return row({ agree: "unchecked", fact: note }, w.auto, []);
      } else if (armed) {
        const off = armedSpans.find((s) => s.from === armed.seq)!.to;
        const run = lastRun((r) => r.startSeq <= armed.seq);
        w = win(armed.seq, off, sorted.some((x) => x.seq > armed.seq && x.seq < off && x.stream === "scenario" && x.ref === "client.auto_on") || (run?.clientAuto ?? false));
        runLabel = `stand_fault.armed ${spec.test}`;
        note = lit(runLabel);
      }
    } else {
      // П-xx и У-xx — «поломки все выключены» (задание, колонка D): прогон, в окне которого взведён сбой «П», не считается.
      const name = TEST_SCENARIO[spec.test as keyof typeof TEST_SCENARIO];
      const all = runs.filter((r) => r.name === name);
      const clean = all.filter(cleanRun);
      // Берётся последний **завершённый** прогон (П-11.5а № 11, Б5): прошёл срок ожидания. Идущий прогон строку не судит —
      // пока он идёт, строка не «нет».
      const r = [...clean].reverse().find(finished);
      const last = clean[clean.length - 1];
      if (!r && last) {
        runLabel = `run.${name}${all.length > 1 ? ` ${all.indexOf(last) + 1}/${all.length}` : ""}`;
        const auto = autoOf(last);
        // У-xx при «Авто» — «не засчитано» сразу: исход прогона это не изменит (П5 доп. 1 п. 5; ревью Б5 № 8).
        if (auto && (spec.kind === "toward" || spec.kind === "prevented")) return row({ agree: "not_counted", fact: lit(runLabel) }, true, []);
        return row({ agree: "unchecked", fact: join([lit(runLabel), p("прогон идёт — ждём срок", "the run is in progress — waiting for the deadline")], " — ") }, auto, []);
      }
      if (r) {
        w = { ...windows.get(r)!, auto: autoOf(r) };
        // Прогонов сюжета несколько — какой взят: «номер / всего», без слов (метка одна для ru- и en-акта; Б3, ревью К2 PR #16
        // № 14). `×N` остаётся только там, где ни один прогон не взят (все со сбоем «П»).
        runLabel = `run.${name}${all.length > 1 ? ` ${all.indexOf(r) + 1}/${all.length}` : ""}`;
        note = lit(runLabel);
      } else if (all.length) {
        runLabel = `run.${name} ×${all.length}`;
        return row({ agree: "unchecked", fact: join([lit(runLabel), p("все прогоны — со взведённым сбоем стенда", "every run had a stand fault armed")], " — ") }, false, []);
      }
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
            // Б5 № 7 (К2.6 окна А): тест записи знает сам вердикт — сверка по нему, а не по коду. У двух тестов код может
            // совпасть, и привязка по коду отдала бы вердикт чужой строке. Тест в причине есть не у всех записей (служебные
            // его не несут) — тогда остаётся прежний путь по коду (`FAULT_WHAT`).
            (v.cause.kind === "fault" && (v.cause.test !== undefined ? v.cause.test === spec.test : what.includes(v.cause.what))) ||
            (spec.test === "Н-12" && v.cause.kind === "rule" && v.cause.rule === "late_lost")),
      );
      mine = [...mine, ...extra];
    }
    // Запросы подтверждения транзакций окна — тоже объекты прогона: реакция «Напомнить клиенту» идёт по `confirmation_id`
    // (У-04; ревью К2 № 2).
    const ids = [...new Set([...own, ...txs.flatMap((t) => t.confirmationIds), ...mine.flatMap((v) => (v.obj !== undefined ? [v.obj] : []))])];

    // У-01…У-04 при «Авто» — не засчитано (П5 доп. 1 п. 5; Р-1534, В4).
    if ((spec.kind === "toward" || spec.kind === "prevented") && W.auto) return row({ agree: "not_counted", fact: note! }, true, ids);

    let j: Judged;
    switch (expect.kind) {
      case "correct":
        j = judgeCorrect(expect, txs, mine);
        break;
      case "incorrect":
        j = judgeIncorrect(expect, mine, fired, model, driver);
        break;
      case "toward":
        j = judgeToward(expect, items, W, new Set(ids), model, now, waitMs);
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
  return { rows, totals: { tests: rows.length, yes, no, noCase, unchecked: rows.length - yes - no - noCase }, at: now };
}

// Выгрузка для акта ACC-1 — `src/pult/acc1.ts` (П-6.2, окно Б; PR #16, К2).
