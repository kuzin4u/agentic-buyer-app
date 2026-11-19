// П-К1, К1.2 — модель профиля предпочтений: перечень по умолчанию данными, порядок как перестановка подмножества,
// пустые параметры и область, открытый перечень источников изменения, неизменяемая версия, веса наружу не выходят.
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  FIRST_VERSION_NO,
  KNOWN_CHANGE_SOURCES,
  PRINCIPLE_ROLES,
  byRole,
  checkOrder,
  defaultOrder,
  isKnownChangeSource,
  nextVersion,
  parsePrinciplesCatalog,
  type PrinciplesCatalog,
  type SignedPrinciples,
} from "../../src/principles/index.js";
import { weightsOf } from "../../src/principles/weights.js";
import { filesUnder, specifiers } from "../support/imports.js";

/** Путь — один способ на весь файл: от этого файла, а не от каталога запуска. */
const CONFIG_URL = new URL("../../config/principles.default.json", import.meta.url);
const CONTRACT_DIR = new URL("../../src/contract/ui-v1/", import.meta.url);
const SRC_DIR = new URL("../../src/", import.meta.url);
const PRINCIPLES_DIR = new URL("../../src/principles/", import.meta.url);
const raw = JSON.parse(readFileSync(CONFIG_URL, "utf8")) as unknown;
const catalog = parsePrinciplesCatalog(raw);

/** Четыре пункта перечня по умолчанию — решение владельца 19.11 (PR #24 `#issuecomment-7006766298`); роли —
 *  решение владельца 19.11, 14:51 (П32 дополнение 1). */
const EXPECTED = [
  { code: "EXECUTION", role: "execution", ru: "Надёжное исполнение: вовремя, без ошибок и споров", en: "Reliable fulfilment: on time, accurate, no disputes" },
  { code: "LOCAL", role: null, ru: "Местный производитель", en: "Local producer" },
  { code: "NEAR", role: null, ru: "Ближе, быстрее доставка", en: "Closer, faster delivery" },
  { code: "PRICE", role: "price", ru: "Дешевле", en: "Lower price" },
] as const;

const executionId = byRole(catalog, "execution")?.id as string;
const priceId = byRole(catalog, "price")?.id as string;

describe("К1.2: перечень по умолчанию — данными в config/, не кодом", () => {
  it("состав и тексты ru и en — те, что назвал владелец", () => {
    expect(catalog.items.map((p) => p.code)).toEqual(EXPECTED.map((e) => e.code));
    for (const [i, e] of EXPECTED.entries()) {
      expect(catalog.items[i]?.text.ru).toBe(e.ru);
      expect(catalog.items[i]?.text.en).toBe(e.en);
    }
  });

  it("роли расставлены в файле: исполнение и цена — по одному пункту, у прочих роли нет", () => {
    expect(catalog.items.map((p) => p.role)).toEqual(EXPECTED.map((e) => e.role));
    expect(byRole(catalog, "execution")?.code).toBe("EXECUTION");
    expect(byRole(catalog, "price")?.code).toBe("PRICE");
    expect([...PRINCIPLE_ROLES]).toEqual(["execution", "price"]);
  });

  it("у каждого пункта оба языка непустые — экран с первого коммита на двух языках (правило планов № 3)", () => {
    for (const p of catalog.items) {
      expect(p.text.ru.trim(), p.code).not.toBe("");
      expect(p.text.en.trim(), p.code).not.toBe("");
      expect(p.text.ru, p.code).not.toBe(p.text.en);
    }
  });

  it("версия текстов есть и входит в карточку подтверждения (правило 1 К-Б)", () => {
    expect(catalog.text_version).toBe("principles@1.0");
  });

  it("перечня принципов в коде нет — тексты только в config/", () => {
    for (const file of filesUnder(PRINCIPLES_DIR.pathname)) {
      const text = readFileSync(file, "utf8");
      for (const e of EXPECTED) expect(text, `${file}: ${e.code}`).not.toContain(e.ru);
    }
  });
});

