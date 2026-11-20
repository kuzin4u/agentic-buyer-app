// Раздача каркаса экрана (ИН-0, кирпич К3; решение П4, Р-1601 «сначала мобильный», Р-1602 «Svelte»).
//
// Почему страницу собирает сервер, а не отдаёт статикой: её надо собрать **на языке запроса** и с брендом из
// конфигурации (инвариант 7, правило планов № 3), а при раздаче человеку выдаётся сессия приложения (К2а, Р-1640) —
// cookie same-origin, без которой маршруты `/ui/v1` данных не отдают.
//
// Политика CSP `'self'` держится без исключений (П4 п. 3): на странице нет ни inline-скрипта, ни inline-стиля. Код
// каркаса — файлом `/ui.js`, собранные стили — файлом `/ui.css` (сборка `cssCodeSplit: false`), цвета бренда —
// файлом `/brand.css`, логотип — `/brand/logo`. **Замечание № 3 ревью К1 закрыто здесь:** собранный CSS подключает
// сервер, и «стили не доехали» больше не толкает к inline-стилю.
//
// Чего каркас не делает (правило 3 К-Б «Экран ничего не считает», инвариант 2):
// - не держит своих текстов — они приходят с сервера `GET /ui/shell` парами ru/en;
// - не держит таблицы «состояние → шаг» — шаг приходит полем `step` ответа § 5.3;
// - не считает сумм и остатков — строки `done_line` собирает сервер;
// - не заводит своих подписей ролей: они одни с пультом (требование владельца 14.11 — пульт и пользовательский
//   интерфейс части одного продукта), поэтому `parties` отдаются из `PARTY_LABEL` справочника пульта.
//
// Граница импортов та же, что у `index.ts`: `node:*`, свои модули, типы контракта КТ-0 и общий словарь подписей ролей.
// `escapeHtml` и сборка `brand.css` здесь **свои**, а не взяты из `src/demo/html.ts` и `src/demo/server.ts`: `src/demo/`
// это тестовый интерфейс (П2), и пользовательская граница на него не опирается.
import { readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname } from "node:path";
import { parseBrand, type Brand } from "../brand.js";
import { UI_STEPS, type UiLang, type UiRetryClass, type UiSignedBy, type UiStep } from "../contract/ui-v1/index.js";
import { PARTIES, PARTY_LABEL, type Party } from "../pult/rules89.js";
import { BOOT_KEYS, bootAttr } from "./boot-text.js";
import { t, UI_LANGS, UI_TEXT, type Phrase } from "./lang.js";
import type { Provenance } from "./provenance.js";
import type { Sessions } from "./session.js";

/**
 * Места пути — У8, У9, У10 (§ 5.10–5.16 контракта: отзыв и история, спор, обучение).
 *
 * Перечень **свой**, и это не копия `UI_STEPS`: шаги `U1…U7` — путь одной покупки, а места — разделы приложения, и в
 * типе `UiStep` контракта их нет и быть не должно. В каркасе они пустые («скоро» со своим текстом): экраны ИН-П*, И-1,
 * И-2 и дальше встают в готовое место, а не пристраиваются к навигации потом.
 */
export const SHELL_PLACES = ["U8", "U9", "U10"] as const;

export type ShellPlace = (typeof SHELL_PLACES)[number];

/** Тексты каркаса — парами `{ ru, en }` одним объектом, как `UI_TEXT` сервера: пара держится типом, и язык не может
 *  появиться с одной стороны (правило планов № 3). Имени банка здесь нет ни в одной строке — бренд из конфигурации. */
