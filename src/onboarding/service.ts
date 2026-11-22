// ИН-П1, кирпич К3 — сервисы `GET /ui/v1/onboarding` (§ 5.17) и `GET /ui/v1/onboarding/terms` (§ 5.18).
//
// Здесь собираются тела ответов **целиком**: экран ничего не считает и ничего не формулирует (правило 3 К-Б).
// Доступность вида агента, обязательность пунктов согласия, доступность кнопки и текст «почему нельзя» приходят
// готовыми; сумма подставляется **сервером** общим показом суммы, а не экраном (инвариант 2, правило планов № 2).
//
// Контракт — К-Б `/ui/v1` **v1.5** (действующая версия; на неё модуль переведён кирпичом К-Б ИН-П2 — номер и путь
// к файлу живут в одном месте, `tests/support/contract-doc.ts`). Прежде здесь стояла v1.3. Одно отличие
// от черновика постановки, и оно названо решением: шаг пути приходит обёрткой **`path`**, а внутри прежние `n` и
// `of` — ключ `step` в контракте занят значениями `U1…U7` (§ 4), и один ключ в двух смыслах жить не может.
//
// Чего здесь нет: записи согласия и правил HTTP — это кирпич К4 (`POST /ui/v1/consent`), и `view` этой карточки
// сверяется там же по правилу 1.
import type {
  ConsentRequest,
  ConsentResponse,
  OnboardingResponse,
  OnboardingTermsResponse,
  UiAction,
  UiErrorBody,
  UiLang,
  UiView,
} from "../contract/ui-v1/index.js";
import {
  checkUiPress,
  frozenShown,
  isShownHash,
  showingHash,
  UI_ERROR_STATUS,
  UI_RETRY,
  uiErrorBody,
  viewOf,
  type ShownPayload,
} from "../contract/ui-v1/index.js";
import { allRequiredAccepted, recordConsent, type RecordConsentDeps, type SignedConsent } from "./consent.js";
import { formatMoneyText } from "../money.js";
import {
  AGENT_MODELS,
  COMPARE_ROWS,
  CONSENT_IDS,
  MONEY_PLACEHOLDER,
  isAgentModelId,
  isConsentId,
  modelById,
  pathStepOf,
  type AgentModelId,
  type ConsentId,
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

// ── § 5.19 `POST /ui/v1/consent` — приём условий (кирпич К4) ─────────────────────────────────────────────────────────

/**
 * Почему негодное тело — **один** код экрану.
 *
 * `CONSENT_INVALID` отдаётся на все случаи негодного тела: неизвестный пункт, повтор пункта, отмечены не все
 * обязательные, лишнее поле, негодный провенанс (§ 5.19). Причина остаётся **внутри** сервера уточнением — экрану
 * она ничего не даёт, а в журнале и на разборе нужна; тот же приём, что у подписи принципов (П32 дополнение 1).
 */
export type ConsentProblem =
  /** тело не объект, лишнее поле или поле не той формы */
  | { readonly reason: "BODY_SHAPE"; readonly field: string }
  /** пункт, которого нет в перечне согласий */
  | { readonly reason: "UNKNOWN_CONSENT"; readonly id: string }
  /** один и тот же пункт отмечен дважды */
  | { readonly reason: "DUPLICATE_CONSENT"; readonly id: string }
  /** отмечены не все обязательные пункты — в том числе пустой перечень */
  | { readonly reason: "REQUIRED_MISSING" }
  /** вид агента не выбирается или неизвестен */
  | { readonly reason: "MODEL_NOT_SELECTABLE" }
  /** хэш показанного не совпал или версия текстов провенанса разошлась с показанной */
  | { readonly reason: "SHOWN_MISMATCH" }
  /** провенанс есть, но негодный: `device` или `gesture` вне перечня § 3, пустое время или версия текстов */
  | { readonly reason: "PRESS_INVALID"; readonly field: string };

/** Поля тела § 5.19 — ровно те. Лишнее поле это негодное тело, а не «то же с примечанием»: иначе `{…, by: "human"}`
 *  считалось бы годным, а признак «кто нажал» из тела не берётся ни в каком режиме.
 *  Форма **провенанса** здесь не переписывается: её проверяет общий `checkUiPress` (§ 3), которого спрашивают и
 *  подпись принципов, и отправка поручения. Своя третья копия уже начала расходиться с ним в раскладке причин
 *  (находка ревью К4 № 1), а две копии однажды приняли бы `device: "robot"` по-разному. */
const CONSENT_BODY_KEYS: readonly string[] = ["model", "accepted", "shown_hash", "press"];

/** Форма тела — **до** смысловых проверок: то, что можно проверить, не зная ни карточки, ни перечня согласий. */
function checkConsentShape(raw: unknown): ConsentProblem | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return { reason: "BODY_SHAPE", field: "body" };
  const body = raw as Record<string, unknown>;
  for (const key of Object.keys(body))
    if (!CONSENT_BODY_KEYS.includes(key)) return { reason: "BODY_SHAPE", field: key };
  if (typeof body["model"] !== "string") return { reason: "BODY_SHAPE", field: "model" };
  if (typeof body["shown_hash"] !== "string") return { reason: "BODY_SHAPE", field: "shown_hash" };
  const accepted = body["accepted"];
  if (!Array.isArray(accepted) || accepted.some((id) => typeof id !== "string"))
    return { reason: "BODY_SHAPE", field: "accepted" };
  // Провенанс — **общей** проверкой; свои коды приставляются к её причине, как в `signature.ts`.
  const bad = checkUiPress(body["press"]);
  if (bad !== null)
    return bad.kind === "missing"
      ? { reason: "PRESS_INVALID", field: "press" }
      : { reason: "PRESS_INVALID", field: bad.field };
  return null;
}

