// П-К4, К5 — `POST /ui/v1/intent` (§ 5.2): маршрут подписи, идемпотентность правила 2, отказы по § 6.
// Тексты — из `config/intent.default.json`, того же файла, что в работе (Р-1511). Разные сущности — разные значения:
// черновик `drf_k5`, показанное `vw_k5_show`, покупка `pur_k5`, мандат `mdt_k5`, ключ экрана и ключ ядра различимы.
import { readFileSync } from "node:fs";
import type { Mandate, MandateDraft } from "agentic-buyer-ref/src/shared/domain.js";
import type { Mutation } from "agentic-buyer-ref/src/agent/ports/mutation.js";
import { describe, expect, it } from "vitest";
import { UI_ERROR_STATUS } from "../../src/contract/ui-v1/errors.js";
import { showingHash } from "../../src/contract/ui-v1/shown-hash.js";
import { buildIntentDraft, createIntentDraftStore, type DraftDeps } from "../../src/intent/draft.js";
import {
  RETRY_BY_CODE,
  createIntentStore,
  postIntent,
  type IntentJournalEntry,
  type IntentServiceDeps,
} from "../../src/intent/service.js";
import { parseIntentTexts } from "../../src/intent/texts.js";

const texts = parseIntentTexts(
  JSON.parse(readFileSync(new URL("../../config/intent.default.json", import.meta.url), "utf8")),
);

const NOW = "2026-11-20T09:00:00.000Z";
const PHRASE = "хлеб на выходные, до 1000 ₽, один раз";
const KEY = "9f1c3b7e-5a24-4d8f-9b31-2c6f0ab4e7d5";
const OTHER_KEY = "2b7d41ac-9e63-4f15-8c02-7ad5be913f64";
const CORE_KEY = "ck_k5_derived_by_in0";
const PRESS = { at: "2026-11-20T09:00:05.000Z", device: "web", text_version: "u1-card@1.0", gesture: "tap" } as const;

const MONEY = (m: { readonly amount: number; readonly currency: string }, lang: string): string =>
  `«сумма ${m.amount} ${m.currency} на ${lang}»`;

const TEMPLATE = {
  subject: "хлеб",
  limit: { amount: 100_000, currency: "RUB" },
  valid_to: "2026-11-27T09:00:00.000Z",
  merchants: [{ id: "MER-7001", label: "Масса Мадре (MER-7001)" }],
  confirmation_mode: "IMMEDIATE",
} as const;

const MANDATE: Mandate = {
  id: "mdt_k5",
  kind: "INTENT",
  status: "PENDING_SIGNATURE",
  signatureLevel: null,
  revocationOrder: "ro_bank_demo",
  parentId: null,
  subject: TEMPLATE.subject,
  amountLimit: { amount: TEMPLATE.limit.amount, currency: TEMPLATE.limit.currency },
  validTo: TEMPLATE.valid_to,
  merchantScope: ["MER-7001"],
  principalRef: "pr_k5_client",
  confirmationMode: "IMMEDIATE",
  keyTermsShown: true,
  cart: null,
};

/** Сборка карточки (К2) в хранилище: отсюда К5 берёт и черновик, и показанное. */
function prepared(over: Partial<DraftDeps> = {}): { readonly drafts: ReturnType<typeof createIntentDraftStore>; readonly shownHash: string } {
  const drafts = createIntentDraftStore();
  const out = buildIntentDraft(PHRASE, {
    lang: "ru",
    texts,
    money: MONEY,
    timeZone: "Europe/Moscow",
    template: TEMPLATE,
    store: drafts,
    journal: { write: () => undefined },
    newDraftId: () => "drf_k5",
    now: () => NOW,
    ...over,
  });
  if (out.kind !== "card") throw new Error("ожидалась карточка");
  const record = drafts.get("drf_k5");
  if (record === null) throw new Error("черновик не сохранён");
  return { drafts, shownHash: showingHash(record.shown) };
}

interface Harness {
  readonly deps: IntentServiceDeps;
  readonly entries: IntentJournalEntry[];
  readonly coreCalls: { draft: MandateDraft; mutation: Mutation }[];
  readonly shownHash: string;
}

