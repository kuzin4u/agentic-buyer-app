// Контролёр «Контроль» (К2.2 DEMO-2; Р-1244, Р-1245, Р-1344, Р-1384, Р-1386): сверка ленты интерпретаций одного прогона
// сюжета с его паспортом (К2.1). По каждому пункту паспорта — «принято», «ждёт» или «не принято» с причиной; итог — «принято
// N из N». Расхождения выносятся владельцу: вердикт приёмки ставит только он (К2.3). Чистая функция: факты — только из
// интерпретаций, время — параметрами; код агента и Платформы не импортируется (Р-1246 п. 3).
//
// Срок ожидания (Р-1384 п. 3, Р-1386): сюжет не закрывается по последнему шагу — события Платформы приходят лентой ПАО и
// отстают от шагов сюжета, а до срока может прийти и нарушение (второе «оплачено», запрещённая запись). Поэтому до срока
// итог — только «ждёт» или «не принято», «принято» — только после срока. Срок = max(начало прогона, последняя запись по часам
// шины) + waitMs; события Платформы (`pao_event`) несут время из ленты ПАО и в отсчёт не входят (ревью К2.2 № 3). Нарушение,
// которое уже видно (запрет, лишнее повторение, порядок), — «не принято» сразу: ожидание его не исправит.
//
// Часы: шаги сюжета и обращения шина демо-стенда штампует часами стенда (`stand.now()`), журнал агента — часами процесса;
// пока часы стенда не сдвигают (`setClock` никто не вызывает), они совпадают. `now` передаётся по тем же часам, что у шины
// (повторное ревью К2.2 № 1; перевод шины на часы процесса — STATUS «Открыто»).
//
// Контракт для нарезки ленты (К2.3; повторное ревью К2.2 № 2, № 6): в прогон входят только записи этого сюжета — от его
// первого шага до первого шага следующего, без фоновых записей вне сюжетов, иначе срок отодвигается без предела. Вердикт
// после срока может смениться при пересчёте, если событие Платформы опоздало сверх срока: экран показывает итог на момент
// пересчёта, а вердикт владельца фиксирует итог, при котором он поставлен.
import type { Interpretation } from "./interpret.js";
import { matches, type Expectation, type Forbid, type Passport } from "./passports.js";

/** Срок ожидания по умолчанию, мс. Не меньше окна перестановки событий Платформы `event_reorder_window_ms` (5000 мс;
 *  сбой Н-12 по умолчанию задерживает событие `operation.*` на это окно) — с запасом втрое на фоновые проходы стенда и
 *  опрос шины: иначе тест Н-12 дал бы «не принято» раньше, чем событие придёт (Р-1386 п. 4). */
export const DEFAULT_WAIT_MS = 15_000;

export type CheckState = "accepted" | "waiting" | "rejected";

/** Почему пункт не принят или ждёт. */
export type CheckReason = "missing" | "too_few" | "too_many" | "order" | "forbidden";

export interface CheckItem {
  readonly id: string;
  readonly what: Expectation["what"];
  /** expect — ожидание паспорта, forbid — запрет. */
  readonly type: "expect" | "forbid";
  readonly state: CheckState;
  /** Причины «ждёт» или «не принято»; первая — главная. */
  readonly reasons: readonly CheckReason[];
  /** Условие выполнено на сейчас (до срока пункт при этом «ждёт»). */
  readonly met: boolean;
  /** Сколько записей совпало и их seq — для разбора владельцем. */
  readonly count: number;
  readonly seqs: readonly number[];
  /** Для ожидания с times — сколько нужно ровно. */
  readonly times?: number;
}

export interface ControlResult {
  readonly no: Passport["no"];
  readonly state: CheckState;
  /** «Принято N из N»: принятые пункты (только после срока) и все пункты паспорта (ожидания и запреты). */
  readonly accepted: number;
  /** Выполнено на сейчас — для экрана до срока («выполнено N, ждём срок»). */
  readonly met: number;
  readonly total: number;
  readonly items: readonly CheckItem[];
  /** Срок ожидания, ISO по часам процесса. */
  readonly deadline: string;
}

