// П-К1, К1.5 — сервис `GET` и `POST /ui/v1/principles` (§ 5.14). Маршрут и экран И-2 — ИН-0 окна Б: здесь только
// тела ответов, собранные сервером целиком. Экран ничего не считает (правило 3 К-Б): ранги, пометки, тексты ошибок и
// строки-пояснения приходят готовыми, на языке запроса.
// Весов в ответах нет ни одним полем (правка 6 канвы, П32) — это держит тест К1.2 по именам полей `/ui/v1`.
import type { UiErrorBody, UiRetryClass } from "../contract/ui-v1/errors.js";
import { UI_ERROR_STATUS } from "../contract/ui-v1/errors.js";
import type { UiLang } from "../contract/ui-v1/common.js";
import type { PrinciplesRequest, PrinciplesResponse } from "../contract/ui-v1/methods.js";
import { viewOf, type ShownPayload } from "../contract/ui-v1/shown-hash.js";
import type { ErrorTextKey, PrinciplesCatalog, SignedBy, SignedPrinciples } from "./model.js";
import { lockedId, notesFor, ranksFor } from "./selection.js";
import type { PrinciplesStore, SignDeps, SignErrorCode, SignOutcome, SignRequest } from "./signature.js";
import { signPrinciples } from "./signature.js";

/** Класс повтора у каждого кода `/ui`, которым отвечает этот метод (§ 3 «Ошибки»: `retry` — класс повтора ядра).
 *  Откуда взят каждый:
 *  - `PRINCIPLES_ORDER_INVALID` — **решение владельца 19.11** (`after_fix`);
 *  - `IDEMPOTENCY_REQUIRED` (`same_key`) и `IDEMPOTENCY_CONFLICT` (`after_fix`) — **таблица кодов ПАО 1.4.0**, по
 *    правилу 2 К-Б «сервер отвечает так же, как ПАО»;
 *  - `SHOWN_STALE` — **решение владельца 19.11, 18:20**: `after_human`. После устаревшей карточки человек должен
 *    посмотреть на новую и нажать заново — это решение человека, а не исправление тела. В § 6 К-Б класс войдёт
 *    с v1.1.
 *  `satisfies` держит перечень полным: новый код `SignErrorCode` без класса не пройдёт сборку. */
export const RETRY_BY_CODE = {
  SHOWN_STALE: "after_human",
  PRINCIPLES_ORDER_INVALID: "after_fix",
  IDEMPOTENCY_REQUIRED: "same_key",
  IDEMPOTENCY_CONFLICT: "after_fix",
} as const satisfies Record<SignErrorCode, UiRetryClass>;

/** Тексты ошибок в `config/` описывают **ровно** те же коды, которыми отвечает подпись — проверка на компиляции, а
 *  не на словах: разойдутся перечни, и сборка станет красной. */
type SameKeys = ErrorTextKey extends SignErrorCode ? (SignErrorCode extends ErrorTextKey ? true : never) : never;
const _errorTextsCoverCodes: SameKeys = true;
void _errorTextsCoverCodes;

/** Тело запроса контракта и тело, которое разбирает подпись, — **одно и то же**: приведения типов между ними нет,
 *  иначе будущее расхождение § 5.14 с подписью проглотилось бы молча (находка ревью К1.5 № 7). */
type SameBody = PrinciplesRequest extends SignRequest ? (SignRequest extends PrinciplesRequest ? true : never) : never;
const _requestMatchesSignRequest: SameBody = true;
void _requestMatchesSignRequest;

export interface PrinciplesServiceDeps {
  readonly catalog: PrinciplesCatalog;
  readonly store: PrinciplesStore;
  readonly journal: SignDeps["journal"];
  /** своя копия показанной карточки — её же сервер отдаёт в `view` и по ней сверяет хэш (правило 1) */
  readonly shown: (lang: UiLang) => ShownPayload;
  readonly viewId: string;
  readonly now: () => string;
  /** кто нажал — сервер знает это сам; умолчания нет (П26, П5) */
  readonly by: () => SignedBy;
}

/** Тело `GET /ui/v1/principles` (§ 5.14) целиком.
 *  `items` — только `id`, текст на языке запроса, `rank` и `on`: веса остаются на сервере.
 *  `signed` — `null`, пока клиент не подтвердил свой порядок; иначе время получения сервером, номер версии и
 *  **`by`** — кто нажал (решение владельца 19.11, 17:52 п. 2). Пометку «подписано эмулятором клиента» рисует экран
 *  И-2 окна Б, текст — его.
 *  `notes` — строки-пояснения, `locked_id` — пункт, который нельзя выключить. */
