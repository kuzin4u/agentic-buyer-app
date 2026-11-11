// Драйвер нарушителя «ПР» демо-стенда (П7, П-11.3): нарушения агента, которые эталонное ядро не совершает (Н-01, Н-05 ПР,
// Н-06…Н-09 «Задания на тестирование пульта» v1.0), разыгрывает приложение ключом своего агента и помечает каждое на
// стенде (`stand.demo.mark`, ответ Платформы по #112 п. 3–4). Решений здесь нет: драйвер — нарушитель, защиту дают
// Платформа и витрины кодами из таблицы п. 4 ответа #112.
//  - Только при `DEMO_FAULTS=1`: без флага экземпляр не создаётся и ключ не загружается (конструктор отказывает).
//  - Ключ агента загружается функцией ядра `loadKey` из каталога ключей демо-стенда и живёт только в памяти экземпляра:
//    на шину, в журнал, в ответы маршрута и на диск не попадает; запросы с ним уходят только на адреса стенда (П7 п. 5).
//  - Свой подписанный клиент ПАО и витрин, не порт ядра — исключение из правила совместимости 1 (П7, дополнение 1).
//  - Импортирует драйвер только сборка демо-стенда (`run.ts`) и автотесты; пульт и дашборды — нет (тест графа импортов).
// Договор ветки (повторное ревью П-11.3а-1, ревью П-11.3а-2; решения владельца, чат 11.11):
//  - запрос ключом агента (`c.call` — ПАО, `c.shop` — витрины) уходит только после пометки «ПР», пока ветка идёт и драйвер
//    её не остановил; запрет — на стороне клиента, а не на дисциплине ветки;
//  - драйвер ведёт журнал запросов ветки (ответ / отказ с кодом и статусом / сбой), дожидается всех ушедших запросов и
//    выносит итог только по журналу: «защита сработала» — объявленная пара «код + статус» в ответе; «совершено» — только
//    при пришедшем ответе 2xx; что ветка бросила или поймала, итог не меняет;
//  - на шину из ветки — только шаги закрытого перечня и только тест, код, статус и идентификаторы стенда по форме; коды из
//    ответов — тоже только по форме.
import { randomUUID } from "node:crypto";
import { signRequest, type Signer } from "@kuzin4u/agentic-core";
import { PaoCallError, PaoClient } from "@kuzin4u/agentic-core/pao";
import type { DemoIds } from "agentic-ps-platform/stand";
import { listKeys, loadKey } from "agentic-buyer-ref/src/agent/signer/index.js";
import type { FaultStart, FaultTest } from "./fault-tests.js";
import type { ScenarioStep, StepSink } from "./scenarios.js";
import type { DemoStand } from "./stand.js";

export { FAULT_TESTS, isFaultTest, type FaultStart, type FaultTest } from "./fault-tests.js";

type Pao = PaoClient<{ baseUrl: string; agentCode: string; signer: Signer; maxAttempts: number }>;

/** Идентификаторы пометки стенда (`DEMO_ID_FIELDS` Платформы, РП75 п. 4; в пакете не экспортируются). Список сверяется с
 *  типом `DemoIds` при компиляции в обе стороны: лишнее поле и недостающее — ошибка. */
export const ID_FIELDS = ["mandate_id", "confirmation_id", "op_ref", "merchant_id", "shop_id", "order_id", "order_ref"] as const satisfies readonly (keyof DemoIds)[];
const ID_FIELDS_COMPLETE: Exclude<keyof DemoIds, (typeof ID_FIELDS)[number]> extends never ? true : never = true;
void ID_FIELDS_COMPLETE;

/** Шаги, которые ветка может выпустить на шину, — закрытый перечень; у каждого — текст ru/en в словарях. Чужое имя —
 *  ошибка: драйвер останавливает ветку, её запросы больше не уходят, итог — BAD_STEP (инвариант 6: ни `outcome`, ни
 *  `run.*`, ни итоговых `fault.*`). «Запрос отправлен» (`fault.sent`) выпускает сам драйвер — по факту запроса. Ветки
 *  П-11.3б–д дописывают свои имена сюда и в словари. */
export const BRANCH_STEPS = ["fault.note.prepared"] as const;
export type BranchStep = (typeof BRANCH_STEPS)[number];