/** Перечень отмеченного: известные пункты, без повторов, и **все обязательные** на месте. Обязательность решает
 *  сервер по закрытому перечню кода, а не по тому, что прислал экран (правило 3, инвариант 2). */
function checkAccepted(accepted: readonly string[]): ConsentProblem | null {
  const seen = new Set<string>();
  for (const id of accepted) {
    if (!isConsentId(id)) return { reason: "UNKNOWN_CONSENT", id };
    if (seen.has(id)) return { reason: "DUPLICATE_CONSENT", id };
    seen.add(id);
  }
  return allRequiredAccepted([...seen] as ConsentId[]) ? null : { reason: "REQUIRED_MISSING" };
}

/** Исход `POST /ui/v1/consent`: записанное согласие либо отказ § 3. `problem` наружу не идёт — он для журнала. */
export type ConsentOutcome =
  | { readonly ok: true; readonly body: ConsentResponse; readonly version: SignedConsent }
  | {
      readonly ok: false;
      readonly status: number;
      readonly body: UiErrorBody;
      readonly code: "CONSENT_INVALID" | "SHOWN_STALE" | "MODEL_NOT_AVAILABLE";
      readonly problem?: ConsentProblem;
    };

/** Отказ § 3 с текстом из `config/` на языке запроса и классом повтора из **общей** таблицы контракта.
 *  Экспортируется, потому что один отказ собирает **маршрут**: тело с полем `by` отклоняет общий слой (он один
 *  видит всё тело), а код и текст у этого отказа — метода (находка ревью К4 № 3). Своей второй сборки отказа у
 *  маршрута нет. */
export function consentRefusal(
  code: "CONSENT_INVALID" | "SHOWN_STALE" | "MODEL_NOT_AVAILABLE",
  lang: UiLang,
  deps: OnboardingServiceDeps,
  extra: { readonly view?: UiView | null; readonly problem?: ConsentProblem } = {},
): ConsentOutcome {
  return {
    ok: false,
    status: UI_ERROR_STATUS[code],
    code,
    ...(extra.problem === undefined ? {} : { problem: extra.problem }),
    // Тело — **общим** сборщиком контракта (§ 3): своего объекта здесь не собирается (находка ревью К4 № 4).
    body: uiErrorBody(code, UI_RETRY[code], say(deps.catalog.errors[code], lang, deps.catalog), extra.view ?? null),
  };
}

