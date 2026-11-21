// ИН-П1, кирпич К1 — данные экранов знакомства П1 и П3 (решение П34; Р-1675, Р-1676, Р-1678).
//
// Что держит этот тест: закрытые перечни полны, пары ru/en на месте, решённые владельцем формулировки закреплены
// дословно, цена агента — пара с подстановкой, а не слово, и разбор краснеет на каждой дыре, которую глазами не
// видно. Ожидания — строками и готовыми объектами, а не повторным вызовом разбора: иначе тест проверял бы разбор
// разбором.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AGENT_MODELS,
  COMPARE_ROWS,
  CONSENT_IDS,
  MONEY_PLACEHOLDER,
  ONBOARDING_ERROR_KEYS,
  ONBOARDING_SCREENS,
  SCREEN_TEXT_KEYS,
  isAgentModelId,
  isConsentId,
  modelById,
  parseOnboardingCatalog,
  pathStepOf,
} from "../../src/onboarding/index.js";

const CONFIG_URL = new URL("../../config/onboarding.default.json", import.meta.url);
const raw = JSON.parse(readFileSync(CONFIG_URL, "utf8")) as Record<string, unknown>;
const catalog = parseOnboardingCatalog(raw);

/** Копия файла данных с правкой верхнего поля — для проверок, что разбор краснеет. */
const withField = (key: string, value: unknown): unknown => ({ ...raw, [key]: value });

/** Глубокая копия: правки в проверках не должны доставать до общего `raw`. */
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

describe("данные экранов знакомства: перечни полны", () => {
  it("настоящий config/onboarding.default.json разбирается", () => {
    expect(catalog.text_version).toBe("onboarding@1.0");
  });

  it("все три вида агента на месте, в порядке перечня кодов", () => {
    expect(catalog.models.map((m) => m.id)).toEqual(["M1", "M2", "M3"]);
    expect(AGENT_MODELS).toEqual(["M1", "M2", "M3"]);
  });

  it("все четыре строки таблицы сравнения на месте, у каждой значение у каждого вида агента", () => {
    expect(catalog.compare.map((l) => l.row)).toEqual(["LIABILITY", "DISPUTE", "ALL_MERCHANTS", "MANDATES_ON_BANK_CHANGE"]);
    expect([...COMPARE_ROWS]).toEqual(["LIABILITY", "DISPUTE", "ALL_MERCHANTS", "MANDATES_ON_BANK_CHANGE"]);
    // Дословно — одно значение из канвы на оба языка: непустоту гарантирует разбор, и прежняя проверка «не пусто»
    // покраснеть не могла ни при какой поломке (находка ревью К1 № 7).
    expect(catalog.compare.find((l) => l.row === "LIABILITY")?.values["M1"]).toEqual({ ru: "банк", en: "the bank" });
    expect(catalog.compare.find((l) => l.row === "ALL_MERCHANTS")?.values["M3"]).toEqual({
      ru: "своих — первыми",
      en: "its own sellers first",
    });
  });

  it("строка про смену банка расшифрована словами, без латинского кода уровня подписи", () => {
    // Решение владельца 21.11.2026, 08:55 — **Р-1684** (кирпич К1а): в канве v2.0 стояло «сохраняются при K8, иначе
    // заново». `K8` — это уровень подписи `gov_id` (Р-1662), и человеку на экране он ничего не говорит. Формулировка
    // нарочно **не называет уровень**: его закрепит договор с банком пилота.
    const row = catalog.compare.find((l) => l.row === "MANDATES_ON_BANK_CHANGE");
    expect(row?.values["M1"]).toEqual({
      ru: "Сохраняются, если поручение подписано с подтверждением личности; иначе подписываются заново",
      en: "Kept if the mandate was signed with identity verification; otherwise signed again",
    });
    // Латиницы кода уровня не осталось ни в одном значении строки: ровно это и было дефектом.
    for (const id of AGENT_MODELS)
      for (const lang of ["ru", "en"] as const) expect(row?.values[id][lang], `${id}.${lang}`).not.toMatch(/\bK[678]\b/);
  });

  it("оба обязательных согласия на месте", () => {
    expect(catalog.consents.map((c) => c.id)).toEqual(["TERMS", "DATA"]);
    expect(CONSENT_IDS).toEqual(["TERMS", "DATA"]);
  });

  it("у каждого кода ошибки есть текст человеку", () => {
    // Перечень закреплён **литералом**, а не сравнением с самим собой: `catalog.errors` построен ровно из
    // `ONBOARDING_ERROR_KEYS`, и прежняя проверка была тождественно зелёной — она не поймала бы случай «код убрали из
    // перечня и из `config/` вместе», когда сервер § 5.18 отвечает 409 без текста человеку (находка ревью К1 № 3).
    expect([...ONBOARDING_ERROR_KEYS]).toEqual([
      "CONSENT_INVALID",
      "MODEL_NOT_AVAILABLE",
      "SHOWN_STALE",
      "IDEMPOTENCY_REQUIRED",
      "IDEMPOTENCY_CONFLICT",
    ]);
    expect(Object.keys(catalog.errors).sort()).toEqual([...ONBOARDING_ERROR_KEYS].sort());
  });

  it("перечень готовых подписей экрана закреплён литералом", () => {
    expect([...SCREEN_TEXT_KEYS]).toEqual(["accept", "why_disabled_until_all_required"]);
  });

  it("стражи перечней отвергают то, чего в перечне нет", () => {
    expect(isAgentModelId("M1")).toBe(true);
    expect(isAgentModelId("M4")).toBe(false);
    expect(isConsentId("TERMS")).toBe(true);
    expect(isConsentId("MARKETING")).toBe(false);
  });
});

