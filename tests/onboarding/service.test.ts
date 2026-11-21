// ИН-П1, кирпич К3 — сервисы `GET /ui/v1/onboarding` (§ 5.17) и `GET /ui/v1/onboarding/terms` (§ 5.18).
//
// Что держит этот тест: тела собраны **сервером целиком** (экран ничего не считает — правило 3), порядок видов агента
// и строк сравнения берётся из закрытых перечней кода, а не из файла настройки, сумма подставлена форматом по валюте
// и языку, невыбираемый вид агента даёт один отказ с классом `never`, хэш показанного считается по **ровно
// показанному** и меняется от модели и языка. Ожидание хэша — от **своей копии** карточки, собранной здесь руками, а
// не повторным вызовом сборки сервера: иначе проверка сверяла бы код с самим собой.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { showingHash, UI_ERROR_STATUS } from "../../src/contract/ui-v1/index.js";
import { getOnboarding, getOnboardingTerms, parseOnboardingCatalog, shownTerms, termsView } from "../../src/onboarding/index.js";

const CONFIG_URL = new URL("../../config/onboarding.default.json", import.meta.url);
const catalog = parseOnboardingCatalog(JSON.parse(readFileSync(CONFIG_URL, "utf8")) as unknown);
const deps = { catalog, viewId: "vw_p3_1" } as const;

/**
 * Цена агента, как её печатает формат по валюте и языку: `amount: 1` при двух знаках ISO 4217 — это 0,01 ₽.
 *
 * Пробел перед знаком валюты (и после кода в английской строке) — **неразрывный**, U+00A0: так его ставит
 * `Intl.NumberFormat`. Здесь он записан escape-последовательностью нарочно: невидимый знак в ожидании теста — это
 * полчаса на «строки же одинаковые», что и случилось при первом прогоне этого кирпича.
 */
const MONEY = { ru: "0,01 ₽", en: "RUB 0.01" } as const;

describe("§ 5.17 GET /ui/v1/onboarding — экран П1", () => {
  const ru = getOnboarding("ru", deps);

  it("шаг пути приходит обёрткой path с числами внутри", () => {
    // Обёртка названа `path`, а не `step`: ключ `step` в контракте занят значениями `U1…U7` (§ 4), и один ключ в двух
    // смыслах жить не может. Внутри — прежние `n` и `of` (Р-1678).
    expect(ru.path).toEqual({ n: 1, of: 8 });
    expect(ru).not.toHaveProperty("step");
  });

  it("версия текстов — из данных, она же входит в хэш карточки П3", () => {
    expect(ru.text_version).toBe("onboarding@1.0");
  });

  it("виды агента идут в порядке закрытого перечня кодов, а не файла настройки", () => {
    expect(ru.models.map((m) => m.id)).toEqual(["M1", "M2", "M3"]);
  });

  it("на П1 нет ни view, ни хэша: человек здесь ничего не подтверждает", () => {
    expect(ru).not.toHaveProperty("view");
    expect(JSON.stringify(ru)).not.toContain("sha256:");
  });

  it("доступность и причину решает сервер, а не экран", () => {
    const m1 = ru.models.find((m) => m.id === "M1")!;
    const m3 = ru.models.find((m) => m.id === "M3")!;
    expect(m1.selectable).toBe(true);
    expect(m1.why_not).toBeNull();
    expect(m1.action_label).toBe("Подключить агента банка");
    expect(m3.selectable).toBe(false);
    expect(m3.why_not).toBe("Будет после запуска");
    // У невыбираемого вида кнопки нет вовсе: подпись кнопки рядом с отказом была бы тупиком.
    expect(m3.action_label).toBeNull();
    expect(m3.can).toEqual([]);
  });

  it("у каждого выбираемого вида свой набор «что может агент»", () => {
    const can = (id: string): readonly string[] => ru.models.find((m) => m.id === id)!.can;
    expect(can("M1").length).toBe(5);
    expect(can("M2").length).toBe(6);
    expect(can("M1")).not.toEqual(can("M2"));
    expect(can("M1")[0]).toBe("Покупает только то и только на ту сумму, что вы поручили");
  });

  it("таблица сравнения — все четыре строки в порядке перечня, со значением у каждого вида", () => {
    expect(ru.compare.map((l) => l.row)).toEqual(["LIABILITY", "DISPUTE", "ALL_MERCHANTS", "MANDATES_ON_BANK_CHANGE"]);
    for (const line of ru.compare) expect(Object.keys(line.values).sort(), line.row).toEqual(["M1", "M2", "M3"]);
    expect(ru.compare.find((l) => l.row === "LIABILITY")!.values["M1"]).toBe("банк");
    expect(ru.compare.find((l) => l.row === "MANDATES_ON_BANK_CHANGE")!.values["M1"]).toBe(
      "Сохраняются, если поручение подписано с подтверждением личности; иначе подписываются заново",
    );
  });

  it("сумма подставлена форматом по валюте и языку, пометки в ответе не осталось", () => {
    const m2ru = ru.models.find((m) => m.id === "M2")!;
    const m2en = getOnboarding("en", deps).models.find((m) => m.id === "M2")!;
    // 1 копейка — это `amount: 1` при двух знаках ISO 4217, то есть 0,01 ₽. Проверяется **точная** строка: «строка
    // содержит единицу» прошла бы и при ошибке масштаба в сто раз.
    expect(m2ru.text).toBe(`Ваш собственный инструмент за ${MONEY.ru}. Сделка напрямую с продавцом, без посредника.`);
    expect(m2en.text).toBe(
      `A tool of your own for ${MONEY.en}. The deal goes straight to the seller, with no intermediary.`,
    );
    expect(JSON.stringify(ru)).not.toContain("{money}");
    expect(JSON.stringify(getOnboarding("en", deps))).not.toContain("{money}");
  });

  it("языки дают разные тела: ни одна строка не приходит на чужом языке", () => {
    const en = getOnboarding("en", deps);
    expect(en.models.find((m) => m.id === "M3")!.why_not).toBe("Coming after launch");
    expect(en.compare.find((l) => l.row === "LIABILITY")!.values["M1"]).toBe("the bank");
    expect(JSON.stringify(en)).not.toBe(JSON.stringify(ru));
  });
});

