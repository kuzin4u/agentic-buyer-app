// П-К4, К1 — модель черновика поручения в пользовательском регистре и проверка его формы (К-Б § 5.1; решение П33).
// Черновик — это `MandateDraft` ядра словами человека: предмет, предел, срок, продавцы, режим подтверждения. Своей
// сущности не вводится, и перечень режимов берётся у ядра (П33 п. 1).
// Здесь только модель и форма. Карточку собирает К2, `view` и действие — К4, отправку на подпись — К5.
//
// **Что эта проверка не делает (инвариант 2, правило 3 К-Б).** Она не решает, укладывается ли поручение в пределы, не
// считает остаток и не судит, какая валюта допустима: допустимое множество валют заявляет адаптер платформы
// (`PlatformCapabilities.currencies` ядра), а реквизиты мандата по A7 п. 2.2 проверяет сам ядро — `missingTerms`
// (`agentic-buyer-ref/src/agent/mandates/client.ts`), и последнее слово остаётся за ним.
//
// **Зачем она тогда нужна.** За двумя вещами, которых у ядра нет, и за понятным отказом экрану:
//  1. **повторы в перечне продавцов** — ядро их пропускает (`merchantScope` только «непустой список непустых строк»), а
//     повтор означает, что человек видел на карточке «продавцов: 3», когда их два: карточка сказала бы ему неправду;
//  2. **лишнее поле** — поле, которого в § 5.1 нет, это негодное тело, а не «то же с примечанием» (тот же довод, что у
//     подписи принципов: находка ревью К1.3 № 4 П-К1);
//  3. **форма кода валюты** — ядро требует лишь непустую строку, а § 3 К-Б и правило планов № 2 требуют код ISO 4217;
//     строка «рубли» дошла бы до ПАО и вернулась отказом платформы вместо внятного «поправьте форму».
// Порядок проверок — **форма → значения**, как у подписи принципов: каждый отказ о своём.
// Совпадение с проверками ядра по сроку и пределу не случайно и не второе мнение: условие то же и названо здесь тем же,
// а тест сверяет наш отказ с `missingTerms` ядра — разойдутся условия, и он покраснеет.
import type { ConfirmationMode } from "agentic-buyer-ref/src/shared/domain.js";
import type { UiInstant, UiMoney } from "../contract/ui-v1/common.js";

/** Черновик поручения в пользовательском регистре: то, что человек правит до подписи.
 *  **Это не карточка `card` § 5.1.** Имена четырёх полей совпадают с её именами (`subject`, `limit`, `valid_to`,
 *  `confirmation_mode`) — пользовательский регистр один, — но `merchants` у черновика это **список** `merchant_id`, а
 *  у карточки объект `{ count, labels }`, и поля `lines` у черновика нет вовсе. Перевод черновика в форму карточки
 *  делает К2, строки-пояснения — К3, перевод в `MandateDraft` ядра — К5, и каждый в одном месте (находка ревью К1
 *  № 1: иначе К2 и К4 приняли бы черновик за форму карточки).
 *  Доменных имён ядра здесь нет: `amountLimit`, `merchantScope`, `principalRef` живут за переводом К5.
 *  Реквизитов здесь нет и быть не может (инвариант 1) — проверяется тестом по объявленным полям модуля. */
export interface IntentDraft {
  readonly subject: string;
  readonly limit: UiMoney;
  readonly valid_to: UiInstant;
  /** Продавцы поручения — `merchant_id` витрин. Карточка показывает их числом и подписями (§ 5.1), а здесь список. */
  readonly merchants: readonly string[];
  readonly confirmation_mode: ConfirmationMode;
}

/** Поля черновика — ровно те, что в § 5.1. Перечень живёт константой, а не только типом: тип в рантайме не
 *  существует, а лишнее поле надо назвать человеку по имени. */
export const DRAFT_KEYS = ["subject", "limit", "valid_to", "merchants", "confirmation_mode"] as const;

export type DraftField = (typeof DRAFT_KEYS)[number];

/** Поля суммы (§ 3 «Деньги»): пара «целое в минимальных единицах + код ISO 4217», третьего поля у суммы нет. */
const LIMIT_KEYS: readonly string[] = ["amount", "currency"];

/** Режимы подтверждения — перечень **ядра** (`ConfirmationMode`), в рантайме его там нет, поэтому константа здесь.
 *  Полнота держится компиляцией в обе стороны: добавит ядро третий режим — `ModesCoverCore` станет `never` и сборка
 *  покраснеет; появится у нас лишнее значение — его отвергнет `satisfies`. Своего режима приложение не придумывает. */
export const CONFIRMATION_MODES = ["IMMEDIATE", "AUTONOMOUS"] as const satisfies readonly ConfirmationMode[];

type ModesCoverCore = ConfirmationMode extends (typeof CONFIRMATION_MODES)[number] ? true : never;
const _modesCoverCore: ModesCoverCore = true;
void _modesCoverCore;

export const isConfirmationMode = (s: unknown): s is ConfirmationMode =>
  typeof s === "string" && (CONFIRMATION_MODES as readonly string[]).includes(s);

/** Код валюты по ISO 4217 — три заглавные латинские буквы (§ 3 «Деньги»; правило планов № 2). Проверяется **форма**, а
 *  не допустимость: какие валюты принимает платформа, заявляет её адаптер, и приложение этого не решает (инвариант 2). */
const ISO4217_ALPHA3 = /^[A-Z]{3}$/;

/** Негодный черновик. Причина остаётся **внутри** сервера: экрану уходит один код и готовый текст (как у подписи
 *  принципов — П32 дополнение 1), а причина нужна журналу и разбору. Код `/ui` для этого отказа вводит К5. */
