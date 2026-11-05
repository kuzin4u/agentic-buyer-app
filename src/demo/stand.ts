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
  close(): Promise<void>;
}

/** Параметры агента берутся из его пакета. Свой файл параметров приложение не заводит: значения принадлежат ядру. */
function agentParamsPath(): string {
  return createRequire(import.meta.url).resolve("agentic-buyer-ref/config/params.stand.json");
}

export async function startDemoStand(): Promise<DemoStand> {
  const fixture = AGENT_FIXTURES.find((f) => f.registered && f.class === "BUYER");
  if (!fixture) throw new Error("в AGENT_FIXTURES нет зарегистрированного агента BUYER");

  const journal = new MemoryJournal();
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
    await agent.start();

    const a = agent;
    const m = merchants;
    return {
      stand: s,
      merchants: m,
      agent: a,
      journal,
      agentCode: fixture.agent_code,
      urls: { pao, merchants: merchantsUrl, bankApp, upk },
      close: release,
    };
  } catch (e) {
    // Сбой освобождения не заменяет причину сбоя запуска.
    await release().catch((r: unknown) => console.error("демо-стенд: ресурсы освобождены не полностью", r));
    throw e;
  }
}
