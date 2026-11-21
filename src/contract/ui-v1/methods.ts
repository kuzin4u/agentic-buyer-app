// Контракт К-Б `/ui/v1` v1.0, § 5 «Методы» (КТ-0, К2.1; П30, Р-1603): запросы и ответы всех методов — типами.
// Форма — шаги пути человека (У1…У10), а не CRUD по сущностям: логика шага остаётся у сервера (правило 3).
// Здесь только типы: сервер `/ui/v1` и экраны — ИН-0 окна Б.
// Ни в одном ответе нет платёжных реквизитов, номера карты, криптограммы и `kid` (инвариант 1): у экрана их нет и быть
// не может — экран недоверенная среда (С-12, С-31, С-32). Проверяется тестом по ключам типов (К2.4).
import type { A5SignalCode, LiveFactCode } from "agentic-buyer-ref/src/agent/catalog/index.js";
import type { PurchaseState } from "agentic-buyer-ref/src/agent/pipeline/machine.js";
import type {
  ConfirmationMode,
  DisputeDraft,
  MandateKind,
  MandateStatus,
  OperationStatus,
  ScopeCheck,
  SignatureLevel,
} from "agentic-buyer-ref/src/shared/domain.js";
import type {
  ShownHash,
  UiShown,
  UiAction,
  UiDoneLine,
  UiInstant,
  UiLine,
  UiMoney,
  UiPress,
  UiSignedBy,
  UiStep,
  UiView,
} from "./common.js";

/** Состояние покупки — **состояние машины ядра** (`PURCHASE_STATES`), не своё перечисление (§ 4). */
export type UiState = PurchaseState;

/** Пара «состояние ядра + шаг экрана»: есть в каждом ответе, который продвигает человека по пути. */
export interface UiWhere {
  readonly state: UiState;
  readonly step: UiStep;
}

/**
 * Шаг **пути приобретения** — номер и сколько всего (§ 5.17, § 5.18; решение владельца 20.11.2026 **Р-1678**,
 * П34 п. 7).
 *
 * Это **не** `UiWhere.step` и не его числовая запись: `UiStep` — путь одной покупки (`U1…U7`, § 4), а путь
 * приобретения (П1…П6, знакомство и подключение агента) идёт до того, как покупка вообще появилась. Поэтому у него
 * своя форма и своё место, рядом с `UiWhere`, а не вместо него.
 *
 * Имён у шагов здесь **нет намеренно**: восьми имён не существует ни в канве экранов (там П1, П3 и П4), ни в
 * контракте, и выдумывать перечень значило бы завести литерал против Р-1511 «закрытые перечни — из кода источника».
 * `n` и `of` приходят **величинами данных** (`config/`), а коды и подписи шагов появятся вместе со своими экранами:
 * П4 и П6 — в ИН-П2, П5 — в И-2.
 *
 * В документе тип есть **с v1.1**, вместе с методами § 5.17–§ 5.19, как совместимое расширение контракта
 * (§ 3 «Версии»); обёртка названа `path`, а внутри прежние `n` и `of` (v1.2, уточнение формы). Тип заведён
 * окном Б (ИН-П1, кирпич К1) по постановке от 20.11.2026, которая прямо поручает ему § 5.17–§ 5.19.
 */
export interface UiPathStep {
  readonly n: number;
  readonly of: number;
}

/** Ссылка на мандат в ответе экрану: идентификатор, вид и статус (§ 5.2). Хэша мандата, подписи и ключа здесь нет. */
export interface UiMandateRef {
  readonly id: string;
  readonly kind: MandateKind;
  readonly status: MandateStatus;
}

// ── § 5.9 «Вердикт по остановке» (П28) ───────────────────────────────────────────────────────────────────────────────

