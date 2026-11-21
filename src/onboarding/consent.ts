// ИН-П1, кирпич К2 — запись согласия (решение **П34** п. 3 и п. 4; приём **П32**).
//
// Согласие записывается так, что его нельзя изменить: неизменяемая версия над **хэшем ровно показанного** (правило 1
// К-Б) с моделью агента, версией текстов и провенансом нажатия (П26). Приём взят у профиля предпочтений
// (`src/principles/`): версии только добавляются, хранение — портом, журнал пишется последним.
//
// Одно отличие от П32, и оно названо решением (П34 п. 4): у профиля предпочтений версия **одна на стенд**, а согласие
// принадлежит человеку — поэтому хранилище с ключом по владельцу сессии. Без ключа согласие одного человека
// показалось бы другому; это не «на будущее», а условие правильности уже сегодня.
//
// Чего здесь нет: правил HTTP — ключа идемпотентности, кодов отказа и сверки хэша (это кирпич К4, `POST
// /ui/v1/consent`). Здесь только то, что делает версию подписанной: правило номера, неизменяемость и порядок
// «сначала запись версии, потом журнал».
import type { ShownHash, UiInstant, UiPress, UiShown, UiSignedBy } from "../contract/ui-v1/index.js";
import type { AgentModelId, ConsentId } from "./model.js";
import { CONSENT_IDS } from "./model.js";

/**
 * Что человек видел, когда согласился: хэш показанного и версия текстов (правило 1 К-Б).
 *
 * Форма **одна на приложение** — `UiShown` контракта (`src/contract/ui-v1/common.ts`), её завело окно А кирпичом К8
 * по решению владельца **Р-1682**; здесь остаётся только имя для чтения на месте. Прежде эта пара была объявлена
 * **третьей** копией (рядом с `PrinciplesView` и `UiView`), и расхождение было бы тихим: добавь правило 1 в снимок
 * показанного ещё одно поле — править пришлось бы в трёх местах.
 */
export type ConsentView = UiShown;

/** Первый номер версии: нумерация человеческая, с единицы. Своя константа, а не `FIRST_VERSION_NO` профиля
 *  предпочтений: нумерации **разные** — там одна на стенд, здесь своя у каждого человека (П34 п. 4), и общая
 *  константа связала бы две независимые величины (уточнено по находке ревью К2 № 8: прежний комментарий ссылался на
 *  чужую константу так, будто это одна норма). */
export const FIRST_CONSENT_NO = 1;

/**
 * Подписанная версия согласия. **Неизменяема:** новое согласие прежнее не стирает и не правит, `no` растёт на единицу.
 *
 * `received_at` — время **получения сервером**; время устройства живёт в `press.at` и им не заменяется (П26).
 * `by` — кто нажал; ставит **сервер** по своему знанию, из тела не берётся ни в каком режиме (П26 дополнение 2).
 * `accepted` — отмеченные пункты: хранятся перечнем, а не признаком «со всем согласен», потому что в споре нужно
 * показать, с чем именно человек согласился, а не что он «согласился».
 */
export interface SignedConsent {
  readonly no: number;
  /** чьё согласие — владелец сессии приложения (П34 п. 4) */
  readonly owner: string;
  readonly model: AgentModelId;
  readonly accepted: readonly ConsentId[];
  readonly view: ConsentView;
  readonly press: UiPress;
  readonly by: UiSignedBy;
  readonly received_at: UiInstant;
}

/**
 * Хранение согласий — **портом**, как прочее состояние стенда.
 *
 * Версии только добавляются: `append` не умеет ни заменить, ни удалить, и это свойство **порта**, а не
 * договорённость с тем, кто его вызывает. Отзыв согласия — после MVP, и когда он появится, это будет **новая
 * версия** с решением владельца, а не правка прежней.
 */
export interface ConsentStore {
  /** последняя версия этого человека или `null`, если он ещё не соглашался */
  last(owner: string): SignedConsent | null;
  /** все версии этого человека по возрастанию номера */
  all(owner: string): readonly SignedConsent[];
  append(version: SignedConsent): void;
}

