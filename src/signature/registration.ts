// ИН-П2, кирпич К2 — **запись регистрации пасскея** неизменяемой версией: решение **П37** п. 2 (приём **П32**,
// **П34** п. 3–4), постановка v1.1.
//
// Приём тот же, что у согласия (`src/onboarding/consent.ts`) и у подтверждения оплаты (`m2.ts`): версии только
// добавляются, ключ по владельцу сессии, журнал пишется последним. Отличия названы ниже, а не умолчаны.
//
// **Закрытого ключа и биометрии здесь нет** (П37 п. 2): в версию уходит только **открытый** ключ, его опознаватель,
// `rp_id` и счётчик на момент регистрации. Биометрию сервер не видит вовсе — её проверяет аутентификатор, а серверу
// приходит лишь признак «человек подтвердил» (`user_verified`), и он в версии не хранится значением биометрии, а
// отражён тем, что версия вообще записана: без подтверждения человеком проверка не пропускает ответ.
//
// **Повторная регистрация — решение владельца Р-1728 от 22.11.2026:** новая версия добавляется, прежняя не стирается,
// **действуют оба ключа**, счётчики у ключей независимы. Отклонено «новый ключ отменяет прежний»: второй телефон
// перестал бы работать после регистрации первого, и человек узнал бы об этом отказом подписи. Доводы, на которых
// решение стоит:
//   1. по П32 версия неизменяема, а отзыв прежнего ключа — это изменение действующего состояния, то есть новая норма,
//      которой в постановке v1.1 нет (там сказано ровно «повторная регистрация — новая версия, старая не стирается»);
//   2. у человека бывает два телефона, и регистрация второго не должна выключать первый — иначе смена устройства
//      молча лишала бы его прежнего способа подтверждения;
//   3. отзыв нужен для потерянного телефона, и это **отдельная постановка** («восстановление пасскея при потере
//      телефона» — «Не в задаче» v1.1), вместе с запасным путём по SMS.
// Поэтому действующими считаются **все** зарегистрированные ключи этого человека, и подпись любым из них проходит.
// Случай с подписью прежним ключом после повторной регистрации закреплён тестом — чтобы это не «получилось само».
// **Открытое следствие, названное, а не умолчанное** (Р-1728): отзыва ключа на MVP нет вовсе — строка в `STATUS.md`
// «Открыто» с адресом «потеря телефона и запасной путь без пасскея — отдельная постановка». Пересмотр: банк пилота
// или юрист потребует единственного действующего ключа (Р-1662, Р-1657) — отзыв станет нормой и отдельной задачей.
import { frozenShown, type ShownHash, type UiErrorCode, type UiInstant, type UiPress, type UiShown, type UiSignedBy } from "../contract/ui-v1/index.js";
import type { PasskeyRefusalCode, PasskeyRegistry, RegisteredPasskey } from "./webauthn.js";

/** Первый номер версии: нумерация человеческая, с единицы. Своя константа — нумерации независимы (довод тот же, что
 *  у `FIRST_APPROVAL_NO` и `FIRST_CONSENT_NO`: величины меняются по разным причинам). */
export const FIRST_REGISTRATION_NO = 1;

/**
 * Подписанная версия регистрации пасскея. **Неизменяема:** повторная регистрация прежнюю не стирает и не правит.
 *
 * `counter` — значение **на момент регистрации**; действующее значение живёт в изменяемом состоянии реестра (П37
 * п. 2), потому что растёт на каждой подписи, а версия по П32 не правится.
 * `pep_text_version` — версия формулировки ПЭП, под которой человек подписался (К1, `config/passkey.default.json`);
 * самой формулировки здесь нет — её правит юрист без правки кода (П37 п. 5).
 * `received_at` — время получения сервером; время устройства живёт в `press.at` (П26).
 * `by` — кто нажал; ставит сервер, из тела не берётся ни в каком режиме (П26 дополнение 2).
 */
export interface SignedRegistration {
  readonly no: number;
  readonly owner: string;
  readonly passkey_id: string;
  /** **открытый** ключ в base64url, как его отдала проверка регистрации (COSE); закрытого у сервера нет */
  readonly public_key: string;
  readonly rp_id: string;
  readonly counter: number;
  readonly pep_text_version: string;
  readonly shown: UiShown;
  readonly press: UiPress;
  readonly by: UiSignedBy;
  readonly received_at: UiInstant;
}

/**
 * Хранение версий регистрации и **действующего счётчика** — портом: `append` не умеет ни заменить, ни удалить.
 *
 * `byPasskey` — поиск последней версии ключа **этого человека**: ключ принадлежит паре «человек + опознаватель», и
 * без владельца чужая регистрация с тем же опознавателем сбивала бы засев счётчика (блокер ревью К2 № 1).
 *
 * Счётчик держит **хранилище, а не экземпляр реестра** (находка ревью К2 № 2): пока он лежал в памяти реестра, второй
 * реестр над тем же хранилищем засеивал величину **из версии регистрации** — то есть ниже последней принятой, и
 * подпись копии ключа снова проходила. Теперь состояние одно на хранилище, сколько бы реестров над ним ни собрали.
 * Всё состояние стенда живёт в памяти процесса (П2 п. 1–2), поэтому перезапуск теряет версии и счётчики **вместе** —
 * случая «счётчик отстал от версий» нет.
 */
