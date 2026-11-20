// П-К4, К5 — `POST /ui/v1/intent` (§ 5.2): отправить поручение на подпись.
//
// **Метод не подписывает** (§ 2 п. 1, РП36): подпись ставит человек в банке над `Mandate.hash`. Сервис просит у ядра
// мандат (`Purchase.intent(draft, m)`) и возвращает **маршрут** подписи: на стенде — ссылка на экран мандатов банка,
// в ИН-ВМ — модуль банка внутри приложения (`BANK_MODULE`, `link: null`). На MVP `sign.where` всегда `BANK` —
// решение владельца 20.11.2026 (Р-1657); для «своего агента» (М2) ответ будет после консультаций с юристом.
//
// **Ключ обращения ядра к ПАО сервис не выводит** (Р-1644): `Mutation` приходит зависимостью, и вывод остаётся у
// сервера ИН-0 окна Б — там же, где общий слой `/ui/v1`. Отсюда `src/ui-server/` не импортируется.
//
// **Хэш показанного пересчитывается своей копией** (правило 1): показанное запомнено вместе с черновиком при сборке
// карточки (К2), поэтому воспроизводить язык, пояс и версию текстов не нужно. Присланный `shown_hash` в расчёт не
// берётся — иначе проверка проверяла бы присланное присланным.
//
// **Идемпотентность — правило 2 К-Б:** ключ занимает любой окончательный ответ, включая отказ, кроме
// `IDEMPOTENCY_REQUIRED` (Р-1633, Р-1635, Р-1659); тот же ключ с другим телом — `IDEMPOTENCY_CONFLICT`.
import type { UiErrorBody, UiRetryClass } from "../contract/ui-v1/errors.js";
import { UI_ERROR_STATUS } from "../contract/ui-v1/errors.js";
import type { UiLang, UiSignedBy } from "../contract/ui-v1/common.js";
import { bodyFingerprint } from "../contract/ui-v1/fingerprint.js";
import { isIdempotencyKey, type IdempotencyKey } from "../contract/ui-v1/idempotency.js";
import type { IntentRequest, IntentResponse, UiMandateRef, UiSignRoute } from "../contract/ui-v1/methods.js";
import { showingHash, viewOf } from "../contract/ui-v1/shown-hash.js";
import { stepOfState } from "../contract/ui-v1/steps.js";
import type { MandateDraft, Mandate } from "agentic-buyer-ref/src/shared/domain.js";
import type { Mutation } from "agentic-buyer-ref/src/agent/ports/mutation.js";
import type { PurchaseState } from "agentic-buyer-ref/src/agent/pipeline/machine.js";
import { checkUiPress, type UiPressProblem } from "../contract/ui-v1/press.js";
import type { IntentDraftStore } from "./draft.js";
import type { IntentDraft } from "./model.js";
import type { ErrorTextKey, IntentTexts } from "./texts.js";

/** Коды `/ui`, которыми отвечает этот метод. Перечень закрытый — других кодов `/ui` у него нет; коды **ядра**
 *  (`FailureCode`) приходят отдельной ветвью, как есть (§ 3 «Ошибки», § 6 последняя строка). */
export type IntentErrorCode =
  | "INTENT_DRAFT_INVALID"
  | "SHOWN_STALE"
  | "PURCHASE_NOT_FOUND"
  | "STEP_NOT_ALLOWED"
  | "IDEMPOTENCY_REQUIRED"
  | "IDEMPOTENCY_CONFLICT";

/** Класс повтора у каждого кода. **Ни один не выведен «по смыслу»** — каждый взят у источника (строка STATUS о
 *  классах повтора, К1.5):
 *  - `INTENT_DRAFT_INVALID` — `after_fix`, решения владельца 20.11, 15:28 и 18:45 (Р-1650, Р-1670);
 *  - `SHOWN_STALE` — `after_human`, решение владельца 19.11, 18:20;
 *  - `IDEMPOTENCY_REQUIRED` — `same_key`, `IDEMPOTENCY_CONFLICT` — `after_fix`: таблица кодов ПАО 1.4.0 (правило 2);
 *  - `PURCHASE_NOT_FOUND` — `after_human`: у ядра «не найдено» так и судится (`MANDATE_NOT_FOUND` в таблице отказов
 *    `agentic-buyer-ref`, класс совпадает с `retry` ПАО 1.4.0), и повтор тем же телом ничего не меняет;
 *  - `STEP_NOT_ALLOWED` — `after_human`, **решение владельца 20.11.2026, 20:08 (Р-1677)**: экран перечитывает
 *    покупку, показывает нужный шаг, и человек нажимает уже на нём — как у `SHOWN_STALE`. `never` сказал бы экрану,
 *    что действие невозможно совсем, а это неправда. В § 6 класс войдёт с К-Б v1.1 (пометка `PENDING_V1_1`).
 *  Класс каждого кода стоит в одном месте — здесь. */
