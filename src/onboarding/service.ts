// ИН-П1, кирпич К3 — сервисы `GET /ui/v1/onboarding` (§ 5.17) и `GET /ui/v1/onboarding/terms` (§ 5.18).
//
// Здесь собираются тела ответов **целиком**: экран ничего не считает и ничего не формулирует (правило 3 К-Б).
// Доступность вида агента, обязательность пунктов согласия, доступность кнопки и текст «почему нельзя» приходят
// готовыми; сумма подставляется **сервером** общим показом суммы, а не экраном (инвариант 2, правило планов № 2).
//
// Контракт — К-Б `/ui/v1` **v1.3** (действующая версия; файл внесён в git кирпичом К7 этой же задачи). Одно отличие
// от черновика постановки, и оно названо решением: шаг пути приходит обёрткой **`path`**, а внутри прежние `n` и
// `of` — ключ `step` в контракте занят значениями `U1…U7` (§ 4), и один ключ в двух смыслах жить не может.
//
// Чего здесь нет: записи согласия и правил HTTP — это кирпич К4 (`POST /ui/v1/consent`), и `view` этой карточки
// сверяется там же по правилу 1.
import type {
  OnboardingResponse,
  OnboardingTermsResponse,
  UiAction,
  UiErrorBody,
  UiLang,
  UiView,
} from "../contract/ui-v1/index.js";
import { UI_ERROR_STATUS, UI_RETRY, viewOf, type ShownPayload } from "../contract/ui-v1/index.js";
import { formatMoneyText } from "../money.js";
import {
  AGENT_MODELS,
  COMPARE_ROWS,
  CONSENT_IDS,
  MONEY_PLACEHOLDER,
  isAgentModelId,
  modelById,
  pathStepOf,
  type AgentModelId,
  type OnboardingCatalog,
  type OnboardingText,
} from "./model.js";

/**
 * Карточка условий П3 — **типом, а не `unknown`** (находка ревью К3 № 3).
 *
 * `ShownPayload.card` объявлен `unknown`: канонизации всё равно, что хэшировать. Но тело § 5.18 собирается **из этой
 * же карточки**, и пока она была `unknown` с приведением на месте, обещание «тело равно хэшированному» держалось на
 * глазах: переименуй здесь `demo_note` в `note` — компилятор молчит, в тело уходит `undefined`, а хэш считается по
 * новому имени. Теперь форма названа, и расхождение ловит сборка.
 */
export interface TermsCard {
  readonly model: string;
  readonly can: readonly string[];
  readonly demo_note: string;
  readonly consents: readonly { readonly id: string; readonly text: string; readonly required: boolean }[];
  readonly accept: { readonly label: string; readonly why_disabled: string };
}

/** Показанное на П3: версия текстов и карточка известной формы. */
export interface TermsShown extends ShownPayload {
  readonly card: TermsCard;
}

/** Зависимости сервисов знакомства. Данные — разобранным перечнем, опознаватель своей копии карточки — настройкой:
 *  оба знает тот, кто поднял сервер, а не маршрут. */
export interface OnboardingServiceDeps {
  readonly catalog: OnboardingCatalog;
  /** опознаватель своей копии показанной карточки для `view` (§ 3, правило 1) */
  readonly viewId: string;
}

/**
 * Подстановка суммы в текст.
 *
 * Сумма приходит **парой** и печатается общим показом суммы (`src/money.ts`), поэтому знак валюты и разделители
 * берутся у локали, а не стоят в тексте литералом (правило планов № 2). Текста без подстановки это не касается:
 * `replaceAll` по отсутствующей пометке ничего не делает.
 *
 * Цены в настройке нет (`agent_fee: null`) — значит и пометки `{money}` нет ни в одном тексте: это держит разбор
 * перечня (`parseOnboardingCatalog`), поэтому здесь нечего подставлять и нечего ронять.
 */
