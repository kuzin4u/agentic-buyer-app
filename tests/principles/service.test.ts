// П-К1, К1.5 — сервис `GET` и `POST /ui/v1/principles`: тела ответов по § 5.14 и § 3, классы повтора, тексты
// человеку из `config/`, и правило «ключ занимает любой окончательный ответ, включая отказ» (решение владельца
// 19.11, 17:52 п. 1), сверенное с ПАО 1.4.0.
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { UI_ERROR_STATUS } from "../../src/contract/ui-v1/errors.js";
import { showingHash, type ShownPayload } from "../../src/contract/ui-v1/shown-hash.js";
import {
  ERROR_TEXT_KEYS,
  RETRY_BY_CODE,
  byRole,
  createPrinciplesStore,
  defaultOrder,
  getPrinciplesView,
  parsePrinciplesCatalog,
  postPrinciples,
  type PrinciplesServiceDeps,
  type PrinciplesSignedEntry,
  type PrinciplesStore,
  type SignedBy,
  type SignRequest,
} from "../../src/principles/index.js";

const CONFIG_URL = new URL("../../config/principles.default.json", import.meta.url);
const catalog = parsePrinciplesCatalog(JSON.parse(readFileSync(CONFIG_URL, "utf8")) as unknown);
const ids = defaultOrder(catalog);
const executionId = byRole(catalog, "execution")?.id as string;
const priceId = byRole(catalog, "price")?.id as string;

const VIEW_ID = "viw_principles_1";
const KEY_A = "9f1c3b7e-5a24-4d8f-9b31-2c6f0ab4e7d5";
const KEY_B = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const press = { at: "2026-11-19T11:00:00Z", device: "mobile", text_version: catalog.text_version, gesture: "swipe" } as const;

/** Своя копия показанной карточки. Язык в неё входит: человеку показаны тексты на его языке, и хэш у ru и en разный. */
const shownFor = (order: readonly string[], lang: "ru" | "en"): ShownPayload => ({
  text_version: catalog.text_version,
  card: { lang, items: order.map((id, i) => ({ id, rank: i + 1 })) },
});

let store: PrinciplesStore;
let written: PrinciplesSignedEntry[];
let who: SignedBy;

const deps = (): PrinciplesServiceDeps => ({
  catalog,
  store,
  journal: { write: (e) => void written.push(e) },
  shown: (lang) => shownFor(ids, lang),
  viewId: VIEW_ID,
  now: () => "2026-11-19T11:00:05Z",
  by: () => who,
});

const bodyFor = (order: readonly string[], lang: "ru" | "en" = "ru"): SignRequest => ({
  order,
  shown_hash: showingHash(shownFor(ids, lang)),
  press,
});

beforeEach(() => {
  store = createPrinciplesStore();
  written = [];
  who = "human";
});

