// Формат линии дашбордов DEMO-2 (Р-1246 п. 3): записи шины, которые экраны получают через адаптер источника, и снимок
// реестров диагностики. Это контракт между источником (сейчас — локальный стенд, для ACC-2 — песочница) и экранами, а не код
// стенда: типы шины (`src/demo/bus.ts`) сюда не импортируются, они тянут типы агента и Платформы. Разбор — fail-closed:
// запись не по форме отбрасывается целиком, поля и параметры вне перечня не переносятся (инварианты 1, 4).

/** Классы записи монитора — те же значения, что у шины демо-стенда. */
export const WIRE_CLASSES = ["mandate", "check", "credential", "payment", "outcome", "decline", "other"] as const;
export type WireClass = (typeof WIRE_CLASSES)[number];

/** Источник записи монитора — те же значения, что у шины демо-стенда. */
export const WIRE_SOURCES = [
  "agent_platform",
  "agent_platform_open",
  "network_platform",
  "stand",
  "agent_merchant",
  "network_merchant",
  "pao_event",
] as const;
export type WireSource = (typeof WIRE_SOURCES)[number];

/** Идентификаторы, которые разрешено показывать (инвариант 1); других полей в записи нет. */
export const WIRE_ID_KEYS = ["mandate_id", "op_ref", "confirmation_id", "merchant_id", "shop_id", "order_id"] as const;
export type WireIds = Partial<Record<(typeof WIRE_ID_KEYS)[number], string>>;

export const WIRE_LANGS = ["ru", "en"] as const;
export type WireLang = (typeof WIRE_LANGS)[number];

/** Сумма — минимальные единицы и валюта ISO 4217; текст — уже отформатирован источником по языку. */
export interface WireMoney {
  readonly minor: number;
  readonly currency: string;
  readonly text: Readonly<Record<WireLang, string>>;
}

export interface WireMonitorEvent {
  readonly seq: number;
  readonly at: string;
  readonly source: WireSource;
  readonly cls: WireClass;
  readonly what: string;
  readonly status?: number;
  readonly code?: string;
  readonly codeDetail?: string;
  readonly amount?: WireMoney;
  readonly ids: WireIds;
}

export const WIRE_CONSOLE_FIELDS = ["reason", "detail", "ref", "mandate", "merchant", "method", "result", "status", "check"] as const;

export type WireConsoleLine = { readonly seq: number; readonly at: string; readonly kind: string } & Partial<
  Record<(typeof WIRE_CONSOLE_FIELDS)[number], string>
>;

export interface WireScenarioLine {
  readonly seq: number;
  readonly at: string;
  readonly step: string;
  readonly params: Readonly<Record<string, string | number | WireMoney>>;
}

export type WireItem =
  | { readonly stream: "monitor"; readonly event: WireMonitorEvent }
  | { readonly stream: "console"; readonly line: WireConsoleLine }
  | { readonly stream: "scenario"; readonly line: WireScenarioLine };

/** Заголовок ответа ленты `/events`: номер экземпляра шины. Новый номер — лента начата заново, seq снова с 1. */
export const INSTANCE_HEADER = "x-bus-instance";

export const seqOfItem = (i: WireItem): number => (i.stream === "monitor" ? i.event.seq : i.line.seq);

/** Машинный код: тот же образец, что у шины. Иное (текст продавца) не переносится (инварианты 1, 4). */
export const WIRE_CODE = /^[A-Z][A-Z0-9_]{0,63}$/;
const CURRENCY = /^[A-Z]{3}$/;
const NAME = /^[a-z][a-z0-9_.]{0,63}$/;
/** Предел длины строки в записи: длиннее — запись не по форме. */
const MAX_STR = 2048;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string" && v.length <= MAX_STR;
const isSeq = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) > 0;
const isIn = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === "string" && (list as readonly string[]).includes(v);
/** Время записи — ISO 8601 UTC, как его пишет шина (`toISOString`). */
const AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const isAt = (v: unknown): v is string => typeof v === "string" && AT.test(v);
/** Идентификатор — машинная строка без пробелов и разметки (инвариант 1: на экране только идентификаторы). */
const ID = /^[A-Za-z0-9_.:-]{1,128}$/;

function parseMoney(v: unknown): WireMoney | undefined {
  if (!isObj(v) || !Number.isSafeInteger(v.minor) || !isStr(v.currency) || !CURRENCY.test(v.currency) || !isObj(v.text)) return undefined;
  const text = v.text;
  if (!WIRE_LANGS.every((l) => isStr(text[l]))) return undefined;
  return { minor: v.minor as number, currency: v.currency, text: { ru: text.ru as string, en: text.en as string } };
}

