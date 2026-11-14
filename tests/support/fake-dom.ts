// Подменённый DOM для скриптов страниц демо-стенда и пульта (П-2.1а, Р-1462) — без браузера и без jsdom. Дерево строится
// из настоящей разметки страницы (`fromHtml`): тест не расходится со страницей. Умеет то, чем пользуются скрипты пульта:
// getElementById, querySelector(All) и closest (тег, .класс, [атрибут], [атрибут='значение'], :not(…), список через
// запятую; без комбинаторов — потомка ищут вызовом у найденного узла), classList, dataset, hidden, textContent, фрагменты,
// события с всплытием, activeElement и focus(), CustomEvent. Переиспользуется в П-4 и П-5.
//
// Ограничения (ревью П-2.1а № 4, № 10) — чтобы тест не был ложно-зелёным:
//  - неподдержанный селектор (`#id`, пробел и `>`, `+`, `~`, псевдоклассы кроме `:not(…)`) — ошибка, а не совпадение;
//  - событие со снятого с дерева узла до `document` не всплывает (как в браузере); путь всплытия — до вызова слушателей;
//  - `hidden` и запись `textContent` не сбрасывают `activeElement`; `removeChild` чужого узла не бросает ошибку;
//  - разбор HTML — только своей разметки (escapeHtml, атрибуты в двойных кавычках); текст смешанного содержимого
//    узла (`a<b>b</b>c`) склеивается не по порядку: свой текст, затем дети.

type Listener = (ev: FakeEvent) => void;

export class FakeEvent {
  readonly type: string;
  readonly bubbles: boolean;
  readonly detail: unknown;
  target: FakeElement | FakeDocument | null = null;
  defaultPrevented = false;
  key?: string;
  isComposing?: boolean;
  constructor(type: string, init: { bubbles?: boolean; detail?: unknown; key?: string; isComposing?: boolean } = {}) {
    this.type = type;
    this.bubbles = init.bubbles ?? false;
    this.detail = init.detail;
    if (init.key !== undefined) this.key = init.key;
    if (init.isComposing !== undefined) this.isComposing = init.isComposing;
  }
  preventDefault(): void {
    this.defaultPrevented = true;
  }
}

