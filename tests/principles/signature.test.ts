// П-К1, К1.3 — подпись профиля: хэш показанного по своей копии карточки, идемпотентность, неизменяемость версий,
// запись журнала `principles.signed`, обязательный провенанс нажатия.
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { UI_DEVICES, UI_GESTURES } from "../../src/contract/ui-v1/common.js";
import { UI_ERROR_STATUS } from "../../src/contract/ui-v1/errors.js";
import { showingHash, type ShownPayload } from "../../src/contract/ui-v1/shown-hash.js";
import {
  bodyFingerprint,
  byRole,
  createPrinciplesStore,
  defaultOrder,
  parsePrinciplesCatalog,
  signPrinciples,
  type PrinciplesJournal,
  type PrinciplesSignedEntry,
  type PrinciplesStore,
  type SignDeps,
  type SignedBy,
  type SignRequest,
} from "../../src/principles/index.js";

const catalog = parsePrinciplesCatalog(
  JSON.parse(readFileSync(new URL("../../config/principles.default.json", import.meta.url), "utf8")) as unknown,
);
const ids = defaultOrder(catalog);
const executionId = byRole(catalog, "execution")?.id as string;
const priceId = byRole(catalog, "price")?.id as string;

/** Разные сущности — разные значения (решение владельца 16.11): опознаватель своей копии, ключи идемпотентности и
 *  порядки в случаях различимы.
 *  **Версия текстов у карточки и у провенанса — одна и та же величина** (§ 3 контракта, пример: у `view` и у `press`
 *  один `u1-card@1.0`), поэтому здесь она одна, и её расхождение — отдельный случай ниже. */
const CARD_TEXT_VERSION = "principles-card@1.0";
const VIEW_ID = "viw_principles_1";
const KEY_A = "9f1c3b7e-5a24-4d8f-9b31-2c6f0ab4e7d5";
const KEY_B = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";

const press = { at: "2026-11-19T11:00:00Z", device: "mobile", text_version: CARD_TEXT_VERSION, gesture: "swipe" } as const;

/** Своя копия показанной карточки: сервер собирает её сам — ни одного значения из тела запроса. */
const shownFor = (order: readonly string[]): ShownPayload => ({
  text_version: CARD_TEXT_VERSION,
  card: { items: order.map((id, i) => ({ id, rank: i + 1 })) },
});

let store: PrinciplesStore;
let written: PrinciplesSignedEntry[];
let clock: string[];
let shownOrder: readonly string[];
let who: SignedBy;

const journal: PrinciplesJournal = { write: (e) => void written.push(e) };

const deps = (): SignDeps => ({
  catalog,
  store,
  journal,
  shown: () => shownFor(shownOrder),
  viewId: VIEW_ID,
  now: () => clock.shift() ?? "2026-11-19T23:59:59Z",
  by: () => who,
});

const bodyFor = (order: readonly string[]): SignRequest => ({
  order,
  shown_hash: showingHash(shownFor(order)),
  press,
});

beforeEach(() => {
  store = createPrinciplesStore();
  written = [];
  clock = ["2026-11-19T11:00:05Z", "2026-11-19T12:00:05Z", "2026-11-19T13:00:05Z"];
  shownOrder = ids;
  who = "human";
});

