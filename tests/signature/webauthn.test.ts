// ИН-П2, кирпич К3а — серверная проверка ответа пасскея. Решения владельца 22.11.2026: **Р-1716** (вариант А),
// **Р-1720** (способ оплаты в показанном), **Р-1721** (библиотека), П37 п. 3.
//
// Что держит этот файл, по правилу на случай:
//   — вызов строится из хэша показанного и одноразового числа, вызов одноразовый и со сроком;
//   — каждая отказная ветка показана **своей** фикстурой, и годный материал от негодного отличается одним полем;
//   — проверка подписи идёт через **настоящую** библиотеку на **настоящей** паре ключей P-256: негодная подпись
//     отклоняется не заглушкой;
//   — счётчик не убывает, удачная проверка его обновляет;
//   — способ оплаты обязателен в показанном, и разный способ даёт разный хэш (Р-1720).
import { describe, expect, it } from "vitest";
import type { ShownHash, UiPaymentMode } from "../../src/contract/ui-v1/index.js";
import { createPasskeyVerifier } from "../../src/signature/passkey-verifier.js";
import {
  CHALLENGE_TTL_MS_MAX,
  CHALLENGE_TTL_MS_MIN,
  challengeValue,
  checkPaymentAssertion,
  createChallengeStore,
  issueChallenge,
  PASSKEY_REFUSAL_CODES,
  paymentShown,
  paymentShownHash,
  type PasskeyRegistry,
  type PasskeyVerifier,
  type RegisteredPasskey,
} from "../../src/signature/webauthn.js";
import { createTestAuthenticator, FLAG_UP } from "./authenticator.js";

// **В фикстуре разные сущности — разные значения** (решение владельца 16.11): владелец, покупка, ключ и одноразовое
// число различимы, чтобы подмена одного другим была видна.
const OWNER = "own_p4_1";
const PURCHASE = "pur_p4_55";
const RP_ID = "stand.example";
const ORIGIN = "https://stand.example";
const NONCE = "nonce_p4_7";
const NOW = "2026-11-22T19:00:00.000Z";
const TTL = 120_000;

const CARD = { mode: "BANK" as UiPaymentMode, purchase_id: PURCHASE, total: { amount: 36_800, currency: "RUB" }, shop: "Масса Мадре" };
const SHOWN = { text_version: "p4-pay@1.0", card: CARD } as const;
const SHOWN_HASH: ShownHash = paymentShownHash(SHOWN);

/** Реестр пасскеев: ключ и **изменяемое** состояние счётчика (П37 п. 2). */
function registry(key: RegisteredPasskey, counter: number | null = null): PasskeyRegistry & { readonly counters: Map<string, number> } {
  const counters = new Map<string, number>();
  if (counter !== null) counters.set(key.passkey_id, counter);
  return {
    counters,
    byId: (owner, id) => (owner === key.owner && id === key.passkey_id ? key : null),
    counterOf: (id) => counters.get(id) ?? null,
    setCounter: (id, c) => void counters.set(id, c),
  };
}

/** Проверяющий-заглушка: нужен там, где проверяется **наша** ветка, а не криптография. Подтверждение человеком у него
 *  по умолчанию есть — иначе каждая ветка спотыкалась бы о чужую проверку. */
const fakeVerifier = (verified: boolean, counter = 2, user_verified = true): PasskeyVerifier => ({
  verifyAssertion: () => Promise.resolve({ verified, counter, user_verified }),
});

const deps = (o: {
  readonly store?: ReturnType<typeof createChallengeStore>;
  readonly registry: PasskeyRegistry;
  readonly verifier: PasskeyVerifier;
  readonly now?: string;
}) => ({
  store: o.store ?? createChallengeStore(),
  registry: o.registry,
  verifier: o.verifier,
  now: () => o.now ?? NOW,
  origin: ORIGIN,
  rp_id: RP_ID,
});

const issued = (store: ReturnType<typeof createChallengeStore>, over: { purpose?: "REGISTRATION" | "PAYMENT"; purchase_id?: string | null } = {}) =>
  issueChallenge(
    { store, now: () => NOW, nonce: () => NONCE, ttlMs: TTL },
    { owner: OWNER, purpose: over.purpose ?? "PAYMENT", purchase_id: over.purchase_id ?? PURCHASE, shown_hash: SHOWN_HASH },
  );