export const SHELL_TEXT = {
  "app.title": { ru: "Агент покупателя", en: "Buyer agent" },
  "app.subtitle": { ru: "Что агент делает в пределах поручения", en: "What the agent does within the mandate" },

  // ── Навигация: шаги покупки и места пути ──
  "nav.steps": { ru: "Шаги покупки", en: "Purchase steps" },
  "nav.places": { ru: "Разделы", en: "Sections" },
  "nav.here": { ru: "вы здесь", en: "you are here" },
  "step.U1": { ru: "Поручение", en: "Mandate" },
  "step.U2": { ru: "Подпись в банке", en: "Signature in the bank" },
  "step.U3": { ru: "Варианты", en: "Options" },
  "step.U4": { ru: "Проверка у продавца", en: "Check with the seller" },
  "step.U5": { ru: "Корзина", en: "Cart" },
  "step.U6": { ru: "Оплата", en: "Payment" },
  "step.U7": { ru: "Итог", en: "Result" },
  "place.U8": { ru: "Поручения и история", en: "Mandates and history" },
  "place.U9": { ru: "Спор", en: "Dispute" },
  "place.U10": { ru: "Обучение", en: "Learning" },

  // ── Состояния каркаса ──
  /** место под будущий экран: каркас честно говорит, что экрана ещё нет, а не рисует пустоту */
  "state.soon": { ru: "Экран скоро появится.", en: "This screen is coming soon." },
  "state.loading": { ru: "Загрузка…", en: "Loading…" },
  /** ответ есть, но он не по форме (служебный `text/plain`, 500, 421): причина **не та же**, что «нет связи», и
   *  называть её «нет связи» значило бы сказать человеку неправду (находка ревью К3 № 2) */
  "state.broken": { ru: "Сбой на нашей стороне. Попробуйте ещё раз.", en: "Something went wrong on our side. Please try again." },
  /** поток оборвался при уже показанных данных: они не исчезают, но свежими больше не считаются (находка ревью К3 № 7) */
  "state.stale": { ru: "Связь с потоком прервалась — данные могли устареть.", en: "The signal stream dropped — the data may be out of date." },
  /** поток **закрыт** и сам не переподключится (403, 404): сигналов не будет вовсе, и молчать об этом нельзя —
   *  человек считал бы показанное свежим (находка ревью К3а № 2) */
  "state.feed_closed": {
    ru: "Поток сигналов закрыт: об изменениях не сообщат. Обновите состояние сами.",
    en: "The signal stream is closed: changes will not be announced. Refresh the state yourself.",
  },
  "action.refresh": { ru: "Обновить", en: "Refresh" },
  /** связь с сервером приложения потеряна: по правилу 4 показывать нечего, пока не перечитаем */
  "state.offline": { ru: "Нет связи с приложением.", en: "No connection to the app." },
  "state.no_purchase": {
    ru: "Покупка не выбрана: каркас показывает шаги без данных.",
    en: "No purchase selected: the frame shows the steps without data.",
  },
  /** каркас собран, но файла сборки нет — это чинится сборкой, а не перезагрузкой страницы */
  "state.not_built": { ru: "Каркас экрана не собран.", en: "The screen bundle is not built." },
  /**
   * Страницу просит тот, у кого **входа нет вовсе** (`ownerOnPage` вернул `null`): сессию выдавать некому, и совета
   * «откройте заново» здесь быть не должно — открывать нечего, это был бы тупик и неверная причина, ровно те, ради
   * которых делался К7 (находка ревью К7 № 1). Сюда человек попадает, только если запросил страницу без входа.
   */
  "state.no_session": { ru: "Вход не выполнен.", en: "Not signed in." },
  /**
   * Сессия приложения кончилась или её не было у **запроса экрана** — это другой случай и другое лечение: страницу
   * выдаёт раздача каркаса, и её открытие создаёт сессию.
   *
   * Строка **не копия**, а та же пара, что у кода `SESSION_REQUIRED` сервера (`UI_TEXT`): одна причина на двух
   * границах называется одними словами, и разойтись копиям нечем — ссылка, а не повтор текста (находка ревью К7 № 7).
   */
  "state.session_gone": UI_TEXT["error.SESSION_REQUIRED"],
  /** выход из «вход истёк» — **открыть страницу заново**: она выдаёт сессию. Не «повторить»: повтор того же запроса
   *  сессии не создаст и крутился бы без выхода (Р-1665) */
  "action.reopen": { ru: "Открыть заново", en: "Open again" },
  // Ключа `state.action_soon` здесь больше нет: подпись «действие появится со своим экраном» была подписью **экрана**
  // под кнопкой, а по правилу 3 причину недоступности называет сервер — она переехала в `action.stop.not_yet`
  // (`lang.ts`, кирпич К3а). Мёртвую строку словаря убираем сразу: оставленная, она позже была бы подхвачена «по
  // смыслу» и разошлась с решением сервера (находка ревью К3б № 6).
  // ── Кто подписывает (П26, П5 п. 3; кирпич К6) ──
  /** подпись здесь делает **прогон тестов**, а не человек: человек должен видеть это на экране, а не только в записи
   *  журнала — акты уходят в НСПК, где «не человек» и «прогон» читаются по-разному (П26 доп. 2) */
  "signed.test": { ru: "Подписано прогоном тестов, не вами", en: "Signed by the test run, not by you" },
  /** подпись делает эмулятор клиента демо-стенда (`DEMO_FAULTS=1`, режим «Авто», П5) */
  "signed.emulator": { ru: "Подписано эмулятором клиента, не вами", en: "Signed by the client emulator, not by you" },
  /** признак не `human`, но его имя экрану незнакомо (у контракта появилось новое значение): пометка всё равно
   *  показывается — «не человек» это важная часть, и терять её молча нельзя (находка ревью К5 № 3) */
  "signed.other": { ru: "Подписано не вами", en: "Signed, but not by you" },
  "error.title": { ru: "Действие не выполнено", en: "The action did not complete" },
  "action.retry": { ru: "Повторить", en: "Retry" },
  "lang.switch": { ru: "Язык", en: "Language" },

  // ── Что делать по классу повтора (§ 3 «Ошибки»): текст действия, а не пересказ кода ──
  /** то же действие тем же ключом повторит сам экран */
  "retry.same_key": { ru: "Можно повторить то же действие.", en: "You can repeat the same action." },
  /** сначала правится запрос, потом повтор */
  "retry.after_fix": { ru: "Повторите после исправления.", en: "Repeat after fixing the request." },
  /** решение принадлежит человеку: карточка показывается заново */
  "retry.after_human": { ru: "Посмотрите новые условия и решите заново.", en: "Review the new terms and decide again." },
  "retry.never": { ru: "Повтор не поможет.", en: "Repeating will not help." },
} as const satisfies Readonly<Record<string, Phrase>>;

