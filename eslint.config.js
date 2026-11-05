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
);
