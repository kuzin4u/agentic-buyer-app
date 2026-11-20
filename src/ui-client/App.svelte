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
  import { langHref, loadPurchase, loadShell, openFeed, pageHref, purchaseIdOf, type BootText, type ReadFail } from "./api";
  import { bootLine, canRetryInPlace, failLine, isPlace, labelOf, latest, needsPage, retryLine, triggers } from "./view";

  /**
   * `lang` — язык страницы: его выбрал **сервер** и положил в `data-lang` точки монтирования. Экран язык не выбирает
   * и не сверяет с перечнем: негодное значение отбросит сервер (`langOf`).
   * `boot` — строки со страницы (перечень — `BOOT_KEYS` в `boot-text.ts`) на тот случай, когда словарь ещё не доехал:
   * иначе экран остался бы пустым навсегда и выхода из этого не было бы (находки ревью К3 № 1 и К3а № 1). Число строк
   * здесь не называется — оно менялось уже дважды, и названное число разошлось бы с кодом (находка ревью К3б № 4).
   */
  const { lang, boot }: { lang: string; boot: BootText } = $props();

  const purchaseId = purchaseIdOf();

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

  /** Словарь, затем покупка. Вызывается на запуске и кнопкой «Повторить»: выход из отказа есть всегда. */
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
    await readPurchase();
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
        <a class="as-button" href={pageHref()}>{boot["action.retry"]}</a>
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
             чтения расходился бы с подписью действия (находка ревью К3 № 8), а при `never` не помог бы никогда. -->
        {#if canRetryInPlace(fail.error)}
          <button type="button" onclick={() => void readPurchase()}>{shell.text["action.retry"]}</button>
        {/if}
      </section>
    {:else if fail !== null}
      <section class="box state" role="alert">
        <p>{failLine(shell, fail)}</p>
        {#if needsPage(fail)}
          <a class="as-button" href={pageHref()}>{shell.text["action.retry"]}</a>
        {:else}
          <button type="button" onclick={() => void readPurchase()}>{shell.text["action.retry"]}</button>
        {/if}
      </section>
    {:else if loading}
      <p class="state" role="status">{shell.text["state.loading"]}</p>
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
  /* Выход из «вход не выполнен» — переход на страницу, то есть ссылка; выглядит как кнопка, но ведёт по адресу. */
  .box > .as-button {
    display: inline-block;
    text-decoration: none;
    text-align: center;
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
