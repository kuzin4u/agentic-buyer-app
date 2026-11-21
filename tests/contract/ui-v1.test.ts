// КТ-0, К2.4 (контракт К-Б; П30): контрактные тесты модуля `/ui/v1`.
// Четыре вещи, каждая — своим случаем:
//   1) деньги только парой: суммы без валюты тип не допускает;
//   2) перечень кодов `/ui` и их статусы совпадают с § 6 **документа** (источник — документ, не копия в STATUS);
//   3) правило идемпотентности: имя заголовка и формат ключа;
//   4) инвариант 1 — в типах контракта нет полей реквизитов, номера карты, криптограммы и `kid`.
import { readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { filesUnder } from "../support/imports.js";
import { ALLOWED_EXAMPLES, FORBIDDEN_EXAMPLES, hitsForbidden } from "../support/forbidden-fields.js";
import {
  IDEMPOTENCY_HEADER,
  isIdempotencyKey,
  isUiErrorCode,
  isUiSignedBy,
  UI_CONTRACT_VERSION,
  UI_ERROR_CODES,
  UI_ERROR_STATUS,
  UI_SIGNED_BY,
  UI_V1_BASE,
  type IntentCard,
  type IntentDraftResponse,
  type UiMoney,
  type UiRetryClass,
  type UiShown,
  type UiView,
} from "../../src/contract/ui-v1/index.js";
import type { PrinciplesView } from "../../src/principles/model.js";

const CONTRACT_DOC = new URL("../../docs/reference/2026-11-18-kontrakt-K-B-ui-v1-v1.0.md", import.meta.url);
const doc = readFileSync(CONTRACT_DOC, "utf8");

/** Файлы модуля контракта: по их тексту проверяется инвариант 1 (п. 4) — типы в рантайме не существуют. */
const MODULE_FILES = ["common.ts", "errors.ts", "idempotency.ts", "methods.ts", "steps.ts", "index.ts"] as const;
const sources = MODULE_FILES.map((f) => ({ file: f, text: readFileSync(new URL(`../../src/contract/ui-v1/${f}`, import.meta.url), "utf8") }));

describe("К2.4 п. 1: деньги — только парой (§ 3 «Деньги», правило планов № 2)", () => {
  it("сумма с валютой — годится", () => {
    const m: UiMoney = { amount: 36800, currency: "RUB" };
    expect(m).toEqual({ amount: 36800, currency: "RUB" });
  });

  it("сумма без валюты типом не допускается", () => {
    // @ts-expect-error — число минимальных единиц без кода валюты это не сумма
    const bad: UiMoney = { amount: 36800 };
    expect(bad.amount).toBe(36800);
  });

  it("одно число вместо пары типом не допускается", () => {
    // @ts-expect-error — «36800» без валюты на границе `/ui/v1` не бывает ни в одном поле
    const bad: UiMoney = 36800;
    expect(bad).toBe(36800);
  });

  it("класс повтора `new_key` экрану не отдаётся (§ 3 «Ошибки»)", () => {
    const ok: UiRetryClass[] = ["never", "after_fix", "same_key", "after_human"];
    expect(ok).toHaveLength(4);
    // @ts-expect-error — смена ключа подписи агента принадлежит серверу, не экрану
    const bad: UiRetryClass = "new_key";
    expect(bad).toBe("new_key");
  });
});

/** Р-1666 (решение владельца 20.11, 17:07): в § 5.1 либо карточка с `view` и пустыми вопросами, либо вопросы без
 *  карточки и без `view`. Проверяется **компиляцией**, а не комментарием: тела собирает и сервер ИН-0 окна Б, и
 *  запрещённое тело должно ломать сборку (ревью К4 № 2). */
describe("Р-1666: тело § 5.1 — либо карточка, либо вопросы", () => {
  const card: IntentCard = {
    subject: "хлеб",
    limit: { amount: 100_000, currency: "RUB" },
    valid_to: "2026-11-27T09:00:00.000Z",
    merchants: { count: 1, labels: ["Масса Мадре (MER-7001)"] },
    confirmation_mode: "IMMEDIATE",
    // Знак валюты в фикстуре литералом не пишется (правило планов № 2; замечание повторного ревью К4 № 9): текст
    // строки здесь неважен — проверяется форма тела, — поэтому сумма названа парой, как в модели.
    lines: [{ code: "LIMIT", text: "Не больше 100000 RUB за всё поручение" }],
  };
  const view = { view_id: "vw_k4", text_version: "u1-card@1.0", hash: `sha256:${"a".repeat(64)}` };
  const submit = { enabled: true, label: "Сохранить поручение", why_disabled: null };
  const question = { id: "limit", text: "Сколько денег не больше?" };

  // Негодные тела собираются **отдельными** константами без аннотации, а `@ts-expect-error` стоит на одной строке
  // присваивания: директива перед многострочным литералом гасила бы любую ошибку внутри него, в том числе опечатку
  // в имени поля, и случай остался бы зелёным, проверяя не то правило (замечание повторного ревью К4 № 7).
  const cardWithQuestions = { draft_id: "drf_3", card, questions: [question], actions: { submit }, view };
  const cardWithoutView = { draft_id: "drf_4", card, questions: [], actions: { submit }, view: null };
  const viewWithoutCard = { draft_id: "drf_5", card: null, questions: [question], actions: { submit }, view };
  const questionsWithoutQuestions = { draft_id: "drf_6", card: null, questions: [], actions: { submit }, view: null };

  it("карточка с `view` и пустыми вопросами — годится", () => {
    const body: IntentDraftResponse = { draft_id: "drf_1", card, questions: [], actions: { submit }, view };
    expect(body.card).not.toBeNull();
  });

  it("вопросы без карточки и без `view` — годятся", () => {
    const body: IntentDraftResponse = {
      draft_id: "drf_2",
      card: null,
      questions: [question],
      actions: { submit: { enabled: false, label: "Сохранить поручение", why_disabled: "Ответьте на вопросы" } },
      view: null,
    };
    expect(body.view).toBeNull();
  });

  it("карточка вместе с непустыми вопросами типом не допускается", () => {
    // @ts-expect-error — есть карточка, значит вопросов не осталось (Р-1666)
    const body: IntentDraftResponse = cardWithQuestions;
    expect(body.draft_id).toBe("drf_3");
  });

  it("карточка без `view` типом не допускается: хэш считается только по полной карточке", () => {
    // @ts-expect-error — карточка подтверждается, значит у неё есть `view` с хэшем (правило 1)
    const body: IntentDraftResponse = cardWithoutView;
    expect(body.draft_id).toBe("drf_4");
  });

  it("`view` без карточки типом не допускается: хэш по пустому месту ничего не доказывает", () => {
    // @ts-expect-error — нет карточки, значит нет и показанного, по которому считается хэш
    const body: IntentDraftResponse = viewWithoutCard;
    expect(body.draft_id).toBe("drf_5");
  });

  it("ветка вопросов без единого вопроса типом не допускается — это ветка карточки", () => {
    // @ts-expect-error — пустой перечень вопросов означает собранную карточку, а её тут нет
    const body: IntentDraftResponse = questionsWithoutQuestions;
    expect(body.draft_id).toBe("drf_6");
  });

  /** Сторожок «документ ещё не знает этого правила» — **в этом же разделе**, о полях § 5.1, а не среди кодов § 6:
   *  там его при снятии после К-Б v1.1 искали бы не там (замечание повторного ревью К4 № 8). */
  it("в модуле два тела, а в документе v1.0 `card` и `view` ещё обязательны", () => {
    const methods = readFileSync(new URL("../../src/contract/ui-v1/methods.ts", import.meta.url), "utf8");
    const section = methods.slice(methods.indexOf("export type IntentDraftResponse"));
    const typeBody = section.slice(0, section.indexOf("\n\n"));
    expect(typeBody).toContain("card: IntentCard");
    expect(typeBody).toContain("questions: readonly []");
    expect(typeBody).toContain("card: null");
    expect(typeBody).toContain("view: null");
    expect(typeBody).toContain("questions: readonly [IntentQuestion, ...IntentQuestion[]]");
    // Якорь — **версия документа**, а не буквальный `"card": null`: v1.1 может описать правило прозой или через
    // `card?`, и ожидание по тексту примера осталось бы зелёным, не дав сигнала «пора снять строку» (ревью К4 № 5).
    expect(UI_CONTRACT_VERSION).toBe("1.0");
    expect(doc).toContain("версия 1.0 от 18.11.2026");
    // И, пока это v1.0: в § 5.1 полная карточка и `"questions": []`, а `null` у `card` и `view` не упомянут (слово
    // `null` в разделе есть — у `why_disabled`, это другое поле).
    const docSection = doc.slice(doc.indexOf("## 5.1 "), doc.indexOf("## 5.2 "));
    expect(docSection).not.toMatch(/"card"\s*:\s*null/);
    expect(docSection).not.toMatch(/"view"\s*:\s*null/);
    expect(docSection).toContain('"questions": []');
  });
});

describe("К2.4 п. 2: коды `/ui` совпадают с § 6 документа", () => {
  /** Строки таблицы § 6: `| `КОД` | 409 | когда |`. Перечень берётся из документа — источника, а не из копии. */
  const fromDoc = (() => {
    const section = doc.slice(doc.indexOf("# 6. Коды `/ui`"), doc.indexOf("# 7. Что работает"));
    const rows = [...section.matchAll(/^\|\s*`([A-Z0-9_]+)`\s*\|\s*(\d{3})\s*\|/gm)];
    return rows.map((m) => [m[1] as string, Number(m[2])] as const);
  })();

  /** Коды, добавленные решением владельца **до выхода К-Б v1.1**: в таблице § 6 документа v1.0 их нет, и сверять их
   *  с ним нечем. Таблицу v1.1 выпускает чат; после замены файла ожидание «в документе кода нет» станет красным —
   *  это и есть сигнал свести перечень к общей сверке и убрать отсюда строку (П32 дополнение 1). */
  const PENDING_V1_1 = [
    ["PRINCIPLES_ORDER_INVALID", 400],
    /** негодный ввод карточки поручения — решения владельца 20.11: Р-1650 (§ 5.2) и Р-1670 (тот же код для § 5.1) */
    ["INTENT_DRAFT_INVALID", 400],
    // `SESSION_REQUIRED` — решение владельца 20.11.2026 (Р-1665), кирпич К7 ИН-0: «вход истёк» своим кодом, иначе
    // человек видит «покупка не найдена» и пути войти заново у него нет.
    ["SESSION_REQUIRED", 401],
    // `MODEL_NOT_AVAILABLE` (Р-1675, кирпич К3 ИН-П1) — случай **иной**, чем два предыдущих, и это важно не путать:
    // в документе он **уже есть**, с К-Б v1.1 (§ 5.18 и § 6), и пометки `PENDING_V1_1` на самом типе нет. Строка
    // стоит здесь только потому, что в репозитории пока лежит файл **v1.0**: документ v1.2 вносит окно А кирпичом
    // К8б, своей копии окно Б не делает. С приходом файла ожидание «в документе кода нет» покраснеет — и это сигнал
    // убрать все три строки, что и делает кирпич **К7** (Р-1685: сверка идёт с § 5.17–§ 5.19, § 6 и правилом 1
    // вместо отдельного ожидания).
    ["MODEL_NOT_AVAILABLE", 409],
  ] as const;

  it("таблица § 6 прочитана — девять строк", () => {
    expect(fromDoc).toHaveLength(9);
  });

  it("перечень кодов и порядок — § 6 плюс решённое владельцем до К-Б v1.1", () => {
    expect(UI_ERROR_CODES).toEqual([...fromDoc.map(([code]) => code), ...PENDING_V1_1.map(([code]) => code)]);
  });

  it("HTTP-статус каждого кода — как в § 6", () => {
    for (const [code, status] of fromDoc) expect(UI_ERROR_STATUS[code as keyof typeof UI_ERROR_STATUS], code).toBe(status);
  });

  it("коды, решённые владельцем до К-Б v1.1, объявлены со своим статусом, и в документе v1.0 их ещё нет", () => {
    for (const [code, status] of PENDING_V1_1) {
      expect(isUiErrorCode(code), code).toBe(true);
      expect(UI_ERROR_STATUS[code], code).toBe(status);
      expect(doc, code).not.toContain(code);
    }
  });

  /** Поля § 5.14, добавленные тем же решением владельца (П32 доп. 1): строки-пояснения, признак включённости и
   *  запертый пункт. В документе v1.0 их нет; появятся с К-Б v1.1 — тогда ожидание «в документе поля нет» станет
   *  красным, и сверка сведётся к общей. */
  it("поля `notes`, `items[].on` и `locked_id` объявлены в модуле, а в документе v1.0 их ещё нет", () => {
    const methods = readFileSync(new URL("../../src/contract/ui-v1/methods.ts", import.meta.url), "utf8");
    const section = methods.slice(methods.indexOf("export interface PrinciplesResponse"));
    const body = section.slice(0, section.indexOf("\n}"));
    for (const field of ["notes", "readonly on", "locked_id"]) expect(body, field).toContain(field);
    const docSection = doc.slice(doc.indexOf("## 5.14"), doc.indexOf("## 5.15"));
    for (const field of ["notes", '"on"', "locked_id"]) expect(docSection, field).not.toContain(field);
  });

  /** Признак «кто нажал» (П26): перечень закрыт константой, потому что уходит в подписанную версию, журнал и акт.
   *  Третье значение `test` — решение владельца 19.11, 22:10: прогон должен быть отличим от нажатия в эмуляторе
   *  интерфейса, иначе в акте для НСПК «не человек» и «прогон» читаются одинаково. В § 5.14 документа v1.0 его нет —
   *  как и самого поля `by`; оба войдут с К-Б v1.1, и тогда ожидание «в документе значения нет» станет красным. */
  it("`by` — закрытый перечень из трёх значений, и `test` в документе v1.0 его ещё нет (К-Б v1.1)", () => {
    expect(UI_SIGNED_BY).toEqual(["human", "emulator", "test"]);
    expect(isUiSignedBy("test")).toBe(true);
    expect(isUiSignedBy("robot")).toBe(false);
    expect(isUiSignedBy("toString")).toBe(false);
    const docSection = doc.slice(doc.indexOf("## 5.14"), doc.indexOf("## 5.15"));
    for (const value of UI_SIGNED_BY) expect(docSection, value).not.toContain(`"${value}"`);
  });

  it("код вне перечня не опознаётся как код `/ui` (это код ядра)", () => {
    expect(isUiErrorCode("SHOWN_STALE")).toBe(true);
    expect(isUiErrorCode("LIMIT_EXCEEDED")).toBe(false);
    expect(isUiErrorCode("toString")).toBe(false);
  });

  it("путь и версия контракта — как в документе", () => {
    expect(UI_V1_BASE).toBe("/ui/v1");
    expect(UI_CONTRACT_VERSION).toBe("1.0");
    expect(doc).toContain("`/ui/v1`");
  });
});

describe("К2.4 п. 3: идемпотентность (§ 3, правило 2)", () => {
  it("имя заголовка — то же, что у ПАО, и названо в документе", () => {
    expect(IDEMPOTENCY_HEADER).toBe("Idempotency-Key");
    expect(doc).toContain("`Idempotency-Key`");
  });

  it("ключ — UUID v4", () => {
    expect(isIdempotencyKey("9f1c3b7e-5a24-4d8f-9b31-2c6f0ab4e7d5")).toBe(true);
    expect(isIdempotencyKey("9F1C3B7E-5A24-4D8F-9B31-2C6F0AB4E7D5")).toBe(true);
  });

  it("не UUID v4 — не ключ: версия 1, негодный вариант, короткая строка, пусто", () => {
    expect(isIdempotencyKey("9f1c3b7e-5a24-1d8f-9b31-2c6f0ab4e7d5")).toBe(false);
    expect(isIdempotencyKey("9f1c3b7e-5a24-4d8f-7b31-2c6f0ab4e7d5")).toBe(false);
    expect(isIdempotencyKey("9f1c3b7e5a244d8f9b312c6f0ab4e7d5")).toBe(false);
    expect(isIdempotencyKey("")).toBe(false);
  });
});

/** К8 (решение владельца 21.11.2026 — **Р-1682**): запись «что человек видел, когда подтверждал» — **одна форма** на
 *  приложение. Проверяется **компиляцией**: `UiShown` выводится из `UiView` (`Pick`), поэтому разойтись по полям
 *  пары они не могут, а второго объявления пары в `src/principles/` не осталось. */
describe("Р-1682: одна форма записи показанного", () => {
  it("`UiShown` — ровно пара «хэш + версия текстов», без `view_id`", () => {
    const shown: UiShown = { hash: `sha256:${"a".repeat(64)}`, text_version: "u1-card@1.0" };
    expect(Object.keys(shown).sort()).toEqual(["hash", "text_version"]);
    // @ts-expect-error — `view_id` нужен, чтобы **найти** свою копию показанного; в сохранённой записи искать нечего
    const withId: UiShown = { ...shown, view_id: "vw_1" };
    expect(withId.hash).toBe(shown.hash);
  });

  it("пара `UiShown` и пара в `UiView` не расходятся — сверка на компиляции в обе стороны", () => {
    const view: UiView = { view_id: "vw_1", hash: `sha256:${"b".repeat(64)}`, text_version: "u1-card@1.0" };
    // `UiView` годится везде, где ждут запись показанного: пара у него та же.
    const asShown: UiShown = view;
    expect(asShown.text_version).toBe(view.text_version);
    // А обратно — нет: у записи нет `view_id`, и это не «забыли поле», а разные роли.
    // @ts-expect-error — из записи показанного `UiView` не собрать: `view_id` взять негде
    const back: UiView = { hash: view.hash, text_version: view.text_version };
    expect(back.hash).toBe(view.hash);
  });

  /** Сама норма Р-1682 — «одна форма **на приложение**» — держится обходом `src/`, а не присваиваемостью: `Pick` от
   *  `UiView` присваиваем из `UiView` всегда, поэтому второе объявление той же пары компиляция не заметит (находка
   *  ревью К8 № 2). Приём тот же, что у К7: сверка **с источником**, а не формы с собой. */
  it("объявление пары «хэш + версия текстов» в `src/` одно — общая форма в контракте", () => {
    const common = readFileSync(new URL("../../src/contract/ui-v1/common.ts", import.meta.url), "utf8");
    expect(common).toMatch(/export type UiShown = Pick<UiView, "hash" \| "text_version">/);

    /** Объявление пары: тип или интерфейс, у которого рядом стоят `hash` и `text_version`. */
    const declaresPair = (text: string): boolean =>
      [...text.matchAll(/(?:export\s+)?(?:interface|type)\s+\w+\s*=?\s*\{[^}]*\}/g)].some(
        (m) => /\bhash\b/.test(m[0]) && /\btext_version\b/.test(m[0]),
      );

    const root = resolve(import.meta.dirname, "../..");
    const offenders = filesUnder(join(root, "src"))
      .filter((f) => declaresPair(readFileSync(f, "utf8")))
      .map((f) => relative(root, f))
      // `UiView` — **источник** формы: пара объявлена в нём, и `UiShown` берётся оттуда.
      .filter((f) => f !== "src/contract/ui-v1/common.ts")
      // Именованное исключение: `ConsentView` онбординга переводит окно Б кирпичом К7 ИН-П1 (Р-1682 п. 4). В `main`
      // этого каталога ещё нет — когда появится, строка снимается вместе с его кирпичом.
      .filter((f) => !f.startsWith("src/onboarding/"));
    expect(offenders).toEqual([]);
  });

  it("профиль принципов берёт общую форму: имя — псевдоним, объявления пары нет", () => {
    const model = readFileSync(new URL("../../src/principles/model.ts", import.meta.url), "utf8");
    expect(model).toMatch(/export type PrinciplesView = UiShown/);
    const shown: PrinciplesView = { hash: `sha256:${"c".repeat(64)}`, text_version: "principles@1.0" };
    const asUi: UiShown = shown;
    expect(asUi.text_version).toBe("principles@1.0");
  });
});