describe("выбор вида агента — решение Р-1675", () => {
  it("М1 и М2 выбираются, М3 — нет", () => {
    expect(modelById(catalog, "M1")?.selectable).toBe(true);
    expect(modelById(catalog, "M2")?.selectable).toBe(true);
    expect(modelById(catalog, "M3")?.selectable).toBe(false);
  });

  it("у М3 есть причина «нельзя» и нет ни кнопки, ни набора «что может агент»", () => {
    const m3 = modelById(catalog, "M3");
    expect(m3?.why_not).toEqual({ ru: "Будет после запуска", en: "Coming after launch" });
    expect(m3?.action_label).toBeNull();
    expect(m3?.can).toEqual([]);
  });

  it("у выбираемых видов — своя подпись кнопки и свой набор «что может агент»", () => {
    expect(modelById(catalog, "M1")?.action_label?.ru).toBe("Подключить агента банка");
    expect(modelById(catalog, "M2")?.action_label?.ru).toBe("Завести своего агента");
    // Наборы **разные** (Р-1675): у своего агента оплату подтверждает человек сам, и это другой текст.
    expect(modelById(catalog, "M1")?.can).not.toEqual(modelById(catalog, "M2")?.can);
    expect(modelById(catalog, "M1")?.can.length).toBe(5);
    expect(modelById(catalog, "M2")?.can.length).toBe(6);
  });

  it("причины «нельзя» у выбираемого вида нет — иначе отказ и кнопка жили бы рядом", () => {
    expect(modelById(catalog, "M1")?.why_not).toBeNull();
    expect(modelById(catalog, "M2")?.why_not).toBeNull();
  });
});

describe("согласия — решение Р-1676 п. 2 и П26", () => {
  it("у согласия в данных нет поля отметки: умолчания не бывает", () => {
    // Поле «отмечено» в данных было бы умолчанием, которого П26 не допускает: отметку ставит человек, и приходит она
    // в теле § 5.19. Проверяется по **именам полей**, а не по значению.
    for (const item of catalog.consents) expect(Object.keys(item).sort()).toEqual(["id", "text"]);
  });

  it("тексты согласий — те, что решил владелец", () => {
    const byId = (id: "TERMS" | "DATA") => catalog.consents.find((c) => c.id === id)?.text;
    expect(byId("TERMS")?.ru).toBe("Принимаю условия агента");
    expect(byId("DATA")?.ru).toBe(
      "Согласен на обработку данных о покупках и передачу их в журнал поручений",
    );
  });

  it("пометка «демо, не оферта» и причина недоступной кнопки — дословно", () => {
    expect(catalog.demo_note).toEqual({
      ru: "Условия демо-стенда, не оферта",
      en: "Test-bench terms, not a public offer",
    });
    expect(catalog.texts["why_disabled_until_all_required"].ru).toBe(
      "Отметьте оба пункта — без них агент не может работать с вашими покупками",
    );
    expect(catalog.texts["accept"].ru).toBe("Принять условия");
  });
});

