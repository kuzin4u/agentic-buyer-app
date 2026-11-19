// П-К1, К1.3 — подпись профиля: хэш показанного, идемпотентность, хранение версий, запись журнала.
// Правило 1 К-Б: хэш сверяется по **своей** копии показанной карточки; не совпал — `SHOWN_STALE` и новая карточка в
// `error.view`. Правило 2: тот же ключ и то же тело дают тот же ответ **без новой версии**, другое тело —
// `IDEMPOTENCY_CONFLICT`. П26: провенанс нажатия обязателен, умолчания у него нет.
// Хэш считает `showingHash` ядра (`src/contract/ui-v1/shown-hash.ts`, Р-1613), а не своя копия правила канонизации.
import type { UiErrorCode } from "../contract/ui-v1/errors.js";
import type { IdempotencyKey } from "../contract/ui-v1/idempotency.js";
import { isIdempotencyKey } from "../contract/ui-v1/idempotency.js";
import type { ShownHash, UiInstant, UiPress, UiView } from "../contract/ui-v1/common.js";
import { isUiDevice, isUiGesture } from "../contract/ui-v1/common.js";
import type { ShownPayload } from "../contract/ui-v1/shown-hash.js";
import { showingHash, shownMatches, viewOf } from "../contract/ui-v1/shown-hash.js";
import type {
  ChangeSource,
  OrderProblem,
  PrinciplesCatalog,
  PrinciplesOrder,
  SignedPrinciples,
} from "./model.js";
import { checkOrder, nextVersion } from "./model.js";

/** Тело `POST /ui/v1/principles` (§ 5.14). `press` **обязателен**: тело без провенанса не принимается (П26). */
export interface SignRequest {
  readonly order: PrinciplesOrder;
  readonly shown_hash: ShownHash;
  readonly press: UiPress;
}

/** Кто нажал: человек или эмулятор клиента демо-стенда (`DEMO_FAULTS=1`, режим «Авто», П5). Ставит **сервер** — он
 *  один это знает; из тела запроса признак не берётся, потому что экран недоверенная среда (С-12, С-31) и присланное
 *  «я человек» ничего не доказывает. Поэтому в `UiPress` признака нет, и контракт не меняется (решение владельца
 *  19.11, П32 дополнение 1 — так же, как пометка «Авто» в акте ACC-1 и провенанс реакций пульта, П26).
 *  Умолчания нет: значение сервер ставит всегда. */
export type SignedBy = "human" | "emulator";

/** Запись журнала о подписи профиля. Реквизитов и сумм в ней нет — только номер версии, хэш и провенанс
 *  (инвариант 1). */
export interface PrinciplesSignedEntry {
  readonly event: "principles.signed";
  readonly version: number;
  readonly hash: ShownHash;
  readonly press: UiPress;
  readonly by: SignedBy;
  readonly received_at: UiInstant;
  readonly source: ChangeSource;
}

export interface PrinciplesJournal {
  write(entry: PrinciplesSignedEntry): void;
}

/** Прежний ответ по ключу идемпотентности: отпечаток тела и версия, которую тогда отдали. */
export interface RememberedAnswer {
  readonly fingerprint: string;
  readonly version: SignedPrinciples;
}

/** Хранение профиля — **портом**, как прочее состояние стенда (КТ0, пункт (б)). Версии только добавляются: `append`
 *  не умеет ни заменить, ни удалить, и это свойство порта, а не договорённость с тем, кто его вызывает. */
export interface PrinciplesStore {
  /** последняя подписанная версия или `null`, если профиль ещё не подписан */
  last(): SignedPrinciples | null;
  /** все версии по возрастанию номера */
  all(): readonly SignedPrinciples[];
  append(version: SignedPrinciples): void;
  recall(key: IdempotencyKey): RememberedAnswer | null;
  remember(key: IdempotencyKey, answer: RememberedAnswer): void;
}

/** Состояние сервера в памяти процесса — как прочее состояние демо-стенда. Снаружи виден только порт. */
export function createPrinciplesStore(): PrinciplesStore {
  const versions: SignedPrinciples[] = [];
  const answers = new Map<IdempotencyKey, RememberedAnswer>();
  return {
    last: () => versions.at(-1) ?? null,
    all: () => [...versions],
    append: (version) => {
      versions.push(version);
    },
    recall: (key) => answers.get(key) ?? null,
    remember: (key, answer) => {
      answers.set(key, answer);
    },
  };
}

/** Негодное тело: порядок не по правилу или нет провенанса. Экрану уходит **один** код
 *  `PRINCIPLES_ORDER_INVALID` (400, `retry: "after_fix"` — решение владельца 19.11, П32 дополнение 1), а причина
 *  остаётся здесь уточнением: экрану она ничего не даёт, а в журнале и на разборе нужна. */