/** Класс остановки (П28 п. 4): `BUS` — у остановки есть записи шины, `STAND_LOG` — условие по журналу сбоев стенда,
 *  где доказательств на шине нет. Экран рисует `BUS` сплошной рамкой, `STAND_LOG` — пунктиром: разница читается
 *  **без цвета**. */
export type UiStopClass = "BUS" | "STAND_LOG";

/** Точность привязки доказательства к остановке (П28 п. 3): `INEXACT` — доказательство отнесено **правилом**, а не
 *  идентификатором, и человек это видит; `EXACT` — привязка по идентификатору. Акт и экран говорят об этом одними
 *  словами из одного источника. */
export type UiStopBinding = "EXACT" | "INEXACT";

/** Вердикт по остановке: приходит в `stops` состояния покупки и итога (§ 5.3, § 5.8). */
export interface UiStop {
  readonly class: UiStopClass;
  readonly binding: UiStopBinding;
  readonly code: string;
  readonly text: string;
  readonly at: UiInstant;
}

// ── § 5.1 `POST /ui/v1/intent/draft` — фраза → карточка поручения (У1) ───────────────────────────────────────────────

export interface IntentDraftRequest {
  readonly phrase: string;
}

/** Карточка поручения в пользовательском регистре — это `MandateDraft` ядра словами человека (§ 5.1).
 *  `merchants.labels` — названия и коды продавцов, `count` — сколько их всего. */
export interface IntentCard {
  readonly subject: string;
  readonly limit: UiMoney;
  readonly valid_to: UiInstant;
  readonly merchants: { readonly count: number; readonly labels: readonly string[] };
  readonly confirmation_mode: ConfirmationMode;
  readonly lines: readonly { readonly code: string; readonly text: string }[];
}

/** Уточнение, если фразы не хватило (§ 5.1): до ВР-5 «понимание запроса» карточка собирается из шаблона, а фраза только
 *  записывается в журнал. */
export interface IntentQuestion {
  readonly id: string;
  readonly text: string;
}

/** `card` и `view` — **`null`, пока есть вопросы** (решение владельца 20.11, 17:07, Р-1666; **К-Б v1.1**, внесёт чат).
 *  Почему так: пока человек не ответил, значения спрошенных полей взять негде, а умолчание, пустая строка или ноль
 *  вместо условия поручения — это карточка, в которой написано не то, о чём просили. Хэш показанного считается только
 *  по полной карточке (правило 1), поэтому без карточки нет и `view`: нечего подписывать и нечего сверять.
 *  Обратное тоже верно: есть `card` — `questions` пуст.
 *  Ответы экран присылает **уточнённой фразой заново**, тем же `phrase`; отдельное поле ответов — с ВР-5. */
/** Два тела, а не одно с необязательными полями: **типом** закрыто то, что иначе держалось бы комментарием —
 *  карточка с непустыми вопросами, карточка без `view` и `view` без карточки (находка ревью К4 № 2). Тела собирает и
 *  сервер ИН-0 окна Б, поэтому правило должно ломать сборку, а не ревью. */
export type IntentDraftResponse =
  | {
      readonly draft_id: string;
      readonly card: IntentCard;
      readonly questions: readonly [];
      readonly actions: { readonly submit: UiAction };
      readonly view: UiView;
    }
  | {
      readonly draft_id: string;
      readonly card: null;
      /** непустой перечень: ветка вопросов без единого вопроса — это ветка карточки */
      readonly questions: readonly [IntentQuestion, ...IntentQuestion[]];
      readonly actions: { readonly submit: UiAction };
      readonly view: null;
    };

// ── § 5.2 `POST /ui/v1/intent` — отправить поручение на подпись (У2) ─────────────────────────────────────────────────

/** Метод **не подписывает** (§ 2 п. 1): по РП36 подпись ставит человек в банке над `Mandate.hash`, а ключ агента
 *  подписывает только обращения агента к ПАО. Метод отправляет поручение и возвращает маршрут подписи. */