export interface RegistrationStore {
  last(owner: string): SignedRegistration | null;
  all(owner: string): readonly SignedRegistration[];
  byPasskey(owner: string, passkeyId: string): SignedRegistration | null;
  append(version: SignedRegistration): void;
  /** действующий счётчик пары «человек + ключ»; `null` — подписей этим ключом ещё не было */
  counter(owner: string, passkeyId: string): number | null;
  setCounter(owner: string, passkeyId: string, counter: number): void;
}

/** Состояние в памяти процесса; память **по владельцу** — номер версии считается по своей истории (П34 п. 4). */
export function createRegistrationStore(): RegistrationStore {
  const byOwner = new Map<string, SignedRegistration[]>();
  const byKey = new Map<string, SignedRegistration>();
  const counters = new Map<string, number>();
  // Составной ключ пары: разделитель — нулевой символ, он не встречается ни в опознавателе сессии, ни в base64url,
  // поэтому склейка «человек + ключ» не может совпасть у двух разных пар.
  const pair = (owner: string, passkeyId: string): string => `${owner}\u0000${passkeyId}`;
  return {
    last: (owner) => byOwner.get(owner)?.at(-1) ?? null,
    all: (owner) => [...(byOwner.get(owner) ?? [])],
    byPasskey: (owner, passkeyId) => byKey.get(pair(owner, passkeyId)) ?? null,
    counter: (owner, passkeyId) => counters.get(pair(owner, passkeyId)) ?? null,
    setCounter: (owner, passkeyId, counter) => void counters.set(pair(owner, passkeyId), counter),
    append: (version) => {
      const list = byOwner.get(version.owner);
      if (list === undefined) byOwner.set(version.owner, [version]);
      else list.push(version);
      // Последняя версия этого ключа **у этого человека**: повторная регистрация обновляет указатель, прежние версии
      // остаются в истории владельца неизменными.
      byKey.set(pair(version.owner, version.passkey_id), version);
    },
  };
}

/** Следующая версия регистрации. Прежнюю не трогает; все слои копируются и замораживаются — иначе у подписанной
 *  версии можно было бы задним числом поправить открытый ключ или хэш показанного.
 *
 *  Как и у согласия, функция ловит чужого владельца, но **не** проверяет, что `prev` — последняя версия: «последнюю»
 *  берёт `recordRegistration` у порта. Оговорка та же, что в `m2.ts`, и названа здесь, чтобы не искать её в соседнем
 *  файле. */
export function nextRegistrationVersion(
  prev: SignedRegistration | null,
  built: Omit<SignedRegistration, "no">,
): SignedRegistration {
  if (prev !== null && prev.owner !== built.owner)
    throw new TypeError(
      `версия регистрации пасскея: прежняя версия принадлежит ${prev.owner}, а новая — ${built.owner}; номер считается по своему человеку`,
    );
  return Object.freeze({
    no: prev === null ? FIRST_REGISTRATION_NO : prev.no + 1,
    owner: built.owner,
    passkey_id: built.passkey_id,
    public_key: built.public_key,
    rp_id: built.rp_id,
    counter: built.counter,
    pep_text_version: built.pep_text_version,
    shown: frozenShown(built.shown),
    press: Object.freeze({ ...built.press }),
    by: built.by,
    received_at: built.received_at,
  });
}

/** Запись журнала о регистрации. Открытого ключа в ней **нет**: в журнале достаточно опознавателя — ключ лежит в
 *  версии, а журнал читают как доказательство события, а не как хранилище ключей. Закрытого ключа, биометрии и
 *  реквизитов нет нигде (инвариант 1). */
export interface PasskeyRegisteredEntry {
  readonly event: "passkey.registered";
  readonly version: number;
  readonly owner: string;
  readonly passkey_id: string;
  readonly rp_id: string;
  readonly counter: number;
  readonly pep_text_version: string;
  readonly hash: ShownHash;
  readonly press: UiPress;
  readonly by: UiSignedBy;
  readonly received_at: UiInstant;
}

/** Запись журнала об отказе — пишет её сервис `/ui/v1` (К4); тип объявлен здесь, чтобы удача и отказ читались рядом
 *  одним журналом. Код — из закрытого перечня контракта или проверки пасскея. */
