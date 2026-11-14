// П-11.5б (Р-1533; П10, П14, П15, П16): прогон 25 тестов задания v1.1 на своём стенде и акт ACC-1 из файла теста. Только при
// `PULT_25=1` — в `npm test` пропускается (≈ 6–8 мин). Акт автоматического прогона собирается здесь, с пометкой «роль оператора
// играл тест» у У-01…У-04 (`operatorByTest`, Б5; П16 п. 5 — вариант (а)): стенд свой, пульт владельца к нему не подключён.
//
// Порядок (план #issuecomment-6880932177, ответ чата #issuecomment-6881016969): сначала правильные П-xx; затем сюжеты 4 и 2 в
// режиме оператора (клиент отвечает через 16 с, «Напомнить» — маршрутом `/pult/act/remind`): один прогон судит П-02 / У-03 /
// У-04, другой — П-01 / У-02; затем Н-xx «П» (взвод маршрутом во время сюжета) и Н-xx «ПР» (драйвер при «Авто»); У-01 —
// последним прогоном `intent` (строка берёт последний завершённый чистый прогон сюжета, Б5). Н-02 не взводится —
// «не проверено» с причиной (П11); Н-10 — «нет случая».
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { BusItem, ScenarioLine } from "../../src/demo/bus.js";
import { startDemo, type Demo } from "../../src/demo/run.js";
import { acc1Csv, acc1CsvExcel, acc1Markdown } from "../../src/pult/acc1.js";
import type { PultFeed } from "../../src/pult/feed.js";

const RUN = process.env.PULT_25 === "1";
/** Порог «Идёт к нарушению» — 15 с; клиент отвечает позже на 1,5 с. */
const SLOW_MS = 16_500;
/** Срок поручения сюжета 10, с (как в `more-scenarios.test.ts`). */
const EXPIRY = 6;
/** Порт стенда приёмки владельца (Р-1477): против него прогон не идёт. */
const ACCEPTANCE_PORT = "8787";