export interface IntentRequest {
  readonly draft_id: string;
  readonly shown_hash: ShownHash;
  readonly press: UiPress;
}

/** Где человек подписывает: на стенде — экран мандатов банка по ссылке (Р-1313), в ИН-ВМ — модуль банка внутри
 *  приложения банка, и тогда `link` равен `null`. */
export interface UiSignRoute {
  readonly where: "BANK" | "BANK_MODULE";
  readonly link: string | null;
  readonly text: string;
}

export interface IntentResponse extends UiWhere {
  readonly purchase_id: string;
  readonly mandate: UiMandateRef;
  readonly sign: UiSignRoute;
}

// ── § 5.3 `GET /ui/v1/purchase/{purchase_id}` — состояние покупки ────────────────────────────────────────────────────

/** Поручение в ответе: остаток, срок и время сверки — **исход `GET /pao/v1/mandates/{id}/verify`** (инвариант 2: остаток
 *  берётся только оттуда, приложение его не вычисляет). `revocation_order` задаёт Платформа (РП37), экран его только
 *  показывает. */
export interface UiIntentView {
  readonly id: string;
  readonly status: MandateStatus;
  readonly amount_left: UiMoney;
  readonly valid_to: UiInstant;
  readonly as_of: UiInstant;
  readonly revocation_order: string | null;
}

export interface PurchaseResponse extends UiWhere {
  readonly purchase_id: string;
  readonly intent: UiIntentView;
  readonly done_line: UiDoneLine;
  readonly stops: readonly UiStop[];
  readonly actions: { readonly stop: UiAction };
}

// ── § 5.4 `GET /ui/v1/offers?purchase_id=` — варианты, «почему так», отсев (У3) ──────────────────────────────────────

/** Зона предложения (`OfferZones` ядра): `CONTOUR` — контур гарантий, `MARKET` — вне контура. По зоне `MARKET` покупки
 *  нет — человеку только ссылка (инвариант 5 приложения, инвариант 10 ядра), кнопки оплаты у такого предложения не
 *  бывает. */
export type UiZone = "CONTOUR" | "MARKET";

/** Предложение в контуре гарантий. `seller_confirmed: false` — видимая пометка «сведения без подтверждения продавца»
 *  (белый каталог), а не мягкая формулировка. `a5` — сигналы противоречивых сведений продавца (Р32): экран их
 *  показывает и собирает решение человека (§ 5.6). */
export interface UiOffer {
  readonly offer_id: string;
  readonly shop: string;
  readonly merchant_id: string;
  readonly sku: string;
  readonly title: string;
  readonly price: UiMoney;
  readonly zone: "CONTOUR";
  readonly seller_confirmed: boolean;
  readonly a5: readonly A5SignalCode[];
}

/** Предложение вне контура: **без цены к оплате и без кнопки** — ссылка и текст раскрытия (инвариант 5). */
export interface UiMarketOffer {
  readonly offer_id: string;
  readonly zone: "MARKET";
  readonly shop: string;
  readonly link: string;
  readonly disclosure_text: string;
}

export interface OffersResponse {
  readonly main: UiOffer;
  readonly why: readonly UiLine[];
  readonly alternatives: readonly (UiOffer & {
    /** попарное «сравнить с главным»; таблица по позициям — только в вебе (ИН-ВЕБ) */
    readonly compare_with_main: readonly { readonly text: string }[];
  })[];
  readonly market: readonly UiMarketOffer[];
  readonly filtered_out: {
    readonly count: number;
    readonly items: readonly { readonly shop: string; readonly reason_code: string; readonly text: string }[];
  };
  readonly unavailable: readonly { readonly shop: string; readonly text: string }[];
  /** коды пояснения зон ядра (`ZONE_CONTOUR`, `ZONE_MARKET`) готовым текстом */
  readonly disclosure: { readonly contour: string; readonly market: string };
}

// ── § 5.5 `POST /ui/v1/check` — живая проверка у продавца (У4) ───────────────────────────────────────────────────────