export const RETRY_BY_CODE = {
  INTENT_DRAFT_INVALID: "after_fix",
  SHOWN_STALE: "after_human",
  PURCHASE_NOT_FOUND: "after_human",
  /** Р-1677, пометка `PENDING_V1_1`: в § 6 документа v1.0 классов повтора нет вовсе. */
  STEP_NOT_ALLOWED: "after_human",
  IDEMPOTENCY_REQUIRED: "same_key",
  IDEMPOTENCY_CONFLICT: "after_fix",
} as const satisfies Record<IntentErrorCode, UiRetryClass>;

/** Причина отказа. Остаётся **внутри** сервера: экрану уходит код и готовый текст, а причина нужна журналу и
 *  разбору (Р-1650; тот же приём, что у подписи принципов — П32 дополнение 1). */
export type IntentProblem =
  /** тело не объект, лишнее поле, `draft_id` или `shown_hash` не по форме */
  | { readonly reason: "BODY_FORM"; readonly field: string }
  /** провенанса нажатия нет или он негодный (П26: умолчания нет) */
  | { readonly reason: "PRESS"; readonly detail: UiPressProblem }
  /** черновика с таким `draft_id` сервер не помнит — или он чужой */
  | { readonly reason: "NOT_FOUND" }
  /** хэш показанного не совпал, не по форме или карточка устарела */
  | { readonly reason: "SHOWN_STALE" }
  /** этот черновик уже отправлен на подпись (`purchase_id` равен `null`, пока ядро ещё отвечает) */
  | { readonly reason: "ALREADY_SENT"; readonly purchase_id: string | null }
  /** ключа идемпотентности нет или он не по форме */
  | { readonly reason: "KEY_REQUIRED" }
  /** тот же ключ, другое тело */
  | { readonly reason: "KEY_CONFLICT" };

/** Соответствие «причина → ключ текста» закрыто **на компиляции** (Р-1650): пропал ключ в `config/` — сборка
 *  красная (`ErrorTextKey`), появилась причина без текста — тоже. */
const TEXT_OF_REASON = {
  BODY_FORM: "body_form",
  PRESS: "press",
  NOT_FOUND: "not_found",
  SHOWN_STALE: "shown_stale",
  ALREADY_SENT: "step_not_allowed",
  KEY_REQUIRED: "idempotency_required",
  KEY_CONFLICT: "idempotency_conflict",
} as const satisfies Record<IntentProblem["reason"], ErrorTextKey>;

/** Код `/ui` по причине — тоже закрытым соответствием, а не разбором по месту. */
const CODE_OF_REASON = {
  BODY_FORM: "INTENT_DRAFT_INVALID",
  PRESS: "INTENT_DRAFT_INVALID",
  NOT_FOUND: "PURCHASE_NOT_FOUND",
  SHOWN_STALE: "SHOWN_STALE",
  ALREADY_SENT: "STEP_NOT_ALLOWED",
  KEY_REQUIRED: "IDEMPOTENCY_REQUIRED",
  KEY_CONFLICT: "IDEMPOTENCY_CONFLICT",
} as const satisfies Record<IntentProblem["reason"], IntentErrorCode>;

/** Запись журнала покупки об отправке поручения на подпись. Реквизитов и сумм в ней нет (инвариант 1) — только
 *  идентификаторы, провенанс нажатия и, у отказа, **причина** (наружу она не идёт). */
export type IntentJournalEntry =
  | {
      readonly event: "intent.sent";
      readonly draft_id: string;
      readonly purchase_id: string;
      readonly mandate_id: string;
      readonly shown_hash: string;
      readonly press: IntentRequest["press"];
      /** кто нажал: `human`, `emulator` или `test` (П26 с дополнением 2); умолчания нет */
      readonly by: UiSignedBy;
      readonly at: string;
    }
  | {
      readonly event: "intent.refused";
      readonly draft_id: string | null;
      readonly code: IntentErrorCode;
      readonly problem: IntentProblem;
      readonly at: string;
    };