describe("К1.3: подпись порядка — удачный путь", () => {
  it("первая подпись даёт версию 1, порядок клиента и провенанс как есть", () => {
    const out = signPrinciples(bodyFor(ids), KEY_A, deps());
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.replay).toBe(false);
    expect(out.version.no).toBe(1);
    expect(out.version.order).toEqual(ids);
    expect(out.version.press).toEqual(press);
    expect(out.version.source).toBe("CLIENT");
  });

  it("версия легла в хранилище и стала последней", () => {
    signPrinciples(bodyFor(ids), KEY_A, deps());
    expect(store.all()).toHaveLength(1);
    expect(store.last()?.no).toBe(1);
  });

  it("вторая подпись другим ключом добавляет версию, прежнюю не стирая", () => {
    signPrinciples(bodyFor(ids), KEY_A, deps());
    shownOrder = [priceId, executionId];
    const out = signPrinciples(bodyFor(shownOrder), KEY_B, deps());
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.version.no).toBe(2);
    expect(store.all().map((v) => v.no)).toEqual([1, 2]);
    expect(store.all()[0]?.order).toEqual(ids);
    expect(store.all()[1]?.order).toEqual(shownOrder);
  });

  it("хэш версии — хэш **своей** копии карточки, а не присланное значение", () => {
    // Присланный хэш нарочно иной формы, чем хэш своей копии: реализация «взять `body.shown_hash`» была бы красной.
    // Для этого карточка показана в порядке по умолчанию, а тело несёт **свой** порядок — обычный сюжет перестановки.
    shownOrder = ids;
    const body: SignRequest = { order: [priceId, executionId], shown_hash: showingHash(shownFor(ids)), press };
    const out = signPrinciples(body, KEY_A, deps());
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.version.view.hash).toBe(showingHash(shownFor(ids)));
    expect(out.version.view.text_version).toBe(CARD_TEXT_VERSION);
  });

  it("обычный сюжет перестановки: карточка показана по умолчанию, тело несёт новый порядок", () => {
    shownOrder = ids; // человеку показали порядок по умолчанию
    const newOrder = [priceId, executionId]; // и он переставил пункты
    const out = signPrinciples({ order: newOrder, shown_hash: showingHash(shownFor(ids)), press }, KEY_A, deps());
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.version.order).toEqual(newOrder);
    expect(out.version.view.hash).toBe(showingHash(shownFor(ids)));
  });

  it("хэш карточки, собранной по **новому** порядку, не подходит: показывали не её", () => {
    shownOrder = ids;
    const newOrder = [priceId, executionId];
    const out = signPrinciples({ order: newOrder, shown_hash: showingHash(shownFor(newOrder)), press }, KEY_A, deps());
    expect(out.ok).toBe(false);
    if (out.ok || out.kind !== "ui") return;
    expect(out.code).toBe("SHOWN_STALE");
  });

  it("время сервера — своё; время устройства не заменяется (П26)", () => {
    const out = signPrinciples(bodyFor(ids), KEY_A, deps());
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.version.received_at).toBe("2026-11-19T11:00:05Z");
    expect(out.version.press.at).toBe(press.at);
    expect(out.version.received_at).not.toBe(out.version.press.at);
  });

  it("исполнение можно переставить, прочее — выключить", () => {
    shownOrder = [priceId, executionId];
    const out = signPrinciples(bodyFor(shownOrder), KEY_A, deps());
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.version.order).toEqual([priceId, executionId]);
  });

  it("подмена порядка в теле после подписи версию не меняет", () => {
    const body = bodyFor(ids);
    const mutable = [...ids];
    const out = signPrinciples({ ...body, order: mutable }, KEY_A, deps());
    mutable.reverse();
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.version.order).toEqual(ids);
  });
});

describe("К1.3: журнал `principles.signed`", () => {
  it("запись несёт номер версии, хэш, провенанс и признак «кто нажал»", () => {
    signPrinciples(bodyFor(ids), KEY_A, deps());
    expect(written).toHaveLength(1);
    expect(written[0]).toEqual({
      event: "principles.signed",
      version: 1,
      hash: showingHash(shownFor(ids)),
      press,
      by: "human",
      received_at: "2026-11-19T11:00:05Z",
      source: "CLIENT",
    });
  });

  describe("признак «кто нажал» ставит сервер (П26, П5)", () => {
    it("подпись эмулятором клиента помечена `by: \"emulator\"`", () => {
      who = "emulator";
      signPrinciples(bodyFor(ids), KEY_A, deps());
      expect(written[0]?.by).toBe("emulator");
    });

    it("признак из тела запроса взять нельзя: такое тело вообще не принимается (С-12, С-31)", () => {
      who = "emulator";
      const forged = { ...bodyFor(ids), press: { ...press, by: "human" } } as unknown as SignRequest;
      const out = signPrinciples(forged, KEY_A, deps());
      expect(out.ok).toBe(false);
      expect(written).toEqual([]);
      // и когда подпись проходит, признак ставит сервер, а в провенансе его нет вовсе
      store = createPrinciplesStore();
      signPrinciples(bodyFor(ids), KEY_A, deps());
      expect(written[0]?.by).toBe("emulator");
      expect(JSON.stringify(written[0]?.press)).not.toContain("human");
    });

    it("подпись прогоном помечена `by: \"test\"` — не `emulator` (решение владельца 19.11, 22:10)", () => {
      who = "test";
      signPrinciples(bodyFor(ids), KEY_A, deps());
      expect(written[0]?.by).toBe("test");
      expect(store.last()?.by).toBe("test");
    });

    it("умолчания нет: признак в записи есть всегда", () => {
      signPrinciples(bodyFor(ids), KEY_A, deps());
      expect(written[0]).toHaveProperty("by");
      expect(written[0]?.by).toBe("human");
    });
  });

  it("реквизитов, сумм и `kid` в записи нет (инвариант 1)", () => {
    signPrinciples(bodyFor(ids), KEY_A, deps());
    const text = JSON.stringify(written);
    for (const forbidden of ["pan", "card_number", "cvv", "cryptogram", "kid", "amount", "currency"])
      expect(text.toLowerCase(), forbidden).not.toContain(forbidden);
  });

  it("повтор второй записи не даёт: одно нажатие — одна запись", () => {
    const body = bodyFor(ids);
    signPrinciples(body, KEY_A, deps());
    signPrinciples(body, KEY_A, deps());
    expect(written).toHaveLength(1);
  });

  it("отказ записи не делает", () => {
    signPrinciples({ ...bodyFor(ids), shown_hash: `sha256:${"ab".repeat(32)}` }, KEY_A, deps());
    signPrinciples(bodyFor([]), KEY_B, deps());
    expect(written).toEqual([]);
  });
});

