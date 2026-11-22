// ИН-П2, кирпич К6 — **сквозные проверки и инвариант 1** на всех телах П4 и в записях версий.
//
// Просеивается **общим** перечнем `tests/support/forbidden-fields.ts` (Р-1679): своего перечня окно Б не заводит —
// второй стал бы вторым источником одной нормы и разошёлся бы с первым. Приём и довод — те же, что у знакомства
// (`tests/onboarding/invariant1.test.ts`, К6 ИН-П1).
//
// Просеиваются **настоящие тела**, а не типы глазами: вызов регистрации, удачный ответ регистрации, вызов подписи,
// удачный ответ подписи, отказы всех трёх методов, подписанные версии регистрации и подтверждения оплаты (их читает
// спор) и все четыре записи журнала — удачи и отказы. Имена полей берутся обходом в глубину, включая ключи объектов
// внутри массивов.
//
// И главное: **проверка показана красной** (Р-1698) — ниже стоит фикстура с запретным полем и фикстура со строкой,
// похожей на номер карты, на которых просев обязан упасть. Фикстуры остаются в тестах: они и есть доказательство,
// что просев жив, а не тождественно зелен.
//
// Сквозная часть кирпича: путь «вызов регистрации → регистрация → вызов подписи → подпись оплаты» проходится
// целиком на живом сервере и настоящем ключе, и в конце сверяется, что обе подписанные версии говорят об одной
// карточке каждая, а счётчик вырос.
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { IDEMPOTENCY_HEADER, type UiPaymentMode } from "../../src/contract/ui-v1/index.js";
import { hasCardNumber } from "../../src/card-guard.js";
import {
  createPaymentApprovalStore,
  createPasskeyVerifier,
  createRegistrationStore,
  createChallengeStore,
  parsePasskeyCatalog,
  paymentShownHash,
  type PasskeyRegisteredEntry,
  type PasskeyRegistrationRefusedEntry,
  type PaymentApprovalRefusedEntry,
  type PaymentApprovedEntry,
} from "../../src/signature/index.js";
import { Sessions, startUiServer } from "../../src/ui-server/index.js";
import { cardLikeNumber } from "../support/card-like.js";
import { ALLOWED_EXAMPLES, FORBIDDEN_EXAMPLES, hitsForbidden } from "../support/forbidden-fields.js";
import { createTestAuthenticator } from "./authenticator.js";

const catalog = parsePasskeyCatalog(JSON.parse(readFileSync(new URL("../../config/passkey.default.json", import.meta.url), "utf8")));

const OWNER = "own_k6_1";
const RP_ID = "stand.example";
const ORIGIN = `https://${RP_ID}`;
const PURCHASE = "pur_k6_1";
const PASSKEY_ID = Buffer.from("ключ-к6").toString("base64url");
const CARD = { mode: "BANK", purchase_id: PURCHASE, total: { amount: 36_800, currency: "RUB" } } as {
  mode: UiPaymentMode;
  purchase_id: string;
  total: { amount: number; currency: string };
};
const PAY_SHOWN = { text_version: "p4-pay@1.0", card: CARD } as const;
const PRESS = { at: "2026-11-22T23:00:00Z", device: "mobile", text_version: catalog.text_version, gesture: "tap" } as const;

/** Имена полей обходом в глубину, включая ключи объектов внутри массивов. */
function fieldNames(value: unknown, out: string[] = []): readonly string[] {
  if (Array.isArray(value)) {
    for (const item of value) fieldNames(item, out);
    return out;
  }
  if (value === null || typeof value !== "object") return out;
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    out.push(key);
    fieldNames(v, out);
  }
  return out;
}

/** Все строки тела — для просева на «похоже на номер карты». */
function strings(value: unknown, out: string[] = []): readonly string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const item of value) strings(item, out);
  else if (value !== null && typeof value === "object") for (const v of Object.values(value as Record<string, unknown>)) strings(v, out);
  return out;
}

const core = { purchase: () => null, feed: () => ({ cancel: () => undefined }) } as unknown as Parameters<typeof startUiServer>[0]["core"];