function harness(over: Partial<IntentServiceDeps> = {}, prep = prepared()): Harness {
  const entries: IntentJournalEntry[] = [];
  const coreCalls: { draft: MandateDraft; mutation: Mutation }[] = [];
  return {
    entries,
    coreCalls,
    shownHash: prep.shownHash,
    deps: {
      lang: "ru",
      texts,
      drafts: prep.drafts,
      store: createIntentStore(),
      journal: { write: (entry) => entries.push(entry) },
      core: {
        requestIntent: (draft, mutation) => {
          coreCalls.push({ draft, mutation });
          return Promise.resolve({ purchase_id: "pur_k5", state: "INTENT_PENDING" as const, mandate: MANDATE });
        },
      },
      principalRef: "pr_k5_client",
      // Кто нажал — зависимостью, умолчания нет (П26 с дополнением 2): в прогоне это было бы `test`.
      by: () => "human",
      // Ключ ядра выводит ИН-0 — здесь он подан зависимостью и отличим от ключа экрана (Р-1644).
      mutation: () => ({ idempotencyKey: CORE_KEY }),
      viewId: () => "vw_k5_show",
      signLink: (mandateId) => `https://stand.example/bank/mandates/${mandateId}`,
      now: () => NOW,
      ...over,
    },
  };
}

const body = (over: Partial<Record<string, unknown>> = {}): never =>
  ({ draft_id: "drf_k5", shown_hash: "", press: PRESS, ...over }) as never;

describe("К5: поручение отправлено на подпись", () => {
  it("202, маршрут в банк, состояние и шаг от ядра, мандат ссылкой", async () => {
    const h = harness();
    const res = await postIntent(body({ shown_hash: h.shownHash }), KEY, h.deps);

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.status).toBe(202);
    expect(res.replay).toBe(false);
    expect(res.body).toEqual({
      purchase_id: "pur_k5",
      state: "INTENT_PENDING",
      step: "U2",
      mandate: { id: "mdt_k5", kind: "INTENT", status: "PENDING_SIGNATURE" },
      sign: {
        where: "BANK",
        link: "https://stand.example/bank/mandates/mdt_k5",
        text: texts.actions.sign_in_bank.ru,
      },
    });
  });

  it("метод не подписывает: у ядра просят мандат, подпись остаётся человеку в банке", async () => {
    const h = harness();
    await postIntent(body({ shown_hash: h.shownHash }), KEY, h.deps);
    expect(h.coreCalls).toHaveLength(1);
    // Черновик уехал ядру **в доменных именах** и с признаком «карточка показана» (Т3а доказана совпадением хэша).
    expect(h.coreCalls[0]?.draft).toEqual({
      kind: "INTENT",
      parentId: null,
      subject: "хлеб",
      amountLimit: { amount: 100_000, currency: "RUB" },
      validTo: "2026-11-27T09:00:00.000Z",
      merchantScope: ["MER-7001"],
      principalRef: "pr_k5_client",
      confirmationMode: "IMMEDIATE",
      keyTermsShown: true,
      cart: null,
    });
    // Ключ ядра — из зависимости, а не выведенный здесь (Р-1644): он отличается от ключа экрана.
    expect(h.coreCalls[0]?.mutation).toEqual({ idempotencyKey: CORE_KEY });
    expect(h.coreCalls[0]?.mutation.idempotencyKey).not.toBe(KEY);
  });

  it("журнал покупки: отправка с идентификаторами и провенансом, без сумм и реквизитов", async () => {
    const h = harness();
    await postIntent(body({ shown_hash: h.shownHash }), KEY, h.deps);
    expect(h.entries).toEqual([
      {
        event: "intent.sent",
        draft_id: "drf_k5",
        purchase_id: "pur_k5",
        mandate_id: "mdt_k5",
        shown_hash: h.shownHash,
        press: PRESS,
        // Кто нажал — П26: без признака запись не отличала бы прогон от человека (находка ревью К5 В3).
        by: "human",
        at: NOW,
      },
    ]);
    expect(JSON.stringify(h.entries)).not.toMatch(/amount|currency|limit/i);
  });

  it("признак «кто нажал» — из зависимости, а не умолчанием: прогон виден в журнале", async () => {
    const h = harness({ by: () => "test" });
    await postIntent(body({ shown_hash: h.shownHash }), KEY, h.deps);
    expect(h.entries[0]?.event === "intent.sent" && h.entries[0].by).toBe("test");
  });

  it("шаг берётся по таблице состояний, а не литералом: другое состояние ядра — другой шаг", async () => {
    const h = harness({
      core: {
        requestIntent: () => Promise.resolve({ purchase_id: "pur_k5", state: "OFFERS" as const, mandate: MANDATE }),
      },
    });
    const res = await postIntent(body({ shown_hash: h.shownHash }), KEY, h.deps);
    expect(res.ok && res.body.state).toBe("OFFERS");
    expect(res.ok && res.body.step).toBe("U3");
  });

  it("на английском языке запроса текст маршрута — английский, остальное то же", async () => {
    const h = harness({ lang: "en" });
    const res = await postIntent(body({ shown_hash: h.shownHash }), KEY, h.deps);
    expect(res.ok && res.body.sign.text).toBe(texts.actions.sign_in_bank.en);
  });
});

