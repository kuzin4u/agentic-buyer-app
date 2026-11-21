// ИН-П1, кирпич К6 — инвариант 1 на всех телах знакомства: **реквизиты недоступны**.
//
// Просеиваются **общим** перечнем `tests/support/forbidden-fields.ts` (Р-1679): своего перечня окно Б не заводит —
// второй стал бы вторым источником одной нормы и разошёлся бы с первым, как уже разошлись три копии до его
// появления (находка ревью Б1 окна А).
//
// Просеивается не «тип глазами», а **настоящие тела**: § 5.17, § 5.18, удачный ответ § 5.19, все четыре отказа
// § 5.19, подписанная версия согласия (её отдаёт `GET` и читает спор) и обе записи журнала. Имена полей берутся
// обходом в глубину, включая ключи объектов внутри массивов.
//
// И главное: **проверка показана красной**. Ниже стоит фикстура с запретным полем в ответе, на которой тот же
// просев обязан упасть. Без неё общий перечень был бы третьей тождественно зелёной проверкой за сутки: одна искала
// в минифицированном бандле имена, которых там не бывает, другая обходила импорты там, где их нет (блокеры второго
// прохода ревью К5). Фикстура остаётся в тестах — она и есть доказательство, что просев жив.
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { IDEMPOTENCY_HEADER } from "../../src/contract/ui-v1/index.js";
import {
  createConsentStore,
  getOnboarding,
  getOnboardingTerms,
  parseOnboardingCatalog,
  postConsent,
  termsView,
  type ConsentAcceptedEntry,
  type ConsentRefusedEntry,
} from "../../src/onboarding/index.js";
import { hasCardNumber } from "../../src/pult/engine.js";
import {
  Sessions,
  startUiServer,
  type CorePurchase,
  type UiCorePort,
  type UiServer,
} from "../../src/ui-server/index.js";
import { cardLikeNumber } from "../support/card-like.js";
import {
  ALLOWED_EXAMPLES,
  FORBIDDEN_EXAMPLES,
  hitsForbidden,
} from "../support/forbidden-fields.js";

const catalog = parseOnboardingCatalog(
  JSON.parse(
    readFileSync(
      new URL("../../config/onboarding.default.json", import.meta.url),
      "utf8",
    ),
  ) as unknown,
);
const deps = { catalog, viewId: "vw_p3_1" } as const;

/** Все имена полей значения, в глубину: ключи объектов, в том числе внутри массивов. Значения не смотрим — инвариант
 *  1 про **поля**: «на экране и в журнале — только идентификаторы». */
function fieldNames(
  value: unknown,
  into: Set<string> = new Set(),
): ReadonlySet<string> {
  if (Array.isArray(value)) {
    for (const item of value) fieldNames(item, into);
    return into;
  }
  if (value === null || typeof value !== "object") return into;
  for (const [key, inner] of Object.entries(value)) {
    into.add(key);
    fieldNames(inner, into);
  }
  return into;
}

/** Все строковые значения в глубину — для просева **содержимого**, а не только имён. */
function strings(value: unknown, into: string[] = []): readonly string[] {
  if (typeof value === "string") {
    into.push(value);
    return into;
  }
  if (Array.isArray(value)) {
    for (const item of value) strings(item, into);
    return into;
  }
  if (value === null || typeof value !== "object") return into;
  for (const inner of Object.values(value)) strings(inner, into);
  return into;
}

/**
 * Просев: ни одно **имя поля** не попадает под общий перечень, и ни одно **значение** не выглядит номером карты.
 *
 * Имена — это буква инварианта 1. Значения — его смысл: тексты карточки приходят из `config/` и целиком уходят
 * человеку на экран, и реквизит, попавший в текст условий, нарушает инвариант так же, как поле (находка ревью К6
 * № 4). Похожее на номер ищет `hasCardNumber` приложения (фильтр Луна, R41) — свой второй фильтр здесь был бы
 * вторым источником одной нормы.
 *
 * Сообщение называет **поле и тело**, иначе на большом ответе искать нечего.
 */
