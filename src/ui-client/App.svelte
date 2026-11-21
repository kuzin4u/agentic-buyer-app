<!--
  Каркас экрана агента покупателя (ИН-0, кирпич К3; решение П4, Р-1601 «сначала мобильный», Р-1602 «Svelte»).

  Что он есть: шапка с брендом из конфигурации, переключатель языка, навигация по шагам U1…U7 и местам У8–У10,
  показ текущего шага **по полю `step` с сервера**, одна форма ошибки § 3 с действием по `retry`, «загрузка» и
  «нет связи», перечитывание покупки после сигнала потока (правило 4).

  Чего он не делает:
  - не считает сумм, остатков и пределов (инвариант 2) — обе строки «что сделано» и «не списано» приходят готовыми;
  - не выводит шаг из состояния — таблица «состояние → шаг» живёт у сервера (КТ-0, `STEP_OF_STATE`);
  - не держит своих текстов и перечней — всё приходит с `GET /ui/shell` (правило 3);
  - не рисует итог по событию потока — событие только сигнал, данные берутся перечитыванием;
  - не нажимает за человека (инвариант 3): пока у действия нет своего метода, это подпись, а не нажатие;
  - не вставляет разметку из данных: `{@html}` в каркасе нет (инвариант 4) — всё подставляется как текст.