describe("шаг пути приобретения — решение Р-1678", () => {
  it("номер шага и всего шагов приходят из данных", () => {
    expect(pathStepOf(catalog, "P1")).toEqual({ n: 1, of: 8 });
    expect(pathStepOf(catalog, "P3")).toEqual({ n: 3, of: 8 });
  });

  it("экраны задачи — только П1 и П3", () => {
    expect(ONBOARDING_SCREENS).toEqual(["P1", "P3"]);
  });

  it("номер шага больше, чем всего шагов, — красный", () => {
    const screens = clone(raw["screens"]) as Record<string, Record<string, unknown>>;
    screens["P3"]!["n"] = 9;
    expect(() => parseOnboardingCatalog(withField("screens", screens))).toThrow(/screens\.P3\.n: ожидается целое от 1 до 8/);
  });
});

describe("цена агента — пара, а не слово (правило планов № 2)", () => {
  it("цена приходит парой «минимальные единицы + ISO 4217»", () => {
    expect(catalog.agent_fee).toEqual({ amount: 1, currency: "RUB" });
  });

  it("в текстах стоит подстановка, а не название единицы и не знак валюты", () => {
    expect(modelById(catalog, "M2")?.text.ru).toContain(MONEY_PLACEHOLDER);
    expect(modelById(catalog, "M2")?.text.en).toContain(MONEY_PLACEHOLDER);
    // Знак валюты и название единицы литералом — ровно то, что запрещает правило планов № 2: в английской строке
    // вышел бы неверный знак, а масштаб держался бы на слове.
    const all = JSON.stringify(raw).toLowerCase();
    // Перечень дополнен по находке ревью К1 № 6: прежний пропускал «коп.», «ruble», «cent», знаки $ и €, и текст
    // «цена агента — 1 ruble» прошёл бы зелёным.
    const forbidden = [
      "₽", "$", "€", "копейк", "коп.", "kopeck", "kopek", "рубл", "руб.", "rouble", "ruble", "rub.", "cent", "pence", "penny",
    ];
    for (const bad of forbidden) expect(all, bad).not.toContain(bad.toLowerCase());
  });

  it("цена задана, а подстановки нет ни в одном тексте — красный", () => {
    // Обратная сторона той же проверки (находка ревью К1 № 2): настройка объявляет цену своего агента (Р-1661), а
    // человек её нигде не видит — правка формулировки могла бы вынести `{money}` из текста молча.
    const models = clone(raw["models"]) as Record<string, unknown>[];
    models[1]!["text"] = { ru: "Ваш собственный инструмент.", en: "A tool of your own." };
    models[1]!["can"] = (models[1]!["can"] as unknown[]).slice(0, 5);
    expect(() => parseOnboardingCatalog(withField("models", models))).toThrow(
      /agent_fee: цена задана, но \{money\} не стоит ни в одном тексте/,
    );
  });

  it("подстановка без цены в настройке — красный", () => {
    const without = { ...raw };
    delete (without as Record<string, unknown>)["agent_fee"];
    expect(() => parseOnboardingCatalog(without)).toThrow(/agent_fee: в тексте models\.M2\.text стоит \{money\}/);
  });

  it("валюта вне таблицы ISO 4217 — красный, а не тихий показ с неверным масштабом", () => {
    expect(() => parseOnboardingCatalog(withField("agent_fee", { amount: 1, currency: "XYZ" }))).toThrow(
      /agent_fee\.currency: валюты XYZ нет в таблице ISO 4217/,
    );
  });

  it("нецелое число минимальных единиц — красный", () => {
    expect(() => parseOnboardingCatalog(withField("agent_fee", { amount: 0.5, currency: "RUB" }))).toThrow(
      /agent_fee\.amount: ожидается целое число минимальных единиц/,
    );
  });
});