function sift(what: string, body: unknown): void {
  for (const name of fieldNames(body))
    expect(hitsForbidden(name), `${what}: поле ${name}`).toBe(false);
  for (const text of strings(body))
    expect(hasCardNumber(text), `${what}: значение «${text}»`).toBe(false);
}

// ── Сам перечень жив ────────────────────────────────────────────────────────────────────────────────────────────────

test("общий перечень ловит запретные имена и не трогает идентификаторы", () => {
  // Самопроверка перечня: испорченный или пустой перечень иначе зеленел бы на всём.
  for (const name of FORBIDDEN_EXAMPLES)
    expect(hitsForbidden(name), name).toBe(true);
  for (const name of ALLOWED_EXAMPLES)
    expect(hitsForbidden(name), name).toBe(false);
});

test("просев **падает** на теле с запретным полем — фикстура, доказывающая, что проверка жива", () => {
  // Та же функция `sift`, что просеивает настоящие тела, на подложном ответе § 5.19 с реквизитом внутри.
  const tampered = {
    consent: {
      version: 1,
      model: "M1",
      accepted: ["TERMS", "DATA"],
      by: "human",
      received_at: "2026-11-22T00:00:00Z",
      shown: {
        hash: `sha256:${"a".repeat(64)}`,
        text_version: "onboarding@1.0",
      },
      // Вот оно: поле, которого в теле контракта быть не может ни при каких обстоятельствах. **Значения у него нет**:
      // просев смотрит имена, а номер карты — даже похожий, даже тестовый — в коде, тестах и фикстурах запрещён
      // (CLAUDE.md, «Секреты»). Строку, похожую на номер, собирает во время прогона `tests/support/card-like.ts`, и
      // в файлы она не попадает.
      card_number: null,
    },
    path: { n: 3, of: 8 },
  };
  expect(() => sift("подложный § 5.19", tampered)).toThrow(/card_number/);

  // Верхний уровень — самый частый случай, и он тоже показан красным.
  expect(() => sift("подложный верхний уровень", { cvv: null })).toThrow(/cvv/);

  // И глубже — внутри массива: обход должен достать и оттуда.
  const deep = { items: [{ ok: 1 }, { nested: { cryptogram: null } }] };
  expect(() => sift("подложное вложение", deep)).toThrow(/cryptogram/);

  // **Значение**, похожее на номер карты, в законном поле: имя чистое, а инвариант нарушен — просев обязан упасть и
  // на этом. Строка собирается во время прогона (`cardLikeNumber`), в файлы не пишется.
  const inText = {
    can: [`Цена агента — 1 копейка, карта ${cardLikeNumber("4")}`],
  };
  expect(() => sift("подложный текст условий", inText)).toThrow(/значение/);

  // А на чистом теле та же функция молчит — иначе она падала бы всегда и тоже ничего не проверяла.
  expect(() =>
    sift("чистое тело", {
      consent: { version: 1, model: "M1", instrument_token: "tok_1" },
      can: ["Цена агента — 0,01 ₽"],
    }),
  ).not.toThrow();
});

// ── Тела сервисов ───────────────────────────────────────────────────────────────────────────────────────────────────

test("§ 5.17 и § 5.18 на двух языках — реквизитов нет", () => {
  for (const lang of ["ru", "en"] as const) {
    sift(`§ 5.17 ${lang}`, getOnboarding(lang, deps));
    for (const model of ["M1", "M2"] as const) {
      const got = getOnboardingTerms(model, lang, deps);
      expect(got.ok, `${model} ${lang}`).toBe(true);
      sift(`§ 5.18 ${model} ${lang}`, got.body);
    }
    // Отказ § 5.18 тоже тело контракта: его просеиваем так же.
    const refused = getOnboardingTerms("M3", lang, deps);
    expect(refused.ok).toBe(false);
    sift(`§ 5.18 отказ ${lang}`, refused.body);
  }
});

