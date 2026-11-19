// Правило 2 контракта К-Б «Идемпотентность каждого POST» — исполнение на сервере (ИН-0, К2).
//
// Форма ключа, имя заголовка и перечень исходов живут в КТ-0 (`src/contract/ui-v1/idempotency.ts`); здесь — память о
// прежних ответах, сравнение тел и **вывод ключа обращения ядра к ПАО из ключа экрана**.
//
// Почему вывод живёт здесь (развилка **Р-1644**, рекомендация чата 19.11): ключ экрана и ключ ядра разные, но повтор
// экрана обязан стать повтором к ПАО **тем же** ключом (§ 3, правило 2). Если вывод завести у каждого потребителя, у
// одного действия окажется два правила вывода, и повтор экрана превратится в новое обращение к Платформе — то есть во
// второе списание. Поэтому вывод один и общий: потребители (например, П-К4 окна А) принимают его зависимостью типа
// `Mutation` и своего вывода не заводят.
//
// Сравнение тел — по **канонизации ядра** (`showingHash` КТ-0, П30 доп. 1): тот же JSON с другим порядком ключей или
// иными пробелами это **то же** тело, а не конфликт. Своего правила канонизации в приложении нет и быть не должно.
import {
  isIdempotencyKey,
  showingHash,
  SHOWN_HASH_PREFIX,
  type IdempotencyKey,
  type IdempotencyOutcome,
} from "../contract/ui-v1/index.js";

/** Разделитель областей канонизации: один помощник считает хэш и для тела запроса, и для вывода ключа ядра, поэтому у
 *  каждого применения своя область — иначе хэш тела и хэш ключа могли бы совпасть при совпавших данных. */
const SCOPE_BODY = "ui-v1-idempotency-body@1";
const SCOPE_CORE_KEY = "ui-v1-core-key@1";

/** Что именно делалось этим ключом: метод, адрес и тело. Адрес и метод входят в отпечаток **обязательно** (находка
 *  ревью К2 № 4): у разных методов тела совпадают (§ 5.6 и § 5.10 — это `purchase_id` и провенанс), и без адреса второе
 *  действие под тем же ключом получило бы `replay` первого, то есть молча не выполнилось бы, а экран счёл бы его
 *  выполненным. */
export interface RequestShape {
  readonly method: string;
  readonly path: string;
  readonly body: unknown;
}

/** Отпечаток запроса: канонический JSON метода, адреса и тела; хэш — правилом ядра. Значение вне JSON (например
 *  `Infinity` из `1e999`) канонизатор не пропускает — он бросает, и вызывающий обязан обратить это в 400 на разборе, а
 *  не выпустить исключение наружу (находка ревью К2 № 2). */
export const bodyFingerprint = (r: RequestShape): string =>
  showingHash({ text_version: SCOPE_BODY, card: { method: r.method, path: r.path, body: r.body } });

/**
 * Вывод ключа обращения **ядра** к ПАО из ключа экрана (Р-1644).
 *
 * Зависимость этого вида потребители принимают **типом** `Mutation` и не выводят ключ сами: второй вывод того же ключа
 * это второе правило, а значит риск второго обращения к Платформе на повторе экрана.
 *
 * `action` — название изменяющего действия (`"cart"`, `"payment"`, `"revoke"`, …). Оно входит в вывод, потому что одно
 * нажатие человека может порождать **несколько** обращений ядра: без разделения по действию все они получили бы один
 * ключ, и ПАО отдал бы на второе обращение ответ первого.
 */
export type Mutation = (screenKey: IdempotencyKey, action: string) => IdempotencyKey;

/**
 * Детерминированный вывод: одинаковые (ключ экрана, действие) всегда дают один и тот же ключ ядра, разные — разный.
 *
 * Ключ **по форме** UUID v4 (его требует и проверяет ПАО), но он не случайный: 128 бит берутся из первых 32 знаков
 * хэша, знак версии ставится `4`, старшие биты варианта — `10` (знак `8|9|a|b`). Это названо здесь прямо, чтобы ключ
 * не читался как случайный: случайности в нём нет и быть не должно — на ней сломался бы повтор.
 */
