// П-К4, К2 — сборка карточки поручения из шаблона и уточняющие вопросы (К-Б § 5.1; решение П33).
//
// **Что здесь происходит.** Человек сказал фразу. До ВР-5 «понимание запроса» фразу никто не разбирает (§ 5.1,
// «на стенде до ВР-5»): карточка собирается из **шаблона**, а фраза только пишется в журнал. Поэтому единственное
// честное правило неполноты такое: **чего шаблон не заявил — то и спрашивается**. Умолчания не подставляются ни одному
// полю (постановка П-К4, К2): подставленное умолчание — это карточка, в которой написано не то, о чём человек просил, а
// подписывает он именно карточку.
//
// **Почему шаблон — порт, а не импорт `src/demo/scenarios.ts`.** Шаблон стенда живёт в сборке демо-стенда и тянет
// `agentic-ps-platform` (devDependency, набор витрин). Прямой импорт увёл бы стенд в сборку приложения и повторил бы в
// двух местах то, что по правилу 1 планов («только через порт») место имеет в одном. Шаблон подаётся зависимостью — как
// `by`, `now`, `shown` у подписи принципов (П-К1) и как `Mutation` у К5 (Р-1644). С ВР-5 тот же порт заполняет
// решатель, и этот модуль не меняется.
//
// **Чего здесь нет.** Строки-пояснения `lines` — К3 (здесь карточка отдаёт пустой перечень). `view` и `actions.submit`
// с `why_disabled` — К4. `POST /ui/v1/intent`, перевод в `MandateDraft` ядра и код отказа на негодное тело — К5.
// Пределы, остаток и допустимость валюты не считаются и здесь (инвариант 2, правило 3 К-Б).
import type { UiInstant } from "../contract/ui-v1/common.js";
import type { IntentCard, IntentQuestion } from "../contract/ui-v1/methods.js";
import { DRAFT_KEYS, checkDraft, type DraftField, type IntentDraft } from "./model.js";

/** Шаблон поручения — **порт**. Поля необязательны: шаблон заявляет только то, что знает про это поручение, и ничего
 *  не достраивает. Срок приходит **готовым моментом времени**: перевод «7 дней» или «180 секунд» в момент делает тот,
 *  кто подаёт шаблон (сборка стенда знает свои часы), а не этот модуль.
 *  `merchants` — пары «идентификатор витрины + подпись для человека»: карточка § 5.1 показывает продавцов числом и
 *  подписями, а черновик К1 — списком `merchant_id`, и обе формы должны получиться из одного источника, иначе число на
 *  карточке и список в поручении разойдутся. */
export interface IntentTemplate {
  readonly subject?: string;
  readonly limit?: IntentDraft["limit"];
  readonly valid_to?: UiInstant;
  readonly merchants?: readonly { readonly id: string; readonly label: string }[];
  readonly confirmation_mode?: IntentDraft["confirmation_mode"];
}

/** Коды уточняющих вопросов — **ровно** поля черновика § 5.1: спросить можно только то, что в поручении есть.
 *  Перечень не копируется, а берётся у модели (`DRAFT_KEYS`), и совпадение держится компиляцией ниже. */
export type IntentQuestionCode = DraftField;

export const QUESTION_CODES: readonly IntentQuestionCode[] = DRAFT_KEYS;

type CodesAreDraftFields = IntentQuestionCode extends DraftField
  ? DraftField extends IntentQuestionCode
    ? true
    : never
  : never;
const _codesAreDraftFields: CodesAreDraftFields = true;
void _codesAreDraftFields;

/** Запись журнала о фразе (§ 5.1: «фраза только записывается в журнал»).
 *  **Фраза — свободный текст человека, и инвариант 1 сильнее контракта:** в журнал нельзя писать платёжные реквизиты,
 *  даже если их туда вписал сам человек. Поэтому длинные цифровые ряды из фразы вырезаются до записи, а факт вырезания
 *  назван полем `redacted` — молча подменённый текст в журнале хуже отсутствующего. */
export interface IntentDraftEntry {
  readonly event: "intent.draft";
  readonly draft_id: string;
  /** фраза человека после вырезания цифровых рядов */
  readonly phrase: string;
  readonly redacted: boolean;
  /** что осталось спросить: пусто — карточка собралась целиком */
  readonly questions: readonly IntentQuestionCode[];
  readonly at: UiInstant;
}

export interface IntentJournal {
  write(entry: IntentDraftEntry): void;
}

/** Хранение черновиков — **портом**, как состояние профиля принципов (`PrinciplesStore`): `draft_id` в § 5.1 выдаётся
 *  затем, чтобы К5 нашёл по нему **тот самый** черновик, который человек видел. Замены и удаления у порта нет. */
export interface IntentDraftStore {
  put(draftId: string, draft: IntentDraft): void;
  get(draftId: string): IntentDraft | null;
}

