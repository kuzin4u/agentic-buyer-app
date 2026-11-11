// Драйвер нарушителя «ПР» демо-стенда (П7, П-11.3): нарушения агента, которые эталонное ядро не совершает (Н-01, Н-05 ПР,
// Н-06…Н-09 «Задания на тестирование пульта» v1.0), разыгрывает приложение ключом своего агента и помечает каждое на
// стенде (`stand.demo.mark`, ответ Платформы по #112 п. 3–4). Решений здесь нет: драйвер — нарушитель, защиту дают
// Платформа и витрины кодами из таблицы п. 4 ответа #112.
//  - Только при `DEMO_FAULTS=1`: без флага экземпляр не создаётся и ключ не загружается (конструктор отказывает).
//  - Ключ агента загружается функцией ядра `loadKey` из каталога ключей демо-стенда и живёт только в памяти экземпляра:
//    на шину, в журнал, в ответы маршрута и на диск не попадает (П7 п. 5).
//  - Импортирует драйвер только сборка демо-стенда (`run.ts`) и автотесты; пульт и дашборды — нет (тест графа импортов).
import type { Signer } from "@kuzin4u/agentic-core";
import { PaoClient } from "@kuzin4u/agentic-core/pao";
import type { DemoIds } from "agentic-ps-platform/stand";
import { listKeys, loadKey } from "agentic-buyer-ref/src/agent/signer/index.js";
import type { FaultStart, FaultTest } from "./fault-tests.js";
import type { ScenarioStep, StepSink } from "./scenarios.js";
import type { DemoStand } from "./stand.js";

export { FAULT_TESTS, isFaultTest, type FaultStart, type FaultTest } from "./fault-tests.js";

/** Что ветка сообщает драйверу: идентификаторы для пометки на стенде и код защиты, которым её остановили. */
export interface FaultOutcome {
  readonly ids: DemoIds;
  /** Код защиты Платформы или витрины (п. 4 ответа #112); нет — защиты в таблице нет (Н-05 ПР). */
  readonly code?: string;
  readonly status?: number;
}

/** Что ветка получает: подписанный клиент ПАО ключом агента, стенд, шаги на шину, сигнал отмены. */
export interface FaultContext {
  readonly pao: PaoClient<{ baseUrl: string; agentCode: string; signer: Signer; maxAttempts: number }>;
  readonly stand: DemoStand;
  readonly step: (step: string, params?: ScenarioStep["params"]) => void;
  readonly signal: AbortSignal;
}

export type FaultBranch = (c: FaultContext) => Promise<FaultOutcome>;

/** Ветки по тестам — кирпичами П-11.3б–д. Нет ветки — запуск NOT_READY. */
const BRANCHES: Partial<Record<FaultTest, FaultBranch>> = {};

export class FaultyDriver {
  readonly #d: DemoStand;
  readonly #emit: StepSink;
  readonly #pao: FaultContext["pao"];
  readonly #branches: Partial<Record<FaultTest, FaultBranch>>;
  readonly #ac = new AbortController();
  #running: Promise<void> | null = null;

  constructor(d: DemoStand, emit: StepSink, branches: Partial<Record<FaultTest, FaultBranch>> = BRANCHES) {
    // Без режима сбоев драйвера нет (П7 п. 2): ни ключа, ни клиента.
    if (!d.faults || d.keysDir === undefined || d.stand.demo === undefined) throw new Error("драйвер нарушителя — только при DEMO_FAULTS=1 (П7)");
    const active = listKeys(d.keysDir).filter((k) => k.state === "active" && d.isAgentKid(k.kid));
    if (active.length !== 1) throw new Error(`ключ агента приложения: действующих ${active.length}, нужен один (П7)`);
    const { signer } = loadKey(d.keysDir, active[0]!.kid);
    // Одна попытка: нарушитель не повторяет — код защиты нужен как есть.
    this.#pao = new PaoClient({ baseUrl: d.urls.pao, agentCode: d.agentCode, signer, maxAttempts: 1 });
    this.#d = d;
    this.#emit = emit;
    this.#branches = branches;
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
    if (this.#running) return { ok: false, code: "BUSY" };
    const branch = Object.hasOwn(this.#branches, test) ? this.#branches[test] : undefined;
    if (!branch) return { ok: false, code: "NOT_READY" };
    this.#step("fault.start", { test });
    this.#running = this.#run(test, branch).finally(() => {
      this.#running = null;
    });
    return { ok: true };
  }

  /** Дождаться текущего нарушения (для тестов). */
  async settled(): Promise<void> {
    await this.#running;
  }

  /** Сверка подписи драйвера: `GET /pao/v1/agent` ключом агента — статус агента у Платформы (для теста каркаса). */
  async self(): Promise<string> {
    const r = await this.#pao.call("GET /pao/v1/agent", {});
    return r.status ?? "UNKNOWN";
  }

  async close(): Promise<void> {
    this.#ac.abort();
    await this.#running;
  }

  async #run(test: FaultTest, branch: FaultBranch): Promise<void> {
    let out: FaultOutcome;
    try {
      out = await branch({ pao: this.#pao, stand: this.#d, step: (s, p) => this.#step(s, { test, ...p }), signal: this.#ac.signal });
    } catch (e) {
      if (this.#ac.signal.aborted) return;
      const code = (e as { code?: unknown } | null)?.code;
      this.#step("fault.failed", { test, code: typeof code === "string" ? code : "UNKNOWN" });
      return;
    }
    if (this.#ac.signal.aborted) return;
    // Пометка «ПР» на стенде (П7 п. 4): запись MARKED в журнале режима — то, по чему пульт отличит нарушение драйвера.
    this.#d.stand.demo!.mark(test, out.ids);
    this.#step(out.code !== undefined ? "fault.refused" : "fault.marked", {
      test,
      ...(out.code !== undefined && { code: out.code }),
      ...(out.status !== undefined && { status: out.status }),
      ...pick(out.ids),
    });
  }

  #step(step: string, params: ScenarioStep["params"] = {}): void {
    this.#emit({ step, params });
  }
}

/** Идентификаторы пометки — в шаг шины (те же поля, что пульт и дашборды принимают). */
function pick(ids: DemoIds): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of ["mandate_id", "op_ref", "merchant_id", "order_id"] as const) {
    const v = ids[k];
    if (typeof v === "string") out[k] = v;
  }
  return out;
}