export interface ControlOptions {
  /** Сейчас — по часам шины (тем же, что штампуют шаги сюжета и журнал агента). */
  readonly now: Date;
  /** Начало прогона — по часам шины; даёт нарезка ленты на прогоны (К2.3). Неподвижная точка отсчёта срока. */
  readonly startedAt: Date;
  /** Срок ожидания после начала прогона и после его последней записи, мс; по умолчанию DEFAULT_WAIT_MS. */
  readonly waitMs?: number;
}

/** Ошибка входа контролёра: нечитаемое время, неверный срок. */
export class ControlInputError extends Error {}

const time = (d: Date, what: string): number => {
  const v = d.getTime();
  if (!Number.isFinite(v)) throw new ControlInputError(`${what}: время не читается`);
  return v;
};

/** Запись по часам шины: шаг сюжета, журнал агента, обращение на шине; событие Платформы — время из ленты ПАО. */
const processClock = (r: Interpretation) => r.stream !== "monitor" || r.source !== "pao_event";

const first = (seqs: readonly number[]) => (seqs.length > 0 ? Math.min(...seqs) : undefined);

/** Сверка прогона сюжета с паспортом. `list` — интерпретации только этого прогона (порядок не важен). */
export function control(passport: Passport, list: readonly Interpretation[], o: ControlOptions): ControlResult {
  const waitMs = o.waitMs ?? DEFAULT_WAIT_MS;
  if (!Number.isFinite(waitMs) || waitMs < 0) throw new ControlInputError(`срок ожидания не по форме: ${String(waitMs)}`);
  const now = time(o.now, "сейчас");
  let last = time(o.startedAt, "начало прогона");
  for (const r of list) {
    if (!processClock(r)) continue;
    const at = Date.parse(r.at);
    if (!Number.isFinite(at)) throw new ControlInputError(`запись ${r.seq}: время не читается`);
    last = Math.max(last, at);
  }
  const deadline = last + waitMs;
  const open = now < deadline;

  const hits = (e: Forbid) => list.filter((r) => matches(r, e.match)).map((r) => r.seq);
  const expects = passport.expect.map((e) => {
    const seqs = hits(e);
    const reasons: CheckReason[] = [];
    if (e.times !== undefined && seqs.length > e.times) reasons.push("too_many");
    const short = e.times !== undefined ? seqs.length < e.times : seqs.length === 0;
    return { e, seqs, reasons, short };
  });

  // Порядок шагов сюжета (stream scenario): первые совпадения — по возрастанию seq. Отношение «после» — для любых записей.
  let prev = -Infinity;
  for (const x of expects) {
    const f = first(x.seqs);
    if (x.e.match.stream === "scenario" && f !== undefined) {
      if (f < prev) x.reasons.push("order");
      else prev = f;
    }
    if (x.e.after !== undefined && f !== undefined) {
      const before = expects.find((y) => y.e.id === x.e.after);
      const fb = before ? first(before.seqs) : undefined;
      if ((fb === undefined || fb > f) && !x.reasons.includes("order")) x.reasons.push("order");
    }
  }

  const items: CheckItem[] = expects.map(({ e, seqs, reasons, short }) => {
    const all: CheckReason[] = [...reasons];
    if (short) all.push(seqs.length === 0 ? "missing" : "too_few");
    const violated = reasons.length > 0; // too_many и order — видно сразу
    const state: CheckState = violated ? "rejected" : short ? (open ? "waiting" : "rejected") : open ? "waiting" : "accepted";
    return { id: e.id, what: e.what, type: "expect", state, reasons: all, met: !violated && !short, count: seqs.length, seqs, ...(e.times !== undefined && { times: e.times }) };
  });
  for (const f of passport.forbid) {
    const seqs = hits(f);
    const hit = seqs.length > 0;
    items.push({ id: f.id, what: f.what, type: "forbid", state: hit ? "rejected" : open ? "waiting" : "accepted", reasons: hit ? ["forbidden"] : [], met: !hit, count: seqs.length, seqs });
  }

  const state: CheckState = items.some((i) => i.state === "rejected") ? "rejected" : open ? "waiting" : "accepted";
  return {
    no: passport.no,
    state,
    accepted: items.filter((i) => i.state === "accepted").length,
    met: items.filter((i) => i.met).length,
    total: items.length,
    items,
    deadline: new Date(deadline).toISOString(),
  };
}