describe("§ 5.18 GET /ui/v1/onboarding/terms — экран П3", () => {
  it("карточка условий собрана целиком, на выбранный вид агента", () => {
    const got = getOnboardingTerms("M2", "ru", deps);
    expect(got.ok).toBe(true);
    if (!got.ok) return;
    expect(got.body.model).toBe("M2");
    expect(got.body.path).toEqual({ n: 3, of: 8 });
    expect(got.body.demo_note).toBe("Условия демо-стенда, не оферта");
    expect(got.body.can.length).toBe(6);
    expect(got.body.can[5]).toBe(`Цена агента — ${MONEY.ru}, на стенде она не списывается`);
  });

  it("оба согласия обязательны, и поля «отмечено» в карточке нет", () => {
    const got = getOnboardingTerms("M1", "ru", deps);
    if (!got.ok) throw new Error("ожидалась карточка");
    expect(got.body.consents.map((c) => c.id)).toEqual(["TERMS", "DATA"]);
    for (const c of got.body.consents) {
      expect(c.required, c.id).toBe(true);
      // Поле с умолчанием было бы предотмеченным согласием (П26, Р-1676 п. 2): отметку ставит человек, и приходит
      // она в теле § 5.19.
      expect(Object.keys(c).sort(), c.id).toEqual(["id", "required", "text"]);
    }
    expect(got.body.consents[0]!.text).toBe("Принимаю условия агента");
  });

  it("кнопка недоступна, и причину даёт сервер готовым текстом", () => {
    const got = getOnboardingTerms("M1", "ru", deps);
    if (!got.ok) throw new Error("ожидалась карточка");
    // Карточка выдаётся до того, как человек что-либо отметил, а обе галочки пусты — значит кнопка недоступна, и
    // человек должен прочитать почему (правило 3: причину называет сервер).
    expect(got.body.actions.accept).toEqual({
      enabled: false,
      label: "Принять условия",
      why_disabled: "Отметьте оба пункта — без них агент не может работать с вашими покупками",
    });
  });

  it("карточка приходит на языке запроса целиком, а не наполовину", () => {
    const got = getOnboardingTerms("M2", "en", deps);
    if (!got.ok) throw new Error("ожидалась карточка");
    expect(got.body.demo_note).toBe("Test-bench terms, not a public offer");
    expect(got.body.actions.accept.label).toBe("Accept the terms");
    expect(got.body.actions.accept.why_disabled).toBe(
      "Tick both items — without them the agent cannot work with your purchases",
    );
    expect(got.body.consents[0]!.text).toBe("I accept the agent's terms");
    expect(got.body.can[5]).toBe(`The agent costs ${MONEY.en}; on the test bench it is not charged`);
  });

  it("невыбираемый вид агента — один отказ с классом never", () => {
    const got = getOnboardingTerms("M3", "ru", deps);
    expect(got.ok).toBe(false);
    if (got.ok) return;
    expect(got.status).toBe(UI_ERROR_STATUS["MODEL_NOT_AVAILABLE"]);
    expect(got.status).toBe(409);
    expect(got.body.error.code).toBe("MODEL_NOT_AVAILABLE");
    expect(got.body.error.retry).toBe("never");
    expect(got.body.error.text).toBe("Этот вид агента ещё недоступен. Выберите агента банка или своего агента");
    expect(got.body.error.view).toBeNull();
  });

  it("неизвестный код и пустой параметр дают тот же ответ, что невыбираемый вид", () => {
    const m3 = getOnboardingTerms("M3", "ru", deps);
    // По разнице ответов иначе стало бы видно, какие коды вообще существуют.
    for (const bad of ["M4", "", "m1", "../M1"]) {
      const got = getOnboardingTerms(bad, "ru", deps);
      expect(got.ok, bad).toBe(false);
      if (got.ok || m3.ok) return;
      expect(JSON.stringify(got.body), bad).toBe(JSON.stringify(m3.body));
    }
  });

  it("отказ приходит на языке запроса", () => {
    const got = getOnboardingTerms("M3", "en", deps);
    if (got.ok) throw new Error("ожидался отказ");
    expect(got.body.error.text).toBe(
      "This kind of agent is not available yet. Choose the bank's agent or your own agent",
    );
  });
});

