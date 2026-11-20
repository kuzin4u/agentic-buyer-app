// П-К4, К3 — строки-пояснения карточки поручения (`card.lines`, § 5.1) и тексты уточняющих вопросов: **данными** в
// `config/intent.default.json`, на двух языках, с первого коммита экрана (правило планов № 3, инвариант 7).
//
// Приём тот же, что у текстов ошибок К1.5 П-К1: перечень кодов закрыт **на компиляции**, а не на словах. Перечень
// кодов строк живёт здесь (`LINE_CODES`), перечень кодов вопросов — у модели (`DRAFT_KEYS`, § 5.1), и разбор файла
// требует, чтобы в нём были **ровно** эти ключи: пропал код — ошибка разбора, появился лишний — тоже. Расхождение
// перечня в коде и в файле ловится сборкой (`satisfies`) и тестом сверки, а не ревью.
//
// Подстановки в строках закрыты так же: у каждого кода назван перечень допустимых подстановок, и разбор отвергает
// строку с чужой или пропущенной подстановкой. Иначе `{limit}`, забытый в английской строке, доехал бы до экрана
// пустым местом вместо суммы.
import { obj, str } from "../config-parse.js";
import type { UiLang, UiMoney } from "../contract/ui-v1/common.js";
import type { IntentCard } from "../contract/ui-v1/methods.js";
import { formatInstant } from "../format.js";
import { DRAFT_KEYS, type DraftField, type IntentDraft } from "./model.js";

/** Коды строк-пояснений карточки. Перечень **закрытый**: строка без кода из него на карточку не попадёт.
 *  Режим подтверждения — два кода, по одному на значение `ConfirmationMode`: текст у них разный целиком, а не
 *  подстановкой, и «подтверждаете вы» / «без подтверждения» человеку надо прочитать словами. */
export const LINE_CODES = [
  "SUBJECT",
  "LIMIT",
  "VALID_TO",
  "MERCHANTS",
  "CONFIRMATION_IMMEDIATE",
  "CONFIRMATION_AUTONOMOUS",
] as const;

export type LineCode = (typeof LINE_CODES)[number];

/** Допустимые подстановки у каждого кода. Пустой перечень — строка без подстановок. */
export const LINE_SLOTS = {
  SUBJECT: ["subject"],
  LIMIT: ["limit"],
  VALID_TO: ["valid_to"],
  MERCHANTS: ["count"],
  CONFIRMATION_IMMEDIATE: [],
  CONFIRMATION_AUTONOMOUS: [],
} as const satisfies Record<LineCode, readonly string[]>;

/** Перечень кодов в `LINE_SLOTS` — ровно `LINE_CODES`: иначе новый код остался бы без правила подстановок. */
type SlotsCoverCodes = keyof typeof LINE_SLOTS extends LineCode
  ? LineCode extends keyof typeof LINE_SLOTS
    ? true
    : never
  : never;
const _slotsCoverCodes: SlotsCoverCodes = true;
void _slotsCoverCodes;

export type Bilingual = Readonly<Record<UiLang, string>>;

/** Тексты действия «Сохранить поручение» (§ 5.1, `actions.submit`): подпись кнопки и объяснение, почему она сейчас
 *  недоступна. Перечень закрытый — недоступное объясняется текстом, а не молчанием (К4), и текст не берётся по месту. */
export const ACTION_TEXT_KEYS = ["submit_label", "submit_blocked_by_questions"] as const;

export type ActionTextKey = (typeof ACTION_TEXT_KEYS)[number];

export interface IntentTexts {
  /** версия текстов карточки: входит в `view.text_version` и в хэш показанного (правило 1 К-Б) */
  readonly text_version: string;
  readonly lines: Readonly<Record<LineCode, Bilingual>>;
  readonly actions: Readonly<Record<ActionTextKey, Bilingual>>;
  readonly questions: Readonly<Record<DraftField, Bilingual>>;
}