describe("К1.5: `GET /ui/v1/principles` — тело по § 5.14", () => {
  it("без подписи: `signed: null`, пункты по умолчанию, все включены", () => {
    const body = getPrinciplesView("ru", deps());
    expect(body.signed).toBeNull();
    expect(body.items.map((i) => i.id)).toEqual(ids);
    expect(body.items.every((i) => i.on)).toBe(true);
    expect(body.items.map((i) => i.rank)).toEqual([1, 2, 3, 4]);
  });

  it("текст пункта — на языке запроса, из перечня", () => {
    for (const lang of ["ru", "en"] as const) {
      const body = getPrinciplesView(lang, deps());
      for (const item of body.items)
        expect(item.text, `${lang}: ${item.id}`).toBe(catalog.items.find((p) => p.id === item.id)?.text[lang]);
    }
    expect(getPrinciplesView("ru", deps()).items[0]?.text).not.toBe(getPrinciplesView("en", deps()).items[0]?.text);
  });

  it("после подписи: `signed` несёт время сервера, номер версии и **кто нажал**", () => {
    who = "emulator";
    const out = postPrinciples(bodyFor([priceId, executionId]), KEY_A, "ru", deps());
    expect(out.ok).toBe(true);
    const body = getPrinciplesView("ru", deps());
    expect(body.signed).toEqual({ at: "2026-11-19T11:00:05Z", version: "1", by: "emulator" });
  });

  it("`signed.by` ставит сервер: подделка в провенансе не принимается, а в ответе стоит знание сервера", () => {
    who = "emulator";
    const forged = { ...bodyFor(ids), press: { ...press, by: "human" } } as unknown as SignRequest;
    const refused = postPrinciples(forged, KEY_A, "ru", deps());
    expect(refused.ok).toBe(false);
    expect(getPrinciplesView("ru", deps()).signed).toBeNull();
    // годное тело тем же нажатием, новым ключом: признак — тот, который знает сервер, а не присланный
    const out = postPrinciples(bodyFor(ids), KEY_B, "ru", deps());
    expect(out.ok).toBe(true);
    expect(getPrinciplesView("ru", deps()).signed?.by).toBe("emulator");
    expect(written[0]?.by).toBe("emulator");
  });

  it("подпись прогоном видна в `GET` как `by: \"test\"`, отдельно от эмулятора (решение владельца 19.11, 22:10)", () => {
    who = "test";
    expect(postPrinciples(bodyFor(ids), KEY_A, "ru", deps()).ok).toBe(true);
    expect(getPrinciplesView("ru", deps()).signed).toEqual({ at: "2026-11-19T11:00:05Z", version: "1", by: "test" });
    expect(written[0]?.by).toBe("test");
  });

  it("выключенные пункты — в конце, помечены `on: false`, ранги подряд", () => {
    postPrinciples(bodyFor([priceId, executionId]), KEY_A, "ru", deps());
    const body = getPrinciplesView("ru", deps());
    expect(body.items.map((i) => [i.id, i.rank, i.on])).toEqual([
      [priceId, 1, true],
      [executionId, 2, true],
      ...catalog.items.filter((p) => ![priceId, executionId].includes(p.id)).map((p, i) => [p.id, 3 + i, false]),
    ]);
  });

  it("строки-пояснения приходят готовыми, на языке запроса", () => {
    postPrinciples(bodyFor([priceId, executionId]), KEY_A, "ru", deps());
    for (const lang of ["ru", "en"] as const) {
      const body = getPrinciplesView(lang, deps());
      expect(body.notes).toEqual(["execution_always", "price_capped"].map((k) => catalog.notes[k as "price_capped"][lang]));
    }
  });

  it("`locked_id` — пункт, который нельзя выключить", () => {
    expect(getPrinciplesView("ru", deps()).locked_id).toBe(executionId);
  });

  it("`view` — своя копия карточки, хэш считан по ней; у ru и en он разный", () => {
    const ru = getPrinciplesView("ru", deps()).view;
    const en = getPrinciplesView("en", deps()).view;
    expect(ru).toEqual({ view_id: VIEW_ID, text_version: catalog.text_version, hash: showingHash(shownFor(ids, "ru")) });
    expect(ru.hash).not.toBe(en.hash);
  });

  it("весов в теле нет ни одним полем (правка 6 канвы)", () => {
    postPrinciples(bodyFor(ids), KEY_A, "ru", deps());
    const text = JSON.stringify(getPrinciplesView("ru", deps()));
    expect(text.toLowerCase()).not.toContain("weight");
    expect(text).not.toContain("вес");
    for (const item of getPrinciplesView("ru", deps()).items)
      expect(Object.keys(item).sort()).toEqual(["id", "on", "rank", "text"]);
  });

  it("реквизитов и сумм в теле нет (инвариант 1)", () => {
    const text = JSON.stringify(getPrinciplesView("ru", deps())).toLowerCase();
    for (const forbidden of ["pan", "card_number", "cvv", "cryptogram", "kid", "amount", "currency"])
      expect(text, forbidden).not.toContain(forbidden);
  });
});

describe("К1.5: `POST /ui/v1/principles` — удача", () => {
  it("отдаёт новое состояние — ожиданием, а не сравнением функции с собой", () => {
    const out = postPrinciples(bodyFor([executionId]), KEY_A, "ru", deps());
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.replay).toBe(false);
    expect(out.version.no).toBe(1);
    expect(out.body.signed).toEqual({ at: "2026-11-19T11:00:05Z", version: "1", by: "human" });
    expect(out.body.items.map((i) => [i.id, i.rank, i.on])).toEqual([
      [executionId, 1, true],
      ...catalog.items.filter((p) => p.id !== executionId).map((p, i) => [p.id, 2 + i, false]),
    ]);
    expect(out.body.locked_id).toBe(executionId);
  });

  it("повтор того же тела тем же ключом — тот же ответ **целиком**, второй версии нет", () => {
    const body = bodyFor(ids);
    const first = postPrinciples(body, KEY_A, "ru", deps());
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const firstBody = JSON.parse(JSON.stringify(first.body)) as unknown;
    const again = postPrinciples(body, KEY_A, "ru", deps());
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.replay).toBe(true);
    expect(again.body).toEqual(firstBody);
    expect(store.all()).toHaveLength(1);
    expect(written).toHaveLength(1);
  });

  it("повтор отдаёт тело **своей** версии, даже если профиль успел уйти вперёд", () => {
    // Ключ A подписал версию 1, ключ B — версию 2. Повтор ключа A обязан вернуть ответ версии 1, а не версии 2
    // (правило 2 К-Б: «тот же ключ и то же тело — тот же ответ»).
    const bodyA = bodyFor([executionId]);
    const first = postPrinciples(bodyA, KEY_A, "ru", deps());
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const firstBody = JSON.parse(JSON.stringify(first.body)) as { signed: { version: string } };
    const second = postPrinciples(bodyFor([priceId, executionId]), KEY_B, "ru", deps());
    expect(second.ok).toBe(true);
    expect(store.all()).toHaveLength(2);
    const again = postPrinciples(bodyA, KEY_A, "ru", deps());
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.version.no).toBe(1);
    expect(again.body.signed?.version).toBe("1");
    expect(again.body).toEqual(firstBody);
    // и `GET` при этом показывает последнюю версию — это другое тело, не ответ повтора
    expect(getPrinciplesView("ru", deps()).signed?.version).toBe("2");
  });
});

