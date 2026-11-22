// ИН-П2, кирпич К3а — **серверная проверка ответа пасскея** (WebAuthn): решение **П37** п. 3, решения владельца
// **Р-1716** (вариант А: пасскей подписывает хэш показанного как ПЭП приложения), **Р-1721** (библиотека
// `@simplewebauthn/server`) и **Р-1720** (способ оплаты входит в показанное), все от 22.11.2026.
//
// Здесь живёт то, что принадлежит **приложению**, а не криптографии: как строится вызов, когда он годен, что должно
// совпасть с показанным и как ведёт себя счётчик. Сама проверка подписи делегируется библиотеке **портом**
// `PasskeyVerifier` (адаптер — `passkey-verifier.ts`): криптографию чужого формата приложение не пишет само, а
// подменяемый порт даёт каждой отказной ветке свою красную фикстуру (**Р-1698**).
//
// **Вызов строится из хэша показанного и одноразового числа** (постановка v1.1, § «Связь пасскея с хэшем
// показанного»): подпись, не сошедшаяся с вызовом, отклоняется — пасскеем нельзя подписать не ту карточку. Вызов
// одноразовый и со сроком; срок приходит **величиной данных** (`config/`, кирпич К1), а не литералом здесь.
//
// **Коды отказов объявлены здесь, и это названное исключение, а не вторая копия перечня.** В контракте
// (`src/contract/ui-v1/errors.ts`) перечень `UI_ERROR_CODES` сверяется с § 6 документа **строго в обе стороны**
// (тест К2.4): добавь туда код, которого в К-Б **v1.5** нет, — и контрактный тест покраснеет, потому что документ
// его не называет. Поэтому до выпуска **К-Б v1.6** единственное место этих кодов — здесь, с пометкой
// `PENDING_V1_6`; кирпич К4 переносит их в контракт тем же составом, когда документ их назовёт. Класс повтора у
// каждого назван решением П37 (Р-1681: класс — один на приложение и только у источника).
import { createHash } from "node:crypto";
import { showingHash, type ShownHash, type ShownPayload, type UiInstant, type UiPaymentMode } from "../contract/ui-v1/index.js";

/** Зачем выдан вызов: регистрация пасскея (П4) или подпись оплаты (М2). Перечень закрыт: вызов одного дела не годится
 *  для другого, и это проверяется, а не предполагается. */
export const PASSKEY_PURPOSES = ["REGISTRATION", "PAYMENT"] as const;

export type PasskeyPurpose = (typeof PASSKEY_PURPOSES)[number];

/**
 * Коды отказа проверки пасскея — **закрытый перечень с пометкой `PENDING_V1_6`** (см. шапку: в контракт они попадут
 * выпуском К-Б v1.6 кирпичом К4). Класс повтора назван решением **П37**:
 *
 * | Код | HTTP | Класс | Когда |
 * |---|---|---|---|
 * | `PASSKEY_NOT_SUPPORTED` | 409 | `after_human` | устройство не умеет пасскей; на устройстве с пасскеем человек пройдёт |
 * | `PEP_NOT_ACCEPTED` | 400 | `after_fix` | соглашение о ПЭП не отмечено |
 * | `CHALLENGE_EXPIRED` | 409 | `after_human` | срок вызова вышел — человек касается заново |
 * | `CHALLENGE_UNKNOWN` | 409 | `never` | вызова нет или он уже использован |
 * | `PASSKEY_SIGNATURE_INVALID` | 400 | `never` | подпись не сошлась с вызовом или с открытым ключом |
 * | `PASSKEY_COUNTER_REGRESSED` | 409 | `never` | счётчик убыл — признак копии ключа |
 * | `PASSKEY_NOT_REGISTERED` | 409 | `after_human` | подписывает ключ, которого у этого человека нет |
 *
 * `SHOWN_STALE` среди них нет намеренно: это **код контракта** (§ 6 v1.5), он уже есть в `UI_ERROR_CODES` и берётся
 * оттуда — второй копии ему здесь не нужно.
 */