/** Живой стенд П4 целиком, с настоящим ключом и записью журналов в память. */
async function stand() {
  const sessions = new Sessions();
  const registrations = createRegistrationStore();
  const approvals = createPaymentApprovalStore();
  const written: unknown[] = [];
  const s = await startUiServer({
    core,
    owner: (req) => sessions.ownerOf(req),
    shell: { brandPath: "config/brand.demo.json", sessions, ownerOnPage: () => OWNER },
    passkey: {
      catalog,
      challenges: createChallengeStore(),
      registrations,
      approvals,
      journal: {
        write: (e: PasskeyRegisteredEntry) => void written.push(e),
        refused: (e: PasskeyRegistrationRefusedEntry) => void written.push(e),
      },
      approvalJournal: {
        write: (e: PaymentApprovedEntry) => void written.push(e),
        refused: (e: PaymentApprovalRefusedEntry) => void written.push(e),
      },
      verifier: createPasskeyVerifier({ onRefused: () => undefined }),
      nonce: (() => {
        let n = 0;
        return () => `nonce_k6_${++n}`;
      })(),
      origin: ORIGIN,
      rp_id: RP_ID,
      userId: () => "usr_случайный_к6",
      viewId: () => "vw_k6_1",
    },
  });
  const auth = createTestAuthenticator(RP_ID, PASSKEY_ID);
  const cookie = (await fetch(`${s.url}/ui`)).headers.get("set-cookie")!.split(";")[0]!;
  return { s, auth, cookie, registrations, approvals, written, close: () => s.close() };
}

const post = (url: string, cookie: string, body: unknown) =>
  fetch(url, { method: "POST", headers: { cookie, "content-type": "application/json", [IDEMPOTENCY_HEADER]: randomUUID() }, body: JSON.stringify(body) });

/** Пройти путь П4 целиком и собрать все тела, версии и записи журнала. `lang` — язык запроса: тексты живут парами
 *  ru/en, и просеивать один язык значит просеивать половину данных (находка ревью К6 № 3). */
