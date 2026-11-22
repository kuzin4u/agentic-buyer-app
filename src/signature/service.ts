// ИН-П2, кирпич К4 — **четыре метода `/ui/v1`** формы П37 п. 3: выдача вызова и приём ответа для регистрации пасскея
// и для подписи оплаты. Постановка v1.1; решения владельца 22.11.2026 — П37 с дополнениями 1–3, **Р-1716** (вариант
// А), **Р-1720** (способ оплаты в показанном), **Р-1721**, **Р-1728**.
//
// Здесь собираются **тела целиком**: экран ничего не считает и ничего не формулирует (правило 3 К-Б) — доступность,
// тексты и причины приходят готовыми из данных К1. Правила HTTP (ключ идемпотентности, память повторов, сессия) живут
// в общем слое сервера (`src/ui-server/`), и этот модуль их не повторяет: он отдаёт исход, а маршрут — ответ.
//
// **`path` в телах пока нет** — П37, дополнение 3 (22.11.2026): шаг пути приходит числами **только из канвы**
// (Р-1511), новой канвы П4 ещё нет, и литерал поставить нельзя. Поле добавляет **К5** вместе с канвой; у каждого тела
// есть ожидание на состав, чтобы `path` не появился тихо. Тот же довод и то же решение, что в кирпиче **К1**, где по
// этой причине убран номер шага из данных экрана.
//
// **Пометка `PENDING_V1_6`:** тел и кодов этих методов в действующем контракте К-Б **v1.5** нет — их внесёт выпуск
// v1.6. До него форма сверяется с решением П37, а не с документом; перечень кодов, их статусы и классы повтора живут
// одним местом (`webauthn.ts`), и второй таблицы в приложении нет (Р-1681).
import {
  UI_ERROR_STATUS,
  checkUiPress,
  isShownHash,
  retryFor,
  showingHash,
  type ShownHash,
  type UiInstant,
  type UiLang,
  type UiPress,
  type UiSignedBy,
} from "../contract/ui-v1/index.js";
import {
  PASSKEY_REFUSAL_RETRY,
  PASSKEY_REFUSAL_STATUS,
  checkPaymentAssertion,
  issueChallenge,
  type ChallengeStore,
  type PasskeyAssertion,
  type PasskeyRefusalCode,
  type PasskeyRegistrationAnswer,
  type PasskeyVerifier,
} from "./webauthn.js";
import { recordPaymentApproval, type PaymentApprovalJournal, type PaymentApprovalStore } from "./m2.js";
import { createPasskeyRegistry, recordRegistration, type PasskeyRegistrationJournal, type RegistrationStore } from "./registration.js";
import type { PasskeyCatalog, PasskeyTextCode } from "./texts.js";

/** Исход метода: тело и статус. Отказ несёт **код, класс повтора и готовый текст** — ровно четыре поля тела ошибки
 *  § 3 контракта; `view` у этих методов не выдаётся, поэтому он `null` (новая карточка приходит перечитыванием). */
export type PasskeyOutcome =
  | { readonly ok: true; readonly status: number; readonly body: Record<string, unknown> }
  | { readonly ok: false; readonly status: number; readonly body: { readonly error: { readonly code: string; readonly retry: string; readonly text: string; readonly view: null } } };

/** Отказ человеку: код машине, готовый текст человеку (правило 3), класс повтора — у источника (Р-1681). */
export function passkeyRefusal(code: PasskeyRefusalCode | "SHOWN_STALE", lang: UiLang, catalog: PasskeyCatalog): PasskeyOutcome {
  const text = catalog.errors[code as PasskeyTextCode][lang];
  // `SHOWN_STALE` — код **контракта** (§ 6 v1.5): статус и класс берутся **из таблиц контракта**, а не литералами.
  // Прежде они стояли здесь числом и строкой, то есть второй копией класса повтора против Р-1681 (находка ревью
  // К4 № 4) — ровно то расхождение, из которого вышло расхождение № 25.
  const status = code === "SHOWN_STALE" ? UI_ERROR_STATUS["SHOWN_STALE"] : PASSKEY_REFUSAL_STATUS[code];
  const retry = code === "SHOWN_STALE" ? retryFor(["SHOWN_STALE"])["SHOWN_STALE"] : PASSKEY_REFUSAL_RETRY[code];
  return { ok: false, status, body: { error: { code, retry, text, view: null } } };
}