const LANGS: readonly UiLang[] = ["ru", "en"];
const SLOT = /\{([a-z_]+)\}/g;

/** Пара ru/en с проверкой подстановок: у строк обоих языков перечень подстановок — ровно `slots`. */
function bilingual(raw: unknown, where: string, slots: readonly string[]): Bilingual {
  const r = obj(raw, where);
  for (const key of Object.keys(r)) if (!LANGS.includes(key as UiLang)) throw new Error(`${where}.${key}: лишний язык`);
  const out = {} as Record<UiLang, string>;
  for (const lang of LANGS) {
    const s = str(r, lang, where);
    const used = [...s.matchAll(SLOT)].map((m) => m[1] as string);
    for (const u of used) if (!slots.includes(u)) throw new Error(`${where}.${lang}: подстановка {${u}} здесь не бывает`);
    for (const need of slots) if (!used.includes(need)) throw new Error(`${where}.${lang}: нет подстановки {${need}}`);
    out[lang] = s;
  }
  return out;
}

/** Разбор `config/intent.default.json`. Ключи — ровно перечни кодов: ни пропуска, ни лишнего (Р-1511). */
export function parseIntentTexts(raw: unknown): IntentTexts {
  const r = obj(raw, "intent");
  for (const key of Object.keys(r))
    if (!["text_version", "lines", "actions", "questions"].includes(key))
      throw new Error(`intent.${key}: лишнее поле`);

  const rawLines = obj(r["lines"], "intent.lines");
  for (const key of Object.keys(rawLines))
    if (!(LINE_CODES as readonly string[]).includes(key)) throw new Error(`intent.lines.${key}: кода нет в перечне`);
  const lines = {} as Record<LineCode, Bilingual>;
  for (const code of LINE_CODES) lines[code] = bilingual(rawLines[code], `intent.lines.${code}`, LINE_SLOTS[code]);

  const rawActions = obj(r["actions"], "intent.actions");
  for (const key of Object.keys(rawActions))
    if (!(ACTION_TEXT_KEYS as readonly string[]).includes(key))
      throw new Error(`intent.actions.${key}: ключа нет в перечне`);
  const actions = {} as Record<ActionTextKey, Bilingual>;
  for (const key of ACTION_TEXT_KEYS) actions[key] = bilingual(rawActions[key], `intent.actions.${key}`, []);

  const rawQuestions = obj(r["questions"], "intent.questions");
  for (const key of Object.keys(rawQuestions))
    if (!(DRAFT_KEYS as readonly string[]).includes(key))
      throw new Error(`intent.questions.${key}: поля нет в § 5.1`);
  const questions = {} as Record<DraftField, Bilingual>;
  for (const field of DRAFT_KEYS)
    questions[field] = bilingual(rawQuestions[field], `intent.questions.${field}`, []);

  return { text_version: str(r, "text_version", "intent"), lines, actions, questions };
}

/** Показ суммы — **порт**, а не своя функция: она уже есть у окна Б (`formatUiMoney`, `src/ui-server/money.ts`, ИН-0
 *  К2) на общей таблице `src/iso4217.ts`. Вторая копия разошлась бы молча, и сумма ушла бы на карточку в 100–1000 раз
 *  больше (IQD: ISO 3, CLDR 0). Какая из двух останется общей — вопрос чату в PR #27; до ответа показ подаётся
 *  зависимостью, и своей копии в окне А нет. */
export type MoneyText = (m: UiMoney, lang: UiLang) => string;

/** Чем заполняются строки: язык запроса, тексты из `config/`, показ суммы портом и **названный пояс** для срока.
 *  Пояс назван, а не взят у процесса: срок печатается в текст, который входит в хэш показанного, и экран его не
 *  переформатирует — в чужом поясе человек прочитал бы на подписываемой карточке не тот срок (находка ревью К3 В4;
 *  у экрана банка стенда та же задача решена названным `time_zone`, П2 дополнение 6). */