describe("К5: идемпотентность (правило 2)", () => {
  it("повтор тем же ключом и тем же телом — тот же ответ, второго обращения к ядру нет", async () => {
    const h = harness();
    const first = await postIntent(body({ shown_hash: h.shownHash }), KEY, h.deps);
    const second = await postIntent(body({ shown_hash: h.shownHash }), KEY, h.deps);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.body).toEqual(first.body);
    expect(second.replay).toBe(true);
    expect(h.coreCalls).toHaveLength(1);
  });

  it("тот же ключ, другое тело — `IDEMPOTENCY_CONFLICT`, ядро не зовётся", async () => {
    const h = harness();
    await postIntent(body({ shown_hash: h.shownHash }), KEY, h.deps);
    const res = await postIntent(body({ shown_hash: h.shownHash, press: { ...PRESS, device: "mobile" } }), KEY, h.deps);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.status).toBe(UI_ERROR_STATUS.IDEMPOTENCY_CONFLICT);
    expect(res.body.error.code).toBe("IDEMPOTENCY_CONFLICT");
    expect(res.body.error.retry).toBe(RETRY_BY_CODE.IDEMPOTENCY_CONFLICT);
    expect(h.coreCalls).toHaveLength(1);
  });

  it("ключа нет — `IDEMPOTENCY_REQUIRED` 400, и ключ **не занят**: с ключом то же тело проходит", async () => {
    const h = harness();
    const noKey = await postIntent(body({ shown_hash: h.shownHash }), undefined, h.deps);
    expect(noKey.ok).toBe(false);
    if (noKey.ok) return;
    expect(noKey.status).toBe(400);
    expect(noKey.body.error.code).toBe("IDEMPOTENCY_REQUIRED");
    expect(noKey.body.error.retry).toBe("same_key");

    const withKey = await postIntent(body({ shown_hash: h.shownHash }), KEY, h.deps);
    expect(withKey.ok).toBe(true);
  });

  /** Решение владельца 19.11, 18:20: отпечаток берётся **до** проверки формы, поэтому негодное тело занимает ключ
   *  так же, как годное. Иначе один ключ обозначал бы два действия: кривое тело → 400, потом правильное тело тем же
   *  ключом → отправка поручения. Случай добавлен по поломке: без него правка «негодное тело ключ не занимает»
   *  оставалась зелёной. */
  it("негодное тело занимает ключ: годное тело тем же ключом — конфликт, а не отправка", async () => {
    const h = harness();
    const bad = await postIntent(body({ shown_hash: h.shownHash, extra: 1 }), KEY, h.deps);
    expect(bad.ok === false && bad.body.error.code).toBe("INTENT_DRAFT_INVALID");

    const good = await postIntent(body({ shown_hash: h.shownHash }), KEY, h.deps);
    expect(good.ok === false && good.body.error.code).toBe("IDEMPOTENCY_CONFLICT");
    expect(h.coreCalls).toHaveLength(0);

    // Тем же негодным телом — тот же отказ, второй записи в журнале об этом нет.
    const again = await postIntent(body({ shown_hash: h.shownHash, extra: 1 }), KEY, h.deps);
    expect(again).toEqual(bad);
  });

  it("отказ занимает ключ так же, как удача: повтор отказа не отправляет поручение", async () => {
    const h = harness();
    const bad = await postIntent(body({ shown_hash: `sha256:${"b".repeat(64)}` }), KEY, h.deps);
    expect(bad.ok).toBe(false);
    const again = await postIntent(body({ shown_hash: `sha256:${"b".repeat(64)}` }), KEY, h.deps);
    expect(again).toEqual(bad);
    expect(h.coreCalls).toHaveLength(0);
    // Годное тело с тем же ключом — конфликт, а не подпись: один ключ не обозначает двух действий.
    const good = await postIntent(body({ shown_hash: h.shownHash }), KEY, h.deps);
    expect(good.ok === false && good.body.error.code).toBe("IDEMPOTENCY_CONFLICT");
    expect(h.coreCalls).toHaveLength(0);
  });
});

