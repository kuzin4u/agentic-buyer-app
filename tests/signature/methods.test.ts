// ИН-П2, кирпич К4 — четыре метода `/ui/v1` формы П37 п. 3 на живом сервере. Четыре требования владельца 22.11.2026
// проверяются здесь на деле:
//   1. память повторов по паре «человек + ключ идемпотентности», **красная фикстура**: чужой повтор не получает
//      чужой результат;
//   2. законный повтор отвечает прежним результатом **до** проверки вызова, а новый ключ на использованном вызове —
//      `CHALLENGE_UNKNOWN` (уточнение 2 к П37);
//   3. отпечаток действия: `press` не входит, `shown_hash` входит, способ оплаты покрыт через показанное (Р-1720);
//   4. ожидания на **состав тел**, чтобы `path` не появился тихо литералом (П37, дополнение 3).
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { IDEMPOTENCY_HEADER, type UiPaymentMode } from "../../src/contract/ui-v1/index.js";
import { parsePasskeyCatalog } from "../../src/signature/texts.js";
import { createPasskeyVerifier } from "../../src/signature/passkey-verifier.js";
import { createPaymentApprovalStore } from "../../src/signature/m2.js";
import { createRegistrationStore, recordRegistration } from "../../src/signature/registration.js";
import { createChallengeStore, paymentShownHash } from "../../src/signature/webauthn.js";
import { startUiServer } from "../../src/ui-server/index.js";
import { Sessions } from "../../src/ui-server/session.js";
import { createTestAuthenticator } from "./authenticator.js";
import { readFileSync } from "node:fs";

const catalog = parsePasskeyCatalog(JSON.parse(readFileSync(new URL("../../config/passkey.default.json", import.meta.url), "utf8")));

const RP_ID = "stand.example";
const ORIGIN = `https://${RP_ID}`;
const PURCHASE = "pur_k4_1";
const PASSKEY_ID = Buffer.from("ключ-к4").toString("base64url");
const CARD = { mode: "BANK", purchase_id: PURCHASE, total: { amount: 36_800, currency: "RUB" } } as {
  mode: UiPaymentMode;
  purchase_id: string;
  total: { amount: number; currency: string };
};
const PAY_SHOWN = { text_version: "p4-pay@1.0", card: CARD } as const;
/** Тело вызова подписи: хэш и версия текстов **вместе** — вызов хранит одну запись об одной карточке, и из вызова она
 *  уходит в подписанную версию (блокер ревью К4 № 1). Поля `challenge` в телах нет: вызов сервер находит сам по
 *  человеку и покупке, как и записано в форме П37 п. 3 (находка ревью К4 № 8). */
const payChallengeBody = (shown = PAY_SHOWN) => ({ purchase_id: PURCHASE, shown_hash: paymentShownHash(shown), text_version: shown.text_version });

/** Ядро не участвует: эти методы к покупке не ходят — им нужны вызов, ключ и показанное. */
const core = { purchase: () => null, feed: () => ({ cancel: () => undefined }) } as unknown as Parameters<typeof startUiServer>[0]["core"];

async function stand(o: { readonly ownerOnPage?: () => string } = {}) {
  const sessions = new Sessions();
  const challenges = createChallengeStore();
  const registrations = createRegistrationStore();
  const approvals = createPaymentApprovalStore();
  /**
   * Два журнала — **разными заглушками** (находка ревью К6 № 8): пока регистрация и подтверждение оплаты делили один
   * объект, различить их было нечем, и ошибка маршрутизации отказов (отказ оплаты уходил в журнал регистрации) жила
   * незамеченной до сквозного теста К6. Это правило «в фикстуре разные сущности — разные значения» буквально.
   */
  const regJournal = { written: [] as unknown[], write: (e: unknown) => void regJournal.written.push(e), refused: (e: unknown) => void regJournal.written.push(e) };
  const payJournal = { written: [] as unknown[], write: (e: unknown) => void payJournal.written.push(e), refused: (e: unknown) => void payJournal.written.push(e) };
  const auth = createTestAuthenticator(RP_ID, PASSKEY_ID);
  let nonce = 0;
  const s = await startUiServer({
    core,
    owner: (req) => sessions.ownerOf(req),
    shell: { brandPath: "config/brand.demo.json", sessions, ownerOnPage: o.ownerOnPage ?? (() => "own_k4_1") },
    passkey: {
      catalog,
      challenges,
      registrations,
      approvals,
      journal: regJournal,
      approvalJournal: payJournal,
      verifier: createPasskeyVerifier({ onRefused: () => undefined }),
      nonce: () => `nonce_${++nonce}`,
      origin: ORIGIN,
      rp_id: RP_ID,
      userId: () => "usr_случайный_1",
      viewId: () => "vw_k4_1",
    },
  });
  const cookie = async () => (await fetch(`${s.url}/ui`)).headers.get("set-cookie")!.split(";")[0]!;
  return { s, sessions, challenges, registrations, approvals, auth, cookie, regJournal, payJournal, close: () => s.close() };
}

