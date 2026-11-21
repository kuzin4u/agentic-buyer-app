// ИН-П1, кирпич К2 — запись согласия (решение П34 п. 3 и п. 4; приём П32).
//
// Что держит этот тест: версия неизменяема **во всех слоях**, номер растёт, согласие принадлежит человеку, журнал
// пишется последним и ровно один раз, провенанс и признак «кто нажал» попадают в версию как есть, а реквизитов в
// записи нет. Ожидания — числами и готовыми объектами, а не повторным вызовом того же кода.
import { describe, expect, it } from "vitest";
import type { UiPress } from "../../src/contract/ui-v1/index.js";
import {
  allRequiredAccepted,
  createConsentStore,
  FIRST_CONSENT_NO,
  nextConsentVersion,
  recordConsent,
  type ConsentAcceptedEntry,
  type ConsentJournal,
} from "../../src/onboarding/consent.js";

// Версии текстов у карточки и у провенанса — **разные значения** (находка ревью К2 № 2 и правило «в фикстуре разные
// сущности — разные значения»): при равных величинах подмена одной другой в коде невидима. Равенство этих величин —
// проверка кирпича К4 (правило 1: подтверждал ли человек те тексты, что сервер считает показанными), и здесь их как
// раз нужно развести, чтобы было видно, какая куда попала.
const PRESS: UiPress = { at: "2026-11-20T18:40:00Z", device: "mobile", text_version: "press-texts@3.7", gesture: "tap" };
const VIEW = { hash: `sha256:${"a".repeat(64)}`, text_version: "view-texts@1.2" } as const;

/** Журнал-записник: собирает строки, чтобы можно было проверить **порядок** и число записей. */
function journal(): ConsentJournal & { readonly written: ConsentAcceptedEntry[] } {
  const written: ConsentAcceptedEntry[] = [];
  return { written, write: (entry) => void written.push(entry) };
}

const deps = (j: ConsentJournal, store = createConsentStore(), by: "human" | "test" = "human") => ({
  store,
  journal: j,
  now: () => "2026-11-20T18:40:01Z",
  by: () => by,
});

const body = (owner = "own_1", model: "M1" | "M2" = "M1") =>
  ({ owner, model, accepted: ["TERMS", "DATA"] as const, view: VIEW, press: PRESS }) as const;

