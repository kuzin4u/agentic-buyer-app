// К2.3б DEMO-2: лента «Контроля» — прогоны поверх ленты интерпретаций, вердикт владельца (только после срока, фиксирует итог,
// при котором поставлен), пометки раннего запуска, прогон без паспорта, выгрузка Markdown для акта ACC-1 (Р-1395, Р-1396).
import { describe, expect, it } from "vitest";
import { createControlFeed, markdownCell } from "../../src/dashboards/control-feed.js";
import type { FeedEvent, InterpretFeed } from "../../src/dashboards/feed.js";
import type { Interpretation } from "../../src/dashboards/interpret.js";
import { PASSPORTS, type Match } from "../../src/dashboards/passports.js";
import { rawInHumanText } from "./human-text.js";

const T0 = Date.parse("2026-11-09T12:00:00.000Z");
const W = 5000;

function rec(seq: number, m: Match, atMs: number): Interpretation {
  const code = m.code === undefined ? undefined : typeof m.code === "string" ? m.code : m.code[0]!;
  const who =
    code !== undefined || m.verdict !== undefined || m.side !== undefined
      ? { who: { code: code ?? "X", status: "found" as const, side: m.side ?? [], verdict: m.verdict ?? "expected" } }
      : {};
  return {
    seq,
    at: new Date(atMs).toISOString(),
    stream: m.stream ?? "console",
    ref: m.ref ?? "x",
    ...(m.status !== undefined && { status: m.status }),
    ...(m.source !== undefined && { source: m.source[0]! }),
    level: "key",
    stage: "mandate",
    actor: m.actor ?? "agent",
    emulated: false,
    kind: m.kind ?? "norm",
    phrase: { ru: "—", en: "—" },
    ...who,
    ...(m.situation !== undefined && { situation: m.situation }),
  };
}

const P1 = PASSPORTS[0]!;
/** Прогон сюжета 1 по паспорту, начиная с seq `from` и времени `t`. */
const run1 = (from: number, t: number) => P1.expect.flatMap((e, i) => Array.from({ length: e.times ?? 1 }, (_, k) => rec(from + 10 * i + k, e.match, t + 10 * i + k)));

function fakeFeed(initial: Interpretation[] = []) {
  const listeners = new Set<(e: FeedEvent) => void>();
  const feed: InterpretFeed = {
    list: () => initial,
    status: () => "open",
    diag: () => ({ state: "ready" }),
    subscribe: (l) => (listeners.add(l), () => listeners.delete(l)),
    close: async () => undefined,
  };
  const emit = (e: FeedEvent) => listeners.forEach((l) => l(e));
  return { feed, add: (rs: Interpretation[]) => rs.forEach((item) => emit({ type: "item", item })), reset: () => emit({ type: "reset" }) };
}

function setup(initial: Interpretation[] = []) {
  let now = T0;
  const f = fakeFeed(initial);
  const c = createControlFeed(f.feed, { now: () => new Date(now), waitMs: W, tickMs: 0 });
  return { ...f, c, at: (ms: number) => ((now = ms), c.recompute()), vote: (key: number, d: "accepted" | "rejected") => c.verdict(c.epoch(), key, d) };
}