describe("вызов: из хэша показанного и одноразового числа, одноразовый, со сроком", () => {
  it("значение вызова зависит и от хэша показанного, и от одноразового числа", () => {
    const a = challengeValue(SHOWN_HASH, "nonce_1");
    const b = challengeValue(SHOWN_HASH, "nonce_2");
    const c = challengeValue(paymentShownHash({ ...SHOWN, card: { ...CARD, shop: "Другая" } }), "nonce_1");
    // Три величины сверяются между собой: смени одно из двух слагаемых — вызов другой. Ожидание неравенством, а не
    // «не пусто»: вызов, не зависящий от карточки, позволил бы накрыть подписью другую карточку.
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
    expect(a).toBe(challengeValue(SHOWN_HASH, "nonce_1"));
  });

  it("пустое одноразовое число не принимается", () => {
    expect(() => challengeValue(SHOWN_HASH, "")).toThrow(/одноразовое число пустое/);
  });

  it("вызов хранит хэш показанного, покупку и срок", () => {
    const store = createChallengeStore();
    const c = issued(store);
    expect(c.shown_hash).toBe(SHOWN_HASH);
    expect(c.purchase_id).toBe(PURCHASE);
    expect(c.expires_at).toBe("2026-11-22T19:02:00.000Z");
    expect(Object.isFrozen(c)).toBe(true);
  });

  it("вызов одноразовый: второе «отдать и вычеркнуть» возвращает `null`", () => {
    const store = createChallengeStore();
    const c = issued(store);
    expect(store.consume(c.value)?.value).toBe(c.value);
    expect(store.consume(c.value)).toBeNull();
    // И это свойство **порта**, а не договорённость с вызывающим.
    expect(store.peek(c.value)).toBeNull();
  });

  it("срок жизни вне границ не принимается — **на каждую сторону свой случай**", () => {
    // Требование владельца 22.11.2026 (П37, дополнение 2): у границ случай с каждой стороны, иначе это снова
    // «проверка ничего не проверяет». Границы — одно место на приложение (`CHALLENGE_TTL_MS_MIN`/`MAX`), и здесь
    // проверяется **второй** потребитель той же нормы: разбор данных проверяется своим случаем в `texts.test.ts`.
    const store = createChallengeStore();
    const issue = (ttlMs: number) =>
      issueChallenge({ store, now: () => NOW, nonce: () => NONCE, ttlMs }, { owner: OWNER, purpose: "PAYMENT", purchase_id: PURCHASE, shown_hash: SHOWN_HASH });
    for (const bad of [0, -1, CHALLENGE_TTL_MS_MIN - 1, CHALLENGE_TTL_MS_MAX + 1, 1.5]) {
      expect(() => issue(bad), String(bad)).toThrow(/срок жизни вызова — целое от 1000 до 600000 мс/);
    }
    // А на самих границах — проходит: иначе запрет был бы шире нормы.
    expect(issue(CHALLENGE_TTL_MS_MIN).expires_at).toBe("2026-11-22T19:00:01.000Z");
    expect(issue(CHALLENGE_TTL_MS_MAX).expires_at).toBe("2026-11-22T19:10:00.000Z");
  });
});