/**
 * Отказ человеку **и строка в журнал** (находка ревью К4 № 6): типы записей отказа объявлены в К2 и К3 с прямым
 * указанием «пишет её сервис `/ui/v1` (кирпич К4)», а потребителя у них не было — разбирать «человек не смог
 * подтвердить оплату» было бы нечем.
 *
 * Человеку уходит код и готовый текст; **причина** (какая величина не сошлась) идёт только в журнал — экрану она не
 * нужна и не отдаётся (правило 3 К-Б, П32 дополнение 1).
 *
 * **Строк, пришедших от экрана, в причине нет** (находка ревью К6 № 2): сперва причина несовпадения версий текстов
 * склеивалась из обоих значений, и значение экрана (`press.text_version` — по контракту любая непустая строка)
 * уходило в журнал как есть. Журнал по инварианту 1 держит **только** свои опознаватели: экран мог бы положить туда
 * что угодно, вплоть до строки, похожей на номер карты. Поэтому в причине стоит **наша** величина, а про пришедшую
 * сказано, что она не совпала.
 */
/** Журнал регистрации — одной величиной, чтобы у каждого вызова отказа было видно, куда он пишет. */
const REG = { kind: "REGISTRATION" } as const;

/** Журнал подтверждений оплаты: покупка может быть и негодной — тогда `null`, и это видно в записи. */
const PAY = (purchase_id: string | null) => ({ kind: "PAYMENT", purchase_id }) as const;

function refuseAndLog(
  code: PasskeyRefusalCode | "SHOWN_STALE",
  reason: string,
  owner: string,
  lang: UiLang,
  deps: PasskeyServiceDeps,
  /**
   * В какой журнал. **Выбирается методом, а не наличием `purchase_id` в теле** (нашлось сквозным тестом К6): пока
   * журнал выбирался по полю, отказ метода оплаты с негодной покупкой уходил в журнал **регистрации** — на разборе
   * «человек не смог подтвердить оплату» строка лежала бы не там, где её ищут.
   *
   * **Шаг воспроизведения** (Р-1702): верни выбор журнала по `purchase_id` — и ожидание перечня событий в
   * `tests/signature/invariant1.test.ts` («путь проходится целиком») покраснеет: три отказа оплаты уедут в журнал
   * регистрации. Обязательный параметр `where` закрывает это и компиляцией — новый отказ без него не соберётся.
   */
  where: typeof REG | { readonly kind: "PAYMENT"; readonly purchase_id: string | null },
): PasskeyOutcome {
  const received_at = deps.now();
  const by = deps.by();
  if (where.kind === "REGISTRATION") deps.journal.refused({ event: "passkey.registration_refused", owner, code, reason, by, received_at });
  else deps.approvalJournal.refused({ event: "payment.approval_refused", owner, code, reason, purchase_id: where.purchase_id, by, received_at });
  return passkeyRefusal(code, lang, deps.catalog);
}

export interface PasskeyServiceDeps {
  readonly catalog: PasskeyCatalog;
  readonly challenges: ChallengeStore;
  readonly registrations: RegistrationStore;
  readonly verifier: PasskeyVerifier;
  readonly journal: PasskeyRegistrationJournal;
  readonly approvals: PaymentApprovalStore;
  readonly approvalJournal: PaymentApprovalJournal;
  readonly now: () => UiInstant;
  readonly nonce: () => string;
  readonly by: () => UiSignedBy;
  readonly origin: string;
  readonly rp_id: string;
  /** Случайный опознаватель человека для устройства (П37 п. 2): **не телефон, не почта, не имя** — устройство хранит
   *  его рядом с ключом и может показывать. Даёт его тот, кто поднял сервер; модуль его не придумывает. */
  readonly userId: (owner: string) => string;
  readonly viewId: () => string;
}

/** Что показывается на П4 — то, над чем встанет подпись регистрации (правило 1 К-Б). Карточка собирается **из данных
 *  К1**: экран своих слов не придумывает. */
export function registrationShown(catalog: PasskeyCatalog, lang: UiLang): { readonly text_version: string; readonly card: Record<string, unknown> } {
  return {
    text_version: catalog.text_version,
    card: {
      title: catalog.screen.title[lang],
      subtitle: catalog.screen.subtitle[lang],
      footer: catalog.screen.footer[lang],
      pep_title: catalog.pep.title[lang],
      pep_text: catalog.pep.text[lang],
      pep_text_version: catalog.pep.text_version,
      note: catalog.pep.note[lang],
      lang,
    },
  };
}

