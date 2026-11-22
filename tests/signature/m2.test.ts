// ИН-П2, кирпич К3 — механика подписи своего агента (М2): решение владельца 22.11.2026, **Р-1703**.
//
// Что держит этот тест, по правилу на случай:
//   — версия неизменяема **во всех слоях** и номер растёт по истории **своего** человека;
//   — подпись стоит над хэшем **ровно показанного**, а не над пересказом карточки;
//   — подтверждение годится только для своей покупки и своего хэша: сменилось показанное — человек подтверждает
//     заново (инвариант 3, «каждую оплату подтверждает человек»);
//   — законный повтор оплаты (правило 2 К-Б) находит **то же** подтверждение: оно не расходуется;
//   — «подтверждение есть» и «подтвердил человек» — разные утверждения, и второе спрашивается явно;
//   — журнал пишется последним, ровно один раз, и реквизитов с суммами в нём нет (инвариант 1);
//   — формулировки ПЭП в коде нет: в версии стоит версия текстов (Р-1703).
//
// Ожидания — числами, строками и готовыми объектами, а не повторным вызовом той же сборки.
import { describe, expect, it } from "vitest";
import { UI_SIGNED_BY, type UiPress, type UiShown, type UiSignedBy } from "../../src/contract/ui-v1/index.js";
import {
  approvalFor,
  approvedByHuman,
  createPaymentApprovalStore,
  FIRST_APPROVAL_NO,
  nextApprovalVersion,
  recordPaymentApproval,
  type PaymentApprovalJournal,
  type PaymentApprovedEntry,
  type SignedPaymentApproval,
} from "../../src/signature/index.js";

// **В фикстуре разные сущности — разные значения** (решение владельца 16.11): покупка, владелец, версия текстов
// карточки и версия текстов провенанса различимы. При равных величинах подмена одного поля другим в коде невидима —
// разобранный случай К1.5, где `cartMandateId` равнялся идентификатору покупки.
const OWNER = "own_m2_1";
const PURCHASE = "pur_m2_77";
const SHOWN: UiShown = { hash: `sha256:${"c".repeat(64)}`, text_version: "p4-pay@2.1" };
const OTHER_SHOWN: UiShown = { hash: `sha256:${"d".repeat(64)}`, text_version: "p4-pay@2.2" };
const PRESS: UiPress = { at: "2026-11-22T10:15:00Z", device: "mobile", text_version: "press-p4@5.3", gesture: "swipe" };
const NOW = "2026-11-22T10:15:02Z";

/** Журнал-записник: собирает строки, чтобы проверить **порядок** и число записей. */
function journal(): PaymentApprovalJournal & { readonly written: PaymentApprovedEntry[] } {
  const written: PaymentApprovedEntry[] = [];
  // Отказы этот кирпич не пишет — их пишет сервис § 5.7 (К4, не в этой задаче); заглушка падает, если кто-то позовёт
  // её из записи подтверждения: удача и отказ смешаться не должны.
  return {
    written,
    write: (entry) => void written.push(entry),
    refused: () => {
      throw new Error("запись подтверждения оплаты не пишет отказов");
    },
  };
}

// Признак «кто нажал» — **типом из источника** (`UiSignedBy`, контракт), а не переписанным перечнем: перепиши его
// литералом, и смена перечня в контракте тест не покраснит (Р-1511; находка ревью К3 № 5).
const deps = (j: PaymentApprovalJournal, store = createPaymentApprovalStore(), by: UiSignedBy = "human") => ({
  store,
  journal: j,
  now: () => NOW,
  by: () => by,
});

const body = (owner = OWNER, purchase = PURCHASE, shown: UiShown = SHOWN) =>
  ({ owner, purchase_id: purchase, shown, press: PRESS }) as const;

const built = (owner = OWNER, purchase = PURCHASE, shown: UiShown = SHOWN) =>
  ({ ...body(owner, purchase, shown), by: "human", received_at: NOW }) as const;