export interface LinesDeps {
  readonly lang: UiLang;
  readonly texts: IntentTexts;
  readonly money: MoneyText;
  /** имя пояса IANA, например `Europe/Moscow`: пояс человека, а не пояс процесса сервера */
  readonly timeZone: string;
}

/** Значения подстановок карточки: сумма и срок — уже в виде текста на языке запроса (формат по валюте и языку,
 *  знак валюты литералом не пишется — правило планов № 2); число продавцов — из перечня **того же** черновика. */
function slotValues(draft: IntentDraft, deps: LinesDeps): Readonly<Record<string, string>> {
  return {
    subject: draft.subject,
    limit: deps.money(draft.limit, deps.lang),
    valid_to: formatInstant(draft.valid_to, deps.lang, deps.timeZone),
    // Число продавцов берётся у черновика, а не подаётся отдельно: поданное число разошлось бы с перечнем, и карточка
    // сказала бы «продавцов: 7» при поручении на двух (находка ревью К3 В2 — ровно то, против чего К1 ввёл
    // `MERCHANT_DUPLICATE`).
    count: String(draft.merchants.length),
  };
}

function fill(template: string, values: Readonly<Record<string, string>>, where: string): string {
  return template.replace(SLOT, (_, name: string) => {
    const v = values[name];
    // Умолчания у подстановки нет: пустое место на карточке — это условие поручения, которого человек не прочитал.
    if (v === undefined) throw new Error(`${where}: нечем заполнить {${name}}`);
    return v;
  });
}

/** Строка режима подтверждения — код по значению, а не текст по месту: перечень режимов закрыт ядром (П33 п. 1). */
const CONFIRMATION_LINE = {
  IMMEDIATE: "CONFIRMATION_IMMEDIATE",
  AUTONOMOUS: "CONFIRMATION_AUTONOMOUS",
} as const satisfies Record<IntentDraft["confirmation_mode"], LineCode>;

/** Коды режима подтверждения — значения `CONFIRMATION_LINE`: перечень выводится из него, а не пишется вторым
 *  списком. */
const MODE_CODES: readonly LineCode[] = Object.values(CONFIRMATION_LINE);

/** Строки, которые на карточке есть всегда, — **все остальные коды перечня**, в порядке `LINE_CODES` (порядок полей
 *  § 5.1). Так закрытый перечень не может молчать: код, заведённый в `LINE_CODES` и в `config/`, сам попадает на
 *  карточку, а не остаётся строкой, которую никто не показывает (находка ревью К3 В1; приём К1.5 —
 *  `parsePrinciplesCatalog` считает такую строку ошибкой формы). */
const ALWAYS_CODES: readonly LineCode[] = LINE_CODES.filter((code) => !MODE_CODES.includes(code));

/** Строки-пояснения карточки: что покупаем, предел, срок, продавцы — и строка режима подтверждения последней.
 *  Порядок — часть показанного: он входит в хэш (правило 1), поэтому задан перечнем, а не перебором ключей объекта.
 *  Код строки — из закрытого перечня (`LineCode`), а не `string`: опечатка не доедет до карточки (ревью К3 З3). */
export function linesFor(
  draft: IntentDraft,
  deps: LinesDeps,
): readonly { readonly code: LineCode; readonly text: string }[] {
  const values = slotValues(draft, deps);
  const codes: readonly LineCode[] = [...ALWAYS_CODES, CONFIRMATION_LINE[draft.confirmation_mode]];
  return codes.map((code) => ({
    code,
    text: fill(deps.texts.lines[code][deps.lang], values, `intent.lines.${code}.${deps.lang}`),
  })) satisfies IntentCard["lines"];
}

/** Тексты вопросов на языке запроса — в форме, которую ждёт порт `questionText` сборки карточки (К2). */
export const questionTextFor =
  (texts: IntentTexts, lang: UiLang) =>
  (code: DraftField): string =>
    texts.questions[code][lang];