/** Состояние сервера в памяти процесса; снаружи виден только порт. */
export function createIntentDraftStore(): IntentDraftStore {
  const drafts = new Map<string, IntentDraft>();
  return {
    put: (draftId, draft) => {
      if (drafts.has(draftId)) throw new Error(`intent: черновик ${draftId} уже выдан — замены у порта нет`);
      drafts.set(draftId, draft);
    },
    get: (draftId) => drafts.get(draftId) ?? null,
  };
}

export interface DraftDeps {
  /** шаблон этого поручения; фразу он не разбирает (до ВР-5 её не разбирает никто) */
  readonly template: IntentTemplate;
  /** текст вопроса на языке запроса — данными `config/` (К3); умолчания у текста нет */
  readonly questionText: (code: IntentQuestionCode) => string;
  /** строки-пояснения карточки на языке запроса — `linesFor` из `texts.ts` (К3): сумма и срок уже в виде текста по
   *  валюте, языку и названному поясу; число продавцов `linesFor` берёт у самого черновика, поэтому отдельным
   *  параметром оно не подаётся (находка ревью К3 В2) */
  readonly lines: (draft: IntentDraft) => IntentCard["lines"];
  readonly store: IntentDraftStore;
  readonly journal: IntentJournal;
  /** `drf_…` — идентификатор черновика; его выдаёт сервер, а не экран */
  readonly newDraftId: () => string;
  /** время сервера (не из тела: время устройства живёт в провенансе, П26) */
  readonly now: () => UiInstant;
}

/** Исход сборки.
 *  - `card` — шаблон закрыл все пять полей: есть и черновик (его хранит `store` для К5), и карточка;
 *  - `questions` — шаблон закрыл не всё: карточка **не собирается**, экрану уходит перечень вопросов. Карточки здесь
 *    нет сознательно: любая карточка при незаполненном поле — это либо умолчание, либо пустое место, выданное за
 *    условие поручения;
 *  - `phrase_empty` — фразы нет: журналировать и спрашивать нечего, это негодное тело запроса. Код `/ui` для него в
 *    § 6 отсутствует — его вводит К5 решением владельца, здесь исход назван без кода.
 *  Форма § 5.1 (`card` **и** `questions` в одном теле) собирается в К4 — там же, где `view` и `actions.submit`. */
export type DraftOutcome =
  | {
      readonly kind: "card";
      readonly draft_id: string;
      readonly draft: IntentDraft;
      readonly card: IntentCard;
      readonly questions: readonly [];
    }
  | { readonly kind: "questions"; readonly draft_id: string; readonly questions: readonly IntentQuestion[] }
  | { readonly kind: "phrase_empty" };

/** Разделители **внутри** цифрового ряда, которые его не разрывают: пробелы любого вида (включая неразрывный — он
 *  приезжает при вставке из буфера и переводе строки), точка, дефис, оба тире, прямой и обратный слэш. Запятая и
 *  двоеточие не в перечне намеренно: «до 1000 ₽, 2 буханки» и «до 12:00» — не ряд (находка ревью К2 Б2). */
const DIGIT_SEP = "[\\s\\u00a0.\\-–—/\\\\]";

/** Цифровой ряд из 12 и более цифр, сколько бы разделителей между ними ни стояло: всё, что так выглядит, из фразы
 *  вырезается. Порог ниже самой короткой карты (13) намеренно — вырезать лишнее безопасно, пропустить нельзя. Номер
 *  счёта, телефон и прочие длинные ряды тоже уходят: поручению они не нужны ни одним полем. */
const DIGIT_RUN = new RegExp(`\\d(?:${DIGIT_SEP}*\\d){11,}`, "g");

/** Метка вместо вырезанного ряда. Без языка: это запись журнала, а не строка интерфейса, и на двух языках она не
 *  заводится (находка ревью К2 З3). Видно, что текст изменён, и видно где. */
export const REDACTED = "[redacted]";

export function redactPhrase(phrase: string): { readonly phrase: string; readonly redacted: boolean } {
  const clean = phrase.replace(DIGIT_RUN, REDACTED);
  return { phrase: clean, redacted: clean !== phrase };
}

/** «Заявлено» — есть значение, а не просто ключ: `null` в шаблоне это «нечего сказать», то же самое, что отсутствие
 *  поля, и оно даёт вопрос, а не исключение на проверке формы (находка ревью К2 З4). */
const given = (v: unknown): boolean => v !== undefined && v !== null;

/** Чего шаблон не заявил — то и спрашивается; порядок вопросов — порядок полей § 5.1, а не порядок перебора ключей. */
function missingFields(t: IntentTemplate): readonly IntentQuestionCode[] {
  const said: Record<IntentQuestionCode, boolean> = {
    subject: given(t.subject),
    limit: given(t.limit),
    valid_to: given(t.valid_to),
    merchants: given(t.merchants),
    confirmation_mode: given(t.confirmation_mode),
  };
  return QUESTION_CODES.filter((code) => !said[code]);
}