async function walk(lang: "ru" | "en" = "ru") {
  const st = await stand();
  const q = `?lang=${lang}`;
  const bodies: Record<string, unknown> = {};
  const issued = await fetch(`${st.s.url}/ui/v1/passkey/registration${q}`, { headers: { cookie: st.cookie } });
  bodies["registration_challenge"] = await issued.json();
  const { challenge, view } = bodies["registration_challenge"] as { challenge: string; view: { hash: string; text_version: string } };

  const registered = await post(`${st.s.url}/ui/v1/passkey/registration`, st.cookie, {
    shown_hash: view.hash,
    pep_accepted: true,
    press: { ...PRESS, text_version: view.text_version },
    passkey: st.auth.registration({ challenge, origin: ORIGIN, counter: 4 }),
  });
  bodies["registration"] = await registered.json();

  const payHash = paymentShownHash(PAY_SHOWN);
  const payChallenge = await post(`${st.s.url}/ui/v1/payment/signature/challenge`, st.cookie, {
    purchase_id: PURCHASE,
    shown_hash: payHash,
    text_version: PAY_SHOWN.text_version,
  });
  bodies["signature_challenge"] = await payChallenge.json();
  const { challenge: payCh } = bodies["signature_challenge"] as { challenge: string };

  const signed = await post(`${st.s.url}/ui/v1/payment/signature`, st.cookie, {
    purchase_id: PURCHASE,
    shown_hash: payHash,
    press: { ...PRESS, text_version: PAY_SHOWN.text_version },
    assertion: st.auth.assertion({ challenge: payCh, origin: ORIGIN, counter: 9 }),
  });
  bodies["signature"] = await signed.json();

  /**
   * Отказы — **не одной ветвью на метод**, и у каждого назван **статус и код** (находки ревью К6 № 1 и № 2).
   *
   * Почему статус и код обязательны: отвались сессия или куки, и все отказы вернули бы `SESSION_REQUIRED` 401 — тоже
   * JSON, тоже без реквизитов, и просев остался бы зелёным, ничего не проверив (дословно находка ревью К6 № 3
   * ИН-П1). Почему мало первой ветви: тексты у отказов **разные**, а у `SHOWN_STALE` в запись журнала идёт причина
   * с величиной — именно её и сторожит инвариант 1 «в журнале только свои опознаватели».
   */
  const refusals: { readonly name: string; readonly status: number; readonly code: string }[] = [];
  const refuse = async (name: string, path: string, body: unknown, status: number, code: string) => {
    const res = await post(`${st.s.url}/ui/v1${path}${q}`, st.cookie, body);
    expect(res.status, `${name}: статус`).toBe(status);
    const got = (await res.json()) as { error: { code: string } };
    expect(got.error.code, `${name}: код`).toBe(code);
    bodies[name] = got;
    refusals.push({ name, status, code });
  };

  await refuse("refusal_registration_shape", "/passkey/registration", { shown_hash: "x" }, 400, "PASSKEY_SIGNATURE_INVALID");
  // Соглашение о ПЭП не отмечено: своя ветвь, свой текст.
  const second = await fetch(`${st.s.url}/ui/v1/passkey/registration${q}`, { headers: { cookie: st.cookie } });
  const live = (await second.json()) as { challenge: string; view: { hash: string; text_version: string } };
  await refuse(
    "refusal_registration_pep",
    "/passkey/registration",
    {
      shown_hash: live.view.hash,
      press: { ...PRESS, text_version: live.view.text_version },
      passkey: st.auth.registration({ challenge: live.challenge, origin: ORIGIN }),
    },
    400,
    "PEP_NOT_ACCEPTED",
  );
  // Версия текстов нажатия не та: причина уходит в журнал, и в ней не должно быть строки экрана.
  const third = await fetch(`${st.s.url}/ui/v1/passkey/registration${q}`, { headers: { cookie: st.cookie } });
  const live3 = (await third.json()) as { challenge: string; view: { hash: string; text_version: string } };
  await refuse(
    "refusal_registration_stale",
    "/passkey/registration",
    {
      shown_hash: live3.view.hash,
      pep_accepted: true,
      press: { ...PRESS, text_version: cardLikeNumber("7") },
      passkey: st.auth.registration({ challenge: live3.challenge, origin: ORIGIN }),
    },
    409,
    "SHOWN_STALE",
  );
  await refuse("refusal_challenge_shape", "/payment/signature/challenge", {}, 400, "PASSKEY_SIGNATURE_INVALID");
  await refuse("refusal_signature_shape", "/payment/signature", {}, 400, "PASSKEY_SIGNATURE_INVALID");
  await refuse(
    "refusal_signature_no_challenge",
    "/payment/signature",
    {
      // Опознаватель **по форме**, но несуществующий: русские буквы отбила бы проверка формы, и случай проверял бы
      // не ту ветвь (`PASSKEY_SIGNATURE_INVALID` вместо `CHALLENGE_UNKNOWN`).
      purchase_id: "pur_k6_absent",
      shown_hash: paymentShownHash(PAY_SHOWN),
      press: { ...PRESS, text_version: PAY_SHOWN.text_version },
      assertion: { passkey_id: PASSKEY_ID, client_data: "cd", authenticator_data: "ad", signature: "sig" },
    },
    409,
    "CHALLENGE_UNKNOWN",
  );

  return { st, bodies, refusals, view, payHash, statuses: { registered: registered.status, signed: signed.status } };
}

