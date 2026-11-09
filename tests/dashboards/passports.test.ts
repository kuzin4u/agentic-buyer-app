// К2.1 DEMO-2: паспорта пяти сюжетов — структура и связность с интерпретатором и библиотекой ситуаций (без стенда).
// Сверка паспортов с фактом стенда — tests/demo/interpret-live.test.ts.
import { describe, expect, it } from "vitest";
import { interpret, LOCAL_STAND_EMULATED, type InterpretEnv } from "../../src/dashboards/interpret.js";
import { AGENT_CODES, KEY_CODES, matches, PASSPORTS, SCENARIOS } from "../../src/dashboards/passports.js";
import { rawInHumanText } from "./human-text.js";
import { PHRASES } from "../../src/dashboards/phrases.js";
import { buildDiagSnapshot } from "../../src/demo/diag.js";
import { loadSituationTitles } from "../../src/demo/situations.js";

describe("паспорта пяти сюжетов (К2.1)", () => {
  it("пять паспортов по порядку сюжетов монитора; у каждого — исход и четыре статуса на ru и en", () => {
    expect(PASSPORTS.map((p) => [p.no, p.name])).toEqual(SCENARIOS.map((s) => [s.no, s.name]));
    for (const p of PASSPORTS) {
      for (const tx of [p.title, p.outcome.text, p.statuses.mandate, p.statuses.operation, p.statuses.agent, p.statuses.key])
        for (const lang of ["ru", "en"] as const) expect(tx[lang].length, `${p.no}`).toBeGreaterThan(0);
      expect(p.expect.length).toBeGreaterThan(2);
    }
  });

  it("ожидания: id уникальны в паспорте, описание на ru и en, шаги и события — из словаря интерпретатора, С-xx — из библиотеки", () => {
    const titles = loadSituationTitles();
    for (const p of PASSPORTS) {
      const ids = [...p.expect, ...p.forbid].map((e) => e.id);
      expect(new Set(ids).size, `${p.no}`).toBe(ids.length);
      for (const e of [...p.expect, ...p.forbid]) {
        expect(e.what.ru.length && e.what.en.length, `${p.no}/${e.id}`).toBeGreaterThan(0);
        const m = e.match;
        if (m.ref !== undefined && m.stream === "scenario") expect(Object.hasOwn(PHRASES.scenario, m.ref), `${p.no}/${e.id}`).toBe(true);
        if (m.ref !== undefined && m.stream === "monitor") expect(Object.hasOwn(PHRASES.monitor, m.ref), `${p.no}/${e.id}`).toBe(true);
        if (m.situation !== undefined) expect(Object.hasOwn(titles, m.situation), `${p.no}/${e.id}`).toBe(true);
      }
    }
  });

  it("каждый паспорт запрещает фрод, «решает владелец», отказы допуска агента и ключа, действия клиента не из банка; без оплаты — ни события «оплачено», ни шага итога", () => {
    for (const p of PASSPORTS) {
      const ids = p.forbid.map((e) => e.id);
      expect(ids).toEqual(expect.arrayContaining(["no-fraud", "no-owner-verdict", "agent-admitted", "agent-key-valid", "client-sign-only", "client-confirm-only", "client-revoke-only"]));
      const paid = p.expect.some((e) => e.match.ref === "operation.authorized");
      expect(paid || (ids.includes("no-paid") && ids.includes("no-outcome")), `${p.no}`).toBe(true);
    }
  });

  it("признаки не пустые; коды — из реестров; коды агента и ключа покрывают реестры целиком (ревью К2.1 № 4, № 8)", () => {
    const all = new Set(buildDiagSnapshot().registries.flatMap((r) => r.entries.map((e) => e.code)));
    for (const p of PASSPORTS)
      for (const e of [...p.expect, ...p.forbid]) {
        expect(Object.keys(e.match).length, `${p.no}/${e.id}`).toBeGreaterThan(0);
        for (const c of [e.match.code ?? []].flat()) expect(all.has(c), `${p.no}/${e.id}: ${c}`).toBe(true);
      }
    // Об агенте и его ключе — всё, кроме дефекта запроса, пакета чужого агента и способа оплаты агента.
    const OTHER = new Set(["AGENT_REQUEST_DEFECT", "PACKAGE_AGENT_MISMATCH", "NO_AGENT_PAYMENT_METHOD"]);
    const registry = [...all].filter((c) => /AGENT|KEY|SIGNATURE_INVALID/.test(c) && !OTHER.has(c)).sort();
    expect([...AGENT_CODES, ...KEY_CODES].sort()).toEqual(registry);
  });

  it("тексты паспортов для человека — без машинных кодов и имён полей (З2)", () => {
    for (const p of PASSPORTS)
      for (const tx of [p.title, p.outcome.text, ...Object.values(p.statuses), ...[...p.expect, ...p.forbid].map((e) => e.what)])
        for (const lang of ["ru", "en"] as const) expect(rawInHumanText(tx[lang], lang), `${p.no}: ${tx[lang]}`).toBeUndefined();
  });

  it("действия клиента: подпись своим ключом агента — срабатывает запрет и не засчитывается ожидание (ревью К2.1 № 1)", () => {
    const env: InterpretEnv = { snapshot: buildDiagSnapshot(), emulated: LOCAL_STAND_EMULATED };
    const sign = (source: "stand" | "agent_platform" | "network_platform") =>
      interpret(
        { stream: "monitor", event: { seq: 1, at: "2026-11-09T10:00:00.000Z", source, cls: "mandate", what: "POST /participants/v1/mandates/{mandate_id}/sign", ids: {}, status: 200 } },
        env,
      );
    const p2 = PASSPORTS[1]!;
    const expectSign = p2.expect.find((e) => e.id === "client-signs")!;
    const forbidSign = p2.forbid.find((e) => e.id === "client-sign-only")!;
    // Участник по маршруту — «клиент» в любом случае; кто прислал — только source.
    expect(sign("agent_platform").actor).toBe("client");
    expect(matches(sign("stand"), expectSign.match)).toBe(true);
    expect(matches(sign("stand"), forbidSign.match)).toBe(false);
    for (const s of ["agent_platform", "network_platform"] as const) {
      expect(matches(sign(s), expectSign.match), s).toBe(false);
      expect(matches(sign(s), forbidSign.match), s).toBe(true);
    }
  });

  it("сопоставление: заданные признаки совпадают все; «кто ошибся» — код, деталь, вердикт, все стороны", () => {
    const env: InterpretEnv = { snapshot: buildDiagSnapshot(), emulated: LOCAL_STAND_EMULATED };
    const declined = interpret(
      {
        stream: "monitor",
        event: { seq: 1, at: "2026-11-09T10:00:00.000Z", source: "pao_event", cls: "decline", what: "operation.declined", ids: {}, code: "LIMIT_EXCEEDED", codeDetail: "CLIENT" },
      },
      env,
    );
    const p3 = PASSPORTS[2]!.expect.find((e) => e.id === "declined")!;
    expect(matches(declined, p3.match)).toBe(true);
    expect(matches(declined, { ...p3.match, codeDetail: "MANDATE" })).toBe(false);
    expect(matches(declined, { ...p3.match, side: ["client", "agent"] })).toBe(false);
    expect(matches(declined, { ref: "operation.authorized" })).toBe(false);
    expect(matches(declined, {})).toBe(true);
    const step = interpret({ stream: "scenario", line: { seq: 2, at: "2026-11-09T10:00:00.000Z", step: "outcome", params: { status: "AUTHORIZED" } } }, env);
    expect(matches(step, { stream: "scenario", ref: "outcome", status: "AUTHORIZED" })).toBe(true);
    expect(matches(step, { code: "AUTHORIZED" })).toBe(false); // статус — не код отказа: «кто ошибся» нет
  });
});
