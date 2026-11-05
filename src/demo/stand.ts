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
  /** Обращения к витринам эмулятора: метод, путь без строки запроса, статус, код при 4xx и 5xx. Тел нет (инвариант 1).
   *  Живой массив без копии: шина читает его по индексу. */
  merchantCalls(): readonly CallRecord[];
  /** keyid ключей нашего агента: созданный при старте и те, что реестр вернул при допуске. По нему монитор отличает
   *  обращение агента от прочих. Подпись проверяет Платформа или витрина, а не монитор. */
  isAgentKid(kid: string): boolean;
  close(): Promise<void>;
}

/** Журнал обращений к витринам — по образцу stand.calls() Платформы. Хук ставится до listen. Из тела ответа берётся
 *  только поле code и только при 4xx и 5xx. */
function recordCalls(app: MerchantsStand["app"], out: CallRecord[]): void {
  app.addHook("onSend", async (req, reply, payload) => {
    let code: string | undefined;
    if (reply.statusCode >= 400 && typeof payload === "string") {
      try {
        const c = (JSON.parse(payload) as { code?: unknown } | null)?.code;
        if (typeof c === "string") code = c;
      } catch {
        // тело не JSON — кода нет
      }
    }
    // keyid из заголовка, как прислал клиент: подпись здесь не проверяется. Монитор сверяет его с ключами нашего агента
    // (isAgentKid); в ленту keyid не идёт.
    const sig = req.headers["signature-input"];
    const kid = typeof sig === "string" ? /;keyid="([^"]+)"/.exec(sig)?.[1] : undefined;
    out.push({
      method: req.method,
      path: req.url.split("?")[0] ?? "",
      status: reply.statusCode,
      source: "network",
      ...(code !== undefined && { code }),
      ...(kid !== undefined && { kid }),
    });
    return payload;
  });
}

/** Параметры агента берутся из его пакета. Свой файл параметров приложение не заводит: значения принадлежат ядру. */
function agentParamsPath(): string {
  return createRequire(import.meta.url).resolve("agentic-buyer-ref/config/params.stand.json");
}

export async function startDemoStand(o: { lang?: Lang } = {}): Promise<DemoStand> {
  const fixture = AGENT_FIXTURES.find((f) => f.registered && f.class === "BUYER");
  if (!fixture) throw new Error("в AGENT_FIXTURES нет зарегистрированного агента BUYER");

  const journal = new MemoryJournal();
  const merchantCalls: CallRecord[] = [];
  const dirs: string[] = [];
  let stand: Stand | undefined;
  let merchants: MerchantsStand | undefined;
  let agent: AgentCore | undefined;
  const release = async () => {
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

    const s = createStand();
    stand = s;
    merchants = createMerchants(s, {
      decide: async (msg) => {
        const op_ref = (msg as { op_ref?: unknown }).op_ref;
        const res = await s.app.inject({ method: "POST", url: "/adp/v1/decide", payload: msg });
        const d = res.json() as { decision?: string; reason?: string };
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
      merchantCalls: () => merchantCalls,
      isAgentKid: (kid) => agentKids.has(kid),
      close: release,
    };
  } catch (e) {
    // Сбой освобождения не заменяет причину сбоя запуска.
    await release().catch((r: unknown) => console.error(t(o.lang ?? "ru", "cli.release_failed"), r));
    throw e;
  }
}
