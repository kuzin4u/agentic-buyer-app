// npm run demo (П2): поднимает демо-стенд и монитор операций и печатает адреса. Остановка — Ctrl+C.
// Окружение: DEMO_LANG=ru|en — язык вывода и страницы по умолчанию; DEMO_PORT — порт монитора (по умолчанию свободный);
// DEMO_BRAND — файл бренда (по умолчанию config/brand.demo.json); DEMO_FAULTS=1 — режим сбоев стенда для прогона тестов
// пульта (Р-1355 ответ 1, П-1.3): `createStand({ demo: { faults: true } })`, срок подтверждения 45 с; для показа людям не
// включать. DEMO_ACTIONS=1 — режим показа людям с кнопками реакции пульта (П-8.1, Р-1526 В2): `{ actions: true }` — действия
// без сбоев. Другое значение — режим выключен (`envFlag`).
import { envFlag } from "./flags.js";
import { langOf, t } from "./i18n.js";
import { startDemo } from "./run.js";

const lang = langOf(process.env.DEMO_LANG);
const port = process.env.DEMO_PORT ? Number(process.env.DEMO_PORT) : undefined;
const faults = envFlag(process.env.DEMO_FAULTS);
const actions = envFlag(process.env.DEMO_ACTIONS);
const demo = await startDemo({
  lang,
  faults,
  actions,
  ...(port !== undefined && Number.isInteger(port) && { port }),
  ...(process.env.DEMO_BRAND && { brandPath: process.env.DEMO_BRAND }),
});
const { urls, agentCode } = demo.stand;
const row = (k: Parameters<typeof t>[1], v: string) => `  ${t(lang, k)}: ${v}`;
console.log(
  [
    t(lang, "cli.started"),
    ...(faults ? [t(lang, "cli.faults").replace("{sec}", String(demo.stand.stand.params.order_hold_sec))] : []),
    ...(actions && !faults ? [t(lang, "cli.actions")] : []),
    row("cli.pult", `${demo.monitor.url}/pult?lang=${lang}`),
    row("cli.monitor", `${demo.monitor.url}/?lang=${lang}`),
    row("cli.interpret", `${demo.monitor.url}/dash/interpret?lang=${lang}`),
    row("cli.agent", agentCode),
    row("cli.pao", urls.pao),
    // Страница витрин для человека (З12, ревью П-8.0 № 7), а не базовый адрес сервера витрин.
    row("cli.merchants", `${urls.merchants}/shops?lang=${lang}`),
    row("cli.bank", urls.bankApp),
    row("cli.upk", urls.upk),
    t(lang, "cli.stop"),
  ].join("\n"),
);

let stopping = false;
const stop = () => {
  if (stopping) return;
  stopping = true;
  demo.close().then(
    () => process.exit(0),
    (e: unknown) => {
      console.error(t(lang, "cli.stop_failed"), e);
      process.exit(1);
    },
  );
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