/** Ожидаемая защита: код и HTTP-статус ответа (таблица п. 4 ответа #112). */
export interface Guard {
  readonly code: string;
  readonly status: number;
}

/** Ответ витрины на запрос ветки (тело — только в памяти ветки: на шину не идёт). */
export interface ShopReply {
  readonly status: number;
  readonly body: unknown;
}

/** Что ветка получает. Стенд — только адреса ПАО и витрин: ни эмулятора банка и страницы УПК (подпись и подтверждение за
 *  клиента — только эмулятор клиента, П5 п. 5), ни каталога ключей. */
export interface FaultContext {
  /** Запрос к ПАО ключом агента — только после `mark`, пока ветка идёт; иначе не уходит (отказ промиса). */
  readonly call: Pao["call"];
  /** Запрос к витрине ключом агента (подпись, как у ядра) — по тем же правилам и только на адрес витрин стенда: путь —
   *  с `/`, без `#`; иначе не уходит. Ответ не 2xx — отказ промиса. */
  readonly shop: (method: "GET" | "POST", target: string, body?: unknown) => Promise<ShopReply>;
  /** **Нарушающий** запрос (ревью П-11.3а-2, повторное № 1): те же `call` и `shop`, но итог считается только по ним —
   *  «защита сработала» и «совершено». `call` и `shop` выше — подготовка: у неё учитывается лишь сбой. */
  readonly violate: { readonly call: Pao["call"]; readonly shop: FaultContext["shop"] };
  readonly urls: Readonly<{ pao: string; merchants: string }>;
  /** Шаг на шину: имя — из BRANCH_STEPS, параметры — только `code`, `status` и идентификаторы стенда по форме. */
  readonly step: (step: BranchStep, params?: ScenarioStep["params"]) => void;
  readonly signal: AbortSignal;
  /** Пометка «ПР» на стенде — **до** нарушающего запроса (П7 п. 4). Отказ стенда — исключение, ветка остановлена. */
  readonly mark: (ids: DemoIds) => void;
}

/** Ветка нарушения: ожидаемые защиты и ход. Итог ветка не сообщает — его выносит драйвер по журналу её запросов. */
export interface FaultBranch {
  readonly expect: readonly Guard[];
  readonly run: (c: FaultContext) => Promise<void>;
}

/** Ветки по тестам — кирпичами П-11.3б–д. Нет ветки — запуск NOT_READY. */
const BRANCHES: Partial<Record<FaultTest, FaultBranch>> = {};

/** Сколько закрытие ждёт идущую ветку (как у сюжетов): ответ стенда без таймаута не вешает остановку демо. */
const CLOSE_WAIT_MS = 3000;
/** Срок ответа ПАО и витрины на запрос ветки, мс: повисший запрос не держит драйвер (и через блокировку — сюжеты)
 *  занятым (повторное № 2). */
const REQUEST_TIMEOUT_MS = 10_000;

export interface FaultyOptions {
  readonly branches?: Partial<Record<FaultTest, FaultBranch>>;
  /** Идёт ли сюжет: нарушитель ходит тем же ключом агента — одновременно с сюжетом не стартует. */
  readonly otherBusy?: () => boolean;
  /** Срок ожидания ветки при закрытии, мс (по умолчанию CLOSE_WAIT_MS). */
  readonly closeWaitMs?: number;
  /** Только для автотестов: подменный fetch для ПАО и витрин («нет ответа», 5xx, перенаправление, код не по форме).
   *  Сборка демо-стенда (`run.ts`) его не передаёт (тест границы). */
  readonly fetch?: typeof fetch;
  /** Срок ответа на запрос ветки, мс (по умолчанию REQUEST_TIMEOUT_MS). */
  readonly timeoutMs?: number;
}

/** Причина остановки ветки драйвером. */
type StopCode = "NOT_MARKED" | "MARK_REJECTED" | "BAD_STEP" | "BAD_TARGET";

/** Отказ запроса ветки драйвером (запрос не ушёл): остановлена ветка, кончилась или драйвер закрыт. */
class FaultStop extends Error {
  constructor(
    readonly code: StopCode | "CLOSED",
    options?: { cause?: unknown },
  ) {
    super(code, options);
  }
}

/** Отказ витрины на запрос ветки: ответ не 2xx. */
class ShopCallError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | undefined,
  ) {
    super(`витрина: ${status}${code ? ` ${code}` : ""}`);
  }
}