export type DraftProblem =
  /** черновика нет вовсе или он не объект */
  | { readonly reason: "NOT_OBJECT" }
  /** поле, которого в § 5.1 нет — в черновике или внутри суммы */
  | { readonly reason: "UNKNOWN_FIELD"; readonly field: string }
  /** обязательного поля § 5.1 нет */
  | { readonly reason: "MISSING"; readonly field: DraftField }
  /** предмет — пустая строка или пробелы: человек не назвал, что покупаем */
  | { readonly reason: "SUBJECT_EMPTY" }
  /** предел не пара «сумма + валюта»: не объект, нет `amount`, сумма не число. Отдельно от `LIMIT_NOT_POSITIVE`,
   *  потому что человеку это разные вещи: «поправьте форму» и «предел должен быть больше нуля» (П33 п. 5; находка
   *  ревью К1 № 6) */
  | { readonly reason: "LIMIT_NOT_MONEY" }
  /** предел — число, но не целое в минимальных единицах или не больше нуля */
  | { readonly reason: "LIMIT_NOT_POSITIVE" }
  /** код валюты не по форме ISO 4217 */
  | { readonly reason: "CURRENCY_NOT_ISO" }
  /** срок — не время: строка, которую не разбирает `Date.parse`. Условие **то же, что у ядра** (`missingTerms` тоже
   *  на `Date.parse`), поэтому «2026» и «Nov 26 2026» проходят: ужесточение до строгого ISO 8601 развело бы
   *  приложение с ядром, и один и тот же срок был бы годен у одного и негоден у другого (находка ревью К1 № 5) */
  | { readonly reason: "VALID_TO_NOT_TIME" }
  /** срок не в будущем: поручение, истёкшее до подписи, подписывать нечего */
  | { readonly reason: "VALID_TO_PAST" }
  /** продавцы — не список строк */
  | { readonly reason: "MERCHANTS_NOT_LIST" }
  /** список продавцов пуст: у поручения нет получателей (то же условие, что у `merchantScope` ядра) */
  | { readonly reason: "MERCHANTS_EMPTY" }
  /** продавец назван дважды — карточка показала бы число продавцов больше настоящего */
  | { readonly reason: "MERCHANT_DUPLICATE"; readonly id: string }
  /** режим подтверждения вне перечня ядра */
  | { readonly reason: "MODE_UNKNOWN" };

export type DraftCheck = { readonly ok: true } | ({ readonly ok: false } & DraftProblem);

const isText = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";

/** Проверка формы черновика. `now` — время **сервера** (не из тела: время устройства живёт в провенансе, П26); если
 *  сервер подал не время, это ошибка сборки, а не отказ человеку, поэтому исключение, а не `DraftProblem`. */
export function checkDraft(draft: IntentDraft, now: UiInstant): DraftCheck {
  const at = Date.parse(now);
  if (!isText(now) || Number.isNaN(at)) throw new Error(`intent: сервер подал не время: ${String(now)}`);

  if (draft === undefined || draft === null || typeof draft !== "object") return { ok: false, reason: "NOT_OBJECT" };
  const raw = draft as unknown as Record<string, unknown>;
  for (const key of Object.keys(raw))
    if (!(DRAFT_KEYS as readonly string[]).includes(key)) return { ok: false, reason: "UNKNOWN_FIELD", field: key };
  for (const key of DRAFT_KEYS) if (raw[key] === undefined) return { ok: false, reason: "MISSING", field: key };

  if (!isText(draft.subject)) return { ok: false, reason: "SUBJECT_EMPTY" };

  const limit = draft.limit as unknown;
  if (limit === null || typeof limit !== "object") return { ok: false, reason: "LIMIT_NOT_MONEY" };
  for (const key of Object.keys(limit))
    if (!LIMIT_KEYS.includes(key)) return { ok: false, reason: "UNKNOWN_FIELD", field: key };
  const money = limit as Record<string, unknown>;
  // Сначала форма пары, потом величина: «поправьте форму суммы» и «предел должен быть больше нуля» — разные вещи для
  // человека, и К3 объясняет их разными строками.
  if (typeof money["amount"] !== "number") return { ok: false, reason: "LIMIT_NOT_MONEY" };
  // Предел — целое число минимальных единиц и больше нуля: дробное или нулевое поручение подписывать нечего. Границу
  // безопасного целого держим здесь, а не у ядра: за ней число уже не то, которое человек видел на карточке.
  if (!Number.isSafeInteger(money["amount"]) || money["amount"] < 1) return { ok: false, reason: "LIMIT_NOT_POSITIVE" };
  if (typeof money["currency"] !== "string" || !ISO4217_ALPHA3.test(money["currency"]))
    return { ok: false, reason: "CURRENCY_NOT_ISO" };

  const validTo = Date.parse(draft.valid_to as unknown as string);
  if (!isText(draft.valid_to) || Number.isNaN(validTo)) return { ok: false, reason: "VALID_TO_NOT_TIME" };
  // Строго больше: срок, совпавший с «сейчас», уже истёк — ровно так судит и ядро (`validTo <= now`).
  if (validTo <= at) return { ok: false, reason: "VALID_TO_PAST" };

  const merchants = draft.merchants as unknown;
  if (!Array.isArray(merchants) || !merchants.every(isText)) return { ok: false, reason: "MERCHANTS_NOT_LIST" };
  if (merchants.length === 0) return { ok: false, reason: "MERCHANTS_EMPTY" };
  const seen = new Set<string>();
  for (const id of merchants) {
    if (seen.has(id)) return { ok: false, reason: "MERCHANT_DUPLICATE", id };
    seen.add(id);
  }

  if (!isConfirmationMode(draft.confirmation_mode)) return { ok: false, reason: "MODE_UNKNOWN" };
  return { ok: true };
}