const post = (url: string, cookie: string, key: string, body: unknown) =>
  fetch(url, { method: "POST", headers: { cookie, "content-type": "application/json", [IDEMPOTENCY_HEADER]: key }, body: JSON.stringify(body) });

// Провенанс несёт версию текстов **показанной** карточки (П26), и у двух карточек она разная: у экрана регистрации —
// версия данных П4, у карточки подтверждения оплаты — своя. Фикстуры разведены: при общей версии подмена одной
// карточки другой была бы невидима (правило «в фикстуре разные сущности — разные значения»).
const PRESS = { at: "2026-11-22T22:00:00Z", device: "mobile", text_version: catalog.text_version, gesture: "tap" } as const;
const PRESS_PAY = { ...PRESS, text_version: PAY_SHOWN.text_version } as const;

describe("состав тел: `path` не появляется тихо (П37, дополнение 3)", () => {
  it("вызов регистрации отдаёт названный состав — и `path` в нём нет", async () => {
    const st = await stand();
    try {
      const res = await fetch(`${st.s.url}/ui/v1/passkey/registration`, { headers: { cookie: await st.cookie() } });
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      // Ожидание на **состав**: шаг пути приходит из канвы и добавляется кирпичом К5 — появись `path` здесь
      // литералом, случай покраснеет (тот же сторож, что у данных К1).
      expect(Object.keys(body).sort()).toEqual(["actions", "challenge", "pep", "rp_id", "timeout_ms", "user", "view"]);
      expect(body).not.toHaveProperty("path");
      expect((body as { user: { id: string } }).user.id).toBe("usr_случайный_1");
      expect((body as { timeout_ms: number }).timeout_ms).toBe(catalog.challenge_ttl_ms);
      expect((body as { pep: { text_version: string } }).pep.text_version).toBe("pep@1.0");
    } finally {
      await st.close();
    }
  });

  it("вызов подписи оплаты отдаёт названный состав — и `path` в нём нет", async () => {
    const st = await stand();
    try {
      const cookie = await st.cookie();
      recordRegistration(
        { store: st.registrations, journal: { write: () => undefined, refused: () => undefined }, now: () => "2026-11-22T21:00:00.000Z", by: () => "human" },
        {
          owner: "own_k4_1",
          passkey_id: PASSKEY_ID,
          public_key: st.auth.public_key,
          rp_id: RP_ID,
          counter: 0,
          pep_text_version: "pep@1.0",
          shown: { hash: `sha256:${"b".repeat(64)}`, text_version: "p4@1.0" },
          press: PRESS,
        },
      );
      const res = await post(`${st.s.url}/ui/v1/payment/signature/challenge`, cookie, randomUUID(), payChallengeBody());
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(Object.keys(body).sort()).toEqual(["challenge", "passkey_ids", "timeout_ms"]);
      expect(body).not.toHaveProperty("path");
      expect((body as { passkey_ids: string[] }).passkey_ids).toEqual([PASSKEY_ID]);
    } finally {
      await st.close();
    }
  });

  it("без регистрации вызов подписи отказывает с текстом из данных", async () => {
    const st = await stand();
    try {
      const res = await post(`${st.s.url}/ui/v1/payment/signature/challenge`, await st.cookie(), randomUUID(), payChallengeBody());
      expect(res.status).toBe(409);
      const body = (await res.json()) as { error: { code: string; retry: string; text: string; view: null } };
      // Четыре поля тела ошибки § 3, класс повтора у источника (П37), текст — из данных К1 на языке запроса.
      expect(Object.keys(body.error).sort()).toEqual(["code", "retry", "text", "view"]);
      expect(body.error.code).toBe("PASSKEY_NOT_REGISTERED");
      expect(body.error.retry).toBe("after_human");
      expect(body.error.text).toBe(catalog.errors.PASSKEY_NOT_REGISTERED.ru);
      // Отказ ушёл **в свой** журнал — подтверждений оплаты, а не регистрации (находка ревью К6 № 8).
      expect(st.payJournal.written).toHaveLength(1);
      expect(st.regJournal.written).toHaveLength(0);
    } finally {
      await st.close();
    }
  });
});

