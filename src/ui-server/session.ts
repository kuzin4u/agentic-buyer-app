// Сессия приложения — авторизация `/ui/v1` (ИН-0, кирпич К2а; решение владельца **Р-1640**; контракт К-Б § 3
// «Авторизация»: «веб и MAX — сессия приложения, cookie same-origin; под CSP `'self'` это не меняется»).
//
// Требование § 3 исполняется **здесь**, а не переносится в веб-раскладку: вариант «маршруты открыты, авторизация
// позже» отклонён владельцем. Без сессии ни один маршрут `/ui/v1` данных не отдаёт — ответ тот же единый
// `PURCHASE_NOT_FOUND`, по которому не видно, есть ли такая покупка вообще.
//
// Флаги cookie:
// - `HttpOnly` — скрипт страницы опознавателя сессии не читает: экран недоверенная среда (С-12, С-31, С-32), и
//   опознаватель, доступный скрипту, уехал бы вместе с любой внедрённой строкой;
// - `SameSite=Strict` — чужая страница запроса с нашей сессией не сделает (это же и есть защита от CSRF у POST, у
//   которых правило 2 проверяет ключ, но ключ не доказывает, кто нажал);
// - `Path=/` — экран и `/ui/v1` живут на одном происхождении (П4 п. 4), cookie одна на оба;
// - `Secure` — **на стенде не ставится**: стенд работает по `http://127.0.0.1` (П2 п. 2), и браузер cookie с `Secure`
//   по незащищённому соединению не сохранит. Вне стенда он **обязателен** — это строка в STATUS «Открыто» с адресом
//   **ИН-ВЕБ** и **ИН-Б** (дополнение владельца 19.11), а не умолчание в коде: без адреса отсутствие `Secure` уехало бы
//   в веб-раскладку и в банковскую ветку молча.
//
// В cookie — только опознаватель сессии. Ни имени человека, ни токена банка, ни реквизитов в ней нет (инвариант 1).
import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { PAO_IDEMPOTENCY_WINDOW_MS } from "./idempotency.js";

/** Имя cookie сессии. Константой, а не литералом по месту: имя читают и раздача экрана, и маршруты `/ui/v1`. */
export const UI_SESSION_COOKIE = "ui_session";

/** Срок сессии — то же окно, что у ключей повтора (один источник срока, `idempotency.ts`): сессия, живущая дольше
 *  окна идемпотентности, переживала бы ключи своих же действий. Дольше держать опознаватель в браузере и незачем:
 *  длинная сессия это длинное окно для украденной cookie. */
const TTL_MS = PAO_IDEMPOTENCY_WINDOW_MS;

/** Опознаватель владельца: короткая машинная строка и ничего больше (инвариант 1). Проверка формы — не украшение:
 *  без неё раздача экрана (К3) положила бы в память сессии имя, телефон или токен банка, и ни тип, ни тест этого бы не
 *  заметили (находка ревью К2а № 5). Тот же довод, по которому у зависимости `owner` нет умолчания. */
const OWNER_ID = /^[A-Za-z0-9_-]{1,64}$/;

export type OwnerId = string;

/** Предел числа сессий в памяти — как у памяти повторов: наполняется запросами извне. */
const MAX_SESSIONS = 10_000;

export interface SessionOptions {
  /** `true` — добавлять `Secure` (вне стенда обязателен); на стенде `http://127.0.0.1` — `false`. */
  readonly secure?: boolean;
  /** Часы — для проверок срока в тестах. */
  readonly now?: () => number;
  /** Опознаватель сессии — для проверок; по умолчанию UUID v4 из `node:crypto`. */
  readonly newId?: () => string;
}

/**
 * Сессии в памяти процесса.
 *
 * Как и память повторов, переживает ровно столько, сколько процесс: на стенде это верно (П2 п. 1–2), вне стенда
 * сессии переедут в хранилище — **строкой в STATUS «Открыто»**, а не молча.
 */
export class Sessions {
  private readonly live = new Map<string, { readonly owner: string; readonly at: number }>();
  private readonly now: () => number;
  private readonly newId: () => string;
  private readonly secure: boolean;

  constructor(o: SessionOptions = {}) {
    this.now = o.now ?? Date.now;
    this.newId = o.newId ?? randomUUID;
    this.secure = o.secure ?? false;
  }