describe("сквозной путь П4: регистрация, затем подпись оплаты", () => {
  it("путь проходится целиком, версии говорят каждая об одной карточке, счётчик вырос", async () => {
    const { st, statuses, view, payHash } = await walk();
    try {
      expect(statuses.registered).toBe(200);
      expect(statuses.signed).toBe(200);

      const reg = st.registrations.all(OWNER);
      expect(reg).toHaveLength(1);
      // Версия регистрации говорит о карточке П4; версия подтверждения — о карточке оплаты. Пары **разные**, и это
      // ровно то, чего не было до блокера ревью К4 № 1: тогда вторая пара склеивалась из двух карточек.
      // Сверяется **и хэш** (находка ревью К6 № 5): прежде сходилась только версия текстов, а она у регистрации
      // совпадает с той, что нёс `press`, — то есть обещание «пара из одной карточки» не проверялось.
      expect(reg[0]?.shown).toEqual({ hash: view.hash, text_version: catalog.text_version });
      expect(reg[0]?.shown.hash).not.toBe(payHash);
      expect(reg[0]?.counter).toBe(4);

      const approvals = st.approvals.all(OWNER);
      expect(approvals).toHaveLength(1);
      expect(approvals[0]?.shown).toEqual({ hash: paymentShownHash(PAY_SHOWN), text_version: "p4-pay@1.0" });
      expect(approvals[0]?.by).toBe("human");

      // Счётчик ключа поднялся с 4 (регистрация) до 9 (подпись) — К2 и К3а сошлись на живом пути.
      const { createPasskeyRegistry } = await import("../../src/signature/registration.js");
      expect(createPasskeyRegistry(st.registrations).counterOf(OWNER, PASSKEY_ID)).toBe(9);

      /**
       * Журнал: две удачи и шесть отказов, каждый — **в своём** журнале.
       *
       * Это **красная проверка правки выбора журнала** (Р-1702, шаг воспроизведения): верни выбор по наличию
       * `purchase_id` в теле — и отказы методов оплаты с негодной покупкой уедут в журнал регистрации, а это
       * ожидание покраснеет. Так ошибка и нашлась: до К6 журналы в фикстуре были одним объектом и различить их было
       * нечем.
       */
      expect(st.written.map((e) => (e as { event: string }).event)).toEqual([
        "passkey.registered",
        "payment.approved",
        // три отказа регистрации: негодная форма, ПЭП не отмечен, версия текстов не та
        "passkey.registration_refused",
        "passkey.registration_refused",
        "passkey.registration_refused",
        // три отказа оплаты: негодная форма вызова, негодная форма подписи, вызова нет
        "payment.approval_refused",
        "payment.approval_refused",
        "payment.approval_refused",
      ]);
    } finally {
      await st.close();
    }
  });
});

/**
 * Просев одного куска — **одна функция** на зелёные случаи и на красные фикстуры (находка ревью К6 № 6).
 *
 * Прежде зелёный случай был встроенным циклом, а красная фикстура собирала фильтр заново: доказывалось, что работает
 * **предикат**, а не что покраснеет само ожидание. Теперь красным показывается ровно эта функция.
 */
function sift(what: string, piece: unknown): void {
  for (const name of fieldNames(piece)) if (hitsForbidden(name)) throw new Error(`${what}: запретное имя поля ${name}`);
  for (const s of strings(piece)) if (hasCardNumber(s)) throw new Error(`${what}: строка, похожая на номер карты`);
}

