// Прогон пяти сюжетов приёмки на живом стенде для тестов дашбордов (К1.3 DEMO-2 ч. 1). Подпись и подтверждение — эмулятором
// банка и формой страницы УПК, как в тестах сюжетов (П2 п. 5: подпись за человека — только в автотестах).
// Возвращает записи шины сюжета в формате линии дашбордов (parseWireItem) — то, что видят экраны.
import type { BusItem, ScenarioLine } from "../../src/demo/bus.js";
import { parseWireItem, type WireItem } from "../../src/dashboards/wire.js";
import type { Demo } from "../../src/demo/run.js";

export type ScenarioNo = 1 | 2 | 3 | 4 | 5 | 6 | 7;

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function driver(demo: Demo) {
  const post = (name: string) => fetch(`${demo.monitor.url}/scenario/${name}`, { method: "POST", headers: { origin: demo.monitor.url } });
  const steps = (): ScenarioLine[] => demo.bus.history().flatMap((i: BusItem) => (i.stream === "scenario" ? [i.line] : []));
  async function until(from: number, name: string, ms = 60_000): Promise<ScenarioLine> {
    const end = Date.now() + ms;
    for (;;) {
      const s = steps().find((x) => x.seq > from && x.step === name);
      if (s) return s;
      if (Date.now() > end) throw new Error(`не дождались шага ${name}`);
      await pause(50);
    }
  }
  const lastSeq = () => demo.bus.history().reduce((m, i) => Math.max(m, i.stream === "monitor" ? i.event.seq : i.line.seq), 0);
  const ok = (r: Response, name: string) => {
    if (r.status !== 202) throw new Error(`сюжет ${name}: ${r.status}`);
  };

  async function intent(name = "intent"): Promise<string> {
    const n = lastSeq();
    ok(await post(name), name);
    const w = await until(n, "intent.awaiting_signature");
    const id = String(w.params.mandate_id);
    if ((await demo.stand.stand.issuer.sign(id)).statusCode !== 200) throw new Error("подпись поручения");
    await until(n, "intent.signed");
    // Событие Платформы о подписи приходит на шину лентой ПАО и может отстать от шага сюжета: без ожидания оно иногда
    // попадало в следующий прогон (паспорт сюжета 1, К2.1).
    await untilEvent(n, "mandate.signed", id);
    return id;
  }

  async function untilEvent(from: number, what: string, mandateId: string, ms = 30_000): Promise<void> {
    const end = Date.now() + ms;
    for (;;) {
      if (demo.bus.history().some((i) => i.stream === "monitor" && i.event.seq > from && i.event.what === what && i.event.ids.mandate_id === mandateId)) return;
      if (Date.now() > end) throw new Error(`не дождались события ${what}`);
      await pause(50);
    }
  }

  /** Покупка до решения клиента по корзине в банке: подпись или (сюжет 6) отказ — решение «отклонить» тем же маршрутом. */
  async function purchase(name: "purchase" | "limit" | "upk" | "reject" | "unconfirmed", from: number): Promise<void> {
    // Сюжеты 4 и 7 начинаются своим поручением — кнопка уже нажата в intent().
    if (name !== "upk" && name !== "unconfirmed") ok(await post(name), name);
    await until(from, "cart.card");
    ok(await post("cart/accept"), "cart/accept");
    const cw = await until(from, "cart.awaiting_signature");
    const decision = name === "reject" ? { decision: "REJECT" as const } : {};
    if ((await demo.stand.stand.issuer.sign(String(cw.params.mandate_id), decision)).statusCode !== 200) throw new Error("решение по корзине");
  }

  /** Записи шины с seq > from, разобранные форматом линии; ждёт, пока шина затихнет (фоновые проходы стенда). Считается
   *  длина истории, а не последний seq: событие Платформы получает seq при приёме, а публикуется позже. */
  async function wire(from: number): Promise<WireItem[]> {
    await demo.scenarios.settled();
    let seen = -1;
    for (let i = 0; i < 40 && seen !== demo.bus.history().length; i++) {
      seen = demo.bus.history().length;
      demo.bus.poll();
      await pause(400);
    }
    return demo.bus
      .history()
      .map((raw) => parseWireItem(JSON.parse(JSON.stringify(raw))))
      .filter((w): w is WireItem => w !== undefined && (w.stream === "monitor" ? w.event.seq : w.line.seq) > from);
  }

  /** Сюжет приёмки N целиком; записи шины — только этого прогона. */
  async function run(no: ScenarioNo): Promise<WireItem[]> {
    const n = lastSeq();
    if (no === 1) {
      await intent();
    } else if (no === 2 || no === 3) {
      await intent();
      await purchase(no === 2 ? "purchase" : "limit", n);
      await until(n, no === 2 ? "outcome" : "limit.declined");
      if (no === 3) await until(n, "bank.limit_reset");
    } else if (no === 4 || no === 7) {
      // 4 — человек подтверждает на странице УПК; 7 — отклоняет (тем же кодом из «SMS банка»).
      await intent(no === 4 ? "upk" : "unconfirmed");
      await purchase(no === 4 ? "upk" : "unconfirmed", n);
      const req = await until(n, "upk.required");
      const sms = await until(n, "upk.sms");
      const answer = await fetch(String(req.params.upk_url), {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ decision: no === 4 ? "APPROVE" : "REJECT", instrument: "CARD", code: String(sms.params.code) }).toString(),
      });
      if (answer.status !== 200) throw new Error(`страница УПК: ${answer.status}`);
      await until(n, no === 4 ? "outcome" : "upk.declined");
    } else if (no === 6) {
      await intent();
      await purchase("reject", n);
      await until(n, "cart.rejected");
      // Событие Платформы об отказе приходит лентой ПАО и может отстать от шага сюжета (как mandate.signed в сюжете 1).
      const cw = await until(n, "cart.awaiting_signature");
      await untilEvent(n, "mandate.rejected", String(cw.params.mandate_id));
    } else {
      const id = await intent();
      ok(await post("revoke"), "revoke");
      await until(n, "revoke.ask");
      if ((await demo.stand.stand.issuer.revoke(id)).statusCode !== 200) throw new Error("отзыв поручения");
      await until(n, "revoke.refused");
    }
    return wire(n);
  }

  return { run };
}