function parseIds(v: unknown): WireIds | undefined {
  if (!isObj(v)) return undefined;
  const out: WireIds = {};
  for (const k of WIRE_ID_KEYS) {
    if (v[k] === undefined) continue;
    if (typeof v[k] !== "string" || !ID.test(v[k])) return undefined;
    out[k] = v[k];
  }
  return out;
}

function parseMonitor(e: unknown): WireMonitorEvent | undefined {
  if (!isObj(e) || !isSeq(e.seq) || !isAt(e.at) || !isIn(WIRE_SOURCES, e.source) || !isIn(WIRE_CLASSES, e.cls) || !isStr(e.what))
    return undefined;
  const ids = parseIds(e.ids);
  if (!ids) return undefined;
  if (e.status !== undefined && !(Number.isSafeInteger(e.status) && (e.status as number) >= 100 && (e.status as number) <= 599)) return undefined;
  if (e.code !== undefined && !(isStr(e.code) && WIRE_CODE.test(e.code))) return undefined;
  if (e.codeDetail !== undefined && !(isStr(e.codeDetail) && WIRE_CODE.test(e.codeDetail))) return undefined;
  const amount = e.amount === undefined ? undefined : parseMoney(e.amount);
  if (e.amount !== undefined && !amount) return undefined;
  return {
    seq: e.seq,
    at: e.at,
    source: e.source,
    cls: e.cls,
    what: e.what,
    ...(e.status !== undefined && { status: e.status as number }),
    ...(e.code !== undefined && { code: e.code as string }),
    ...(e.codeDetail !== undefined && { codeDetail: e.codeDetail as string }),
    ...(amount && { amount }),
    ids,
  };
}

function parseConsole(l: unknown): WireConsoleLine | undefined {
  if (!isObj(l) || !isSeq(l.seq) || !isAt(l.at) || !isStr(l.kind) || !NAME.test(l.kind)) return undefined;
  const out: Record<string, string | number> = { seq: l.seq, at: l.at, kind: l.kind };
  for (const k of WIRE_CONSOLE_FIELDS) {
    if (l[k] === undefined) continue;
    if (!isStr(l[k])) return undefined;
    out[k] = l[k];
  }
  return out as WireConsoleLine;
}

/** Параметры шагов сюжета, которые экраны получают (инвариант 1): перечень ключей шагов демо-стенда. Ключ вне перечня
 *  не переносится. Ссылка страницы УПК (`upk_url`) экранам не нужна — шага достаточно. */
export const WIRE_SCENARIO_PARAMS = [
  "amount", "candidates", "code", "codes", "confirmation_id", "contour", "delivery_cost", "delivery_days", "delivery_method",
  "limit", "mandate_id", "market", "merchant_id", "op_ref", "order_id", "price", "qty", "reply", "sku", "state", "status",
  "subject", "threshold", "title", "total", "unavailable",
] as const;

/** Шаги, которые на линию дашбордов не идут: код «SMS банка» вводит только человек на странице УПК (инвариант 3).
 *  Перечень ключей общий для всех шагов: новый шаг с одноразовым кодом или иным секретом — сюда, иначе его `code`
 *  пройдёт на линию. Страховка — контрактные тесты на живом стенде (scenarios.test.ts, upk.test.ts; ревью К1.2 Н4). */
export const WIRE_SCENARIO_HIDDEN_STEPS = ["upk.sms"] as const;

/** Запись — шаг сюжета, скрытый по правилу (не испорченная запись: адаптер не считает её отброшенной). */
export const isHiddenScenarioItem = (raw: unknown): boolean =>
  isObj(raw) && raw.stream === "scenario" && isObj(raw.line) && isIn(WIRE_SCENARIO_HIDDEN_STEPS, raw.line.step);

function parseScenario(l: unknown): WireScenarioLine | undefined {
  if (!isObj(l) || !isSeq(l.seq) || !isAt(l.at) || !isStr(l.step) || !NAME.test(l.step) || !isObj(l.params)) return undefined;
  if ((WIRE_SCENARIO_HIDDEN_STEPS as readonly string[]).includes(l.step)) return undefined;
  const params: Record<string, string | number | WireMoney> = {};
  for (const [k, v] of Object.entries(l.params)) {
    if (!isIn(WIRE_SCENARIO_PARAMS, k)) continue;
    if (isStr(v) || (typeof v === "number" && Number.isFinite(v))) params[k] = v;
    else {
      const m = parseMoney(v);
      if (!m) return undefined;
      params[k] = m;
    }
  }
  return { seq: l.seq, at: l.at, step: l.step, params };
}

