// П-К1, К1.4 — чтение профиля для выбора: последняя подписанная версия, порт весов, строки-пояснения, ранги.
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { showingHash, type ShownPayload } from "../../src/contract/ui-v1/shown-hash.js";
import {
  NOTE_KEYS,
  article19Applied,
  byRole,
  checkOrder,
  createPrinciplesStore,
  currentPrinciples,
  defaultOrder,
  lockedId,
  noteKeysFor,
  notesFor,
  parsePrinciplesCatalog,
  ranksFor,
  signPrinciples,
  weightsFor,
  type PrinciplesJournal,
  type PrinciplesStore,
  type SignDeps,
  type SignedPrinciples,
} from "../../src/principles/index.js";
import { filesUnder } from "../support/imports.js";

const CONFIG_URL = new URL("../../config/principles.default.json", import.meta.url);
const catalog = parsePrinciplesCatalog(JSON.parse(readFileSync(CONFIG_URL, "utf8")) as unknown);
const ids = defaultOrder(catalog);
const executionId = byRole(catalog, "execution")?.id as string;
const priceId = byRole(catalog, "price")?.id as string;
const localId = catalog.items.find((p) => p.code === "LOCAL")?.id as string;

const CARD_TEXT_VERSION = catalog.text_version;
const KEY_A = "9f1c3b7e-5a24-4d8f-9b31-2c6f0ab4e7d5";
const press = { at: "2026-11-19T11:00:00Z", device: "mobile", text_version: CARD_TEXT_VERSION, gesture: "swipe" } as const;
const shownFor = (order: readonly string[]): ShownPayload => ({
  text_version: CARD_TEXT_VERSION,
  card: { items: order.map((id, i) => ({ id, rank: i + 1 })) },
});

let store: PrinciplesStore;
const journal: PrinciplesJournal = { write: () => undefined };
const deps = (): SignDeps => ({
  catalog,
  store,
  journal,
  shown: () => shownFor(ids),
  // Форма идентификатора показанного — `vw_…` (§ 3 контракта). В фикстурах П-К1 стояло `viw_…`: формы, которой
// контракт не определяет. Нашлось проверкой формы в `viewOf` (К5, замечание повторного ревью З6).
  viewId: "vw_principles_1",
  now: () => "2026-11-19T11:00:05Z",
  // Подписывает **прогон**, а не человек: 49 «человеческих» подписей в журнале были бы неправдой (П26; находка
  // ревью К1.4 № 8). Признак прогона — своё значение `test` (решение владельца 19.11, 22:10, К0а): до него здесь
  // стоял `emulator`, и прогон был неотличим от нажатия в эмуляторе интерфейса.
  by: () => "test",
});

/** Подписать порядок: карточка всюду показана по умолчанию, тело несёт свой порядок (обычный сюжет перестановки). */
function sign(order: readonly string[]): void {
  const out = signPrinciples({ order, shown_hash: showingHash(shownFor(ids)), press }, KEY_A, deps());
  expect(out.ok, JSON.stringify(order)).toBe(true);
}

beforeEach(() => {
  store = createPrinciplesStore();
});

describe("К1.4: `currentPrinciples()` — последняя подписанная версия или `null`", () => {
  it("без подписи — `null`: выбор идёт без принципов, и это рабочее состояние", () => {
    expect(currentPrinciples(store)).toBeNull();
  });

  it("порядок по умолчанию подписанным не считается", () => {
    // Перечень прочитан, порядок по умолчанию известен — и всё равно `null`, пока клиент не подтвердил свой.
    expect(defaultOrder(catalog)).toHaveLength(4);
    expect(currentPrinciples(store)).toBeNull();
  });

  it("после подписи — та самая версия", () => {
    sign([priceId, executionId]);
    const v = currentPrinciples(store);
    expect(v?.no).toBe(1);
    expect(v?.order).toEqual([priceId, executionId]);
  });

  it("после второй подписи — последняя, а не первая", () => {
    sign(ids);
    const second = signPrinciples(
      { order: [executionId], shown_hash: showingHash(shownFor(ids)), press },
      "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
      deps(),
    );
    expect(second.ok).toBe(true);
    expect(currentPrinciples(store)?.no).toBe(2);
    expect(currentPrinciples(store)?.order).toEqual([executionId]);
    // и первая версия на месте: агент может сказать, по какой версии он решал
    expect(store.all()[0]?.order).toEqual(ids);
  });
});