export const PASSKEY_REFUSAL_CODES = [
  // Эти два производят **другие кирпичи**, а не проверка подписи (находка ревью К3а № 10: перечень не должен быть
  // шире кода без названной причины): `PASSKEY_NOT_SUPPORTED` — экран и метод вызова регистрации (К4, К5),
  // `PEP_NOT_ACCEPTED` — запись регистрации (К2). Перечень взят из решения П37 целиком, чтобы код не заводился
  // вторым списком там, где он понадобится.
  "PASSKEY_NOT_SUPPORTED",
  "PEP_NOT_ACCEPTED",
  // Остальные производит `checkPaymentAssertion` ниже.
  "CHALLENGE_EXPIRED",
  "CHALLENGE_UNKNOWN",
  "PASSKEY_SIGNATURE_INVALID",
  "PASSKEY_COUNTER_REGRESSED",
  "PASSKEY_NOT_REGISTERED",
  // Восьмой код — **П37, дополнение 1** (решение владельца 22.11.2026, **Р-1725**; найден ревью К3а № 4): без него
  // снятое подтверждение человеком уходило бы как «подпись не сошлась», то есть неверным советом — человек не понял
  // бы, что нужна биометрия. 409, класс повтора `after_human`: человек подтверждает касанием и проходит.
  "PASSKEY_USER_NOT_VERIFIED",
] as const;

export type PasskeyRefusalCode = (typeof PASSKEY_REFUSAL_CODES)[number];

/** Выданный вызов. `shown_hash` хранится **рядом с вызовом**: по нему проверяется, что подписывают ровно ту карточку,
 *  для которой вызов выдан (правило 1 К-Б). `purchase_id` у регистрации равен `null` — ей покупка не нужна. */
export interface PasskeyChallenge {
  readonly value: string;
  readonly owner: string;
  readonly purpose: PasskeyPurpose;
  readonly purchase_id: string | null;
  readonly shown_hash: ShownHash;
  readonly expires_at: UiInstant;
}

/**
 * Хранение вызовов — портом. Вызов **одноразовый**: `consume` отдаёт его и тут же вычёркивает, и это свойство порта,
 * а не договорённость с тем, кто его вызывает. Повторный `consume` того же значения вернёт `null`, и проверка ответит
 * `CHALLENGE_UNKNOWN` — ровно то, что требует П37 п. 3.
 */
export interface ChallengeStore {
  put(challenge: PasskeyChallenge): void;
  /** вызов по значению, **не вычёркивая** его: для чтения и проверок */
  peek(value: string): PasskeyChallenge | null;
  /** отдать и вычеркнуть: второй раз вернёт `null` */
  consume(value: string): PasskeyChallenge | null;
}

/** Состояние в памяти процесса — как прочее состояние стенда (П2 п. 1–2). Снаружи виден только порт. */
export function createChallengeStore(): ChallengeStore {
  const live = new Map<string, PasskeyChallenge>();
  return {
    put: (challenge) => void live.set(challenge.value, challenge),
    peek: (value) => live.get(value) ?? null,
    consume: (value) => {
      const was = live.get(value);
      if (was === undefined) return null;
      live.delete(value);
      return was;
    },
  };
}

/**
 * Значение вызова — из **хэша показанного и одноразового числа**.
 *
 * Почему не просто случайная строка: вызов обязан быть связан с карточкой, иначе подписью по одному вызову можно
 * было бы накрыть другую карточку. Почему не один хэш показанного: он повторяется у одинаковых карточек, и вызов
 * перестал бы быть одноразовым. Одноразовое число даёт тот, кто поднял сервер (зависимость), — у модуля своего
 * источника случайности нет.
 */
export function challengeValue(shownHash: ShownHash, nonce: string): string {
  if (nonce === "") throw new TypeError("вызов пасскея: одноразовое число пустое — вызов перестал бы быть одноразовым");
  return createHash("sha256").update(`${shownHash}:${nonce}`).digest("base64url");
}

/** Зависимости выдачи вызова: время, одноразовое число и срок жизни. Срок — **величина данных** (`config/`, К1), не
 *  литерал: он правится без правки кода. */
