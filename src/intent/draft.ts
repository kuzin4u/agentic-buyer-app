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
import type { UiInstant, UiLang } from "../contract/ui-v1/common.js";
import type { IntentCard, IntentQuestion } from "../contract/ui-v1/methods.js";
import type { ShownPayload } from "../contract/ui-v1/shown-hash.js";
import { DRAFT_KEYS, checkDraft, type DraftField, type IntentDraft } from "./model.js";
import { linesFor, questionTextFor, type IntentTexts, type MoneyText } from "./texts.js";

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

/** Что сервер помнит о показе: черновик, который уедет ядру, и **показанное** — версия текстов и карточка, по которым
 *  считался хэш (правило 1). Показанное хранится рядом с черновиком намеренно: иначе К5, чтобы пересчитать хэш «своей
 *  копией», пришлось бы воспроизводить язык, пояс и версию текстов того же показа, и честная подпись получала бы
 *  `SHOWN_STALE` (находка ревью К4 № 8). */
export interface DraftRecord {
  readonly draft: IntentDraft;
  readonly shown: ShownPayload;
}

/** Хранение черновиков — **портом**, как состояние профиля принципов (`PrinciplesStore`): `draft_id` в § 5.1 выдаётся
 *  затем, чтобы К5 нашёл по нему **тот самый** показ, который человек видел. Замены и удаления у порта нет. */
export interface IntentDraftStore {
  put(draftId: string, record: DraftRecord): void;
  get(draftId: string): DraftRecord | null;
}

/** Состояние сервера в памяти процесса; снаружи виден только порт. */
export function createIntentDraftStore(): IntentDraftStore {
  const drafts = new Map<string, DraftRecord>();
  return {
    put: (draftId, record) => {
      if (drafts.has(draftId)) throw new Error(`intent: черновик ${draftId} уже выдан — замены у порта нет`);
      drafts.set(draftId, record);
    },
    get: (draftId) => drafts.get(draftId) ?? null,
  };
}

/** К4а (повторное ревью К4, находки № 1 и № 2). **Показанное и его описатели приходят из одного источника.**
 *  Было: язык и строки-пояснения подавались двумя независимыми портами (`lang` и `lines`), а версия текстов бралась
 *  уже третьим местом — при сборке тела. Тогда собиралась карточка с русскими строками и английской кнопкой, а хэш
 *  заверял версию текстов, которой показанные строки не принадлежат. Проверка на расхождение сверяла два
 *  **объявления**, а не язык содержимого, и покраснеть на такой смеси не могла.
 *  Стало: сборка берёт перечень текстов целиком (`texts`) и язык (`lang`), строки собирает сама (`linesFor`), тексты
 *  вопросов — оттуда же, а в исход кладёт и язык, и `text_version` того же перечня. Показ суммы остаётся **портом**
 *  (Р-1667: общая функция у окна Б), пояс — названным (ревью К3 В4). */
export interface DraftDeps {
  /** язык этого показа: на нём и вопросы, и строки-пояснения, и подпись действия */
  readonly lang: UiLang;
  /** тексты карточки целиком — `config/intent.default.json` (К3): из них берутся и строки, и вопросы, и версия */
  readonly texts: IntentTexts;
  /** показ суммы — порт (Р-1667); своей копии окно А не держит */
  readonly money: MoneyText;
  /** названный пояс человека для срока: пояс процесса в хэшируемый текст не попадает (ревью К3 В4) */
  readonly timeZone: string;
  /** шаблон этого поручения; фразу он не разбирает (до ВР-5 её не разбирает никто) */
  readonly template: IntentTemplate;
  readonly store: IntentDraftStore;
  readonly journal: IntentJournal;
  /** `drf_…` — идентификатор черновика; его выдаёт сервер, а не экран */
  readonly newDraftId: () => string;
  /** время сервера (не из тела: время устройства живёт в провенансе, П26) */
  readonly now: () => UiInstant;
}

/** Показ: язык и перечень текстов, из которых собрано показанное. Один объект, а не пара независимых значений, —
 *  чтобы подать язык от одного перечня, а тексты от другого было **нечем** (К4а). */
export interface IntentShow {
  readonly lang: UiLang;
  readonly texts: IntentTexts;
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
      /** **Показ целиком**: язык и перечень текстов, из которых собрано показанное. Сборка тела § 5.1 берёт отсюда и
       *  подпись действия, и версию текстов для хэша — своего перечня у неё нет (К4а, повторное ревью К4 № 1 и № 2:
       *  пока перечень действий был вторым источником, тело с русскими строками и английской кнопкой собиралось
       *  молча, а сторожки сверяли лишь объявления `lang` и `text_version`). */
      readonly show: IntentShow;
      /** Показанное — **один объект** на исход, хранилище и расчёт хэша: раньше его собирали дважды по одним данным,
       *  и разойтись им было нечем только пока обе сборки совпадали (замечание повторного ревью К5 З5). */
      readonly shown: ShownPayload;
    }
  | {
      readonly kind: "questions";
      readonly draft_id: string;
      readonly questions: readonly [IntentQuestion, ...IntentQuestion[]];
      readonly show: IntentShow;
    }
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
      const text = questionTextFor(deps.texts, deps.lang)(code);
      if (typeof text !== "string" || text.trim() === "") throw new Error(`intent: у вопроса ${code} нет текста`);
      return { id: code, text } satisfies IntentQuestion;
    });
    journal(missing);
    // Перечень непустой по условию ветки (`missing.length > 0`), но типу это надо сказать: ветка вопросов без
    // единого вопроса — это ветка карточки, и тип тела § 5.1 такого не допускает (ревью К4 № 2).
    const [first, ...rest] = questions;
    if (first === undefined) throw new Error("intent: ветка вопросов без вопросов");
    return {
      kind: "questions",
      draft_id: draftId,
      questions: [first, ...rest],
      show: { lang: deps.lang, texts: deps.texts },
    };
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
  const lines = linesFor(draft, {
    lang: deps.lang,
    texts: deps.texts,
    money: deps.money,
    timeZone: deps.timeZone,
  });

  const card: IntentCard = {
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
  };

  // Вместе с черновиком запоминается **показанное**: по нему К5 пересчитает хэш своей копией (правило 1). Этот же
  // объект уходит в исход — одна сборка на всех (З5).
  const shown: ShownPayload = { text_version: deps.texts.text_version, card };
  deps.store.put(draftId, { draft, shown });
  journal([]);

  // Карточка в исходе — **та же**, что запомнена в показанном: один объект, а не две сборки по одним данным, иначе
  // хэш и показанное разошлись бы при любой правке одной из них.
  return {
    kind: "card",
    draft_id: draftId,
    draft,
    card,
    questions: [],
    show: { lang: deps.lang, texts: deps.texts },
    shown,
  };
}