/**
 * Провенанс нажатия — **проверяется контрактом** (`checkUiPress`), а не берётся как есть (находка ревью К4 № 5).
 *
 * Прежде он приводился типом, и тело `{press: 5}` или `{press: {}}` проходило: заморозка в версии превращала его в
 * пустой объект, и в подписанную версию и журнал уходил **пустой провенанс** — то есть П26 («умолчания у провенанса
 * нет, тело без `press` сервер не принимает») держался на словах. У `/consent` тот же случай отвечает отказом, и
 * здесь теперь так же.
 */
const pressOf = (body: unknown): UiPress | null => {
  if (body === null || typeof body !== "object") return null;
  const press: unknown = (body as Record<string, unknown>)["press"];
  return checkUiPress(press) === null ? (press as UiPress) : null;
};

const strOf = (body: unknown, key: string): string | null => {
  if (body === null || typeof body !== "object") return null;
  const v: unknown = (body as Record<string, unknown>)[key];
  return typeof v === "string" && v !== "" ? v : null;
};

/** Опознаватель покупки — **по форме** (находка ревью К4 № 14): та же форма, что у `GET /ui/v1/purchase/{id}`. В
 *  журнал и в подписанную версию опознаватель уходит, и пускать туда любую строку от экрана нельзя (инвариант 1). */
const PURCHASE_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** Объект с непустыми строковыми полями — форма ответа устройства (находка ревью К4 № 3): прежде проверялось только
 *  `!== undefined`, и тело с `assertion: null` роняло сборку в 500 вместо отказа, не заняв ключ идемпотентности. */
const answerOf = <K extends string>(body: unknown, key: string, fields: readonly K[]): Readonly<Record<K, string>> | null => {
  if (body === null || typeof body !== "object") return null;
  const v: unknown = (body as Record<string, unknown>)[key];
  if (v === null || typeof v !== "object" || Array.isArray(v)) return null;
  const rec = v as Record<string, unknown>;
  for (const f of fields) if (typeof rec[f] !== "string" || rec[f] === "") return null;
  return rec as Readonly<Record<K, string>>;
};

/**
 * `GET /ui/v1/passkey/registration` — вызов регистрации и соглашение о ПЭП.
 *
 * Вызов строится **из хэша показанного и одноразового числа** (постановка v1.1): подпись, не сошедшаяся с вызовом,
 * отклоняется, и пасскеем нельзя зарегистрироваться «вообще», минуя показанное. `user.id` — случайный опознаватель от
 * сборки сервера (П37 п. 2).
 */
export function getPasskeyRegistration(owner: string, lang: UiLang, deps: PasskeyServiceDeps): PasskeyOutcome {
  const shown = registrationShown(deps.catalog, lang);
  const view = { view_id: deps.viewId(), text_version: shown.text_version, hash: shownHashOf(shown) };
  const challenge = issueChallenge(
    { store: deps.challenges, now: deps.now, nonce: deps.nonce, ttlMs: deps.catalog.challenge_ttl_ms },
    { owner, purpose: "REGISTRATION", purchase_id: null, shown: { hash: view.hash, text_version: view.text_version } },
  );
  return {
    ok: true,
    status: 200,
    body: {
      challenge: challenge.value,
      rp_id: deps.rp_id,
      user: { id: deps.userId(owner) },
      timeout_ms: deps.catalog.challenge_ttl_ms,
      pep: { text_version: deps.catalog.pep.text_version, text: deps.catalog.pep.text[lang] },
      // Доступность здесь **всегда** `true`, и это названо, а не выдано за «готовое из данных» (находка ревью
      // К4 № 10): умеет ли устройство подтверждать касанием, знает **экран**, а не сервер — он и отвечает
      // `PASSKEY_NOT_SUPPORTED`, не отправляя ответа (К5). Сервер не может судить о телефоне, которого не видит.
      actions: { register: { enabled: true, label: deps.catalog.screen.register_label[lang], why_disabled: null } },
      view,
      // `path` здесь **нет** — П37, дополнение 3: шаг приходит из канвы, его добавляет К5.
    },
  };
}

/** Хэш показанного — **общим правилом контракта**: канонизацию и хэш считает ядро (`showingHash`, Р-1613), своей
 *  копии правила в приложении нет. Карточке регистрации `paymentShown` не годится — у неё нет и не должно быть
 *  способа оплаты, обязательного у карточки подтверждения оплаты (Р-1720). */
const shownHashOf = (shown: { readonly text_version: string; readonly card: Record<string, unknown> }): ShownHash => showingHash(shown);

/**
 * `POST /ui/v1/passkey/registration` — приём ответа устройства и запись регистрации.
 *
 * Порядок: форма тела → соглашение о ПЭП → вызов → проверка ответа библиотекой → запись неизменяемой версией. Так
 * отказ говорит о первой несошедшейся величине, а запись появляется только после проверки.
 */
