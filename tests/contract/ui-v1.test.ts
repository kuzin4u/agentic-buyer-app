// КТ-0, К2.4 (контракт К-Б; П30): контрактные тесты модуля `/ui/v1`.
// Четыре вещи, каждая — своим случаем:
//   1) деньги только парой: суммы без валюты тип не допускает;
//   2) перечень кодов `/ui` и их статусы совпадают с § 6 **документа** (источник — документ, не копия в STATUS);
//   3) правило идемпотентности: имя заголовка и формат ключа;
//   4) инвариант 1 — в типах контракта нет полей реквизитов, номера карты, криптограммы и `kid`.
import { readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { contractDoc, CONTRACT_DOC, CONTRACT_VERSION } from "../support/contract-doc.js";
import { filesUnder } from "../support/imports.js";
import { ALLOWED_EXAMPLES, FORBIDDEN_EXAMPLES, hitsForbidden } from "../support/forbidden-fields.js";
import {
  IDEMPOTENCY_HEADER,
  isIdempotencyKey,
  isUiErrorCode,
  isUiSignedBy,
  UI_CONTRACT_VERSION,
  retryFor,
  UI_ERROR_CODES,
  UI_ERROR_STATUS,
  UI_RETRY,
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
// Прикладные таблицы классов повтора — проверяется, что они **срезы** общей, а не вторые копии (Р-1685).
import { RETRY_BY_CODE as INTENT_RETRY } from "../../src/intent/service.js";
import { RETRY_BY_CODE as PRINCIPLES_RETRY } from "../../src/principles/index.js";

// Действующая версия документа — **v1.5** (кирпич К-Б ИН-П2; прежде v1.3, кирпич К7 ИН-П1): v1.1…v1.4 остаются в
// репозитории для истории, и сверка идёт с версией наибольшего номера. v1.4 в коде не стояла — выпущена и отменена
// v1.5 в один день 22.11, поэтому переход сразу на v1.5. Прежние сторожки «в документе этого ещё нет» сняты: § 5.1
// с двумя телами, поля § 5.14, коды § 6 и класс повтора у каждого кода есть с v1.3 — это и закрыло расхождения
// № 24 и № 25.
// Путь к документу — **из одного места** (`tests/support/contract-doc.ts`): свой путь у каждого теста однажды уже
// отстал от действующей версии (находка ревью К7 № 8).
const doc = contractDoc();

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

  /** **Расхождение № 24 закрыто** (кирпич К7 ИН-П1): с документа v1.3 у § 5.1 **два тела**, как в модуле, поэтому
   *  сторожок «документ ещё не знает этого правила» снят, а на его место встала прямая сверка — обе ветки описаны и
   *  там, и там. Теперь расхождение не «названо», а нет его. */
  it("два тела § 5.1 — и в модуле, и в действующем документе", () => {
    const methods = readFileSync(new URL("../../src/contract/ui-v1/methods.ts", import.meta.url), "utf8");
    const section = methods.slice(methods.indexOf("export type IntentDraftResponse"));
    const typeBody = section.slice(0, section.indexOf("\n\n"));
    expect(typeBody).toContain("card: IntentCard");
    expect(typeBody).toContain("questions: readonly []");
    expect(typeBody).toContain("card: null");
    expect(typeBody).toContain("view: null");
    expect(typeBody).toContain("questions: readonly [IntentQuestion, ...IntentQuestion[]]");
    // Документ той же версии, по которой собран модуль: разойдись они — сверка шла бы с чужим документом. Номер
    // берётся у источника (`CONTRACT_VERSION`), а не литералом: литерал «1.3» стоял здесь третьим местом, которое
    // надо править на каждом выпуске, и само согласие трёх величин проверяет случай «путь и версия контракта» ниже.
    expect(UI_CONTRACT_VERSION).toBe(CONTRACT_VERSION);
    expect(doc).toContain(`версия ${CONTRACT_VERSION} от 22.11.2026`);
    // Обе ветки § 5.1 названы в документе: карточка с пустым перечнем вопросов и вопросы при `card: null`.
    const docSection = doc.slice(doc.indexOf("## 5.1 "), doc.indexOf("## 5.2 "));
    expect(docSection).toContain('"questions": []');
    expect(docSection).toMatch(/"card"\s*:\s*null/);
    expect(docSection).toMatch(/"view"\s*:\s*null/);
  });
});