describe("К1.5: тело ошибки по § 3 — код, класс повтора, текст человеку, карточка", () => {
  it("`PRINCIPLES_ORDER_INVALID` — 400, `after_fix`, текст из `config/`, без карточки", () => {
    const out = postPrinciples(bodyFor([priceId]), KEY_A, "ru", deps());
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.status).toBe(400);
    expect(out.body.error).toEqual({
      code: "PRINCIPLES_ORDER_INVALID",
      retry: "after_fix",
      text: catalog.errors["PRINCIPLES_ORDER_INVALID"].ru,
      view: null,
    });
  });

  it("`SHOWN_STALE` — 409, `after_human` (решение владельца 19.11), с **новой** карточкой в `error.view`", () => {
    // `after_human`, а не `after_fix`: после устаревшей карточки человек смотрит новую и нажимает заново — это его
    // решение, а не исправление тела.
    const out = postPrinciples({ ...bodyFor(ids), shown_hash: `sha256:${"ab".repeat(32)}` }, KEY_A, "ru", deps());
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.status).toBe(409);
    expect(out.body.error.code).toBe("SHOWN_STALE");
    expect(out.body.error.retry).toBe("after_human");
    expect(out.body.error.view?.hash).toBe(showingHash(shownFor(ids, "ru")));
  });

  it("`IDEMPOTENCY_REQUIRED` — 400 и класс `same_key`, как у ПАО", () => {
    const out = postPrinciples(bodyFor(ids), null, "ru", deps());
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.status).toBe(400);
    expect(out.body.error.code).toBe("IDEMPOTENCY_REQUIRED");
    expect(out.body.error.retry).toBe("same_key");
  });

  it("`IDEMPOTENCY_CONFLICT` — 409 и `after_fix`, как у ПАО", () => {
    postPrinciples(bodyFor(ids), KEY_A, "ru", deps());
    const out = postPrinciples(bodyFor([executionId]), KEY_A, "ru", deps());
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.status).toBe(409);
    expect(out.body.error.code).toBe("IDEMPOTENCY_CONFLICT");
    expect(out.body.error.retry).toBe("after_fix");
  });

  it("текст ошибки — на языке запроса, и оба языка непустые и различны", () => {
    for (const lang of ["ru", "en"] as const) {
      store = createPrinciplesStore();
      const out = postPrinciples(bodyFor([priceId], lang), KEY_A, lang, deps());
      expect(out.ok).toBe(false);
      if (out.ok) continue;
      expect(out.body.error.text).toBe(catalog.errors["PRINCIPLES_ORDER_INVALID"][lang]);
    }
    for (const key of ERROR_TEXT_KEYS) {
      expect(catalog.errors[key].ru.trim(), key).not.toBe("");
      expect(catalog.errors[key].en.trim(), key).not.toBe("");
      expect(catalog.errors[key].ru, key).not.toBe(catalog.errors[key].en);
    }
  });

  it("причина отказа экрану не уходит: в теле ошибки её нет", () => {
    const out = postPrinciples(bodyFor([priceId]), KEY_A, "ru", deps());
    expect(out.ok).toBe(false);
    if (out.ok) return;
    const text = JSON.stringify(out.body);
    for (const reason of ["EXECUTION_MISSING", "UNKNOWN_ID", "DUPLICATE_ID", "EMPTY", "PRESS_INVALID"])
      expect(text, reason).not.toContain(reason);
  });

  it("статусы и классы повтора — у каждого кода свои, перечень полон", () => {
    expect(Object.keys(RETRY_BY_CODE).sort()).toEqual([...ERROR_TEXT_KEYS].sort());
    for (const [code, retry] of Object.entries(RETRY_BY_CODE)) {
      expect(UI_ERROR_STATUS[code as keyof typeof UI_ERROR_STATUS], code).toBeDefined();
      expect(["never", "after_fix", "same_key", "after_human"], code).toContain(retry);
    }
  });

  it("текстов ошибок в коде нет — только в `config/`", () => {
    for (const f of ["service.ts", "signature.ts", "model.ts", "selection.ts", "weights.ts", "index.ts"]) {
      const text = readFileSync(new URL(`../../src/principles/${f}`, import.meta.url), "utf8");
      for (const key of ERROR_TEXT_KEYS)
        for (const lang of ["ru", "en"] as const) expect(text, `${f}: ${key}`).not.toContain(catalog.errors[key][lang]);
    }
  });
});

