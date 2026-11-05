// Сборка демо-стенда целиком (П2): стенд и агент, шина монитора, сервер экранов. Общая для npm run demo и тестов.
import { MonitorBus } from "./bus.js";
import { t, type Lang } from "./i18n.js";
import { startMonitorServer, type MonitorServer } from "./server.js";
import { startDemoStand, type DemoStand } from "./stand.js";

export interface DemoOptions {
  brandPath?: string;
  lang?: Lang;
  port?: number;
}

export interface Demo {
  readonly stand: DemoStand;
  readonly bus: MonitorBus;
  readonly monitor: MonitorServer;
  close(): Promise<void>;
}

export const DEFAULT_BRAND_PATH = "config/brand.demo.json";

export async function startDemo(o: DemoOptions = {}): Promise<Demo> {
  const stand = await startDemoStand(o.lang ? { lang: o.lang } : {});
  let bus: MonitorBus | undefined;
  try {
    const b = new MonitorBus({
      calls: () => stand.stand.calls(),
      merchantCalls: () => stand.merchantCalls(),
      journal: () => stand.journal.entries,
      listenFeed: (l) => stand.agent.events.listen(l),
      isAgentKid: (kid) => stand.isAgentKid(kid),
      confirmation: (id) => stand.stand.confirmations.get(id),
      now: () => stand.stand.now(),
    });
    bus = b;
    b.start();
    const monitor = await startMonitorServer({
      bus: b,
      urls: stand.urls,
      agentCode: stand.agentCode,
      brandPath: o.brandPath ?? DEFAULT_BRAND_PATH,
      ...(o.lang && { defaultLang: o.lang }),
      ...(o.port !== undefined && { port: o.port }),
    });
    return {
      stand,
      bus: b,
      monitor,
      close: async () => {
        b.stop();
        try {
          await monitor.close();
        } finally {
          await stand.close();
        }
      },
    };
  } catch (e) {
    bus?.stop();
    await stand.close().catch((r: unknown) => console.error(t(o.lang ?? "ru", "cli.release_failed"), r));
    throw e;
  }
}