describe("отказные ветки проверки — каждая своей фикстурой", () => {
  const key: RegisteredPasskey = { owner: OWNER, passkey_id: "pk_1", public_key: "cose_1", rp_id: RP_ID };
  const body = (over: Partial<Parameters<typeof checkPaymentAssertion>[1]> = {}) => ({
    owner: OWNER,
    purchase_id: PURCHASE,
    shown_hash: SHOWN_HASH,
    challenge: "будет заменён",
    assertion: { passkey_id: "pk_1", client_data: "cd", authenticator_data: "ad", signature: "sig" },
    ...over,
  });

  it("вызова нет вовсе — `CHALLENGE_UNKNOWN`", async () => {
    const out = await checkPaymentAssertion(deps({ registry: registry(key), verifier: fakeVerifier(true) }), body({ challenge: "нет такого" }));
    expect(out).toEqual({ ok: false, code: "CHALLENGE_UNKNOWN", reason: "вызова нет в памяти или он уже использован" });
  });

  it("вызов уже использован — `CHALLENGE_UNKNOWN`, а не проход вторым разом", async () => {
    const store = createChallengeStore();
    const c = issued(store);
    const d = deps({ store, registry: registry(key), verifier: fakeVerifier(true) });
    const first = await checkPaymentAssertion(d, body({ challenge: c.value }));
    expect(first.ok).toBe(true);
    const second = await checkPaymentAssertion(d, body({ challenge: c.value }));
    expect(second).toMatchObject({ ok: false, code: "CHALLENGE_UNKNOWN" });
  });

  it("вызов выдан другому человеку — `CHALLENGE_UNKNOWN`", async () => {
    const store = createChallengeStore();
    const c = issued(store);
    const out = await checkPaymentAssertion(
      deps({ store, registry: registry({ ...key, owner: "own_p4_2" }), verifier: fakeVerifier(true) }),
      body({ challenge: c.value, owner: "own_p4_2" }),
    );
    expect(out).toMatchObject({ ok: false, code: "CHALLENGE_UNKNOWN", reason: "вызов выдан другому человеку" });
  });

  it("вызов выдан для регистрации, а не для оплаты — `CHALLENGE_UNKNOWN`", async () => {
    const store = createChallengeStore();
    const c = issued(store, { purpose: "REGISTRATION", purchase_id: null });
    const out = await checkPaymentAssertion(deps({ store, registry: registry(key), verifier: fakeVerifier(true) }), body({ challenge: c.value }));
    expect(out).toMatchObject({ ok: false, code: "CHALLENGE_UNKNOWN", reason: "вызов выдан для REGISTRATION, а не для оплаты" });
  });

  it("вызов выдан для другой покупки — `CHALLENGE_UNKNOWN`", async () => {
    const store = createChallengeStore();
    const c = issued(store, { purchase_id: "pur_p4_56" });
    const out = await checkPaymentAssertion(deps({ store, registry: registry(key), verifier: fakeVerifier(true) }), body({ challenge: c.value }));
    expect(out).toMatchObject({ ok: false, code: "CHALLENGE_UNKNOWN", reason: "вызов выдан для другой покупки" });
  });

  it("ровно на границе срока вызов ещё годен", async () => {
    const store = createChallengeStore();
    const c = issued(store);
    // Прежде здесь стояло пустое ожидание: вызов шёл с новым хранилищем и чужим значением, то есть мог вернуть только
    // `CHALLENGE_UNKNOWN`, и `expect(onEdge.ok).toBe(false)` не краснело ни при какой правке (находка ревью К3а № 2).
    // Теперь граница проверяется настоящим вызовом: `>` против `>=` в правиле срока покраснеет здесь.
    const out = await checkPaymentAssertion(
      deps({ store, registry: registry(key), verifier: fakeVerifier(true), now: "2026-11-22T19:02:00.000Z" }),
      body({ challenge: c.value }),
    );
    expect(out.ok).toBe(true);
  });

  it("на миллисекунду позже границы — `CHALLENGE_EXPIRED`", async () => {
    const store = createChallengeStore();
    const c = issued(store);
    const out = await checkPaymentAssertion(
      deps({ store, registry: registry(key), verifier: fakeVerifier(true), now: "2026-11-22T19:02:00.001Z" }),
      body({ challenge: c.value }),
    );
    expect(out).toMatchObject({ ok: false, code: "CHALLENGE_EXPIRED" });
  });

  it("негодное время сервера — исключение, а не «срок не вышел»", async () => {
    const store = createChallengeStore();
    const c = issued(store);
    await expect(
      checkPaymentAssertion(deps({ store, registry: registry(key), verifier: fakeVerifier(true), now: "вчера" }), body({ challenge: c.value })),
    ).rejects.toThrow(/негодное время сервера/);
  });

  it("пасскей зарегистрирован под другой сайт — `PASSKEY_NOT_REGISTERED`", async () => {
    const store = createChallengeStore();
    const c = issued(store);
    const out = await checkPaymentAssertion(
      deps({ store, registry: registry({ ...key, rp_id: "чужой.example" }), verifier: fakeVerifier(true) }),
      body({ challenge: c.value }),
    );
    expect(out).toMatchObject({ ok: false, code: "PASSKEY_NOT_REGISTERED", reason: "пасскей зарегистрирован под чужой.example, а не под stand.example" });
  });

  it("подпись без подтверждения человеком — `PASSKEY_USER_NOT_VERIFIED`, а не «подпись не сошлась»", async () => {
    const store = createChallengeStore();
    const c = issued(store);
    // Инвариант 3 держит **правило**, а не настройка адаптера: порт отдал годную подпись без признака UV — отказ.
    const out = await checkPaymentAssertion(
      deps({ store, registry: registry(key), verifier: { verifyAssertion: () => Promise.resolve({ verified: true, counter: 3, user_verified: false }) } }),
      body({ challenge: c.value }),
    );
    expect(out).toMatchObject({ ok: false, code: "PASSKEY_USER_NOT_VERIFIED" });
  });

  it("подписана не та карточка, для которой выдан вызов — `PASSKEY_SIGNATURE_INVALID`", async () => {
    const store = createChallengeStore();
    const c = issued(store);
    const other = paymentShownHash({ ...SHOWN, card: { ...CARD, total: { amount: 99_900, currency: "RUB" } } });
    const out = await checkPaymentAssertion(
      deps({ store, registry: registry(key), verifier: fakeVerifier(true) }),
      body({ challenge: c.value, shown_hash: other }),
    );
    expect(out).toMatchObject({ ok: false, code: "PASSKEY_SIGNATURE_INVALID", reason: "подписана не та карточка, для которой выдан вызов" });
  });

  it("такого пасскея у человека нет — `PASSKEY_NOT_REGISTERED`", async () => {
    const store = createChallengeStore();
    const c = issued(store);
    const out = await checkPaymentAssertion(
      deps({ store, registry: registry(key), verifier: fakeVerifier(true) }),
      body({ challenge: c.value, assertion: { passkey_id: "pk_чужой", client_data: "cd", authenticator_data: "ad", signature: "sig" } }),
    );
    expect(out).toMatchObject({ ok: false, code: "PASSKEY_NOT_REGISTERED" });
  });

  it("счётчик не вырос — `PASSKEY_COUNTER_REGRESSED`, и состояние счётчика не меняется", async () => {
    const store = createChallengeStore();
    const c = issued(store);
    const reg = registry(key, 5);
    const out = await checkPaymentAssertion(deps({ store, registry: reg, verifier: fakeVerifier(true, 4) }), body({ challenge: c.value }));
    expect(out).toMatchObject({ ok: false, code: "PASSKEY_COUNTER_REGRESSED", reason: "счётчик не вырос: было 5, пришло 4" });
    expect(reg.counters.get("pk_1")).toBe(5);
  });

  it("счётчик тот же при непустом прежнем — отказ: признак копии ключа", async () => {
    const store = createChallengeStore();
    const c = issued(store);
    const out = await checkPaymentAssertion(deps({ store, registry: registry(key, 5), verifier: fakeVerifier(true, 5) }), body({ challenge: c.value }));
    expect(out).toMatchObject({ ok: false, code: "PASSKEY_COUNTER_REGRESSED" });
  });

  it("счётчик 0 при 0 — проходит: часть аутентификаторов счётчика не ведёт", async () => {
    const store = createChallengeStore();
    const c = issued(store);
    const out = await checkPaymentAssertion(deps({ store, registry: registry(key, 0), verifier: fakeVerifier(true, 0) }), body({ challenge: c.value }));
    expect(out.ok).toBe(true);
  });

  it("удачная проверка обновляет счётчик", async () => {
    const store = createChallengeStore();
    const c = issued(store);
    const reg = registry(key, 5);
    const out = await checkPaymentAssertion(deps({ store, registry: reg, verifier: fakeVerifier(true, 9) }), body({ challenge: c.value }));
    expect(out).toEqual({ ok: true, passkey_id: "pk_1", counter: 9, shown_hash: SHOWN_HASH });
    expect(reg.counters.get("pk_1")).toBe(9);
  });

  it("перечень кодов отказа закрыт: восемь значений П37 с дополнением 1", () => {
    expect([...PASSKEY_REFUSAL_CODES]).toEqual([
      "PASSKEY_NOT_SUPPORTED",
      "PEP_NOT_ACCEPTED",
      "CHALLENGE_EXPIRED",
      "CHALLENGE_UNKNOWN",
      "PASSKEY_SIGNATURE_INVALID",
      "PASSKEY_COUNTER_REGRESSED",
      "PASSKEY_NOT_REGISTERED",
      // Восьмой — П37, дополнение 1 (Р-1725, владелец 22.11.2026): снятое подтверждение человеком не должно уходить
      // как «подпись не сошлась» (находка ревью К3а № 4).
      "PASSKEY_USER_NOT_VERIFIED",
    ]);
  });
});