export interface CheckRequest {
  readonly purchase_id: string;
  readonly merchant_id: string;
  readonly lines: readonly { readonly sku: string; readonly qty: number }[];
}

/** Исход живой проверки позиции: `OK` или код живой проверки ядра (`LiveFactCode`). */
export type UiLiveFact = "OK" | LiveFactCode;

/** Это **предварительный показ** (§ 2 п. 3): окончательная проверка повторяется внутри `POST /ui/v1/cart`, и цена,
 *  которая уйдёт в CART, берётся оттуда. `next` при `ok: false` — следующий шаг словами («к вариантам», «новый выбор»). */
export interface CheckResponse {
  readonly ok: boolean;
  readonly lines: readonly {
    readonly sku: string;
    readonly qty: number;
    readonly price: UiMoney;
    readonly fact: UiLiveFact;
    readonly text: string;
  }[];
  readonly checked_at: UiInstant;
  readonly next: string | null;
}

// ── § 5.6 `POST /ui/v1/cart` — согласие на корзину (У5) ──────────────────────────────────────────────────────────────

/** Решение человека по сигналам A5 позиции: экран присылает **принятые коды**, и только из показанных.
 *  Объект решения ядра (`HumanA5Decision`) собирает **сервер** фабрикой оболочки — экран его прислать не может и не
 *  должен (ядро принимает только выданное фабрикой, инвариант 3 ядра). Нет решения при сигналах — 409 `A5_NEEDS_HUMAN`. */
export interface UiA5Decision {
  readonly accepted: readonly A5SignalCode[];
}

export interface CartRequest {
  readonly purchase_id: string;
  readonly merchant_id: string;
  readonly lines: readonly {
    readonly sku: string;
    readonly qty: number;
    readonly decision: UiA5Decision | null;
  }[];
  readonly shown_hash: ShownHash;
  readonly press: UiPress;
}

/** CART банк **не подписывает** (§ 2 п. 2): по РП35 мандат CART сразу `ACTIVE`, а согласие человека на корзину — жест на
 *  нашем экране (У5), привязанный к хэшу показанного и провенансу.
 *  `agent_fee` — **отдельная строка** и в корзине, и в итоге; в общую сумму не прячется и, пока вопрос монетизации не
 *  решён (§ 8 п. 2), в сумме CART не участвует. */
export interface UiCart {
  readonly lines: readonly { readonly title: string; readonly qty: number; readonly price: UiMoney }[];
  readonly goods_total: UiMoney;
  readonly agent_fee: UiMoney;
  readonly agent_fee_text: string;
}

export interface CartResponse extends UiWhere {
  readonly cart: UiCart;
  readonly mandate: UiMandateRef;
  readonly order: { readonly order_id: string };
  readonly actions: { readonly pay: UiAction };
  readonly view: UiView;
}

// ── § 5.7 `POST /ui/v1/payment` — оплата (У6) ────────────────────────────────────────────────────────────────────────

/** `BANK` (М1) — реквизит через ПАО, пакет продавцу, авторизацию ведёт продавец (РП2).
 *  `MERCHANT_LINK` и `MERCHANT_QR` (М2) — оплата продавцу по ссылке или QR: **на стенде не работает**, 409
 *  `NOT_ON_STAND` (вопросы стыка № 2 и № 4), кнопка неактивна с объяснением. */
export type UiPaymentMode = "BANK" | "MERCHANT_LINK" | "MERCHANT_QR";

export interface PaymentRequest {
  readonly purchase_id: string;
  readonly mode: UiPaymentMode;
  readonly shown_hash: ShownHash;
  readonly press: UiPress;
}

/** Подтверждение выше порога `confirm_above_kop` создаёт ADP (РП50, РП51): человек подтверждает **сам** — на странице
 *  УПК или в приложении эмитента (инвариант 3 приложения, инвариант 7 Платформы). Экран только открывает ссылку и ждёт;
 *  «подтвердить» за человека он не нажимает и сумму под порог не дробит. */