/** Запись шины из линии; не по форме — undefined (вызывающий считает отброшенные). */
export function parseWireItem(raw: unknown): WireItem | undefined {
  if (!isObj(raw)) return undefined;
  if (raw.stream === "monitor") {
    const event = parseMonitor(raw.event);
    return event && { stream: "monitor", event };
  }
  if (raw.stream === "console") {
    const line = parseConsole(raw.line);
    return line && { stream: "console", line };
  }
  if (raw.stream === "scenario") {
    const line = parseScenario(raw.line);
    return line && { stream: "scenario", line };
  }
  return undefined;
}

// --- Снимок реестров диагностики (Р-1273 п. 3, Р-1275 п. 1) ---

/** Те же перечни, что у формата реестра ядра (К17 agentic-core); свои копии — экраны ядро не импортируют. */
export const DIAG_COMPONENTS = ["core", "pao", "pi", "platform", "agent"] as const;
export const DIAG_SOURCES = ["agent", "platform", "bank", "merchant", "client", "environment"] as const;
export const DIAG_ACTIONS = ["stop", "retry_same_key", "after_fix", "after_human", "new_key"] as const;
export type DiagComponent = (typeof DIAG_COMPONENTS)[number];
export type DiagSource = (typeof DIAG_SOURCES)[number];
export type DiagAction = (typeof DIAG_ACTIONS)[number];

/** Тексты записи: `ru` обязателен, `en` — если есть в реестре. */
export type DiagTexts = { readonly ru: string; readonly en?: string };

export interface DiagEntryWire {
  readonly code: string;
  readonly component: DiagComponent;
  readonly source: readonly DiagSource[];
  readonly action: DiagAction;
  readonly human: DiagTexts;
  readonly operator: DiagTexts;
  readonly norm: string;
  readonly since: string;
}

/** Реестр в снимке: `ready` — записи есть; `pending` — реестр ждёт передачи, записей нет (Р-1275 п. 1). */
export const DIAG_REGISTRY_IDS = ["agent", "merchant", "platform"] as const;
export type DiagRegistryId = (typeof DIAG_REGISTRY_IDS)[number];

export interface DiagRegistryWire {
  readonly id: DiagRegistryId;
  readonly status: "ready" | "pending";
  /** Компоненты кодов реестра; у `pending` — чьи коды ждут передачи. */
  readonly components: readonly DiagComponent[];
  readonly entries: readonly DiagEntryWire[];
}

export interface DiagSnapshot {
  readonly v: 1;
  readonly registries: readonly DiagRegistryWire[];
}

function parseTexts(v: unknown): DiagTexts | undefined {
  if (!isObj(v) || !isStr(v.ru) || v.ru.length === 0) return undefined;
  if (v.en !== undefined && !isStr(v.en)) return undefined;
  return { ru: v.ru, ...(typeof v.en === "string" && { en: v.en }) };
}

/** Запись реестра в снимок: только поля формата К17 и тексты ru/en; иное — не по форме (undefined). */
export function toDiagEntryWire(raw: unknown): DiagEntryWire | undefined {
  if (!isObj(raw) || !isStr(raw.code) || !WIRE_CODE.test(raw.code) || !isIn(DIAG_COMPONENTS, raw.component)) return undefined;
  if (!Array.isArray(raw.source) || raw.source.length === 0 || !raw.source.every((s) => isIn(DIAG_SOURCES, s))) return undefined;
  if (!isIn(DIAG_ACTIONS, raw.action) || !isStr(raw.norm) || !isStr(raw.since)) return undefined;
  const human = parseTexts(raw.human);
  const operator = parseTexts(raw.operator);
  if (!human || !operator) return undefined;
  return {
    code: raw.code,
    component: raw.component,
    source: [...(raw.source as DiagSource[])],
    action: raw.action,
    human,
    operator,
    norm: raw.norm,
    since: raw.since,
  };
}

/** Снимок из линии. Не объект нужной версии — undefined; запись реестра не по форме — отброшена и посчитана. */
export function parseDiagSnapshot(raw: unknown): { snapshot: DiagSnapshot; rejected: number } | undefined {
  if (!isObj(raw) || raw.v !== 1 || !Array.isArray(raw.registries)) return undefined;
  let rejected = 0;
  const registries: DiagRegistryWire[] = [];
  for (const r of raw.registries) {
    if (!isObj(r) || !isIn(DIAG_REGISTRY_IDS, r.id) || (r.status !== "ready" && r.status !== "pending")) {
      rejected++;
      continue;
    }
    if (!Array.isArray(r.components) || !r.components.every((c) => isIn(DIAG_COMPONENTS, c)) || !Array.isArray(r.entries)) {
      rejected++;
      continue;
    }
    const entries: DiagEntryWire[] = [];
    for (const e of r.entries) {
      const w = toDiagEntryWire(e);
      if (w) entries.push(w);
      else rejected++;
    }
    registries.push({ id: r.id, status: r.status, components: [...(r.components as DiagComponent[])], entries });
  }
  return { snapshot: { v: 1, registries }, rejected };
}