export interface IssueChallengeDeps {
  readonly store: ChallengeStore;
  readonly now: () => UiInstant;
  readonly nonce: () => string;
  readonly ttlMs: number;
}

/** Выдать вызов под карточку. Сохраняет его вместе с хэшем показанного и сроком. */
export function issueChallenge(
  deps: IssueChallengeDeps,
  req: { readonly owner: string; readonly purpose: PasskeyPurpose; readonly purchase_id: string | null; readonly shown_hash: ShownHash },
): PasskeyChallenge {
  if (deps.ttlMs <= 0) throw new TypeError("вызов пасскея: срок жизни вызова должен быть положительным");
  const issued: PasskeyChallenge = Object.freeze({
    value: challengeValue(req.shown_hash, deps.nonce()),
    owner: req.owner,
    purpose: req.purpose,
    purchase_id: req.purchase_id,
    shown_hash: req.shown_hash,
    expires_at: new Date(Date.parse(deps.now()) + deps.ttlMs).toISOString(),
  });
  deps.store.put(issued);
  return issued;
}

/** Зарегистрированный пасскей — то, что проверке нужно знать о ключе. Запись регистрации неизменяемой версией — кирпич
 *  **К2**; здесь объявлен только **порт чтения**, чтобы проверка не зависела от того, как версии хранятся. */
export interface RegisteredPasskey {
  readonly owner: string;
  readonly passkey_id: string;
  /** открытый ключ как его отдала проверка регистрации (COSE), в base64url. Закрытого ключа у сервера нет (П37 п. 2) */
  readonly public_key: string;
  readonly rp_id: string;
}

/**
 * Реестр пасскеев владельца сессии и **действующий счётчик** (П37 п. 2).
 *
 * Счётчик живёт **здесь, а не в неизменяемой версии**: он растёт на каждой подписи, а версия по П32 не правится. В
 * версии остаётся счётчик на момент регистрации, здесь — действующее значение, и его обновляет удачная проверка.
 */
export interface PasskeyRegistry {
  byId(owner: string, passkeyId: string): RegisteredPasskey | null;
  /** действующий счётчик ключа; `null` — ключ есть, а счётчика ещё нет (первая подпись) */
  counterOf(passkeyId: string): number | null;
  setCounter(passkeyId: string, counter: number): void;
}

/** Ответ пасскея на вызов подписи — в форме П37 п. 3 (`assertion`). Значения — base64url, как их отдаёт браузер. */
export interface PasskeyAssertion {
  readonly passkey_id: string;
  readonly client_data: string;
  readonly authenticator_data: string;
  readonly signature: string;
}

/**
 * Что проверка подписи получает от порта проверяющего.
 *
 * **Прежнего счётчика здесь нет намеренно** (находка ревью К3а № 1): пока он передавался проверяющему, правило
 * «счётчик не убывает» стояло в двух местах — у библиотеки и здесь, — и библиотека отбивала регресс **раньше**, ещё
 * до проверки подписи. Отказ приходил как «подпись не сошлась», признак копии ключа до человека не доходил, а
 * собственное правило ниже было мёртвым кодом: зелёным его держала только заглушка порта. Теперь правило одно и
 * живёт здесь, а проверяющий о счётчике не судит — он только сообщает пришедшее значение.
 */
export interface VerifyAssertionInput {
  readonly assertion: PasskeyAssertion;
  readonly expected_challenge: string;
  readonly expected_origin: string;
  readonly expected_rp_id: string;
  readonly public_key: string;
}

/**
 * Порт проверяющего: **криптографию приложение не пишет само** (Р-1721).
 *
 * `counter` — значение, пришедшее от аутентификатора; сравнивает его с прежним этот модуль.
 * `user_verified` — подтвердил ли человек касанием (биометрия или код устройства). Признак **выходит из порта**, а не
 * остаётся настройкой адаптера (находка ревью К3а № 4): инвариант 3 обязан держаться проверкой в правилах, иначе
 * вторая реализация порта прошла бы без подтверждения человеком, и запрет имитации жил бы на договорённости.
 */
