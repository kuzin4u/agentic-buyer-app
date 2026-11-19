// Конфигурация Svelte каркаса экрана (ИН-0, кирпич К1; решение П4). Без файла плагин на каждой сборке пишет
// «no Svelte config found» — предупреждение осталось бы в журнале CI навсегда.
// `vitePreprocess` нужен уже для К3: он даёт `<script lang="ts">` внутри `.svelte`, то есть позволяет писать каркас на
// TypeScript, как остальной код приложения.
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

export default {
  preprocess: vitePreprocess(),
};