export async function postPasskeyRegistration(
  body: unknown,
  owner: string,
  lang: UiLang,
  deps: PasskeyServiceDeps,
): Promise<PasskeyOutcome> {
  const press = pressOf(body);
  const shownHash = strOf(body, "shown_hash");
  // Форма ответа устройства по П37 п. 3: `passkey: { id, client_data, attestation }`.
  const answer = answerOf(body, "passkey", ["id", "client_data", "attestation"]) as PasskeyRegistrationAnswer | null;
  if (press === null || shownHash === null || !isShownHash(shownHash) || answer === null)
    return refuseAndLog("PASSKEY_SIGNATURE_INVALID", "негодная форма тела регистрации", owner, lang, deps, REG);
  // Соглашение о ПЭП — **обязательная отметка**: без него подтверждать поручения нечем (П37 п. 1).
  if ((body as Record<string, unknown>)["pep_accepted"] !== true)
    return refuseAndLog("PEP_NOT_ACCEPTED", "соглашение о ПЭП не отмечено", owner, lang, deps, REG);

  // Вызов находится **по человеку и делу**, а не по значению из тела: поля `challenge` в записанной форме П37 нет
  // (находка ревью К4 № 8), и экрану незачем возвращать то, что сервер выдал сам.
  const issued = deps.challenges.consumeFor(owner, "REGISTRATION", null);
  if (issued === null) return refuseAndLog("CHALLENGE_UNKNOWN", "живого вызова регистрации у этого человека нет", owner, lang, deps, REG);
  if (Date.parse(deps.now()) > Date.parse(issued.expires_at))
    return refuseAndLog("CHALLENGE_EXPIRED", "срок вызова регистрации вышел", owner, lang, deps, REG);
  if (issued.shown.hash !== shownHash) return refuseAndLog("SHOWN_STALE", "присланный хэш не совпал с хэшем вызова", owner, lang, deps, REG);
  // Версия текстов показанного и версия текстов нажатия обязаны совпасть (П26): расходись они — человек подтверждал
  // не те тексты, что сервер считает показанными.
  if (press.text_version !== issued.shown.text_version)
    return refuseAndLog("SHOWN_STALE", `версия текстов нажатия не совпала с показанным ${issued.shown.text_version}`, owner, lang, deps, REG);

  const checked = await deps.verifier.verifyRegistration({
    answer,
    expected_challenge: issued.value,
    expected_origin: deps.origin,
    expected_rp_id: deps.rp_id,
  });
  if (!checked.verified) return refuseAndLog("PASSKEY_SIGNATURE_INVALID", "библиотека не подтвердила ответ регистрации", owner, lang, deps, REG);
  if (!checked.user_verified) return refuseAndLog("PASSKEY_USER_NOT_VERIFIED", "ответ регистрации без подтверждения человеком", owner, lang, deps, REG);

  const version = recordRegistration(
    { store: deps.registrations, journal: deps.journal, now: deps.now, by: deps.by },
    {
      owner,
      passkey_id: checked.passkey_id,
      public_key: checked.public_key,
      rp_id: deps.rp_id,
      counter: checked.counter,
      pep_text_version: deps.catalog.pep.text_version,
      // Запись показанного — **из вызова**, одной парой: хэш и версия текстов говорят об одной карточке (блокер
      // ревью К4 № 1).
      shown: issued.shown,
      press,
    },
  );
  return {
    ok: true,
    status: 200,
    body: {
      registration: {
        version: version.no,
        passkey_id: version.passkey_id,
        by: version.by,
        received_at: version.received_at,
        shown: version.shown,
      },
    },
  };
}

/**
 * `POST /ui/v1/payment/signature/challenge` — вызов для подписи оплаты.
 *
 * Отдаёт опознаватели **зарегистрированных** ключей этого человека (Р-1728: действуют все), чтобы устройство выбрало
 * свой. Нет ни одного — `PASSKEY_NOT_REGISTERED`: человек проходит П4.
 */