export interface UiConfirmation {
  readonly where: "UPK" | "BANK_APP";
  readonly link: string | null;
  readonly expires_at: UiInstant;
  readonly text: string;
}

export interface PaymentResponse extends UiWhere {
  readonly confirmation: UiConfirmation | null;
}

// ── § 5.8 `GET /ui/v1/order/{purchase_id}` — итог (У7) ───────────────────────────────────────────────────────────────

/** Операция: статус и сумма парой. У операции ПАО 1.4.0 валюты нет — её подставляет сервер из CART покупки (§ 3
 *  «Деньги»). `decline_text` — текст отказа человеку, если операция отклонена. */
export interface UiOperation {
  readonly status: OperationStatus;
  readonly amount: UiMoney;
  readonly decline_text: string | null;
}

/** Запись об исполнении Платформы (`Fulfilment` ядра): `spent_position` экран **не пересчитывает** (инвариант 6 ядра,
 *  инвариант 2 приложения). `scope_check` вне перечня приходит как `{ other }`, и текст говорит «значение Платформы не
 *  опознано» — без догадки. */
export interface UiFulfilment {
  readonly final: UiMoney;
  readonly scope_check: ScopeCheck;
  readonly scope_text: string;
  readonly spent_position: UiMoney;
  readonly at: UiInstant;
}

/** Возврат: деньги вернулись, **предел поручения не восстанавливается** (РП71 п. 6, PS-23 ч. 2 — до пилота). */
export interface UiRefund {
  readonly status: "REFUNDED";
  readonly text: string;
}

export interface OrderResponse extends UiWhere {
  readonly operation: UiOperation;
  readonly fulfilment: UiFulfilment;
  /** откуда итог: запись об исполнении Платформы и когда прочитана — **не ответ продавца** (инвариант 6 приложения) */
  readonly source: { readonly text: string; readonly checked_at: UiInstant };
  readonly done_line: UiDoneLine;
  readonly refund: UiRefund | null;
  readonly stops: readonly UiStop[];
  readonly agent_fee: { readonly amount: UiMoney; readonly text: string };
  readonly act: { readonly id: string; readonly card_url: string };
}

// ── § 5.9 `GET /ui/v1/feed` — поток событий (SSE) ────────────────────────────────────────────────────────────────────

/** О чём сигнал. Правило 4: поток говорит только, что **что-то изменилось**; «Оплачено», «Отклонено» и «Остановлено»
 *  по одному событию экран не показывает — он перечитывает § 5.3 или § 5.8 и показывает только прочитанное.
 *  Причина: до ПАО 1.5.0 события Платформы не подписаны (инвариант 9 Платформы, SEC-1 ч. 3). Поэтому инвариант 6
 *  приложения читается как «итог — по прочитанному у Платформы» (П31): «Оплачено» рисуется после `GET`, а не после
 *  события. */
export type UiFeedKind = "STATE" | "STOP" | "VERDICT" | "MANDATE" | "CONFIRMATION";

/** Доставка «не менее одного раза»: повтор экран отбрасывает по `event_id`. */
export interface UiFeedEvent {
  readonly event_id: string;
  readonly purchase_id: string;
  readonly kind: UiFeedKind;
  readonly at: UiInstant;
}

// ── § 5.10 `POST /ui/v1/revoke` — отзыв поручения (У8) ───────────────────────────────────────────────────────────────

export interface RevokeRequest {
  readonly purchase_id: string;
  readonly press: UiPress;
}

/** Отзыв клиентом идёт **через банк, не через ПАО** (РП38): метод возвращает маршрут в банк и текст порядка отзыва.
 *  Агент со своей стороны отказывается от полномочий (`relinquish`) и останавливает покупку; отказ от INTENT отзывает и
 *  его CART (РП35). Авторизованное до отзыва исполняется (инвариант 8 Платформы) — и экран говорит об этом словами. */
