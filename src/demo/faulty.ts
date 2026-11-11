// Драйвер нарушителя «ПР» демо-стенда (П7, П-11.3): нарушения агента, которые эталонное ядро не совершает (Н-01, Н-05 ПР,
// Н-06…Н-09 «Задания на тестирование пульта» v1.0), разыгрывает приложение ключом своего агента и помечает каждое на
// стенде (`stand.demo.mark`, ответ Платформы по #112 п. 3–4). Решений здесь нет: драйвер — нарушитель, защиту дают
// Платформа и витрины кодами из таблицы п. 4 ответа #112.
//  - Только при `DEMO_FAULTS=1`: без флага экземпляр не создаётся и ключ не загружается (конструктор отказывает).
//  - Ключ агента загружается функцией ядра `loadKey` из каталога ключей демо-стенда и живёт только в памяти экземпляра:
//    на шину, в журнал, в ответы маршрута и на диск не попадает (П7 п. 5).
//  - Свой подписанный клиент ПАО, не порт ядра — исключение из правила совместимости 1 (П7, дополнение 1).
//  - Импортирует драйвер только сборка демо-стенда (`run.ts`) и автотесты; пульт и дашборды — нет (тест графа импортов).
// Договор ветки (ревью П-11.3а-1 № 2, 3, 7): запрос ключом агента уходит только после пометки «ПР» и до закрытия
// (`c.call`); «защита сработала» — только объявленный веткой код защиты; на шину — только тест, код, статус и
// идентификаторы стенда.
import type { Signer } from "@kuzin4u/agentic-core";
import { PaoCallError, PaoClient } from "@kuzin4u/agentic-core/pao";
import type { DemoIds } from "agentic-ps-platform/stand";
import { listKeys, loadKey } from "agentic-buyer-ref/src/agent/signer/index.js";
import type { FaultStart, FaultTest } from "./fault-tests.js";
import type { ScenarioStep, StepSink } from "./scenarios.js";
import type { DemoStand } from "./stand.js";

export { FAULT_TESTS, isFaultTest, type FaultStart, type FaultTest } from "./fault-tests.js";

type Pao = PaoClient<{ baseUrl: string; agentCode: string; signer: Signer; maxAttempts: number }>;

/** Идентификаторы пометки стенда (`DEMO_ID_FIELDS` Платформы, РП75 п. 4; в пакете не экспортируются — список сверяется
 *  с типом `DemoIds`: лишнее поле — ошибка компиляции, недостающее — тест). Только они идут на шину из ветки. */
export const ID_FIELDS = ["mandate_id", "confirmation_id", "op_ref", "merchant_id", "shop_id", "order_id", "order_ref"] as const satisfies readonly (keyof DemoIds)[];

/** Чем ветка закончилась без исключения: код защиты витрины (ответ не через клиент ПАО) или ничего — нарушение совершено,
 *  защиты в таблице нет (Н-05 ПР). Отказ Платформы ветка не ловит: `PaoCallError` разбирает драйвер. */
export interface FaultOutcome {
  readonly code?: string;
  readonly status?: number;
}

/** Что ветка получает. Стенд — только адреса и проверка ключа: ни эмулятора банка (подпись и подтверждение за клиента —
 *  только эмулятор клиента, П5 п. 5), ни каталога ключей (ревью П-11.3а № 10). */
export interface FaultContext {
  /** Запрос к ПАО ключом агента — только после `mark` и до закрытия; иначе — исключение, запрос не уходит. */
  readonly call: Pao["call"];
  readonly stand: Pick<DemoStand, "urls" | "agentCode" | "isAgentKid">;
  /** Шаг на шину: параметры — только `code`, `status` и идентификаторы стенда; прочее отбрасывается (инвариант 1). */
  readonly step: (step: string, params?: ScenarioStep["params"]) => void;
  readonly signal: AbortSignal;
  /** Пометка «ПР» на стенде — **до** нарушающего запроса (П7 п. 4). Отказ стенда — исключение, ветка дальше не идёт. */
  readonly mark: (ids: DemoIds) => void;
}

/** Ветка нарушения: ожидаемые коды защиты (таблица п. 4 ответа #112) и ход. Иной отказ — не «защита сработала». */
export interface FaultBranch {
  readonly expect: readonly string[];
  readonly run: (c: FaultContext) => Promise<FaultOutcome>;
}

/** Ветки по тестам — кирпичами П-11.3б–д. Нет ветки — запуск NOT_READY. */
const BRANCHES: Partial<Record<FaultTest, FaultBranch>> = {};

/** Сколько закрытие ждёт идущую ветку (как у сюжетов): ответ стенда без таймаута не вешает остановку демо. */
const CLOSE_WAIT_MS = 3000;

export interface FaultyOptions {
  readonly branches?: Partial<Record<FaultTest, FaultBranch>>;
  /** Идёт ли сюжет: нарушитель ходит тем же ключом агента — одновременно с сюжетом не стартует (ревью П-11.3а № 4). */
  readonly otherBusy?: () => boolean;
  /** Срок ожидания ветки при закрытии, мс (по умолчанию CLOSE_WAIT_MS). */
  readonly closeWaitMs?: number;
}

/** Остановка ветки до запроса: без пометки или после закрытия. */
class FaultStop extends Error {
  constructor(readonly code: "NOT_MARKED" | "CLOSED" | "MARK_REJECTED", options?: { cause?: unknown }) {
    super(code, options);
  }
}