describe("К5: отказы § 6", () => {
  /** Тело отказа — **ровно** четыре поля `error` (§ 3 «Ошибки»): так добавленная в ответ причина не проскочит ни у
   *  одного кода, а не только у того, где стоит отдельная проверка (находка ревью К5 В4). */
  const refusalShape = (res: Awaited<ReturnType<typeof postIntent>>): void => {
    if (res.ok) throw new Error("ожидался отказ");
    expect(Object.keys(res.body)).toEqual(["error"]);
    expect(Object.keys(res.body.error).sort()).toEqual(["code", "retry", "text", "view"]);
    expect(JSON.stringify(res.body)).not.toMatch(/reason|problem|purchase_id|draft_id/);
  };

  it("негодное тело — `INTENT_DRAFT_INVALID` 400 с текстом по причине; причина наружу не идёт", async () => {
    for (const over of [
      { draft_id: "pur_k5" },
      { draft_id: 5 },
      // Хэш **не строкой** — негодное тело; хэш «не по форме» строкой — уже `SHOWN_STALE`, случай ниже (В2).
      { shown_hash: 5 },
      { extra: 1 },
      { press: undefined },
      { press: { ...PRESS, device: "robot" } },
      { press: { ...PRESS, at: "" } },
    ]) {
      const h = harness();
      const res = await postIntent(body({ shown_hash: h.shownHash, ...over }), KEY, h.deps);
      expect(res.ok, JSON.stringify(over)).toBe(false);
      if (res.ok) continue;
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("INTENT_DRAFT_INVALID");
      expect(res.body.error.retry).toBe("after_fix");
      expect(res.body.error.view).toBeNull();
      expect(res.body.error.text.length).toBeGreaterThan(0);
      // Причина — только в журнале: в теле ответа её нет ни одним полем.
      refusalShape(res);
      expect(h.entries.at(-1)?.event).toBe("intent.refused");
      expect(h.coreCalls).toHaveLength(0);
    }
  });

  it("отказ приходит на языке запроса — английский текст, а не русский", async () => {
    const h = harness({ lang: "en" });
    const res = await postIntent(body({ shown_hash: h.shownHash, extra: 1 }), KEY, h.deps);
    if (res.ok) throw new Error("ожидался отказ");
    expect(res.body.error.text).toBe(texts.errors.body_form.en);
    expect(res.body.error.text).not.toBe(texts.errors.body_form.ru);
  });

  it("у провенанса и формы тела — разные тексты человеку, хотя код один", async () => {
    const h1 = harness();
    const form = await postIntent(body({ shown_hash: h1.shownHash, extra: 1 }), KEY, h1.deps);
    const h2 = harness();
    const press = await postIntent(body({ shown_hash: h2.shownHash, press: undefined }), KEY, h2.deps);
    if (form.ok || press.ok) throw new Error("ожидались отказы");
    expect(form.body.error.text).toBe(texts.errors.body_form.ru);
    expect(press.body.error.text).toBe(texts.errors.press.ru);
    expect(form.body.error.text).not.toBe(press.body.error.text);
  });

  it("неизвестный черновик — `PURCHASE_NOT_FOUND` 404 одним ответом", async () => {
    const h = harness();
    const res = await postIntent(body({ draft_id: "drf_someone_else", shown_hash: h.shownHash }), KEY, h.deps);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("PURCHASE_NOT_FOUND");
    expect(res.body.error.retry).toBe(RETRY_BY_CODE.PURCHASE_NOT_FOUND);
    expect(res.body.error.text).toBe(texts.errors.not_found.ru);
    refusalShape(res);
  });

  /** Хэш не совпал, не по форме или версия текстов провенанса чужая — **один** исход: карточка устарела, человек
   *  смотрит новую и нажимает заново. Версия провенанса — блокер Б1 повторного ревью: её сверки не было. */
  it("хэш не совпал, не по форме, чужая версия текстов провенанса — `SHOWN_STALE` 409 с новой карточкой", async () => {
    for (const over of [
      { shown_hash: `sha256:${"c".repeat(64)}` },
      { shown_hash: "sha256:не-по-форме" },
      { press: { ...PRESS, text_version: "u1-card@9.9" } },
    ]) {
      const h = harness();
      const res = await postIntent(body({ shown_hash: h.shownHash, ...over }), KEY, h.deps);
      expect(res.ok, JSON.stringify(over)).toBe(false);
      if (res.ok) continue;
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("SHOWN_STALE");
      expect(res.body.error.retry).toBe("after_human");
      expect(res.body.error.view).toEqual({
        view_id: "vw_k5_show",
        text_version: texts.text_version,
        hash: h.shownHash,
      });
      expect(h.coreCalls).toHaveLength(0);
    }
  });

  it("второй раз тем же черновиком — `STEP_NOT_ALLOWED` 409, ядро не зовётся повторно", async () => {
    const h = harness();
    await postIntent(body({ shown_hash: h.shownHash }), KEY, h.deps);
    const res = await postIntent(body({ shown_hash: h.shownHash }), OTHER_KEY, h.deps);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("STEP_NOT_ALLOWED");
    expect(res.body.error.text).toBe(texts.errors.step_not_allowed.ru);
    expect(res.body.error.retry).toBe("after_human");
    refusalShape(res);
    expect(h.coreCalls).toHaveLength(1);
    expect(h.entries.at(-1)).toEqual({
      event: "intent.refused",
      draft_id: "drf_k5",
      code: "STEP_NOT_ALLOWED",
      problem: { reason: "ALREADY_SENT", purchase_id: "pur_k5" },
      at: NOW,
    });
  });

  /** Каждый класс взят у источника, ни один не выведен «по смыслу» (строка STATUS о классах повтора):
   *  `INTENT_DRAFT_INVALID` — Р-1650 и Р-1670, `SHOWN_STALE` — решение владельца 19.11, 18:20,
   *  `STEP_NOT_ALLOWED` — **Р-1677** (решение владельца 20.11, 20:08), `PURCHASE_NOT_FOUND` — таблица отказов ядра
   *  (`MANDATE_NOT_FOUND`, совпадает с `retry` ПАО 1.4.0), идемпотентные — таблица кодов ПАО 1.4.0. */
  /** Б2 повторного ревью: два запроса с **разными** ключами по одному черновику. Правило 2 здесь не помогает —
   *  ключи разные, — поэтому черновик занимается до обращения к ядру. Иначе ядро дало бы два мандата на одну
   *  показанную карточку, а второй запрос упал бы исключением (500 вместо 409). */
  it("два запроса разными ключами по одному черновику: ядро зовётся один раз, второй — 409", async () => {
    const h = harness({
      core: {
        requestIntent: async (draft, mutation) => {
          h.coreCalls.push({ draft, mutation });
          // Ядро отвечает не мгновенно: второй запрос успевает прийти, пока первый ждёт.
          await Promise.resolve();
          return { purchase_id: "pur_k5", state: "INTENT_PENDING" as const, mandate: MANDATE };
        },
      },
    });

    const [first, second] = await Promise.all([
      postIntent(body({ shown_hash: h.shownHash }), KEY, h.deps),
      postIntent(body({ shown_hash: h.shownHash }), OTHER_KEY, h.deps),
    ]);

    expect(h.coreCalls).toHaveLength(1);
    const ok = [first, second].filter((r) => r.ok);
    const refused = [first, second].filter((r) => !r.ok);
    expect(ok).toHaveLength(1);
    expect(refused).toHaveLength(1);
    const no = refused[0];
    if (no === undefined || no.ok) throw new Error("ожидался один отказ");
    expect(no.status).toBe(409);
    expect(no.body.error.code).toBe("STEP_NOT_ALLOWED");
  });

  it("ядро отказало — занятие снято: человек может нажать ещё раз (новым ключом)", async () => {
    let calls = 0;
    const h = harness({
      core: {
        requestIntent: () => {
          calls += 1;
          if (calls === 1) return Promise.reject(new Error("ПАО недоступен"));
          return Promise.resolve({ purchase_id: "pur_k5", state: "INTENT_PENDING" as const, mandate: MANDATE });
        },
      },
    });
    await expect(postIntent(body({ shown_hash: h.shownHash }), KEY, h.deps)).rejects.toThrow(/ПАО/);
    const second = await postIntent(body({ shown_hash: h.shownHash }), OTHER_KEY, h.deps);
    expect(second.ok).toBe(true);
    expect(calls).toBe(2);
  });

  it("классы повтора — у каждого кода свой, и перечень закрыт типом", () => {
    expect(RETRY_BY_CODE).toEqual({
      INTENT_DRAFT_INVALID: "after_fix",
      SHOWN_STALE: "after_human",
      PURCHASE_NOT_FOUND: "after_human",
      STEP_NOT_ALLOWED: "after_human",
      IDEMPOTENCY_REQUIRED: "same_key",
      IDEMPOTENCY_CONFLICT: "after_fix",
    });
    // `never` экрану здесь не отдаётся ни у одного кода: ни один из этих отказов не означает «невозможно совсем».
    expect(Object.values(RETRY_BY_CODE)).not.toContain("never");
  });

  it("статусы — из таблицы контракта, а не второй копией по месту", () => {
    expect(UI_ERROR_STATUS.INTENT_DRAFT_INVALID).toBe(400);
    expect(UI_ERROR_STATUS.PURCHASE_NOT_FOUND).toBe(404);
    expect(UI_ERROR_STATUS.STEP_NOT_ALLOWED).toBe(409);
  });
});