describe("POST регистрации — четвёртый метод, который прежде не был покрыт ни одним случаем", () => {
  it("годный ответ устройства записывает версию регистрации", async () => {
    const st = await stand();
    try {
      const cookie = await st.cookie();
      const issued = await fetch(`${st.s.url}/ui/v1/passkey/registration`, { headers: { cookie } });
      const { challenge, view } = (await issued.json()) as { challenge: string; view: { hash: string; text_version: string } };
      const res = await post(`${st.s.url}/ui/v1/passkey/registration`, cookie, randomUUID(), {
        shown_hash: view.hash,
        pep_accepted: true,
        press: { ...PRESS, text_version: view.text_version },
        passkey: st.auth.registration({ challenge, origin: ORIGIN, counter: 2 }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { registration: Record<string, unknown> };
      // Состав тела назван, и `path` в нём нет (П37, дополнение 3).
      expect(Object.keys(body).sort()).toEqual(["registration"]);
      expect(Object.keys(body.registration).sort()).toEqual(["by", "passkey_id", "received_at", "shown", "version"]);
      expect(body.registration.version).toBe(1);
      expect(body.registration.by).toBe("human");
      // Запись показанного — **пара из вызова**, об одной карточке (блокер ревью К4 № 1).
      expect(body.registration.shown).toEqual({ hash: view.hash, text_version: view.text_version });
      expect(st.registrations.all("own_k4_1")).toHaveLength(1);
      expect(st.registrations.all("own_k4_1")[0]?.counter).toBe(2);
    } finally {
      await st.close();
    }
  });

  it("соглашение о ПЭП не отмечено — `PEP_NOT_ACCEPTED`, версия не пишется", async () => {
    const st = await stand();
    try {
      const cookie = await st.cookie();
      const issued = await fetch(`${st.s.url}/ui/v1/passkey/registration`, { headers: { cookie } });
      const { challenge, view } = (await issued.json()) as { challenge: string; view: { hash: string; text_version: string } };
      const res = await post(`${st.s.url}/ui/v1/passkey/registration`, cookie, randomUUID(), {
        shown_hash: view.hash,
        press: { ...PRESS, text_version: view.text_version },
        passkey: st.auth.registration({ challenge, origin: ORIGIN }),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: { code: string; retry: string; text: string } };
      expect(body.error.code).toBe("PEP_NOT_ACCEPTED");
      expect(body.error.retry).toBe("after_fix");
      expect(body.error.text).toBe(catalog.errors.PEP_NOT_ACCEPTED.ru);
      expect(st.registrations.all("own_k4_1")).toHaveLength(0);
    } finally {
      await st.close();
    }
  });

  it("присланный хэш не тот — `SHOWN_STALE` с текстом этого экрана", async () => {
    const st = await stand();
    try {
      const cookie = await st.cookie();
      const issued = await fetch(`${st.s.url}/ui/v1/passkey/registration`, { headers: { cookie } });
      const { challenge, view } = (await issued.json()) as { challenge: string; view: { hash: string; text_version: string } };
      const res = await post(`${st.s.url}/ui/v1/passkey/registration`, cookie, randomUUID(), {
        shown_hash: `sha256:${"f".repeat(64)}`,
        pep_accepted: true,
        press: { ...PRESS, text_version: view.text_version },
        passkey: st.auth.registration({ challenge, origin: ORIGIN }),
      });
      expect(res.status).toBe(409);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe("SHOWN_STALE");
    } finally {
      await st.close();
    }
  });

  it("негодный провенанс — отказ, а не пустой провенанс в подписанной версии", async () => {
    const st = await stand();
    try {
      const cookie = await st.cookie();
      const issued = await fetch(`${st.s.url}/ui/v1/passkey/registration`, { headers: { cookie } });
      const { challenge, view } = (await issued.json()) as { challenge: string; view: { hash: string; text_version: string } };
      // Прежде `press: {}` проходил и замораживался в пустой объект — П26 держался на словах (находка ревью К4 № 5).
      const res = await post(`${st.s.url}/ui/v1/passkey/registration`, cookie, randomUUID(), {
        shown_hash: view.hash,
        pep_accepted: true,
        press: {},
        passkey: st.auth.registration({ challenge, origin: ORIGIN }),
      });
      expect(res.status).toBe(400);
      expect(st.registrations.all("own_k4_1")).toHaveLength(0);
    } finally {
      await st.close();
    }
  });

  it("негодная форма ответа устройства — отказ, а не 500", async () => {
    const st = await stand();
    try {
      const cookie = await st.cookie();
      const issued = await fetch(`${st.s.url}/ui/v1/passkey/registration`, { headers: { cookie } });
      const { view } = (await issued.json()) as { view: { hash: string; text_version: string } };
      // `assertion: null` и `passkey: null` прежде роняли сборку в 500, не заняв ключ (находка ревью К4 № 3).
      for (const bad of [null, 5, {}, { id: "x" }]) {
        const res = await post(`${st.s.url}/ui/v1/passkey/registration`, cookie, randomUUID(), {
          shown_hash: view.hash,
          pep_accepted: true,
          press: { ...PRESS, text_version: view.text_version },
          passkey: bad,
        });
        expect(res.status, JSON.stringify(bad)).toBe(400);
      }
    } finally {
      await st.close();
    }
  });

  it("отказ приходит на языке запроса", async () => {
    const st = await stand();
    try {
      const cookie = await st.cookie();
      // Тот же отказ по-английски: тексты живут парами ru/en, и язык запроса выбирает пару (правило планов № 3).
      const res = await post(`${st.s.url}/ui/v1/passkey/registration?lang=en`, cookie, randomUUID(), { shown_hash: "x" });
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: { text: string } }).error.text).toBe(catalog.errors.PASSKEY_SIGNATURE_INVALID.en);
    } finally {
      await st.close();
    }
  });

  it("`GET` на адреса подписи — 405 с `Allow: POST`, а не 404", async () => {
    const st = await stand();
    try {
      const cookie = await st.cookie();
      for (const p of ["/payment/signature", "/payment/signature/challenge"]) {
        const res = await fetch(`${st.s.url}/ui/v1${p}`, { headers: { cookie } });
        expect(res.status, p).toBe(405);
        expect(res.headers.get("allow"), p).toBe("POST");
      }
    } finally {
      await st.close();
    }
  });
});

describe("память повторов — по паре «человек + ключ идемпотентности»", () => {
  it("чужой повтор тем же ключом **не получает** чужой результат", async () => {
    // **Красная фикстура требования 1.** Ключ идемпотентности придумывает экран, то есть недоверенная сторона: без
    // человека в ключе совпавший UUID другого человека находил бы чужой ответ — он увидел бы чужое подтверждение, а
    // своё не записал бы. Правило 2 К-Б, «память ответов ключуется парой».
    let who = "own_k4_1";
    const st = await stand({ ownerOnPage: () => who });
    try {
      const first = await st.cookie();
      const key = randomUUID();
      const mine = await post(`${st.s.url}/ui/v1/payment/signature/challenge`, first, key, payChallengeBody());
      expect(mine.status).toBe(409);
      expect(((await mine.json()) as { error: { code: string } }).error.code).toBe("PASSKEY_NOT_REGISTERED");

      // Второй человек: своя сессия, **тот же** ключ идемпотентности и то же тело.
      who = "own_k4_2";
      const second = await st.cookie();
      recordRegistration(
        { store: st.registrations, journal: { write: () => undefined, refused: () => undefined }, now: () => "2026-11-22T21:00:00.000Z", by: () => "human" },
        {
          owner: "own_k4_2",
          passkey_id: PASSKEY_ID,
          public_key: st.auth.public_key,
          rp_id: RP_ID,
          counter: 0,
          pep_text_version: "pep@1.0",
          shown: { hash: `sha256:${"b".repeat(64)}`, text_version: "p4@1.0" },
          press: PRESS,
        },
      );
      const his = await post(`${st.s.url}/ui/v1/payment/signature/challenge`, second, key, payChallengeBody());
      // Его запрос — **его первое действие**, а не повтор чужого: он получает вызов, а не чужой отказ.
      expect(his.status).toBe(200);
      expect(Object.keys((await his.json()) as object).sort()).toEqual(["challenge", "passkey_ids", "timeout_ms"]);
    } finally {
      await st.close();
    }
  });
});

describe("законный повтор и использованный вызов (уточнение 2 к П37)", () => {
  it("тот же ключ после использованного вызова — прежний результат; новый ключ — `CHALLENGE_UNKNOWN`", async () => {
    const st = await stand();
    try {
      const cookie = await st.cookie();
      recordRegistration(
        { store: st.registrations, journal: { write: () => undefined, refused: () => undefined }, now: () => "2026-11-22T21:00:00.000Z", by: () => "human" },
        {
          owner: "own_k4_1",
          passkey_id: PASSKEY_ID,
          public_key: st.auth.public_key,
          rp_id: RP_ID,
          counter: 0,
          pep_text_version: "pep@1.0",
          shown: { hash: `sha256:${"b".repeat(64)}`, text_version: "p4@1.0" },
          press: PRESS,
        },
      );
      const shown_hash = paymentShownHash(PAY_SHOWN);
      const issued = await post(`${st.s.url}/ui/v1/payment/signature/challenge`, cookie, randomUUID(), payChallengeBody());
      const { challenge } = (await issued.json()) as { challenge: string };

      const key = randomUUID();
      // Поля `challenge` в теле **нет** (форма П37 п. 3): его значение сервер находит сам по человеку и покупке.
      const body = {
        purchase_id: PURCHASE,
        shown_hash,
        press: PRESS_PAY,
        assertion: st.auth.assertion({ challenge, origin: ORIGIN, counter: 3 }),
      };
      const first = await post(`${st.s.url}/ui/v1/payment/signature`, cookie, key, body);
      expect(first.status).toBe(200);
      const got = (await first.json()) as { approval: Record<string, unknown> };
      // Состав **верхнего уровня** тоже назван (находка ревью К4 № 7): прежде проверялись только ключи `approval`, и
      // `path` мог появиться рядом с ним молча.
      expect(Object.keys(got).sort()).toEqual(["approval"]);
      expect(Object.keys(got.approval).sort()).toEqual(["by", "purchase_id", "received_at", "shown", "version"]);
      expect(got.approval.version).toBe(1);
      expect(got.approval.by).toBe("human");

      // **Законный повтор:** тот же ключ, то же тело. Вызов уже использован, но ответ приходит **из памяти повторов,
      // до проверки вызова**, то есть `CHALLENGE_UNKNOWN` человек не получает (уточнение 2 к П37).
      const replay = await post(`${st.s.url}/ui/v1/payment/signature`, cookie, key, body);
      expect(replay.status).toBe(200);
      expect((await replay.json()) as unknown).toEqual(got);
      // И второй подписанной версии не появилось: повтор — то же действие.
      expect(st.approvals.all("own_k4_1")).toHaveLength(1);

      // **Новый ключ на том же использованном вызове** — это уже другое действие, и вызов одноразовый.
      const again = await post(`${st.s.url}/ui/v1/payment/signature`, cookie, randomUUID(), body);
      expect(again.status).toBe(409);
      const refusal = (await again.json()) as { error: { code: string; retry: string; text: string } };
      expect(refusal.error.code).toBe("CHALLENGE_UNKNOWN");
      expect(refusal.error.retry).toBe("never");
      expect(refusal.error.text).toBe(catalog.errors.CHALLENGE_UNKNOWN.ru);
      expect(st.approvals.all("own_k4_1")).toHaveLength(1);
    } finally {
      await st.close();
    }
  });
});

describe("отпечаток действия: `press` не входит, показанное входит (правило 2, Р-1720)", () => {
  const prepare = async (st: Awaited<ReturnType<typeof stand>>) => {
    const cookie = await st.cookie();
    recordRegistration(
      { store: st.registrations, journal: { write: () => undefined, refused: () => undefined }, now: () => "2026-11-22T21:00:00.000Z", by: () => "human" },
      {
        owner: "own_k4_1",
        passkey_id: PASSKEY_ID,
        public_key: st.auth.public_key,
        rp_id: RP_ID,
        counter: 0,
        pep_text_version: "pep@1.0",
        shown: { hash: `sha256:${"b".repeat(64)}`, text_version: "p4@1.0" },
        press: PRESS,
      },
    );
    return cookie;
  };

  it("другое время нажатия — **то же** действие: прежний ответ, а не конфликт", async () => {
    const st = await stand();
    try {
      const cookie = await prepare(st);
      const shown_hash = paymentShownHash(PAY_SHOWN);
      const issued = await post(`${st.s.url}/ui/v1/payment/signature/challenge`, cookie, randomUUID(), payChallengeBody());
      expect(issued.status, "вызов выдан").toBe(200);
      const { challenge } = (await issued.json()) as { challenge: string };
      const key = randomUUID();
      const assertion = st.auth.assertion({ challenge, origin: ORIGIN, counter: 5 });
      const first = await post(`${st.s.url}/ui/v1/payment/signature`, cookie, key, { purchase_id: PURCHASE, shown_hash, press: PRESS_PAY, assertion });
      expect(first.status).toBe(200);
      // Экран повторяет запрос после обрыва связи и несёт **своё новое** время нажатия (С-18). Провенанс в отпечаток
      // не входит, значит это тот же повтор и тот же ответ — а не `IDEMPOTENCY_CONFLICT`.
      const again = await post(`${st.s.url}/ui/v1/payment/signature`, cookie, key, {
        purchase_id: PURCHASE,
        shown_hash,
        press: { ...PRESS_PAY, at: "2026-11-22T22:00:09Z", gesture: "swipe" },
        assertion,
      });
      expect(again.status).toBe(200);
      expect(st.approvals.all("own_k4_1")).toHaveLength(1);
    } finally {
      await st.close();
    }
  });

  it("другое показанное при том же ключе — конфликт: способ оплаты входит в хэш (Р-1720)", async () => {
    const st = await stand();
    try {
      const cookie = await prepare(st);
      const byBank = paymentShownHash(PAY_SHOWN);
      const byLink = paymentShownHash({ ...PAY_SHOWN, card: { ...CARD, mode: "MERCHANT_LINK" } });
      expect(byBank).not.toBe(byLink);
      const key = randomUUID();
      const first = await post(`${st.s.url}/ui/v1/payment/signature/challenge`, cookie, key, payChallengeBody());
      expect(first.status).toBe(200);
      // Тот же ключ, но показанное другое — **другое действие**: иначе подтверждение оплаты банком отдало бы свой
      // ответ запросу на оплату по ссылке продавца.
      const other = await post(`${st.s.url}/ui/v1/payment/signature/challenge`, cookie, key, {
        ...payChallengeBody({ ...PAY_SHOWN, card: { ...CARD, mode: "MERCHANT_LINK" } }),
      });
      expect(other.status).toBe(409);
      expect(((await other.json()) as { error: { code: string } }).error.code).toBe("IDEMPOTENCY_CONFLICT");
    } finally {
      await st.close();
    }
  });
});
