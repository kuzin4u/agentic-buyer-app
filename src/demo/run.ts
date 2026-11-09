// Сборка демо-стенда целиком (П2): стенд и агент, шина монитора, сюжеты, сервер экранов. Общая для npm run demo и тестов.
import { LOCAL_STAND_EMULATED } from "../dashboards/interpret.js";
import { MonitorBus } from "./bus.js";
import { loadSituationTitles } from "./situations.js";
import { buildDiagSnapshot } from "./diag.js";
import { t, type Lang } from "./i18n.js";
import { DEMO_PRINCIPAL, DemoScenarios, INTENT_CARD, INTENT_CARD_UPK } from "./scenarios.js";
import { startMonitorServer, type MonitorServer } from "./server.js";
import { TRAINING_MERCHANTS } from "./shops.js";
import { startDemoStand, type DemoStand } from "./stand.js";

export interface DemoOptions {
  brandPath?: string;
  lang?: Lang;
  port?: number;
  /** Период фоновых проходов стенда; 0 — без проходов (тесты без сюжетов отказа). */
  passMs?: number;
}

export interface Demo {
  readonly stand: DemoStand;
  readonly bus: MonitorBus;
  readonly scenarios: DemoScenarios;
  readonly monitor: MonitorServer;
  close(): Promise<void>;
}

export const DEFAULT_BRAND_PATH = "config/brand.demo.json";

export async function startDemo(o: DemoOptions = {}): Promise<Demo> {
  const stand = await startDemoStand({ ...(o.lang && { lang: o.lang }), ...(o.passMs !== undefined && { passMs: o.passMs }) });
  let bus: MonitorBus | undefined;
  let scenarios: DemoScenarios | undefined;
  try {
    // Сюжеты пишут шаги в шину; шина берёт у сюжетов сумму операции для строки итога. Связь — через замыкания.
    const sc = new DemoScenarios(stand, (s) => bus?.scenario(s));
    scenarios = sc;
    const b = new MonitorBus({
      calls: () => stand.stand.calls(),
      merchantCalls: () => stand.merchantCalls(),
      journal: () => stand.journal.entries,
      listenFeed: (l) => stand.agent.events.listen(l),
      isAgentKid: (kid) => stand.isAgentKid(kid),
      confirmation: (id) => stand.stand.confirmations.get(id),
      // Сумма — только у ядра (операция после события или, на отказе, итог корзины CART). Код отказа — из ответа ADP стенда,
      // чей предел — из уведомления банку (ПИ-8). Со слов продавца — ничего (ревью К2.2б № 1–2; дополнение 2 к П2).
      operation: async (opRef) => {
        const info = await sc.operationInfo(opRef);
        const d = stand.adpDecision(opRef);
        const declineReason = d?.decision === "DECLINE" ? d.reason : info?.declineReason;
        const limitSource = declineReason === "LIMIT_EXCEEDED" ? await stand.limitSource(opRef) : undefined;
        return { ...(info?.amount && { amount: info.amount }), ...(declineReason && { declineReason }), ...(limitSource && { limitSource }) };
      },
      now: () => stand.stand.now(),
    });
    bus = b;
    b.start();
    const monitor = await startMonitorServer({
      bus: b,
      urls: stand.urls,
      agentCode: stand.agentCode,
      brandPath: o.brandPath ?? DEFAULT_BRAND_PATH,
      scenarios: sc,
      intentCard: INTENT_CARD,
      intentCardUpk: INTENT_CARD_UPK,
      // Одноразовая ссылка входа клиента банка стенда: банк его уже опознал (эмулятор), подпись — на экране банка.
      bankLogin: () => `${stand.urls.bankApp}${stand.stand.bankApp.session(DEMO_PRINCIPAL)}`,
      // Реестры диагностики импортирует сборка контура; экраны DEMO-2 видят только снимок (Р-1246 п. 3, Р-1273 п. 3).
      diag: buildDiagSnapshot(),
      // Экран «Интерпретация» (К1.4): на локальном стенде эмуляторы — банк и продавцы (П2 п. 2).
      // Учебные витрины — по поведению витрины фикстуры стенда (З10): их учебные сбои — так задумано.
      // Часы «Контроля» — те же, что у шины (К2.3б): срок ожидания и время вердикта.
      dashboards: { emulated: LOCAL_STAND_EMULATED, situations: loadSituationTitles(), training: TRAINING_MERCHANTS, now: () => stand.stand.now() },
      ...(o.lang && { defaultLang: o.lang }),
      ...(o.port !== undefined && { port: o.port }),
    });
    return {
      stand,
      bus: b,
      scenarios: sc,
      monitor,
      close: async () => {
        await sc.close().catch(() => undefined);
        b.stop();
        try {
          await monitor.close();
        } finally {
          await stand.close();
        }
      },
    };
  } catch (e) {
    await scenarios?.close().catch(() => undefined);
    bus?.stop();
    await stand.close().catch((r: unknown) => console.error(t(o.lang ?? "ru", "cli.release_failed"), r));
    throw e;
  }
}