describe("инвариант 1 на всех телах П4, версиях и журналах — на двух языках", () => {
  for (const lang of ["ru", "en"] as const) {
    it(`всё, что уходит человеку и в журнал, просеяно (${lang})`, async () => {
      // Оба языка (находка ревью К6 № 3): тексты живут парами ru/en, и просев одного языка — это просев половины.
      const { st, bodies, refusals } = await walk(lang);
      try {
        // Число кусков названо: пропусти метод или ветвь отказа — покраснеет здесь, а не «тихо сойдётся» на меньшем.
        expect(Object.keys(bodies)).toHaveLength(10);
        expect(refusals).toHaveLength(6);
        for (const [name, piece] of Object.entries(bodies)) expect(() => sift(name, piece), name).not.toThrow();
        for (const v of st.registrations.all(OWNER)) expect(() => sift("версия регистрации", v)).not.toThrow();
        for (const v of st.approvals.all(OWNER)) expect(() => sift("версия подтверждения", v)).not.toThrow();
        for (const e of st.written) expect(() => sift(`журнал ${(e as { event: string }).event}`, e)).not.toThrow();
        expect(st.written).toHaveLength(8);
      } finally {
        await st.close();
      }
    });
  }

  it("причина отказа в журнале не несёт строку экрана — даже похожую на номер карты", async () => {
    // Главная дыра, которую нашло ревью К6 № 2: `press.text_version` по контракту любая непустая строка, и первая
    // редакция склеивала её в причину журнала как есть. Здесь экран присылает строку, **похожую на номер карты**
    // (собрана генератором в прогоне, в файл не пишется — Р-1699), и в журнале её быть не должно.
    const { st } = await walk();
    try {
      const stale = st.written.filter((e) => (e as { code?: string }).code === "SHOWN_STALE");
      expect(stale).toHaveLength(1);
      expect(() => sift("журнал SHOWN_STALE", stale[0])).not.toThrow();
      // И причина названа: в ней стоит **наша** версия текстов, а не пришедшая.
      expect((stale[0] as { reason: string }).reason).toContain(catalog.text_version);
    } finally {
      await st.close();
    }
  });

  it("просев **красный** на запретном имени поля — фикстура остаётся (Р-1698)", async () => {
    const { st, bodies } = await walk();
    try {
      // Имя взято **запретное** (`card_number`), а не `instrument_token`: токен инструмента инвариант 1 как раз
      // **разрешает**, и первая редакция этого случая проверяла запрет на разрешённом имени — то есть ничего.
      expect(() => sift("подделка", { ...(bodies["registration"] as object), card_number: "х" })).toThrow(/запретное имя поля card_number/);
      // Закрытый ключ и биометрия — теперь в **общем** перечне (находка ревью К6 № 4): свой список слов внутри теста
      // был вторым источником и к тому же случайно краснел на base64 открытого ключа.
      expect(() => sift("подделка", { private_key: "…" })).toThrow(/private_key/);
      expect(() => sift("подделка", { biometrics: "…" })).toThrow(/biometrics/);
      // А разрешённые опознаватели просев **не** ловит — иначе он запрещал бы то, на чём держится ПЭП.
      expect(() => sift("разрешённое", { instrument_token: "tok_1", public_key: "cose", passkey_id: PASSKEY_ID })).not.toThrow();
      // Перечень ловит то, что должен, и не ловит безвредного — сверка **общим** перечнем, а не своим.
      for (const bad of FORBIDDEN_EXAMPLES) expect(hitsForbidden(bad), bad).toBe(true);
      for (const ok of ALLOWED_EXAMPLES) expect(hitsForbidden(ok), ok).toBe(false);
    } finally {
      await st.close();
    }
  });

  it("просев **красный** на строке, похожей на номер карты — фикстура остаётся (Р-1698)", async () => {
    const { st, bodies } = await walk();
    try {
      expect(() => sift("подделка", { ...(bodies["signature"] as object), note: cardLikeNumber("4") })).toThrow(/похожая на номер карты/);
    } finally {
      await st.close();
    }
  });

  it("в записях отказа оплаты стоит покупка, а не выдуманная величина", async () => {
    // Та самая величина, по которой журнал прежде выбирался неверно (находка ревью К6 № 10).
    const { st } = await walk();
    try {
      const payRefusals = st.written.filter((e) => (e as { event: string }).event === "payment.approval_refused");
      expect(payRefusals).toHaveLength(3);
      // У двух первых тело было пустым, покупки в нём нет — в записи стоит `null`, а не выдуманная величина; у
      // третьего покупка названа и уходит в запись как есть.
      expect(payRefusals.map((e) => (e as { purchase_id: string | null }).purchase_id)).toEqual([null, null, "pur_k6_absent"]);
    } finally {
      await st.close();
    }
  });

  it("открытый ключ в версии есть, в журнале нет", async () => {
    const { st } = await walk();
    try {
      const version = st.registrations.all(OWNER)[0]!;
      expect(version.public_key.length).toBeGreaterThan(20);
      const registered = st.written.find((e) => (e as { event: string }).event === "passkey.registered")!;
      // В журнале — опознаватель, а не ключ: журнал читают как доказательство события, а не как хранилище ключей.
      expect(Object.keys(registered as object)).not.toContain("public_key");
      // Поиска слов подстрокой по всему JSON здесь **нет** (находка ревью К6 № 4): он был недетерминирован —
      // `private`, `pan` или `cvv` случайно выпадают внутри base64 открытого ключа раз в сотню прогонов, — и завёл
      // второй перечень рядом с общим. Закрытый ключ и биометрия теперь просеиваются **по именам полей** общим
      // перечнем, вместе со всем остальным.
    } finally {
      await st.close();
    }
  });
});