describe("К1.3: хэш показанного (правило 1 К-Б)", () => {
  it("не совпал — `SHOWN_STALE` и **новая** карточка в `view`, версии нет", () => {
    const out = signPrinciples({ ...bodyFor(ids), shown_hash: `sha256:${"ab".repeat(32)}` }, KEY_A, deps());
    expect(out).toEqual({
      ok: false,
      kind: "ui",
      code: "SHOWN_STALE",
      view: { view_id: VIEW_ID, text_version: CARD_TEXT_VERSION, hash: showingHash(shownFor(ids)) },
    });
    expect(store.all()).toEqual([]);
  });

  it("карточка устарела (сервер показывает уже другое) — `SHOWN_STALE` с нынешней карточкой", () => {
    const body = bodyFor(ids); // хэш посчитан по старой карточке
    shownOrder = [...ids].reverse(); // сервер успел показать другую
    const out = signPrinciples(body, KEY_A, deps());
    expect(out.ok).toBe(false);
    if (out.ok || out.kind !== "ui") return;
    expect(out.code).toBe("SHOWN_STALE");
    expect(out.view?.hash).toBe(showingHash(shownFor(shownOrder)));
    expect(out.view?.hash).not.toBe(body.shown_hash);
  });

  it("версия текстов провенанса расходится с версией своей копии — `SHOWN_STALE`, подписи нет", () => {
    // § 3: у `press` и у `view` это одна величина (в примере обе `u1-card@1.0`). Расхождение значит, что человек
    // подтверждал не те тексты, которые сервер считает показанными, — тот же случай «карточка устарела».
    const out = signPrinciples({ ...bodyFor(ids), press: { ...press, text_version: "CHUZHAYA@9" } }, KEY_A, deps());
    expect(out.ok).toBe(false);
    if (out.ok || out.kind !== "ui") return;
    expect(out.code).toBe("SHOWN_STALE");
    expect(out.view?.text_version).toBe(CARD_TEXT_VERSION);
    expect(store.all()).toEqual([]);
    expect(written).toEqual([]);
  });

  it("хэш не по форме — тот же `SHOWN_STALE`, а не отдельный исход", () => {
    for (const bad of ["", "sha256:", "sha1:abc", showingHash(shownFor(ids)).toUpperCase()]) {
      store = createPrinciplesStore();
      const out = signPrinciples({ ...bodyFor(ids), shown_hash: bad }, KEY_A, deps());
      expect(out.ok, bad).toBe(false);
      if (out.ok || out.kind !== "ui") continue;
      expect(out.code, bad).toBe("SHOWN_STALE");
    }
  });

  it("сверка идёт по своей копии: присланный хэш в расчёт не берётся", () => {
    // Тело присылает и порядок, и хэш; если бы сервер считал хэш по присланному порядку, подмена прошла бы.
    const forged = [...ids].reverse();
    const out = signPrinciples({ order: forged, shown_hash: showingHash(shownFor(forged)), press }, KEY_A, deps());
    expect(out.ok).toBe(false);
    if (out.ok || out.kind !== "ui") return;
    expect(out.code).toBe("SHOWN_STALE");
  });
});