/** Исход запроса ветки: ответ 2xx, отказ (код по форме и статус — кандидат в «защиту»), сбой (не защита). */
type Outcome = { readonly kind: "ok" } | { readonly kind: "refused"; readonly code: string; readonly status: number } | { readonly kind: "fail"; readonly code: string; readonly status?: number };
/** Запись журнала: исход и роль — подготовка или нарушение. */
type Entry = Outcome & { readonly violation: boolean };

const CODE_FORM = /^[A-Z][A-Z0-9_]{0,63}$/;
const ID_FORM = /^[A-Za-z0-9_.:-]{1,128}$/;

/** Код из ответа — только по форме; иначе сбой формы, а не код (инварианты 1, 4). */
const formCode = (code: unknown): string | undefined => (typeof code === "string" && CODE_FORM.test(code) ? code : undefined);

/** Отказ промиса, помеченный обработанным: ветка, не дождавшаяся запроса, не роняет процесс. */
function rejected<T>(e: unknown): Promise<T> {
  const p = Promise.reject(e) as Promise<T>;
  p.catch(() => undefined);
  return p;
}

export class FaultyDriver {
  readonly #d: DemoStand;
  readonly #emit: StepSink;
  readonly #pao: Pao;
  readonly #signer: Signer;
  readonly #fetch: typeof fetch;
  readonly #branches: Partial<Record<FaultTest, FaultBranch>>;
  readonly #otherBusy: () => boolean;
  readonly #closeWaitMs: number;
  readonly #ac = new AbortController();
  #running: Promise<void> | null = null;