export interface IntentServiceJournal {
  write(entry: IntentJournalEntry): void;
}

/** Ядро за портом: сервис просит мандат и получает то, что нужно телу § 5.2. Форма порта — не «клиент ПАО», а ровно
 *  один шаг ядра: так сервис проверяем без ПАО, а адаптер платформы в приложение не попадает (правило 1 планов). */
export interface IntentCorePort {
  requestIntent(
    draft: MandateDraft,
    mutation: Mutation,
  ): Promise<{ readonly purchase_id: string; readonly state: PurchaseState; readonly mandate: Mandate }>;
}

/** Прежний ответ по ключу идемпотентности: отпечаток первого тела и **исход**, который тогда отдали (правило 2). */
export interface RememberedIntent {
  readonly fingerprint: string;
  readonly outcome: IntentOutcome;
}

/** Состояние черновика у отправки: свободен, занят обращением к ядру (покупки ещё нет) или закрыт покупкой. */
export type DraftHold = { readonly held: false } | { readonly held: true; readonly purchase_id: string | null };

export interface IntentStore {
  recall(key: IdempotencyKey): RememberedIntent | null;
  remember(key: IdempotencyKey, answer: RememberedIntent): void;
  /** Занять черновик **до** обращения к ядру. `false` — уже занят: тогда это не свой шаг.
   *  Почему до, а не после: два запроса с **разными** ключами идемпотентности по одному `draft_id` оба проходили
   *  проверку «уже отправлен?» и оба звали ядро — два мандата на одну показанную карточку, а второй падал на записи
   *  исключением, то есть 500 вместо 409 (находка ревью К5 Б2). Правило 2 здесь не помогает: ключи разные. */
  hold(draftId: string): boolean;
  /** состояние черновика — для отказа «не свой шаг» */
  holdOf(draftId: string): DraftHold;
  /** ядро ответило: за черновиком закреплена покупка */
  complete(draftId: string, purchaseId: string): void;
  /** ядро отказало или упало: занятие снимается, человек может нажать ещё раз */
  release(draftId: string): void;
}

export function createIntentStore(): IntentStore {
  const answers = new Map<IdempotencyKey, RememberedIntent>();
  const holds = new Map<string, string | null>();
  return {
    recall: (key) => answers.get(key) ?? null,
    remember: (key, answer) => {
      answers.set(key, answer);
    },
    hold: (draftId) => {
      if (holds.has(draftId)) return false;
      holds.set(draftId, null);
      return true;
    },
    holdOf: (draftId) => (holds.has(draftId) ? { held: true, purchase_id: holds.get(draftId) ?? null } : { held: false }),
    complete: (draftId, purchaseId) => {
      if (!holds.has(draftId)) throw new Error(`intent: черновик ${draftId} не занят — закреплять покупку нечем`);
      holds.set(draftId, purchaseId);
    },
    release: (draftId) => {
      // Снять можно только незакрытое занятие: покупка, уже закреплённая за черновиком, не отменяется.
      if (holds.get(draftId) === null) holds.delete(draftId);
    },
  };
}

export interface IntentServiceDeps {
  readonly lang: UiLang;
  readonly texts: IntentTexts;
  readonly drafts: IntentDraftStore;
  readonly store: IntentStore;
  readonly journal: IntentServiceJournal;
  readonly core: IntentCorePort;
  /** клиент банка, от имени которого действует агент: **идентификатор**, не реквизит (инвариант 1) */
  readonly principalRef: string;
  /** кто нажал — сервер знает это сам; умолчания нет (П26, П5), как у подписи принципов */
  readonly by: () => UiSignedBy;
  /** `Mutation` ядра — **зависимостью** (Р-1644): вывод ключа ядра из ключа экрана делает сервер ИН-0 */
  readonly mutation: (key: IdempotencyKey) => Mutation;
  /** идентификатор показанного — тот же, что отдали в `view` карточки (правило 1) */
  readonly viewId: (draftId: string) => string;
  /** куда человек идёт подписывать: ссылка на экран мандатов банка стенда (Р-1313); в ИН-ВМ — `null` */
  readonly signLink: (mandateId: string) => string | null;
  readonly now: () => string;
}