describe("К1.2: проверка формы перечня", () => {
  const good = JSON.parse(readFileSync(CONFIG_URL, "utf8")) as {
    items: Record<string, unknown>[];
    text_version: string;
    notes: unknown;
  };
  /** Пункты с ролями, чтобы проверяемый случай падал на том, что проверяется, а не на отсутствии роли. */
  const required = good.items.filter((it) => it["role"] !== undefined);
  const withItems = (items: unknown[]): unknown => ({ text_version: "principles@1.0", notes: good.notes, items: [...required, ...items] });
  const onlyItems = (items: unknown[]): unknown => ({ text_version: "principles@1.0", notes: good.notes, items });

  it("пустой перечень — ошибка: профиль без принципов не стартует", () => {
    expect(() => parsePrinciplesCatalog(onlyItems([]))).toThrow(/пустой перечень/);
  });

  it("повтор `id` — ошибка", () => {
    expect(() => parsePrinciplesCatalog(onlyItems([good.items[0], good.items[0]]))).toThrow(/повтор prn_execution/);
  });

  it("повтор `code` при разных `id` — ошибка: два пункта под одним весом", () => {
    const twin = { ...(good.items[1] as object), id: "prn_local_2" };
    expect(() => parsePrinciplesCatalog(withItems([good.items[1], twin]))).toThrow(/повтор LOCAL/);
  });

  it("`id` и `code` — по форме", () => {
    expect(() => parsePrinciplesCatalog(onlyItems([{ ...(good.items[0] as object), id: "Местный" }]))).toThrow(/id: ожидается/);
    expect(() => parsePrinciplesCatalog(onlyItems([{ ...(good.items[0] as object), code: "execution" }]))).toThrow(/code: ожидается/);
  });

  it("пустой текст одного из языков — ошибка", () => {
    const item = { ...(good.items[0] as { text: unknown }), text: { ru: "Надёжное исполнение", en: "  " } };
    expect(() => parsePrinciplesCatalog(onlyItems([item]))).toThrow(/text\.en: пустая строка/);
  });

  it("нет версии текстов — ошибка", () => {
    expect(() => parsePrinciplesCatalog({ items: good.items })).toThrow(/text_version/);
  });

  it("параметры и область можно не писать — тогда они пусты", () => {
    for (const p of catalog.items) {
      expect(p.params).toEqual({ threshold: null, strength: null });
      expect(p.scope).toEqual({ category: null, situation: null });
    }
  });

  it("заполненные параметры или область — ошибка формы: смысла у них пока нет (ВР-5, И-7)", () => {
    const withParams = { ...(good.items[1] as object), id: "prn_x", code: "X", params: { threshold: 3 } };
    expect(() => parsePrinciplesCatalog(withItems([withParams]))).toThrow(/params\.threshold: пока не заполняется/);
    const withScope = { ...(good.items[1] as object), id: "prn_y", code: "Y", scope: { category: "tools" } };
    expect(() => parsePrinciplesCatalog(withItems([withScope]))).toThrow(/scope\.category: пока не заполняется/);
  });

  it("лишнее поле у пункта — ошибка: `weight` в перечне не пройдёт молча (П32)", () => {
    const withWeight = { ...(good.items[1] as object), id: "prn_z", code: "Z", weight: 99 };
    expect(() => parsePrinciplesCatalog(withItems([withWeight]))).toThrow(/weight: лишнее поле у пункта/);
    const withRank = { ...(good.items[1] as object), id: "prn_w", code: "W", rank: 1 };
    expect(() => parsePrinciplesCatalog(withItems([withRank]))).toThrow(/rank: лишнее поле у пункта/);
  });

  describe("правила не снимаются настройкой: роли обязательны и по одной", () => {
    for (const role of PRINCIPLE_ROLES)
      it(`нет пункта с ролью ${role} — ошибка формы, как у неполного бренда`, () => {
        const without = good.items.map((it) => (it["role"] === role ? { ...it, role: undefined } : it));
        expect(() => parsePrinciplesCatalog(onlyItems(without))).toThrow(
          new RegExp(`роль ${role} у 0 пунктов, нужен ровно один`),
        );
      });

    it("два пункта с одной ролью — ошибка формы: правило не знало бы, за кем из них идти", () => {
      const twice = good.items.map((it) => (it["code"] === "NEAR" ? { ...it, role: "price" } : it));
      expect(() => parsePrinciplesCatalog(onlyItems(twice))).toThrow(/роль price у 2 пунктов, нужен ровно один/);
    });

    it("переименование кода правило **не** снимает: роль живёт полем, а не кодом", () => {
      const renamed = good.items.map((it) => (it["code"] === "PRICE" ? { ...it, code: "CHEAPER" } : it));
      const parsed = parsePrinciplesCatalog(onlyItems(renamed));
      expect(byRole(parsed, "price")?.code).toBe("CHEAPER");
      expect(byRole(parsed, "execution")?.code).toBe("EXECUTION");
    });

    it("незнакомая роль — ошибка формы, а не «без роли»: опечатка не лишит правило пункта", () => {
      const typo = good.items.map((it) => (it["role"] === "price" ? { ...it, role: "prise" } : it));
      expect(() => parsePrinciplesCatalog(onlyItems(typo))).toThrow(/role: ожидается execution \| price/);
    });
  });
});