describe("К1.3: идемпотентность (правило 2 К-Б)", () => {
  it("тот же ключ и то же тело — прежний ответ, новой версии нет", () => {
    const body = bodyFor(ids);
    const first = signPrinciples(body, KEY_A, deps());
    const second = signPrinciples(body, KEY_A, deps());
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.replay).toBe(true);
    expect(second.version).toBe(first.version);
    expect(store.all()).toHaveLength(1);
  });

  it("порядок ключей в теле на «то же тело» не влияет — отпечаток канонический", () => {
    const body = bodyFor(ids);
    signPrinciples(body, KEY_A, deps());
    const reordered = { press: body.press, shown_hash: body.shown_hash, order: body.order } as SignRequest;
    const out = signPrinciples(reordered, KEY_A, deps());
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.replay).toBe(true);
    expect(bodyFingerprint(reordered)).toBe(bodyFingerprint(body));
  });

  it("тот же ключ, другое тело — `IDEMPOTENCY_CONFLICT`, новой версии нет", () => {
    signPrinciples(bodyFor(ids), KEY_A, deps());
    const other = bodyFor([priceId, executionId]);
    const out = signPrinciples(other, KEY_A, deps());
    expect(out).toEqual({ ok: false, kind: "ui", code: "IDEMPOTENCY_CONFLICT", view: null });
    expect(store.all()).toHaveLength(1);
  });

  it("другое тело — это и другой провенанс: повтором оно не считается", () => {
    const body = bodyFor(ids);
    signPrinciples(body, KEY_A, deps());
    const later = { ...body, press: { ...press, at: "2026-11-19T11:30:00Z" } };
    const out = signPrinciples(later, KEY_A, deps());
    expect(out.ok).toBe(false);
    if (out.ok || out.kind !== "ui") return;
    expect(out.code).toBe("IDEMPOTENCY_CONFLICT");
  });

  it("нет ключа или ключ не по форме — `IDEMPOTENCY_REQUIRED`", () => {
    for (const key of [null, undefined, "", "не-uuid", "9f1c3b7e-5a24-1d8f-9b31-2c6f0ab4e7d5"]) {
      store = createPrinciplesStore();
      const out = signPrinciples(bodyFor(ids), key, deps());
      expect(out, String(key)).toEqual({ ok: false, kind: "ui", code: "IDEMPOTENCY_REQUIRED", view: null });
      expect(store.all(), String(key)).toEqual([]);
    }
  });

  it("повтор проверяется раньше разбора тела: удачное нажатие повтором не отказывается", () => {
    // Первое нажатие прошло; к повтору сервер показывает уже другую карточку. Повтор обязан отдать прежний ответ,
    // а не `SHOWN_STALE`: иначе экран на обрыве связи (С-18) получил бы отказ по действию, которое уже случилось.
    const body = bodyFor(ids);
    const first = signPrinciples(body, KEY_A, deps());
    shownOrder = [...ids].reverse();
    const second = signPrinciples(body, KEY_A, deps());
    expect(second.ok).toBe(true);
    if (!second.ok || !first.ok) return;
    expect(second.replay).toBe(true);
    expect(second.version).toBe(first.version);
  });
});