-->
<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import type { PurchaseResponse } from "../contract/ui-v1/index.js";
  import type { ShellData } from "../ui-server/shell.js";
  import type { ConsentResponse, OnboardingResponse, OnboardingTermsResponse } from "../contract/ui-v1/index.js";
  import {
    langHref,
    loadOnboarding,
    loadPurchase,
    loadShell,
    loadTerms,
    openFeed,
    pageHref,
    pressNow,
    purchaseIdOf,
    sendConsent,
    type BootText,
    type ReadFail,
  } from "./api";
  import {
    acceptKeys,
    bootLine,
    canAccept,
    canRetryInPlace,
    failLine,
    isPlace,
    labelOf,
    latest,
    needsPage,
    pathLine,
    retry,
    retryLine,
    signedByLine,
    triggers,
  } from "./view";

  /**
   * `lang` — язык страницы: его выбрал **сервер** и положил в `data-lang` точки монтирования. Экран язык не выбирает
   * и не сверяет с перечнем: негодное значение отбросит сервер (`langOf`).
   * `boot` — строки со страницы (перечень — `BOOT_KEYS` в `boot-text.ts`) на тот случай, когда словарь ещё не доехал:
   * иначе экран остался бы пустым навсегда и выхода из этого не было бы (находки ревью К3 № 1 и К3а № 1). Число строк
   * здесь не называется — оно менялось уже дважды, и названное число разошлось бы с кодом (находка ревью К3б № 4).
   */
  const { lang, boot }: { lang: string; boot: BootText } = $props();

  const purchaseId = purchaseIdOf();

  // ── Знакомство: экраны П1 и П3 (кирпич К5) ──
  //
  // Путь приобретения идёт **до** покупки: пока её нет, человек выбирает агента и принимает условия. Поэтому
  // знакомство показывается, когда покупка не выбрана, а шаг приходит полем `path` (числа `n` и `of`) — у этого пути
  // своих имён шагов нет (Р-1678), и экран их не выдумывает.
  let onboarding = $state<OnboardingResponse | null>(null);
  /** Выбранный вид агента; `null` — человек ещё на П1. */
  let chosen = $state<string | null>(null);
  let terms = $state<OnboardingTermsResponse | null>(null);
  /** Отмеченные пункты согласия. Пусто с начала — обе галочки по умолчанию пустые (П26, Р-1676). */
  let ticked = $state<Set<string>>(new Set());
  /** Записанное согласие: ответ § 5.19. */
  let accepted = $state<ConsentResponse | null>(null);
  /**
   * Ключи повтора и провенанс нажатия: одна попытка на действие (правило 2) — правила живут в `view.ts`, где закрыты
   * тестом.
   *
   * `crypto.randomUUID` требует **секьюрного контекста**: на `http://` без петли его нет, и нажатие молча не
   * сработает. Демо-стенд поднимается на `127.0.0.1` (П2 п. 2), где контекст секьюрный; за его пределами это
   * ограничение ИН-ВЕБ, и своей выдумки ключа здесь быть не должно — ключ обязан быть UUID v4 по форме ПАО.
   */
  const keys = acceptKeys(
    () => crypto.randomUUID(),
    () => pressNow(terms?.view.text_version ?? ""),
  );
  let sending = $state(false);
  /**
   * Человеку надо сказать, что условия сменились (`SHOWN_STALE`).
   *
   * Флаг **не трогается** `choose`: иначе при неудачном перечитывании карточки (связь оборвалась) пометка висела бы
   * при пустой карточке, а следующий удачный повтор стёр бы её — человек получил бы новую карточку **без** слов об
   * изменении и отметил бы изменённые условия механически (находка второго прохода ревью К5 № 3). Гаснет только
   * тогда, когда сказать уже нечего: согласие записано или человек вернулся к выбору вида.
   */
  let termsChanged = $state(false);
  /** Что повторять по кнопке «Повторить» — последнее обращение, а не всегда покупка (находка ревью К5 № 1). */
  const again = retry();

  let shell = $state<ShellData | null>(null);
  let purchase = $state<PurchaseResponse | null>(null);
  /** Последняя неудача чтения — с **причиной**: отказ по контракту, нет связи или негодный ответ. */
  let fail = $state<ReadFail | null>(null);
  /** Поток оборвался при уже показанных данных: они не исчезают, но свежими больше не считаются (правило 4). */
  let stale = $state(false);
  /** Поток **закрыт** и сам не вернётся: об изменениях не сообщат вовсе, и это другое сообщение, чем «мог устареть». */
  let feedClosed = $state(false);
  let loading = $state(true);
  /** Что человек открыл в навигации. `null` — «идём за сервером»: показывается шаг из ответа § 5.3. */
  let opened = $state<string | null>(null);
  let feed: EventSource | null = null;

  /** Открытый раздел: выбор человека, иначе шаг с сервера. Своей таблицы шагов здесь нет — только одно поле ответа. */
  const current = $derived(opened ?? purchase?.step ?? null);

  /** Порядок чтений и признак «чтение идёт» — вынесены в `view.ts`, где они закрыты тестом (К4). */
  const reads = latest();

  async function readPurchase(): Promise<void> {
    if (purchaseId === null) {
      loading = false;
      return;
    }
    loading = true;
    const id = purchaseId;
    // `null` — ответ обогнало более новое чтение: показывать его нельзя (правило 4 — показывается последнее
    // прочитанное), и состояние экрана он не меняет.
    const got = await reads.run(() => loadPurchase(id, lang));
    if (got === null) return;
    loading = false;
    if (got.ok) {
      purchase = got.value;
      fail = null;
      stale = false;
      return;
    }
    // Причина сохраняется как есть: тело § 3 — ответ сервера с кодом и «что делать», «нет связи» и «негодный ответ» —
    // разные случаи без кода. Показать одно вместо другого значило бы сказать человеку неправду о причине.
    fail = got;
  }

  /** Словарь, затем покупка или знакомство. Вызывается на запуске и кнопкой «Повторить»: выход из отказа есть всегда. */
  async function start(): Promise<void> {
    loading = true;
    if (shell === null) {
      const got = await loadShell(lang);
      if (got.ok) {
        shell = got.value;
        fail = null;
      } else {
        loading = false;
        fail = got;
        return;
      }
    }
    // Покупки нет — человек в начале пути: читается знакомство (§ 5.17), а не пустые шаги покупки.
    if (purchaseId === null) {
      await readOnboarding();
      return;
    }
    await readPurchase();
  }

  /** Знакомство, экран П1 (§ 5.17). Запоминается как последнее обращение: кнопка «Повторить» повторит **его**.
   *  Чтение идёт через **тот же** порядок чтений, что у покупки (`reads`): два нажатия «Повторить» дают два запроса,
   *  и ответ, который обогнали, показывать нельзя (правило 4; находка второго прохода ревью К5 № 4). */
  async function readOnboarding(): Promise<void> {
    again.set(readOnboarding);
    loading = true;
    const got = await reads.run(() => loadOnboarding(lang));
    if (got === null) return;
    loading = false;
    if (got.ok) {
      onboarding = got.value;
      fail = null;
    } else {
      fail = got;
    }
  }

  /** Выбран вид агента — читаются его условия (§ 5.18). Невыбираемый сюда не приходит: кнопки у него нет. */
  async function choose(model: string): Promise<void> {
    chosen = model;
    terms = null;
    // Сброс отметок, ключа и пометки о смене условий — **одним местом**, здесь: вторая копия в `accept` разошлась бы
    // при первой же правке условия (находка ревью К5 № 11).
    ticked = new Set();
    accepted = null;
    keys.reset();
    again.set(() => choose(model));
    loading = true;
    // Тот же порядок чтений, что у покупки: обогнанный ответ состояние не меняет (находка второго прохода К5 № 4).
    const got = await reads.run(() => loadTerms(model, lang));
    if (got === null) return;
    loading = false;
    if (got.ok) {
      terms = got.value;
      fail = null;
    } else {
      fail = got;
    }
  }

  /** Вернуться к выбору вида агента. Нужен, когда отказ по этому виду окончателен: `MODEL_NOT_AVAILABLE` это класс
   *  `never`, повтор не поможет никогда, а годный выбор у человека есть (находка ревью К5 № 5). П1 уже прочитан,
   *  второй запрос не нужен. */
  function backToModels(): void {
    chosen = null;
    terms = null;
    ticked = new Set();
    accepted = null;
    termsChanged = false;
    keys.reset();
    fail = null;
    again.set(readOnboarding);
  }

  /** Отметить или снять пункт. Умолчания нет: пока человек не нажал, пункт не отмечен (П26). */
  function toggle(id: string): void {
    const next = new Set(ticked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    ticked = next;
  }

  /**
   * Принять условия (§ 5.19).
   *
   * Экран **не решает**, принято ли согласие: он отправляет отмеченное, хэш показанного и провенанс, а решает
   * сервер. Ключ повтора создаётся **один раз на нажатие** и переживает повтор после обрыва связи: иначе одно
   * согласие записалось бы дважды (правило 2).
   */
  async function accept(): Promise<void> {
    if (terms === null || chosen === null || sending) return;
    const model = chosen;
    const card = terms;
    const accepted_ids = [...ticked].sort();
    // Подпись действия: вид агента, набор отмеченных пунктов и хэш показанного — всё, что делает действие собой.
    // Время нажатия в подпись не входит, но приходит **из той же попытки**: иначе повтор послал бы другое тело при
    // том же ключе, а сервер считает отпечаток по всему телу (находка второго прохода ревью К5 № 9).
    const attempt = keys.for(`${model}|${accepted_ids.join(",")}|${card.view.hash}`);
    const key = attempt.key;
    const body = { model, accepted: accepted_ids, shown_hash: card.view.hash, press: attempt.press };
    // Повторяется **то же нажатие тем же ключом** — это и есть правило 2. Прежде повторить POST было нельзя вовсе:
    // кнопка звала чтение покупки, а ветка отказа заслоняла карточку с кнопкой (находка ревью К5 № 1).
    again.set(() => send(body, key));
    await send(body, key);
  }

  /** Отправка согласия и разбор исхода. Отдельно от `accept`, потому что повтор обязан послать **то же** тело с тем
   *  же ключом, а не собрать его заново: пересборка дала бы новое время провенанса, то есть другое тело. */
  async function send(body: Parameters<typeof sendConsent>[0], key: string): Promise<void> {
    if (sending) return;
    sending = true;
    const got = await sendConsent(body, key, lang);
    sending = false;
    if (got.ok) {
      accepted = got.value;
      fail = null;
      // Сказать о смене условий больше нечего: человек прочитал новые и согласился.
      termsChanged = false;
      return;
    }
    fail = got;
    if (got.reason !== "contract") return;
    // Карточка устарела — сервер прислал новую: показывается она, отметки сбрасываются, ключ забывается. Пометка о
    // смене условий ставится **до** перечитывания и `choose` её не трогает: если перечитать не удалось, она
    // дождётся удачного повтора, и человек всё равно прочитает, что условия изменились (правило 1).
    // Код сверяется с `SHOWN_STALE`, а не «пришла карточка — значит условия изменились»: с новой карточкой приходит
    // и `PRICE_CHANGED`, и сказать о нём «условия изменились» было бы неправдой (находка второго прохода К5 № 10).
    if (got.error.code === "SHOWN_STALE") {
      keys.reset();
      termsChanged = true;
      await choose(body.model);
      return;
    }
    // Ключ занят другим телом: следующее нажатие обязано идти своим ключом, иначе конфликт останется навсегда
    // (находка ревью К5 № 3).
    if (got.error.code === "IDEMPOTENCY_CONFLICT") keys.reset();
  }

  /** Правила «когда перечитывать» — в `view.ts`, где они закрыты тестом (К4а по находке ревью К4 № 5). Здесь только
   *  состояние: что считать своей покупкой, закрыт ли поток, идёт ли чтение. */
  const fire = triggers({
    purchaseId,
    hasPurchase: () => purchase !== null,
    feedClosed: () => feedClosed,
    busy: () => reads.busy,
    read: readPurchase,
    listen: () => listen(),
  });

  /** Открыть поток заново. Нужна отдельная функция: закрытый поток (403, 404) браузер не восстанавливает, и человеку
   *  даётся явное действие «Обновить» — перечитать покупку и попробовать поток снова (находка ревью К3а № 2). */
  function listen(): void {
    feed?.close();
    // Сигнал потока — только повод перечитать: статусов и сумм в нём нет (правило 4, инвариант 6 в редакции П31).
    feed = openFeed(fire.signal, (closed) => {
      // Временный обрыв: браузер переподключится сам (пауза приходит полем `retry:`), показанные данные помечаются
      // возможно устаревшими — но не исчезают и не подменяются догадкой. Закрытый поток — отдельный случай: сигналов
      // не будет вовсе, и об этом говорится прямо.
      feedClosed = closed;
      if (purchase !== null) stale = true;
    }, () => {
      feedClosed = false;
      fire.back();
    });
  }

  onMount(() => {
    void start();
    listen();
  });

  onDestroy(() => feed?.close());
</script>

{#if shell === null}
  {#if fail === null}
    <!-- Словарь ещё в пути: рисовать нечем, а своей строки «загрузка» у экрана нет (правило 3). Пустое место с
         признаком занятости честнее подставленного литерала, который не прошёл бы парность ru/en. -->
    <div class="boot" aria-busy="true"></div>
  {:else}
    <!-- Словарь не доехал. Строки — со страницы (их положил сервер на выбранном им языке), причина названа своя:
         «нет связи», «вход не выполнен» и «сбой» это разные случаи. Выход есть всегда: при отсутствии сессии —
         страница, которая её выдаёт (повтор того же чтения крутился бы без толку), иначе — повтор. -->
    <section class="box state" role="alert">
      <p>{bootLine(boot, fail)}</p>
      {#if needsPage(fail)}
        <!-- «Открыть заново», а не «Повторить»: сессию выдаёт **страница**, и повтор того же чтения крутился бы без
             выхода (кирпич К7, Р-1665). -->
        <a class="as-button" href={pageHref()}>{boot["action.reopen"]}</a>
      {:else}
        <button type="button" onclick={() => void start()}>{boot["action.retry"]}</button>
      {/if}
    </section>
  {/if}
{:else}
  <header class="top">
    {#if shell.brand.logo !== null}
      <img class="logo" src={shell.brand.logo} alt={shell.brand.name} width="28" height="28" />
    {/if}
    <span class="brand">{shell.brand.name}</span>
    <nav class="lang" aria-label={shell.text["lang.switch"]}>
      <!-- Подпись — название языка на нём самом (его даёт сервер), а не его код: код человеку ничего не говорит. -->
      <a href={langHref(shell.other)} hreflang={shell.other} lang={shell.other}>{shell.other_name}</a>
    </nav>
  </header>

  <h1>{shell.text["app.title"]}</h1>
  <p class="subtitle">{shell.text["app.subtitle"]}</p>

  <!-- Подписывает не человек (К6, П26 и П5 п. 3). Пометка стоит в шапке, а не у кнопки: она относится ко всему, что
       будет подписано в этом окне, и человек должен видеть её до нажатия, а не после. -->
  {#if signedByLine(shell) !== null}
    <p class="signed" role="status">{signedByLine(shell)}</p>
  {/if}

<!-- Навигация по шагам покупки и разделам показывается, только когда человек **в покупке**. На пути знакомства
     (П1, П3) эти кнопки нажимались, но ничего не меняли: ветки знакомства стоят раньше любых веток по `current` —
     кнопка без ответа это ложное обещание (находка ревью К5 № 12). -->
{#if purchaseId !== null}
  <nav class="rail" aria-label={shell.text["nav.steps"]}>
    <ol>
      {#each shell.steps as step (step.id)}
        <li>
          <button
            type="button"
            class:open={current === step.id}
            aria-current={current === step.id ? "step" : undefined}
            onclick={() => (opened = step.id)}
          >
            <span class="label">{step.label}</span>
            {#if purchase !== null && purchase.step === step.id}
              <span class="here">{shell.text["nav.here"]}</span>
            {/if}
          </button>
        </li>
      {/each}
    </ol>
  </nav>

  <nav class="rail places" aria-label={shell.text["nav.places"]}>
    <ul>
      {#each shell.places as place (place.id)}
        <li>
          <button type="button" class:open={current === place.id} onclick={() => (opened = place.id)}>
            <span class="label">{place.label}</span>
          </button>
        </li>
      {/each}
    </ul>
  </nav>
{/if}

  {#if purchase !== null && (feedClosed || stale)}
    <p class="stale" role="status">
      {feedClosed ? shell.text["state.feed_closed"] : shell.text["state.stale"]}
      <button type="button" onclick={() => void fire.refresh()}>{shell.text["action.refresh"]}</button>
    </p>
  {/if}

  <main>
    <!-- Ошибка чтения покупки заслоняет только **шаг покупки**: человек, открывший раздел У8–У10, должен видеть
         «экран скоро появится», а не отказ чтения, к которому этот раздел не относится (находка ревью К3а № 9). -->
    {#if fail !== null && isPlace(shell, current)}
      <section class="box soon">
        <h2>{labelOf(shell, current)}</h2>
        <p>{shell.text["state.soon"]}</p>
      </section>
    {:else if fail !== null && fail.reason === "contract"}
      <section class="box error" role="alert">
        <h2>{shell.text["error.title"]}</h2>
        <p class="said">{fail.error.text}</p>
        <!-- Класса повтора нет в перечне сервера (ядро добавило новый) — показывается сам класс, а не пустое место:
             тот же приём, что у подписи раздела (находка ревью К3а № 6). -->
        <p class="what">{retryLine(shell, fail.error)}</p>
        <p class="code"><code>{fail.error.code}</code></p>
        <!-- Кнопка — только когда «повторите то же тем же ключом»: при `after_fix` и `after_human` повтор того же
             действия расходился бы с подписью (находка ревью К3 № 8), а при `never` не помог бы никогда.
             Повторяется **последнее обращение**, а не всегда покупка (находка ревью К5 № 1). -->
        {#if canRetryInPlace(fail.error) && again.has}
          <button type="button" onclick={() => void again.run()}>{shell.text["action.retry"]}</button>
        {/if}
        <!-- «Исправьте и нажмите снова» — это и значит класс `after_fix`, и у человека должен быть путь к той же
             карточке с его отметками. Без него единственным выходом был сброс всего выбора (находка второго прохода
             ревью К5 № 6). Ключ при изменении отметок обновится сам, а при том же наборе повтор уйдёт тем же
             ключом с тем же телом. -->
        {#if terms !== null && fail.error.retry === "after_fix"}
          <button type="button" onclick={() => (fail = null)}>{shell.text["action.back_to_terms"]}</button>
        {/if}
        <!-- Выход с П3 есть при **любом** отказе, в том числе окончательном: у человека остаётся годный выбор на П1,
             и оставлять его без кнопки нельзя (находка ревью К5 № 5). -->
        {#if chosen !== null}
          <button type="button" onclick={() => backToModels()}>{shell.text["action.other_model"]}</button>
        {/if}
      </section>
    {:else if fail !== null}
      <section class="box state" role="alert">
        <p>{failLine(shell, fail)}</p>
        {#if needsPage(fail)}
          <a class="as-button" href={pageHref()}>{shell.text["action.reopen"]}</a>
        {:else if again.has}
          <button type="button" onclick={() => void again.run()}>{shell.text["action.retry"]}</button>
        {/if}
        {#if chosen !== null}
          <button type="button" onclick={() => backToModels()}>{shell.text["action.other_model"]}</button>
        {/if}
      </section>
    {:else if loading}
      <p class="state" role="status">{shell.text["state.loading"]}</p>
    {:else if accepted !== null}
      <!--
        Условия приняты. Экран показывает **только то, что пришло от сервера**: шаг пути строкой словаря, название
        выбранного вида агента (его дал § 5.17) и тексты пунктов, с которыми человек согласился (их дал § 5.18).
        Прежде заголовком стояла **подпись кнопки** «Принять условия», а под ней латинский код модели «M2» — и то и
        другое экран сшивал сам (находка ревью К5 № 7).
        Готовой строки итога у § 5.19 нет — вопрос владельцу в PR; выдумывать её здесь нельзя (правило 3).
      -->
      <section class="box step">
        <p class="path">{pathLine(shell, accepted.path)}</p>
        <h2>{onboarding?.models.find((m) => m.id === accepted?.consent.model)?.name ?? accepted.consent.model}</h2>
        <!-- С чем именно согласились: тексты пунктов, если карточка ещё в руках; иначе — сами опознаватели из
             ответа § 5.19. Тихо пустеть этот перечень не должен: «согласие записано», а с чем — не показано, было бы
             итогом без итога (находка второго прохода ревью К5 № 12; тот же приём, что у незнакомого класса
             повтора — показывается само значение). -->
        <ul class="can">
          {#each accepted.consent.accepted as id (id)}
            <li>{terms?.consents.find((c) => c.id === id)?.text ?? id}</li>
          {/each}
        </ul>
      </section>
    {:else if terms !== null}
      <!-- ── Экран П3: что может агент, условия и согласия ── -->
      <section class="box step">
        <p class="path">{pathLine(shell, terms.path)}</p>
        <!-- Условия сменились между показом и нажатием: человек обязан прочитать изменённое (правило 1). -->
        {#if termsChanged}
          <p class="notice" role="status">{shell.text["state.terms_changed"]}</p>
        {/if}
        <ul class="can">
          <!-- Строки приходят готовыми, на языке запроса: цена агента уже подставлена сервером, арифметики над
               деньгами у экрана нет (инвариант 2, правило планов № 2). -->
          {#each terms.can as line, i (i)}
            <li>{line}</li>
          {/each}
        </ul>
        <!-- Пометка «условия демо-стенда, не оферта» обязательна, пока настоящей оферты нет (Р-1657). -->
        <p class="notice">{terms.demo_note}</p>
        <ul class="consents">
          {#each terms.consents as item (item.id)}
            <li>
              <label>
                <!-- Обе галочки по умолчанию пустые: отметку ставит человек (П26, Р-1676). Признака «отмечено» в
                     карточке нет вовсе, значит и подставить его неоткуда. -->
                <input type="checkbox" checked={ticked.has(item.id)} onchange={() => toggle(item.id)} />
                <span>{item.text}</span>
              </label>
            </li>
          {/each}
        </ul>
        <p class="action">
          <!--
            Доступность решает **одна** мерка экрана: все ли обязательные пункты отмечены (разрешена § 5.18 — сервер
            отдаёт перечень обязательных и готовый текст причины). Окончательно решает § 5.19.

            Поля `accept.enabled` экран **не читает**, и это сказано прямо, а не обойдено молчанием (находка ревью
            К5 № 6 — прежде комментарий утверждал, что читает). Причина: карточка § 5.18 выдаётся **до** того, как
            человек что-либо отметил, поэтому `enabled` в ней всегда `false` и устаревает по построению — прочитай
            его как вето, и кнопка не включилась бы никогда. Отдельного поля «принять нельзя по другой причине» у
            § 5.18 нет; появится такая причина — её должен назвать сервер своим полем, и это вопрос к контракту, а
            не к экрану. Вопрос записан в PR.
          -->
          <button
            type="button"
            disabled={!canAccept(terms.consents, ticked) || sending}
            onclick={() => void accept()}
          >
            {terms.actions.accept.label}
          </button>
          {#if !canAccept(terms.consents, ticked) && terms.actions.accept.why_disabled !== null}
            <!-- Текст причины — готовый, от сервера: своих слов под кнопкой экран не придумывает. -->
            <span class="why">{terms.actions.accept.why_disabled}</span>
          {/if}
        </p>
      </section>
    {:else if onboarding !== null}
      <!-- ── Экран П1: какой агент ── -->
      <section class="box step">
        <p class="path">{pathLine(shell, onboarding.path)}</p>
        <ul class="models">
          {#each onboarding.models as m (m.id)}
            <li class:open={chosen === m.id}>
              <h3>{m.name}</h3>
              <p>{m.text}</p>
              <ul class="can">
                {#each m.can as line, i (i)}
                  <li>{line}</li>
                {/each}
              </ul>
              {#if m.selectable && m.action_label !== null}
                <button type="button" onclick={() => void choose(m.id)}>{m.action_label}</button>
              {:else if m.why_not !== null}
                <!-- Невыбираемый вид: кнопки нет вовсе, и причина — **готовым текстом** от сервера. Экран не
                     выводит доступность сам (правило 3, инвариант 2) и не ведёт человека в тупик. -->
                <p class="why">{m.why_not}</p>
              {:else}
                <!-- Сервер назвал вид выбираемым, но подписи кнопки не дал (или наоборот): карточка без кнопки и без
                     причины была бы тупиком молча. Показывается сам опознаватель — тот же приём, что у незнакомого
                     класса повтора и подписи раздела (находки ревью К3 № 13, К3а № 6; находка К5 № 13). -->
                <p class="why"><code>{m.id}</code></p>
              {/if}
            </li>
          {/each}
        </ul>
        <!-- Таблица «чем они отличаются»: подписи строк и значения приходят готовыми. Латинских кодов уровня
             подписи в них нет — строка про смену банка расшифрована словами (Р-1684). -->
        <!-- Перебираются **ключи самой строки**, а не перечень моделей: экран не допускает, что они совпадают, и
             отсутствующее значение не превращается в пустоту молча. Подпись и значение — разными элементами
             (`dt`/`dd`), а не склеенным текстом с литералом «: » (находка ревью К5 № 14). -->
        <section class="compare">
          <dl>
            {#each onboarding.compare as line (line.row)}
              <div>
                <dt>{line.label}</dt>
                {#each Object.entries(line.values) as [id, value] (id)}
                  <dd>
                    <span class="model">{onboarding?.models.find((m) => m.id === id)?.name ?? id}</span>
                    <span>{value}</span>
                  </dd>
                {/each}
              </div>
            {/each}
          </dl>
        </section>
      </section>
    {:else if purchase === null}
      <p class="state" role="status">{shell.text["state.no_purchase"]}</p>
    {:else if current === purchase.step}
      <section class="box step">
        <h2>{labelOf(shell, current)}</h2>
        <!-- Обе строки собраны сервером: ни сложения, ни форматирования суммы здесь нет (инвариант 2, правило № 2). -->
        <p class="done">{purchase.done_line.done}</p>
        <p class="not-spent">{purchase.done_line.not_spent}</p>
        <!-- Доступность и причину недоступности решает **сервер** (правило 3): экран их не выводит и своей подписи
             под кнопкой не придумывает. В ИН-0 метода остановки нет, и говорит об этом сервер полем `why_disabled`. -->
        <p class="action">
          <button type="button" disabled={!purchase.actions.stop.enabled}>{purchase.actions.stop.label}</button>
          {#if purchase.actions.stop.why_disabled !== null}
            <span class="why">{purchase.actions.stop.why_disabled}</span>
          {/if}
        </p>
      </section>
    {:else}
      <section class="box soon">
        <h2>{labelOf(shell, current)}</h2>
        <p>{shell.text["state.soon"]}</p>
      </section>
    {/if}
  </main>
{/if}

<style>
  /* Мобильный первым (Р-1601): базовая ширина 360–430, ни одной фиксированной высоты — страница растёт вверх и вниз
     без поломки. Раскрытие шире 430 — ИН-ВЕБ, здесь только предел читаемой строки. Цвета — переменные `/brand.css`
     (инвариант 7): ни одного фирменного цвета литералом. */
  :global(html) {
    box-sizing: border-box;
  }
  :global(*),
  :global(*::before),
  :global(*::after) {
    box-sizing: inherit;
  }
  :global(body) {
    margin: 0;
    padding: 12px;
    max-width: 430px;
    font: 16px/1.45 system-ui, sans-serif;
    color: #111;
    background: #fff;
  }
  .boot {
    min-height: 2rem;
  }
  .top {
    display: flex;
    align-items: center;
    gap: 8px;
    padding-bottom: 8px;
    border-bottom: 2px solid var(--brand-primary, #333);
  }
  .logo {
    flex: none;
  }
  .brand {
    font-weight: 600;
    color: var(--brand-primary, #111);
  }
  .lang {
    margin-left: auto;
  }
  .lang a {
    color: var(--brand-accent, #004);
    text-transform: uppercase;
    /* Касание пальцем: 44 пикселя — нижняя граница попадания на телефоне. */
    display: inline-block;
    min-width: 44px;
    min-height: 44px;
    line-height: 44px;
    text-align: center;
  }
  h1 {
    font-size: 1.25rem;
    margin: 12px 0 4px;
  }
  .subtitle {
    margin: 0 0 12px;
    color: #555;
  }
  .rail ol,
  .rail ul {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin: 0 0 8px;
    padding: 0;
    list-style: none;
  }
  .rail button {
    min-height: 44px;
    padding: 6px 10px;
    border: 1px solid #bbb;
    border-radius: 8px;
    background: #fff;
    font: inherit;
    cursor: pointer;
  }
  /* Открытый раздел различается рамкой и начертанием, а не только цветом: разница читается без цвета (П28 п. 4). */
  .rail button.open {
    border: 2px solid var(--brand-primary, #333);
    font-weight: 600;
  }
  .here {
    display: block;
    font-size: 0.75rem;
    font-weight: 400;
    color: #555;
  }
  .box {
    border: 1px solid #ccc;
    border-radius: 10px;
    padding: 12px;
  }
  .box.error {
    border: 2px solid var(--brand-accent, #900);
  }
  .box h2 {
    margin: 0 0 8px;
    font-size: 1.05rem;
  }
  .box p {
    margin: 0 0 8px;
  }
  .code code,
  .what {
    color: #555;
    font-size: 0.9rem;
  }
  .action {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .action button,
  .box > button,
  .box > .as-button,
  .stale button {
    min-height: 44px;
    padding: 8px 14px;
    border: 1px solid var(--brand-primary, #333);
    border-radius: 8px;
    background: var(--brand-primary, #333);
    color: var(--brand-on-primary, #fff);
    font: inherit;
    cursor: pointer;
  }
  .action button[disabled] {
    background: #eee;
    color: #555;
    border-color: #bbb;
    cursor: default;
  }
  .why,
  .state {
    color: #555;
  }
  /* ── Экраны знакомства П1 и П3 (кирпич К5). Мобильный первым: ни одной фиксированной ширины. ── */
  .path {
    margin: 0 0 8px;
    color: #555;
    font-size: 0.85rem;
  }
  .models,
  .consents,
  .can {
    margin: 0 0 12px;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .can li {
    padding-left: 14px;
    text-indent: -14px;
  }
  .models > li {
    padding: 10px;
    border: 1px solid #ccc;
    border-radius: 10px;
  }
  /* Выбранный вид различается рамкой и начертанием, а не только цветом: разница читается без цвета (П28 п. 4). */
  .models > li.open {
    border: 2px solid var(--brand-primary, #333);
  }
  .models h3 {
    margin: 0 0 4px;
    font-size: 1rem;
  }
  .models > li.open h3 {
    font-weight: 700;
  }
  .consents label {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    /* Касание пальцем: 44 пикселя — нижняя граница попадания на телефоне. */
    min-height: 44px;
  }
  .consents input {
    width: 22px;
    height: 22px;
    flex: none;
  }
  /* Пометка «условия демо-стенда, не оферта»: рамкой и начертанием, чтобы не потерялась среди пунктов. */
  .notice {
    margin: 0 0 12px;
    padding: 6px 8px;
    border: 1px dashed #777;
    border-radius: 8px;
    font-weight: 600;
  }
  .compare dl {
    margin: 0;
  }
  .compare div {
    padding: 8px 0;
    border-top: 1px solid #eee;
  }
  .compare dt {
    color: #555;
    font-size: 0.85rem;
  }
  .compare dd {
    margin: 2px 0 0;
  }
  /* Выход из «вход не выполнен» — переход на страницу, то есть ссылка; выглядит как кнопка, но ведёт по адресу. */
  .box > .as-button {
    display: inline-block;
    text-decoration: none;
    text-align: center;
  }
  /* «Подписывает не человек» — сплошной рамкой и начертанием: пометка о провенансе должна читаться без цвета, как и
     вердикты (П28 п. 4), и не теряться рядом с заголовком. */
  .signed {
    margin: 0 0 12px;
    padding: 6px 8px;
    border: 2px solid var(--brand-accent, #333);
    border-radius: 8px;
    font-weight: 600;
  }
  /* «Данные могли устареть» — рамкой и начертанием, а не одним цветом: разница читается без цвета. */
  .stale {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    margin: 0 0 8px;
    padding: 6px 8px;
    border: 1px dashed #777;
    border-radius: 8px;
    font-weight: 600;
    color: #555;
  }
</style>