describe("К1.2: порядок — перестановка подмножества известных `id`", () => {
  const ids = catalog.items.map((p) => p.id);

  it("порядок по умолчанию — порядок пунктов в файле", () => {
    expect(defaultOrder(catalog)).toEqual(ids);
  });

  it("полная перестановка принимается", () => {
    expect(checkOrder([...ids].reverse(), catalog)).toEqual({ ok: true });
  });

  it("подмножество принимается: выключенный пункт — это пропуск", () => {
    expect(checkOrder([ids[3] as string, executionId], catalog)).toEqual({ ok: true });
    expect(checkOrder([executionId], catalog)).toEqual({ ok: true });
  });

  it("пустой порядок не принимается: «без принципов» — это `signed: null`, а не версия без пунктов", () => {
    expect(checkOrder([], catalog)).toEqual({ ok: false, reason: "EMPTY" });
  });

  it("незнакомый `id` — не принимается", () => {
    expect(checkOrder(["prn_unknown"], catalog)).toEqual({ ok: false, reason: "UNKNOWN_ID", id: "prn_unknown" });
  });

  it("повтор `id` — не принимается", () => {
    expect(checkOrder([executionId, executionId], catalog)).toEqual({
      ok: false,
      reason: "DUPLICATE_ID",
      id: executionId,
    });
  });

  describe("надёжное исполнение переставляется, но не выключается (решение владельца 19.11)", () => {
    it("порядок без пункта роли «исполнение» не принимается", () => {
      expect(checkOrder([priceId], catalog)).toEqual({ ok: false, reason: "EXECUTION_MISSING", id: executionId });
      expect(checkOrder(ids.filter((id) => id !== executionId), catalog)).toEqual({
        ok: false,
        reason: "EXECUTION_MISSING",
        id: executionId,
      });
    });

    it("переставить его можно куда угодно, в том числе последним", () => {
      const moved = [...ids.filter((id) => id !== executionId), executionId];
      expect(checkOrder(moved, catalog)).toEqual({ ok: true });
    });

    it("прочие пункты выключаются свободно", () => {
      for (const id of ids.filter((i) => i !== executionId))
        expect(checkOrder(ids.filter((i) => i !== id), catalog), id).toEqual({ ok: true });
    });

    it("правило держится ролью, а не кодом: переименуй код — правило останется", () => {
      const raw = JSON.parse(readFileSync(CONFIG_URL, "utf8")) as { items: Record<string, unknown>[] };
      const renamed = parsePrinciplesCatalog({
        ...raw,
        items: raw.items.map((it) => (it["role"] === "execution" ? { ...it, code: "RELIABLE" } : it)),
      });
      const execId = byRole(renamed, "execution")?.id as string;
      expect(checkOrder(renamed.items.map((p) => p.id).filter((id) => id !== execId), renamed)).toEqual({
        ok: false,
        reason: "EXECUTION_MISSING",
        id: execId,
      });
    });
  });
});

