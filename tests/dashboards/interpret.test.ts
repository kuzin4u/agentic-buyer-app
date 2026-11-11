// К1.3 DEMO-2 ч. 1: правила интерпретатора на синтетических записях линии — квалификация, «кто ошибся» по снимку
// реестров, подставной агент (Р-1255 п. 1, Р-1273 п. 5), реестр Платформы «ждёт передачи» (Р-1275 п. 1), эмуляторы,
// устойчивость к любой записи, прошедшей parseWireItem (ревью К1.3 Б1).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { codeWords, interpret, LOCAL_STAND_EMULATED, STAGES, type InterpretEnv } from "../../src/dashboards/interpret.js";
import { CODE_WORDS, PHRASES } from "../../src/dashboards/phrases.js";
import { rawInHumanText } from "./human-text.js";
import { buildDiagSnapshot } from "../../src/demo/diag.js";
import { TRAINING_MERCHANTS } from "../../src/demo/shops.js";
import { parseWireItem, WIRE_SCENARIO_HIDDEN_STEPS, type DiagEntryWire, type DiagSnapshot, type WireItem, type WireMonitorEvent } from "../../src/dashboards/wire.js";

const entry = (code: string, component: DiagEntryWire["component"], source: DiagEntryWire["source"], action: DiagEntryWire["action"]): DiagEntryWire => ({
  code,
  component,
  source,
  action,
  human: { ru: `человеку: ${code}` },
  operator: { ru: `оператору: ${code}`, en: `operator: ${code}` },
  norm: "тест",
  since: "тест",
});

const SNAPSHOT: DiagSnapshot = {
  v: 1,
  registries: [
    {
      id: "agent",
      status: "ready",
      components: ["pao", "core", "agent"],
      entries: [
        entry("MANDATE_REVOKED", "pao", ["client"], "stop"),
        entry("IDEMPOTENCY_CONFLICT", "pao", ["agent"], "after_fix"),
        entry("MANDATE_NOT_ACTIVE", "agent", ["client", "bank", "platform"], "after_human"),
        entry("SIGNATURE_INVALID", "pao", ["agent"], "after_fix"),
        entry("LIMIT_EXCEEDED", "pao", ["client", "bank"], "after_human"),
        entry("UPSTREAM_UNAVAILABLE", "pao", ["environment"], "retry_same_key"),
        entry("A5_PRICE_MISMATCH", "core", ["merchant"], "after_fix"),
        entry("CONFIRMATION_REQUIRED", "pao", ["client"], "after_human"),
      ],
    },
    {
      id: "merchant",
      status: "ready",
      components: ["agent"],
      entries: [
        entry("SIGNATURE_INVALID", "agent", ["merchant", "agent"], "after_fix"),
        entry("PACKAGE_AGENT_MISMATCH", "agent", ["agent", "merchant"], "after_fix"),
        entry("ORDER_NOT_FOUND", "agent", ["merchant"], "after_human"),
      ],
    },
    { id: "platform", status: "pending", components: ["platform", "pi"], entries: [] },
  ],
};
const ENV: InterpretEnv = { snapshot: SNAPSHOT, emulated: LOCAL_STAND_EMULATED };

let seq = 0;
const at = "2026-11-06T10:00:00.000Z";
const mon = (e: Partial<WireMonitorEvent> & Pick<WireMonitorEvent, "source" | "cls" | "what">): WireItem => ({
  stream: "monitor",
  event: { seq: ++seq, at, ids: {}, ...e },
});
const con = (kind: string, fields: Record<string, string> = {}): WireItem => ({ stream: "console", line: { seq: ++seq, at, kind, ...fields } });
const step = (name: string, params: Record<string, string | number> = {}): WireItem => ({ stream: "scenario", line: { seq: ++seq, at, step: name, params } });
const overreach = () => mon({ source: "agent_platform", cls: "decline", what: "POST /pao/v1/credentials", status: 403, code: "MANDATE_REVOKED" });

