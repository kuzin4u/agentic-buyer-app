// npm run demo (П2): поднимает демо-стенд и монитор операций и печатает адреса. Остановка — Ctrl+C.
// Окружение: DEMO_LANG=ru|en — язык вывода и страницы по умолчанию; DEMO_PORT — порт монитора (по умолчанию свободный);
// DEMO_BRAND — файл бренда (по умолчанию config/brand.demo.json).
import { langOf, t } from "./i18n.js";
import { startDemo } from "./run.js";

const lang = langOf(process.env.DEMO_LANG);
const port = process.env.DEMO_PORT ? Number(process.env.DEMO_PORT) : undefined;
const demo = await startDemo({
  lang,
  ...(port !== undefined && Number.isInteger(port) && { port }),
  ...(process.env.DEMO_BRAND && { brandPath: process.env.DEMO_BRAND }),
});
const { urls, agentCode } = demo.stand;
const row = (k: Parameters<typeof t>[1], v: string) => `  ${t(lang, k)}: ${v}`;
console.log(
  [
    t(lang, "cli.started"),
    row("cli.monitor", `${demo.monitor.url}/?lang=${lang}`),
    row("cli.interpret", `${demo.monitor.url}/dash/interpret?lang=${lang}`),
    row("cli.agent", agentCode),
    row("cli.pao", urls.pao),
    row("cli.merchants", urls.merchants),
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
