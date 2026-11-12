// Сборка демо-стенда целиком (П2): стенд и агент, шина монитора, сюжеты, сервер экранов. Общая для npm run demo и тестов.
import { LOCAL_STAND_EMULATED } from "../dashboards/interpret.js";
import { MonitorBus } from "./bus.js";
import { ClientEmulator } from "./client-emulator.js";
import { FaultyDriver } from "./faulty.js";
import { loadSituationTitles } from "./situations.js";
import { buildDiagSnapshot } from "./diag.js";
import { t, type Lang } from "./i18n.js";
import { DEMO_PRINCIPAL, DemoScenarios, INTENT_CARD, INTENT_CARD_UPK, moreScenarios } from "./scenarios.js";
import { startMonitorServer, type MonitorServer } from "./server.js";
import { TRAINING_MERCHANTS } from "./shops.js";
import { startDemoStand, type DemoStand } from "./stand.js";

export interface DemoOptions {
  brandPath?: string;
  lang?: Lang;
  port?: number;
  /** Период фоновых проходов стенда; 0 — без проходов (тесты без сюжетов отказа). */
  passMs?: number;
  /** Режим сбоев стенда для прогона тестов пульта (`DEMO_FAULTS=1`, Р-1355 ответ 1, П-1.3): `demo: { faults: true }`,
   *  срок подтверждения 45 с. По умолчанию выключен. Для показа людям не включается. */
  faults?: boolean;
  /** Срок поручения сюжета 10 «срок поручения истёк», секунд (по умолчанию EXPIRY_SEC); короче — для автотестов. */
  expirySec?: number;
}

export interface Demo {
  readonly stand: DemoStand;
  readonly bus: MonitorBus;
  readonly scenarios: DemoScenarios;
  /** Драйвер нарушителя «ПР» — только при режиме сбоев (П7); без флага его нет. */
  readonly faulty?: FaultyDriver;
  /** Эмулятор клиента «Авто» — только при режиме сбоев (П5); без флага его нет. */
  readonly clientEmulator?: ClientEmulator;
  readonly monitor: MonitorServer;
  close(): Promise<void>;
}

export const DEFAULT_BRAND_PATH = "config/brand.demo.json";

export async function startDemo(o: DemoOptions = {}): Promise<Demo> {
  const stand = await startDemoStand({
    ...(o.lang && { lang: o.lang }),
    ...(o.passMs !== undefined && { passMs: o.passMs }),
    ...(o.faults === true && { faults: true }),
  });
  let bus: MonitorBus | undefined;
  let scenarios: DemoScenarios | undefined;
  let driver: FaultyDriver | undefined;
  let emulator: ClientEmulator | undefined;
  try {
    // Сюжеты пишут шаги в шину; шина берёт у сюжетов сумму операции для строки итога. Связь — через замыкания.
    // Сюжет и нарушитель «ПР» — взаимно исключаются (ревью П-11.3а № 4): оба ходят ключом агента.
    const sc = new DemoScenarios(stand, (s) => bus?.scenario(s), {
      ...(o.expirySec !== undefined && { expirySec: o.expirySec }),
      otherBusy: () => driver?.busy ?? false,
    });
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
        return {
          ...(info?.amount && { amount: info.amount }),
          ...(declineReason && { declineReason }),
          ...(limitSource && { limitSource }),
          ...(info?.orderRef && { orderRef: info.orderRef }),
        };
      },
      now: () => stand.stand.now(),
      // Журнал сбоев и действий стенда (П-11.2а, Р-1514) — только при режиме сбоев: без флага потока `stand` нет.
      ...(stand.faults && stand.stand.demo && { standLog: () => stand.stand.demo!.log() }),
    });
    bus = b;
    b.start();
    // Драйвер нарушителя «ПР» (П7): только при режиме сбоев — без флага экземпляр не создаётся и ключ не загружается.
    const faulty = stand.faults ? new FaultyDriver(stand, (s) => b.scenario(s), { otherBusy: () => sc.busy }) : undefined;
    driver = faulty;
    // Эмулятор клиента «Авто» (П5, доп. 1): только при режиме сбоев — без флага экземпляра нет; по умолчанию «Вручную».
    const clientEmulator = stand.faults
      ? new ClientEmulator({ issuer: stand.stand.issuer, answerCart: (agree) => sc.answerCart(agree), subscribe: (fn) => b.subscribe(fn), emit: (s) => b.scenario(s) })
      : undefined;
    emulator = clientEmulator;
    const monitor = await startMonitorServer({
      bus: b,
      urls: stand.urls,
      agentCode: stand.agentCode,
      brandPath: o.brandPath ?? DEFAULT_BRAND_PATH,
      scenarios: sc,
      intentCard: INTENT_CARD,
      intentCardUpk: INTENT_CARD_UPK,
      // Карточка сюжета 10 — с тем же сроком, что у сюжетов (Т3а).
      moreScenarios: moreScenarios(o.expirySec),
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
      faults: stand.faults,
      ...(faulty && { faulty }),
      ...(clientEmulator && { clientEmulator }),
    });
    return {
      stand,
      bus: b,
      scenarios: sc,
      ...(faulty && { faulty }),
      ...(clientEmulator && { clientEmulator }),
      monitor,
      close: async () => {
        await clientEmulator?.close().catch(() => undefined);
        await sc.close().catch(() => undefined);
        await faulty?.close().catch(() => undefined);
        b.stop();
        try {
          await monitor.close();
        } finally {
          await stand.close();
        }
      },
    };
  } catch (e) {
    await emulator?.close().catch(() => undefined);
    await scenarios?.close().catch(() => undefined);
    await driver?.close().catch(() => undefined);
    bus?.stop();
    await stand.close().catch((r: unknown) => console.error(t(o.lang ?? "ru", "cli.release_failed"), r));
    throw e;
  }
}