describe("версия согласия неизменяема", () => {
  it("первая версия — номер один", () => {
    const v = nextConsentVersion(null, { ...body(), by: "human", received_at: "2026-11-20T18:40:01Z" });
    expect(v.no).toBe(1);
    expect(FIRST_CONSENT_NO).toBe(1);
  });

  it("следующая версия не трогает прежнюю, номер растёт на единицу", () => {
    const first = nextConsentVersion(null, { ...body(), by: "human", received_at: "2026-11-20T18:40:01Z" });
    const second = nextConsentVersion(first, { ...body("own_1", "M2"), by: "human", received_at: "2026-11-20T18:41:00Z" });
    expect(second.no).toBe(2);
    // Прежняя осталась как была — ни номер, ни модель не поехали.
    expect(first.no).toBe(1);
    expect(first.model).toBe("M1");
  });

  it("в версии стоит версия текстов карточки, а не провенанса", () => {
    const v = nextConsentVersion(null, { ...body(), by: "human", received_at: "2026-11-20T18:40:01Z" });
    // Проверяется `view` целиком: прежде ни одно ожидание не читало `view.text_version`, и подмена её на
    // `press.text_version` оставалась зелёной (находка ревью К2 № 2). П34 п. 3 требует версию текста в версии.
    expect(v.view).toEqual({ hash: `sha256:${"a".repeat(64)}`, text_version: "view-texts@1.2" });
    expect(v.press.text_version).toBe("press-texts@3.7");
  });

  it("номер версии не считается по чужой истории", () => {
    const first = nextConsentVersion(null, { ...body("own_1"), by: "human", received_at: "2026-11-20T18:40:01Z" });
    // Правило номера держит сама функция (находка ревью К2 № 1): иначе первое согласие второго человека получило бы
    // номер 2 по истории первого.
    expect(() =>
      nextConsentVersion(first, { ...body("own_2"), by: "human", received_at: "2026-11-20T18:41:00Z" }),
    ).toThrow(/прежняя версия принадлежит own_1, а новая — own_2/);
  });

  it("заморожены все слои, а не только верхний", () => {
    const v = nextConsentVersion(null, { ...body(), by: "human", received_at: "2026-11-20T18:40:01Z" });
    // Задним числом нельзя поправить ни хэш показанного (правило 1), ни провенанс (П26), ни перечень пунктов — на
    // этом держится «версию нельзя изменить». Ровно такую дыру нашло ревью К1.2 в П-К1.
    expect(Object.isFrozen(v)).toBe(true);
    expect(Object.isFrozen(v.view)).toBe(true);
    expect(Object.isFrozen(v.press)).toBe(true);
    expect(Object.isFrozen(v.accepted)).toBe(true);
    expect(() => {
      (v.view as { hash: string }).hash = "sha256:подмена";
    }).toThrow(TypeError);
    expect(v.view.hash).toBe(VIEW.hash);
  });

  it("перечень пунктов копируется, а не вставляется ссылкой", () => {
    const accepted: ("TERMS" | "DATA")[] = ["TERMS", "DATA"];
    const v = nextConsentVersion(null, { ...body(), accepted, by: "human", received_at: "2026-11-20T18:40:01Z" });
    accepted.pop();
    // Правка перечня **после** подписи до версии не доходит: иначе в споре показалось бы согласие на один пункт
    // вместо двух.
    expect(v.accepted).toEqual(["TERMS", "DATA"]);
  });

  it("карточка и провенанс копируются, а тело запроса не замораживается", () => {
    // Свежие **изменяемые** объекты, а не общие на файл (находка ревью К2 № 6): при `view: Object.freeze(built.view)`
    // код морозил бы объект вызывающего — побочное действие на тело запроса, — и все прежние проверки оставались
    // зелёными, потому что общие `VIEW` и `PRESS` он замораживал один раз на весь файл.
    // Изменяемый тип нарочно: проверяется, что код **не** замораживает объект вызывающего.
    const press = { at: "2026-11-20T19:00:00Z", device: "web", text_version: "press-texts@9.9", gesture: "swipe" } as {
      at: string;
      device: UiPress["device"];
      text_version: string;
      gesture: UiPress["gesture"];
    };
    const view = { hash: `sha256:${"b".repeat(64)}`, text_version: "view-texts@9.9" };
    const v = nextConsentVersion(null, { ...body(), view, press, by: "human", received_at: "2026-11-20T19:00:01Z" });
    expect(v.press).not.toBe(press);
    expect(v.view).not.toBe(view);
    expect(Object.isFrozen(press)).toBe(false);
    expect(Object.isFrozen(view)).toBe(false);
    // Правка исходных объектов после подписи до версии не доходит.
    press.device = "max";
    view.hash = "sha256:подмена";
    expect(v.press.device).toBe("web");
    expect(v.view.hash).toBe(`sha256:${"b".repeat(64)}`);
  });

  it("время устройства остаётся своим, время сервера не подменяет его (П26)", () => {
    const v = nextConsentVersion(null, { ...body(), by: "human", received_at: "2026-11-20T18:40:01Z" });
    expect(v.press.at).toBe("2026-11-20T18:40:00Z");
    expect(v.received_at).toBe("2026-11-20T18:40:01Z");
  });
});

describe("согласие принадлежит человеку (П34 п. 4)", () => {
  it("согласие одного человека не видно другому", () => {
    const store = createConsentStore();
    const j = journal();
    recordConsent(deps(j, store), body("own_1"));
    expect(store.last("own_1")?.no).toBe(1);
    // Ключ по владельцу: без него второй человек увидел бы чужое согласие как своё.
    expect(store.last("own_2")).toBeNull();
    expect(store.all("own_2")).toEqual([]);
  });

  it("номер версии считается по своему человеку, а не по общему списку", () => {
    const store = createConsentStore();
    const j = journal();
    recordConsent(deps(j, store), body("own_1"));
    recordConsent(deps(j, store), body("own_1", "M2"));
    const other = recordConsent(deps(j, store), body("own_2"));
    // У второго человека это **первое** согласие, хотя в хранилище уже три записи.
    expect(other.no).toBe(1);
    expect(store.all("own_1").map((v) => v.no)).toEqual([1, 2]);
  });

  it("порт не умеет ни заменить, ни удалить версию", () => {
    const store = createConsentStore();
    expect(Object.keys(store).sort()).toEqual(["all", "append", "last"]);
    // Форма объекта сама по себе была бы зелёной и при `append`, который перезаписывает (находка ревью К2 № 5):
    // проверяется **поведение** — вторая версия добавляется, первая остаётся как была.
    const j = journal();
    const first = recordConsent(deps(j, store), body("own_9"));
    recordConsent(deps(j, store), body("own_9", "M2"));
    const all = store.all("own_9");
    expect(all.length).toBe(2);
    expect(all[0]).toBe(first);
    expect(all[0]!.model).toBe("M1");
    expect(all.map((v) => v.no)).toEqual([1, 2]);
  });

  it("перечень версий — копия: правка возвращённого списка хранилище не меняет", () => {
    const store = createConsentStore();
    recordConsent(deps(journal(), store), body("own_1"));
    const all = store.all("own_1") as unknown[];
    all.pop();
    expect(store.all("own_1").length).toBe(1);
  });
});