const withMoney = (text: string, lang: UiLang, catalog: OnboardingCatalog): string =>
  catalog.agent_fee === null ? text : text.replaceAll(MONEY_PLACEHOLDER, formatMoneyText(catalog.agent_fee, lang));

/** Строка на языке запроса, с подставленной суммой. */
const say = (t: OnboardingText, lang: UiLang, catalog: OnboardingCatalog): string => withMoney(t[lang], lang, catalog);

/**
 * Тело `GET /ui/v1/onboarding` (§ 5.17) — экран П1.
 *
 * Виды агента идут **в порядке закрытого перечня кодов** (`AGENT_MODELS`), а не в порядке файла настройки: порядок на
 * экране — часть решения (Р-1675: сначала агент банка, потом свой, последним — площадка для сравнения), и менять его
 * правкой `config/` нельзя. Строки таблицы сравнения — так же, по `COMPARE_ROWS`.
 *
 * `view` и хэша здесь нет: на П1 человек ничего не подтверждает (§ 5.17).
 */
export function getOnboarding(lang: UiLang, deps: OnboardingServiceDeps): OnboardingResponse {
  const { catalog } = deps;
  return {
    path: pathStepOf(catalog, "P1"),
    text_version: catalog.text_version,
    models: AGENT_MODELS.map((id) => {
      const m = modelById(catalog, id);
      // Умолчания нет: вид агента из перечня кодов обязан быть в данных, и это держит разбор перечня. Молчаливая
      // подстановка пустой карточки уехала бы на экран вместо ошибки сборки ответа.
      if (m === null) throw new Error(`onboarding: вида агента ${id} нет в данных`);
      return {
        id: m.id,
        name: say(m.name, lang, catalog),
        text: say(m.text, lang, catalog),
        selectable: m.selectable,
        why_not: m.why_not === null ? null : say(m.why_not, lang, catalog),
        action_label: m.action_label === null ? null : say(m.action_label, lang, catalog),
        can: m.can.map((t) => say(t, lang, catalog)),
      };
    }),
    compare: COMPARE_ROWS.map((row) => {
      const line = catalog.compare.find((l) => l.row === row);
      if (line === undefined) throw new Error(`onboarding: строки сравнения ${row} нет в данных`);
      return {
        row: line.row,
        label: say(line.label, lang, catalog),
        values: Object.fromEntries(AGENT_MODELS.map((id) => [id, say(line.values[id], lang, catalog)])),
      };
    }),
  };
}

/**
 * Карточка условий — **ровно то, что человек видит** на П3, без оформления (§ 3, правило 1).
 *
 * Хэш считается по этому объекту, поэтому в него входит всё, что человек читает перед тем, как отметить галочки:
 * модель, перечень «что может агент», пометка «демо, не оферта», тексты обоих согласий с признаком обязательности и
 * подпись кнопки с причиной её недоступности. Подставленная сумма входит **уже подставленной**: человек видел
 * «1,00 ₽», а не `{money}`, и подтверждает он увиденное.
 *
 * Шаг пути в хэш **не** входит: это навигация, а не условия, и смена номера шага не должна отменять подтверждение.
 */
export function shownTerms(model: AgentModelId, lang: UiLang, deps: OnboardingServiceDeps): TermsShown {
  const { catalog } = deps;
  const m = modelById(catalog, model);
  if (m === null) throw new Error(`onboarding: вида агента ${model} нет в данных`);
  return {
    text_version: catalog.text_version,
    card: {
      model: m.id,
      can: m.can.map((t) => say(t, lang, catalog)),
      demo_note: say(catalog.demo_note, lang, catalog),
      consents: CONSENT_IDS.map((id) => {
        const item = catalog.consents.find((c) => c.id === id);
        if (item === undefined) throw new Error(`onboarding: согласия ${id} нет в данных`);
        return { id: item.id, text: say(item.text, lang, catalog), required: true };
      }),
      accept: {
        label: say(catalog.texts["accept"], lang, catalog),
        why_disabled: say(catalog.texts["why_disabled_until_all_required"], lang, catalog),
      },
    },
  };
}

