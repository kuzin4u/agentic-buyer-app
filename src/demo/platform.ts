// Версия стенда Платформы для текстов демо-стенда (З8, К3.1а): из `package.json` установленного пакета `agentic-ps-platform`,
// не литералом. `./package.json` — открытый экспорт пакета; читаются только метаданные, кода из пакета этот модуль не грузит.
import { createRequire } from "node:module";

const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

/** Версия пакета стенда Платформы, например «0.43.0». Нет пакета или версия не по форме — исключение (fail-closed). */
export function platformPackageVersion(): string {
  const pkg = createRequire(import.meta.url)("agentic-ps-platform/package.json") as { version?: unknown };
  if (typeof pkg.version !== "string" || !SEMVER.test(pkg.version)) throw new Error(`версия пакета agentic-ps-platform не по форме: ${String(pkg.version)}`);
  return pkg.version;
}

/** Версия для текста экрана: «v0.43.0». */
export const PLATFORM_VERSION = `v${platformPackageVersion()}`;
