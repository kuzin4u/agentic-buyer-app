// ИН-П2, кирпич К1 — **данные экрана П4** и текст ПЭП: `config/passkey.default.json`, парами ru/en (инвариант 7,
// правило планов № 3, приём К1.2 П-К1 и К1 Н-3). Постановка v1.1, решение **П37** с дополнением 1.
//
// **Что здесь лежит и чего здесь нет — по Р-1719 и Р-1696** (требование владельца 22.11.2026: в `config/` только то,
// чего нет у источника, остальное выводится):
//   — **тексты уровней подписи** (`simple`, `qualified`, `gov_id`) здесь **не лежат вовсе**: на П4 человек уровень не
//     выбирает (**Р-1715**), и показывать их негде. Перечень уровней живёт у ядра (**Р-1704**), своего нет;
//   — **коды переноса** (`IDEMPOTENCY_REQUIRED`, `IDEMPOTENCY_CONFLICT`, `PURCHASE_NOT_FOUND`, `SESSION_REQUIRED`)
//     здесь **не лежат**: их тексты — в словаре каркаса (`src/ui-server/lang.ts`, `error.*`), и второй копии не нужно;
//   — `SHOWN_STALE` лежит, и это **не копия**: код один на приложение (§ 6 контракта), а текст человеку у каждого
//     экрана свой — у знакомства «условия успели измениться», у принципов своё, здесь «карточка успела измениться».
//     Общий текст на все экраны сказал бы человеку не о том, что он видел;
//   — у ядра готовых текстов про подтверждение касанием, биометрию и ключ **нет** (сверено: ни в `DIAG`, ни в
//     доменных типах), поэтому выводить их неоткуда — они целиком приложения.
//
// **Латиницы в значениях нет** (Р-1684 и требование постановки): ни обозначений уровней, ни названия протокола, ни
// слова «пасскей» латиницей, ни кодов отказа. Человеку — «подтверждение касанием», «отпечаток или код телефона».
// Перечень кодов закрыт **на компиляции**, а сверку «файл ↔ код» в обе стороны держит **сам разбор**: нет текста у
// кода — ошибка, есть текст у неизвестного кода — тоже. Перечень-источник прибит литералом в своём тесте
// (`tests/signature/webauthn.test.ts`), и именно он ловит появление кода без текста (уточнено по находкам ревью К1
// № 4 и № 8: прежняя формулировка приписывала эту работу «своему ожиданию в тестах», которое было тождеством).
import { bilingual, obj, str, type Bilingual } from "../config-parse.js";
import { CHALLENGE_TTL_MS_MAX, CHALLENGE_TTL_MS_MIN, PASSKEY_REFUSAL_CODES, type PasskeyRefusalCode } from "./webauthn.js";

/** Ключи разделов файла — закрыты: лишний раздел это дефект данных, а не «на будущее». */
const CATALOG_KEYS = ["text_version", "challenge_ttl_ms", "screen", "pep", "errors"] as const;
// Номера шага пути (`n`) здесь **нет намеренно** (находка ревью К1 № 1): по постановке v1.1 шаг приходит числами
// `UiPathStep` **из канвы**, а новая канва П4 ещё не пришла — число, заведённое раньше источника, было бы литералом
// против Р-1511, и это уже разбиралось в Н-3 (обёртка `path` с числами из примеров откачена). Знаменатель `of` к
// тому же живёт в данных знакомства, и одна нумерация в двух файлах разъехалась бы молча. Шаг заводит **К5** вместе
// с канвой, одним местом с `of`.
const SCREEN_KEYS = ["title", "subtitle", "footer", "register_label", "touch_label"] as const;
const PEP_KEYS = ["text_version", "title", "text", "accept_label", "note"] as const;

/**
 * Код отказа, у которого **обязан быть текст** в данных экрана П4.
 *
 * Это все восемь кодов проверки пасскея (П37 п. 3 с дополнением 1) **плюс** `SHOWN_STALE` — он приходит человеку на
 * этом же экране, и без своего текста экран сказал бы о чужом. Перечень выводится из источника кодов
 * (`PASSKEY_REFUSAL_CODES`), а не переписывается: добавится девятый код — здесь покраснеет разбор, а не тест.
 */
export const PASSKEY_TEXT_CODES = [...PASSKEY_REFUSAL_CODES, "SHOWN_STALE"] as const;

export type PasskeyTextCode = PasskeyRefusalCode | "SHOWN_STALE";

export interface PasskeyScreenTexts {
  readonly title: Bilingual;
  readonly subtitle: Bilingual;
  readonly footer: Bilingual;
  readonly register_label: Bilingual;
  readonly touch_label: Bilingual;
}