const cap = vi.hoisted(() => ({ feed: undefined as PultFeed | undefined }));
vi.mock("../../src/pult/feed.js", async (orig) => {
  const m = await orig<typeof import("../../src/pult/feed.js")>();
  return {
    ...m,
    createPultFeed: (...a: Parameters<typeof m.createPultFeed>) => {
      cap.feed = m.createPultFeed(...a);
      return cap.feed;
    },
  };
});

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!RUN)("П-11.5б: прогон 25 тестов и акт ACC-1 (только при PULT_25=1)", { timeout: 1_200_000 }, () => {
  let demo: Demo;
  beforeAll(async () => {
    demo = await startDemo({ faults: true, expirySec: EXPIRY });
  }, 60_000);
  afterAll(async () => {
    await demo?.close();
  });

  /** Страховка П16 п. 5: прогон работает только со своим стендом — поднятым этим тестом, на своём адресе. */
  function ownStandOrFail(): PultFeed {
    const u = new URL(demo.monitor.url);
    const why = !["127.0.0.1", "localhost"].includes(u.hostname)
      ? `адрес ${u.host} — не локальный`
      : u.port === ACCEPTANCE_PORT
        ? `порт ${ACCEPTANCE_PORT} — стенд приёмки владельца (Р-1477)`
        : cap.feed === undefined
          ? "лента пульта создана не этим процессом"
          : undefined;
    if (why) throw new Error(`прогон 25 тестов идёт только против своего стенда, поднятого тестом: ${why}. Акт не пишется.`);
    return cap.feed!;
  }

  const post = (path: string) => fetch(`${demo.monitor.url}${path}`, { method: "POST", headers: { origin: demo.monitor.url } });
  const steps = (): ScenarioLine[] => demo.bus.history().flatMap((i: BusItem) => (i.stream === "scenario" ? [i.line] : []));
  const lastSeq = () => demo.bus.history().reduce((m, i) => Math.max(m, i.stream === "monitor" ? i.event.seq : i.stream === "scenario" ? i.line.seq : 0), 0);
  async function until<T>(what: string, f: () => T | undefined, ms = 60_000): Promise<T> {
    const end = Date.now() + ms;
    for (;;) {
      const v = f();
      if (v !== undefined) return v;
      if (Date.now() > end) throw new Error(`не дождались: ${what}`);
      await pause(50);
    }
  }
  const step = (from: number, name: string, ms?: number) => until(`шаг ${name}`, () => steps().find((x) => x.seq > from && x.step === name), ms);
  const anyStep = (from: number, names: readonly string[], ms?: number) => until(`шаг ${names.join(" | ")}`, () => steps().find((x) => x.seq > from && names.includes(x.step)), ms);
  const event = (from: number, what: string, pred: (ids: Record<string, unknown>) => boolean = () => true, ms?: number) =>
    until(`событие ${what}`, () => demo.bus.history().find((i) => i.stream === "monitor" && i.event.seq > from && i.event.what === what && pred(i.event.ids as Record<string, unknown>)), ms);
  const ok = async (r: Promise<Response>, what: string, want = 202) => {
    const res = await r;
    if (res.status !== want) throw new Error(`${what}: ${res.status} ${await res.text()}`);
    return res;
  };
  /** Шина затихла: сюжеты закончены, длина истории не меняется 2 с (события Платформы приходят лентой ПАО позже шагов). */
  async function quiet(): Promise<void> {
    await demo.scenarios.settled();
    let seen = -1;
    for (let i = 0; i < 60 && seen !== demo.bus.history().length; i++) {
      seen = demo.bus.history().length;
      demo.bus.poll();
      await pause(2_000);
    }
  }
  const sign = async (id: string, decision?: { decision: "REJECT" }) => {
    const r = await demo.stand.stand.issuer.sign(id, decision ?? {});
    if (r.statusCode !== 200) throw new Error(`подпись ${id}: ${r.statusCode}`);
  };

  /** Поручение сюжета: кнопка, подпись клиентом (через `delayMs` — режим оператора У-01), событие Платформы о подписи. */
  async function intent(name: string, delayMs = 0): Promise<string> {
    const n = lastSeq();
    await ok(post(`/scenario/${name}`), name);
    const w = await step(n, "intent.awaiting_signature");
    const id = String(w.params.mandate_id);
    if (delayMs > 0) await pause(delayMs);
    await sign(id);
    await step(n, "intent.signed");
    await event(n, "mandate.signed", (ids) => ids.mandate_id === id, 30_000);
    return id;
  }
  /** Корзина до решения клиента: карточка, согласие человека, подпись корзины (через `delayMs` — У-02); `onCard` — взвод сбоя. */
  async function cart(from: number, o: { delayMs?: number; reject?: boolean; onCard?: () => Promise<void> } = {}): Promise<string> {
    await step(from, "cart.card");
    if (o.onCard) await o.onCard();
    await ok(post("/scenario/cart/accept"), "cart/accept");
    const cw = await step(from, "cart.awaiting_signature");
    const id = String(cw.params.mandate_id);
    if (o.delayMs) await pause(o.delayMs);
    await sign(id, o.reject ? { decision: "REJECT" } : undefined);
    return id;
  }
  /** Подтверждение на странице УПК кодом из «SMS банка». */
  async function upkAnswer(from: number, decision: "APPROVE" | "REJECT") {
    const req = await step(from, "upk.required");
    const sms = await step(from, "upk.sms");
    const r = await fetch(String(req.params.upk_url), {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ decision, instrument: "CARD", code: String(sms.params.code) }).toString(),
    });
    if (r.status !== 200) throw new Error(`страница УПК: ${r.status}`);
  }
  const arm = (test: string) => ok(post(`/stand-fault/${encodeURIComponent(test)}/arm`), `взвод ${test}`, 200);
  const disarm = (test: string) => ok(post(`/stand-fault/${encodeURIComponent(test)}/disarm`), `снятие ${test}`, 200);

  it("25 строк: П-xx и У-xx — «да», Н-xx — «да», Н-02 — «не проверено» (П11), Н-10 — «нет случая»; акт — файлом с пометкой провенанса", async () => {
    const feed = ownStandOrFail();
    const t0 = Date.now();
    demo.clientEmulator!.setAuto(false);

    // ——— П-xx: правильные сюжеты ———
    // П-03 (сюжет 6): отказ клиента от корзины.
    let n = lastSeq();
    await intent("intent");
    await ok(post("/scenario/reject"), "reject");
    const rejected = await cart(n, { reject: true });
    await step(n, "cart.rejected");
    await event(n, "mandate.rejected", (ids) => ids.mandate_id === rejected, 30_000);
    await quiet();
    // П-05 (сюжет 3): лимит клиента.
    n = lastSeq();
    await intent("intent");
    await ok(post("/scenario/limit"), "limit");
    await cart(n);
    await step(n, "limit.declined");
    await step(n, "bank.limit_reset");
    await quiet();
    // П-08 (сюжет 5): отзыв поручения клиентом.
    n = lastSeq();
    const revoked = await intent("intent");
    await ok(post("/scenario/revoke"), "revoke");
    await step(n, "revoke.ask");
    if ((await demo.stand.stand.issuer.revoke(revoked)).statusCode !== 200) throw new Error("отзыв поручения");
    await step(n, "revoke.refused");
    await quiet();
    // П-07 (сюжет 9): агент приостановлен оператором Системы.
    n = lastSeq();
    await intent("intent");
    await ok(post("/scenario/suspended"), "suspended");
    await step(n, "cart.card");
    await ok(post("/scenario/cart/accept"), "cart/accept");
    const s9 = await anyStep(n, ["suspend.resumed", "suspend.resume_failed", "operator.reinstate_failed", "failed"]);
    if (s9.step !== "suspend.resumed") throw new Error(`сюжет 9: ${s9.step}`);
    await event(n, "agent.reinstated", () => true, 30_000);
    await quiet();
    // П-06 (сюжет 8): продавец вне поручения.
    n = lastSeq();
    await intent("scope");
    await step(n, "cart.card");
    await ok(post("/scenario/cart/accept"), "cart/accept");
    const s8 = await anyStep(n, ["scope.refused", "scope.not_refused", "failed"]);
    if (s8.step !== "scope.refused") throw new Error(`сюжет 8: ${s8.step}`);
    await quiet();
    // П-09 (сюжет 10): срок поручения истёк.
    n = lastSeq();
    await intent("expired");
    const s10 = await anyStep(n, ["expiry.refused", "failed"], 120_000);
    if (s10.step !== "expiry.refused") throw new Error(`сюжет 10: ${s10.step}`);
    await quiet();
    // П-04 (сюжет 7): клиент не подтвердил — срок подтверждения истёк (в режиме сбоев 45 с). Стенд запрос сам не
    // просрочивает — истечение при обращении: ответ банка после срока — 409 EXPIRED и `confirmation.expired`
    // (`more-scenarios.test.ts`, сюжет 7, обычный прогон).
    n = lastSeq();
    await intent("unconfirmed");
    await cart(n);
    const cid = String((await step(n, "upk.required")).params.confirmation_id);
    const crec = await demo.stand.stand.confirmations.get(cid);
    while (demo.stand.stand.now().getTime() <= Date.parse(String(crec!.expires_at))) await pause(500);
    await pause(1_000);
    if ((await demo.stand.stand.issuer.confirm(cid)).statusCode !== 409) throw new Error("П-04: ответ банка после срока не 409");
    await step(n, "upk.declined", 30_000);
    await event(n, "confirmation.expired", () => true, 30_000);
    await quiet();

    // ——— режим оператора: П-02 / У-03 / У-04 (сюжет 4) ———
    n = lastSeq();
    await intent("upk");
    await cart(n);
    const req = await event(n, "confirmation.required");
    const q = String((req.stream === "monitor" && req.event.ids.confirmation_id) || "");
    if (!q) throw new Error("номер запроса подтверждения");
    // Оператор ждёт порога «Идёт к нарушению» и жмёт «Напомнить клиенту»; клиент подтверждает после напоминания.
    await pause(SLOW_MS);
    const remind = await ok(post(`/pult/act/remind?confirmation=${encodeURIComponent(q)}`), "Напомнить клиенту", 200);
    const rr = (await remind.json()) as { outcome?: string };
    if (rr.outcome !== "done") throw new Error(`«Напомнить клиенту»: ${JSON.stringify(rr)}`);
    await upkAnswer(n, "APPROVE");
    await step(n, "outcome", 90_000);
    await quiet();
    // ——— режим оператора: П-01 / У-02 (сюжет 2): клиент даёт согласие на корзину через 16 с ———
    n = lastSeq();
    await intent("intent");
    await ok(post("/scenario/purchase"), "purchase");
    await cart(n, { delayMs: SLOW_MS });
    await step(n, "outcome", 90_000);
    await quiet();

    // ——— Н-xx «П»: взвод маршрутом во время сюжета, снятие после итога ———
    for (const test of ["Н-03", "Н-04", "Н-12"] as const) {
      n = lastSeq();
      await intent("intent");
      await ok(post("/scenario/purchase"), "purchase");
      // Н-03, Н-04 — на витрину карточки (продавец по умолчанию — пока сюжет идёт); Н-12 — задержка итога по умолчанию.
      await cart(n, { onCard: () => arm(test).then(() => undefined) });
      await step(n, "outcome", 90_000);
      await quiet();
      await disarm(test);
    }
    // Н-11 (R20): код УПК утёк — сюжет 4, взвод до запроса подтверждения.
    n = lastSeq();
    await arm("Н-11");
    await intent("upk");
    await cart(n);
    await upkAnswer(n, "APPROVE");
    await anyStep(n, ["outcome", "upk.declined", "failed"], 90_000);
    await quiet();
    await disarm("Н-11");

    // ——— Н-xx «ПР»: драйвер нарушителя при «Авто» ———
    demo.clientEmulator!.setAuto(true);
    for (const test of ["Н-01", "Н-05", "Н-06", "Н-07", "Н-08", "Н-09"] as const) {
      const r = demo.faulty!.start(test);
      if (!r.ok) throw new Error(`драйвер ${test}: ${r.code}`);
      await demo.faulty!.settled();
      await quiet();
    }
    demo.clientEmulator!.setAuto(false);

    // ——— У-01 (сюжет 1): клиент подписывает поручение через 16 с — последним прогоном `intent` ———
    await intent("intent", SLOW_MS);
    await quiet();
    // Срок последнего прогона (15 с после последней записи) — строка берёт только завершённый прогон (Б5).
    await pause(16_000);
    await quiet();

    // ——— отчёт и акт ———
    ownStandOrFail();
    const r0 = performance.now();
    const rep = feed.report();
    const reportMs = Math.round(performance.now() - r0);
    expect(rep).toBeDefined();
    const at = rep!.builtAt;
    const commit = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
    const dirty = execSync("git status --porcelain --untracked-files=no", { encoding: "utf8" }).trim() !== "";
    const out = process.env.PULT_25_OUT ?? join(tmpdir(), `acc1-run-${at.replace(/[:.]/g, "-")}`);
    mkdirSync(out, { recursive: true });
    const opts = { operatorByTest: true } as const;
    for (const lang of ["ru", "en"] as const) {
      writeFileSync(join(out, `acc1-${lang}.md`), acc1Markdown(rep!.table, lang, rep!.records, opts));
      writeFileSync(join(out, `acc1-${lang}.csv`), acc1Csv(rep!.table, lang, rep!.records, opts));
      writeFileSync(join(out, `acc1-${lang}-excel.csv`), acc1CsvExcel(rep!.table, lang, rep!.records, opts));
    }
    const rows = rep!.table.rows.map((r) => [r.test, r.agree, r.run ?? "", r.fact.ru] as const);
    const boardBytes = Buffer.byteLength(JSON.stringify(feed.board()));
    const summary = [
      `# Прогон 25 тестов (П-11.5б)`,
      ``,
      `- коммит прогона: ${commit}${dirty ? " (+ незакоммиченные правки в отслеживаемых файлах)" : ""}`,
      `- время сборки акта: ${at}`,
      `- длительность прогона: ${Math.round((Date.now() - t0) / 1000)} с`,
      `- длительность report(): ${reportMs} мс (П-11.5а № 16: правка при > 1000 мс)`,
      `- записей на шине: ${demo.bus.history().length} (окно ленты — 20 000; П15 п. 3)`,
      `- объём доски: ${boardBytes} байт (Р-1521: > ≈ 200 КБ — строкой в STATUS)`,
      `- итог: ${JSON.stringify(rep!.table.totals)}`,
      ``,
      ...rows.map(([t, a, run, f]) => `- ${t} — ${a} — ${run} — ${f}`),
    ].join("\n");
    writeFileSync(join(out, "summary.md"), summary + "\n");
    console.log(`П-11.5б: акт и сводка — ${out}\n${summary}`);

    const want: Record<string, string> = Object.fromEntries(rep!.table.rows.map((r) => [r.test, "yes"]));
    want["Н-02"] = "unchecked";
    want["Н-10"] = "no_case";
    expect(Object.fromEntries(rep!.table.rows.map((r) => [r.test, r.agree]))).toEqual(want);
  });
});