describe("пары ru/en — правило планов № 3", () => {
  it("в файле данных нет ни одного текста с одним языком", () => {
    // Обход **всего** файла, а не перечисленных полей: текст, добавленный завтра в новое поле, попадёт под проверку
    // сам. Пара держится и типом, но тип не смотрит в JSON.
    const walk = (v: unknown, at: string): void => {
      if (Array.isArray(v)) {
        v.forEach((item, i) => walk(item, `${at}[${i}]`));
        return;
      }
      if (typeof v !== "object" || v === null) return;
      const o = v as Record<string, unknown>;
      const hasRu = typeof o["ru"] === "string";
      const hasEn = typeof o["en"] === "string";
      if (hasRu || hasEn) {
        expect(hasRu, `${at}: нет ru`).toBe(true);
        expect(hasEn, `${at}: нет en`).toBe(true);
        expect((o["ru"] as string).trim(), `${at}.ru`).not.toBe("");
        expect((o["en"] as string).trim(), `${at}.en`).not.toBe("");
      }
      for (const [key, value] of Object.entries(o)) walk(value, `${at}.${key}`);
    };
    walk(raw, "onboarding");
  });

  it("текст с одним языком — красный", () => {
    const models = clone(raw["models"]) as Record<string, unknown>[];
    models[0]!["name"] = { ru: "Агент банка" };
    expect(() => parseOnboardingCatalog(withField("models", models))).toThrow(/models\[0\]\.name\.en: пустая строка/);
  });

  it("лишний язык — красный: строка, которую никто не покажет, хуже отсутствующей", () => {
    const models = clone(raw["models"]) as Record<string, unknown>[];
    models[0]!["name"] = { ru: "Агент банка", en: "Bank agent", de: "Bankagent" };
    expect(() => parseOnboardingCatalog(withField("models", models))).toThrow(/models\[0\]\.name\.de: лишний язык/);
  });
});