describe("журнал пишется последним и ровно один раз", () => {
  it("запись журнала появляется после записи версии", () => {
    const store = createConsentStore();
    const order: string[] = [];
    const watched = {
      ...store,
      append: (v: Parameters<typeof store.append>[0]) => {
        order.push("store");
        store.append(v);
      },
    };
    const j: ConsentJournal = { write: () => void order.push("journal") };
    recordConsent({ store: watched, journal: j, now: () => "2026-11-20T18:40:01Z", by: () => "human" }, body());
    // Строка журнала о согласии, которого в хранилище нет, — это ложное доказательство: журнал читают как
    // доказательство, и порядок здесь часть правильности, а не вкус.
    expect(order).toEqual(["store", "journal"]);
  });

  it("одно согласие — одна запись журнала", () => {
    const j = journal();
    recordConsent(deps(j), body());
    expect(j.written.length).toBe(1);
    expect(j.written[0]!.event).toBe("consent.accepted");
    expect(j.written[0]!.version).toBe(1);
  });

  it("в записи журнала — модель, пункты, хэш и провенанс, и ни одного реквизита", () => {
    const j = journal();
    recordConsent(deps(j), body("own_7", "M2"));
    expect(j.written[0]).toEqual({
      event: "consent.accepted",
      version: 1,
      owner: "own_7",
      model: "M2",
      accepted: ["TERMS", "DATA"],
      hash: VIEW.hash,
      press: PRESS,
      by: "human",
      received_at: "2026-11-20T18:40:01Z",
    });
  });
});

describe("признак «кто нажал» — от сервера (П26 доп. 2)", () => {
  it("признак попадает и в версию, и в журнал", () => {
    const j = journal();
    const v = recordConsent(deps(j, createConsentStore(), "test"), body());
    expect(v.by).toBe("test");
    expect(j.written[0]!.by).toBe("test");
  });

  it("признак из тела запроса не берётся, даже когда он там есть", () => {
    // Прежняя проверка была тавтологией о своей же фикстуре — «в `body()` нет поля `by`» (находка ревью К2 № 3):
    // код, переписанный на `(body as { by? }).by ?? deps.by()`, остался бы зелёным. Теперь поле в теле **есть**, и
    // оно противоречит зависимости: сервер ставит `test`, тело говорит `human`.
    const j = journal();
    const withClaim = { ...body(), by: "human" } as unknown as Parameters<typeof recordConsent>[1];
    const v = recordConsent(deps(j, createConsentStore(), "test"), withClaim);
    expect(v.by).toBe("test");
    expect(j.written[0]!.by).toBe("test");
  });
});

describe("все обязательные пункты", () => {
  it("оба пункта — да; любого не хватает — нет", () => {
    expect(allRequiredAccepted(["TERMS", "DATA"])).toBe(true);
    expect(allRequiredAccepted(["DATA", "TERMS"])).toBe(true);
    expect(allRequiredAccepted(["TERMS"])).toBe(false);
    expect(allRequiredAccepted(["DATA"])).toBe(false);
    expect(allRequiredAccepted([])).toBe(false);
  });

  it("запись согласия без всех обязательных пунктов — исключение, а не тихая запись", () => {
    const j = journal();
    const store = createConsentStore();
    expect(() => recordConsent(deps(j, store), { ...body(), accepted: ["TERMS"] })).toThrow(
      /отмечены не все обязательные пункты/,
    );
    // Ни версии, ни строки журнала не появилось: пропущенная проверка формы не должна оставить следа.
    expect(store.last("own_1")).toBeNull();
    expect(j.written).toEqual([]);
  });
});
