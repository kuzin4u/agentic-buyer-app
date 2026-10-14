import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**", "coverage/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{ts,mts,cts,tsx}"],
    rules: {
      // Инвариант 4: данные витрин — текст, не разметка и не код.
      "no-restricted-properties": [
        "error",
        { property: "innerHTML", message: "Инвариант 4: данные выводятся как текст." },
        { property: "outerHTML", message: "Инвариант 4: данные выводятся как текст." },
      ],
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-new-func": "error",
    },
  },
);