describe("К1.3: негодное тело — один код `PRINCIPLES_ORDER_INVALID` (решение владельца 19.11)", () => {
  const invalid = (problem: unknown) => ({
    ok: false,
    kind: "ui",
    code: "PRINCIPLES_ORDER_INVALID",
    view: null,
    problem,
  });

  it("нет провенанса — умолчания у него нет (П26)", () => {
    for (const press_ of [undefined, null, {}, { at: "2026-11-19T11:00:00Z", device: "mobile" }, "swipe"]) {
      store = createPrinciplesStore();
      const out = signPrinciples({ ...bodyFor(ids), press: press_ } as SignRequest, KEY_A, deps());
      expect(out, JSON.stringify(press_)).toEqual(invalid({ reason: "PRESS_MISSING" }));
      expect(store.all(), JSON.stringify(press_)).toEqual([]);
    }
  });

  it("пустой порядок — причина `EMPTY`: «без принципов» выражается `signed: null`", () => {
    expect(signPrinciples(bodyFor([]), KEY_A, deps())).toEqual(invalid({ reason: "EMPTY" }));
  });

  it("незнакомый `id` — `UNKNOWN_ID`, повтор — `DUPLICATE_ID`", () => {
    expect(signPrinciples(bodyFor(["prn_unknown"]), KEY_A, deps())).toEqual(
      invalid({ reason: "UNKNOWN_ID", id: "prn_unknown" }),
    );
    store = createPrinciplesStore();
    expect(signPrinciples(bodyFor([executionId, executionId]), KEY_B, deps())).toEqual(
      invalid({ reason: "DUPLICATE_ID", id: executionId }),
    );
  });

  it("порядок без надёжного исполнения — `EXECUTION_MISSING`, тем же кодом", () => {
    const out = signPrinciples(bodyFor([priceId]), KEY_A, deps());
    expect(out).toEqual(invalid({ reason: "EXECUTION_MISSING", id: executionId }));
    expect(store.all()).toEqual([]);
    expect(written).toEqual([]);
  });

  describe("провенанс, который ничего не доказывает, — это отсутствие провенанса (П26)", () => {
    it("`device` вне перечня § 3 не принимается", () => {
      for (const device of ["robot", "Mobile", "", "ios"]) {
        store = createPrinciplesStore();
        const out = signPrinciples({ ...bodyFor(ids), press: { ...press, device } } as SignRequest, KEY_A, deps());
        expect(out, device).toEqual(invalid({ reason: "PRESS_INVALID", field: "device" }));
        expect(store.all(), device).toEqual([]);
      }
    });

    it("все значения перечня `device` принимаются — проверка не запрещает лишнего", () => {
      for (const device of UI_DEVICES) {
        store = createPrinciplesStore();
        const out = signPrinciples({ ...bodyFor(ids), press: { ...press, device } }, KEY_A, deps());
        expect(out.ok, device).toBe(true);
      }
    });

    it("`gesture` вне перечня § 3 не принимается, оба значения перечня принимаются", () => {
      const out = signPrinciples(
        { ...bodyFor(ids), press: { ...press, gesture: "nod" } } as unknown as SignRequest,
        KEY_A,
        deps(),
      );
      expect(out).toEqual(invalid({ reason: "PRESS_INVALID", field: "gesture" }));
      for (const gesture of UI_GESTURES) {
        store = createPrinciplesStore();
        expect(signPrinciples({ ...bodyFor(ids), press: { ...press, gesture } }, KEY_A, deps()).ok, gesture).toBe(true);
      }
    });

    it("пустое время нажатия или пустая версия текстов не принимаются", () => {
      expect(signPrinciples({ ...bodyFor(ids), press: { ...press, at: "" } }, KEY_A, deps())).toEqual(
        invalid({ reason: "PRESS_INVALID", field: "at" }),
      );
      store = createPrinciplesStore();
      expect(signPrinciples({ ...bodyFor(ids), press: { ...press, text_version: "" } }, KEY_A, deps())).toEqual(
        invalid({ reason: "PRESS_INVALID", field: "text_version" }),
      );
    });

    it("перечни взяты из контракта, а не переписаны: значения — как в § 3", () => {
      expect([...UI_DEVICES]).toEqual(["mobile", "web", "max", "bank_module"]);
      expect([...UI_GESTURES]).toEqual(["swipe", "tap"]);
      const doc = readFileSync(new URL("../../docs/reference/2026-11-18-kontrakt-K-B-ui-v1-v1.0.md", import.meta.url), "utf8");
      expect(doc).toContain("`device` принимает значения `mobile` | `web` | `max` | `bank_module`");
      for (const g of UI_GESTURES) expect(doc, g).toContain(`\`${g}\``);
    });
  });

  describe("форма тела — до отпечатка: негодное значение даёт код, а не исключение", () => {
    for (const order of [undefined, null, 5, {}, "prn_execution", [1, 2]])
      it(`\`order\` = ${JSON.stringify(order)} — \`ORDER_NOT_LIST\`, а не TypeError`, () => {
        store = createPrinciplesStore();
        const out = signPrinciples({ ...bodyFor(ids), order } as unknown as SignRequest, KEY_A, deps());
        expect(out).toEqual(invalid({ reason: "ORDER_NOT_LIST" }));
      });

    it("лишнее поле в теле — другое тело, а не «то же с примечанием»", () => {
      const out = signPrinciples({ ...bodyFor(ids), extra: 1 } as unknown as SignRequest, KEY_A, deps());
      expect(out).toEqual(invalid({ reason: "UNKNOWN_FIELD", field: "extra" }));
    });

    it("лишнее поле в провенансе — тоже отказ: `by` экран не присылает", () => {
      const forged = { ...bodyFor(ids), press: { ...press, by: "human" } } as unknown as SignRequest;
      expect(signPrinciples(forged, KEY_A, deps())).toEqual(invalid({ reason: "UNKNOWN_FIELD", field: "by" }));
    });

    // Третье значение присылать тоже нельзя — ни в провенансе, ни верхним полем тела: иначе экран сам объявлял бы
    // себя прогоном, а признак ставит сервер (П26; находка ревью К0а № 8).
    it("`by: \"test\"` из тела не принимается — ни в провенансе, ни верхним полем", () => {
      const inPress = { ...bodyFor(ids), press: { ...press, by: "test" } } as unknown as SignRequest;
      expect(signPrinciples(inPress, KEY_A, deps())).toEqual(invalid({ reason: "UNKNOWN_FIELD", field: "by" }));
      const onTop = { ...bodyFor(ids), by: "test" } as unknown as SignRequest;
      expect(signPrinciples(onTop, KEY_B, deps())).toEqual(invalid({ reason: "UNKNOWN_FIELD", field: "by" }));
      expect(store.all()).toHaveLength(0);
    });

    it("повтор удачного тела с лишним полем повтором не считается", () => {
      const body = bodyFor(ids);
      expect(signPrinciples(body, KEY_A, deps()).ok).toBe(true);
      const out = signPrinciples({ ...body, extra: 1 } as unknown as SignRequest, KEY_A, deps());
      expect(out.ok).toBe(false);
      expect(store.all()).toHaveLength(1);
    });
  });

  it("код один на все причины, статус — 400; причина остаётся уточнением внутри", () => {
    const cases = [bodyFor([]), bodyFor(["prn_unknown"]), bodyFor([priceId]), bodyFor([executionId, executionId])];
    const reasons = new Set<string>();
    for (const body of cases) {
      store = createPrinciplesStore();
      const out = signPrinciples(body, KEY_A, deps());
      expect(out.ok).toBe(false);
      if (out.ok || out.kind !== "ui") continue;
      expect(out.code).toBe("PRINCIPLES_ORDER_INVALID");
      expect(UI_ERROR_STATUS[out.code]).toBe(400);
      expect(out.view).toBeNull();
      reasons.add((out.problem as { reason: string }).reason);
    }
    // страховка: четыре разные причины дали один и тот же код, а не один случай четыре раза
    expect([...reasons].sort()).toEqual(["DUPLICATE_ID", "EMPTY", "EXECUTION_MISSING", "UNKNOWN_ID"]);
  });
});

describe("К1.3: хранение — порт, версии только добавляются", () => {
  it("у порта нет ни замены, ни удаления версии", () => {
    const surface = Object.keys(createPrinciplesStore());
    expect(surface.sort()).toEqual(["all", "append", "last", "recall", "remember"]);
  });

  it("`all()` отдаёт копию: правка списка снаружи хранилище не меняет", () => {
    signPrinciples(bodyFor(ids), KEY_A, deps());
    const list = store.all() as ReturnType<PrinciplesStore["all"]>;
    (list as unknown as unknown[]).length = 0;
    expect(store.all()).toHaveLength(1);
  });

  it("без подписи профиль пуст — это и есть «без принципов»", () => {
    expect(store.last()).toBeNull();
    expect(store.all()).toEqual([]);
  });

  it("свой модуль канонизации не заведён: отпечаток тела считает хэш ядра", () => {
    const text = readFileSync(new URL("../../src/principles/signature.ts", import.meta.url), "utf8");
    expect(text).not.toContain("@kuzin4u/agentic-core");
    expect(text).toContain("showingHash");
  });
});