describe("К1.4: `weightsFor` — порт для ранжирования", () => {
  it("без подписи весов нет: ранжирование идёт без принципов", () => {
    expect(weightsFor(currentPrinciples(store), catalog)).toBeNull();
  });

  it("с подписью отдаёт вес каждого пункта перечня; выключенные — 0", () => {
    sign([executionId, localId]);
    const w = weightsFor(currentPrinciples(store), catalog);
    expect(w?.get(executionId)).toBeGreaterThan(w?.get(localId) as number);
    expect(w?.get(priceId)).toBe(0);
    expect(w?.size).toBe(catalog.items.length);
  });

  it("веса берутся от **версии**: у двух версий одного профиля веса разные", () => {
    sign([executionId, localId]); // версия 1: цена выключена
    const second = signPrinciples(
      { order: [priceId, executionId], shown_hash: showingHash(shownFor(ids)), press },
      "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
      deps(),
    );
    expect(second.ok).toBe(true);
    const v1 = weightsFor(store.all()[0] ?? null, catalog);
    const v2 = weightsFor(currentPrinciples(store), catalog);
    expect(v1?.get(priceId)).toBe(0); // в версии 1 цены в порядке нет
    expect(v2?.get(priceId)).toBe(50); // в версии 2 она первая, но ст. 19 опустила её до веса исполнения
    expect(v1?.get(localId)).toBe(50);
    expect(v2?.get(localId)).toBe(0);
    expect(v1?.get(priceId)).not.toBe(v2?.get(priceId));
    expect(v1?.get(localId)).not.toBe(v2?.get(localId));
  });

  it("веса считаются по версии, а не по порядку перечня: реализация, игнорирующая версию, была бы красной", () => {
    sign([priceId, executionId]); // порядок, обратный перечню
    const w = weightsFor(currentPrinciples(store), catalog);
    const byDefault = weightsFor({ ...(currentPrinciples(store) as SignedPrinciples), order: ids }, catalog);
    expect(w?.get(localId)).toBe(0);
    expect(byDefault?.get(localId)).toBeGreaterThan(0);
    expect(w?.get(localId)).not.toBe(byDefault?.get(localId));
  });

  it("пункт, убранный из `config/` после подписи, выпадает и из рангов, и из весов", () => {
    sign([executionId, localId, priceId]);
    const version = currentPrinciples(store) as SignedPrinciples;
    const smaller = parsePrinciplesCatalog({
      ...(JSON.parse(readFileSync(CONFIG_URL, "utf8")) as Record<string, unknown>),
      items: (JSON.parse(readFileSync(CONFIG_URL, "utf8")) as { items: Record<string, unknown>[] }).items.filter(
        (it) => it["code"] !== "LOCAL",
      ),
    });
    const w = weightsFor(version, smaller);
    const rows = ranksFor(version, smaller);
    // наборы сходятся: ни веса, ни ранга у выбывшего пункта нет, и веса остальных не сдвинуты лишним участником
    expect(w?.size).toBe(smaller.items.length);
    expect(w?.has(localId)).toBe(false);
    expect(rows).toHaveLength(smaller.items.length);
    expect(rows.some((r) => r.id === localId)).toBe(false);
    expect([...rows.map((r) => r.id)].sort()).toEqual([...smaller.items.map((p) => p.id)].sort());
    expect(rows.filter((r) => r.on).map((r) => r.id)).toEqual([executionId, priceId]);
    expect(w?.get(executionId)).toBe(100);
    expect(w?.get(priceId)).toBe(50);
  });
});

/** Все подмножества и перестановки — ст. 19 проверяется на принимаемых порядках целиком. */
function subsetsOf<T>(items: readonly T[]): T[][] {
  return items.reduce<T[][]>((acc, item) => [...acc, ...acc.map((s) => [...s, item])], [[]]);
}