describe("К1.2: подписанная версия — номер по возрастанию и неизменяемость", () => {
  const ids = catalog.items.map((p) => p.id);
  /** Здесь версии текстов нарочно различны, чтобы подмена `view.text_version` на `press.text_version` в
   *  `nextVersion` была красной: эта функция складывает версию из готовых частей и сверять их не её дело.
   *  **На границе `/ui` это одна и та же величина** (§ 3 контракта, пример: у `view` и у `press` один
   *  `u1-card@1.0`), и расхождение до `nextVersion` не доходит — его отклоняет подпись (К1.3, `SHOWN_STALE`). */
  const PRESS_TEXT_VERSION = "principles@1.0-device";
  const VIEW_HASH = `sha256:${"0f".repeat(32)}`;
  const press = { at: "2026-11-19T11:00:00Z", device: "mobile", text_version: PRESS_TEXT_VERSION, gesture: "swipe" } as const;
  const view = { hash: VIEW_HASH, text_version: catalog.text_version };
  const built = (order: readonly string[], at: string) => ({
    order,
    view,
    press,
    received_at: at,
    source: "CLIENT",
  });

  it("первая версия — номер 1", () => {
    expect(nextVersion(null, built(ids, "2026-11-19T11:00:01Z")).no).toBe(FIRST_VERSION_NO);
    expect(FIRST_VERSION_NO).toBe(1);
  });

  it("вторая подпись прежнюю не стирает и не правит: номер растёт, первая версия та же", () => {
    const first = nextVersion(null, built(ids, "2026-11-19T11:00:01Z"));
    const snapshot = JSON.parse(JSON.stringify(first)) as SignedPrinciples;
    const second = nextVersion(first, built([ids[3] as string], "2026-11-19T12:00:02Z"));
    expect(second.no).toBe(first.no + 1);
    expect(first).toEqual(snapshot);
    expect(second.order).not.toEqual(first.order);
  });

  it("версия заморожена целиком, а не только снаружи: подмена поля в рантайме не проходит", () => {
    const v = nextVersion(null, built(ids, "2026-11-19T11:00:01Z"));
    for (const [what, o] of [
      ["версия", v],
      ["порядок", v.order],
      ["карточка", v.view],
      ["провенанс", v.press],
    ] as const)
      expect(Object.isFrozen(o), what as string).toBe(true);
    expect(() => {
      (v as { no: number }).no = 99;
    }).toThrow(TypeError);
    expect(() => {
      (v.view as { hash: string }).hash = "sha256:подделка";
    }).toThrow(TypeError);
    expect(() => {
      (v.press as { at: string }).at = "2001-01-01T00:00:00Z";
    }).toThrow(TypeError);
    expect(v.no).toBe(FIRST_VERSION_NO);
    expect(v.view.hash).toBe(VIEW_HASH);
    expect(v.press.at).toBe(press.at);
  });

  it("хэш показанного и провенанс не меняются вслед за объектами, из которых собрали версию", () => {
    const liveView = { hash: VIEW_HASH, text_version: catalog.text_version };
    const livePress = {
      at: press.at as string,
      device: press.device,
      text_version: PRESS_TEXT_VERSION,
      gesture: press.gesture,
    };
    const v = nextVersion(null, { order: ids, view: liveView, press: livePress, received_at: "2026-11-19T11:00:01Z", source: "CLIENT" });
    liveView.hash = `sha256:${"ff".repeat(32)}`;
    livePress.at = "2001-01-01T00:00:00Z";
    expect(v.view.hash).toBe(VIEW_HASH);
    expect(v.press.at).toBe(press.at);
  });

  it("версия текстов карточки берётся из карточки, а не из провенанса", () => {
    const v = nextVersion(null, built(ids, "2026-11-19T11:00:01Z"));
    expect(v.view.text_version).toBe(catalog.text_version);
    expect(v.press.text_version).toBe(PRESS_TEXT_VERSION);
    expect(v.view.text_version).not.toBe(v.press.text_version);
  });

  it("порядок версии не меняется вслед за массивом, из которого её собрали", () => {
    const order = [...ids];
    const v = nextVersion(null, built(order, "2026-11-19T11:00:01Z"));
    order.reverse();
    expect(v.order).toEqual(ids);
  });

  it("время сервера не подменяет время устройства (П26)", () => {
    const v = nextVersion(null, built(ids, "2026-11-19T11:00:05Z"));
    expect(v.press.at).toBe(press.at);
    expect(v.received_at).toBe("2026-11-19T11:00:05Z");
    expect(v.received_at).not.toBe(v.press.at);
  });

  it("поля версии не переписываются: типы только для чтения", () => {
    // Проверка на компиляции (`tsc --noEmit` в `npm run check`): тело не исполняется — в рантайме версия заморожена
    // и присваивание бросило бы `TypeError` раньше, чем проверился тип.
    const typesOnly = (v: SignedPrinciples): void => {
      // @ts-expect-error номер версии только для чтения
      v.no = 2;
      // @ts-expect-error порядок версии только для чтения
      v.order = [];
      // @ts-expect-error провенанс нажатия только для чтения
      v.press = press;
    };
    expect(typeof typesOnly).toBe("function");
  });
});