/** Состояние сервера в памяти процесса — как прочее состояние демо-стенда (П2 п. 1–2). Снаружи виден только порт.
 *
 *  Память **по владельцу**: один список на человека. Общий список с отбором по полю дал бы тот же ответ, но
 *  `last(owner)` на нём зависел бы от порядка чужих записей — а он здесь часть правила номера версии. */
export function createConsentStore(): ConsentStore {
  const byOwner = new Map<string, SignedConsent[]>();
  const listOf = (owner: string): SignedConsent[] => {
    const was = byOwner.get(owner);
    if (was !== undefined) return was;
    const fresh: SignedConsent[] = [];
    byOwner.set(owner, fresh);
    return fresh;
  };
  return {
    last: (owner) => byOwner.get(owner)?.at(-1) ?? null,
    all: (owner) => [...(byOwner.get(owner) ?? [])],
    append: (version) => {
      listOf(version.owner).push(version);
    },
  };
}

/** Запись журнала о согласии. Реквизитов и сумм в ней нет — только номер версии, модель, перечень пунктов, хэш и
 *  провенанс (инвариант 1). Цена агента в журнал не пишется: она не часть согласия, а текст экрана. */
export interface ConsentAcceptedEntry {
  readonly event: "consent.accepted";
  readonly version: number;
  readonly owner: string;
  readonly model: AgentModelId;
  readonly accepted: readonly ConsentId[];
  readonly hash: ShownHash;
  readonly press: UiPress;
  readonly by: UiSignedBy;
  readonly received_at: UiInstant;
}

/**
 * Запись журнала об **отказе** принять согласие (кирпич К4; находка ревью К4 № 7).
 *
 * Причина отказа (`reason`) экрану не уходит — ему хватает кода и готового текста (П32 дополнение 1), — но в журнале
 * она нужна: иначе на разборе «человек жаловался, что не смог согласиться» нечего посмотреть. Прежде причина
 * вычислялась и выбрасывалась, а комментарий обещал «для журнала и разбора» — обещание без поведения.
 *
 * Реквизитов, сумм и самого показанного текста здесь нет (инвариант 1): код отказа, причина, модель и провенанс.
 */
export interface ConsentRefusedEntry {
  readonly event: "consent.refused";
  readonly owner: string;
  readonly code: string;
  /** уточнение причины — для разбора, не для экрана */
  readonly reason: string;
  /** модель из тела, если она была по форме; иначе `null` */
  readonly model: string | null;
  readonly by: UiSignedBy;
  readonly received_at: UiInstant;
}

export interface ConsentJournal {
  write(entry: ConsentAcceptedEntry): void;
  /** Отказ пишется, когда исход определён, тем же журналом: удача и отказ читаются рядом. */
  refused(entry: ConsentRefusedEntry): void;
}

/**
 * Следующая версия согласия. Прежнюю **не трогает**: возвращается новый объект, номер — предыдущий плюс один.
 *
 * Копируются и замораживаются **все слои**, а не только верхний: `view`, `press` и перечень пунктов, вставленные
 * ссылкой, остались бы изменяемыми, и тогда у подписанной версии можно было бы задним числом поправить хэш
 * показанного (правило 1 К-Б) и провенанс нажатия (П26) — то самое, на чём держится «версию нельзя изменить» (П34
 * п. 3). Это не предосторожность на вкус: в П-К1 ровно такую дыру нашло ревью К1.2 («подписанная версия
 * замораживалась только снаружи»).
 *
 * Сверку `view.text_version` с `press.text_version` и сверку хэша делает кирпич К4 вместе с правилом 1: сюда
 * приходит уже проверенное тело.
 */