describe("К1.5: ключ занимает любой окончательный ответ, включая отказ", () => {
  /** Правило сверено с ПАО 1.4.0 — цитаты в тесте, чтобы расхождение ловилось прогоном, а не перечитыванием. */
  const PROTOCOL = new URL("../../node_modules/agentic-buyer-ref/docs/core/protocol/AGENT-PROTOCOL.v1.4.md", import.meta.url);

  it("правило совпадает с ПАО 1.4.0 — цитаты протокола на месте", () => {
    const doc = readFileSync(PROTOCOL, "utf8");
    expect(doc).toContain("Повтор с тем же ключом и тем же телом возвращает прежний результат");
    expect(doc).toContain("с тем же ключом и другим телом → `IDEMPOTENCY_CONFLICT`");
    // отказ занимает ключ
    expect(doc).toContain("сохраняется под ключом идемпотентности");
    // исправленный запрос — новый ключ
    expect(doc).toContain("с новым `Idempotency-Key`");
    // `IDEMPOTENCY_REQUIRED` — класс `same_key`, то есть ключ им не занят
    expect(doc).toContain("У `IDEMPOTENCY_REQUIRED` — добавить ключ и повторять с ним же.");
  });

  it("повтор того же тела после `SHOWN_STALE` — тот же отказ, а не подпись", () => {
    const body = { ...bodyFor(ids), shown_hash: `sha256:${"ab".repeat(32)}` };
    const first = postPrinciples(body, KEY_A, "ru", deps());
    const again = postPrinciples(body, KEY_A, "ru", deps());
    expect(first.ok).toBe(false);
    expect(again.ok).toBe(false);
    if (again.ok) return;
    expect(again.body.error.code).toBe("SHOWN_STALE");
    expect(store.all()).toEqual([]);
    expect(written).toEqual([]);
  });

  it("повтор того же тела после `PRINCIPLES_ORDER_INVALID` — тот же отказ", () => {
    const body = bodyFor([priceId]);
    postPrinciples(body, KEY_A, "ru", deps());
    const again = postPrinciples(body, KEY_A, "ru", deps());
    expect(again.ok).toBe(false);
    if (again.ok) return;
    expect(again.body.error.code).toBe("PRINCIPLES_ORDER_INVALID");
    expect(store.all()).toEqual([]);
  });

  it("другое тело после отказа — `IDEMPOTENCY_CONFLICT`, подписи нет", () => {
    postPrinciples(bodyFor([priceId]), KEY_A, "ru", deps()); // отказ занял ключ
    const out = postPrinciples(bodyFor(ids), KEY_A, "ru", deps()); // годное тело тем же ключом
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.body.error.code).toBe("IDEMPOTENCY_CONFLICT");
    expect(store.all()).toEqual([]);
    expect(written).toEqual([]);
  });

  it("новая карточка — новое нажатие и новый ключ: сюжет целиком", () => {
    // Карточка у сервера одна, а экран прислал хэш другой — отказ с новой карточкой; человек смотрит её и
    // подтверждает заново **новым** ключом с её хэшем.
    const stale = postPrinciples({ ...bodyFor(ids), shown_hash: `sha256:${"ab".repeat(32)}` }, KEY_A, "ru", deps());
    expect(stale.ok).toBe(false);
    if (stale.ok) return;
    const fresh = stale.body.error.view;
    expect(fresh?.hash).toBe(showingHash(shownFor(ids, "ru")));
    // тем же ключом с новым телом — конфликт: ключ занят отказом
    const sameKey = postPrinciples({ ...bodyFor(ids), shown_hash: fresh?.hash as string }, KEY_A, "ru", deps());
    expect(sameKey.ok).toBe(false);
    if (sameKey.ok) return;
    expect(sameKey.body.error.code).toBe("IDEMPOTENCY_CONFLICT");
    // новым ключом с хэшем новой карточки — удача
    const out = postPrinciples({ ...bodyFor(ids), shown_hash: fresh?.hash as string }, KEY_B, "ru", deps());
    expect(out.ok).toBe(true);
    expect(store.all()).toHaveLength(1);
  });

  it("повтор отказа на другом языке: текст переводится, а карточка — нынешнего языка", () => {
    const body = { ...bodyFor(ids), shown_hash: `sha256:${"ab".repeat(32)}` };
    const ru = postPrinciples(body, KEY_A, "ru", deps());
    const en = postPrinciples(body, KEY_A, "en", deps());
    expect(ru.ok || en.ok).toBe(false);
    if (ru.ok || en.ok) return;
    expect(en.body.error.text).toBe(catalog.errors["SHOWN_STALE"].en);
    expect(en.body.error.text).not.toBe(ru.body.error.text);
    // карточка — та, которую сервер признаёт для этого языка, а не запомненная ru-карточка
    expect(en.body.error.view?.hash).toBe(showingHash(shownFor(ids, "en")));
    expect(en.body.error.view?.hash).not.toBe(ru.body.error.view?.hash);
  });

  it("`IDEMPOTENCY_REQUIRED` ключ не занимает — занимать нечего", () => {
    postPrinciples(bodyFor(ids), null, "ru", deps());
    postPrinciples(bodyFor(ids), "не-uuid", "ru", deps());
    // тот же ключ после этого свободен: тело проходит
    const out = postPrinciples(bodyFor(ids), KEY_A, "ru", deps());
    expect(out.ok).toBe(true);
  });

  it("отказ по форме тела **занимает** ключ: `order: 5` под K → 400, верное тело под K → 409", () => {
    // Решение владельца 19.11, 18:20: отпечаток берётся со снимка тела, канонизация для этого не нужна. Иначе один
    // ключ обозначал бы два действия — кривое тело 400, затем правильное тело тем же ключом → подпись.
    const broken = { ...bodyFor(ids), order: 5 } as unknown as SignRequest;
    const first = postPrinciples(broken, KEY_A, "ru", deps());
    expect(first.ok).toBe(false);
    if (first.ok) return;
    expect(first.status).toBe(400);
    expect(first.body.error.code).toBe("PRINCIPLES_ORDER_INVALID");
    const second = postPrinciples(bodyFor(ids), KEY_A, "ru", deps());
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe("IDEMPOTENCY_CONFLICT");
    expect(store.all()).toEqual([]);
    expect(written).toEqual([]);
  });

  it("повтор того же негодного тела — тот же отказ по форме, а не `IDEMPOTENCY_CONFLICT`", () => {
    const broken = { ...bodyFor(ids), order: 5 } as unknown as SignRequest;
    postPrinciples(broken, KEY_A, "ru", deps());
    const again = postPrinciples(broken, KEY_A, "ru", deps());
    expect(again.ok).toBe(false);
    if (again.ok) return;
    expect(again.body.error.code).toBe("PRINCIPLES_ORDER_INVALID");
  });

  it("тело, которое нельзя канонизировать, отпечаток всё равно получает — 400, а не исключение", () => {
    for (const order of [undefined, [undefined], Number.NaN, new Date(0)]) {
      store = createPrinciplesStore();
      const out = postPrinciples({ ...bodyFor(ids), order } as unknown as SignRequest, KEY_A, "ru", deps());
      expect(out.ok, String(order)).toBe(false);
      if (out.ok) continue;
      expect(out.status, String(order)).toBe(400);
      // и ключ занят: верное тело тем же ключом получает 409
      const next = postPrinciples(bodyFor(ids), KEY_A, "ru", deps());
      expect(next.ok, String(order)).toBe(false);
      if (next.ok) continue;
      expect(next.body.error.code, String(order)).toBe("IDEMPOTENCY_CONFLICT");
    }
  });

  it("удача ключ занимает: другое тело тем же ключом — `IDEMPOTENCY_CONFLICT`", () => {
    postPrinciples(bodyFor(ids), KEY_A, "ru", deps());
    const out = postPrinciples(bodyFor([executionId]), KEY_A, "ru", deps());
    expect(out.ok).toBe(false);
    expect(store.all()).toHaveLength(1);
  });
});