export interface PasskeyVerifier {
  verifyAssertion(input: VerifyAssertionInput): Promise<{
    readonly verified: boolean;
    readonly counter: number;
    readonly user_verified: boolean;
  }>;
}

export type PasskeyCheck =
  | { readonly ok: true; readonly passkey_id: string; readonly counter: number; readonly shown_hash: ShownHash }
  | { readonly ok: false; readonly code: PasskeyRefusalCode; readonly reason: string };

const refuse = (code: PasskeyRefusalCode, reason: string): PasskeyCheck => ({ ok: false, code, reason });

/** Зависимости проверки подписи оплаты. `origin` и `rp_id` — настройка стенда, а не литералы модуля. */
export interface CheckAssertionDeps {
  readonly store: ChallengeStore;
  readonly registry: PasskeyRegistry;
  readonly verifier: PasskeyVerifier;
  readonly now: () => UiInstant;
  readonly origin: string;
  readonly rp_id: string;
}

/**
 * Проверить подпись оплаты пасскеем.
 *
 * Порядок проверок назван и важен: сначала вызов (есть ли, не использован ли, не просрочен ли, та ли карточка и та ли
 * покупка), потом ключ, потом подпись, подтверждение человеком и счётчик. Так отказ говорит о **первой** несошедшейся
 * величине из тех, что различает приложение: человек, у которого просрочился вызов, получает «коснитесь заново», а не
 * «подпись не сошлась».
 *
 * **Чего этот порядок не даёт, названо прямо** (находка ревью К3а № 6): причины внутри самой подписи — чужой источник
 * страницы, чужой `rp_id`, ответ на вызов регистрации вместо вызова подписи — различает библиотека, и наружу они
 * приходят одним кодом `PASSKEY_SIGNATURE_INVALID`. Разделить их — работа К4 вместе с текстами ru/en; здесь причина
 * уходит в журнал тому, кто поднял сервер.
 *
 * **Вызов вычёркивается до проверки подписи** (`consume`): иначе негодной подписью можно было бы пробовать один и тот
 * же вызов сколько угодно раз. **Цена названа:** вызов вычёркивается и до сверки владельца, поэтому тот, кто узнал
 * значение вызова, может сжечь его чужим запросом — человеку придётся коснуться заново. Это дешевле, чем оставить
 * вызов живым для перебора подписей. Законный повтор по правилу 2 К-Б сюда не доходит — его отвечает память повторов
 * сервера `/ui/v1` **до** этой проверки (П37 п. 3, уточнение владельца 22.11.2026).
 */