export function getPrinciplesView(lang: UiLang, deps: PrinciplesServiceDeps): PrinciplesResponse {
  return viewOfVersion(deps.store.last(), lang, deps);
}

/** Тело `GET` **для названной версии**. Нужно отдельно от `getPrinciplesView`, потому что повтор по ключу
 *  идемпотентности обязан отдать **тот же** ответ (правило 2 К-Б), а состояние к этому времени могло уйти вперёд:
 *  другим ключом подписана версия 2, и пересборка «по текущему состоянию» выдала бы на повтор первого ключа тело
 *  второй версии (находка ревью К1.5 № 2). */
function viewOfVersion(
  version: SignedPrinciples | null,
  lang: UiLang,
  deps: PrinciplesServiceDeps,
): PrinciplesResponse {
  const texts = new Map(deps.catalog.items.map((p) => [p.id, p.text[lang]]));
  return {
    items: ranksFor(version, deps.catalog).map((row) => {
      const text = texts.get(row.id);
      // Умолчания у текста нет: пустая строка уехала бы на экран вместо ошибки формы. Перечень разобран
      // `parsePrinciplesCatalog`, где тексты обязательны, так что сюда это не доходит — но молчать нельзя.
      if (text === undefined) throw new Error(`principles: у пункта ${row.id} нет текста на ${lang}`);
      return { id: row.id, text, rank: row.rank, on: row.on };
    }),
    signed:
      version === null
        ? null
        : { at: version.received_at, version: String(version.no), by: version.by },
    notes: notesFor(version, deps.catalog, lang),
    locked_id: lockedId(deps.catalog),
    view: viewOf(deps.viewId, deps.shown(lang)),
  };
}

/** Ответ `POST /ui/v1/principles`: удача — тело `GET` в новом состоянии, отказ — тело ошибки § 3.
 *  Тело ошибки собирается здесь, а не в подписи: `text` предназначен человеку и зависит от языка запроса, а подпись
 *  языка не знает и знать не должна. Причина отказа (`problem`) в ответ **не идёт** — она уточнение для журнала и
 *  разбора, экрану от неё пользы нет (П32 дополнение 1). */
export type PostOutcome =
  | { readonly ok: true; readonly replay: boolean; readonly body: PrinciplesResponse; readonly version: SignedPrinciples }
  | { readonly ok: false; readonly status: 400 | 409; readonly body: UiErrorBody };

export function postPrinciples(
  body: PrinciplesRequest,
  key: string | null | undefined,
  lang: UiLang,
  deps: PrinciplesServiceDeps,
): PostOutcome {
  const outcome: SignOutcome = signPrinciples(body, key, {
    catalog: deps.catalog,
    store: deps.store,
    journal: deps.journal,
    shown: () => deps.shown(lang),
    viewId: deps.viewId,
    now: deps.now,
    by: deps.by,
  });
  // Тело собирается **от версии этого ответа**, а не от текущего состояния: иначе повтор по ключу отдавал бы тело
  // чужой, более поздней версии (правило 2 К-Б).
  if (outcome.ok)
    return { ok: true, replay: outcome.replay, body: viewOfVersion(outcome.version, lang, deps), version: outcome.version };
  return {
    // Статус — из таблицы контракта (`UI_ERROR_STATUS`), а не второй копией по месту: `PRINCIPLES_ORDER_INVALID`
    // это 400, `IDEMPOTENCY_REQUIRED` — 400, оба идемпотентных прочих — 409.
    ok: false,
    status: UI_ERROR_STATUS[outcome.code],
    body: {
      error: {
        code: outcome.code,
        retry: RETRY_BY_CODE[outcome.code],
        text: deps.catalog.errors[outcome.code][lang],
        // Карточка собирается **на языке этого запроса**: у ru и en хэш разный, и запомненная карточка первого
        // языка была бы той, которую сервер для нынешнего языка не признаёт (находка ревью К1.5 № 3). Язык — это
        // способ показа, а не часть тела: `text` ошибки точно так же зависит от него.
        view: outcome.view === null ? null : viewOf(deps.viewId, deps.shown(lang)),
      },
    },
  };
}