export type BodyProblem =
  | OrderProblem
  | { readonly reason: "PRESS_MISSING" }
  /** провенанс есть, но негодный: `device` или `gesture` вне перечня § 3, пустое время или версия текстов, лишнее
   *  поле. Провенанс, который ничего не доказывает, — это отсутствие провенанса (П26) */
  | { readonly reason: "PRESS_INVALID"; readonly field: string }
  /** `order` — не список строк: негодная форма тела, а не «неизвестный `id`» */
  | { readonly reason: "ORDER_NOT_LIST" }
  /** в теле или в провенансе поле, которого в § 5.14 нет */
  | { readonly reason: "UNKNOWN_FIELD"; readonly field: string };

/** Коды `/ui`, которыми отвечает подпись. Перечень сужен до них намеренно: любой другой код в ответе этого метода
 *  был бы чужим. */
export type SignErrorCode = Extract<
  UiErrorCode,
  "SHOWN_STALE" | "IDEMPOTENCY_REQUIRED" | "IDEMPOTENCY_CONFLICT" | "PRINCIPLES_ORDER_INVALID"
>;

export type SignOutcome =
  /** версия подписана (`replay: false`) либо отдан прежний ответ по тому же ключу (`replay: true`, новой версии нет) */
  | { readonly ok: true; readonly replay: boolean; readonly version: SignedPrinciples }
  /** отказ с кодом `/ui`; `view` заполнен у `SHOWN_STALE` — там новая карточка (правило 1). `problem` есть только у
   *  `PRINCIPLES_ORDER_INVALID` — это уточнение причины, и наружу, экрану, оно не идёт */
  | {
      readonly ok: false;
      readonly kind: "ui";
      readonly code: SignErrorCode;
      readonly view: UiView | null;
      readonly problem?: BodyProblem;
    };

export interface SignDeps {
  readonly catalog: PrinciplesCatalog;
  readonly store: PrinciplesStore;
  readonly journal: PrinciplesJournal;
  /** своя копия показанной карточки: сервер собирает её сам и ни одного значения из тела в расчёт не берёт */
  readonly shown: () => ShownPayload;
  /** опознаватель своей копии карточки для `view` (§ 3, правило 1) */
  readonly viewId: string;
  /** время получения сервером; время устройства остаётся в `press.at` (П26) */
  readonly now: () => UiInstant;
  /** кто нажал — сервер знает это сам; умолчания нет (П26, П5) */
  readonly by: () => SignedBy;
}

/** Версия формы отпечатка тела: входит в отпечаток, чтобы смена формы не выдала чужой повтор за свой. */
const BODY_FINGERPRINT_VERSION = "principles.sign-body@1.0";

/** Отпечаток тела для правила 2 — канонизацией ядра, той же, что считает хэш показанного: иначе «то же тело»
 *  зависело бы от порядка ключей в JSON. Своей копии правила канонизации здесь нет (П30 доп. 1, П7 доп. 3). */
export function bodyFingerprint(body: SignRequest): string {
  return showingHash({
    text_version: BODY_FINGERPRINT_VERSION,
    card: { order: [...body.order], shown_hash: body.shown_hash, press: body.press },
  });
}

/** Поля тела и провенанса — ровно те, что в § 5.14 и § 3. Лишнее поле — негодное тело, а не «то же тело с
 *  примечанием»: иначе `{…, extra: 1}` считалось бы повтором (находка ревью К1.3 № 4). */
const BODY_KEYS: readonly string[] = ["order", "shown_hash", "press"];
const PRESS_KEYS: readonly string[] = ["at", "device", "text_version", "gesture"];

/** **Форма** тела: то, что можно проверить, не зная ни карточки, ни перечня принципов. Идёт **до** отпечатка, иначе
 *  `order: 5` бросал бы `TypeError` наружу и маршрут отвечал бы 500 вместо 400 (находка ревью К1.3 № 3). */