export class FaultyDriver {
  readonly #d: DemoStand;
  readonly #emit: StepSink;
  readonly #pao: Pao;
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
    // Одна попытка: нарушитель не повторяет — код защиты нужен как есть.
    this.#pao = new PaoClient({ baseUrl: d.urls.pao, agentCode: d.agentCode, signer, maxAttempts: 1 });
    this.#d = d;
    this.#emit = emit;
    this.#branches = o.branches ?? BRANCHES;
    this.#otherBusy = o.otherBusy ?? (() => false);
    this.#closeWaitMs = o.closeWaitMs ?? CLOSE_WAIT_MS;
  }

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
    // Своя метка прогона (ревью П-11.3а № 3): «Контроль» режет ленту по `run.*` — нарушение не приклеится к прогону
    // последнего сюжета; паспорта у прогона нет — показывается, не сверяется.
    this.#step("run.fault", { test });
    // Отклонение не уходит наружу необработанным: ветка и шаги — внутри #run, здесь — страховка (ревью № 1).
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
   *  срока; после срока драйвер свободен (ревью П-11.3а № 6, № 11; П-11.3а-1 № 8). */
  async close(): Promise<void> {
    this.#ac.abort();
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([this.#running, new Promise<void>((ok) => (timer = setTimeout(ok, this.#closeWaitMs)))]);
    clearTimeout(timer);
    this.#running = null;
  }

  async #run(test: FaultTest, branch: FaultBranch): Promise<void> {
    const signal = this.#ac.signal;
    let marked: DemoIds | undefined;
    const mark = (ids: DemoIds): void => {
      if (signal.aborted) throw new FaultStop("CLOSED");
      try {
        this.#d.stand.demo!.mark(test, ids);
      } catch (e) {
        // Стенд не принял пометку (ids вне перечня или пустые) — нарушение не разыгрывается: ветка дальше не идёт.
        throw new FaultStop("MARK_REJECTED", { cause: e });
      }
      marked = ids;
    };
    // Защёлка (ревью П-11.3а-1 № 2, № 8): без пометки или после закрытия запрос ключом агента не уходит.
    const call = ((op: Parameters<Pao["call"]>[0], args: Parameters<Pao["call"]>[1]) => {
      if (signal.aborted) return Promise.reject(new FaultStop("CLOSED"));
      if (!marked) return Promise.reject(new FaultStop("NOT_MARKED"));
      return this.#pao.call(op, args);
    }) as Pao["call"];
    const { urls, agentCode, isAgentKid } = this.#d;
    const ctx: FaultContext = {
      call,
      stand: { urls, agentCode, isAgentKid: (kid) => isAgentKid.call(this.#d, kid) },
      step: (s, p = {}) => this.#step(s, { test, ...safeParams(p) }),
      signal,
      mark,
    };
    let out: FaultOutcome;
    try {
      out = await branch.run(ctx);
    } catch (e) {
      if (signal.aborted) return;
      this.#settle(test, branch, marked, refusalOf(e));
      return;
    }
    if (signal.aborted) return;
    this.#settle(test, branch, marked, out.code !== undefined ? { code: out.code, ...(out.status !== undefined && { status: out.status }) } : undefined);
  }

  /** Итог ветки. «Защита сработала» — только объявленный веткой код при поставленной пометке (ревью П-11.3а-1 № 3);
   *  иной код — «не разыграно» `UNEXPECTED_<код>`; без пометки — `NOT_MARKED`; без кода — «совершено и помечено». */
  #settle(test: FaultTest, branch: FaultBranch, marked: DemoIds | undefined, r: Refusal | undefined): void {
    if (r?.failed) return this.#step("fault.failed", { test, code: r.code });
    if (!marked) return this.#step("fault.failed", { test, code: "NOT_MARKED" });
    if (r === undefined) return this.#step("fault.marked", { test, ...pick(marked) });
    if (!branch.expect.includes(r.code)) return this.#step("fault.failed", { test, code: `UNEXPECTED_${r.code}`, ...(r.status !== undefined && { status: r.status }) });
    this.#step("fault.refused", { test, code: r.code, ...(r.status !== undefined && { status: r.status }), ...pick(marked) });
  }

  #step(step: string, params: ScenarioStep["params"] = {}): void {
    this.#emit({ step, params });
  }
}

/** Отказ: `failed` — запрос не ушёл, сломался или ответ — не защита (клиент ПАО отказал сам, 5xx, нет ответа). */
interface Refusal {
  readonly code: string;
  readonly status?: number;
  readonly failed?: true;
}

function refusalOf(e: unknown): Refusal {
  if (e instanceof FaultStop) return { code: e.code, failed: true };
  if (e instanceof PaoCallError) {
    if (e.clientCode !== undefined) return { code: e.clientCode, failed: true };
    if (e.status === 0) return { code: "NO_RESPONSE", failed: true };
    if (e.status >= 500) return { code: e.code ?? `HTTP_${e.status}`, status: e.status, failed: true };
    return { code: e.code ?? `HTTP_${e.status}`, status: e.status };
  }
  const code = (e as { code?: unknown } | null)?.code;
  return { code: typeof code === "string" ? code : "UNKNOWN", failed: true };
}

/** Параметры шага ветки: только код, статус и идентификаторы стенда (ревью П-11.3а-1 № 7; инвариант 1). */
function safeParams(p: ScenarioStep["params"]): ScenarioStep["params"] {
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(p)) {
    if (k === "code" && typeof v === "string") out.code = v;
    else if (k === "status" && typeof v === "number") out.status = v;
    else if ((ID_FIELDS as readonly string[]).includes(k) && typeof v === "string") out[k] = v;
  }
  return out;
}

/** Идентификаторы пометки — в шаг шины (ревью П-11.3а-1 № 10: все поля стенда). */
function pick(ids: DemoIds): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of ID_FIELDS) {
    const v = ids[k];
    if (typeof v === "string") out[k] = v;
  }
  return out;
}