function permutationsOf<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]];
  return items.flatMap((item, i) =>
    permutationsOf([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest]),
  );
}

describe("К1.4: ст. 19 на всех перестановках и подмножествах — через порт", () => {
  it("вес цены не выше веса исполнения ни на одном подписываемом порядке; непринимаемые — отклоняются", () => {
    let checked = 0;
    let rejected = 0;
    for (const subset of subsetsOf(ids))
      for (const order of permutationsOf(subset)) {
        store = createPrinciplesStore();
        // Принимаемость берётся **у источника** — `checkOrder`, а не пересказывается условием теста: появится ещё
        // одна запертая роль, и перебор пойдёт за правилом сам (находка ревью К1.4 № 6).
        if (!checkOrder(order, catalog).ok) {
          const out = signPrinciples({ order, shown_hash: showingHash(shownFor(ids)), press }, KEY_A, deps());
          expect(out.ok, order.join(">")).toBe(false);
          rejected += 1;
          continue;
        }
        sign(order);
        const w = weightsFor(currentPrinciples(store), catalog);
        checked += 1;
        if (!order.includes(priceId)) continue;
        expect(w?.get(priceId), order.join(">")).toBeLessThanOrEqual(w?.get(executionId) as number);
      }
    // страховка: без перестановок проверка прошла бы вхолостую, а порядки без исполнения — действительно отклонены
    expect(checked).toBe(49);
    expect(rejected).toBeGreaterThan(0);
    expect(checked + rejected).toBe(subsetsOf(ids).reduce((n, s) => n + permutationsOf(s).length, 0));
  });

  it("ст. 19 ищет пункты по роли: переименуй код — правило держится", () => {
    const renamed = parsePrinciplesCatalog({
      ...(JSON.parse(readFileSync(CONFIG_URL, "utf8")) as Record<string, unknown>),
      items: (JSON.parse(readFileSync(CONFIG_URL, "utf8")) as { items: Record<string, unknown>[] }).items.map((it) =>
        it["role"] === "price" ? { ...it, code: "CHEAPER" } : it,
      ),
    });
    const exec = byRole(renamed, "execution")?.id as string;
    const price = byRole(renamed, "price")?.id as string;
    expect(article19Applied([price, exec], renamed)).toBe(true);
    expect(article19Applied([exec, price], renamed)).toBe(false);
  });

  it("признак срабатывания — без числа потолка: число это вес", () => {
    expect(typeof article19Applied([priceId, executionId], catalog)).toBe("boolean");
  });
});