describe("подпись проверяется настоящей библиотекой на настоящей паре ключей", () => {
  // Опознаватель пасскея — **base64url**, как его отдаёт браузер (`id` и `rawId` ответа): фикстуры вида `pk_1` такой
  // формы иметь не могут, и на них проверка формы была бы невидима (находка ревью К3а № 9).
  const PASSKEY_ID = Buffer.from("пасскей-стенда-1").toString("base64url");
  const auth = createTestAuthenticator(RP_ID, PASSKEY_ID);
  const key: RegisteredPasskey = { owner: OWNER, passkey_id: auth.passkey_id, public_key: auth.public_key, rp_id: RP_ID };
  const refused: unknown[] = [];
  const verifier = createPasskeyVerifier({ onRefused: (e) => void refused.push(e) });

  const runWith = async (assertion: ReturnType<typeof auth.assertion>, counter: number | null = 0) => {
    const store = createChallengeStore();
    const c = issued(store);
    return {
      c,
      out: await checkPaymentAssertion(deps({ store, registry: registry(key, counter), verifier }), {
        owner: OWNER,
        purchase_id: PURCHASE,
        shown_hash: SHOWN_HASH,
        challenge: c.value,
        assertion,
      }),
    };
  };

  it("годная подпись принимается, счётчик приходит от аутентификатора", async () => {
    const store = createChallengeStore();
    const c = issued(store);
    const out = await checkPaymentAssertion(deps({ store, registry: registry(key, 0), verifier }), {
      owner: OWNER,
      purchase_id: PURCHASE,
      shown_hash: SHOWN_HASH,
      challenge: c.value,
      assertion: auth.assertion({ challenge: c.value, origin: ORIGIN, counter: 4 }),
    });
    expect(out).toEqual({ ok: true, passkey_id: PASSKEY_ID, counter: 4, shown_hash: SHOWN_HASH });
  });

  it("убывший счётчик на живом материале — `PASSKEY_COUNTER_REGRESSED`, а не «подпись не сошлась»", async () => {
    const store = createChallengeStore();
    const c = issued(store);
    const reg = registry(key, 5);
    // Главный случай находки ревью К3а № 1: подпись **годная**, а счётчик меньше прежнего — признак копии ключа.
    // Пока прежний счётчик уходил библиотеке, она отбивала это сама, раньше проверки подписи, и человек получал
    // «подпись не сошлась»; собственное правило было мёртвым, а три случая счётчика зеленели только на заглушке.
    const out = await checkPaymentAssertion(deps({ store, registry: reg, verifier }), {
      owner: OWNER,
      purchase_id: PURCHASE,
      shown_hash: SHOWN_HASH,
      challenge: c.value,
      assertion: auth.assertion({ challenge: c.value, origin: ORIGIN, counter: 1 }),
    });
    expect(out).toMatchObject({ ok: false, code: "PASSKEY_COUNTER_REGRESSED", reason: "счётчик не вырос: было 5, пришло 1" });
    expect(reg.counters.get(PASSKEY_ID)).toBe(5);
  });

  it("причина отказа уходит в приём журнала, а не теряется", async () => {
    const before = refused.length;
    const { out } = await runWith(auth.assertion({ challenge: challengeValue(SHOWN_HASH, "другой_nonce"), origin: ORIGIN }));
    expect(out).toMatchObject({ ok: false, code: "PASSKEY_SIGNATURE_INVALID" });
    // Приём причины — обязательный параметр проверяющего; без него он не собирается вовсе.
    expect(refused.length).toBe(before + 1);
    expect(() => createPasskeyVerifier({ onRefused: undefined as unknown as (e: unknown) => void })).toThrow(/приём причины/);
  });

  it("подпись под другим вызовом — отказ (так пасскеем нельзя подписать не ту карточку)", async () => {
    const { out } = await runWith(auth.assertion({ challenge: challengeValue(SHOWN_HASH, "другой_nonce"), origin: ORIGIN }));
    expect(out).toMatchObject({ ok: false, code: "PASSKEY_SIGNATURE_INVALID" });
  });

  it("подпись не сходится с данными — отказ", async () => {
    const store = createChallengeStore();
    const c = issued(store);
    // `tamper` подменяет отданные данные аутентификатора после подписи: подпись годная, но не о том.
    const out = await checkPaymentAssertion(deps({ store, registry: registry(key, 0), verifier }), {
      owner: OWNER,
      purchase_id: PURCHASE,
      shown_hash: SHOWN_HASH,
      challenge: c.value,
      assertion: auth.assertion({ challenge: c.value, origin: ORIGIN, tamper: true }),
    });
    expect(out).toMatchObject({ ok: false, code: "PASSKEY_SIGNATURE_INVALID" });
  });

  it("чужой источник страницы — отказ", async () => {
    const { out } = await runWith(auth.assertion({ challenge: challengeValue(SHOWN_HASH, NONCE), origin: "https://чужой.example" }));
    expect(out).toMatchObject({ ok: false, code: "PASSKEY_SIGNATURE_INVALID" });
  });

  it("без подтверждения человеком (флаг UV снят) — отказ: инвариант 3 держит проверка, а не слова", async () => {
    const { out } = await runWith(auth.assertion({ challenge: challengeValue(SHOWN_HASH, NONCE), origin: ORIGIN, flags: FLAG_UP }));
    expect(out).toMatchObject({ ok: false, code: "PASSKEY_SIGNATURE_INVALID" });
  });

  it("другой `rp_id` у аутентификатора — отказ", async () => {
    const { out } = await runWith(auth.assertion({ challenge: challengeValue(SHOWN_HASH, NONCE), origin: ORIGIN, rp_id: "чужой.example" }));
    expect(out).toMatchObject({ ok: false, code: "PASSKEY_SIGNATURE_INVALID" });
  });

  it("ответ на вызов подписи, а не на вызов регистрации (`webauthn.create`) — отказ", async () => {
    const { out } = await runWith(auth.assertion({ challenge: challengeValue(SHOWN_HASH, NONCE), origin: ORIGIN, type: "webauthn.create" }));
    expect(out).toMatchObject({ ok: false, code: "PASSKEY_SIGNATURE_INVALID" });
  });

  it("подпись чужого пасскея под годным вызовом — отказ", async () => {
    // Тот же опознаватель, **другая** пара ключей: иначе отказ пришёл бы от «такого пасскея нет», и случай проверял
    // бы не подпись, а реестр.
    const other = createTestAuthenticator(RP_ID, PASSKEY_ID);
    const { out } = await runWith(other.assertion({ challenge: challengeValue(SHOWN_HASH, NONCE), origin: ORIGIN }));
    expect(out).toMatchObject({ ok: false, code: "PASSKEY_SIGNATURE_INVALID" });
  });
});