describe("правило 1 — хэш показанного", () => {
  /** **Своя копия** показанного, собранная здесь руками: ожидание не берётся повторным вызовом сборки сервера. */
  const myCard = (model: "M1" | "M2", lang: "ru" | "en"): unknown => {
    const m = catalog.models.find((x) => x.id === model)!;
    const fill = (s: string): string => s.replaceAll("{money}", MONEY[lang]);
    return {
      model,
      can: m.can.map((t) => fill(t[lang])),
      demo_note: catalog.demo_note[lang],
      consents: [
        { id: "TERMS", text: catalog.consents.find((c) => c.id === "TERMS")!.text[lang], required: true },
        { id: "DATA", text: catalog.consents.find((c) => c.id === "DATA")!.text[lang], required: true },
      ],
      accept: {
        label: catalog.texts["accept"][lang],
        why_disabled: catalog.texts["why_disabled_until_all_required"][lang],
      },
    };
  };

  it("хэш карточки считается по ровно показанному", () => {
    const expected = showingHash({ text_version: "onboarding@1.0", card: myCard("M2", "ru") });
    expect(termsView("M2", "ru", deps).hash).toBe(expected);
    const got = getOnboardingTerms("M2", "ru", deps);
    if (!got.ok) throw new Error("ожидалась карточка");
    // Хэш в теле ответа — тот же: экран подтверждает ровно то, что получил.
    expect(got.body.view.hash).toBe(expected);
    expect(got.body.view).toEqual({ view_id: deps.viewId, text_version: "onboarding@1.0", hash: expected });
  });

  it("опознаватель своей копии карточки берётся из настройки, а не из литерала в коде", () => {
    // Ожидание литералом, равным значению в `deps`, оставалось бы зелёным, если сервис вшил бы `"vw_p3_1"` прямо в
    // код (находка ревью К3 № 5). Поэтому — вторые зависимости с другим опознавателем.
    // Форма опознавателя — `vw_…` латиницей: её проверяет `viewOf` (`isViewId`, кирпичи К4 и К5 окна А), поэтому
    // второй опознаватель берётся по форме, а не произвольной строкой.
    const other = { catalog, viewId: "vw_p3_2" } as const;
    expect(termsView("M1", "ru", other).view_id).toBe("vw_p3_2");
    const got = getOnboardingTerms("M1", "ru", other);
    if (!got.ok) throw new Error("ожидалась карточка");
    expect(got.body.view.view_id).toBe("vw_p3_2");
    // Хэш от опознавателя не зависит: он считается по показанному, а `view_id` — ссылка на свою копию.
    expect(got.body.view.hash).toBe(termsView("M1", "ru", deps).hash);
  });

  it("опознаватель не по форме — исключение, а не тихая выдача карточки", () => {
    // Страж формы пришёл со слиянием (`isViewId`): по опознавателю сервер находит свою копию показанного, и чужое
    // или пустое значение видно только на разборе, когда искать уже поздно.
    for (const bad of ["p3_1", "", "vw_", "копия"])
      expect(() => termsView("M1", "ru", { catalog, viewId: bad }), bad).toThrow(/не в форме vw_/);
  });

  it("другая модель — другой хэш", () => {
    expect(termsView("M1", "ru", deps).hash).not.toBe(termsView("M2", "ru", deps).hash);
  });

  it("другой язык — другой хэш: человек подтверждал те тексты, которые видел", () => {
    expect(termsView("M2", "ru", deps).hash).not.toBe(termsView("M2", "en", deps).hash);
  });

  it("подмена одной строки карточки меняет хэш", () => {
    const base = shownTerms("M1", "ru", deps);
    const { card } = base;
    const tampered = {
      text_version: base.text_version,
      card: { ...card, consents: [{ ...card.consents[0]!, text: "Согласен со всем" }, card.consents[1]!] },
    };
    expect(showingHash(tampered)).not.toBe(showingHash(base));
  });

  it("шаг пути в хэш не входит: навигация не отменяет подтверждения", () => {
    expect(Object.keys(shownTerms("M1", "ru", deps).card).sort()).toEqual([
      "accept",
      "can",
      "consents",
      "demo_note",
      "model",
    ]);
  });

  it("форма хэша — sha256 и 64 знака", () => {
    expect(termsView("M1", "en", deps).hash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});
