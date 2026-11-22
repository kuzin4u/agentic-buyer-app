// ИН-П2, кирпич К2 — запись регистрации пасскея неизменяемой версией (П37 п. 2, приём П32). Три требования владельца
// 22.11.2026 проверяются здесь на деле, а не оговоркой:
//   1. проверка ответа регистрации идёт **настоящей** библиотекой на настоящем материале; что она проверяет и чего
//      не проверяет (цепочка attestation) — названо в адаптере и строкой STATUS;
//   2. **К2 и К3а сошлись:** регистрация записала начальный счётчик, первая подпись его подняла, подпись с убывшим
//      даёт `PASSKEY_COUNTER_REGRESSED`;
//   3. **повторная регистрация:** новая версия, прежняя не стирается, и подпись **прежним** ключом проходит — это
//      названное решение (довод в шапке `registration.ts`), а не то, что получилось само.
// Плюс: закрытого ключа и биометрии нет ни в версии, ни в журнале, ни в фикстурах.
import { describe, expect, it } from "vitest";
import type { UiPress, UiShown } from "../../src/contract/ui-v1/index.js";
import { createPasskeyVerifier } from "../../src/signature/passkey-verifier.js";
import {
  createPasskeyRegistry,
  createRegistrationStore,
  FIRST_REGISTRATION_NO,
  nextRegistrationVersion,
  recordRegistration,
  type PasskeyRegisteredEntry,
  type PasskeyRegistrationJournal,
  type SignedRegistration,
} from "../../src/signature/registration.js";
import { checkPaymentAssertion, createChallengeStore, issueChallenge, paymentShownHash } from "../../src/signature/webauthn.js";
import { createTestAuthenticator, FLAG_AT, FLAG_UP } from "./authenticator.js";

const OWNER = "own_p4_reg";
const RP_ID = "stand.example";
const ORIGIN = "https://stand.example";
const PASSKEY_ID = Buffer.from("ключ-телефона-1").toString("base64url");
const SECOND_ID = Buffer.from("ключ-телефона-2").toString("base64url");
const NOW = "2026-11-22T21:00:00.000Z";
const SHOWN: UiShown = { hash: `sha256:${"b".repeat(64)}`, text_version: "p4@1.0" };
const PRESS: UiPress = { at: "2026-11-22T20:59:58Z", device: "mobile", text_version: "press-p4@5.3", gesture: "tap" };
const PEP = "pep@1.0";

function journal(): PasskeyRegistrationJournal & { readonly written: PasskeyRegisteredEntry[] } {
  const written: PasskeyRegisteredEntry[] = [];
  return {
    written,
    write: (e) => void written.push(e),
    refused: () => {
      throw new Error("запись регистрации не пишет отказов");
    },
  };
}

const deps = (store = createRegistrationStore(), j = journal(), by: "human" | "test" = "human") => ({
  store,
  journal: j,
  now: () => NOW,
  by: () => by,
});

const body = (over: Partial<Parameters<typeof recordRegistration>[1]> = {}) => ({
  owner: OWNER,
  passkey_id: PASSKEY_ID,
  public_key: "cose_открытый_1",
  rp_id: RP_ID,
  counter: 0,
  pep_text_version: PEP,
  shown: SHOWN,
  press: PRESS,
  ...over,
});