describe("К1.2: источник изменения версии — открытый перечень", () => {
  it("известные значения — клиент и принятый совет обучения (И-8)", () => {
    expect([...KNOWN_CHANGE_SOURCES]).toEqual(["CLIENT", "LEARNING_ACCEPTED"]);
    expect(isKnownChangeSource("CLIENT")).toBe(true);
    expect(isKnownChangeSource("LEARNING_ACCEPTED")).toBe(true);
  });

  it("неизвестное значение читается, а не ломает чтение: перечень открыт", () => {
    const source: string = "SOMETHING_NEW";
    expect(isKnownChangeSource(source)).toBe(false);
  });
});

/** Имена полей, объявленных в тексте модуля: `readonly x:` и `x:` — **в любом месте строки**, а не только в начале.
 *  Привязка к началу строки брала бы с каждой строки только первое поле, и внутристрочное объявление
 *  `readonly items: readonly { readonly id: string; readonly weight: number }[]` прошло бы как `items` (находка
 *  ревью К1.2 № 1). Именно так объявлен `PrinciplesResponse` в § 5.14, то есть самый вероятный путь утечки весов. */
function declaredKeys(text: string): string[] {
  return [...text.matchAll(/(?:^|[{;,(\s])(?:readonly\s+)?([A-Za-z_][A-Za-z0-9_]*)\??\s*:/g)].map((m) => m[1] as string);
}

const WEIGHT = /weight|вес/i;

describe("К1.2: веса наружу не выходят", () => {
  /** Файлы модуля контракта — **из каталога**, а не перечнем в тесте: новый файл иначе выпал бы из проверки
   *  (память «Закрытые перечни — из кода источника», Р-1511). */
  const contractFiles = readdirSync(CONTRACT_DIR).filter((n) => n.endsWith(".ts"));

  it("файлы модуля контракта найдены все", () => {
    expect(contractFiles.length).toBeGreaterThanOrEqual(7);
    expect(contractFiles).toContain("methods.ts");
    expect(contractFiles).toContain("shown-hash.ts");
  });

  /** Ссылка на модуль весов — по имени файла, в любой форме записи (`./weights.js`, `./weights.ts`, `./weights`). */
  const isWeights = (s: string): boolean => /(^|\/)weights(\.(js|ts|mjs))?$/.test(s);

  it("из имён с «вес» наружу выходит только порт `weightsFor` — карты среди них нет", async () => {
    // Порт нужен пучкам и ВР **внутри сервера** (постановка К1.4), поэтому имя с «weight» на поверхности одно и
    // названо здесь поимённо. Карта (`weightsOf`, `Weights`, `Article19`) наружу не идёт, и это держат два
    // соседних случая: ссылки на `./weights.js` в `index.ts` нет, а в типах `/ui/v1` нет поля `weight`.
    const surface = Object.keys((await import("../../src/principles/index.js")) as object);
    expect(surface.filter((n) => WEIGHT.test(n))).toEqual(["weightsFor"]);
    expect(surface).not.toContain("weightsOf");
  });

  it("`index.ts` не реэкспортирует `weights.ts` — ни значением, ни типом", () => {
    // `Object.keys` импортированного модуля типы **не видит**: `export type { Weights } from "./weights.js"` дал бы
    // пустые ключи и зелёный тест (находка ревью № 3 второго прохода). Поэтому смотрим текст: ссылки на модуль
    // весов в `index.ts` нет ни одной. В `Article19` лежит `ceiling` — вес, а веса наружу не выходят (П32).
    const text = readFileSync(new URL("index.ts", PRINCIPLES_DIR), "utf8");
    expect(specifiers(text).some(isWeights)).toBe(false);
    // проверка ловит подделку — в том числе реэкспорт типа
    expect(specifiers(`export type { Weights } from "./weights.js";`).some(isWeights)).toBe(true);
    expect(specifiers(`export { weightsOf } from "./weights.js";`).some(isWeights)).toBe(true);
  });

  it("`weights.ts` ввозится только внутри `src/principles/` — порт, а не карта (правило планов № 1 по форме)", () => {
    const root = SRC_DIR.pathname.replace(/\/$/, "");
    const all = filesUnder(root).map((f) => f.replace(/\\/g, "/"));
    // страховка: без файлов проверка прошла бы вхолостую
    expect(all.length).toBeGreaterThan(20);
    expect(all).toContain(`${root}/principles/weights.ts`);
    const outside = all
      .filter((f) => !f.startsWith(`${root}/principles/`))
      .filter((f) => specifiers(readFileSync(f, "utf8")).some(isWeights));
    expect(outside).toEqual([]);
    // проверка ловит подделку: ввоз карты из чужого модуля был бы красным
    expect(specifiers(`import { weightsOf } from "../principles/weights.ts";`).some(isWeights)).toBe(true);
  });

  it("в типах контракта `/ui/v1` поля `weight` нет ни одного (инвариант 1 и правило 3, как в К2.4)", () => {
    const perFile = new Map<string, { keys: number; declares: boolean }>();
    for (const f of contractFiles) {
      const text = readFileSync(new URL(f, CONTRACT_DIR), "utf8");
      const keys = declaredKeys(text);
      perFile.set(f, { keys: keys.length, declares: /^\s*readonly\s/m.test(text) });
      for (const key of keys) expect(WEIGHT.test(key), `${f}: ${key}`).toBe(false);
    }
    // Страховка по файлам, а не суммой: `methods.ts` один даёт больше сотни имён, и выборка **без него** прошла бы
    // общий порог (находка ревью № 7 второго прохода). Проверяется, что в главном файле имён много, а в каждом
    // файле, который вообще объявляет поля, они нашлись. Сборный `index.ts` полей не объявляет — и не должен.
    expect(perFile.get("methods.ts")?.keys ?? 0).toBeGreaterThan(100);
    for (const [f, { keys, declares }] of perFile) if (declares) expect(keys, f).toBeGreaterThan(0);
    expect([...perFile.values()].filter((v) => v.declares).length).toBeGreaterThanOrEqual(4);
  });

  it("проверка ловит подделку: внутристрочное `weight` в § 5.14 было бы красным", () => {
    const forged = `export interface PrinciplesResponse {
  readonly items: readonly { readonly id: string; readonly weight: number; readonly rank: number }[];
}`;
    const keys = declaredKeys(forged);
    expect(keys).toContain("weight");
    expect(keys).toContain("rank");
    expect(keys.some((k) => WEIGHT.test(k))).toBe(true);
  });

  it("настоящий `PrinciplesResponse` разбирается до последнего поля — проверка смотрит туда, где объявлены `items`", () => {
    const keys = declaredKeys(readFileSync(new URL("methods.ts", CONTRACT_DIR), "utf8"));
    for (const key of ["items", "id", "text", "rank", "signed", "view", "order", "shown_hash", "press"])
      expect(keys, key).toContain(key);
  });

  it("разрешённые имена проверкой не задеты", () => {
    for (const ok of ["rank", "order", "id", "text_version", "view"]) expect(WEIGHT.test(ok), ok).toBe(false);
  });
});

/** Все подмножества перечня, включая пустое: ст. 19 проверяется на подмножествах, а не только на перестановках. */
function subsetsOf<T>(items: readonly T[]): T[][] {
  return items.reduce<T[][]>((acc, item) => [...acc, ...acc.map((s) => [...s, item])], [[]]);
}

/** Все перестановки набора. */
function permutationsOf<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]];
  return items.flatMap((item, i) =>
    permutationsOf([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest]),
  );
}