export interface RevokeResponse {
  readonly revoke: { readonly where: "BANK"; readonly link: string | null; readonly order_text: string };
  readonly agent: { readonly relinquished: boolean };
  readonly state: UiState;
}

// ── § 5.11 `GET /ui/v1/purchases` — история и повтор (У8) ────────────────────────────────────────────────────────────

/** Повтор — **новая покупка** с новой карточкой поручения, не копия старой подписи. */
export interface PurchasesResponse {
  readonly items: readonly {
    readonly purchase_id: string;
    readonly title: string;
    readonly state: UiState;
    readonly total: UiMoney;
    readonly at: UiInstant;
    readonly actions: { readonly repeat: UiAction };
  }[];
  readonly next: string | null;
}

// ── § 5.12 `POST /ui/v1/dispute` — спор (У9) ─────────────────────────────────────────────────────────────────────────

/** Причина спора — перечень ядра (`DisputeDraft.reason`), своей копии нет. */
export type UiDisputeReason = DisputeDraft["reason"];

export interface DisputeRequest {
  readonly purchase_id: string;
  readonly reason: UiDisputeReason;
  readonly press: UiPress;
}

/** Маршрут спора: вне поручения — «деньги возвращены», в пределах поручения — «вопрос к магазину». Выписка из акта
 *  прикладывается сама (`GET /pao/v1/mandates/{id}/evidence`). ПАО требует `principal_ack` из банка, поэтому в ответе
 *  может быть ссылка в банк. **На стенде не работает до PS-22** — 409 `NOT_ON_STAND`. */
export interface DisputeResponse {
  readonly dispute: {
    readonly id: string;
    readonly route: "IN_SCOPE" | "OUT_OF_SCOPE";
    readonly route_text: string;
    readonly evidence_attached: boolean;
    readonly decision: "PENDING" | "REFUND_NO_MERITS" | "ORDINARY_PROCEDURE" | "REJECTED";
    readonly bank_link?: string | null;
  };
}

// ── § 5.13 `GET /ui/v1/act/{id}?view=card|full` — акт ACC-1 ──────────────────────────────────────────────────────────

/** `card` — карточка-итог на мобильном: три числа и ссылка «открыть целиком — в вебе»; `full` — все строки акта, только
 *  для ИН-ВЕБ. **Какие три числа** — открытый вопрос § 8 п. 1, решение владельца; до него карточка не собирается. */
export type UiActView = "card" | "full";

export interface ActCardResponse {
  readonly id: string;
  readonly numbers: readonly { readonly code: string; readonly label: string; readonly value: number }[];
  readonly full_link: string | null;
}

// ── § 5.14 `GET` и `POST /ui/v1/principles` — принципы (П5) ──────────────────────────────────────────────────────────

/** Экрану приходит **только порядок важности** (`rank`). Веса остаются в системном регистре и в ответ не попадают
 *  (правка 6 канвы; правило 3 — вес исполнения не ниже веса цены живёт у сервера, ст. 19). */