describe("версия регистрации неизменяема", () => {
  it("первая версия — номер один, номер растёт по своей истории", () => {
    const store = createRegistrationStore();
    const first = recordRegistration(deps(store), body());
    expect(first.no).toBe(1);
    expect(FIRST_REGISTRATION_NO).toBe(1);
    const second = recordRegistration(deps(store), body({ passkey_id: SECOND_ID, public_key: "cose_открытый_2" }));
    expect(second.no).toBe(2);
    // Прежняя осталась как была.
    expect(store.all(OWNER)[0]?.passkey_id).toBe(PASSKEY_ID);
    expect(store.all(OWNER)).toHaveLength(2);
  });

  it("номер не считается по чужой истории", () => {
    const first = nextRegistrationVersion(null, { ...body(), by: "human", received_at: NOW });
    expect(() => nextRegistrationVersion(first, { ...body({ owner: "own_другой" }), by: "human", received_at: NOW })).toThrow(
      /прежняя версия принадлежит own_p4_reg, а новая — own_другой/,
    );
  });

  it("заморожены все слои", () => {
    const v = recordRegistration(deps(), body());
    expect(Object.isFrozen(v)).toBe(true);
    expect(Object.isFrozen(v.shown)).toBe(true);
    expect(Object.isFrozen(v.press)).toBe(true);
    const mutable = v as unknown as { public_key: string; shown: { hash: string } };
    expect(() => {
      mutable.public_key = "подмена";
    }).toThrow(TypeError);
    expect(() => {
      mutable.shown.hash = "sha256:подмена";
    }).toThrow(TypeError);
  });

  it("без опознавателя, ключа или версии текста ПЭП версия не пишется", () => {
    const j = journal();
    expect(() => recordRegistration(deps(createRegistrationStore(), j), body({ passkey_id: "" }))).toThrow(/нет опознавателя или открытого ключа/);
    expect(() => recordRegistration(deps(createRegistrationStore(), j), body({ public_key: "" }))).toThrow(/нет опознавателя или открытого ключа/);
    // Без версии формулировки непонятно, под чем человек подписался (П37 п. 5).
    expect(() => recordRegistration(deps(createRegistrationStore(), j), body({ pep_text_version: "" }))).toThrow(/нет версии текста ПЭП/);
    expect(j.written).toEqual([]);
  });

  it("журнал пишется последним и ровно один раз; открытого ключа в нём нет", () => {
    const order: string[] = [];
    const store = createRegistrationStore();
    const j = journal();
    const watched = {
      ...store,
      append: (v: SignedRegistration) => {
        order.push("store");
        store.append(v);
      },
    };
    const version = recordRegistration(
      { store: watched, journal: { write: (e) => (order.push("journal"), j.write(e)), refused: j.refused }, now: () => NOW, by: () => "human" },
      body(),
    );
    expect(order).toEqual(["store", "journal"]);
    // Ожидание готовым объектом: добавь модуль в запись ключ или биометрию — покраснеет здесь (инвариант 1).
    expect(j.written[0]).toEqual({
      event: "passkey.registered",
      version: 1,
      owner: OWNER,
      passkey_id: PASSKEY_ID,
      rp_id: RP_ID,
      counter: 0,
      pep_text_version: PEP,
      hash: `sha256:${"b".repeat(64)}`,
      press: PRESS,
      by: "human",
      received_at: NOW,
    });
    expect(version.public_key).toBe("cose_открытый_1");
  });
});

describe("закрытого ключа и биометрии нет нигде", () => {
  it("ни в версии, ни в записи журнала, ни в составе полей", () => {
    const j = journal();
    const version = recordRegistration(deps(createRegistrationStore(), j), body());
    expect(Object.keys(version)).toEqual([
      "no",
      "owner",
      "passkey_id",
      "public_key",
      "rp_id",
      "counter",
      "pep_text_version",
      "shown",
      "press",
      "by",
      "received_at",
    ]);
    const asText = JSON.stringify([version, j.written[0]]).toLowerCase();
    for (const bad of ["private", "закрыт", "biometr", "биометр", "fingerprint", "отпечаток", "pin", "secret", "d:", "cvv", "pan"])
      expect(asText, bad).not.toContain(bad);
  });

  it("у тестового аутентификатора закрытый ключ наружу не выходит", () => {
    const auth = createTestAuthenticator(RP_ID, PASSKEY_ID);
    // Наружу — только опознаватель и открытый ключ: закрытый живёт в замыкании и в ответах не появляется.
    expect(Object.keys(auth).sort()).toEqual(["assertion", "passkey_id", "public_key", "registration"]);
    const answer = auth.registration({ challenge: "вызов", origin: ORIGIN });
    expect(Object.keys(answer).sort()).toEqual(["attestation", "client_data", "id"]);
  });
});