describe("К1.2: карта «ранг → вес» — внутри сервера, ст. 19 на всех порядках", () => {
  const ids = catalog.items.map((p) => p.id);
  const idOf = (code: string): string => catalog.items.find((p) => p.code === code)?.id as string;

  it("вес убывает по месту в порядке, выключенный пункт — 0", () => {
    const { byId } = weightsOf([ids[1] as string, ids[2] as string], catalog);
    expect(byId.get(ids[1] as string)).toBeGreaterThan(byId.get(ids[2] as string) as number);
    expect(byId.get(ids[0] as string)).toBe(0);
    expect(byId.get(ids[3] as string)).toBe(0);
  });

  it("порядок клиента принимается как есть: цена выше исполнения — порядок не переставлен", () => {
    const order = [priceId, executionId];
    const { byId, article19 } = weightsOf(order, catalog);
    expect(article19.applied).toBe(true);
    expect(byId.get(priceId)).toBeLessThanOrEqual(byId.get(executionId) as number);
  });

  it("исполнение выше цены — ст. 19 ничего не меняет", () => {
    const { article19 } = weightsOf([executionId, priceId], catalog);
    expect(article19.applied).toBe(false);
  });

  it("ст. 19 держится на **всех** перестановках и подмножествах, где есть исполнение", () => {
    // Порядок без исполнения до весов не доходит: его отклоняет `checkOrder` (`EXECUTION_MISSING`), и это
    // проверено выше. Здесь — что на каждом принимаемом порядке вес цены не выше веса исполнения.
    let checked = 0;
    for (const subset of subsetsOf(ids)) {
      for (const order of permutationsOf(subset)) {
        if (!checkOrder(order, catalog).ok) continue;
        checked += 1;
        const { byId } = weightsOf(order, catalog);
        if (!order.includes(priceId)) continue;
        expect(byId.get(priceId), order.join(">")).toBeLessThanOrEqual(byId.get(executionId) as number);
      }
    }
    // страховка: без перестановок проверка прошла бы вхолостую (8 подмножеств с исполнением × их перестановки)
    expect(checked).toBe(49);
  });

  it("цены в порядке нет — ст. 19 не о чем", () => {
    const { article19 } = weightsOf([executionId, idOf("LOCAL")], catalog);
    expect(article19).toEqual({ applied: false, ceiling: null });
  });

  it("перечень без ролей (минуя проверку формы) — ст. 19 не о чем, веса считаются", () => {
    const small: PrinciplesCatalog = {
      text_version: "t@1",
      notes: catalog.notes,
      items: catalog.items.filter((p) => p.role === null),
    };
    const { byId, article19 } = weightsOf(
      small.items.map((p) => p.id),
      small,
    );
    expect(article19.ceiling).toBeNull();
    expect(byId.size).toBe(2);
  });
});