describe("лента «Контроля» (К2.3б)", () => {
  it("вердикт: до срока — WAITING; после — фиксирует итог, при котором поставлен; повторно — ALREADY_SET; чужой ключ — UNKNOWN_RUN", () => {
    const s = setup();
    const list = run1(100, T0);
    s.add(list);
    const end = Math.max(...list.map((r) => Date.parse(r.at)));
    s.at(end + 1);
    expect(s.c.runs()[0]!.result!.state).toBe("waiting");
    expect(s.vote(100, "accepted")).toEqual({ ok: false, code: "WAITING" });
    s.at(end + W);
    const v = s.vote(100, "accepted");
    expect(v).toMatchObject({ ok: true, verdict: { decision: "accepted", state: "accepted", accepted: s.c.runs()[0]!.result!.total, total: s.c.runs()[0]!.result!.total, early: { next: false, prev: false } } });
    expect(s.vote(100, "rejected")).toEqual({ ok: false, code: "ALREADY_SET" });
    expect(s.vote(999, "accepted")).toEqual({ ok: false, code: "UNKNOWN_RUN" });
    // Итог меняется позже (запрет пришёл) — вердикт хранит прежний итог.
    s.add([rec(500, { stream: "monitor", ref: "POST /participants/v1/mandates/{mandate_id}/sign", source: ["agent_platform"] }, end + W + 1)]);
    s.at(end + W + 2);
    expect(s.c.runs()[0]!.result!.state).toBe("rejected");
    expect(s.c.runs()[0]!.verdict).toMatchObject({ decision: "accepted", state: "accepted" });
  });

  it("ранний запуск: следующий сюжет до срока предыдущего — пометки у обоих; в вердикте и выгрузке (Р-1396 п. 2)", () => {
    const s = setup();
    const a = run1(100, T0);
    const endA = Math.max(...a.map((r) => Date.parse(r.at)));
    const b = run1(200, endA + 1000); // до срока предыдущего (W = 5000)
    s.add([...a, ...b]);
    const endB = Math.max(...b.map((r) => Date.parse(r.at)));
    s.at(endB + W);
    const [ra, rb] = s.c.runs();
    expect(ra!.early).toEqual({ next: true, prev: false });
    expect(rb!.early).toEqual({ next: false, prev: true });
    const v = s.vote(100, "rejected");
    expect(v).toMatchObject({ ok: true, verdict: { early: { next: true, prev: false } } });
    const md = s.c.markdown("ru");
    expect(md).toContain("следующий сюжет запущен до срока — события Платформы могли попасть в чужой прогон");
    expect(md).toContain("запущен до срока предыдущего");
    // Запуск после срока — без пометок.
    const t = setup();
    const c2 = run1(300, endA + W + 10);
    t.add([...a, ...c2]);
    t.at(Math.max(...c2.map((r) => Date.parse(r.at))) + W);
    expect(t.c.runs().map((r) => r.early)).toEqual([
      { next: false, prev: false },
      { next: false, prev: false },
    ]);
  });

  it("метка неизвестного сюжета — прогон без итога; вердикт NO_PASSPORT; в выгрузке — «паспорта нет» (ревью К2.3а № 5)", () => {
    const s = setup();
    s.add([rec(10, { stream: "scenario", ref: "run.unknown" }, T0), rec(11, { stream: "monitor", ref: "GET /v1/shops" }, T0 + 1)]);
    s.at(T0 + 3_600_000);
    expect(s.c.runs()).toHaveLength(1);
    expect(s.c.runs()[0]).toMatchObject({ key: 10, name: "unknown" });
    expect(s.c.runs()[0]!.result).toBeUndefined();
    expect(s.vote(10, "accepted")).toEqual({ ok: false, code: "NO_PASSPORT" });
    expect(s.c.markdown("ru")).toContain("паспорта нет — сюжет не сверяется");
    expect(s.c.markdown("en")).toContain("no passport — the scenario is not checked");
  });

  it("выгрузка ACC-1: таблица Markdown на ru и en — сюжет, итог, «принято N из N», вердикт, не принятые пункты словами без кодов", () => {
    const s = setup();
    const list = run1(100, T0).filter((r) => r.ref !== "mandate.signed");
    s.add(list);
    s.at(Math.max(...list.map((r) => Date.parse(r.at))) + W);
    s.vote(100, "rejected");
    const ru = s.c.markdown("ru");
    const en = s.c.markdown("en");
    expect(ru.split("\n")[0]).toBe("# Акт ACC-1 — прогоны сюжетов приёмки демо-стенда");
    expect(ru).toContain("| № | Сюжет | Начало | Итог контролёра | Принято | Вердикт владельца | Пометки | Не принято / ждёт |");
    expect(ru).toContain("1. Подпись поручения");
    expect(ru).toContain("не принят владельцем");
    expect(ru).toContain("Платформа: поручение подписано — не принято (нет записи)");
    expect(en).toContain("Platform: mandate signed — not accepted (no record)");
    const rows = ru.split("\n").filter((l) => l.startsWith("| 100 "));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.split(" | ").length).toBe(8);
    // Текст для человека — без кодов и имён полей (ISO-время и номера — не коды).
    for (const [lang, md] of [["ru", ru], ["en", en]] as const)
      for (const line of md.split("\n").filter((l) => l.startsWith("| 100 "))) expect(rawInHumanText(line.replace(/\d{4}-\d\d-\d\dT[\d:.]+Z/g, ""), lang)).toBeUndefined();
  });

  it("перезапуск источника — прогоны и вердикты сброшены; снимок источника при создании учитывается", () => {
    const list = run1(100, T0);
    const s = setup(list);
    s.at(Math.max(...list.map((r) => Date.parse(r.at))) + W);
    expect(s.c.runs()).toHaveLength(1);
    expect(s.vote(100, "accepted").ok).toBe(true);
    s.reset();
    expect(s.c.runs()).toEqual([]);
  });

  it("«не принято» до срока — вердикт WAITING и closed: false; после срока — вердикт ставится (ревью К2.3б № 1, № 2)", () => {
    const s = setup();
    const list = [...run1(100, T0), rec(500, { stream: "monitor", ref: "POST /participants/v1/mandates/{mandate_id}/sign", source: ["agent_platform"] }, T0 + 200)];
    s.add(list);
    const end = Math.max(...list.map((r) => Date.parse(r.at)));
    s.at(end + 1);
    expect(s.c.runs()[0]).toMatchObject({ closed: false, result: { state: "rejected" } });
    expect(s.vote(100, "rejected")).toEqual({ ok: false, code: "WAITING" });
    s.at(end + W);
    expect(s.c.runs()[0]!.closed).toBe(true);
    expect(s.vote(100, "rejected")).toMatchObject({ ok: true, verdict: { state: "rejected" } });
  });

  it("поколение ленты: вердикт с чужим или прежним поколением — STALE и не ложится на новый прогон с тем же номером (ревью К2.3б № 7)", () => {
    const s = setup();
    const list = run1(100, T0);
    s.add(list);
    const end = Math.max(...list.map((r) => Date.parse(r.at)));
    s.at(end + W);
    const old = s.c.epoch();
    expect(s.c.verdict("чужое", 100, "accepted")).toEqual({ ok: false, code: "STALE" });
    s.reset();
    expect(s.c.epoch()).not.toBe(old);
    s.add(list); // новый прогон с тем же номером метки
    s.at(end + W);
    expect(s.c.verdict(old, 100, "accepted")).toEqual({ ok: false, code: "STALE" });
    expect(s.c.runs()[0]!.verdict).toBeUndefined();
    const got: string[] = [];
    s.c.subscribe((e) => got.push(e.epoch));
    s.add([rec(900, { stream: "monitor", ref: "GET /v1/shops" }, end + W + 1)]);
    expect(got).toEqual([s.c.epoch()]);
  });

  it("кавычки и разделители строки вердикта — по языку выгрузки: в английской без «ёлочек» (ревью К2.3б № 8)", () => {
    const s = setup();
    const list = run1(100, T0);
    s.add(list);
    s.at(Math.max(...list.map((r) => Date.parse(r.at))) + W);
    s.vote(100, "accepted");
    expect(s.c.markdown("ru")).toContain("при итоге «принято», ");
    const en = s.c.markdown("en");
    expect(en).toContain("at outcome “accepted”, ");
    expect(en).not.toMatch(/[«»]/);
  });

  it("ячейка выгрузки (К2.3в; CodeQL js/incomplete-sanitization): «\\» первым, «|», перевод строки, «& < >» — колонка не распадается, HTML не проходит", () => {
    expect(markdownCell("a\\|b")).toBe("a\\\\\\|b");
    expect(markdownCell("a|b")).toBe("a\\|b");
    expect(markdownCell("a\r\nb\nc")).toBe("a b c");
    expect(markdownCell("<i>&amp;</i>")).toBe("&lt;i&gt;&amp;amp;&lt;/i&gt;");
    // Метка неизвестного сюжета с «\|» и HTML в имени: в строке выгрузки — ровно 8 колонок, тегов нет.
    const s = setup();
    s.add([rec(10, { stream: "scenario", ref: "run.a\\|b<i>x</i>\nz" }, T0)]);
    s.at(T0 + 3_600_000);
    const row = s.c.markdown("ru").split("\n").find((l) => l.startsWith("| 10 "))!;
    // Разделитель колонки — «|», перед которым чётное число «\».
    const seps = [...row.matchAll(/(\\*)\|/g)].filter((m) => m[1]!.length % 2 === 0).length;
    expect(seps).toBe(9); // 8 колонок — 9 разделителей
    expect(row).not.toMatch(/<[a-z/]/i);
    // Имя — в ячейке целиком, экранированным (повторное ревью К2.3в № 1).
    expect(row).toContain("| a\\\\\\|b&lt;i&gt;x&lt;/i&gt; z |");
  });

  it("слушатель получает прогоны при изменении, без повторов одного и того же", () => {
    const s = setup();
    const got: number[] = [];
    s.c.subscribe((e) => got.push(e.runs.length));
    s.add(run1(100, T0).slice(0, 1));
    s.at(T0 + 1);
    s.at(T0 + 1);
    expect(got).toEqual([1]);
  });
});
