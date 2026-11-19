// П-К1, К1.4 — чтение профиля для выбора вариантов: последняя подписанная версия, порт весов для ранжирования и
// строки-пояснения человеку.
// Карта «ранг → вес» остаётся внутри (`weights.ts`): наружу уходит **порт** `weightsFor`, которым пользуются пучки и
// ВР внутри сервера. В ответ экрану веса не попадают ни одним полем — это правка 6 канвы и правило 3 К-Б, и
// проверяется отдельно (К1.2: в типах `/ui/v1` поля `weight` нет ни одного).
import type { UiLang } from "../contract/ui-v1/common.js";
import type { NoteKey, PrincipleId, PrinciplesCatalog, PrinciplesOrder, SignedPrinciples } from "./model.js";
import { byRole, knownOrder } from "./model.js";
import type { PrinciplesStore } from "./signature.js";
import { weightsOf } from "./weights.js";

/** Последняя подписанная версия профиля или `null`, если клиент ещё не подтвердил свой порядок.
 *  `null` — это не «пусто по ошибке», а рабочее состояние: выбор идёт **без принципов**, и человеку это видно
 *  (`signed: null` в ответе `GET`, § 5.14). Порядок по умолчанию подписанным не считается. */
export function currentPrinciples(store: PrinciplesStore): SignedPrinciples | null {
  return store.last();
}

/** Веса для ранжирования — **порт** (пучки, ВР, ЛА). Берётся от подписанной версии, а не от порядка «как-нибудь»:
 *  агент обязан уметь сказать, по какой именно версии он решал.
 *  Нет подписи — нет весов: `null`, и ранжирование идёт без принципов. Ст. 19 внутри: вес цены не выше веса
 *  исполнения на любом порядке (см. `weights.ts`). */
export function weightsFor(version: SignedPrinciples | null, catalog: PrinciplesCatalog): ReadonlyMap<PrincipleId, number> | null {
  if (version === null) return null;
  return weightsOf(version.order, catalog).byId;
}

/** Сработала ли ст. 19 на этом порядке — без числа потолка: число это вес, а веса наружу не идут. */
export function article19Applied(order: PrinciplesOrder, catalog: PrinciplesCatalog): boolean {
  return weightsOf(order, catalog).article19.applied;
}

/** Строки-пояснения под списком на языке запроса (§ 5.14, строка-пояснение в ответе `GET`).
 *  - «надёжность исполнения учитывается всегда» — **всегда**: пункт не выключается, и человек должен знать почему;
 *  - «цена учитывается не выше надёжности исполнения» — когда ст. 19 опустила вес цены на **этом** порядке.
 *  Порядок берётся из подписанной версии; без подписи показывается только первая строка — весов ещё нет, опускать
 *  нечего. Текст — из `config/` (правило планов № 3), литералом в коде его нет. */
export function noteKeysFor(version: SignedPrinciples | null, catalog: PrinciplesCatalog): readonly NoteKey[] {
  const keys: NoteKey[] = ["execution_always"];
  if (version !== null && article19Applied(version.order, catalog)) keys.push("price_capped");
  return keys;
}

export function notesFor(version: SignedPrinciples | null, catalog: PrinciplesCatalog, lang: UiLang): readonly string[] {
  return noteKeysFor(version, catalog).map((key) => catalog.notes[key][lang]);
}

/** Пункты для показа: `rank` по подписанной версии, выключенные — в конце, после включённых, в порядке перечня.
 *  Ранг — **единственное**, что экран узнаёт о важности (правка 6 канвы): веса остаются здесь.
 *  Без подписи порядок — по умолчанию, то есть порядок перечня; `signed: null` скажет экрану, что он не подтверждён. */
export function ranksFor(version: SignedPrinciples | null, catalog: PrinciplesCatalog): readonly { readonly id: PrincipleId; readonly rank: number; readonly on: boolean }[] {
  // Тем же приведением, что считает веса (`knownOrder`): пункт, убранный из `config/` после подписи, выпадает и
  // оттуда, и отсюда — человек видит ровно тот набор, по которому идёт ранжирование.
  const included = knownOrder(version?.order ?? catalog.items.map((p) => p.id), catalog);
  const rest = catalog.items.map((p) => p.id).filter((id) => !included.includes(id));
  return [
    ...included.map((id, i) => ({ id, rank: i + 1, on: true })),
    ...rest.map((id, i) => ({ id, rank: included.length + i + 1, on: false })),
  ];
}

/** Пункт роли «исполнение» — его экран не даёт выключить (решение владельца 19.11). Отдаётся опознавателем, чтобы
 *  экрану не приходилось знать ни кодов, ни ролей. */
export function lockedId(catalog: PrinciplesCatalog): PrincipleId | null {
  return byRole(catalog, "execution")?.id ?? null;
}