export type ShellTextKey = keyof typeof SHELL_TEXT;

/** Название языка **на нём самом**: в переключателе человек ищет свой язык, а не его код. Пары `{ ru, en }` здесь не
 *  нужны и были бы ошибкой — «Русский» по-английски в переключателе не помогает никому (находка ревью К3 № 9). */
export const LANG_NAME: Readonly<Record<UiLang, string>> = { ru: "Русский", en: "English" };

/** Шаг в навигации: опознаватель шага контракта и подпись человеку. */
export interface ShellStepView {
  readonly id: UiStep;
  readonly label: string;
}

/** Место пути в навигации. */
export interface ShellPlaceView {
  readonly id: ShellPlace;
  readonly label: string;
}

/**
 * Всё, что каркасу нужно знать, одним ответом `GET /ui/shell`.
 *
 * Зачем отдельным ответом, а не вшито в страницу: inline-данные в разметке — это `<script>` на странице, то есть
 * первый шаг к ослаблению CSP (П4 п. 3). А зачем с сервера, а не в коде экрана: иначе перечень шагов и тексты
 * появились бы второй копией рядом с `UI_STEPS` и `SHELL_TEXT` и разъехались с ними на первой же правке (Р-1511
 * «закрытые перечни — из кода источника»).
 */
export interface ShellData {
  readonly lang: UiLang;
  readonly langs: readonly UiLang[];
  /** другой язык — для переключателя; выбор языка остаётся за сервером, экран его не выводит */
  readonly other: UiLang;
  /** название другого языка на нём самом — подпись переключателя человеку, а не его код */
  readonly other_name: string;
  readonly brand: { readonly name: string; readonly logo: string | null };
  readonly steps: readonly ShellStepView[];
  readonly places: readonly ShellPlaceView[];
  /**
   * Подписи ролей — один словарь с пультом, своих у каркаса нет (требование владельца 14.11).
   *
   * В К3 ни один экран роли ещё не называет, то есть поле отдаётся **для экранов ИН-П\*, И-1, И-2** — и именно поэтому
   * оно закрыто тестом К4 «`parties` равны `PARTY_LABEL` на оба языка» (находка ревью К3 № 5): иначе словарь разъехался
   * бы молча до того, как подпись впервые появится на экране. Форма подписей (множественное число каталога правил —
   * «Клиенты», «Агенты») для пользовательского экрана, возможно, не та: вопрос владельцу вместе с расхождением № 19,
   * словарь лежит в `src/pult/` и окном Б не правится (находка ревью К3 № 6).
   */
  readonly parties: Readonly<Record<Party, string>>;
  readonly text: Readonly<Record<ShellTextKey, string>>;
  readonly retry: Readonly<Record<UiRetryClass, string>>;
  /**
   * Кто поставит подпись, если нажать прямо сейчас (П26, кирпичи К5 и К6).
   *
   * Отдаётся **сервером**, а не выводится экраном: признак знает тот, кто поднял стенд. Не `human` — значит подпись
   * здесь делает прогон или эмулятор, и человек должен видеть это на экране, а не только в журнале (П5 п. 3, П26;
   * строка STATUS «Признак „кто нажал“ видно только в журнале» — находка ревью К1.3 № 8).
   */
  readonly signed_by: UiSignedBy;
}

