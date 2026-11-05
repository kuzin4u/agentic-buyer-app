// npm run demo (П2): поднимает демо-стенд и печатает адреса. Остановка — Ctrl+C.
// Монитор операций и сюжеты добавят кирпичи К1.3 и К2.x.
import { startDemoStand } from "./stand.js";

const demo = await startDemoStand();
const lines = [
  "Демо-стенд запущен (только 127.0.0.1). Агент настоящий, остальное — эмуляторы стенда Платформы.",
  `  агент:                        ${demo.agentCode}`,
  `  ПАО стенда:                   ${demo.urls.pao}`,
  `  витрины продавцов (эмулятор): ${demo.urls.merchants}`,
  `  экран мандатов банка (эмулятор банка, UI-К2): ${demo.urls.bankApp}`,
  `  страница УПК (эмулятор УПК):  ${demo.urls.upk}`,
  "Остановка — Ctrl+C.",
];
console.log(lines.join("\n"));

let stopping = false;
const stop = () => {
  if (stopping) return;
  stopping = true;
  demo.close().then(
    () => process.exit(0),
    (e: unknown) => {
      console.error("демо-стенд: ошибка при остановке", e);
      process.exit(1);
    },
  );
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