describe("способ оплаты входит в показанное (Р-1720)", () => {
  it("в карточке подтверждения оплаты есть `mode`", () => {
    const shown = paymentShown(SHOWN);
    expect((shown.card as { mode: string }).mode).toBe("BANK");
    expect(shown.text_version).toBe("p4-pay@1.0");
  });

  it("две покупки, одинаковые во всём, кроме способа оплаты, дают разные хэши показанного", () => {
    const byBank = paymentShownHash({ text_version: "p4-pay@1.0", card: { ...CARD, mode: "BANK" } });
    const byLink = paymentShownHash({ text_version: "p4-pay@1.0", card: { ...CARD, mode: "MERCHANT_LINK" } });
    // Ровно это и делает ключ подтверждения тройкой: способ входит в хэш, и четвёртая величина в ключе не нужна.
    expect(byBank).not.toBe(byLink);
  });

  it("карточка без способа оплаты не собирается — красная фикстура", () => {
    const withoutMode = { purchase_id: PURCHASE, total: { amount: 36_800, currency: "RUB" }, shop: "Масса Мадре" };
    // @ts-expect-error — `mode` обязателен типом: карточку подтверждения оплаты без способа не собрать
    expect(() => paymentShown({ text_version: "p4-pay@1.0", card: withoutMode })).toThrow(/без способа оплаты не подписывается/);
    // Шаг воспроизведения для гарантии компиляции (Р-1702): убери строку `@ts-expect-error` и запусти
    // `npx tsc --noEmit` — он покраснеет на отсутствующем `mode`.
  });

  it("подтверждение, данное для оплаты банком, не годится для оплаты по ссылке продавца", async () => {
    const store = createChallengeStore();
    const key: RegisteredPasskey = { owner: OWNER, passkey_id: "pk_1", public_key: "cose_1", rp_id: RP_ID };
    const c = issued(store);
    // Вызов выдан под карточку с `BANK`; человек «подтверждает» карточку с `MERCHANT_LINK` — хэш другой, и проверка
    // отказывает. Без `mode` в показанном обе карточки дали бы один хэш, и этот случай стал бы зелёным.
    const out = await checkPaymentAssertion(deps({ store, registry: registry(key), verifier: fakeVerifier(true) }), {
      owner: OWNER,
      purchase_id: PURCHASE,
      shown_hash: paymentShownHash({ text_version: "p4-pay@1.0", card: { ...CARD, mode: "MERCHANT_LINK" } }),
      challenge: c.value,
      assertion: { passkey_id: "pk_1", client_data: "cd", authenticator_data: "ad", signature: "sig" },
    });
    expect(out).toMatchObject({ ok: false, code: "PASSKEY_SIGNATURE_INVALID" });
  });
});