export const coreKeyOf: Mutation = (screenKey, action) => {
  if (!isIdempotencyKey(screenKey)) throw new TypeError("вывод ключа ядра: ключ экрана не по форме UUID v4");
  const hex = showingHash({ text_version: SCOPE_CORE_KEY, card: { key: screenKey, action } }).slice(SHOWN_HASH_PREFIX.length);
  const h = hex.slice(0, 32);
  const variant = ((parseInt(h[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

/** Запомненный ответ на ключ: отпечаток запроса и то, что было отдано экрану — **вместе с типом содержимого** (находка
 *  ревью К2 № 7: без типа повтор отдавал бы `text/plain` под видом JSON, и экран падал бы на разборе). */
export interface Remembered {
  readonly fingerprint: string;
  readonly status: number;
  readonly type: string;
  readonly body: string;
  /** когда запомнили — для срока жизни ключа */
  readonly at: number;
}

/** Исход проверки повтора. При `replay` отдаётся **прежний** ответ и второго действия нет (правило 2). */
export type RepeatCheck =
  | { readonly outcome: "missing" }
  | { readonly outcome: "conflict" }
  | { readonly outcome: "fresh"; readonly key: IdempotencyKey; readonly fingerprint: string }
  | { readonly outcome: "replay"; readonly key: IdempotencyKey; readonly answer: Remembered };

/** Срок жизни ключа — сутки: столько же длится окно идемпотентности у ПАО, и ключ, живущий дольше окна ядра, обещал бы
 *  экрану защиту, которой за этим окном уже нет. */
const TTL_MS = 24 * 60 * 60 * 1000;

/** Предел числа ключей: память наполняется запросами извне, и без предела процесс рос бы по числу обращений (находка
 *  ревью К2 № 8). Вытесняется самый давний — у него и шанс повтора наименьший. */
const MAX_KEYS = 10_000;

/**
 * Память о выполненных действиях.
 *
 * Ключ памяти — **владелец и ключ экрана** вместе: ключи генерируют экраны разных людей, и UUID одного человека не
 * должен находить ответ другого (находка ревью К2 № 4). Владельца спрашивает общий слой до записи.
 *
 * В памяти процесса: на стенде сервер `/ui/v1` живёт столько же, сколько стенд (П2 п. 1–2), и перезапуск начинает
 * прогон заново. Вне стенда память переедет в хранилище — **строкой в STATUS «Открыто»**, а не молча: после перезапуска
 * повтор экрана перестал бы быть повтором.
 */
export class RepeatStore {
  private readonly answers = new Map<string, Remembered>();

  constructor(private readonly now: () => number = Date.now) {}

  private slot = (owner: string, key: IdempotencyKey): string => `${owner}\u0000${key}`;

  /** Ключ из заголовка; `null` — заголовка нет. Форма проверяется здесь: ключ не по форме это `IDEMPOTENCY_REQUIRED`,
   *  а не «повтор неизвестного ключа» (КТ-0, `idempotency.ts`). */
  check(rawKey: string | null | undefined, owner: string, r: RequestShape): RepeatCheck {
    if (typeof rawKey !== "string" || !isIdempotencyKey(rawKey)) return { outcome: "missing" };
    const fingerprint = bodyFingerprint(r);
    const slot = this.slot(owner, rawKey);
    const was = this.answers.get(slot);
    if (was !== undefined && this.now() - was.at > TTL_MS) {
      // Ключ за окном идемпотентности: он снова неизвестен, и повтор выполнит действие, а не получит прежний ответ.
      this.answers.delete(slot);
      return { outcome: "fresh", key: rawKey, fingerprint };
    }
    if (was === undefined) return { outcome: "fresh", key: rawKey, fingerprint };
    return was.fingerprint === fingerprint ? { outcome: "replay", key: rawKey, answer: was } : { outcome: "conflict" };
  }

  /** Запомнить отданный ответ. Вызывается **после** выполнения действия: упади сервер до записи — ключ останется
   *  неизвестным, и повтор экрана выполнит действие, а не получит пустой ответ. */
  remember(key: IdempotencyKey, owner: string, fingerprint: string, answer: { status: number; type: string; body: string }): void {
    if (this.answers.size >= MAX_KEYS) {
      const oldest = this.answers.keys().next();
      if (!oldest.done) this.answers.delete(oldest.value);
    }
    this.answers.set(this.slot(owner, key), { fingerprint, ...answer, at: this.now() });
  }

  /** Сколько ключей помнит — для проверок. */
  get size(): number {
    return this.answers.size;
  }
}

/** Перечень исходов КТ-0 и исходы проверки — одно и то же множество имён; расхождение поймал бы тип. */
export type { IdempotencyOutcome };