describe("версия подтверждения неизменяема", () => {
  it("первая версия — номер один", () => {
    const v = nextApprovalVersion(null, built());
    expect(v.no).toBe(1);
    expect(FIRST_APPROVAL_NO).toBe(1);
  });

  it("следующая версия не трогает прежнюю, номер растёт на единицу", () => {
    const first = nextApprovalVersion(null, built());
    const second = nextApprovalVersion(first, built(OWNER, "pur_m2_78", OTHER_SHOWN));
    expect(second.no).toBe(2);
    // Прежняя осталась как была — ни номер, ни покупка, ни хэш не поехали.
    expect(first.no).toBe(1);
    expect(first.purchase_id).toBe(PURCHASE);
    expect(first.shown.hash).toBe(`sha256:${"c".repeat(64)}`);
  });

  it("в версии стоит версия текстов карточки, а не провенанса", () => {
    const v = nextApprovalVersion(null, built());
    // `shown` проверяется целиком: подмена версии текстов карточки на версию текстов провенанса оставалась бы
    // зелёной, читай тест только `shown.hash` (находка ревью К2 № 2 ИН-П1 — ровно этот случай).
    expect(v.shown).toEqual({ hash: `sha256:${"c".repeat(64)}`, text_version: "p4-pay@2.1" });
    expect(v.press.text_version).toBe("press-p4@5.3");
  });

  it("номер версии не считается по чужой истории", () => {
    const first = nextApprovalVersion(null, built());
    expect(() => nextApprovalVersion(first, built("own_m2_2"))).toThrow(
      /прежняя версия принадлежит own_m2_1, а новая — own_m2_2/,
    );
  });

  it("заморожены все слои, а не только верхний", () => {
    const v = nextApprovalVersion(null, built());
    // Задним числом нельзя поправить ни хэш показанного (правило 1), ни провенанс (П26) — на этом и держится
    // «версию нельзя изменить» (П32, П34 п. 3).
    expect(Object.isFrozen(v)).toBe(true);
    expect(Object.isFrozen(v.shown)).toBe(true);
    expect(Object.isFrozen(v.press)).toBe(true);
    const mutable = v as unknown as { shown: { hash: string }; no: number };
    expect(() => {
      mutable.shown.hash = "sha256:подмена";
    }).toThrow(TypeError);
    expect(() => {
      mutable.no = 99;
    }).toThrow(TypeError);
    expect(v.shown.hash).toBe(`sha256:${"c".repeat(64)}`);
  });

  it("подпись без хэша показанного не записывается — подписывать нечего", () => {
    const j = journal();
    expect(() => recordPaymentApproval(deps(j), body(OWNER, PURCHASE, { hash: "", text_version: "p4-pay@2.1" }))).toThrow(
      /нет хэша показанного или версии текстов/,
    );
    expect(() => recordPaymentApproval(deps(j), body(OWNER, PURCHASE, { hash: SHOWN.hash, text_version: "" }))).toThrow(
      /нет хэша показанного или версии текстов/,
    );
    // И ничего не записано: исключение до `append`, а не после.
    expect(j.written).toEqual([]);
  });
});