/** Исход метода: тело § 5.2 или отказ. Причина в ответ **не идёт** — только код, класс повтора, текст и, у
 *  устаревшей карточки, новая карточка в `view` (§ 3 «Ошибки»). */
export type IntentOutcome =
  | { readonly ok: true; readonly replay: boolean; readonly status: 202; readonly body: IntentResponse }
  | { readonly ok: false; readonly status: 400 | 404 | 409; readonly body: UiErrorBody };

const KEYS: readonly string[] = ["draft_id", "shown_hash", "press"];

/** Перевод черновика в `MandateDraft` ядра — **здесь и только здесь** (К1: доменных имён ядра в модели нет).
 *  `keyTermsShown: true` ставится не «на всякий случай»: карточка показана, и это доказано совпадением хэша
 *  показанного (правило 1) — до этой строки сервис не доходит, если хэш не сошёлся (Т3а). */
function toCoreDraft(draft: IntentDraft, principalRef: string): MandateDraft {
  return {
    kind: "INTENT",
    parentId: null,
    subject: draft.subject,
    amountLimit: { amount: draft.limit.amount, currency: draft.limit.currency },
    validTo: draft.valid_to,
    merchantScope: [...draft.merchants],
    principalRef,
    confirmationMode: draft.confirmation_mode,
    keyTermsShown: true,
    cart: null,
  };
}

/** Проверка формы тела § 5.2. Порядок — форма → значения, как у подписи принципов. */
function checkBody(body: unknown): IntentProblem | null {
  if (body === null || typeof body !== "object") return { reason: "BODY_FORM", field: "body" };
  const raw = body as Record<string, unknown>;
  for (const key of Object.keys(raw)) if (!KEYS.includes(key)) return { reason: "BODY_FORM", field: key };
  if (typeof raw["draft_id"] !== "string" || !/^drf_[A-Za-z0-9_-]+$/.test(raw["draft_id"]))
    return { reason: "BODY_FORM", field: "draft_id" };
  // Форма хэша здесь **не** проверяется: «не по форме» — это не негодное тело, а тот же случай «карточка устарела»,
  // и ответ на него — `SHOWN_STALE` с новой карточкой (`shown-hash.ts`, и так же судит подпись принципов). До правки
  // по ревью (К5 В2) ветвь «не по форме» отвечала 400, а комментарий причины обещал обратное.
  if (typeof raw["shown_hash"] !== "string") return { reason: "BODY_FORM", field: "shown_hash" };
  const press = checkUiPress(raw["press"]);
  if (press !== null) return { reason: "PRESS", detail: press };
  return null;
}

/** Отпечаток тела — общий для всех `POST` (`src/contract/ui-v1/fingerprint.ts`, находка ревью К5 В1): порядок ключей
 *  на «то же тело» не влияет, `undefined` у поля отличим от отсутствия поля, нештатное значение не бросает наружу.
 *  Берётся **до** проверки формы: негодное тело занимает ключ так же, как годное (решение владельца 19.11, 18:20). */
const fingerprint = (body: unknown): string => bodyFingerprint("intent.post", body);

/** Тело приходит **недоверенным** (`unknown`), а не типом контракта: `IntentRequest` в подписи обещал бы, что форма
 *  уже проверена, хотя внутри тело разбирается как пришло — отсюда и цепочка `body?.draft_id` (замечание повторного
 *  ревью К5 З9). После `checkBody` форма доказана, и дальше тело читается как `IntentRequest`. */