/** Соглашение о ПЭП. **Версия текста — своя**, а не версия файла: юрист правит формулировку, не трогая экран, и в
 *  подписанную версию уходит именно версия формулировки (П37 п. 5). */
export interface PepTexts {
  readonly text_version: string;
  readonly title: Bilingual;
  readonly text: Bilingual;
  readonly accept_label: Bilingual;
  readonly note: Bilingual;
}

export interface PasskeyCatalog {
  readonly text_version: string;
  /** Срок вызова — **величиной данных** (П37 п. 3): правится без правки кода. Читать его будет сборка сервера
   *  (К4), передавая в `issueChallenge` зависимостью; связь «данные → проверка» показана тестом К1, в `src/` её
   *  сегодня нет — сказано как есть (находка ревью К1 № 7). */
  readonly challenge_ttl_ms: number;
  readonly screen: PasskeyScreenTexts;
  readonly pep: PepTexts;
  readonly errors: Readonly<Record<PasskeyTextCode, Bilingual>>;
}

/** Лишние ключи — ошибка данных: молча выброшенный раздел выглядит для того, кто его дописал, принятым. */
function onlyKeys(r: Record<string, unknown>, keys: readonly string[], where: string, what: string): void {
  for (const key of Object.keys(r)) if (!keys.includes(key)) throw new Error(`${where}.${key}: лишний ключ ${what}`);
}

function int(r: Record<string, unknown>, key: string, where: string, min: number, max: number): number {
  const v = r[key];
  if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max)
    throw new Error(`${where}.${key}: нужно целое от ${min} до ${max}`);
  return v;
}

/**
 * Разбор данных экрана П4.
 *
 * Перечень кодов сверяется **в обе стороны**: нет текста у кода — ошибка, есть текст у неизвестного кода — тоже
 * ошибка. Иначе данные и код расходились бы молча: отказ уходил бы человеку без объяснения (ровно то, о чём
 * требование владельца про восьмой код), а лишний текст жил бы годами, ничего не объясняя.
 */
export function parsePasskeyCatalog(raw: unknown): PasskeyCatalog {
  const r = obj(raw, "passkey");
  onlyKeys(r, CATALOG_KEYS, "passkey", "в данных экрана П4");
  const text_version = str(r, "text_version", "passkey");
  // Границы срока — **из одного места** (`CHALLENGE_TTL_MS_MIN`/`MAX` у владельца понятия «вызов»), а не свои: пока
  // они стояли здесь, у `issueChallenge` была своя, более слабая проверка того же (находка ревью К1 № 3).
  const challenge_ttl_ms = int(r, "challenge_ttl_ms", "passkey", CHALLENGE_TTL_MS_MIN, CHALLENGE_TTL_MS_MAX);

  const s = obj(r["screen"], "passkey.screen");
  onlyKeys(s, SCREEN_KEYS, "passkey.screen", "у экрана");
  const screen: PasskeyScreenTexts = {
    title: bilingual(s["title"], "passkey.screen.title", []),
    subtitle: bilingual(s["subtitle"], "passkey.screen.subtitle", []),
    footer: bilingual(s["footer"], "passkey.screen.footer", []),
    register_label: bilingual(s["register_label"], "passkey.screen.register_label", []),
    touch_label: bilingual(s["touch_label"], "passkey.screen.touch_label", []),
  };

  const p = obj(r["pep"], "passkey.pep");
  onlyKeys(p, PEP_KEYS, "passkey.pep", "у соглашения");
  const pep: PepTexts = {
    text_version: str(p, "text_version", "passkey.pep"),
    title: bilingual(p["title"], "passkey.pep.title", []),
    text: bilingual(p["text"], "passkey.pep.text", []),
    accept_label: bilingual(p["accept_label"], "passkey.pep.accept_label", []),
    note: bilingual(p["note"], "passkey.pep.note", []),
  };

  const rawErrors = obj(r["errors"], "passkey.errors");
  for (const key of Object.keys(rawErrors))
    if (!(PASSKEY_TEXT_CODES as readonly string[]).includes(key)) throw new Error(`passkey.errors.${key}: неизвестный код отказа`);
  const errors = {} as { -readonly [K in PasskeyTextCode]: Bilingual };
  for (const code of PASSKEY_TEXT_CODES) errors[code] = bilingual(rawErrors[code], `passkey.errors.${code}`, []);

  return { text_version, challenge_ttl_ms, screen, pep, errors: Object.freeze(errors) };
}