const st = (lang: UiLang, key: ShellTextKey): string => SHELL_TEXT[key][lang];

/** Данные каркаса на языке запроса. Ни одной величины здесь не вычисляется — это перекладка словарей, конфигурации и
 *  признака «кто нажал» от сервера.
 *
 *  У `signedBy` **нет умолчания** (находка ревью К5 № 2): умолчание `"human"` означало бы, что вызов, забывший
 *  аргумент, молча покажет человека там, где подписывает прогон, — а П26 дополнение 2 требует ровно обратного. */
export function shellData(lang: UiLang, brand: Brand, hasLogo: boolean, signedBy: UiSignedBy): ShellData {
  const text = Object.fromEntries((Object.keys(SHELL_TEXT) as ShellTextKey[]).map((k) => [k, st(lang, k)])) as Record<
    ShellTextKey,
    string
  >;
  const parties = Object.fromEntries(PARTIES.map((p) => [p, PARTY_LABEL[p][lang]])) as Record<Party, string>;
  const other: UiLang = lang === "ru" ? "en" : "ru";
  return {
    lang,
    langs: UI_LANGS,
    other,
    other_name: LANG_NAME[other],
    brand: { name: brand.name, logo: hasLogo ? "/brand/logo" : null },
    steps: UI_STEPS.map((id) => ({ id, label: st(lang, `step.${id}`) })),
    places: SHELL_PLACES.map((id) => ({ id, label: st(lang, `place.${id}`) })),
    parties,
    text,
    retry: {
      same_key: st(lang, "retry.same_key"),
      after_fix: st(lang, "retry.after_fix"),
      after_human: st(lang, "retry.after_human"),
      never: st(lang, "retry.never"),
    },
    signed_by: signedBy,
  };
}

/** Экранирование текста в разметке. Своё, а не из `src/demo/html.ts` (граница тестового и пользовательского
 *  интерфейса). Данные витрин и ответы продавцов на страницу каркаса не попадают вовсе, но название банка из
 *  конфигурации — попадает, и подставляется оно экранированным (инвариант 4: данные показываются как текст). */
export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** Цвета бренда — файлом, а не атрибутом `style` на странице: inline-стиль потребовал бы `'unsafe-inline'` (П4 п. 3).
 *  Значения приходят из конфигурации и проверены `parseBrand` (`#RRGGBB`), поэтому в CSS не попадёт ничего, кроме цвета. */
export function brandCss(b: Brand): string {
  return `:root{--brand-primary:${b.colors.primary};--brand-on-primary:${b.colors.onPrimary};--brand-accent:${b.colors.accent}}\n`;
}

/**
 * Страница каркаса. Разметки в ней ровно столько, чтобы подключить файлы и дать точку монтирования: всё остальное
 * рисует Svelte-приложение.
 *
 * `data-lang` — язык, **выбранный сервером** (`?lang=` или язык по умолчанию): экран не угадывает его по браузеру,
 * иначе язык страницы и язык ответов `/ui/v1` могли бы разойтись.
 * `width=device-width` и ширина без фиксированных величин — основа мобильной раскладки 360–430 (Р-1601); раскрытие до
 * веба шире 430 — ИН-ВЕБ.
 *
 * Четыре текста уходят **атрибутами** точки монтирования: без них экран, у которого не доехал `GET /ui/shell`, не
 * может сказать по-человечески ни «нет связи», ни «сбой», ни «вход не выполнен», ни «повторить» — и остаётся пустым
 * навсегда (находки ревью К3 № 1 и К3а № 1). Своего словаря у экрана по-прежнему нет: строки приходят с сервера и на
 * языке, который выбрал сервер. Имена атрибутов — одной копией в `boot-text.ts` (находка ревью К3а № 4). Атрибутами, а
 * не `<script type="application/json">`: исполняемого куска на странице быть не должно вовсе (П4 п. 3).
 */