export interface PrinciplesResponse {
  readonly items: readonly { readonly id: string; readonly text: string; readonly rank: number; readonly on: boolean }[];
  /** `by` — кто подтвердил порядок: человек, эмулятор клиента демо-стенда или прогон тестов (`UiSignedBy`, перечень
   *  закрыт константой в `common.ts`). Ставит **сервер** по своему знанию (`DEMO_FAULTS=1`, режим «Авто», П5); из тела
   *  запроса признак не берётся — экран недоверенная среда. Пометку «подписано эмулятором клиента» и «подписано
   *  прогоном» рисует экран И-2. Поле заведено решением владельца 19.11, 17:52 (П32 доп. 1), третье значение `test` —
   *  решением 19.11, 22:10; **в § 5.14 документа — с v1.1**, и тест К2.4 сверяет их с документом напрямую. */
  readonly signed: { readonly at: UiInstant; readonly version: string; readonly by: UiSignedBy } | null;
  /** Строки-пояснения под списком: про то, что надёжность исполнения учитывается всегда, и — когда ст. 19 опустила
   *  вес цены — про потолок цены. Сами тексты лежат в `config/` на двух языках, литералом здесь их нет (правило
   *  планов № 3); сюда они приходят готовыми, на языке запроса: экран ничего не выводит сам (правило 3).
   *  Поля `notes`, `items[].on` и `locked_id` добавлены решением владельца 19.11 (П32 дополнение 1) как совместимое
   *  расширение (§ 3 «Версии»); **в § 5.14 документа — с v1.1**, и К2.4 сверяет их с документом напрямую. */
  readonly notes: readonly string[];
  /** Пункт, который клиент не может выключить (роль «исполнение»); `null`, если такого в перечне нет. */
  readonly locked_id: string | null;
  readonly view: UiView;
}

/** `POST` зависит от П-К1 «принципы как подписываемый объект»: до П-К1 — 409 `NOT_ON_STAND`. */
export interface PrinciplesRequest {
  readonly order: readonly string[];
  readonly shown_hash: ShownHash;
  readonly press: UiPress;
}

// ── § 5.17 `GET /ui/v1/onboarding` — знакомство, какой агент (П1) ────────────────────────────────────────────────────

/** Вид агента на экране знакомства (§ 5.17; решение **Р-1675**).
 *
 *  `id`, `row` таблицы сравнения и `id` согласия объявлены здесь **строками, а не закрытыми перечнями**: перечни живут
 *  в прикладном модуле (`src/onboarding/model.ts` — `AGENT_MODELS`, `COMPARE_ROWS`, `CONSENT_IDS`), и вторая копия в
 *  контракте разошлась бы с ними на первой же правке (Р-1511 «закрытые перечни — из кода источника»). Тип описывает
 *  **форму** тела, а состав значений держит тот, кто их выдаёт.
 *
 *  `selectable` и `why_not` — решение **сервера** (правило 3, инвариант 2): экран не выводит доступность сам и не
 *  придумывает причину. У выбираемого вида `why_not` равен `null`, у невыбираемого — готовый текст; `action_label`
 *  наоборот: у выбираемого подпись кнопки есть, у невыбираемого кнопки нет вовсе. */
export interface UiAgentModel {
  readonly id: string;
  readonly name: string;
  readonly text: string;
  readonly selectable: boolean;
  readonly why_not: string | null;
  readonly action_label: string | null;
  /** «что может агент» — готовые строки на языке запроса, свой набор у каждого выбираемого вида */
  readonly can: readonly string[];
}

/** Строка таблицы «чем они отличаются для вас» (§ 5.17): подпись и значение у каждого вида агента. */
export interface UiCompareLine {
  readonly row: string;
  readonly label: string;
  readonly values: Readonly<Record<string, string>>;
}

/** Тело `GET /ui/v1/onboarding` (§ 5.17). **Без `view` и хэша**: на П1 человек ничего не подтверждает, подтверждать
 *  нечего — правило 1 здесь не применяется. */
export interface OnboardingResponse {
  readonly path: UiPathStep;
  readonly text_version: string;
  readonly models: readonly UiAgentModel[];
  readonly compare: readonly UiCompareLine[];
}

// ── § 5.18 `GET /ui/v1/onboarding/terms?model=M1|M2` — условия и согласия (П3) ───────────────────────────────────────

/** Пункт согласия (§ 5.18). `required` отдаёт **сервер**: какие пункты обязательны, решает он, а экран лишь сверяет,
 *  что отмеченные пункты из этого перечня (правило 3). Поля «отмечено» здесь нет и быть не может — отметку ставит
 *  человек, и приходит она в теле § 5.19; поле с умолчанием было бы предотмеченным согласием (П26, Р-1676 п. 2). */