describe("каждую оплату подтверждает человек (Р-1703, инвариант 3)", () => {
  it("подтверждение найдено по своему человеку, своей покупке и своему хэшу", () => {
    const store = createPaymentApprovalStore();
    recordPaymentApproval(deps(journal(), store), body());
    const found = approvalFor(store, { owner: OWNER, purchase_id: PURCHASE, shown_hash: SHOWN.hash });
    expect(found?.no).toBe(1);
    expect(found?.purchase_id).toBe(PURCHASE);
  });

  it("подтверждение одной покупки не годится для другой", () => {
    const store = createPaymentApprovalStore();
    recordPaymentApproval(deps(journal(), store), body());
    // Иначе одно нажатие открыло бы оплату любой другой покупки того же человека.
    expect(approvalFor(store, { owner: OWNER, purchase_id: "pur_m2_78", shown_hash: SHOWN.hash })).toBeNull();
  });

  it("сменился хэш показанного — подтверждения нет: человек подтверждает заново", () => {
    const store = createPaymentApprovalStore();
    recordPaymentApproval(deps(journal(), store), body());
    // Новая карточка — другая цена или другие условия; прежнее нажатие к ней не относится (правило 1 К-Б).
    expect(approvalFor(store, { owner: OWNER, purchase_id: PURCHASE, shown_hash: OTHER_SHOWN.hash })).toBeNull();
  });

  it("подтверждение одного человека не находится другим", () => {
    const store = createPaymentApprovalStore();
    recordPaymentApproval(deps(journal(), store), body());
    // Ключ по владельцу сессии (П34 п. 4): иначе чужое подтверждение открыло бы оплату.
    expect(approvalFor(store, { owner: "own_m2_2", purchase_id: PURCHASE, shown_hash: SHOWN.hash })).toBeNull();
  });

  it("второй вопрос о том же подтверждении не создаёт второй версии", () => {
    const store = createPaymentApprovalStore();
    recordPaymentApproval(deps(journal(), store), body());
    const look = { owner: OWNER, purchase_id: PURCHASE, shown_hash: SHOWN.hash } as const;
    expect(approvalFor(store, look)?.no).toBe(1);
    // Проверяется **хранилище после второго вопроса**, а не равенство двух вызовов чистой функции: прежний случай
    // звался «законный повтор не расходует подтверждение» и держался чистотой `approvalFor`, то есть не проверял
    // ничего (находка ревью К3 № 6). Сам законный повтор по правилу 2 К-Б (тот же ключ, то же тело) живёт у метода
    // `/ui/v1` — это кирпич К4, и утверждение о нём принадлежит ему. Здесь держится то, что от механики: чтение
    // истории её не меняет.
    expect(approvalFor(store, look)?.no).toBe(1);
    expect(store.all(OWNER)).toHaveLength(1);
  });

  it("история не правится снаружи: перечень от порта — копия", () => {
    const store = createPaymentApprovalStore();
    recordPaymentApproval(deps(journal(), store), body());
    const mine = store.all(OWNER) as SignedPaymentApproval[];
    mine.push({ ...mine[0]!, no: 99, purchase_id: "pur_подмена" });
    mine.length = 0;
    // «Порт не умеет ни заменить, ни удалить» было обещано комментарием и ничем не проверено (находка ревью К3 № 8):
    // отдай `all()` сам массив — и дописать историю можно было бы снаружи, минуя `append`.
    expect(store.all(OWNER)).toHaveLength(1);
    expect(store.all(OWNER)[0]?.purchase_id).toBe(PURCHASE);
    expect(approvalFor(store, { owner: OWNER, purchase_id: "pur_подмена", shown_hash: SHOWN.hash })).toBeNull();
  });

  it("подтвердил заново — годится свежая версия, прежняя остаётся в истории", () => {
    const store = createPaymentApprovalStore();
    recordPaymentApproval(deps(journal(), store), body());
    recordPaymentApproval(deps(journal(), store), body());
    const found = approvalFor(store, { owner: OWNER, purchase_id: PURCHASE, shown_hash: SHOWN.hash });
    expect(found?.no).toBe(2);
    expect(store.all(OWNER).map((v) => v.no)).toEqual([1, 2]);
  });

  it("«подтверждение есть» и «подтвердил человек» — разные утверждения", () => {
    const store = createPaymentApprovalStore();
    // Режим прогона тестов демо-стенда (П5, П26 доп. 2): подпись делает прогон, и это видно признаком.
    const version = recordPaymentApproval(deps(journal(), store, "test"), body());
    const found = approvalFor(store, { owner: OWNER, purchase_id: PURCHASE, shown_hash: SHOWN.hash });
    // Подтверждение найдено — и всё же человек не подтверждал. Склей эти два утверждения, и в акте для НСПК у
    // прогона появилось бы ложное «подтвердил человек» (разобранный случай пульта — расхождение № 15).
    expect(found?.no).toBe(1);
    expect(approvedByHuman(version)).toBe(false);
    expect(version.by).toBe("test");
    // Перечень берётся **из контракта** и обходится целиком: человеком считается ровно одно значение из трёх, и
    // появись в перечне четвёртое — здесь будет видно, что о нём не решили (прежде стояли приведения
    // `as SignedPaymentApproval`, они гасили проверку типа целиком — находка ревью К3 № 5).
    const byValue = Object.fromEntries(UI_SIGNED_BY.map((by) => [by, approvedByHuman({ ...version, by })]));
    expect(byValue).toEqual({ human: true, emulator: false, test: false });
  });

  it("признак «кто нажал» берётся у сервера, а не из тела", () => {
    const store = createPaymentApprovalStore();
    // Форма зависимости — та же, что у провенанса сервера (`createProvenance`): `() => UiSignedBy`. Поля `by` в теле
    // нет вовсе, и подставить его некуда: тело с `by` отклоняет граница `/ui/v1` (`claimsSignedBy`, К4).
    const version = recordPaymentApproval(deps(journal(), store, "emulator"), body());
    expect(version.by).toBe("emulator");
    // Поля `by` в теле нет **по типу**, а не по договорённости: прежде здесь стояло ожидание по ключам фикстуры —
    // оно проверяло фикстуру, а не модуль. Тело с признаком не собирается вовсе.
    // Директива стоит на самой строке с полем: вынеси тело в переменную — проверка лишних полей не сработает, и
    // случай стал бы зелёным ни о чём (тот же довод, что у ревью К4 № 7 ИН-П1).
    // **Гарантию даёт компиляция, и шаг воспроизведения назван** (Р-1702): убери строку `@ts-expect-error` ниже и
    // запусти `npx tsc --noEmit` — он покраснеет на лишнем поле `by`. Под `vitest` этот случай зелёный независимо от
    // типов, и ждать от прогона доказательства здесь нечего.
    recordPaymentApproval(deps(journal(), createPaymentApprovalStore()), {
      owner: OWNER,
      purchase_id: PURCHASE,
      shown: SHOWN,
      press: PRESS,
      // @ts-expect-error — «кто нажал» ставит сервер; из тела признак не берётся ни в каком режиме (П26 доп. 2)
      by: "human",
    });
  });
});