export function nextConsentVersion(
  prev: SignedConsent | null,
  built: {
    readonly owner: string;
    readonly model: AgentModelId;
    readonly accepted: readonly ConsentId[];
    readonly view: ConsentView;
    readonly press: UiPress;
    readonly by: UiSignedBy;
    readonly received_at: UiInstant;
  },
): SignedConsent {
  // Номер версии считается по истории **того же** человека, и это держит сама функция, а не её вызывающий (находка
  // ревью К2 № 1): `nextConsentVersion(store.last("own_1"), { owner: "own_2", … })` дал бы второму человеку `no: 2` на
  // его **первом** согласии — номер по чужой истории, ровно то, от чего защищает ключ по владельцу (П34 п. 4).
  // Функция экспортирована, и звать её будут К3 и К4, поэтому правило живёт здесь, а не в договорённости.
  if (prev !== null && prev.owner !== built.owner)
    throw new TypeError(
      `версия согласия: прежняя версия принадлежит ${prev.owner}, а новая — ${built.owner}; номер считается по своему человеку`,
    );
  return Object.freeze({
    no: prev === null ? FIRST_CONSENT_NO : prev.no + 1,
    owner: built.owner,
    model: built.model,
    accepted: Object.freeze([...built.accepted]),
    view: Object.freeze({ hash: built.view.hash, text_version: built.view.text_version }),
    press: Object.freeze({
      at: built.press.at,
      device: built.press.device,
      text_version: built.press.text_version,
      gesture: built.press.gesture,
    }),
    by: built.by,
    received_at: built.received_at,
  });
}

/** Отмечены ли **все** обязательные пункты. Перечень обязательных — закрытый перечень кода (`CONSENT_IDS`), а не
 *  присланный экраном: иначе «все обязательные» означало бы «все, которые экран счёл обязательными» (правило 3 К-Б,
 *  инвариант 2). Лишний и неизвестный пункт здесь **не** разбирается — это форма тела, и её проверяет К4. */
export const allRequiredAccepted = (accepted: readonly ConsentId[]): boolean => {
  const seen = new Set(accepted);
  return CONSENT_IDS.every((id) => seen.has(id));
};

/** Зависимости записи согласия. Каждая — зависимостью, а не значением: время, признак «кто нажал» и хранение знает
 *  тот, кто поднял стенд, а не этот модуль. */
export interface RecordConsentDeps {
  readonly store: ConsentStore;
  readonly journal: ConsentJournal;
  /** время получения сервером; время устройства остаётся в `press.at` (П26) */
  readonly now: () => UiInstant;
  /** кто нажал — сервер знает это сам; умолчания нет (П26, П5) */
  readonly by: () => UiSignedBy;
}

/**
 * Записать согласие: новая неизменяемая версия, затем запись журнала.
 *
 * **Порядок именно такой, и он не косметика:** журнал пишется последним, когда исход определён (постановка, кирпич
 * К2). Запись в журнал перед `append` означала бы строку о согласии, которого в хранилище нет, — а журнал читают как
 * доказательство.
 *
 * Тело к этому моменту проверено (К4): хэш совпал, версия текстов та же, все обязательные пункты отмечены. Здесь
 * проверяется только то, что нельзя было проверить раньше, — и проверяется **исключением**, а не отказом контракта:
 * согласие без всех обязательных пунктов это дефект сборки ответа, а не случай для 400.
 */
export function recordConsent(
  deps: RecordConsentDeps,
  body: {
    readonly owner: string;
    readonly model: AgentModelId;
    readonly accepted: readonly ConsentId[];
    readonly view: ConsentView;
    readonly press: UiPress;
  },
): SignedConsent {
  if (!allRequiredAccepted(body.accepted))
    throw new TypeError("запись согласия: отмечены не все обязательные пункты — проверка формы пропущена (К4)");
  const received_at = deps.now();
  const by = deps.by();
  const version = nextConsentVersion(deps.store.last(body.owner), {
    owner: body.owner,
    model: body.model,
    accepted: body.accepted,
    view: body.view,
    press: body.press,
    by,
    received_at,
  });
  deps.store.append(version);
  deps.journal.write({
    event: "consent.accepted",
    version: version.no,
    owner: version.owner,
    model: version.model,
    accepted: version.accepted,
    hash: version.view.hash,
    press: version.press,
    by,
    received_at,
  });
  return version;
}