describe("К2.4 п. 2: коды `/ui`, их статусы и классы повтора совпадают с § 6 документа", () => {
  /** Строки таблицы § 6: `| `КОД` | 409 | `класс` | источник | когда |`. Перечень берётся из документа —
   *  источника, а не из копии; с v1.3 в нём есть и **класс повтора** у каждого кода. */
  const fromDoc = (() => {
    const section = doc.slice(doc.indexOf("# 6. Коды `/ui`"), doc.indexOf("# 7. Что работает"));
    const rows = [...section.matchAll(/^\|\s*`([A-Z0-9_]+)`\s*\|\s*(\d{3})\s*\|\s*`([a-z_]+)`\s*\|([^|]*)\|/gm)];
    return rows.map((m) => [m[1] as string, Number(m[2]), m[3] as string, (m[4] as string).trim()] as const);
  })();

  it("таблица § 6 прочитана — четырнадцать строк с классом повтора", () => {
    expect(fromDoc).toHaveLength(14);
    // Класс из документа принадлежит перечню классов, а не «не пуст»: пустую строку регулярка вернуть и не могла,
    // так что прежняя проверка была тождественно зелёной (находка ревью К7 № 11). Теперь опечатка класса в
    // документе падает здесь — на чтении, — а не только на сверке с таблицей.
    for (const [code, , retry] of fromDoc)
      expect(["never", "after_fix", "same_key", "after_human"], code).toContain(retry);
  });

  it("перечень кодов совпадает с § 6 **в обе стороны**", () => {
    // Строго, без списка исключений: в модуле нет кода, которого нет в документе, и наоборот. Прежние три строки
    // «решено владельцем, но документ ещё не знает» сняты — с v1.3 знает.
    expect([...UI_ERROR_CODES].sort()).toEqual([...fromDoc.map(([code]) => code)].sort());
  });

  it("HTTP-статус каждого кода — как в § 6", () => {
    for (const [code, status] of fromDoc) expect(UI_ERROR_STATUS[code as keyof typeof UI_ERROR_STATUS], code).toBe(status);
  });

  it("класс повтора каждого кода — как в § 6, и таблица в приложении одна", () => {
    // Главное ожидание кирпича К7: источник класса повтора — **документ**, а не комментарий у значения. Разойдись
    // таблица с § 6 хоть в одной строке — здесь покраснеет. Ровно это расхождение (`SHOWN_STALE`,
    // `IDEMPOTENCY_CONFLICT`) и нашлось на разборе: документ правился до v1.3, код остался.
    for (const [code, , retry] of fromDoc) expect(UI_RETRY[code as keyof typeof UI_RETRY], code).toBe(retry);
    expect(Object.keys(UI_RETRY).sort()).toEqual([...UI_ERROR_CODES].sort());
  });

  it("у каждого класса в § 6 назван источник, и он же стоит у значения в коде", () => {
    // Источник — обоснование значения, и без него строка таблицы это «так решили когда-то». Прежде столбец не
    // сверялся ни с чем (находка ревью К7 № 14): сверяется **ключевое слово** источника, а не фраза целиком —
    // проза в документе правится, а ссылка на решение или на ПАО нет.
    const errors = readFileSync(new URL("../../src/contract/ui-v1/errors.ts", import.meta.url), "utf8");
    const table = errors.slice(errors.indexOf("export const UI_RETRY"), errors.indexOf("Object.freeze(UI_RETRY)"));
    for (const [code, , , source] of fromDoc) {
      expect(source, `${code}: источник в § 6 не назван`).not.toBe("");
      // Ключи ссылки: номер решения (`Р-1677`, `П32`), `ПАО`, `ядр` или датированное «решение владельца 18.11».
      // Требуется, чтобы **хотя бы один** ключ из документа стоял и рядом со значением в коде: так сверяется
      // ссылка, а не проза, которую в документе правят.
      const keys = [...source.matchAll(/(Р-\d{4}|П\d{2}|ПАО|ядр|решение владельца \d{2}\.\d{2})/g)].map((m) => m[1]!);
      expect(keys, `${code}: в источнике «${source}» нет ссылки на решение, ПАО или ядро`).not.toEqual([]);
      const row = table.slice(0, table.indexOf(`${code}:`));
      const comment = row.slice(row.lastIndexOf("/**"));
      expect(
        keys.some((k) => comment.includes(k)),
        `${code}: у значения в коде нет ни одной ссылки из источника § 6 (${keys.join(", ")})`,
      ).toBe(true);
    }
  });

  it("срез таблицы отдаёт те же значения, что общая, и только запрошенные коды", () => {
    const slice = retryFor(["SHOWN_STALE", "IDEMPOTENCY_CONFLICT"]);
    expect(slice).toEqual({ SHOWN_STALE: UI_RETRY.SHOWN_STALE, IDEMPOTENCY_CONFLICT: UI_RETRY.IDEMPOTENCY_CONFLICT });
    // Срез заморожен: прикладной модуль не может поправить класс у себя и разойтись с документом.
    expect(Object.isFrozen(slice)).toBe(true);
  });

  it("прикладные таблицы — срезы общей, своих значений у них нет", () => {
    // Норма одна на приложение (Р-1685). Перечень кодов у метода свой — это его норма; значения сверяются с общей.
    for (const [code, retry] of Object.entries(INTENT_RETRY)) expect(retry, `поручение ${code}`).toBe(UI_RETRY[code as keyof typeof UI_RETRY]);
    for (const [code, retry] of Object.entries(PRINCIPLES_RETRY)) expect(retry, `принципы ${code}`).toBe(UI_RETRY[code as keyof typeof UI_RETRY]);
  });

  it("поля `notes`, `items[].on` и `locked_id` есть и в модуле, и в § 5.14 действующего документа", () => {
    const methods = readFileSync(new URL("../../src/contract/ui-v1/methods.ts", import.meta.url), "utf8");
    const section = methods.slice(methods.indexOf("export interface PrinciplesResponse"));
    const body = section.slice(0, section.indexOf("\n}"));
    for (const field of ["notes", "readonly on", "locked_id"]) expect(body, field).toContain(field);
    const docSection = doc.slice(doc.indexOf("## 5.14"), doc.indexOf("## 5.15"));
    for (const field of ["notes", "locked_id"]) expect(docSection, field).toContain(field);
  });

  /** Признак «кто нажал» (П26): перечень закрыт константой, потому что уходит в подписанную версию, журнал и акт.
   *  Третье значение `test` — решение владельца 19.11, 22:10: прогон должен быть отличим от нажатия в эмуляторе
   *  интерфейса, иначе в акте для НСПК «не человек» и «прогон» читаются одинаково. С v1.3 поле `by` и все три
   *  значения в § 5.14 документа есть, и сверка идёт напрямую. */
  it("`by` — закрытый перечень из трёх значений, и все три названы в § 5.14 действующего документа", () => {
    expect(UI_SIGNED_BY).toEqual(["human", "emulator", "test"]);
    expect(isUiSignedBy("test")).toBe(true);
    expect(isUiSignedBy("robot")).toBe(false);
    expect(isUiSignedBy("toString")).toBe(false);
    const docSection = doc.slice(doc.indexOf("## 5.14"), doc.indexOf("## 5.15"));
    for (const value of UI_SIGNED_BY) expect(docSection, value).toContain(value);
  });

  it("код вне перечня не опознаётся как код `/ui` (это код ядра)", () => {
    expect(isUiErrorCode("SHOWN_STALE")).toBe(true);
    expect(isUiErrorCode("LIMIT_EXCEEDED")).toBe(false);
    expect(isUiErrorCode("toString")).toBe(false);
  });

  it("путь и версия контракта — как в документе, и версия согласована с путём к файлу", () => {
    expect(UI_V1_BASE).toBe("/ui/v1");
    expect(doc).toContain("`/ui/v1`");
    // Три величины сверяются **между собой**: номер в модуле, номер у пути к действующему файлу и номер, названный
    // внутри самого документа. Поправь одно, забудь другое — покраснеет здесь; это и делает выпуск новой версии
    // контракта согласованным, а не «правкой в одном месте из трёх».
    expect(UI_CONTRACT_VERSION).toBe(CONTRACT_VERSION);
    expect(doc).toContain(`версия ${CONTRACT_VERSION} от`);
    // И **имя файла** — тоже: прежде комментарий обещал сверку «номера у пути к действующему файлу», а связка держалась
    // только на строке внутри документа (находка ревью К-Б № 10). Укажи путь на файл прежней версии с правильной
    // строкой внутри — тест бы молчал.
    expect(CONTRACT_DOC.pathname).toContain(`-v${CONTRACT_VERSION}.md`);
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
      .filter((f) => f !== "src/contract/ui-v1/common.ts");
    // Исключение для `src/onboarding/` **снято**: кирпич К7 перевёл `ConsentView` на `UiShown` (Р-1682 п. 4), и
    // каталог больше не выведен из-под сторожки. Пока фильтр стоял, он молчал бы и о **новой** копии пары — её
    // завёл бы кирпич К4 в том же каталоге, и никто бы не узнал (находка ревью К7 № 6).
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