export interface PasskeyRegistrationRefusedEntry {
  readonly event: "passkey.registration_refused";
  readonly owner: string;
  /** Код — из **закрытых перечней типом**, а не любая строка: `UiErrorCode | string` в TypeScript сводится к
   *  `string`, то есть не запрещает ничего, и перечень оставался бы названным словами (находка ревью К2 № 4). */
  readonly code: UiErrorCode | PasskeyRefusalCode;
  readonly reason: string;
  readonly by: UiSignedBy;
  readonly received_at: UiInstant;
}

export interface PasskeyRegistrationJournal {
  write(entry: PasskeyRegisteredEntry): void;
  refused(entry: PasskeyRegistrationRefusedEntry): void;
}

export interface RecordRegistrationDeps {
  readonly store: RegistrationStore;
  readonly journal: PasskeyRegistrationJournal;
  readonly now: () => UiInstant;
  readonly by: () => UiSignedBy;
}

/**
 * Записать регистрацию: новая неизменяемая версия, затем журнал.
 *
 * Порядок именно такой: строка журнала о регистрации, которой нет в хранилище, читалась бы как доказательство.
 *
 * Тело к этому моменту проверено (К4 вместе с `verifyRegistration`): вызов сошёлся, подтверждение человеком есть,
 * открытый ключ и начальный счётчик получены у проверяющего. Здесь проверяется только то, что нельзя было проверить
 * раньше, и **исключением**, а не отказом контракта: пустой опознаватель или пустой ключ это дефект сборки ответа.
 */
export function recordRegistration(
  deps: RecordRegistrationDeps,
  body: {
    readonly owner: string;
    readonly passkey_id: string;
    readonly public_key: string;
    readonly rp_id: string;
    readonly counter: number;
    readonly pep_text_version: string;
    readonly shown: UiShown;
    readonly press: UiPress;
  },
): SignedRegistration {
  if (body.passkey_id === "" || body.public_key === "")
    throw new TypeError("запись регистрации пасскея: нет опознавателя или открытого ключа — записывать нечего");
  if (body.pep_text_version === "")
    throw new TypeError("запись регистрации пасскея: нет версии текста ПЭП — под какой формулировкой подписались, неизвестно");
  // Счётчик проверяется наравне с пустыми строками (находка ревью К2 № 8): запиши `NaN` или отрицательное, и сравнение
  // счётчика перестанет отбивать что-либо вовсе — `out.counter < NaN` и `out.counter === NaN` оба ложны, то есть
  // защита от копии ключа молча выключится.
  if (!Number.isInteger(body.counter) || body.counter < 0)
    throw new TypeError(`запись регистрации пасскея: счётчик должен быть целым и неотрицательным, пришло ${body.counter}`);
  const received_at = deps.now();
  const by = deps.by();
  const version = nextRegistrationVersion(deps.store.last(body.owner), { ...body, by, received_at });
  deps.store.append(version);
  deps.journal.write({
    event: "passkey.registered",
    version: version.no,
    owner: version.owner,
    passkey_id: version.passkey_id,
    rp_id: version.rp_id,
    counter: version.counter,
    pep_text_version: version.pep_text_version,
    hash: version.shown.hash,
    press: version.press,
    by,
    received_at,
  });
  return version;
}

/**
 * Реестр пасскеев поверх версий регистрации — **порт, который объявил К3а** (`PasskeyRegistry`).
 *
 * Как сходятся К2 и К3а: ключ ищется среди **всех** версий этого человека (повторная регистрация прежний не
 * выключает, довод в шапке), а **действующий счётчик** живёт в изменяемом состоянии и **засеивается значением из
 * версии регистрации** — иначе первая же подпись сравнивалась бы с нулём, и ключ, зарегистрированный со счётчиком 7,
 * принял бы подпись со счётчиком 1 как законную.
 */
export function createPasskeyRegistry(store: RegistrationStore): PasskeyRegistry {
  return {
    byId: (owner, passkeyId): RegisteredPasskey | null => {
      const v = store.byPasskey(owner, passkeyId);
      return v === null ? null : { owner: v.owner, passkey_id: v.passkey_id, public_key: v.public_key, rp_id: v.rp_id };
    },
    counterOf: (owner, passkeyId) => {
      const known = store.counter(owner, passkeyId);
      if (known !== null) return known;
      // **Засев из версии регистрации** (требование владельца по К2 п. 2: К2 и К3а должны сойтись): значение на
      // момент регистрации — первая известная величина счётчика. Без засева первая же подпись сравнивалась бы с
      // нулём, и ключ, зарегистрированный со счётчиком 7, принял бы подпись со счётчиком 1 как законную — то есть
      // подпись копии ключа прошла бы. Ищется версия **этого человека**: чужая регистрация с тем же опознавателем
      // засев не сбивает (блокер ревью К2 № 1).
      return store.byPasskey(owner, passkeyId)?.counter ?? null;
    },
    setCounter: (owner, passkeyId, counter) => store.setCounter(owner, passkeyId, counter),
  };
}
