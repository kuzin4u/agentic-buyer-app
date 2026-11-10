// Демо-стенд (П2): стенд Платформы и настоящий агент в одном процессе, только 127.0.0.1.
//
// Стенд Платформы (createStand) включает эмуляторы банка, токен-сервиса и эквайрера, экран мандатов банка (UI-К2) и
// страницу УПК. Витрины продавцов поднимает эмулятор createMerchants. Агент собирается через createAgentCore ядра
// agentic-buyer-ref и проходит допуск по фикстуре агента Платформы.
//
// Решение ОПКЦ — асинхронное (РП72 п. 10): сообщение эквайрера уходит в настоящий ADP стенда (POST /adp/v1/decide).
// Ответ продавцу (PAID, AWAITING_CONFIRMATION, DECLINED) зависит от решения ADP, без подмены. Это сборка стенда, а не
// решение приложения (инвариант 2): приложение ответ ADP только передаёт дальше.
//
// Обход до kuzin4u/agentic-buyer-ref#105 (П2 п. 4): у пакета агента нет exports, поэтому импортируются внутренние пути
// src/… Это не контракт. Обход снимается кирпичом, который поднимет коммит агента.
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AGENT_FIXTURES, agentApplication } from "agentic-ps-platform/fixtures";
import { createMerchants, createStand, type MerchantsStand, type Stand } from "agentic-ps-platform/stand";
import { createAgentCore, type AgentCore } from "agentic-buyer-ref/src/agent/compose.js";
import { MemoryJournal } from "agentic-buyer-ref/src/agent/journal/index.js";
import { generateKey } from "agentic-buyer-ref/src/agent/signer/index.js";
import type { CallRecord } from "./bus.js";
import { DEMO_SHOPS } from "./shops.js";
import { t, type Lang } from "./i18n.js";

/** Адреса экранов и служб демо-стенда. Все на 127.0.0.1. */
export interface DemoUrls {
  /** ПАО стенда: к нему обращается агент. */
  readonly pao: string;
  /** Эмулятор витрин продавцов. */
  readonly merchants: string;
  /** Экран мандатов в приложении банка стенда (UI-К2, эмулятор банка). */
  readonly bankApp: string;
  /** Страница УПК (эмулятор УПК). */
  readonly upk: string;
}

export interface DemoStand {
  readonly stand: Stand;
  readonly merchants: MerchantsStand;
  readonly agent: AgentCore;
  /** Журнал ядра агента: его читает консоль агента. */
  readonly journal: MemoryJournal;
  readonly agentCode: string;
  readonly urls: DemoUrls;
  /** Режим сбоев стенда включён (`demo: { faults: true }`, П-1.3): прогон тестов пульта, срок подтверждения 45 с. */
  readonly faults: boolean;
  /** Обращения к витринам эмулятора: метод, путь без строки запроса, статус, код при 4xx и 5xx. Тел нет (инвариант 1).
   *  Живой массив без копии: шина читает его по индексу. */
  merchantCalls(): readonly CallRecord[];
  /** keyid ключей нашего агента: созданный при старте и те, что реестр вернул при допуске. По нему монитор отличает
   *  обращение агента от прочих. Подпись проверяет Платформа или витрина, а не монитор. */
  isAgentKid(kid: string): boolean;
  /** Решение ADP стенда по операции (ответ на сообщение эквайрера в этой сборке): решение и причина. */
  adpDecision(opRef: string): AdpDecision | undefined;
  /** Чей предел сработал при LIMIT_EXCEEDED — по уведомлению банку client.limit_declined (ПИ-8): CLIENT, MANDATE,
   *  INSTRUMENT; ждёт доставки уведомления фоновым проходом не дольше waitMs. */
  limitSource(opRef: string, waitMs?: number): Promise<string | undefined>;
  close(): Promise<void>;
}

export interface AdpDecision {
  readonly decision: string;
  readonly reason?: string;
}

/** Сколько решений ADP держать для монитора. */
const ADP_KEPT = 200;

/** Журнал обращений к витринам — по образцу stand.calls() Платформы. Хук ставится до listen. Из тела ответа берётся
 *  только поле code и только при 4xx и 5xx. */
