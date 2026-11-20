// Сборка каркаса экрана (ИН-0, кирпич К1; решение П4). Клиент — `src/ui-client/`, собранное — `dist/ui/`.
// Настройки подчинены политике CSP `'self'` сервера приложения (`src/demo/server.ts`, константа `CSP`): в собранном не
// должно остаться ни одного inline-скрипта, ни одного inline-стиля и ни одного `data:`-ресурса, иначе каркас потребовал
// бы `'unsafe-inline'` — а по П4 п. 3 политика не ослабляется ни на знак. Отсутствие inline проверяется тестом (К4).
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [svelte()],
  build: {
    outDir: "dist/ui",
    emptyOutDir: true,
    target: "es2022",
    // 0 — ни один ресурс не встраивается в код как `data:`; всё отдаётся файлами (CSP `img-src 'self'`).
    assetsInlineLimit: 0,
    // Один файл стилей вместо встроенных по месту: стили отдаются `<link rel="stylesheet">`, как `/brand.css` монитора.
    cssCodeSplit: false,
    // Полифил предзагрузки модулей Vite ставит inline-скриптом — под `script-src 'self'` он бы не исполнился.
    modulePreload: { polyfill: false },
    // Страницу собирает сервер (образец — `page()` в `src/demo/server.ts`), поэтому входом служит модуль, а не HTML:
    // так в сборке не появляется ни одного inline-куска разметки.
    rollupOptions: {
      input: "src/ui-client/main.ts",
      output: {
        format: "es",
        entryFileNames: "ui.js",
        chunkFileNames: "ui-[name].js",
        assetFileNames: "ui.[ext]",
      },
    },
  },
});