describe("К2.4 п. 4: инвариант 1 — реквизитов в типах контракта нет", () => {
  /** Запрещённые имена полей — один перечень на все тесты (`tests/support/forbidden-fields.ts`): реквизит, номер
   *  карты и его части, криптограмма, ключ подписи агента. Разрешены только идентификаторы (`order_id`, `mandate_id`,
   *  `instrument_token` — CLAUDE.md, инвариант 1). Своя копия жила здесь до ревью К2 (Б1). */

  /** Имена полей, объявленных в модуле: `readonly x: …` и `x: …` в интерфейсах и типах. */
  const declaredKeys = sources.flatMap(({ file, text }) =>
    [...text.matchAll(/^\s*(?:readonly\s+)?([a-z_][a-z0-9_]*)\??:/gim)].map((m) => ({ file, key: m[1] as string })),
  );

  it("поля в модуле объявлены — иначе проверка ничего не проверяет", () => {
    expect(declaredKeys.length).toBeGreaterThan(60);
  });

  it("ни одно объявленное поле не несёт реквизита, номера карты, криптограммы или `kid`", () => {
    for (const { file, key } of declaredKeys) expect(hitsForbidden(key), `${file}: ${key}`).toBe(false);
  });

  it("проверка ловит подделку: поле `card_number` было бы красным", () => {
    for (const bad of FORBIDDEN_EXAMPLES) expect(hitsForbidden(bad), bad).toBe(true);
  });

  it("разрешённые идентификаторы проверкой не задеты", () => {
    for (const ok of ALLOWED_EXAMPLES) expect(hitsForbidden(ok), ok).toBe(false);
  });

  it("документ контракта говорит то же: у экрана нет ключа агента, `kid`, криптограммы и номера карты", () => {
    expect(doc).toContain("У экрана нет ключа агента");
    expect(doc).toContain("инвариант 1");
  });
});