export async function checkPaymentAssertion(
  deps: CheckAssertionDeps,
  body: {
    readonly owner: string;
    readonly purchase_id: string;
    readonly shown_hash: ShownHash;
    readonly challenge: string;
    readonly assertion: PasskeyAssertion;
  },
): Promise<PasskeyCheck> {
  const issued = deps.store.consume(body.challenge);
  if (issued === null) return refuse("CHALLENGE_UNKNOWN", "вызова нет в памяти или он уже использован");
  if (issued.owner !== body.owner) return refuse("CHALLENGE_UNKNOWN", "вызов выдан другому человеку");
  if (issued.purpose !== "PAYMENT") return refuse("CHALLENGE_UNKNOWN", `вызов выдан для ${issued.purpose}, а не для оплаты`);
  if (issued.purchase_id !== body.purchase_id) return refuse("CHALLENGE_UNKNOWN", "вызов выдан для другой покупки");
  // Негодные часы — **дефект сборки сервера**, а не «срок не вышел» (находка ревью К3а № 8): прежде `NaN > x` читался
  // как «вызов годен», и сломанное время молча открывало просроченные вызовы.
  const at = Date.parse(deps.now());
  if (Number.isNaN(at)) throw new TypeError(`проверка пасскея: негодное время сервера ${deps.now()}`);
  if (at > Date.parse(issued.expires_at)) return refuse("CHALLENGE_EXPIRED", "срок вызова вышел");
  // Хэш показанного сверяется **с тем, что хранит вызов**, а не с присланным телом против самого себя: иначе проверка
  // проверяла бы присланное присланным (довод `shownMatches` контракта).
  if (issued.shown_hash !== body.shown_hash) return refuse("PASSKEY_SIGNATURE_INVALID", "подписана не та карточка, для которой выдан вызов");

  const key = deps.registry.byId(body.owner, body.assertion.passkey_id);
  if (key === null) return refuse("PASSKEY_NOT_REGISTERED", "у этого человека такого пасскея нет");
  // Ключ зарегистрирован **под этот сайт**: `rp_id` записи сверяется с настройкой стенда (находка ревью К3а № 7 —
  // прежде `deps.rp_id` был объявлен настройкой и не использовался ни в одной проверке).
  if (key.rp_id !== deps.rp_id) return refuse("PASSKEY_NOT_REGISTERED", `пасскей зарегистрирован под ${key.rp_id}, а не под ${deps.rp_id}`);

  const known = deps.registry.counterOf(key.passkey_id) ?? 0;
  const out = await deps.verifier.verifyAssertion({
    assertion: body.assertion,
    expected_challenge: issued.value,
    expected_origin: deps.origin,
    expected_rp_id: deps.rp_id,
    public_key: key.public_key,
  });
  if (!out.verified) return refuse("PASSKEY_SIGNATURE_INVALID", "подпись не сошлась с вызовом или с открытым ключом");
  // **Подтверждение человеком — проверкой, а не настройкой адаптера** (инвариант 3; находка ревью К3а № 4).
  if (!out.user_verified) return refuse("PASSKEY_USER_NOT_VERIFIED", "подпись без подтверждения человеком: нет признака UV");

  // Счётчик **не убывает**: убыл — ключ скопирован (клон аутентификатора). Равенство допускается только когда обе
  // величины нулевые: часть аутентификаторов счётчика не ведёт вовсе и всегда присылает 0.
  if (out.counter < known || (out.counter === known && known !== 0))
    return refuse("PASSKEY_COUNTER_REGRESSED", `счётчик не вырос: было ${known}, пришло ${out.counter}`);
  deps.registry.setCounter(key.passkey_id, out.counter);

  return { ok: true, passkey_id: key.passkey_id, counter: out.counter, shown_hash: issued.shown_hash };
}

/**
 * Карточка подтверждения оплаты как **показанное**: то, над чем встаёт подпись пасскея (Р-1716, вариант А).
 *
 * **Способ оплаты обязателен** (**Р-1720**, решение владельца 22.11.2026): без него подтверждение, данное для оплаты
 * банком, годилось бы для оплаты по ссылке продавца — ключ подтверждения остаётся тройкой «человек + покупка + хэш
 * показанного» **только** потому, что способ входит в хэш. Условие держит эта проверка и тесты рядом, а не
 * соглашение: карточка без `mode` не собирается вовсе.
 *
 * Значение `mode` закрыто **типом** `UiPaymentMode` контракта; рантайм-перечня у него в контракте нет, и второго
 * здесь не заводится (Р-1511). Понадобится проверять значение на границе — перечень заводится в контракте как
 * источник, это кирпич К4.
 *
 * Норма «`mode` в показанном» идёт **впереди документа**: в К-Б v1.5 `mode` назван только в запросе § 5.7 —
 * расхождение № 28 в `STATUS.md`, пометка `PENDING_V1_6`.
 */
export function paymentShown(shown: {
  readonly text_version: string;
  readonly card: { readonly mode: UiPaymentMode } & Readonly<Record<string, unknown>>;
}): ShownPayload {
  const mode: unknown = shown.card.mode;
  if (typeof mode !== "string" || mode === "")
    throw new TypeError("карточка подтверждения оплаты без способа оплаты не подписывается (Р-1720): mode обязателен в показанном");
  return { text_version: shown.text_version, card: shown.card };
}

/** Хэш карточки подтверждения оплаты. Канонизацию и хэш считает ядро (`showingHash`, Р-1613) — своей копии нет. */
export const paymentShownHash = (shown: Parameters<typeof paymentShown>[0]): ShownHash => showingHash(paymentShown(shown));