test("§ 5.19: удачный ответ, подписанная версия и запись журнала — реквизитов нет", () => {
  const written: ConsentAcceptedEntry[] = [];
  const refusals: ConsentRefusedEntry[] = [];
  const store = createConsentStore();
  const service = {
    ...deps,
    store,
    journal: {
      write: (e: ConsentAcceptedEntry) => void written.push(e),
      refused: (e: ConsentRefusedEntry) => void refusals.push(e),
    },
    now: () => "2026-11-22T00:00:00Z",
    by: () => "human" as const,
  };
  const press = {
    at: "2026-11-22T00:00:00Z",
    device: "mobile",
    text_version: "onboarding@1.0",
    gesture: "tap",
  } as const;
  const got = postConsent(
    {
      model: "M1",
      accepted: ["TERMS", "DATA"],
      shown_hash: termsView("M1", "ru", deps).hash,
      press,
    },
    "own_1",
    "ru",
    service,
  );
  expect(got.ok).toBe(true);
  if (!got.ok) return;

  sift("§ 5.19 удачный ответ", got.body);
  // Подписанная версия живёт в хранилище и уходит в спор — её просеиваем целиком, включая провенанс. Сначала
  // утверждается, что она **есть**: на `null` просев пуст и тождественно зелен, а ключ хранилища по владельцу
  // (П34 п. 4) — ровно то место, где регрессия даёт `null` (находка ревью К6 № 2).
  const version = store.last("own_1");
  expect(version).not.toBeNull();
  sift("подписанная версия", version);
  // Число записей — **до** просева: на пустом журнале просев пуст, и падало бы не то, что проверяется (№ 6).
  expect(written.length).toBe(1);
  sift("журнал: согласие принято", written[0]);
  // И ни одной записи об отказе при удачном согласии (№ 7).
  expect(refusals).toEqual([]);
});

test("§ 5.19: формы всех отказов и записи журнала об отказе — реквизитов нет", () => {
  // Название честное: у четырёх отказов набор имён один и тот же (`error/code/retry/text/view`), различается только
  // `view` у `SHOWN_STALE` (находка ревью К6 № 8). Ценность теста не в четырёх телах, а в **записях журнала**: у них
  // причины разные, и каждая просеивается.
  const refusals: ConsentRefusedEntry[] = [];
  const service = {
    ...deps,
    store: createConsentStore(),
    journal: {
      write: () => undefined,
      refused: (e: ConsentRefusedEntry) => void refusals.push(e),
    },
    now: () => "2026-11-22T00:00:00Z",
    by: () => "human" as const,
  };
  const press = {
    at: "2026-11-22T00:00:00Z",
    device: "mobile",
    text_version: "onboarding@1.0",
    gesture: "tap",
  } as const;
  const hash = termsView("M1", "ru", deps).hash;

  const cases: readonly [string, unknown][] = [
    [
      "CONSENT_INVALID: не все обязательные",
      { model: "M1", accepted: ["TERMS"], shown_hash: hash, press },
    ],
    [
      "CONSENT_INVALID: негодная форма",
      { model: "M1", accepted: "TERMS", shown_hash: hash, press },
    ],
    [
      "MODEL_NOT_AVAILABLE",
      { model: "M3", accepted: ["TERMS", "DATA"], shown_hash: hash, press },
    ],
    [
      "SHOWN_STALE",
      {
        model: "M1",
        accepted: ["TERMS", "DATA"],
        shown_hash: `sha256:${"0".repeat(64)}`,
        press,
      },
    ],
  ];
  for (const [what, body] of cases) {
    const got = postConsent(body, "own_1", "ru", service);
    expect(got.ok, what).toBe(false);
    if (!got.ok) sift(what, got.body);
  }
  // Записи журнала об отказах: причина внутри них есть, реквизитов — нет. Причины **разные** — иначе четыре случая
  // проверяли бы одно и то же.
  expect(refusals.length).toBe(4);
  expect(refusals.map((e) => e.reason)).toEqual([
    "REQUIRED_MISSING",
    "BODY_SHAPE",
    "MODEL_NOT_SELECTABLE",
    "SHOWN_MISMATCH",
  ]);
  for (const entry of refusals) sift("журнал: отказ", entry);
});

