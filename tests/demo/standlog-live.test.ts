// Х3 (П-9.3 — повторное ревью П-3.2в № C): `STAND_DELAY_MAX_MS` (`src/pult/standlog.ts`) переписан из JS стенда — сверка
// с настоящим стендом: задержка Н-12 ровно на пределе стенд принимает, на миллисекунду больше — отвергает. Сверка формы
// записей журнала (`StandFaultForm`) — открыта, STATUS «Открыто» (при подъёме тега стенда).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startDemo, type Demo } from "../../src/demo/run.js";
import { STAND_DELAY_MAX_MS } from "../../src/pult/standlog.js";

describe("предел задержки Н-12 — как у стенда (Х3)", () => {
  let demo: Demo;
  beforeAll(async () => {
    demo = await startDemo({ faults: true });
  }, 60_000);
  afterAll(async () => {
    await demo?.close();
  });

  it("arm(Н-12, delay_ms = STAND_DELAY_MAX_MS) — принят; STAND_DELAY_MAX_MS + 1 — отказ стенда", () => {
    const d = demo.stand.stand.demo!;
    try {
      expect(() => d.arm("Н-12", { delay_ms: STAND_DELAY_MAX_MS })).not.toThrow();
    } finally {
      d.disarm("Н-12");
    }
    try {
      expect(() => d.arm("Н-12", { delay_ms: STAND_DELAY_MAX_MS + 1 })).toThrow(/delay_ms/);
    } finally {
      d.disarm("Н-12"); // если стенд взвёл бы вопреки отказу — не оставить взведённым
    }
  });
});
