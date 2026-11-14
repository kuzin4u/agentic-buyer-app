import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**", "coverage/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Скрипты страниц (src/demo/public/*.js) — под тем же запретом, что код на TypeScript (П2 п. 2).
    files: ["src/**/*.{ts,mts,cts,tsx,js}"],
    rules: {
      // Инвариант 4: данные витрин — текст, не разметка и не код.
      "no-restricted-properties": [
        "error",
        { property: "innerHTML", message: "Инвариант 4: данные выводятся как текст." },
        { property: "outerHTML", message: "Инвариант 4: данные выводятся как текст." },
        { property: "insertAdjacentHTML", message: "Инвариант 4: данные выводятся как текст." },
      ],
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-new-func": "error",
    },
  },
  {
    // Р-1246 п. 3: экраны DEMO-2 читают только шину через адаптер источника — код агента, Платформы, ядра и стенда не
    // импортируют (и типы тоже: формат линии — свой, src/dashboards/wire.ts). Основная защита — тест границы с обходом
    // графа (tests/dashboards/boundary.test.ts); это правило — ранний сигнал в редакторе.
    // Пульт (`src/pult`, П-1) — под той же границей: только адаптер источника и формат линии `src/dashboards`.
    files: ["src/dashboards/**/*.{ts,mts,cts,tsx,js}", "src/pult/**/*.{ts,mts,cts,tsx,js}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["agentic-buyer-ref", "agentic-buyer-ref/*"], message: "Р-1246: экраны не импортируют код агента." },
            { group: ["agentic-ps-platform", "agentic-ps-platform/*"], message: "Р-1246: экраны не импортируют код Платформы." },
            { group: ["@kuzin4u/*"], message: "Р-1246: экраны не импортируют код ядра." },
            { group: ["**/demo/**", "**/demo"], message: "Р-1246: экраны не импортируют сборку стенда — только адаптер источника." },
            { group: ["**/node_modules/**"], message: "Р-1246: экраны не импортируют пакеты в обход их exports." },
          ],
        },
      ],
      "no-restricted-syntax": [
        "error",
        { selector: "ImportExpression", message: "Р-1246: динамический импорт в экранах не используется — граница проверяема только статически." },
        { selector: "CallExpression[callee.name='require']", message: "Р-1246: require в экранах не используется." },
        { selector: "CallExpression[callee.name='createRequire']", message: "Р-1246: createRequire в экранах не используется." },
      ],
    },
  },
);