// ── То же на границе: ответ, который реально уходит экрану ───────────────────────────────────────────────────────────
//
// Своим блоком с своими хуками: сервер поднимается только для сетевых проверок, а синтетическим выше он не нужен
// (находка ревью К6 № 11).

describe("по сети", () => {
  let server: UiServer;
  let sessions: Sessions;
  let jar: string;

  const core: UiCorePort = {
    purchase: async () => null as unknown as CorePurchase | null,
    subscribe: () => () => undefined,
  };

  beforeEach(async () => {
    sessions = new Sessions();
    server = await startUiServer({
      core,
      owner: (req) => sessions.ownerOf(req),
      shell: {
        brandPath: "config/brand.demo.json",
        sessions,
        ownerOnPage: () => "own_1",
      },
      onboarding: {
        catalog,
        viewId: "vw_p3_1",
        store: createConsentStore(),
        journal: { write: () => undefined, refused: () => undefined },
        now: () => "2026-11-22T00:00:00Z",
      },
    });
    jar = (await fetch(`${server.url}/ui`)).headers
      .get("set-cookie")!
      .split(";")[0]!;
  });

  afterEach(async () => {
    await server.close();
  });

  test("тела, которые уходят экрану по сети, просеиваются тем же перечнем", async () => {
    // Сервис и сеть — два разных пути к телу: просеивается **то, что человек получит**, а не только то, что собрал
    // сервис. Заодно виден словарь каркаса: он тоже уходит экрану.
    //
    // У каждого адреса назван **ожидаемый статус** (находка ревью К6 № 3): без этого регрессия сессии дала бы на все
    // четыре адреса единый `SESSION_REQUIRED` 401 — тоже JSON, тоже без реквизитов, — и просев прошёл бы по телу
    // ошибки, оставшись зелёным, ничего не проверив.
    const paths: readonly [string, number][] = [
      ["/ui/shell", 200],
      ["/ui/v1/onboarding", 200],
      ["/ui/v1/onboarding/terms?model=M2", 200],
      ["/ui/v1/onboarding/terms?model=M3", 409],
    ];
    for (const [path, status] of paths) {
      const res = await fetch(`${server.url}${path}`, {
        headers: { cookie: jar },
      });
      expect(res.status, path).toBe(status);
      sift(path, await res.json());
    }
  });

  test("ответ § 5.19 по сети — реквизитов нет ни в удаче, ни в отказе", async () => {
    const press = {
      at: "2026-11-22T00:00:00Z",
      device: "web",
      text_version: "onboarding@1.0",
      gesture: "tap",
    };
    const post = (body: unknown): Promise<Response> =>
      fetch(`${server.url}/ui/v1/consent`, {
        method: "POST",
        headers: {
          cookie: jar,
          "content-type": "application/json",
          [IDEMPOTENCY_HEADER]: randomUUID(),
        },
        body: JSON.stringify(body),
      });

    const ok = await post({
      model: "M1",
      accepted: ["TERMS", "DATA"],
      shown_hash: termsView("M1", "ru", deps).hash,
      press,
    });
    expect(ok.status).toBe(200);
    sift("§ 5.19 по сети, удача", await ok.json());

    const bad = await post({
      model: "M1",
      accepted: ["TERMS"],
      shown_hash: termsView("M1", "ru", deps).hash,
      press,
    });
    expect(bad.status).toBe(400);
    sift("§ 5.19 по сети, отказ", await bad.json());
  });
});