describe("проверка ответа регистрации — настоящей библиотекой на настоящем материале", () => {
  const refused: unknown[] = [];
  const verifier = createPasskeyVerifier({ onRefused: (e) => void refused.push(e) });
  const challenge = "вызов-регистрации-1";

  it("годный ответ принят: открытый ключ и начальный счётчик приходят от проверки", async () => {
    const auth = createTestAuthenticator(RP_ID, PASSKEY_ID);
    const out = await verifier.verifyRegistration({
      answer: auth.registration({ challenge, origin: ORIGIN, counter: 7 }),
      expected_challenge: challenge,
      expected_origin: ORIGIN,
      expected_rp_id: RP_ID,
    });
    expect(out.verified).toBe(true);
    expect(out.passkey_id).toBe(PASSKEY_ID);
    expect(out.counter).toBe(7);
    expect(out.user_verified).toBe(true);
    // Открытый ключ пришёл **от проверки**, а не из тела: приложение CBOR не разбирает (Р-1721).
    expect(out.public_key).toBe(auth.public_key);
  });

  it("ответ на другой вызов не принимается", async () => {
    const auth = createTestAuthenticator(RP_ID, PASSKEY_ID);
    const out = await verifier.verifyRegistration({
      answer: auth.registration({ challenge: "другой-вызов", origin: ORIGIN }),
      expected_challenge: challenge,
      expected_origin: ORIGIN,
      expected_rp_id: RP_ID,
    });
    expect(out.verified).toBe(false);
    expect(out.public_key).toBe("");
  });

  it("без подтверждения человеком не принимается", async () => {
    const auth = createTestAuthenticator(RP_ID, PASSKEY_ID);
    const out = await verifier.verifyRegistration({
      answer: auth.registration({ challenge, origin: ORIGIN, flags: FLAG_UP | FLAG_AT }),
      expected_challenge: challenge,
      expected_origin: ORIGIN,
      expected_rp_id: RP_ID,
    });
    expect(out.verified).toBe(false);
  });

  it("ответ подписи вместо ответа регистрации не принимается", async () => {
    const auth = createTestAuthenticator(RP_ID, PASSKEY_ID);
    const out = await verifier.verifyRegistration({
      answer: auth.registration({ challenge, origin: ORIGIN, type: "webauthn.get" }),
      expected_challenge: challenge,
      expected_origin: ORIGIN,
      expected_rp_id: RP_ID,
    });
    expect(out.verified).toBe(false);
  });

  it("чужой источник страницы и чужой `rp_id` не принимаются", async () => {
    const auth = createTestAuthenticator(RP_ID, PASSKEY_ID);
    const byOrigin = await verifier.verifyRegistration({
      answer: auth.registration({ challenge, origin: "https://чужой.example" }),
      expected_challenge: challenge,
      expected_origin: ORIGIN,
      expected_rp_id: RP_ID,
    });
    const byRp = await verifier.verifyRegistration({
      answer: auth.registration({ challenge, origin: ORIGIN, rp_id: "чужой.example" }),
      expected_challenge: challenge,
      expected_origin: ORIGIN,
      expected_rp_id: RP_ID,
    });
    expect([byOrigin.verified, byRp.verified]).toEqual([false, false]);
    // **Причина у каждого случая своя** (находка ревью К2 № 5): прежде случай довольствовался `verified === false` и
    // остался бы зелёным, отвались ответ по другой причине — например на разборе CBOR. Адаптер складывает причины в
    // один исход для человека, но в журнал они уходят различимыми, и проверяется именно это.
    const reasons = refused.map((e) => (e instanceof Error ? e.message : String(e))).join("\n");
    expect(reasons).toMatch(/origin|Origin/);
    expect(reasons).toMatch(/RP ID|rpId|RPID/);
  });
});