/** Шаблон, заявивший все пять полей. `Required` берёт перечень у самого `IntentTemplate`: добавится полю — и сужение
 *  перестанет собираться, пока его не проверят здесь тоже. */
type FullTemplate = Required<IntentTemplate>;

function fullTemplate(t: IntentTemplate): FullTemplate | null {
  const { subject, limit, valid_to, merchants, confirmation_mode } = t;
  if (![subject, limit, valid_to, merchants, confirmation_mode].every(given)) return null;
  if (
    subject === undefined ||
    limit === undefined ||
    valid_to === undefined ||
    merchants === undefined ||
    confirmation_mode === undefined
  )
    return null;
  return { subject, limit, valid_to, merchants, confirmation_mode };
}

/** Сборка карточки поручения по фразе (§ 5.1).
 *  Негодный **шаблон** (срок в прошлом, повтор продавца, предел не больше нуля) — это ошибка сборки сервера, а не
 *  отказ человеку: человек шаблон не вводил и поправить его не может. Поэтому исключение, а не исход, — ровно как у
 *  `checkDraft`, когда сервер подал не время. */
export function buildIntentDraft(phrase: unknown, deps: DraftDeps): DraftOutcome {
  if (typeof phrase !== "string" || phrase.trim() === "") return { kind: "phrase_empty" };

  const draftId = deps.newDraftId();
  // Форма `drf_…` — из § 5.1. Проверяется здесь, потому что по этому идентификатору К5 ищет черновик, а чужой формат
  // виден только на разборе журнала, когда искать уже поздно.
  if (!/^drf_[A-Za-z0-9_-]+$/.test(draftId))
    throw new Error(`intent: сервер выдал идентификатор не в форме drf_…: ${draftId}`);

  const at = deps.now();
  const clean = redactPhrase(phrase);
  const missing = missingFields(deps.template);

  /** Журнал пишется **последним**, когда исход уже определён: приём К1.3 П-К1 — отказ не пишет ничего, и запись о
   *  запросе, который кончился исключением, выглядела бы как собравшаяся карточка (находка ревью К2 В4). */
  const journal = (questions: readonly IntentQuestionCode[]): void =>
    deps.journal.write({
      event: "intent.draft",
      draft_id: draftId,
      phrase: clean.phrase,
      redacted: clean.redacted,
      questions,
      at,
    });

  if (missing.length > 0) {
    // `id` вопроса — код поля: экран связывает ответ с полем кодом, а не текстом. Текст приходит готовым, на языке
    // запроса (К3); пустой текст — ошибка сборки, а не вопрос без слов.
    const questions = missing.map((code) => {
      const text = deps.questionText(code);
      if (typeof text !== "string" || text.trim() === "") throw new Error(`intent: у вопроса ${code} нет текста`);
      return { id: code, text } satisfies IntentQuestion;
    });
    journal(missing);
    return { kind: "questions", draft_id: draftId, questions };
  }

  // `missing` пуст — значит заявлены все пять полей, и шаблон полный. Это сужение делается **проверкой полей**, а не
  // приведением типа: приведение сказало бы компилятору неправду, если правило неполноты когда-нибудь изменится.
  const t = fullTemplate(deps.template);
  if (t === null) throw new Error("intent: вопросов нет, но шаблон неполный — правило неполноты разошлось с сборкой");
  const merchants = t.merchants;
  const draft: IntentDraft = {
    subject: t.subject,
    limit: t.limit,
    valid_to: t.valid_to,
    merchants: merchants.map((m) => m.id),
    confirmation_mode: t.confirmation_mode,
  };

  const check = checkDraft(draft, at);
  if (!check.ok) throw new Error(`intent: шаблон дал негодный черновик: ${check.reason}`);

  // Строки — **до** записи: порт строк бросает по замыслу (валюта вне таблицы ISO 4217, срок не по форме), и запись о
  // собравшейся карточке рядом с исключением читалась бы на разборе как удача, а черновик остался бы в хранилище под
  // выданным `draft_id` (находка ревью К3 Б1; тот же приём, что В4 в К2 — журнал последним).
  const lines = deps.lines(draft);

  deps.store.put(draftId, draft);
  journal([]);

  return {
    kind: "card",
    draft_id: draftId,
    draft,
    card: {
      subject: draft.subject,
      limit: draft.limit,
      valid_to: draft.valid_to,
      // Число продавцов — длина перечня, который и уехал в поручение (повтор в нём отвергнут `checkDraft`): карточка
      // не может сказать «продавцов: 3», когда в поручении их два.
      merchants: { count: merchants.length, labels: merchants.map((m) => m.label) },
      confirmation_mode: draft.confirmation_mode,
      // Строки-пояснения — данными `config/` на двух языках (К3), и приходят готовыми: что покупаем, предел, срок,
      // продавцы, режим подтверждения. Порядок строк — часть показанного и входит в хэш (правило 1).
      lines,
    },
    questions: [],
  };
}