describe("интерпретатор: квалификация по правилам", () => {
  it("подставной агент (источник помечен): Платформа отказала по отозванному поручению — фрод, сторона агент, «так и должно быть», С-28", () => {
    const r = interpret(overreach(), { ...ENV, rogueAgent: true });
    expect(r).toMatchObject({ kind: "fraud", stage: "payment", actor: "agent", emulated: false, level: "key", situation: "С-28" });
    expect(r.who).toMatchObject({ code: "MANDATE_REVOKED", status: "found", registry: "agent", side: ["agent"], verdict: "expected" });
    expect(r.phrase.ru).toContain("подставного агента");
  });

  it("та же запись без пометки (живой прогон): не фрод — «нарушение поручения: фрод или дефект, вердикт — владелец»", () => {
    const r = interpret(overreach(), ENV);
    expect(r).toMatchObject({ kind: "error", situation: "С-28" });
    expect(r.who).toMatchObject({ side: ["agent"], verdict: "owner" });
    // Код в тексте человека — словами (З2); сам код — в «Кто ошибся».
    expect(r.phrase.ru).toBe("Платформа остановила агента: нарушение поручения (поручение отозвано) — фрод или дефект агента, вердикт — владелец");
    expect(r.who?.code).toBe("MANDATE_REVOKED");
    expect(r.phrase.en).toContain("the owner decides");
  });

  it("дефект повтора (IDEMPOTENCY_CONFLICT) — не нарушение поручения: ошибка по реестру даже у подставного агента", () => {
    const r = interpret(mon({ source: "agent_platform", cls: "decline", what: "POST /pao/v1/credentials", status: 409, code: "IDEMPOTENCY_CONFLICT" }), { ...ENV, rogueAgent: true });
    expect(r).toMatchObject({ kind: "error" });
    expect(r.who).toMatchObject({ verdict: "failure", side: ["agent"] });
    expect(r.situation).toBeUndefined();
  });

  it("честный агент ловит отзыв сам (журнал агента) — конфликт, а не фрод; сторона — по реестру", () => {
    const r = interpret(con("agent.refused", { reason: "MANDATE_NOT_ACTIVE" }), { ...ENV, rogueAgent: true });
    expect(r).toMatchObject({ kind: "conflict", level: "key", stage: "mandate" });
    expect(r.who).toMatchObject({ side: ["client", "bank", "platform"], verdict: "expected" });
    expect(interpret(step("revoke.refused", { code: "MANDATE_REVOKED", mandate_id: "mnd_1" }), ENV)).toMatchObject({ kind: "conflict", stage: "revoke", situation: "С-28" });
  });

  it("запрос «я агент» без верной подписи от постороннего отправителя — фрод С-08; от нашего агента — ошибка по реестру продавца", () => {
    const fake = interpret(mon({ source: "network_merchant", cls: "decline", what: "POST /v1/shops/{shop_id}/orders", status: 401, code: "SIGNATURE_INVALID" }), ENV);
    expect(fake).toMatchObject({ kind: "fraud", actor: "network", situation: "С-08" });
    expect(fake.who).toMatchObject({ side: ["network"], verdict: "expected" });
    const own = interpret(mon({ source: "agent_merchant", cls: "decline", what: "POST /v1/shops/{shop_id}/orders", status: 401, code: "SIGNATURE_INVALID" }), ENV);
    expect(own).toMatchObject({ kind: "error" });
    expect(own.who).toMatchObject({ registry: "merchant", side: ["merchant", "agent"], verdict: "failure" });
    // Тот же код у Платформы — запись реестра ПАО, а не продавца.
    const pao = interpret(mon({ source: "agent_platform", cls: "decline", what: "POST /pao/v1/mandates", status: 401, code: "SIGNATURE_INVALID" }), ENV);
    expect(pao.who).toMatchObject({ registry: "agent", component: "pao", side: ["agent"] });
    // В журнале агента причина обращения к витрине — код продавца (ревью К1.3 № 6).
    expect(interpret(con("shop.call", { reason: "SIGNATURE_INVALID" }), ENV).who).toMatchObject({ registry: "merchant", side: ["merchant", "agent"] });
  });

  it("чужой агент в пакете — не фрод: ошибка по реестру (агент или продавец, «после исправления»), С-07 у продавца, С-15 у агента", () => {
    const shop = interpret(mon({ source: "agent_merchant", cls: "decline", what: "POST /v1/shops/{shop_id}/orders/{order_id}/payment", status: 409, code: "PACKAGE_AGENT_MISMATCH" }), ENV);
    expect(shop).toMatchObject({ kind: "error", situation: "С-07" });
    expect(shop.who).toMatchObject({ side: ["agent", "merchant"], verdict: "failure" });
    expect(shop.phrase.ru).not.toContain("Платформа остановила");
    expect(interpret(con("purchase.unfinished", { reason: "PACKAGE_AGENT_MISMATCH" }), ENV)).toMatchObject({ kind: "error", situation: "С-15" });
  });

  it("отказ по лимиту клиента — конфликт С-26, сторона клиент и банк; лимит поручения — без С-26", () => {
    const r = interpret(mon({ source: "pao_event", cls: "decline", what: "operation.declined", code: "LIMIT_EXCEEDED", codeDetail: "CLIENT" }), ENV);
    expect(r).toMatchObject({ kind: "conflict", stage: "outcome", actor: "platform", situation: "С-26" });
    expect(r.who).toMatchObject({ codeDetail: "CLIENT", side: ["client", "bank"], verdict: "expected" });
    expect(r.phrase).toEqual({ ru: "Отказ: превышен лимит клиента в банке", en: "Declined: the client's bank limit exceeded" });
    const mandate = interpret(mon({ source: "pao_event", cls: "decline", what: "operation.declined", code: "LIMIT_EXCEEDED", codeDetail: "MANDATE" }), ENV);
    expect(mandate.situation).toBeUndefined();
    expect(mandate.phrase.ru).toBe("Платформа: оплата отклонена (превышен лимит)");
    expect(mandate.phrase.en).toBe("Platform: payment declined (limit exceeded)");
  });

  it("сбой среды — ошибка, «сбой»; запрос подтверждения человеку (409 CONFIRMATION_REQUIRED) — норма", () => {
    const down = interpret(mon({ source: "agent_platform", cls: "decline", what: "POST /pao/v1/credentials", status: 503, code: "UPSTREAM_UNAVAILABLE" }), ENV);
    expect(down).toMatchObject({ kind: "error" });
    expect(down.who).toMatchObject({ side: ["environment"], verdict: "failure" });
    const human = interpret(mon({ source: "agent_platform", cls: "check", what: "POST /pao/v1/credentials", status: 409, code: "CONFIRMATION_REQUIRED" }), ENV);
    expect(human).toMatchObject({ kind: "norm" });
    expect(human.who).toBeUndefined();
  });

  it("сигнал A5 у предложения витрины — конфликт со стороной «продавец», «так и должно быть»", () => {
    const r = interpret(con("offer.flagged", { reason: "A5_PRICE_MISMATCH" }), ENV);
    expect(r).toMatchObject({ kind: "conflict", stage: "search" });
    expect(r.who).toMatchObject({ side: ["merchant"], verdict: "expected" });
  });

  it("код отказа Платформы не из её компонентов: «ждёт передачи», в реестр продавца поиск не переходит (ревью № 5)", () => {
    const item = mon({ source: "stand", cls: "decline", what: "POST /adp/v1/decide", status: 422, code: "ORDER_NOT_FOUND" });
    expect(interpret(item, ENV).who).toMatchObject({ code: "ORDER_NOT_FOUND", status: "pending", verdict: "unknown", side: [] });
    expect(interpret(item, ENV).who?.registry).toBeUndefined();
    const ready: InterpretEnv = { ...ENV, snapshot: { v: 1, registries: SNAPSHOT.registries.filter((r) => r.id !== "platform") } };
    expect(interpret(item, ready).who).toMatchObject({ status: "unknown", verdict: "unknown" });
  });

  it("коды сюжета — не коды Платформы: «неизвестно», не «ждёт передачи»; агент не остановился после отзыва — ошибка агента (ревью № 7)", () => {
    expect(interpret(step("failed", { code: "NO_CANDIDATE", state: "SEARCH" }), ENV).who).toMatchObject({ status: "unknown" });
    const r = interpret(step("failed", { code: "REVOKED_NOT_ENFORCED", state: "AUTHORIZING" }), ENV);
    expect(r).toMatchObject({ kind: "error", stage: "payment" });
    expect(r.who).toMatchObject({ status: "unknown", side: ["agent"], verdict: "failure" });
  });

  it("«оплачено» — только у события с источником pao_event (инвариант 6, ревью № 8); без суммы и кода — без пустых скобок", () => {
    const fake = interpret(mon({ source: "agent_merchant", cls: "outcome", what: "operation.authorized" }), ENV);
    expect(fake.phrase.ru).not.toMatch(/оплачено/i);
    expect(fake.phrase.ru).toBe("Обращение: operation.authorized");
    expect(interpret(mon({ source: "pao_event", cls: "outcome", what: "operation.authorized" }), ENV).phrase.ru).toBe("Платформа: оплачено (итог по подписанному событию)");
    const noCode = interpret(mon({ source: "pao_event", cls: "decline", what: "operation.declined" }), ENV);
    expect(noCode).toMatchObject({ kind: "conflict", phrase: { ru: "Платформа: оплата отклонена" } });
    expect(noCode.who).toBeUndefined();
  });

  it("эмуляторы помечаются по источнику; шаг limit.declined — отказ Платформы (ревью № 13)", () => {
    const item = mon({ source: "stand", cls: "mandate", what: "PUT /participants/v1/principals/{principal_ref}/limits", status: 200 });
    expect(interpret(item, ENV)).toMatchObject({ actor: "bank", emulated: true, kind: "norm" });
    expect(interpret(item, { ...ENV, emulated: [] })).toMatchObject({ actor: "bank", emulated: false });
    expect(interpret(step("limit.declined", { code: "LIMIT_EXCEEDED", order_id: "ORD-1" }), ENV)).toMatchObject({ actor: "platform", situation: "С-26" });
  });

  it("незнакомая запись не роняет интерпретатор: нейтральная фраза с её именем, ru и en; ответ витрины — слова продавца", () => {
    expect(interpret(mon({ source: "stand", cls: "other", what: "GET (pao)", status: 200 }), ENV).phrase).toEqual({ ru: "Обращение: GET (pao)", en: "Call: GET (pao)" });
    expect(interpret(step("new.step"), ENV)).toMatchObject({ kind: "norm", stage: "service", phrase: { ru: "Шаг сюжета: new.step" } });
    expect(interpret(con("new.kind"), ENV).phrase.en).toBe("Agent journal: new.kind");
    const reply = interpret(step("order.shop_reply", { order_id: "ORD-1", reply: "PAID" }), ENV);
    expect(reply.phrase.ru).not.toMatch(/оплачено/i);
    expect(reply).toMatchObject({ actor: "merchant", emulated: true, situation: "С-27" });
  });

  it("служебные имена объекта в записи (constructor, __proto__, toString…) — не ключи таблиц: не бросает, стадия из перечня (Б1)", () => {
    const names = ["constructor", "__proto__", "toString", "hasOwnProperty", "valueOf", "prototype"];
    const raws: unknown[] = [];
    for (const n of names) {
      raws.push({ stream: "monitor", event: { seq: 1, at, source: "pao_event", cls: "other", what: n, ids: {} } });
      raws.push({ stream: "monitor", event: { seq: 1, at, source: "agent_platform", cls: "decline", what: n, status: 403, code: "MANDATE_REVOKED", ids: {} } });
      raws.push({ stream: "scenario", line: { seq: 1, at, step: n.toLowerCase().replace(/^_+/, "x"), params: {} } });
      raws.push({ stream: "scenario", line: { seq: 1, at, step: "failed", params: { code: n.toUpperCase().replace(/^_+/, "X") } } });
      raws.push({ stream: "console", line: { seq: 1, at, kind: n.toLowerCase().replace(/^_+/, "x") } });
      raws.push({ stream: "console", line: { seq: 1, at, kind: "purchase.stage", detail: n } });
      raws.push({ stream: "console", line: { seq: 1, at, kind: "shop.call", reason: n.toUpperCase().replace(/^_+/, "X") } });
    }
    raws.push({ stream: "scenario", line: { seq: 1, at, step: "constructor", params: {} } });
    raws.push({ stream: "console", line: { seq: 1, at, kind: "constructor" } });
    let parsed = 0;
    for (const raw of raws) {
      const item = parseWireItem(raw);
      if (!item) continue;
      parsed++;
      const r = interpret(item, ENV);
      expect(STAGES).toContain(r.stage);
      expect(typeof r.phrase.ru).toBe("string");
      expect(typeof r.phrase.en).toBe("string");
    }
    expect(parsed).toBeGreaterThan(raws.length / 2);
  });

  it("тестовый снимок повторяет настоящие реестры: каждая пара «реестр — код» есть в снимке сборки контура (повторное ревью Б3)", () => {
    const real = buildDiagSnapshot();
    for (const r of SNAPSHOT.registries) {
      const twin = real.registries.find((x) => x.id === r.id)!;
      expect(twin.status).toBe(r.status);
      for (const e of r.entries) expect(twin.entries.find((x) => x.code === e.code), `${r.id}/${e.code}`).toMatchObject({ component: e.component, source: e.source, action: e.action });
    }
  });

  it("журнал агента: отказ продавца в пересказе агента — по реестру продавца, если в реестре агента кода нет (Б3)", () => {
    const real: InterpretEnv = { snapshot: buildDiagSnapshot(), emulated: LOCAL_STAND_EMULATED };
    const r = interpret(con("purchase.unfinished", { reason: "PACKAGE_AGENT_MISMATCH" }), real);
    expect(r).toMatchObject({ kind: "error", situation: "С-15" });
    expect(r.who).toMatchObject({ status: "found", registry: "merchant", side: ["agent", "merchant"], verdict: "failure" });
  });

  it("стадия шага failed — по стадии конвейера; незнакомое событие ленты — «Событие Платформы»; без идентификатора фраза цельная (№ 16–18)", () => {
    expect(interpret(step("failed", { code: "NO_INTENT", state: "INTENT_PENDING" }), ENV).stage).toBe("mandate");
    expect(interpret(step("failed", { code: "NO_CANDIDATE", state: "OFFERS" }), ENV).stage).toBe("search");
    expect(interpret(step("failed", { code: "UNKNOWN" }), ENV).stage).toBe("outcome");
    // Незнакомое событие ПАО (agent.suspended с П-11.1г знакомо — сюжет 9).
    expect(interpret(mon({ source: "pao_event", cls: "other", what: "dispute.updated" }), ENV).phrase).toEqual({ ru: "Событие Платформы: dispute.updated", en: "Platform event: dispute.updated" });
    const suspended = interpret(mon({ source: "pao_event", cls: "other", what: "agent.suspended" }), ENV);
    expect(suspended).toMatchObject({ stage: "service", actor: "platform", kind: "norm", level: "key" });
    expect(suspended.phrase.ru).toBe("Платформа: агент приостановлен оператором Системы");
    const pay = interpret(mon({ source: "agent_merchant", cls: "payment", what: "POST /v1/shops/{shop_id}/orders/{order_id}/payment", status: 200 }), ENV);
    expect(pay.phrase).toEqual({ ru: "Агент передал оплату заказа продавцу", en: "The agent sent payment for order to the merchant" });
  });

  it("словарь покрывает все шаги сюжетов демо-стенда, кроме скрытых с линии (ревью № 14)", () => {
    const src = readFileSync(join(import.meta.dirname, "../../src/demo/scenarios.ts"), "utf8");
    const steps = new Set([...src.matchAll(/#step\("([a-z_.]+)"/g)].map((m) => m[1]!));
    expect(steps.size).toBeGreaterThan(20);
    const missing = [...steps].filter((s) => !(WIRE_SCENARIO_HIDDEN_STEPS as readonly string[]).includes(s) && !Object.hasOwn(PHRASES.scenario, s));
    expect(missing).toEqual([]);
  });
});

describe("К1.4а: текст человека без кодов и имён полей; учебная витрина", () => {
  it("коды и статусы в подстановках — словами ru/en, список кодов — через запятую; незнакомый код — как есть (З2)", () => {
    expect(codeWords("A5_PRICE_MISMATCH", "ru")).toBe("цена в описании не совпадает с ценой витрины");
    expect(codeWords("REQUIRED,MANDATE_REVOKED", "en")).toBe("a required field is missing in the merchant's card, the mandate was revoked");
    expect(codeWords("SOMETHING_NEW", "ru")).toBe("SOMETHING_NEW");
    expect(codeWords("constructor", "ru")).toBe("constructor"); // имя из записи — данные, не ключ прототипа (Б1)
    const flagged = interpret(step("search.flagged", { sku: "BRD-3301-01", merchant_id: "MER-3301", codes: "A5_PRICE_MISMATCH" }), ENV);
    expect(flagged.phrase).toEqual({
      ru: "Предложение BRD-3301-01 продавца MER-3301 исключено: цена в описании не совпадает с ценой витрины",
      en: "Offer BRD-3301-01 of merchant MER-3301 excluded: the price in the description differs from the shop price",
    });
    const reply = interpret(step("order.shop_reply", { order_id: "ORD-1", reply: "PAID" }), ENV);
    expect(reply.phrase.ru).toBe("Ответ витрины по заказу ORD-1: заказ оплачен (слова продавца, не итог)");
    expect(reply.phrase.ru).not.toMatch(/оплачено/); // «оплачено» — только у события Платформы (инвариант 6)
    const outcome = interpret(step("outcome", { status: "AUTHORIZED" }), ENV);
    expect(outcome.phrase).toEqual({ ru: "Итог по событию Платформы: операция авторизована", en: "Outcome from the Platform event: operation authorized" });
    // Код остаётся в «Кто ошибся».
    expect(interpret(con("offer.flagged", { reason: "A5_PRICE_MISMATCH", ref: "BRD-3301-01", merchant: "MER-3301" }), ENV).who?.code).toBe("A5_PRICE_MISMATCH");
  });

  it("словарь кодов: ru и en непустые, без имён полей и сырых значений (З2)", () => {
    for (const [code, w] of Object.entries(CODE_WORDS)) {
      for (const lang of ["ru", "en"] as const) {
        expect(w[lang].length, code).toBeGreaterThan(0);
        expect(rawInHumanText(w[lang], lang), `${code} ${lang}`).toBeUndefined();
      }
    }
    // Проверка сама ловит то, что показывал экран до К1.4а (поломка).
    expect(rawInHumanText("Правило A5: цена не та, что в price; found — null", "ru")).toBe("null");
    expect(rawInHumanText("Правило A5: цена не та, что в price", "ru")).toBe("price");
    expect(rawInHumanText("исключено по сигналу A5_PRICE_MISMATCH", "ru")).toBe("A5_PRICE_MISMATCH");
    expect(rawInHumanText("Ответ витрины по заказу ORD-1: PAID", "en")).toBe("PAID");
    expect(rawInHumanText("Order ORD-ed177c3d at merchant MER-4401, mandate mnd_5e6da8cc", "en")).toBeUndefined();
  });

  it("учебная витрина: конфликт или ошибка со стороной «продавец» с кодом её учебного поведения — пометка; прочее — без неё (З10)", () => {
    const env: InterpretEnv = { ...ENV, snapshot: buildDiagSnapshot(), training: TRAINING_MERCHANTS };
    expect(interpret(con("offer.excluded", { reason: "REQUIRED", merchant: "MER-5501" }), env).training).toBe(true);
    expect(interpret(con("offer.flagged", { reason: "A5_PRICE_MISMATCH", ref: "BRD-3301-01", merchant: "MER-3301" }), env).training).toBe(true);
    // Обычная покупка у витрины с учебным поведением (REJECTS_UNIDENTIFIED) — норма, без пометки.
    expect(interpret(step("order.placed", { order_id: "ORD-1", merchant_id: "MER-4401", title: "Багет", qty: 1 }), env).training).toBeUndefined();
    // Настоящий сбой учебной витрины не прячется: 5xx витрины и код не её поведения — без пометки (ревью К1.4а № 2).
    const down = interpret(mon({ source: "agent_merchant", cls: "decline", what: "POST /v1/shops/{shop_id}/orders", status: 503, code: "UPSTREAM_UNAVAILABLE", ids: { merchant_id: "MER-5501" } }), env);
    expect(down.kind).toBe("error");
    expect(down.training).toBeUndefined();
    expect(interpret(con("offer.flagged", { reason: "A5_PRICE_MISMATCH", merchant: "MER-5501" }), env).training).toBeUndefined();
    expect(interpret(con("offer.excluded", { reason: "REQUIRED", merchant: "MER-9999" }), env).training).toBeUndefined();
    expect(interpret(con("offer.excluded", { reason: "REQUIRED", merchant: "MER-5501" }), ENV).training).toBeUndefined();
    expect(TRAINING_MERCHANTS).toMatchObject({ "MER-5501": ["REQUIRED", "BAD_"], "MER-3301": ["A5_"] });
    expect(Object.hasOwn(TRAINING_MERCHANTS, "MER-4401")).toBe(false);
  });
});