/** `view` карточки условий: опознаватель своей копии, версия текстов и хэш (§ 3, правило 1). Считает хэш
 *  канонизация ядра (`showingHash`), а не экран и не своя копия правила. */
export const termsView = (model: AgentModelId, lang: UiLang, deps: OnboardingServiceDeps): UiView =>
  viewOf(deps.viewId, shownTerms(model, lang, deps));

/** Исход `GET /ui/v1/onboarding/terms`: карточка либо отказ § 3. */
export type TermsOutcome =
  | { readonly ok: true; readonly body: OnboardingTermsResponse }
  | { readonly ok: false; readonly status: number; readonly body: UiErrorBody };

/**
 * Тело `GET /ui/v1/onboarding/terms?model=M1|M2` (§ 5.18) — экран П3.
 *
 * Невыбираемый вид агента (М3) и неизвестный код — **409 `MODEL_NOT_AVAILABLE`, класс `never`** (Р-1675): основы на
 * стенде нет, и повтор не поможет никогда. Отказ один на оба случая, и решает его **сервер**: признак `selectable`
 * берётся из данных, а не из того, что прислал экран.
 *
 * `accept.enabled` здесь **всегда `false`**, и это не описка: карточка выдаётся до того, как человек что-либо
 * отметил, а обе галочки по умолчанию пусты (П26, Р-1676 п. 2). Поэтому вместе с кнопкой приходит готовая причина
 * «отметьте оба пункта», и экран её только показывает. Окончательно решает § 5.19 — он один знает, что пришло в теле.
 */
export function getOnboardingTerms(model: string, lang: UiLang, deps: OnboardingServiceDeps): TermsOutcome {
  const { catalog } = deps;
  // Страж перечня — готовый `isAgentModelId`, а не своя копия условия рядом с ним (находка ревью К3, мелочь).
  const m = isAgentModelId(model) ? modelById(catalog, model) : null;
  if (m === null || !m.selectable) {
    return {
      ok: false,
      // Статус — из таблицы контракта (§ 6), а не числом по месту: вторая копия статуса разошлась бы с ней молча.
      status: UI_ERROR_STATUS["MODEL_NOT_AVAILABLE"],
      body: {
        error: {
          code: "MODEL_NOT_AVAILABLE",
          // Класс повтора — из **общей** таблицы контракта (§ 6, `UI_RETRY`): своей таблицы у знакомства больше нет
          // (кирпич К7, Р-1685). У `MODEL_NOT_AVAILABLE` это `never` с источником Р-1675.
          retry: UI_RETRY["MODEL_NOT_AVAILABLE"],
          // Текст человеку — из данных, на языке запроса; про невыбираемый вид это та же причина, что на П1.
          text: say(catalog.errors["MODEL_NOT_AVAILABLE"], lang, catalog),
          view: null,
        },
      },
    };
  }
  const shown = shownTerms(m.id, lang, deps);
  const { card } = shown;
  // Тело собирается **из той же копии показанного**, по которой считается хэш, и форма карточки названа типом
  // (`TermsCard`): иначе на экран ушло бы одно, а в хэш легло бы другое, и правило 1 проверяло бы не то, что человек
  // видел (находка ревью К3 № 3).
  const accept: UiAction = { enabled: false, label: card.accept.label, why_disabled: card.accept.why_disabled };
  return {
    ok: true,
    body: {
      model: card.model,
      path: pathStepOf(catalog, "P3"),
      can: card.can,
      demo_note: card.demo_note,
      consents: card.consents,
      actions: { accept },
      // `view` собирает **`viewOf`**, а не руками: добавится в него поле — оно придёт и сюда. Вторая сборка того же
      // объекта рядом с `termsView` расходилась бы молча (находка ревью К3 № 4).
      view: viewOf(deps.viewId, shown),
    },
  };
}
