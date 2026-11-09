// Лента «Контроля» (К2.3б DEMO-2; Р-1391, Р-1395, Р-1396): прогоны сюжетов поверх ленты интерпретаций К1.4 — нарезка по
// меткам (К2.3а), пересчёт контролёром (К2.2) на каждой записи и по таймеру до срока, вердикт владельца, выгрузка для акта
// ACC-1. Переходит в «Контроль» пульта (П-4) без переделки. Код агента и Платформы не импортируется (Р-1246 п. 3).
//
// Вердикт (Р-1391, ответ 4; Р-1396): ставит только владелец, только после срока ожидания, фиксирует итог, при котором
// поставлен, вместе с пометкой раннего запуска. Хранится в памяти процесса — при перезапуске стенда пропадает (STATUS
// «Открыто», после MVP). Перезапуск источника (новые seq) сбрасывает прогоны и вердикты.
//
// Ранний запуск (ревью К2.3а № 2, Р-1396 п. 2): если следующий сюжет начат раньше срока ожидания предыдущего, событие
// Платформы предыдущего могло попасть в следующий прогон — оба помечаются; пометка видна у вердикта и в выгрузке. Относить
// события к прогону по идентификаторам — П-4 (STATUS «Открыто»).
import { randomUUID } from "node:crypto";
import { control, DEFAULT_WAIT_MS, splitRuns, type CheckState, type ControlResult } from "./control.js";
import type { FeedEvent, InterpretFeed } from "./feed.js";
import type { Interpretation } from "./interpret.js";
import type { Texts } from "./passports.js";
import { CONTROL } from "./phrases.js";
import type { WireLang } from "./wire.js";

export type Decision = "accepted" | "rejected";

export interface OwnerVerdict {
  readonly decision: Decision;
  /** Когда поставлен — по часам шины. */
  readonly at: string;
  /** Итог контролёра, при котором поставлен. */
  readonly state: CheckState;
  readonly accepted: number;
  readonly total: number;
  /** Пометки раннего запуска на момент вердикта. */
  readonly early: { readonly next: boolean; readonly prev: boolean };
}

export interface RunView {
  /** Ключ прогона — seq метки начала. */
  readonly key: number;
  readonly name: string;
  readonly no?: number;
  readonly title?: Texts;
  readonly startedAt: string;
  /** Итог контролёра; нет — паспорта нет, прогон не сверяется. */
  readonly result?: ControlResult;
  /** Срок ожидания вышел: только тогда владелец ставит вердикт (Р-1391, Р-1396; ревью К2.3б № 1 — по сроку, не по итогу:
   *  «не принято» бывает и до срока, а пометка раннего запуска до срока ещё может измениться). */
  readonly closed: boolean;
  readonly early: { readonly next: boolean; readonly prev: boolean };
  readonly verdict?: OwnerVerdict;
}

/** `epoch` — поколение ленты: новое при создании и при перезапуске источника (номера seq начинаются заново). Экран шлёт
 *  его с вердиктом; вердикт со страницы прежнего поколения не ложится на новый прогон с тем же номером (ревью К2.3б № 7). */
export type ControlFeedEvent = { readonly type: "runs"; readonly epoch: string; readonly runs: readonly RunView[] };

export type VerdictResult =
  | { readonly ok: true; readonly verdict: OwnerVerdict }
  | { readonly ok: false; readonly code: "STALE" | "UNKNOWN_RUN" | "NO_PASSPORT" | "WAITING" | "ALREADY_SET" };

export interface ControlFeed {
  runs(): readonly RunView[];
  epoch(): string;
  subscribe(l: (e: ControlFeedEvent) => void): () => void;
  verdict(epoch: string, key: number, decision: Decision): VerdictResult;
  /** Markdown-таблица для акта ACC-1 на языке экрана. */
  markdown(lang: WireLang): string;
  close(): void;
}

export interface ControlFeedOptions {
  /** Сейчас — по часам шины (локальный стенд — часы процесса). */
  readonly now: () => Date;
  readonly waitMs?: number;
  /** Период пересчёта по таймеру, пока у прогонов идёт срок; 0 — без таймера (тест вызывает пересчёт сам). */
  readonly tickMs?: number;
}