export interface UiConsentItem {
  readonly id: string;
  readonly text: string;
  readonly required: boolean;
}

/** Тело `GET /ui/v1/onboarding/terms` (§ 5.18) — это **карточка, которую человек подтверждает**, поэтому с `view` по
 *  правилу 1: хэш считается по модели, версии текстов, перечню «что может агент», пометке «демо, не оферта» и текстам
 *  согласий, на языке запроса.
 *  `model=M3` сюда не доходит: невыбираемый вид — 409 `MODEL_NOT_AVAILABLE`, класс повтора `never` (Р-1675). */
export interface OnboardingTermsResponse {
  readonly model: string;
  readonly path: UiPathStep;
  readonly can: readonly string[];
  /** «Условия демо-стенда, не оферта» — пометка обязательна, пока настоящей оферты нет (Р-1657, Р-1676 п. 4) */
  readonly demo_note: string;
  readonly consents: readonly UiConsentItem[];
  readonly actions: { readonly accept: UiAction };
  readonly view: UiView;
}

// ── § 5.19 `POST /ui/v1/consent` — приём условий (П3) ────────────────────────────────────────────────────────────────

/** Тело запроса § 5.19. `accepted` — **перечень отмеченных пунктов**, а не признак «со всем согласен»: в споре нужно
 *  показать, с чем именно человек согласился. Поля `by` здесь нет и быть не может — его ставит сервер (§ 3, П26). */
export interface ConsentRequest {
  readonly model: string;
  readonly accepted: readonly string[];
  readonly shown_hash: ShownHash;
  readonly press: UiPress;
}

/** Записанное согласие (§ 5.19). `shown` — общая форма `UiShown`: хэш ровно показанного и версия текстов, под
 *  которыми человек согласился (правило 1). `version` — номер неизменяемой версии; новая прежнюю не стирает. */
export interface UiConsent {
  readonly version: number;
  readonly model: string;
  readonly accepted: readonly string[];
  readonly by: UiSignedBy;
  readonly received_at: UiInstant;
  readonly shown: UiShown;
}

export interface ConsentResponse {
  readonly consent: UiConsent;
  readonly path: UiPathStep;
}

// ── § 5.15 `GET /ui/v1/limits` — пределы и оплата (П6, он же ИН-ВМ) ─────────────────────────────────────────────────

/** `confirm_above` — порог `confirm_above_kop` из параметров стенда: значение даёт **сервер**, литералом в коде его нет.
 *  `funding.label` — текст банка; номера карты и его частей в контракте нет (инвариант 1), показывать ли последние
 *  цифры — решает банк, текстом метки.
 *  `signature_level` — уровень подписи ядра (`SignatureLevel`). Связь с уровнями K6/K7/K8 канвы — открытый вопрос
 *  § 8 п. 3; таблицы соответствия в коде нет, и домысливать её здесь нельзя. */
export interface LimitsResponse {
  readonly per_purchase: UiMoney;
  readonly per_month: UiMoney;
  readonly confirm_above: UiMoney;
  readonly signature_level: SignatureLevel;
  readonly funding: readonly { readonly ref: string; readonly label: string }[];
}

// ── § 5.16 `GET` и `POST /ui/v1/learn/{id}` — обучение (У10) ─────────────────────────────────────────────────────────

/** Один вопрос за раз, принять или отклонить. **Пределов обучение не трогает никогда**: сервер отклоняет любое
 *  изменение пределов через этот метод. На стенде не работает до И-8 — 409 `NOT_ON_STAND`. */
export interface LearnResponse {
  readonly question: { readonly id: string; readonly text: string } | null;
}

export interface LearnAnswerRequest {
  readonly answer: "ACCEPT" | "DECLINE";
  readonly press: UiPress;
}