export function postPaymentSignatureChallenge(body: unknown, owner: string, lang: UiLang, deps: PasskeyServiceDeps): PasskeyOutcome {
  const purchaseId = strOf(body, "purchase_id");
  const shownHash = strOf(body, "shown_hash");
  const textVersion = strOf(body, "text_version");
  // Версия текстов карточки приходит **вместе с хэшем**: она уходит в вызов, а из вызова — в подписанную версию, и
  // пара обязана говорить об одной карточке (блокер ревью К4 № 1).
  if (purchaseId === null || !PURCHASE_ID.test(purchaseId) || shownHash === null || !isShownHash(shownHash) || textVersion === null)
    return refuseAndLog("PASSKEY_SIGNATURE_INVALID", "негодная форма тела вызова подписи", owner, lang, deps, PAY(purchaseId));
  const keys = deps.registrations.all(owner);
  if (keys.length === 0) return refuseAndLog("PASSKEY_NOT_REGISTERED", "у человека нет ни одного пасскея", owner, lang, deps, PAY(purchaseId));
  const challenge = issueChallenge(
    { store: deps.challenges, now: deps.now, nonce: deps.nonce, ttlMs: deps.catalog.challenge_ttl_ms },
    { owner, purpose: "PAYMENT", purchase_id: purchaseId, shown: { hash: shownHash, text_version: textVersion } },
  );
  return {
    ok: true,
    status: 200,
    body: {
      challenge: challenge.value,
      timeout_ms: deps.catalog.challenge_ttl_ms,
      // Перечень без повторов: один ключ мог регистрироваться дважды, и дважды предлагать его устройству незачем.
      passkey_ids: [...new Set(keys.map((k) => k.passkey_id))],
    },
  };
}

/**
 * `POST /ui/v1/payment/signature` — подпись оплаты пасскеем и запись подтверждения.
 *
 * Проверку делает К3а (`checkPaymentAssertion`), запись — механика К3 (`recordPaymentApproval`): здесь они встречаются
 * впервые. Подтверждение записывается **только** после удачной проверки, и в нём стоит признак «кто нажал» от сервера.
 */
export async function postPaymentSignature(body: unknown, owner: string, lang: UiLang, deps: PasskeyServiceDeps): Promise<PasskeyOutcome> {
  const press = pressOf(body);
  const purchaseId = strOf(body, "purchase_id");
  const shownHash = strOf(body, "shown_hash");
  const assertion = answerOf(body, "assertion", ["passkey_id", "client_data", "authenticator_data", "signature"]) as PasskeyAssertion | null;
  if (press === null || purchaseId === null || !PURCHASE_ID.test(purchaseId) || shownHash === null || !isShownHash(shownHash) || assertion === null)
    return refuseAndLog("PASSKEY_SIGNATURE_INVALID", "негодная форма тела подписи оплаты", owner, lang, deps, PAY(purchaseId));

  // Вызов — **свой, по человеку и покупке** (поля `challenge` в форме П37 нет): читается **без вычёркивания**, потому
  // что вычеркнёт его проверка подписи — правило «вызов одноразовый» остаётся в одном месте (`checkPaymentAssertion`).
  const mine = deps.challenges.peekFor(owner, "PAYMENT", purchaseId);
  if (mine === null)
    return refuseAndLog("CHALLENGE_UNKNOWN", "живого вызова подписи у этого человека и покупки нет", owner, lang, deps, PAY(purchaseId));
  if (press.text_version !== mine.shown.text_version)
    return refuseAndLog(
      "SHOWN_STALE",
      `версия текстов нажатия не совпала с показанным ${mine.shown.text_version}`,
      owner,
      lang,
      deps,
      PAY(purchaseId),
    );

  const checked = await checkPaymentAssertion(
    {
      store: deps.challenges,
      registry: createPasskeyRegistry(deps.registrations),
      verifier: deps.verifier,
      now: deps.now,
      origin: deps.origin,
      rp_id: deps.rp_id,
    },
    { owner, purchase_id: purchaseId, shown_hash: shownHash, challenge: mine.value, assertion },
  );
  if (!checked.ok) return refuseAndLog(checked.code, checked.reason, owner, lang, deps, PAY(purchaseId));

  const approval = recordPaymentApproval(
    { store: deps.approvals, journal: deps.approvalJournal, now: deps.now, by: deps.by },
    // Запись показанного — **из вызова**, одной парой об одной карточке (блокер ревью К4 № 1).
    { owner, purchase_id: purchaseId, shown: checked.shown, press },
  );
  return {
    ok: true,
    status: 200,
    body: {
      approval: {
        version: approval.no,
        purchase_id: approval.purchase_id,
        by: approval.by,
        received_at: approval.received_at,
        shown: approval.shown,
      },
    },
  };
}

// Ре-экспорта `paymentShown` здесь **нет** (находка ревью К4 № 12): он уже выходит из `webauthn.ts` через поверхность
// модуля, и второй путь импорта того же — это два места вместо одного, ровно против чего и был довод.