function checkBodyShape(body: SignRequest): BodyProblem | null {
  const raw = body as unknown as Record<string, unknown>;
  for (const key of Object.keys(raw)) if (!BODY_KEYS.includes(key)) return { reason: "UNKNOWN_FIELD", field: key };
  if (!Array.isArray(body.order) || body.order.some((id) => typeof id !== "string")) return { reason: "ORDER_NOT_LIST" };
  if (typeof body.shown_hash !== "string") return { reason: "PRESS_INVALID", field: "shown_hash" };
  const press = body.press as unknown;
  if (press === undefined || press === null || typeof press !== "object") return { reason: "PRESS_MISSING" };
  for (const key of Object.keys(press)) if (!PRESS_KEYS.includes(key)) return { reason: "UNKNOWN_FIELD", field: key };
  const p = press as Record<string, unknown>;
  for (const key of PRESS_KEYS) if (p[key] === undefined) return { reason: "PRESS_MISSING" };
  if (typeof p["at"] !== "string" || p["at"] === "") return { reason: "PRESS_INVALID", field: "at" };
  if (typeof p["text_version"] !== "string" || p["text_version"] === "")
    return { reason: "PRESS_INVALID", field: "text_version" };
  if (!isUiDevice(p["device"])) return { reason: "PRESS_INVALID", field: "device" };
  if (!isUiGesture(p["gesture"])) return { reason: "PRESS_INVALID", field: "gesture" };
  return null;
}

/** Подпись порядка принципов. Порядок проверок важен и выбран так, чтобы каждый отказ был о своём: **форма →
 *  повтор → смысл**.
 *  1. **ключ идемпотентности** — нет или не по форме: `IDEMPOTENCY_REQUIRED` (правило 2; это не «повтор неизвестного
 *     ключа»);
 *  2. **форма тела** — `order` список строк, провенанс на месте и по перечням § 3, лишних полей нет. Идёт до
 *     отпечатка: отпечаток считается канонизацией, а она на негодном значении бросает `TypeError`, и маршрут отдал бы
 *     500 вместо 400;
 *  3. **повтор** — тот же ключ: то же тело даёт прежний ответ без новой версии, другое — `IDEMPOTENCY_CONFLICT`.
 *     Повтор проверяется **до смысловых** проверок: иначе повтор удачного нажатия мог бы получить отказ по карточке,
 *     которая успела смениться (С-18, обрыв связи);
 *  4. **порядок** — перестановка подмножества известных `id` без повторов и с пунктом роли «исполнение»;
 *  5. **хэш показанного** — по своей копии карточки; не совпал или не по форме: `SHOWN_STALE` с **новой** карточкой.
 *     Туда же — расхождение `press.text_version` с версией текстов своей копии: это одна и та же величина (§ 3,
 *     пример), и её расхождение значит, что человек подтверждал не те тексты.
 *  Запись журнала `principles.signed` делается только при настоящей подписи: повтор второй записи не даёт, иначе
 *  журнал считал бы одно нажатие за два. */
export function signPrinciples(body: SignRequest, key: string | null | undefined, deps: SignDeps): SignOutcome {
  if (typeof key !== "string" || !isIdempotencyKey(key))
    return { ok: false, kind: "ui", code: "IDEMPOTENCY_REQUIRED", view: null };

  const shape = checkBodyShape(body);
  if (shape !== null) return { ok: false, kind: "ui", code: "PRINCIPLES_ORDER_INVALID", view: null, problem: shape };

  const fingerprint = bodyFingerprint(body);
  const remembered = deps.store.recall(key);
  if (remembered !== null)
    return remembered.fingerprint === fingerprint
      ? { ok: true, replay: true, version: remembered.version }
      : { ok: false, kind: "ui", code: "IDEMPOTENCY_CONFLICT", view: null };

  const order = checkOrder(body.order, deps.catalog);
  if (!order.ok)
    return {
      ok: false,
      kind: "ui",
      code: "PRINCIPLES_ORDER_INVALID",
      view: null,
      problem: order.reason === "EMPTY" ? { reason: "EMPTY" } : { reason: order.reason, id: order.id },
    };

  const shown = deps.shown();
  // Версия текстов у провенанса и у карточки — **одна величина** (§ 3, пример: у `press` и у `view` один
  // `u1-card@1.0`). Расходится — человек подтверждал не те тексты, что сервер считает показанными, и это тот же
  // случай «карточка устарела»: `SHOWN_STALE` с новой карточкой (находка ревью К1.3 № 2).
  if (body.press.text_version !== shown.text_version || !shownMatches(shown, body.shown_hash))
    return { ok: false, kind: "ui", code: "SHOWN_STALE", view: viewOf(deps.viewId, shown) };

  const received_at = deps.now();
  const version = nextVersion(deps.store.last(), {
    order: body.order,
    view: { hash: showingHash(shown), text_version: shown.text_version },
    press: body.press,
    received_at,
    source: "CLIENT",
  });
  deps.store.append(version);
  deps.store.remember(key, { fingerprint, version });
  deps.journal.write({
    event: "principles.signed",
    version: version.no,
    hash: version.view.hash,
    press: version.press,
    by: deps.by(),
    received_at,
    source: version.source,
  });
  return { ok: true, replay: false, version };
}