export async function postIntent(
  body: unknown,
  key: string | null | undefined,
  deps: IntentServiceDeps,
): Promise<IntentOutcome> {
  const refuse = (problem: IntentProblem, draftId: string | null, view: ReturnType<typeof viewOf> | null = null): IntentOutcome => {
    const code = CODE_OF_REASON[problem.reason];
    deps.journal.write({ event: "intent.refused", draft_id: draftId, code, problem, at: deps.now() });
    return {
      ok: false,
      status: UI_ERROR_STATUS[code],
      body: {
        error: {
          code,
          retry: RETRY_BY_CODE[code],
          text: deps.texts.errors[TEXT_OF_REASON[problem.reason]][deps.lang],
          view,
        },
      },
    };
  };

  // `IDEMPOTENCY_REQUIRED` ключ **не занимает** — занимать нечего (у ПАО класс `same_key`: «добавить ключ и
  // повторять с ним же»).
  if (typeof key !== "string" || !isIdempotencyKey(key)) return refuse({ reason: "KEY_REQUIRED" }, null);

  const settle = (outcome: IntentOutcome): IntentOutcome => {
    deps.store.remember(key, { fingerprint: fingerprint(body), outcome });
    return outcome;
  };

  const remembered = deps.store.recall(key);
  if (remembered !== null) {
    if (remembered.fingerprint !== fingerprint(body)) return refuse({ reason: "KEY_CONFLICT" }, null);
    // То же тело — тот же ответ, в том числе тот же отказ; второго обращения к ядру нет.
    return remembered.outcome.ok ? { ...remembered.outcome, replay: true } : remembered.outcome;
  }

  const form = checkBody(body);
  if (form !== null) {
    // Идентификатор черновика в журнал — только если он есть и строкой: до проверки формы тело ничем не обещано.
    const raw = (body ?? {}) as Record<string, unknown>;
    return settle(refuse(form, typeof raw["draft_id"] === "string" ? raw["draft_id"] : null));
  }

  // Форма доказана `checkBody` — дальше тело читается типом контракта.
  const req = body as IntentRequest;
  const record = deps.drafts.get(req.draft_id);
  // Неизвестный, чужой или не по форме черновик — **один** ответ: экрану не видно, что он чужой (§ 6).
  if (record === null) return settle(refuse({ reason: "NOT_FOUND" }, req.draft_id));

  // Хэш и **версия текстов провенанса** — одна величина с версией показанного (§ 3): расходится — человек
  // подтверждал не те тексты, которые сервер считает показанными, и это тот же случай «карточка устарела»
  // (`SHOWN_STALE` с новой карточкой). Так же судит подпись принципов; в К5 проверки версии не было — блокер Б1
  // повторного ревью. Хэш считается по **своей** копии показанного, присланный в расчёт не берётся.
  const ownHash = showingHash(record.shown);
  if (req.press.text_version !== record.shown.text_version || req.shown_hash !== ownHash)
    return settle(
      refuse({ reason: "SHOWN_STALE" }, req.draft_id, viewOf(deps.viewId(req.draft_id), record.shown)),
    );

  // Черновик занимается **до** обращения к ядру (Б2): иначе два запроса с разными ключами просили бы у ядра два
  // мандата на одну показанную карточку.
  if (!deps.store.hold(req.draft_id)) {
    const hold = deps.store.holdOf(req.draft_id);
    return settle(
      refuse({ reason: "ALREADY_SENT", purchase_id: hold.held ? hold.purchase_id : null }, req.draft_id),
    );
  }

  let core;
  try {
    core = await deps.core.requestIntent(toCoreDraft(record.draft, deps.principalRef), deps.mutation(key));
  } catch (failure) {
    // Ядро отказало или упало — занятие снимается: человек должен иметь возможность нажать ещё раз, а исход не
    // окончателен, поэтому ключ им не занимается (отказ ядра маршрут отдаёт кодом ядра, § 3 «Ошибки»).
    deps.store.release(req.draft_id);
    throw failure;
  }

  const mandate: UiMandateRef = { id: core.mandate.id, kind: core.mandate.kind, status: core.mandate.status };
  const sign: UiSignRoute = {
    // На MVP — всегда банк (Р-1657). `BANK_MODULE` появится у ИН-ВМ, и тогда `link` равен `null`.
    where: "BANK",
    link: deps.signLink(core.mandate.id),
    text: deps.texts.actions.sign_in_bank[deps.lang],
  };

  deps.store.complete(req.draft_id, core.purchase_id);
  deps.journal.write({
    event: "intent.sent",
    draft_id: req.draft_id,
    purchase_id: core.purchase_id,
    mandate_id: core.mandate.id,
    // В журнал идёт **своя** величина хэша, а не присланная (З7): ослабят сверку — журнал не станет заверять
    // присланное.
    shown_hash: ownHash,
    press: req.press,
    // Кто нажал — П26: умолчания нет, признак приходит зависимостью от сервера, как у подписи принципов (В3).
    by: deps.by(),
    at: deps.now(),
  });

  return settle({
    ok: true,
    replay: false,
    status: 202,
    body: {
      purchase_id: core.purchase_id,
      // `state` — от ядра, `step` — по таблице КТ-0: экран таблицы не держит (правило 3).
      state: core.state,
      step: stepOfState(core.state),
      mandate,
      sign,
    },
  });
}
