// П-К4, К4 — тело `POST /ui/v1/intent/draft` (§ 5.1): `view` по правилу 1 и действие «Сохранить поручение» с
// объяснением недоступности. Сборка карточки и вопросов — К2, тексты — К3, отправка на подпись — К5.
//
// **Правило 1 К-Б (хэш показанного).** Хэш считает канонизация **ядра** (`showingHash`, `src/contract/ui-v1`), а не
// этот модуль: своей копии правила канонизации в приложении нет (Р-1613). В хэш идёт ровно то, что человек видит, —
// версия текстов и карточка целиком, включая строки-пояснения и порядок строк: подписывается прочитанное.
//
// **Решение владельца 20.11, 17:07 (Р-1666).** Пока есть вопросы, карточки нет — значит нет и `view`: хэш считается
// только по полной карточке, а подписывать нечего. Тогда `submit` недоступен, и **недоступность объясняется текстом**
// (`why_disabled` из `config/` на языке запроса), а не молчанием кнопки.
//
// Чего здесь нет: кода отказа на негодное тело (`phrase_empty`) — коды `/ui` заводит К5 (`INTENT_DRAFT_INVALID`,
// Р-1650), поэтому исход отдаётся как есть, а код и статус приставляет сервис метода.
import type { UiAction, UiView } from "../contract/ui-v1/common.js";
import type { IntentDraftResponse } from "../contract/ui-v1/methods.js";
import { isViewId, viewOf, type ShownPayload } from "../contract/ui-v1/shown-hash.js";
import type { DraftOutcome, IntentShow } from "./draft.js";

/** То, что человек видел, — для расчёта хэша и для своей копии карточки (правило 1): сервер пересчитывает хэш по
 *  **своей** копии, ни одного значения из тела запроса в расчёт не берёт.
 *  Принимает **исход сборки целиком**, а не карточку с версией по отдельности: произвольная строка версии рядом с
 *  карточкой — это та самая дверь, через которую хэш начинает заверять тексты, которых человеку не показывали
 *  (К4а, повторное ревью К4 № 2). Собрать такую пару снаружи больше нечем. */
export function shownOf(outcome: Extract<DraftOutcome, { kind: "card" }>): ShownPayload {
  // Показанное **не собирается заново**: исход несёт тот самый объект, который лёг и в хранилище (З5).
  return outcome.shown;
}

export interface ResponseDeps {
  /** идентификатор своей копии показанного: по нему сервер находит карточку, чей хэш сверяет (§ 3, правило 1).
   *  Ни языка, ни текстов здесь больше нет: подпись действия берётся из **того же** показа, что и карточка
   *  (`outcome.show`), и подать их врозь нечем — сторожки-сравнения для этого не нужны (К4а, находка № 1). */
  readonly viewId: (draftId: string) => string;
}

/** Исход сборки тела § 5.1. `phrase_empty` отдаётся отдельно: это негодное тело запроса, и код `/ui` для него
 *  приставляет К5, а не этот модуль. */
export type DraftBodyOutcome =
  | { readonly ok: true; readonly body: IntentDraftResponse }
  /** имя — в форме исхода, а не кода `/ui` (строчными, как `DraftOutcome.kind`): иначе значение, которого нет в
   *  `UI_ERROR_CODES`, легко уехало бы на провод кодом (находка ревью К4 № 6) */
  | { readonly ok: false; readonly reason: "phrase_empty" };

/** Действие «Сохранить поручение». Подпись — всегда, доступность — по тому, остались ли вопросы; `why_disabled`
 *  непустой ровно тогда, когда действие недоступно (§ 3 «Действие с объяснением недоступного»). */
function submitAction(enabled: boolean, show: IntentShow): UiAction {
  const { lang, texts } = show;
  return {
    enabled,
    label: texts.actions.submit_label[lang],
    why_disabled: enabled ? null : texts.actions.submit_blocked_by_questions[lang],
  };
}

export function draftBody(outcome: DraftOutcome, deps: ResponseDeps): DraftBodyOutcome {
  if (outcome.kind === "phrase_empty") return { ok: false, reason: "phrase_empty" };

  if (outcome.kind === "questions")
    return {
      ok: true,
      body: {
        draft_id: outcome.draft_id,
        // Ни карточки, ни хэша: подписывать нечего, пока человек не ответил (Р-1666).
        card: null,
        questions: outcome.questions,
        actions: { submit: submitAction(false, outcome.show) },
        view: null,
      },
    };

  // `view_id` — своей копии показанного; форма проверяется здесь, потому что по нему К5 ищет показанное, и пустое
  // или чужое значение видно только на разборе, когда искать уже поздно (замечание повторного ревью К4 № 4).
  // Форма — **общая** проверка контракта (`isViewId`), а не второй регуляркой здесь: `viewOf` её и так требует, но
  // свой текст ошибки называет место сборки (замечание повторного ревью К5 З6).
  const viewId = deps.viewId(outcome.draft_id);
  if (!isViewId(viewId)) throw new Error(`intent: сервер выдал идентификатор показанного не в форме vw_…: ${viewId}`);

  const view: UiView = viewOf(viewId, shownOf(outcome));
  return {
    ok: true,
    body: {
      draft_id: outcome.draft_id,
      card: outcome.card,
      questions: [],
      actions: { submit: submitAction(true, outcome.show) },
      view,
    },
  };
}