describe("К2 и К3а сошлись: счётчик живёт одной величиной", () => {
  const SHOWN_PAY = { text_version: "p4-pay@1.0", card: { mode: "BANK" as const, purchase_id: "pur_reg_1", total: { amount: 100, currency: "RUB" } } };
  const payHash = paymentShownHash(SHOWN_PAY);

  /** Подписать оплату настоящим ключом и прогнать через проверку К3а поверх реестра К2. */
  const signPayment = async (auth: ReturnType<typeof createTestAuthenticator>, registry: ReturnType<typeof createPasskeyRegistry>, counter: number) => {
    const challenges = createChallengeStore();
    const issuedChallenge = issueChallenge(
      { store: challenges, now: () => NOW, nonce: () => `nonce_${counter}`, ttlMs: 120_000 },
      { owner: OWNER, purpose: "PAYMENT", purchase_id: "pur_reg_1", shown: { hash: payHash, text_version: SHOWN_PAY.text_version } },
    );
    return checkPaymentAssertion(
      {
        store: challenges,
        registry,
        verifier: createPasskeyVerifier({ onRefused: () => undefined }),
        now: () => NOW,
        origin: ORIGIN,
        rp_id: RP_ID,
      },
      {
        owner: OWNER,
        purchase_id: "pur_reg_1",
        shown_hash: payHash,
        challenge: issuedChallenge.value,
        assertion: auth.assertion({ challenge: issuedChallenge.value, origin: ORIGIN, counter }),
      },
    );
  };

  it("регистрация записала начальный счётчик, первая подпись его подняла, убывший — отказ", async () => {
    const auth = createTestAuthenticator(RP_ID, PASSKEY_ID);
    const store = createRegistrationStore();
    recordRegistration(deps(store), body({ public_key: auth.public_key, counter: 7 }));
    const registry = createPasskeyRegistry(store);

    // Начальное значение взято **из версии регистрации**, а не с нуля: иначе подпись со счётчиком 1 прошла бы.
    expect(registry.counterOf(OWNER, PASSKEY_ID)).toBe(7);
    const regressed = await signPayment(auth, registry, 1);
    expect(regressed).toMatchObject({ ok: false, code: "PASSKEY_COUNTER_REGRESSED", reason: "счётчик не вырос: было 7, пришло 1" });

    // Выросший — проходит и обновляет действующее значение.
    const grown = await signPayment(auth, registry, 8);
    expect(grown).toMatchObject({ ok: true, passkey_id: PASSKEY_ID, counter: 8 });
    expect(registry.counterOf(OWNER, PASSKEY_ID)).toBe(8);

    // И после подписи прежнее значение больше не принимается.
    const again = await signPayment(auth, registry, 8);
    expect(again).toMatchObject({ ok: false, code: "PASSKEY_COUNTER_REGRESSED", reason: "счётчик не вырос: было 8, пришло 8" });
  });

  it("чужая регистрация с тем же опознавателем не сбивает засев счётчика", async () => {
    // **Красная фикстура блокера ревью К2 № 1.** Опознаватель приходит из ответа недоверенной стороны, и при
    // `fmt: "none"` его выбирает тот, кто регистрируется. Пока счётчик и указатель на версию ключевались одним
    // опознавателем, посторонний регистрировал свой ключ с **тем же** опознавателем и счётчиком 0 — засев жертвы
    // становился нулевым, и подпись копии её ключа со счётчиком 1 проходила как законная.
    const victim = createTestAuthenticator(RP_ID, PASSKEY_ID);
    const store = createRegistrationStore();
    recordRegistration(deps(store), body({ public_key: victim.public_key, counter: 7 }));
    // Посторонний: свой владелец, тот же опознаватель ключа, счётчик 0.
    recordRegistration(deps(store), body({ owner: "own_посторонний", public_key: "cose_чужой", counter: 0 }));
    const registry = createPasskeyRegistry(store);

    expect(registry.counterOf(OWNER, PASSKEY_ID), "засев жертвы").toBe(7);
    expect(registry.counterOf("own_посторонний", PASSKEY_ID), "засев постороннего").toBe(0);
    const out = await signPayment(victim, registry, 1);
    expect(out).toMatchObject({ ok: false, code: "PASSKEY_COUNTER_REGRESSED", reason: "счётчик не вырос: было 7, пришло 1" });
  });

  it("подписи постороннего не двигают действующий счётчик человека", async () => {
    // Вторая половина того же блокера: общий счётчик позволял посторонним поднять значение и **навсегда запереть**
    // человека отказом `PASSKEY_COUNTER_REGRESSED` — отказ подтверждения оплаты чужим действием.
    const victim = createTestAuthenticator(RP_ID, PASSKEY_ID);
    const store = createRegistrationStore();
    recordRegistration(deps(store), body({ public_key: victim.public_key, counter: 0 }));
    const registry = createPasskeyRegistry(store);
    registry.setCounter("own_посторонний", PASSKEY_ID, 9999);
    expect(registry.counterOf(OWNER, PASSKEY_ID)).toBe(0);
    const out = await signPayment(victim, registry, 1);
    expect(out).toMatchObject({ ok: true, counter: 1 });
  });

  it("ключ другого человека в своей сессии не подписывает", async () => {
    // Ось, которой у решения «действуют оба ключа» не было закреплено (находка ревью К2 № 3): действуют все ключи
    // **этого** человека, а не любые.
    const other = createTestAuthenticator(RP_ID, PASSKEY_ID);
    const store = createRegistrationStore();
    recordRegistration(deps(store), body({ owner: "own_другой", public_key: other.public_key, counter: 0 }));
    const out = await signPayment(other, createPasskeyRegistry(store), 1);
    expect(out).toMatchObject({ ok: false, code: "PASSKEY_NOT_REGISTERED", reason: "у этого человека такого пасскея нет" });
  });

  it("ключ, зарегистрированный под другой сайт, не подписывает", async () => {
    // Вторая ось той же находки: `rp_id` записи сверяется с настройкой стенда.
    const auth = createTestAuthenticator(RP_ID, PASSKEY_ID);
    const store = createRegistrationStore();
    recordRegistration(deps(store), body({ public_key: auth.public_key, rp_id: "чужой.example", counter: 0 }));
    const out = await signPayment(auth, createPasskeyRegistry(store), 1);
    expect(out).toMatchObject({ ok: false, code: "PASSKEY_NOT_REGISTERED", reason: "пасскей зарегистрирован под чужой.example, а не под stand.example" });
  });

  it("незарегистрированный ключ подписать не может", async () => {
    const stranger = createTestAuthenticator(RP_ID, SECOND_ID);
    const store = createRegistrationStore();
    recordRegistration(deps(store), body({ public_key: "cose_открытый_1", counter: 0 }));
    const out = await signPayment(stranger, createPasskeyRegistry(store), 1);
    expect(out).toMatchObject({ ok: false, code: "PASSKEY_NOT_REGISTERED" });
  });

  it("повторная регистрация: новая версия, прежний ключ продолжает работать", async () => {
    // **Названное решение** (довод в шапке `registration.ts`): прежний ключ не отзывается — у человека бывает два
    // телефона, и регистрация второго не должна выключать первый; отзыв при потере телефона — отдельная постановка.
    const first = createTestAuthenticator(RP_ID, PASSKEY_ID);
    const second = createTestAuthenticator(RP_ID, SECOND_ID);
    const store = createRegistrationStore();
    recordRegistration(deps(store), body({ public_key: first.public_key, counter: 0 }));
    const v2 = recordRegistration(deps(store), body({ passkey_id: SECOND_ID, public_key: second.public_key, counter: 0 }));
    expect(v2.no).toBe(2);
    const registry = createPasskeyRegistry(store);

    const byOld = await signPayment(first, registry, 3);
    expect(byOld, "подпись прежним ключом после повторной регистрации").toMatchObject({ ok: true, passkey_id: PASSKEY_ID });
    const byNew = await signPayment(second, registry, 4);
    expect(byNew, "подпись новым ключом").toMatchObject({ ok: true, passkey_id: SECOND_ID });
    // Счётчики у ключей **независимы**: общий счётчик превратил бы работу второго телефона в «регресс» у первого.
    expect([registry.counterOf(OWNER, PASSKEY_ID), registry.counterOf(OWNER, SECOND_ID)]).toEqual([3, 4]);
  });
});