/**
 * Приём условий (§ 5.19).
 *
 * Порядок проверок выбран так, чтобы каждый отказ был о своём: **форма тела → модель → перечень отмеченного → хэш
 * показанного**. Он не произволен:
 * - форма идёт первой, потому что на негодном теле остальные проверки читали бы несуществующие поля;
 * - модель — до перечня: согласие на невыбираемого агента не становится годным от правильных галочек;
 * - хэш — последним, потому что он самый дорогой (сборка своей копии карточки) и потому что `SHOWN_STALE` отдаёт
 *   человеку **новую карточку**, а это осмысленно только когда остальное в теле верно.
 *
 * Чего здесь нет: **идемпотентности**. Правило 2 целиком исполняет общий слой сервера (`src/ui-server/index.ts` +
 * `RepeatStore`): ключ требуется у каждого POST до маршрутизации, повтор того же тела отдаёт прежний ответ, другое
 * тело — `IDEMPOTENCY_CONFLICT`. Второй механизм внутри модуля дал бы одному действию два правила повтора — ровно та
 * беда, от которой К7 избавил классы повтора. Запоминание каждого исхода (включая отказы, кроме
 * `IDEMPOTENCY_REQUIRED`) — забота маршрута, и она там названа.
 *
 * Версия текстов провенанса сверяется с версией **своей** копии карточки: расходится — человек подтверждал не те
 * тексты, которые сервер считает показанными, и это тот же случай «карточка устарела» (приём К1.3 П-К1).
 */
export function postConsent(
  raw: unknown,
  owner: string,
  lang: UiLang,
  deps: OnboardingServiceDeps & RecordConsentDeps,
): ConsentOutcome {
  /** Отказ: строка журнала с причиной — и только потом ответ экрану. Причина наружу не идёт, но в журнале она есть
   *  (находка ревью К4 № 7): иначе «не смог согласиться» нечем разобрать. */
  const refused = (
    code: "CONSENT_INVALID" | "SHOWN_STALE" | "MODEL_NOT_AVAILABLE",
    problem: ConsentProblem,
    model: string | null,
    extra: { readonly view?: UiView | null } = {},
  ): ConsentOutcome => {
    deps.journal.refused({
      event: "consent.refused",
      owner,
      code,
      reason: problem.reason,
      model,
      by: deps.by(),
      received_at: deps.now(),
    });
    return consentRefusal(code, lang, deps, { problem, ...extra });
  };

  const shape = checkConsentShape(raw);
  if (shape !== null) return refused("CONSENT_INVALID", shape, null);
  const body = raw as ConsentRequest;

  // Модель: невыбираемая и неизвестная — один ответ, как в § 5.18. Решает сервер по данным, а не по телу.
  const model = isAgentModelId(body.model) ? modelById(deps.catalog, body.model) : null;
  if (model === null || !model.selectable)
    return refused("MODEL_NOT_AVAILABLE", { reason: "MODEL_NOT_SELECTABLE" }, body.model);

  const bad = checkAccepted(body.accepted);
  if (bad !== null) return refused("CONSENT_INVALID", bad, model.id);

  // Правило 1: хэш считается по **своей** копии показанного, и ни одно значение из тела в расчёт не берётся.
  const shown = shownTerms(model.id, lang, deps);
  // Хэш считается **один раз** и дальше используется как есть: второй расчёт той же карточки это второй шанс
  // разойтись (находка ревью К4 № 6).
  const hash = showingHash(shown);
  if (body.press.text_version !== shown.text_version || !isShownHash(body.shown_hash) || body.shown_hash !== hash)
    // Новая карточка — в `error.view`: человек смотрит, что изменилось, и решает заново (класс `after_human`).
    return refused("SHOWN_STALE", { reason: "SHOWN_MISMATCH" }, model.id, { view: viewOf(deps.viewId, shown) });

  const version = recordConsent(deps, {
    owner,
    model: model.id,
    accepted: body.accepted as readonly ConsentId[],
    // Запись показанного — **копией целиком** (`frozenShown`), а не пересборкой по полям: иначе новое поле формы
    // `UiShown` ушло бы в `view` ответа, а в подписанную версию и журнал — нет (замечание ревью К8 № 5 окна А,
    // находка ревью К4 № 6).
    view: frozenShown({ hash, text_version: shown.text_version }),
    press: body.press,
  });

  return {
    ok: true,
    version,
    body: {
      consent: {
        version: version.no,
        model: version.model,
        accepted: version.accepted,
        by: version.by,
        received_at: version.received_at,
        shown: version.view,
      },
      // Шаг — **тот же П3**, как в примере § 5.19: ответ говорит, где человек находится, а не куда пойдёт. Шаг
      // следующего экрана придёт с самим экраном (**П4 — ИН-П2, П6 — ИН-ВМ**; решение владельца 22.11.2026, Р-1705).
      path: pathStepOf(deps.catalog, "P3"),
    },
  };
}

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