describe("К1.4: строки-пояснения — текстами из `config/`, на двух языках", () => {
  it("«надёжность исполнения учитывается всегда» — показывается всегда, в том числе без подписи", () => {
    expect(noteKeysFor(null, catalog)).toEqual(["execution_always"]);
    sign([executionId, localId]);
    expect(noteKeysFor(currentPrinciples(store), catalog)).toEqual(["execution_always"]);
  });

  it("«цена учитывается не выше надёжности исполнения» — когда ст. 19 опустила вес цены", () => {
    sign([priceId, executionId]);
    expect(noteKeysFor(currentPrinciples(store), catalog)).toEqual(["execution_always", "price_capped"]);
  });

  it("исполнение выше цены — второй строки нет: сервер ничего не опускал", () => {
    sign([executionId, priceId]);
    expect(noteKeysFor(currentPrinciples(store), catalog)).toEqual(["execution_always"]);
  });

  it("текст — на языке запроса, из перечня, оба языка непустые и различны", () => {
    sign([priceId, executionId]);
    const v = currentPrinciples(store);
    const keys = noteKeysFor(v, catalog);
    // Сверка идёт с источником — `catalog.notes`, а не с литералом: банк меняет текст настройкой, и тест не должен
    // краснеть без дефекта в коде (находка ревью К1.4 № 5).
    for (const lang of ["ru", "en"] as const)
      expect(notesFor(v, catalog, lang)).toEqual(keys.map((k) => catalog.notes[k][lang]));
    const [ru, en] = [notesFor(v, catalog, "ru"), notesFor(v, catalog, "en")];
    expect(en).toHaveLength(ru.length);
    for (const [i, line] of en.entries()) {
      expect(line.trim()).not.toBe("");
      expect(line).not.toBe(ru[i]);
    }
  });

  it("формулировка в перечне по умолчанию — та, которую назвал владелец (П32 доп. 1)", () => {
    // Отдельное ожидание именно к `config/principles.default.json`: решённый владельцем текст закреплён здесь, а
    // не в сверке вывода (его банк меняет настройкой).
    const raw = JSON.parse(readFileSync(CONFIG_URL, "utf8")) as { notes: Record<string, { ru: string; en: string }> };
    expect(raw.notes["execution_always"]?.ru).toBe("Надёжность исполнения учитывается всегда — правило системы");
    expect(raw.notes["price_capped"]?.ru).toBe("Цена учитывается не выше надёжности исполнения — правило системы");
  });

  it("текстов пояснений нет нигде в `src/` — только в `config/`", () => {
    // Файлы — обходом каталога, а не перечнем имён: новый файл модуля или литерал в `src/pult` иначе выпал бы из
    // проверки (находка ревью К1.4 № 4; память «Закрытые перечни — из кода источника», Р-1511).
    const files = filesUnder(new URL("../../src/", import.meta.url).pathname.replace(/\/$/, ""));
    expect(files.length).toBeGreaterThan(20);
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const key of NOTE_KEYS)
        for (const lang of ["ru", "en"] as const)
          expect(text, `${file}: ${key}.${lang}`).not.toContain(catalog.notes[key][lang]);
    }
  });

  it("перечень строк закрыт: лишняя строка в `config/` — ошибка формы", () => {
    const raw = JSON.parse(readFileSync(CONFIG_URL, "utf8")) as Record<string, unknown>;
    const notes = { ...(raw["notes"] as object), extra: { ru: "а", en: "b" } };
    expect(() => parsePrinciplesCatalog({ ...raw, notes })).toThrow(/notes\.extra: лишняя строка/);
  });

  it("нет строк или нет одного языка — ошибка формы: профиль без пояснений не стартует", () => {
    const raw = JSON.parse(readFileSync(CONFIG_URL, "utf8")) as Record<string, unknown>;
    const without = Object.fromEntries(Object.entries(raw).filter(([key]) => key !== "notes"));
    expect(() => parsePrinciplesCatalog(without)).toThrow(/notes: ожидается объект/);
    const half = { ...(raw["notes"] as Record<string, unknown>), price_capped: { ru: "Цена" } };
    expect(() => parsePrinciplesCatalog({ ...raw, notes: half })).toThrow(/price_capped\.en: пустая строка/);
  });
});

describe("К1.4: ранги и запертый пункт — всё, что экран узнаёт о важности", () => {
  it("без подписи ранги — по перечню, все включены", () => {
    expect(ranksFor(null, catalog)).toEqual(ids.map((id, i) => ({ id, rank: i + 1, on: true })));
  });

  it("с подписью — ранги по версии, выключенные в конце и помечены", () => {
    sign([priceId, executionId]);
    expect(ranksFor(currentPrinciples(store), catalog)).toEqual([
      { id: priceId, rank: 1, on: true },
      { id: executionId, rank: 2, on: true },
      { id: localId, rank: 3, on: false },
      { id: catalog.items.find((p) => p.code === "NEAR")?.id, rank: 4, on: false },
    ]);
  });

  it("ранги — подряд и без повторов, по одному на каждый пункт перечня", () => {
    sign([executionId, localId]);
    const rows = ranksFor(currentPrinciples(store), catalog);
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 3, 4]);
    expect(new Set(rows.map((r) => r.id)).size).toBe(catalog.items.length);
  });

  it("весов среди рангов нет ни одного поля", () => {
    sign(ids);
    const rows = ranksFor(currentPrinciples(store), catalog);
    for (const row of rows) expect(Object.keys(row).sort()).toEqual(["id", "on", "rank"]);
  });

  it("запертый пункт — опознавателем, экрану не нужно знать ни кода, ни роли", () => {
    expect(lockedId(catalog)).toBe(executionId);
  });
});
