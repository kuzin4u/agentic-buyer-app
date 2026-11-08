// Снимок реестров диагностики для дашбордов DEMO-2 (Р-1273 п. 3, Р-1275 п. 1). Сторона сборки контура «агент + стенд»:
// реестры импортирует она, экраны получают только снимок — маршрутом стенда `GET /api/diag` через адаптер источника.
// Обход до kuzin4u/agentic-buyer-ref#105 (П2 п. 4): реестры агента — тем же внутренним путём, что сборка стенда.
// Реестры Платформы (PLATFORM_DIAG, PI_DIAG) наружу пакета не открыты — в снимке «ждёт передачи» (расхождение № 2).
import { DIAG } from "agentic-buyer-ref/src/agent/compose.js";
import { MERCHANT_DIAG } from "agentic-buyer-ref/src/agent/declines/merchant.js";
import { toDiagEntryWire, type DiagEntryWire, type DiagRegistryWire, type DiagSnapshot } from "../dashboards/wire.js";

function entries(registry: Readonly<Record<string, unknown>>): DiagEntryWire[] {
  return Object.values(registry).map((e) => {
    const w = toDiagEntryWire(e);
    // Запись реестра не по формату К17 — дефект сборки, а не данных: стенд не стартует.
    if (!w) throw new Error(`diag: запись реестра не по формату — ${String((e as { code?: unknown }).code)}`);
    return w;
  });
}

const ready = (id: "agent" | "merchant", registry: Readonly<Record<string, unknown>>): DiagRegistryWire => {
  const list = entries(registry);
  return { id, status: "ready", components: [...new Set(list.map((e) => e.component))], entries: list };
};

/** Снимок: реестр агента (ПАО, клиент ПАО, каталог, агент — `DIAG` ядра агента), отказы продавца, Платформа — ждёт передачи. */
export function buildDiagSnapshot(): DiagSnapshot {
  return {
    v: 1,
    registries: [
      ready("agent", DIAG),
      ready("merchant", MERCHANT_DIAG),
      { id: "platform", status: "pending", components: ["platform", "pi"], entries: [] },
    ],
  };
}
