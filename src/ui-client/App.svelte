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
  import { langHref, loadPurchase, loadShell, openFeed, purchaseIdOf, type UiFailure } from "./api";

  /** Язык страницы — его выбрал **сервер** и положил в `data-lang` точки монтирования (`main.ts` читает атрибут).
   *  Экран язык не выбирает и не сверяет с перечнем: негодное значение отбросит сервер (`langOf`). */
  const { lang }: { lang: string } = $props();

  const purchaseId = purchaseIdOf();

  let shell = $state<ShellData | null>(null);
  let purchase = $state<PurchaseResponse | null>(null);
  let failure = $state<UiFailure | null>(null);
  let offline = $state(false);
  let loading = $state(true);
  /** Что человек открыл в навигации. `null` — «идём за сервером»: показывается шаг из ответа § 5.3. */
  let opened = $state<string | null>(null);
  let feed: EventSource | null = null;

  /** Открытый раздел: выбор человека, иначе шаг с сервера. Своей таблицы шагов здесь нет — только одно поле ответа. */
  const current = $derived(opened ?? purchase?.step ?? null);

  /** Подпись раздела по опознавателю — из перечней сервера; неизвестный опознаватель подписи не получает. */
  const labelOf = (id: string | null): string => {
    if (shell === null || id === null) return "";
    return [...shell.steps, ...shell.places].find((x) => x.id === id)?.label ?? "";
  };

  async function readPurchase(): Promise<void> {
    if (purchaseId === null) {
      loading = false;
      return;
    }
    loading = true;
    const got = await loadPurchase(purchaseId, lang);
    loading = false;
    if (got.ok) {
      purchase = got.value;
      failure = null;
      offline = false;
      return;
    }
    // Разделение намеренное: тело § 3 — это ответ сервера с кодом и «что делать», а `null` — отсутствие связи, у
    // которого кода нет. Показать одно вместо другого значило бы сказать человеку неправду о причине.
    failure = got.error;
    offline = got.error === null;
  }

  onMount(() => {
    void (async () => {
      const got = await loadShell(lang);
      if (got.ok) shell = got.value;
      else offline = true;
      await readPurchase();
    })();
    // Сигнал потока — только повод перечитать: статусов и сумм в нём нет (правило 4, инвариант 6 в редакции П31).
    feed = openFeed(
      (id) => {
        if (id === purchaseId) void readPurchase();
      },
      () => {
        // Браузер переподключится сам (пауза приходит полем `retry:`); человеку это видно как «нет связи», пока
        // перечитывание не удалось.
        if (purchase === null) offline = true;
      },
    );
  });

  onDestroy(() => feed?.close());
</script>

{#if shell === null}
  <!-- Словарь ещё не пришёл: рисовать нечем, а своей строки «загрузка» у экрана нет (правило 3). Пустое место с
       признаком занятости честнее подставленного литерала, который не прошёл бы парность ru/en. -->
  <div class="boot" aria-busy="true"></div>
{:else}
  <header class="top">
    {#if shell.brand.logo !== null}
      <img class="logo" src={shell.brand.logo} alt={shell.brand.name} width="28" height="28" />
    {/if}
    <span class="brand">{shell.brand.name}</span>
    <nav class="lang" aria-label={shell.text["lang.switch"]}>
      <a href={langHref(shell.other)} hreflang={shell.other} lang={shell.other}>{shell.other}</a>
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

  <main>
    {#if failure !== null}
      <section class="box error" role="alert">
        <h2>{shell.text["error.title"]}</h2>
        <p class="said">{failure.text}</p>
        <p class="what">{shell.retry[failure.retry]}</p>
        <p class="code"><code>{failure.code}</code></p>
        {#if failure.retry !== "never"}
          <button type="button" onclick={() => void readPurchase()}>{shell.text["action.retry"]}</button>
        {/if}
      </section>
    {:else if offline}
      <section class="box state" role="alert">
        <p>{shell.text["state.offline"]}</p>
        <button type="button" onclick={() => void readPurchase()}>{shell.text["action.retry"]}</button>
      </section>
    {:else if loading}
      <p class="state" role="status">{shell.text["state.loading"]}</p>
    {:else if purchase === null}
      <p class="state" role="status">{shell.text["state.no_purchase"]}</p>
    {:else if current === purchase.step}
      <section class="box step">
        <h2>{labelOf(current)}</h2>
        <!-- Обе строки собраны сервером: ни сложения, ни форматирования суммы здесь нет (инвариант 2, правило № 2). -->
        <p class="done">{purchase.done_line.done}</p>
        <p class="not-spent">{purchase.done_line.not_spent}</p>
        <p class="action">
          <button type="button" disabled aria-disabled="true">{purchase.actions.stop.label}</button>
          <span class="why">
            {purchase.actions.stop.enabled
              ? shell.text["state.action_soon"]
              : (purchase.actions.stop.why_disabled ?? shell.text["state.action_soon"])}
          </span>
        </p>
      </section>
    {:else}
      <section class="box soon">
        <h2>{labelOf(current)}</h2>
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
  .box > button {
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
</style>