  /** Выдать сессию человеку: опознаватель и готовое значение `Set-Cookie`. Вызывает раздача экрана (кирпич К3). */
  issue(owner: OwnerId): { readonly id: string; readonly setCookie: string } {
    if (!OWNER_ID.test(owner)) throw new TypeError("сессия: опознаватель владельца не по форме (инвариант 1)");
    // Сначала снимаются **истёкшие** записи, и только потом, если предел всё ещё взят, вытесняется самая давняя живая:
    // иначе 10 000 выдач (раздача экрана своей авторизации не имеет) выкинули бы из системы настоящих людей, а
    // истёкшие записи так и занимали бы предел до обращения по ним (находка ревью К2а № 2).
    if (this.live.size >= MAX_SESSIONS) {
      const now = this.now();
      for (const [id, s] of this.live) if (now - s.at > TTL_MS) this.live.delete(id);
    }
    if (this.live.size >= MAX_SESSIONS) {
      const oldest = this.live.keys().next();
      if (!oldest.done) this.live.delete(oldest.value);
    }
    const id = this.newId();
    this.live.set(id, { owner, at: this.now() });
    return { id, setCookie: this.cookie(id) };
  }

  /** Значение заголовка `Set-Cookie` для опознавателя. `Max-Age` — тот же срок, что у записи в памяти: иначе браузер
   *  присылал бы cookie, которой на сервере уже нет. */
  cookie(id: string): string {
    const parts = [`${UI_SESSION_COOKIE}=${id}`, "Path=/", "HttpOnly", "SameSite=Strict", `Max-Age=${Math.floor(TTL_MS / 1000)}`];
    if (this.secure) parts.push("Secure");
    return parts.join("; ");
  }

  /** Кто спрашивает: владелец по cookie запроса или `null`. Истёкшая сессия — `null`, и запись удаляется. */
  ownerOf(req: IncomingMessage): string | null {
    const id = cookieValue(req.headers.cookie, UI_SESSION_COOKIE);
    if (id === null) return null;
    const was = this.live.get(id);
    if (was === undefined) return null;
    if (this.now() - was.at > TTL_MS) {
      this.live.delete(id);
      return null;
    }
    return was.owner;
  }

  /** Закрыть сессию (выход, отзыв доступа). */
  close(id: string): void {
    this.live.delete(id);
  }

  /** Сколько сессий живёт — для проверок. */
  get size(): number {
    return this.live.size;
  }
}

/**
 * Значение cookie по имени из заголовка `Cookie`.
 *
 * Разбор свой и нарочно простой: пары через `;`, имя до первого `=`, пробелы по краям срезаются, парные кавычки
 * (допустимая форма RFC 6265) снимаются.
 *
 * **Две пары с одним именем — отказ (`null`), а не выбор одной из них** (находка ревью К2а № 1). Браузер присылает
 * раньше cookie с более длинным `Path`, то есть именно подкинутую (`ui_session=<чужой>; Path=/ui/v1`), а cookie не
 * разделяются по порту: любое другое происхождение на `127.0.0.1:<другой порт>` могло бы навязать человеку свой
 * опознаватель — это фиксация сессии, и `HttpOnly` с `SameSite=Strict` от неё не защищают (они про чтение скриптом и
 * про кросс-сайтовый запрос, а не про запись cookie). Выбирать «правильную» из двух нечем: какая из них своя, по
 * заголовку не видно. Поэтому дубль закрывает вход: человек войдёт заново, а чужой опознаватель не подойдёт никогда.
 */
export function cookieValue(header: string | undefined, name: string): string | null {
  if (header === undefined) return null;
  const values: string[] = [];
  for (const pair of header.split(";")) {
    const at = pair.indexOf("=");
    if (at < 0) continue;
    if (pair.slice(0, at).trim() !== name) continue;
    const raw = pair.slice(at + 1).trim();
    values.push(raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"') ? raw.slice(1, -1) : raw);
  }
  // Пустое значение тоже считается парой с этим именем: пара «настоящая cookie + подкинутая пустая» это дубль, а не
  // одно значение.
  if (values.length !== 1) return null;
  return values[0]!.length > 0 ? values[0]! : null;
}