function recordCalls(app: MerchantsStand["app"], out: CallRecord[]): void {
  app.addHook("onSend", async (req, reply, payload) => {
    const path = req.url.split("?")[0] ?? "";
    // keyid из заголовка, как прислал клиент: подпись здесь не проверяется. Монитор сверяет его с ключами нашего агента
    // (isAgentKid); в ленту keyid не идёт.
    const sig = req.headers["signature-input"];
    const kid = typeof sig === "string" ? /;keyid="([^"]+)"/.exec(sig)?.[1] : undefined;
    // Неподписанный запрос вне протокола витрин `/v1/…` — страница для человека (`/shops`, `/shops/{id}` — Платформа
    // v0.47.0, З12) или запрос браузера (favicon): не на шину, иначе он «по сети», а 404 и 429 — «конфликт» (ревью П-8.0
    // № 3). Подписанный запрос пишется при любом пути: обращение агента не по протоколу монитор должен показать (ревью
    // П-1.3 № 2).
    if (kid === undefined && !path.startsWith("/v1/") && path !== "/v1") return payload;
    let code: string | undefined;
    if (reply.statusCode >= 400 && typeof payload === "string") {
      try {
        const c = (JSON.parse(payload) as { code?: unknown } | null)?.code;
        if (typeof c === "string") code = c;
      } catch {
        // тело не JSON — кода нет
      }
    }
    out.push({
      method: req.method,
      path,
      status: reply.statusCode,
      source: "network",
      ...(code !== undefined && { code }),
      ...(kid !== undefined && { kid }),
    });
    return payload;
  });
}

/** Период фоновых проходов стенда (только локальный стенд демо). */
const STAND_PASS_MS = 1000;

/** Параметры агента берутся из его пакета. Свой файл параметров приложение не заводит: значения принадлежат ядру. */
function agentParamsPath(): string {
  return createRequire(import.meta.url).resolve("agentic-buyer-ref/config/params.stand.json");
}