export function page(lang: UiLang, brand: Brand): string {
  const title = `${escapeHtml(brand.name)} — ${escapeHtml(st(lang, "app.title"))}`;
  const boot = BOOT_KEYS.map((k) => `${bootAttr(k)}="${escapeHtml(st(lang, k))}"`).join(" ");
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<link rel="stylesheet" href="/brand.css">
<link rel="stylesheet" href="/ui.css">
</head>
<body>
<div id="app" data-lang="${lang}" ${boot}></div>
<script type="module" src="/ui.js"></script>
</body>
</html>
`;
}

export interface ShellOptions {
  /** Конфигурация бренда: `config/brand.*.json` (инвариант 7 — в коде бренда литералом нет). */
  readonly brandPath: string;
  /** Каталог сборки каркаса (`dist/ui` по `vite.ui.config.ts`). */
  readonly distDir?: string;
  /** Сессии приложения (К2а): страница выдаёт cookie, по которой потом отвечают маршруты `/ui/v1`. */
  readonly sessions: Sessions;
  /**
   * Кто получает сессию при раздаче страницы.
   *
   * Зависимость, а не умолчание: умолчание «выдадим сессию кому угодно» означало бы вход без входа, и ни один тест
   * этого бы не заметил. `null` — страницу не отдаём (403). На стенде это постоянный опознаватель стендового человека,
   * в банковской ветке (ИН-Б) — исход входа.
   */
  readonly ownerOnPage: (req: IncomingMessage) => string | null;
}

/** Бренд и логотип из конфигурации. Логотипа нет — шапка показывает только название: интерфейс без логотипа работает,
 *  интерфейс без названия — нет (`parseBrand` на пустом названии бросает). */
export function loadShellBrand(path: string): { readonly brand: Brand; readonly logo: Buffer | null; readonly logoType: string } {
  const brand = parseBrand(JSON.parse(readFileSync(path, "utf8")) as unknown);
  const read = (): Buffer | null => {
    try {
      return readFileSync(brand.logo);
    } catch {
      return null;
    }
  };
  const logo = read();
  const types: Readonly<Record<string, string>> = {
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
  };
  return { brand, logo, logoType: types[extname(brand.logo).toLowerCase()] ?? "application/octet-stream" };
}

/** Ответил ли обработчик каркаса на этот запрос. */
export type ShellHandler = (req: IncomingMessage, res: ServerResponse, u: URL, lang: UiLang) => boolean;

/**
 * Обработчик раздачи каркаса: страница, код, стили, бренд, данные каркаса.
 *
 * Все ответы — с теми же заголовками, что у `/ui/v1` (их передаёт вызывающий через `headers`): набор заголовков в двух
 * местах расходился бы молча — это была находка ревью К2 № 9.
 */
export function createShellHandler(o: ShellOptions, headers: Readonly<Record<string, string>>, signedBy: Provenance): ShellHandler {
  // Язык приходит аргументом от сервера `/ui/v1` (`langOf`): своего умолчания у раздачи нет — иначе страница и ответы
  // контракта могли бы разойтись в языке.
  const dist = o.distDir ?? "dist/ui";
  const { brand, logo, logoType } = loadShellBrand(o.brandPath);
  const css = brandCss(brand);

  /** Собранный файл каркаса. Читается при запросе, а не при старте: иначе сервер нельзя было бы поднять до первой
   *  сборки, и порядок «собери, потом запусти» превратился бы в правило, которое негде прочитать. */
  const bundle = (name: string): Buffer | null => {
    try {
      return readFileSync(`${dist}/${name}`);
    } catch {
      return null;
    }
  };

  const send = (res: ServerResponse, status: number, type: string, body: string | Buffer, extra: Readonly<Record<string, string>> = {}): true => {
    if (!res.writableEnded && !res.headersSent) {
      res.writeHead(status, { "content-type": type, ...headers, ...extra });
      res.end(body);
    }
    return true;
  };

  const text = (res: ServerResponse, status: number, lang: UiLang, key: ShellTextKey, extra?: Readonly<Record<string, string>>): true =>
    send(res, status, "text/plain; charset=utf-8", st(lang, key), extra);

  /** Служебные ответы — словами **сервера** `/ui/v1` (`UI_TEXT`), а не своими: «адрес не найден» и «метод не
   *  поддерживается» человек видит одинаково на обеих границах. */
  const http = (res: ServerResponse, status: number, lang: UiLang, key: "http.not_found" | "http.method_not_allowed", extra?: Readonly<Record<string, string>>): true =>
    send(res, status, "text/plain; charset=utf-8", t(lang, key), extra);

  return (req, res, u, lang) => {
    const path = u.pathname;
    const known = path === "/" || path === "/ui" || path === "/ui.js" || path === "/ui.css" || path === "/brand.css" || path === "/brand/logo" || path === "/ui/shell";
    if (!known) return false;
    // Чтение — только `GET`: изменяющих методов у раздачи нет, и 405 с перечнем честнее молчаливого 404.
    if ((req.method ?? "GET") !== "GET") return http(res, 405, lang, "http.method_not_allowed", { allow: "GET" });

    switch (path) {
      case "/":
      case "/ui": {
        // Сессия выдаётся **здесь** (К2а): без неё маршруты `/ui/v1` отдадут единый `PURCHASE_NOT_FOUND`, и каркас
        // покажет «покупка не найдена» вместо данных.
        const owner = o.ownerOnPage(req);
        if (owner === null) return text(res, 403, lang, "state.no_session");
        // Живая сессия того же человека **переиспользуется**: иначе каждая перезагрузка страницы и каждое
        // переключение языка выпускали бы новую запись, а на пределе `MAX_SESSIONS` вытеснялась бы самая давняя
        // живая — то есть сессия **другого** человека (находка ревью К3 № 3). Сессия другого владельца или её
        // отсутствие — выдаём новую.
        if (o.sessions.ownerOf(req) === owner) return send(res, 200, "text/html; charset=utf-8", page(lang, brand));
        const session = o.sessions.issue(owner);
        return send(res, 200, "text/html; charset=utf-8", page(lang, brand), { "set-cookie": session.setCookie });
      }
      case "/ui.js": {
        const body = bundle("ui.js");
        return body === null ? text(res, 503, lang, "state.not_built") : send(res, 200, "text/javascript; charset=utf-8", body);
      }
      case "/ui.css": {
        const body = bundle("ui.css");
        // Стилей может не быть вовсе (в каркасе без оформления) — это пустой ответ, а не ошибка: страница ссылается на
        // файл всегда, и 404 на нём выглядел бы поломкой.
        return send(res, 200, "text/css; charset=utf-8", body ?? "");
      }
      // Бренд и словарь — **с сессией**, как маршруты контракта (§ 3 «Авторизация»): данных покупки в них нет, но
      // название банка, цвета, логотип и весь набор текстов — это лицо приложения, и отдавать его всякому, кто
      // постучался на петлю, незачем (находки ревью К3 № 11 и К3а № 8: довод один и тот же для всех трёх адресов).
      // Страница сессию уже выдала, и cookie `SameSite=Strict` уходит со своими же подресурсами, поэтому свой экран
      // получает их всегда.
      // Эти три адреса спрашивает **экран**, у которого сессия кончилась или не доехала, — и ему открытие страницы
      // помогает (она выдаёт сессию), поэтому здесь `state.session_gone`, а не «вход не выполнен»: на странице
      // (`/`, `/ui`) причина другая — входа нет вовсе (находка ревью К7 № 1).
      case "/brand.css":
        return o.sessions.ownerOf(req) === null ? text(res, 403, lang, "state.session_gone") : send(res, 200, "text/css; charset=utf-8", css);
      case "/brand/logo":
        if (o.sessions.ownerOf(req) === null) return text(res, 403, lang, "state.session_gone");
        return logo === null ? http(res, 404, lang, "http.not_found") : send(res, 200, logoType, logo);
      case "/ui/shell":
        if (o.sessions.ownerOf(req) === null) return text(res, 403, lang, "state.session_gone");
        return send(res, 200, "application/json; charset=utf-8", JSON.stringify(shellData(lang, brand, logo !== null, signedBy())));
      default:
        // Адрес попал в `known`, но своей ветки не получил: это ошибка сборки раздачи, и отдавать по нему словарь «по
        // умолчанию» нельзя — новый маршрут начал бы молча отвечать чужим содержимым (находка ревью К3а № 7).
        return http(res, 404, lang, "http.not_found");
    }
  };
}