describe("журнал подтверждения", () => {
  it("пишется последним и ровно один раз", () => {
    const store = createPaymentApprovalStore();
    const j = journal();
    const order: string[] = [];
    const watched = {
      ...store,
      append: (v: SignedPaymentApproval) => {
        order.push("store");
        store.append(v);
      },
    };
    const writing: PaymentApprovalJournal = {
      write: (e) => {
        order.push("journal");
        j.write(e);
      },
      refused: j.refused,
    };
    recordPaymentApproval({ store: watched, journal: writing, now: () => NOW, by: () => "human" }, body());
    // Строка журнала о подтверждении, которого нет в хранилище, читалась бы как доказательство — поэтому порядок
    // именно такой, и он проверяется, а не обещается комментарием.
    expect(order).toEqual(["store", "journal"]);
    expect(j.written).toHaveLength(1);
  });

  it("в записи — номер версии, покупка, хэш, версия текстов и провенанс; сумм и реквизитов нет", () => {
    const j = journal();
    recordPaymentApproval(deps(j), body());
    // Ожидание — **готовым объектом**: добавь модуль в запись сумму или поле реквизита, и случай покраснеет (инвариант
    // 1 сильнее удобства).
    expect(j.written[0]).toEqual({
      event: "payment.approved",
      version: 1,
      owner: OWNER,
      purchase_id: PURCHASE,
      hash: `sha256:${"c".repeat(64)}`,
      text_version: "p4-pay@2.1",
      press: PRESS,
      by: "human",
      received_at: NOW,
    });
  });

  it("время получения сервером не заменяет время устройства", () => {
    const j = journal();
    const version = recordPaymentApproval(deps(j), body());
    // П26: `press.at` — часы устройства, `received_at` — часы сервера; одно другим не подменяется.
    expect(version.press.at).toBe("2026-11-22T10:15:00Z");
    expect(version.received_at).toBe(NOW);
    expect(version.press.at).not.toBe(version.received_at);
  });
});

describe("формулировки ПЭП в коде нет (Р-1703)", () => {
  it("в версии и в записи журнала — только версия текстов", () => {
    const j = journal();
    const version = recordPaymentApproval(deps(j), body());
    // Текст ПЭП живёт данными в `config/` и правится после юриста без правки кода. В механике стоит версия текстов —
    // по ней видно, под какой формулировкой человек подписался.
    expect(Object.keys(version)).toEqual(["no", "owner", "purchase_id", "shown", "press", "by", "received_at"]);
    expect(version.shown.text_version).toBe("p4-pay@2.1");
    const asText = JSON.stringify([version, j.written[0]]).toLowerCase();
    // Корни **на оба языка**: интерфейс двуязычный (правило планов № 3), и английская формулировка прошла бы молча
    // (находка ревью К3 № 13).
    for (const word of ["подпис", "электронн", "соглас", "оферт", "signature", "electronic", "consent", "offer"])
      expect(asText, word).not.toContain(word);
  });
});
