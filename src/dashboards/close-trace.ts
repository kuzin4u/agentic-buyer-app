// К1.4в — временная диагностика закрытия стенда (Р-1338): только в CI (GitHub Actions ставит CI=true) печатает время
// каждого шага Demo.close() и активные ресурсы процесса после шага. Снимается кирпичом исправления после разбора лога.
const on = process.env.CI === "true";

/** Выполняет шаг закрытия и, если включено, печатает «[close-trace] <метка> <шаг> <мс> active=[…]». */
export async function traceStep<T>(tag: string | URL, step: string, run: () => T | Promise<T>): Promise<T> {
  if (!on) return run();
  const t0 = Date.now();
  try {
    return await run();
  } finally {
    // Прямо в stderr, мимо перехвата console у vitest (в CI он прячет вывод прошедших тестов).
    process.stderr.write(`[close-trace] ${String(tag)} ${step} ${Date.now() - t0}ms active=${JSON.stringify(process.getActiveResourcesInfo())}\n`);
  }
}