/** passMs — период фоновых проходов стенда; 0 — без проходов (тест вызывает их сам). По умолчанию STAND_PASS_MS. */
export async function startDemoStand(o: { lang?: Lang; passMs?: number; faults?: boolean } = {}): Promise<DemoStand> {
  const faults = o.faults === true;
  const fixture = AGENT_FIXTURES.find((f) => f.registered && f.class === "BUYER");
  if (!fixture) throw new Error("в AGENT_FIXTURES нет зарегистрированного агента BUYER");

  const journal = new MemoryJournal();
  const merchantCalls: CallRecord[] = [];
  const adpDecisions = new Map<string, AdpDecision>();
  const dirs: string[] = [];
  let stand: Stand | undefined;
  let merchants: MerchantsStand | undefined;
  let agent: AgentCore | undefined;
  let passes: NodeJS.Timeout | undefined;
  let passing: Promise<void> | null = null;
  const release = async () => {
    clearInterval(passes);
    // Идущий проход — дождаться до закрытия стенда (ревью К2.2а № 5).
    await passing;
    try {
      agent?.close();
    } finally {
      await Promise.allSettled([merchants?.close(), stand?.close()]);
      for (const d of dirs) rmSync(d, { recursive: true, force: true });
    }
  };

  try {
    const keysDir = mkdtempSync(join(tmpdir(), "demo-keys-"));
    dirs.push(keysDir);
    const stateDir = mkdtempSync(join(tmpdir(), "demo-state-"));
    dirs.push(stateDir);

    // Свой набор витрин (стенд v0.41.0, передача #5): «Масса Мадре» с каталогом пекарни на месте SHOP-1042 (Р-1278).
    // Режим сбоев (П-1.3, Р-1355 ответ 1) — только для прогона тестов пульта: сбои Н-02…Н-12 по кнопкам, срок 45 с
    // (ответ Платформы по #112). Без флага стенд — как без режима (показ людям; `{ actions: true }` — П-8.1).
    const s = createStand({ shops: DEMO_SHOPS, ...(faults && { demo: { faults: true } }) });
    stand = s;
    merchants = createMerchants(s, {
      decide: async (msg) => {
        const op_ref = (msg as { op_ref?: unknown }).op_ref;
        const res = await s.app.inject({ method: "POST", url: "/adp/v1/decide", payload: msg });
        const d = res.json() as { decision?: string; reason?: string };
        // Ответ ADP — только решение и причина: для кода в строке события монитора (operation.declined кода не несёт, К2.2б).
        // Сообщение эквайрера не читается вовсе: его составляет эмулятор продавца (ревью К2.2б № 1; инвариант 1).
        if (typeof op_ref === "string" && typeof d.decision === "string") {
          adpDecisions.set(op_ref, { decision: d.decision, ...(typeof d.reason === "string" && { reason: d.reason }) });
          while (adpDecisions.size > ADP_KEPT) adpDecisions.delete(adpDecisions.keys().next().value!);
        }
        if (d.decision === "APPROVE") {
          // Ответ эмитента (ПИ-3) после одобрения ADP имитирует эта сборка стенда, а не эмулятор банка (как в контуре
          // агента, режим adpAsync). Только после APPROVE: отказ или запрос подтверждения ADP одобрением не становится.
          const issuer = await s.app.inject({
            method: "POST",
            url: "/adp/v1/events",
            payload: { op_ref, msg_type: "ISSUER_RESPONSE", issuer_approved: true },
          });
          if (issuer.statusCode !== 202) throw new Error(`ответ эмитента не принят: ${issuer.statusCode}`);
          return { approved: true, reason: null };
        }
        return { approved: false, reason: d.reason ?? d.decision ?? null };
      },
    });

    recordCalls(merchants.app, merchantCalls);

    const { descriptor } = generateKey(keysDir);
    const decision = await s.admit(agentApplication(fixture, { alg: descriptor.alg, public_key: descriptor.public_key }), fixture.operator);
    if (!decision.admitted) throw new Error(`стенд не допустил агента фикстуры: ${JSON.stringify(decision)}`);

    const [pao, merchantsUrl, bankApp, upk] = await Promise.all([s.listen(), merchants.listen(), s.bankApp.listen(), s.upk.listen()]);

    agent = createAgentCore({
      paramsPath: agentParamsPath(),
      keysDir,
      stateDir,
      journal,
      pao: { baseUrl: pao, agentCode: fixture.agent_code },
    });
    const self = await agent.start();

    // Фоновые проходы стенда раз в секунду (Р-1255 п. 4): сборщик итогов операций (operation.declined по отказу ADP вне
    // пути авторизации), уведомления участников и их доставка банку, срок резервов. Своего таймера у стенда нет — проход
    // вызывает тот, кто стенд поднял; в рабочей Платформе это её фоновые задачи. Проходы не накладываются; сбой прохода
    // не роняет стенд — следующий проход повторит.
    // Первая ошибка каждого прохода — в stderr: постоянный сбой (например, итоги не собираются) виден (ревью К2.2а № 6).
    const reported = new Set<string>();
    const PASSES: readonly [string, () => Promise<unknown>][] = [
      ["collectOperationOutcomes", () => s.collectOperationOutcomes()],
      ["notifyParticipants", () => s.notifyParticipants()],
      ["deliverParticipantNotifications", () => s.deliverParticipantNotifications()],
      ["expireReservations", () => s.expireReservations()],
    ];
    const passMs = o.passMs ?? STAND_PASS_MS;
    if (passMs > 0) {
      passes = setInterval(() => {
        if (passing) return;
        passing = (async () => {
          for (const [name, pass] of PASSES) {
            try {
              await pass();
            } catch (e) {
              if (!reported.has(name)) {
                reported.add(name);
                console.error(t(o.lang ?? "ru", "cli.pass_failed"), name, e);
              }
            }
          }
        })().finally(() => {
          passing = null;
        });
      }, passMs);
      passes.unref();
    }
    const agentKids = new Set<string>([descriptor.kid, ...self.keys.map((k) => k.kid)]);

    const a = agent;
    const m = merchants;
    return {
      stand: s,
      merchants: m,
      agent: a,
      journal,
      agentCode: fixture.agent_code,
      urls: { pao, merchants: merchantsUrl, bankApp, upk },
      faults,
      merchantCalls: () => merchantCalls,
      isAgentKid: (kid) => agentKids.has(kid),
      adpDecision: (opRef) => adpDecisions.get(opRef),
      limitSource: async (opRef, waitMs = 3000) => {
        const end = Date.now() + waitMs;
        type Notice = { notification_id?: string; type?: string; data?: { op_ref?: string; reason?: string } };
        for (;;) {
          // Все страницы ленты банка по after (ревью К2.2б, Н5): иначе после сотни уведомлений нужное не найдётся.
          let after: string | undefined;
          for (;;) {
            const r = await s.issuer.getNotifications(after);
            const list = (r.body as { notifications?: Notice[] } | null)?.notifications ?? [];
            const n = list.find((x) => x.type === "client.limit_declined" && x.data?.op_ref === opRef);
            if (n?.data?.reason) return n.data.reason;
            const last = list.at(-1)?.notification_id;
            if (list.length === 0 || last === undefined || last === after) break;
            after = last;
          }
          if (Date.now() > end) return undefined;
          await new Promise((ok) => setTimeout(ok, 200));
        }
      },
      close: release,
    };
  } catch (e) {
    // Сбой освобождения не заменяет причину сбоя запуска.
    await release().catch((r: unknown) => console.error(t(o.lang ?? "ru", "cli.release_failed"), r));
    throw e;
  }
}
