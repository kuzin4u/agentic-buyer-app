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
import type { UiAction, UiLang, UiView } from "../contract/ui-v1/common.js";
import type { IntentDraftResponse } from "../contract/ui-v1/methods.js";
import { viewOf, type ShownPayload } from "../contract/ui-v1/shown-hash.js";
import type { DraftOutcome } from "./draft.js";
import type { IntentTexts } from "./texts.js";

/** То, что человек видел, — для расчёта хэша и для своей копии карточки (правило 1): сервер пересчитывает хэш по
 *  **своей** копии, ни одного значения из тела запроса в расчёт не берёт. */
export function shownOf(texts: IntentTexts, card: IntentDraftResponse["card"]): ShownPayload {
  // Карточки нет — значит и показывать нечего: хэш по пустому месту был бы хэшем, который ничего не доказывает.
  if (card === null) throw new Error("intent: показанного нет — карточка не собрана");
  return { text_version: texts.text_version, card };
}

export interface ResponseDeps {
  readonly lang: UiLang;
  readonly texts: IntentTexts;
  /** идентификатор своей копии показанного: по нему сервер находит карточку, чей хэш сверяет (§ 3, правило 1) */
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
function submitAction(enabled: boolean, deps: ResponseDeps): UiAction {
  const { lang, texts } = deps;
  return {
    enabled,
    label: texts.actions.submit_label[lang],
    why_disabled: enabled ? null : texts.actions.submit_blocked_by_questions[lang],
  };
}

export function draftBody(outcome: DraftOutcome, deps: ResponseDeps): DraftBodyOutcome {
  if (outcome.kind === "phrase_empty") return { ok: false, reason: "phrase_empty" };

  // Язык показанного — один на тело: карточка с английской кнопкой и русскими строками была бы показанным, которого
  // человек целиком не читал, и хэш считался бы по нему же (находка ревью К4 № 3). Это дефект сборки, а не отказ.
  if (outcome.lang !== deps.lang)
    throw new Error(`intent: язык карточки (${outcome.lang}) и язык действия (${deps.lang}) разошлись`);

  if (outcome.kind === "questions")
    return {
      ok: true,
      body: {
        draft_id: outcome.draft_id,
        // Ни карточки, ни хэша: подписывать нечего, пока человек не ответил (Р-1666).
        card: null,
        questions: outcome.questions,
        actions: { submit: submitAction(false, deps) },
        view: null,
      },
    };

  const view: UiView = viewOf(deps.viewId(outcome.draft_id), shownOf(deps.texts, outcome.card));
  return {
    ok: true,
    body: {
      draft_id: outcome.draft_id,
      card: outcome.card,
      questions: [],
      actions: { submit: submitAction(true, deps) },
      view,
    },
  };
}