  constructor(d: DemoStand, emit: StepSink, o: FaultyOptions = {}) {
    // Без режима сбоев драйвера нет (П7 п. 2): ни ключа, ни клиента.
    if (!d.faults || d.keysDir === undefined || d.stand.demo === undefined) throw new Error("драйвер нарушителя — только при DEMO_FAULTS=1 (П7)");
    const active = listKeys(d.keysDir).filter((k) => k.state === "active" && d.isAgentKid(k.kid));
    if (active.length !== 1) throw new Error(`ключ агента приложения: действующих ${active.length}, нужен один (П7)`);
    const { signer } = loadKey(d.keysDir, active[0]!.kid);
    this.#signer = signer;
    // Срок и отмена — у каждого запроса, ПАО и витрин (повторное № 2): повисший ответ кончается «нет ответа», закрытие
    // драйвера обрывает идущие запросы.
    const base = o.fetch ?? fetch;
    const timeoutMs = o.timeoutMs ?? REQUEST_TIMEOUT_MS;
    this.#fetch = ((input: string | URL | Request, init?: RequestInit) =>
      base(input, { ...init, signal: AbortSignal.any([this.#ac.signal, AbortSignal.timeout(timeoutMs), ...(init?.signal ? [init.signal] : [])]) })) as typeof fetch;
    // Одна попытка: нарушитель не повторяет — код защиты нужен как есть.
    this.#pao = new PaoClient({ baseUrl: d.urls.pao, agentCode: d.agentCode, signer, maxAttempts: 1, fetch: this.#fetch });
    this.#d = d;
    this.#emit = emit;
    this.#branches = o.branches ?? BRANCHES;
    this.#otherBusy = o.otherBusy ?? (() => false);
    this.#closeWaitMs = o.closeWaitMs ?? CLOSE_WAIT_MS;
  }

  /** Занят — пока идёт ветка и пока не пришли ответы на все её запросы. */
  get busy(): boolean {
    return this.#running !== null;
  }

  /** Есть ли у теста ветка (кирпичи П-11.3б–д). */
  has(test: FaultTest): boolean {
    return Object.hasOwn(this.#branches, test);
  }

  /** Запустить нарушение; ход — шагами на шину. Возвращает сразу. */
  start(test: FaultTest): FaultStart {
    if (this.#ac.signal.aborted) return { ok: false, code: "CLOSED" };
    if (this.#running || this.#otherBusy()) return { ok: false, code: "BUSY" };
    const branch = Object.hasOwn(this.#branches, test) ? this.#branches[test] : undefined;
    if (!branch) return { ok: false, code: "NOT_READY" };
    // Своя метка прогона: «Контроль» режет ленту по `run.*` — нарушение не приклеится к прогону последнего сюжета.
    this.#step("run.fault", { test });
    const running: Promise<void> = this.#run(test, branch)
      .catch(() => undefined)
      .finally(() => {
        if (this.#running === running) this.#running = null;
      });
    this.#running = running;
    return { ok: true };
  }

  /** Дождаться текущего нарушения (для тестов). */
  async settled(): Promise<void> {
    await this.#running;
  }

  /** Остановить драйвер: новых нарушений нет (CLOSED), запросы ветки после закрытия не уходят, идущее — не дольше
   *  срока; после срока драйвер свободен. */
  async close(): Promise<void> {
    this.#ac.abort();
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([this.#running, new Promise<void>((ok) => (timer = setTimeout(ok, this.#closeWaitMs)))]);
    clearTimeout(timer);
    this.#running = null;
  }

  async #run(test: FaultTest, branch: FaultBranch): Promise<void> {
    // Сигнал ветки: закрывается закрытием драйвера, остановкой ветки драйвером и её концом. Запросы, уже ушедшие,
    // доходят до ответа (их ждёт итог); новые не уходят.
    const run = new AbortController();
    const signal = AbortSignal.any([this.#ac.signal, run.signal]);
    const journal: Promise<Entry>[] = [];
    let marked: DemoIds | undefined;
    let stop: StopCode | undefined;
    const halt = (code: StopCode): FaultStop => {
      stop ??= code;
      run.abort();
      return new FaultStop(code);
    };
    /** Можно ли отправить запрос: ветка идёт, драйвер не закрыт, пометка стоит. Иначе — причина, запрос не уходит. */
    const gate = (): FaultStop | undefined => (signal.aborted ? new FaultStop("CLOSED") : !marked ? halt("NOT_MARKED") : undefined);

    const mark = (ids: DemoIds): void => {
      if (signal.aborted) throw new FaultStop("CLOSED");
      // Форма до стенда (повторное № 6): хотя бы один идентификатор, все — по форме; иначе пометка на стенде и итог на
      // шине разошлись бы, а пустая пометка открыла бы защёлку.
      const entries = Object.entries(ids).filter(([, v]) => v !== undefined);
      if (entries.length === 0 || entries.some(([k, v]) => !(ID_FIELDS as readonly string[]).includes(k) || typeof v !== "string" || !ID_FORM.test(v))) throw halt("MARK_REJECTED");
      try {
        this.#d.stand.demo!.mark(test, ids);
      } catch (e) {
        throw Object.assign(halt("MARK_REJECTED"), { cause: e });
      }
      marked = { ...ids }; // копия: изменение объекта веткой после пометки не расходится с записью MARKED
    };

    /** Запрос к ПАО: подготовка или нарушение (роль — в журнал; «запрос отправлен» — только у нарушения). */
    const callAs = (violation: boolean) =>
      ((op: Parameters<Pao["call"]>[0], args: Parameters<Pao["call"]>[1]) => {
        const g = gate();
        if (g) return rejected(g);
        if (violation) this.#step("fault.sent", { test });
        const req = this.#pao.call(op, args);
        journal.push(req.then((): Outcome => ({ kind: "ok" }), paoEntry).then((o) => ({ ...o, violation })));
        return req;
      }) as Pao["call"];

    /** Запрос к витрине: подготовка или нарушение. */
    const shopAs =
      (violation: boolean) =>
      (method: "GET" | "POST", target: string, body?: unknown): Promise<ShopReply> => {
        const g = gate();
        if (g) return rejected(g);
        const url = shopUrl(this.#d.urls.merchants, target);
        if (!url) return rejected(halt("BAD_TARGET"));
        if (violation) this.#step("fault.sent", { test });
        const req = this.#shop(method, url, body);
        journal.push(req.then(shopEntry, (): Outcome => ({ kind: "fail", code: "NO_RESPONSE" })).then((o) => ({ ...o, violation })));
        const out = req.then((r) => {
          if (r.status >= 200 && r.status < 300) return r;
          throw new ShopCallError(r.status, formCode((r.body as { code?: unknown } | null)?.code));
        });
        out.catch(() => undefined); // ветка может не дождаться — отказ не уходит необработанным
        return out;
      };
    const call = callAs(false);
    const shop = shopAs(false);

    const step = (s: BranchStep, p: ScenarioStep["params"] = {}): void => {
      if (signal.aborted) return; // после конца ветки, её остановки и закрытия шагов нет
      if (!(BRANCH_STEPS as readonly string[]).includes(s)) throw halt("BAD_STEP");
      this.#step(s, { test, ...safeParams(p) });
    };

    const ctx: FaultContext = {
      call,
      shop,
      violate: { call: callAs(true), shop: shopAs(true) },
      urls: { pao: this.#d.urls.pao, merchants: this.#d.urls.merchants },
      step,
      signal,
      mark,
    };
    let threw = false;
    try {
      await branch.run(ctx);
    } catch {
      threw = true; // что ветка бросила, итог не решает — решает журнал; учитывается только «ветка сломалась»
    } finally {
      run.abort(); // ветка кончилась — новые запросы, пометки и шаги из неё не уходят
    }
    // Итог — только когда пришли ответы на все ушедшие запросы (или не пришли — тогда сбой).
    const entries = await Promise.all(journal);
    if (this.#ac.signal.aborted) return;
    this.#settle(test, branch, marked, stop, threw, entries);
  }

  /** Подписанный запрос к витрине ключом агента — как у ядра: x-agent-code, x-timestamp, x-nonce, подпись; без повторов
   *  и перенаправлений; срок и отмена — у обёртки fetch. Нет ответа — исключение. */
  async #shop(method: "GET" | "POST", url: URL, body: unknown): Promise<ShopReply> {
    const text = body === undefined ? undefined : JSON.stringify(body);
    const headers = {
      ...(text !== undefined && { "content-type": "application/json" }),
      "x-agent-code": this.#d.agentCode,
      "x-timestamp": new Date().toISOString().slice(0, 19) + "Z",
      "x-nonce": randomUUID(),
    };
    const signed = signRequest({ method, path: url.pathname, query: url.search.slice(1), headers, body: text ?? "" }, this.#signer);
    const res = await this.#fetch(url, {
      method,
      headers: signed.headers,
      redirect: "manual",
      ...(text !== undefined && { body: text }),
    });
    const raw = await res.text();
    let parsed: unknown;
    try {
      parsed = raw === "" ? undefined : (JSON.parse(raw) as unknown);
    } catch {
      parsed = undefined;
    }
    return { status: res.status, body: parsed };
  }

  /** Итог по журналу (решения владельца, чат 11.11), по старшинству:
   *  1. ветку остановил драйвер (чужой шаг, адрес вне стенда, запрос без пометки, пометка отклонена) — эта причина;
   *  2. подготовка не удалась (любой ответ не 2xx или сбой) — `PREP_FAILED` со статусом: у подготовки учитывается лишь
   *     сбой — ни её отказ (даже с объявленным кодом), ни её 2xx итогом нарушения не считаются (повторное № 1);
   *  3. в ответе **нарушающего** запроса — объявленная пара «код + статус» — `fault.refused` «защита сработала»;
   *  4. сбой нарушающего запроса (нет ответа, 5xx, перенаправление, отказ клиента ПАО, код не по форме, без кода);
   *  5. отказ нарушающего запроса с необъявленной парой — `UNEXPECTED_<код>`;
   *  6. ветка сломалась сама — `BRANCH_ERROR`;
   *  7. ответ 2xx на нарушающий запрос — `fault.marked` «совершено и помечено»; нарушение не отправлено — `NOT_SENT`.
   *  Без пометки — `fault.failed` «не помечено» с настоящей причиной; с пометкой — `fault.unplayed` «помечено, но не
   *  разыграно» с причиной и идентификаторами. */
  #settle(test: FaultTest, branch: FaultBranch, marked: DemoIds | undefined, stop: StopCode | undefined, threw: boolean, entries: readonly Entry[]): void {
    const ids = marked ? pick(marked) : {};
    const unplayed = (code: string, status?: number) =>
      this.#step(marked ? "fault.unplayed" : "fault.failed", { test, code, ...(status !== undefined && { status }), ...ids });
    if (stop) return unplayed(stop);
    if (!marked) return unplayed(threw ? "BRANCH_ERROR" : "NOT_MARKED");
    const prepFailed = entries.find((e) => !e.violation && e.kind !== "ok");
    if (prepFailed) return unplayed("PREP_FAILED", prepFailed.kind === "ok" ? undefined : prepFailed.status);
    const v = entries.filter((e) => e.violation);
    const hit = v.find((e) => e.kind === "refused" && branch.expect.some((g) => g.code === e.code && g.status === e.status));
    if (hit && hit.kind === "refused") return this.#step("fault.refused", { test, code: hit.code, status: hit.status, ...ids });
    const fail = v.find((e) => e.kind === "fail");
    if (fail && fail.kind === "fail") return unplayed(fail.code, fail.status);
    const other = v.find((e) => e.kind === "refused");
    if (other && other.kind === "refused") return unplayed(`UNEXPECTED_${other.code}`, other.status);
    if (threw) return unplayed("BRANCH_ERROR");
    if (v.some((e) => e.kind === "ok")) return this.#step("fault.marked", { test, ...ids });
    return unplayed("NOT_SENT");
  }

  #step(step: string, params: ScenarioStep["params"] = {}): void {
    this.#emit({ step, params });
  }
}

/** Запись журнала по отказу клиента ПАО: отказ клиента до сети, нет ответа, 5xx — сбой; 4xx — отказ с кодом по форме. */
function paoEntry(e: unknown): Outcome {
  if (!(e instanceof PaoCallError)) return { kind: "fail", code: "NO_RESPONSE" };
  if (e.clientCode !== undefined) return { kind: "fail", code: e.clientCode };
  if (e.status === 0) return { kind: "fail", code: "NO_RESPONSE" };
  const code = formCode(e.code);
  if (e.status >= 500) return { kind: "fail", code: code ?? "SERVER_ERROR", status: e.status };
  if (code === undefined) return { kind: "fail", code: e.code === undefined ? "NO_CODE" : "MALFORMED_CODE", status: e.status };
  return { kind: "refused", code, status: e.status };
}

/** Запись журнала по ответу витрины: 2xx — ответ; 3xx — перенаправление (сбой, как у клиента ПАО); 5xx — сбой; 4xx — отказ
 *  с кодом по форме (без кода или не по форме — сбой). */
function shopEntry(r: ShopReply): Outcome {
  if (r.status >= 200 && r.status < 300) return { kind: "ok" };
  if (r.status >= 300 && r.status < 400) return { kind: "fail", code: "REDIRECT", status: r.status };
  const raw = (r.body as { code?: unknown } | null)?.code;
  const code = formCode(raw);
  if (r.status >= 500) return { kind: "fail", code: code ?? "SERVER_ERROR", status: r.status };
  if (code === undefined) return { kind: "fail", code: raw === undefined ? "NO_CODE" : "MALFORMED_CODE", status: r.status };
  return { kind: "refused", code, status: r.status };
}

/** Адрес запроса к витрине — только на витрины стенда (П7 п. 5): путь начинается с одного `/`, без `#`, `\`, `@` и
 *  управляющих знаков, и после разбора источник тот же, что у витрин стенда. Иначе — нет адреса. */
function shopUrl(base: string, target: string): URL | undefined {
  const control = [...target].some((ch) => ch.charCodeAt(0) < 0x20 || ch.charCodeAt(0) === 0x7f);
  if (!target.startsWith("/") || target.startsWith("//") || /[#\\@\s]/.test(target) || control) return undefined;
  let url: URL;
  try {
    url = new URL(target, base);
  } catch {
    return undefined;
  }
  return url.origin === new URL(base).origin && url.hash === "" && url.username === "" && url.password === "" ? url : undefined;
}

/** Параметры шага ветки: только код, статус и идентификаторы стенда — и только по форме (инвариант 1). */
function safeParams(p: ScenarioStep["params"]): ScenarioStep["params"] {
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(p)) {
    if (k === "code" && typeof v === "string" && CODE_FORM.test(v)) out.code = v;
    else if (k === "status" && typeof v === "number" && Number.isInteger(v) && v >= 100 && v <= 599) out.status = v;
    else if ((ID_FIELDS as readonly string[]).includes(k) && typeof v === "string" && ID_FORM.test(v)) out[k] = v;
  }
  return out;
}

/** Идентификаторы пометки — в шаг шины (все поля стенда), по форме. */
function pick(ids: DemoIds): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of ID_FIELDS) {
    const v = ids[k];
    if (typeof v === "string" && ID_FORM.test(v)) out[k] = v;
  }
  return out;
}