export function createControlFeed(feed: InterpretFeed, o: ControlFeedOptions): ControlFeed & { recompute(): void } {
  const waitMs = o.waitMs ?? DEFAULT_WAIT_MS;
  const items = new Map<number, Interpretation>();
  const verdicts = new Map<number, OwnerVerdict>();
  const listeners = new Set<(e: ControlFeedEvent) => void>();
  let views: RunView[] = [];
  let last = "";
  let epoch = randomUUID();

  for (const r of feed.list()) items.set(r.seq, r);

  const recompute = () => {
    const now = o.now();
    const runs = splitRuns([...items.values()]);
    const results = runs.map((r) => (r.passport ? control(r.passport, r.items, { now, startedAt: r.startedAt, waitMs }) : undefined));
    views = runs.map((r, i) => {
      const deadline = results[i] ? Date.parse(results[i]!.deadline) : r.startedAt.getTime() + waitMs;
      const next = runs[i + 1];
      const prevDeadline = i > 0 ? (results[i - 1] ? Date.parse(results[i - 1]!.deadline) : runs[i - 1]!.startedAt.getTime() + waitMs) : undefined;
      const v = verdicts.get(r.startSeq);
      return {
        key: r.startSeq,
        name: r.name,
        ...(r.passport && { no: r.passport.no, title: r.passport.title }),
        startedAt: r.startedAt.toISOString(),
        ...(results[i] && { result: results[i] }),
        closed: now.getTime() >= deadline,
        early: { next: next !== undefined && next.startedAt.getTime() < deadline, prev: prevDeadline !== undefined && r.startedAt.getTime() < prevDeadline },
        ...(v && { verdict: v }),
      };
    });
    const json = epoch + JSON.stringify(views);
    if (json === last) return;
    last = json;
    for (const l of listeners) {
      try {
        l({ type: "runs", epoch, runs: views });
      } catch {
        // Слушатель (соединение экрана) упал — остальные получают дальше.
      }
    }
  };

  const off = feed.subscribe((e: FeedEvent) => {
    if (e.type === "item") items.set(e.item.seq, e.item);
    else if (e.type === "reset") {
      items.clear();
      verdicts.clear();
      epoch = randomUUID();
    } else return;
    recompute();
  });
  const timer = o.tickMs === 0 ? undefined : setInterval(() => recompute(), o.tickMs ?? 1000);
  timer?.unref();
  recompute();

  const L = (k: keyof typeof CONTROL, lang: WireLang) => CONTROL[k][lang];
  const cell = markdownCell;

  return {
    runs: () => views,
    epoch: () => epoch,
    subscribe(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    verdict(from, key, decision) {
      recompute();
      if (from !== epoch) return { ok: false, code: "STALE" };
      const v = views.find((x) => x.key === key);
      if (!v) return { ok: false, code: "UNKNOWN_RUN" };
      if (!v.result) return { ok: false, code: "NO_PASSPORT" };
      if (!v.closed) return { ok: false, code: "WAITING" };
      if (verdicts.has(key)) return { ok: false, code: "ALREADY_SET" };
      const verdict: OwnerVerdict = {
        decision,
        at: o.now().toISOString(),
        state: v.result.state,
        accepted: v.result.accepted,
        total: v.result.total,
        early: v.early,
      };
      verdicts.set(key, verdict);
      recompute();
      return { ok: true, verdict };
    },
    markdown(lang) {
      const head = (["col.no", "col.scenario", "col.started", "col.state", "col.accepted", "col.verdict", "col.notes", "col.failed"] as const).map((k) => L(k, lang));
      const rows = views.map((v) => {
        const notes = [v.early.next && L("early.next", lang), v.early.prev && L("early.prev", lang)].filter(Boolean).join("; ");
        if (!v.result) return [String(v.key), v.name, v.startedAt, L("no.passport", lang), "—", "—", notes || L("export.none", lang), "—"];
        const r = v.result;
        const failed = r.items
          .filter((i) => i.state !== "accepted")
          .map((i) => `${i.what[lang]} — ${L(`state.${i.state}`, lang)}${i.reasons.length ? ` (${i.reasons.map((x) => L(`reason.${x}`, lang)).join(", ")})` : ""}`)
          .join("; ");
        const verdict = v.verdict
          ? `${L(v.verdict.decision === "accepted" ? "verdict.accepted" : "verdict.rejected", lang)}, ${v.verdict.at} — ${L("verdict.at", lang)} ${L("q.open", lang)}${L(`state.${v.verdict.state}`, lang)}${L("q.close", lang)}, ${v.verdict.accepted} ${L("of", lang)} ${v.verdict.total}`
          : L("export.no_verdict", lang);
        return [String(v.key), v.title![lang], v.startedAt, L(`state.${r.state}`, lang), `${r.accepted} ${L("of", lang)} ${r.total}`, verdict, notes || L("export.none", lang), failed || L("export.none", lang)];
      });
      return [
        `# ${L("export.title", lang)}`,
        "",
        `| ${head.join(" | ")} |`,
        `|${head.map(() => "---").join("|")}|`,
        ...rows.map((r) => `| ${r.map(cell).join(" | ")} |`),
        "",
      ].join("\n");
    },
    close() {
      off();
      if (timer) clearInterval(timer);
      listeners.clear();
    },
    recompute,
  };
}

/** Ячейка Markdown-таблицы выгрузки для акта ACC-1 (К2.3в; находка CodeQL `js/incomplete-sanitization` на PR #7):
 *  сначала «\» — иначе «\|» из входа стал бы «\\|», то есть экранированная косая и настоящий разделитель колонки; затем «|»;
 *  перевод строки — пробел; затем «&» (первым из сущностей), «<», «>» — чтобы HTML в акте не отрисовывался. */
export function markdownCell(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\|")
    .replace(/[\r\n]+/g, " ")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