class Listeners {
  readonly #map = new Map<string, Set<Listener>>();
  add(type: string, l: Listener): void {
    if (!this.#map.has(type)) this.#map.set(type, new Set());
    this.#map.get(type)!.add(l);
  }
  remove(type: string, l: Listener): void {
    this.#map.get(type)?.delete(l);
  }
  fire(ev: FakeEvent): void {
    for (const l of [...(this.#map.get(ev.type) ?? [])]) l(ev);
  }
  count(type: string): number {
    return this.#map.get(type)?.size ?? 0;
  }
}

const VOID = new Set(["meta", "link", "img", "br", "input", "hr"]);

export class FakeElement {
  readonly tagName: string;
  readonly children: FakeElement[] = [];
  parentNode: FakeElement | null = null;
  readonly attributes = new Map<string, string>();
  #text = "";
  readonly listeners = new Listeners();
  /** Свойства стиля, заданные скриптом (CSSOM): left, width… */
  readonly style: Record<string, string> = {};
  readonly ownerDocument: FakeDocument;
  readonly dataset: Record<string, string>;
  readonly classList: { add(c: string): void; remove(c: string): void; contains(c: string): boolean; toggle(c: string, on?: boolean): boolean };

  constructor(tag: string, doc: FakeDocument) {
    this.tagName = tag.toUpperCase();
    this.ownerDocument = doc;
    const attrs = this.attributes;
    // dataset — по атрибутам data-* (camelCase ↔ kebab-case), как в браузере.
    this.dataset = new Proxy({} as Record<string, string>, {
      get: (_t, k) => (typeof k === "string" ? attrs.get("data-" + kebab(k)) : undefined),
      set: (_t, k, v) => (typeof k === "string" && attrs.set("data-" + kebab(k), String(v)), true),
      deleteProperty: (_t, k) => (typeof k === "string" && attrs.delete("data-" + kebab(k)), true),
      has: (_t, k) => typeof k === "string" && attrs.has("data-" + kebab(k)),
      ownKeys: () => [...attrs.keys()].filter((a) => a.startsWith("data-")).map((a) => camel(a.slice(5))),
      getOwnPropertyDescriptor: (_t, k) =>
        typeof k === "string" && attrs.has("data-" + kebab(k)) ? { enumerable: true, configurable: true, value: attrs.get("data-" + kebab(k)) } : undefined,
    });
    const classes = () => new Set((this.attributes.get("class") ?? "").split(/\s+/).filter(Boolean));
    const write = (s: Set<string>) => this.attributes.set("class", [...s].join(" "));
    this.classList = {
      add: (c) => write(classes().add(c)),
      remove: (c) => {
        const s = classes();
        s.delete(c);
        write(s);
      },
      contains: (c) => classes().has(c),
      toggle: (c, on) => {
        const s = classes();
        const want = on ?? !s.has(c);
        if (want) s.add(c);
        else s.delete(c);
        write(s);
        return want;
      },
    };
  }

  get id(): string {
    return this.attributes.get("id") ?? "";
  }
  get className(): string {
    return this.attributes.get("class") ?? "";
  }
  set className(v: string) {
    this.attributes.set("class", v);
  }
  get hidden(): boolean {
    return this.attributes.has("hidden");
  }
  set hidden(v: boolean) {
    if (v) this.attributes.set("hidden", "");
    else this.attributes.delete("hidden");
  }
  get type(): string {
    return this.attributes.get("type") ?? "";
  }
  set type(v: string) {
    this.attributes.set("type", v);
  }
  get title(): string {
    return this.attributes.get("title") ?? "";
  }
  set title(v: string) {
    this.attributes.set("title", v);
  }
  /** Значение поля: у `input` — то, что задал скрипт или тест, иначе атрибут value; у `select` — только значение
   *  существующего option (как в браузере: значение вне списка даёт "", ревью П-2.3 № 10), без выбора — первый option. */
  #value: string | undefined;
  get value(): string {
    if (this.tagName === "SELECT") {
      const opts = this.querySelectorAll("option").map((o) => o.getAttribute("value") ?? o.textContent);
      if (this.#value !== undefined) return opts.includes(this.#value) ? this.#value : "";
      return opts[0] ?? "";
    }
    return this.#value ?? this.attributes.get("value") ?? "";
  }
  set value(v: string) {
    this.#value = String(v);
  }
  /** Флажок: без задания — по атрибуту checked. */
  #checked: boolean | undefined;
  get checked(): boolean {
    return this.#checked ?? this.attributes.has("checked");
  }
  set checked(v: boolean) {
    this.#checked = Boolean(v);
  }
  get firstChild(): FakeElement | null {
    return this.children[0] ?? null;
  }
  /** Текст: свой и детей. Запись заменяет детей текстом — как textContent в браузере. */
  get textContent(): string {
    return this.#text + this.children.map((c) => c.textContent).join("");
  }
  set textContent(v: string) {
    for (const c of this.children) c.parentNode = null;
    this.children.length = 0;
    this.#text = String(v);
  }
  /** Собственный текст узла без детей (для разбора HTML). */
  appendText(t: string): void {
    this.#text += t;
  }

  setAttribute(k: string, v: string): void {
    this.attributes.set(k, String(v));
  }
  getAttribute(k: string): string | null {
    return this.attributes.get(k) ?? null;
  }
  hasAttribute(k: string): boolean {
    return this.attributes.has(k);
  }
  removeAttribute(k: string): void {
    this.attributes.delete(k);
  }

  appendChild<T extends FakeElement>(c: T): T {
    if (c.tagName === "#FRAGMENT") {
      for (const x of [...c.children]) this.appendChild(x);
      c.children.length = 0;
      return c;
    }
    c.parentNode?.removeChild(c);
    c.parentNode = this;
    this.children.push(c);
    return c;
  }
  removeChild<T extends FakeElement>(c: T): T {
    const i = this.children.indexOf(c);
    if (i >= 0) this.children.splice(i, 1);
    c.parentNode = null;
    if (this.ownerDocument.activeElement && !this.ownerDocument.contains(this.ownerDocument.activeElement)) this.ownerDocument.activeElement = this.ownerDocument.body;
    return c;
  }
  contains(x: FakeElement | null): boolean {
    for (let n: FakeElement | null = x; n; n = n.parentNode) if (n === this) return true;
    return false;
  }

  matches(selector: string): boolean {
    return selector.split(",").some((s) => matchSimple(this, supported(s.trim())));
  }
  closest(selector: string): FakeElement | null {
    if (this.matches(selector)) return this;
    for (let n = this.parentNode; n; n = n.parentNode) if (n.matches(selector)) return n;
    return null;
  }
  querySelectorAll(selector: string): FakeElement[] {
    const out: FakeElement[] = [];
    const walk = (n: FakeElement) => {
      for (const c of n.children) {
        if (c.matches(selector)) out.push(c);
        walk(c);
      }
    };
    walk(this);
    return out;
  }
  querySelector(selector: string): FakeElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  addEventListener(type: string, l: Listener): void {
    this.listeners.add(type, l);
  }
  removeEventListener(type: string, l: Listener): void {
    this.listeners.remove(type, l);
  }
  /** Событие у узла и всплытие к предкам и документу (если bubbles). Путь — до вызова слушателей; до документа — только
   *  если узел в документе (как в браузере). */
  dispatchEvent(ev: FakeEvent): boolean {
    ev.target = this;
    const path: Listeners[] = [this.listeners];
    if (ev.bubbles) {
      for (let n = this.parentNode; n; n = n.parentNode) path.push(n.listeners);
      if (this.ownerDocument.contains(this)) path.push(this.ownerDocument.listeners);
    }
    for (const l of path) l.fire(ev);
    return !ev.defaultPrevented;
  }
  /** Щелчок: событие click со всплытием. */
  click(): void {
    this.dispatchEvent(new FakeEvent("click", { bubbles: true }));
  }
  focus(): void {
    this.ownerDocument.activeElement = this;
  }
}

const kebab = (s: string) => s.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase());
const camel = (s: string) => s.replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase());

/** Неподдержанное — ошибка, а не молчаливое совпадение (ревью П-2.1а № 4). */
function supported(sel: string): string {
  const bare = sel.replace(/\[[^\]]*\]/g, "[]").replace(/:not\([^)]*\)/g, "");
  if (sel === "" || /[#>+~:\s]/.test(bare)) throw new Error(`подмена DOM: селектор не поддержан — «${sel}»`);
  return sel;
}

/** Простой селектор: тег, .класс, [атрибут], [атрибут='значение'], :not(простой). */
function matchSimple(el: FakeElement, sel: string): boolean {
  let rest = sel;
  const nots: string[] = [];
  rest = rest.replace(/:not\(([^)]*)\)/g, (_m, inner: string) => (nots.push(inner), ""));
  const tag = /^[a-zA-Z][a-zA-Z0-9-]*/.exec(rest)?.[0];
  if (tag && el.tagName !== tag.toUpperCase()) return false;
  for (const m of rest.matchAll(/\.([a-zA-Z0-9_-]+)/g)) if (!el.classList.contains(m[1]!)) return false;
  for (const m of rest.matchAll(/\[([a-zA-Z0-9_-]+)(?:=['"]?([^'"\]]*)['"]?)?\]/g)) {
    const v = el.attributes.get(m[1]!);
    if (v === undefined) return false;
    if (m[2] !== undefined && v !== m[2]) return false;
  }
  return nots.every((n) => !matchSimple(el, n.trim()));
}

export class FakeDocument {
  readonly listeners = new Listeners();
  readonly documentElement: FakeElement;
  readonly body: FakeElement;
  activeElement: FakeElement;
  constructor() {
    this.documentElement = new FakeElement("html", this);
    this.body = new FakeElement("body", this);
    this.documentElement.appendChild(this.body);
    this.activeElement = this.body;
  }
  createElement(tag: string): FakeElement {
    return new FakeElement(tag, this);
  }
  createDocumentFragment(): FakeElement {
    return new FakeElement("#fragment", this);
  }
  contains(x: FakeElement): boolean {
    return this.documentElement.contains(x);
  }
  getElementById(id: string): FakeElement | null {
    if (this.documentElement.id === id) return this.documentElement;
    return this.documentElement.querySelectorAll(`[id='${id}']`)[0] ?? null;
  }
  querySelectorAll(s: string): FakeElement[] {
    return this.documentElement.querySelectorAll(s);
  }
  querySelector(s: string): FakeElement | null {
    return this.documentElement.querySelector(s);
  }
  addEventListener(type: string, l: Listener): void {
    this.listeners.add(type, l);
  }
  removeEventListener(type: string, l: Listener): void {
    this.listeners.remove(type, l);
  }
  dispatchEvent(ev: FakeEvent): boolean {
    ev.target = this;
    this.listeners.fire(ev);
    return !ev.defaultPrevented;
  }
}

const ENTITY: Readonly<Record<string, string>> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'" };
const decode = (s: string) => s.replace(/&(amp|lt|gt|quot|#39);/g, (_m, e: string) => ENTITY[e]!);

/** Дерево из своей разметки страницы: `<body>` страницы становится body документа; скрипты `<script src>` не грузятся,
 *  содержимое `<script type="application/json">` — текст узла. */
export function fromHtml(html: string): FakeDocument {
  const doc = new FakeDocument();
  const stack: FakeElement[] = [doc.documentElement];
  const top = () => stack[stack.length - 1]!;
  const re = /<!doctype[^>]*>|<!--[^]*?-->|<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^\s=>]+(?:="[^"]*")?)*)\s*\/?>|([^<]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    if (m[4] !== undefined) {
      if (m[4].trim()) top().appendText(decode(m[4]));
      continue;
    }
    if (!m[2]) continue;
    const tag = m[2].toLowerCase();
    if (m[1]) {
      for (let i = stack.length - 1; i > 0; i--)
        if (stack[i]!.tagName === tag.toUpperCase()) {
          stack.length = i;
          break;
        }
      continue;
    }
    if (tag === "html") continue;
    const el = tag === "body" ? doc.body : doc.createElement(tag);
    for (const a of (m[3] ?? "").matchAll(/([^\s=>]+)(?:="([^"]*)")?/g)) el.setAttribute(a[1]!, a[2] !== undefined ? decode(a[2]) : "");
    if (tag !== "body") top().appendChild(el);
    if (tag === "script") {
      // Сырой текст до </script>.
      const end = html.indexOf("</script>", re.lastIndex);
      el.appendText(html.slice(re.lastIndex, end));
      re.lastIndex = end + "</script>".length;
      continue;
    }
    if (!VOID.has(tag)) stack.push(el);
  }
  return doc;
}

/** Окружение скрипта страницы: EventSource, localStorage, setInterval — заглушки, видимые тесту. */
export interface PageEnv {
  readonly document: FakeDocument;
  readonly window: Record<string, unknown>;
  readonly sources: FakeEventSource[];
  readonly storage: Map<string, string>;
  /** Колбэки setInterval: тест вызывает их сам. */
  readonly intervals: (() => void)[];
  /** Выполнить скрипт страницы (текст файла) в этом окружении. */
  run(script: string): void;
}

export class FakeEventSource {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  readonly url: string;
  readyState = 0;
  onmessage: ((m: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(url: string) {
    this.url = url;
  }
  /** Сообщение сервера (объект — в JSON). */
  send(data: unknown): void {
    this.onmessage?.({ data: JSON.stringify(data) });
  }
}

export function pageEnv(html: string, o: { storage?: "ok" | "throws"; stored?: Record<string, string> } = {}): PageEnv {
  const document = fromHtml(html);
  const sources: FakeEventSource[] = [];
  const storage = new Map(Object.entries(o.stored ?? {}));
  const intervals: (() => void)[] = [];
  const throws = o.storage === "throws";
  const localStorage = {
    getItem: (k: string) => {
      if (throws) throw new Error("хранилище недоступно");
      return storage.get(k) ?? null;
    },
    setItem: (k: string, v: string) => {
      if (throws) throw new Error("хранилище недоступно");
      storage.set(k, v);
    },
  };
  const ES = class extends FakeEventSource {
    constructor(url: string) {
      super(url);
      sources.push(this);
    }
  };
  const window: Record<string, unknown> = {};
  const globals: Record<string, unknown> = {
    document,
    window,
    Element: FakeElement,
    EventSource: ES,
    CustomEvent: FakeEvent,
    localStorage,
    setInterval: (f: () => void) => (intervals.push(f), intervals.length),
  };
  return {
    document,
    window,
    sources,
    storage,
    intervals,
    run(script: string) {
      const names = Object.keys(globals);
      new Function(...names, script)(...names.map((n) => globals[n]));
    },
  };
}