describe("разбор краснеет на дырах, которых глазами не видно", () => {
  it("вида агента нет вовсе", () => {
    const models = (clone(raw["models"]) as Record<string, unknown>[]).filter((m) => m["id"] !== "M3");
    expect(() => parseOnboardingCatalog(withField("models", models))).toThrow(/models: вида агента M3 нет/);
  });

  it("повтор вида агента", () => {
    const models = clone(raw["models"]) as Record<string, unknown>[];
    models.push(clone(models[0]!));
    expect(() => parseOnboardingCatalog(withField("models", models))).toThrow(/models\[3\]\.id: повтор M1/);
  });

  it("дыра в таблице сравнения: у строки нет значения у одного вида агента", () => {
    const compare = clone(raw["compare"]) as Record<string, Record<string, unknown>>[];
    delete compare[0]!["values"]!["M3"];
    expect(() => parseOnboardingCatalog(withField("compare", compare))).toThrow(
      /compare\[0\]\.values\.M3: ожидается объект/,
    );
  });

  it("строки таблицы сравнения нет вовсе", () => {
    const compare = (clone(raw["compare"]) as Record<string, unknown>[]).filter((l) => l["row"] !== "DISPUTE");
    expect(() => parseOnboardingCatalog(withField("compare", compare))).toThrow(/compare: строки DISPUTE нет/);
  });

  it("согласия нет вовсе: третье согласие появляется решением, а не файлом", () => {
    const consents = (clone(raw["consents"]) as Record<string, unknown>[]).filter((c) => c["id"] !== "DATA");
    expect(() => parseOnboardingCatalog(withField("consents", consents))).toThrow(/consents: согласия DATA нет/);
  });

  it("неизвестный пункт согласия в файле", () => {
    const consents = clone(raw["consents"]) as Record<string, unknown>[];
    consents.push({ id: "MARKETING", text: { ru: "Рассылка", en: "Newsletter" } });
    expect(() => parseOnboardingCatalog(withField("consents", consents))).toThrow(/consents\[2\]\.id: ожидается TERMS \| DATA/);
  });

  it("выбираемый вид агента без подписи кнопки — кнопка в тупик", () => {
    const models = clone(raw["models"]) as Record<string, unknown>[];
    models[0]!["action_label"] = null;
    expect(() => parseOnboardingCatalog(withField("models", models))).toThrow(
      /models\[0\]\.action_label: у выбираемого вида агента нужна подпись кнопки/,
    );
  });

  it("выбираемый вид агента без набора «что может агент» — пустой экран условий", () => {
    const models = clone(raw["models"]) as Record<string, unknown>[];
    models[1]!["can"] = [];
    expect(() => parseOnboardingCatalog(withField("models", models))).toThrow(
      /models\[1\]\.can: у выбираемого вида агента нужен набор «что может агент»/,
    );
  });

  it("невыбираемый вид агента без причины — отказ без объяснения", () => {
    const models = clone(raw["models"]) as Record<string, unknown>[];
    models[2]!["why_not"] = null;
    expect(() => parseOnboardingCatalog(withField("models", models))).toThrow(
      /models\[2\]\.why_not: у невыбираемого вида агента нужна причина/,
    );
  });

  it("невыбираемый вид агента с кнопкой — тупик", () => {
    const models = clone(raw["models"]) as Record<string, unknown>[];
    models[2]!["action_label"] = { ru: "Подключить агента площадки", en: "Connect the marketplace agent" };
    expect(() => parseOnboardingCatalog(withField("models", models))).toThrow(
      /models\[2\]\.action_label: у невыбираемого вида агента кнопки нет/,
    );
  });

  it("лишнее поле у вида агента", () => {
    const models = clone(raw["models"]) as Record<string, unknown>[];
    models[0]!["weight"] = 3;
    expect(() => parseOnboardingCatalog(withField("models", models))).toThrow(/models\[0\]\.weight: лишнее поле у вида агента/);
  });

  it("лишний текст ошибки: код, которого сервер не отдаёт", () => {
    const errors = clone(raw["errors"]) as Record<string, unknown>;
    errors["PRICE_CHANGED"] = { ru: "Цена изменилась", en: "The price changed" };
    expect(() => parseOnboardingCatalog(withField("errors", errors))).toThrow(/errors\.PRICE_CHANGED: лишняя строка/);
  });

  it("лишнее поле в корне файла данных", () => {
    // Раньше проходило молча — в том числе имя платёжного поля (находка ревью К1 № 1).
    expect(() => parseOnboardingCatalog(withField("pan", "9999"))).toThrow(/onboarding\.pan: лишнее поле в данных экранов/);
  });

  it("лишнее поле у экрана: второй номер шага рядом с первым", () => {
    const screens = clone(raw["screens"]) as Record<string, Record<string, unknown>>;
    screens["P3"]!["step"] = 2;
    expect(() => parseOnboardingCatalog(withField("screens", screens))).toThrow(
      /screens\.P3\.step: лишнее поле у экрана/,
    );
  });

  it("опечатка в имени поля верхнего уровня не проходит молча", () => {
    // `demo_notes` рядом с верным `demo_note`: правленый текст не показывался бы, а разбор был зелёным.
    const broken = { ...raw, demo_notes: { ru: "Условия", en: "Terms" } };
    expect(() => parseOnboardingCatalog(broken)).toThrow(/onboarding\.demo_notes: лишнее поле в данных экранов/);
  });

  it("лишнее поле у строки таблицы сравнения", () => {
    const compare = clone(raw["compare"]) as Record<string, unknown>[];
    compare[0]!["note"] = { ru: "сноска", en: "note" };
    expect(() => parseOnboardingCatalog(withField("compare", compare))).toThrow(
      /compare\[0\]\.note: лишнее поле у строки сравнения/,
    );
  });

  it("лишнее поле у пути", () => {
    expect(() => parseOnboardingCatalog(withField("path", { of: 8, n: 1 }))).toThrow(
      /onboarding\.path\.n: лишнее поле у пути/,
    );
  });

  it("лишний экран в данных", () => {
    const screens = clone(raw["screens"]) as Record<string, unknown>;
    screens["P2"] = clone((raw["screens"] as Record<string, unknown>)["P1"]);
    expect(() => parseOnboardingCatalog(withField("screens", screens))).toThrow(/screens\.P2: лишний экран/);
  });

  it("версии текстов нет — хэшу показанного не на чем стоять", () => {
    const without = { ...raw };
    delete (without as Record<string, unknown>)["text_version"];
    expect(() => parseOnboardingCatalog(without)).toThrow(/onboarding\.text_version: пустая строка/);
  });
});
