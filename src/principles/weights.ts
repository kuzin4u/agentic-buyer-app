// П-К1, К1.2 — карта «ранг → вес». Модуль **наружу не выходит**: `index.ts` его не реэкспортирует, и в ответ экрану
// веса не попадают (правка 6 канвы; правило 3 К-Б — экран не взвешивает принципы). Экрану уходит только `rank`.
// Ст. 19 правил («вес исполнения не ниже веса цены») держит **сервер**, а не экран и не договорённость: порядок
// клиента принимается как есть, а вес цены выше веса исполнения не поднимается — и человеку это сказано строкой под
// списком (К1.4), а не скрыто.
// Пункты правил ищутся **по роли** (`role` в `config/`), а не по коду: переименование кода правило не снимет
// (решение владельца 19.11, П32 дополнение 1).
import type { PrincipleId, PrinciplesCatalog, PrinciplesOrder } from "./model.js";
import { byRole } from "./model.js";

/** Вес первого по важности пункта. Шкала условная и наружу не видна: важны только отношения весов. */
const TOP_WEIGHT = 100;

/** Вес по месту в порядке: первый — `TOP_WEIGHT`, дальше равными шагами вниз, последний — `TOP_WEIGHT / m`.
 *  Выключенный пункт в порядок не входит и получает 0 (см. `weightsOf`). */
function weightAt(rank: number, m: number): number {
  return Math.round((TOP_WEIGHT * (m - rank + 1)) / m);
}

/** Что сделала ст. 19 с этим порядком — для строки-пояснения человеку (К1.4).
 *  **Строка собирается из `applied`, без числа `ceiling`:** `ceiling` — вес, а веса наружу не выходят (правка 6
 *  канвы, П32). Границу держит тест графа импортов — `weights.ts` ввозится только внутри `src/principles/`. */
export interface Article19 {
  /** вес цены был опущен до веса исполнения */
  readonly applied: boolean;
  /** потолок веса цены, или `null`, если в порядке нет цены либо в перечне нет роли. **В тело `GET` не уходит** */
  readonly ceiling: number | null;
}

export interface Weights {
  /** вес каждого пункта перечня: включённые — по месту в порядке, выключенные — 0 */
  readonly byId: ReadonlyMap<PrincipleId, number>;
  readonly article19: Article19;
}

/** Веса по порядку клиента. Порядок уже проверен `checkOrder`: известные `id`, без повторов, не пустой и **с пунктом
 *  роли «исполнение»** — его клиент переставляет, но не выключает (решение владельца 19.11).
 *
 *  Ст. 19: вес цены не выше веса исполнения. Прежнего случая «исполнение выключено, потолок по умолчанию» больше
 *  нет — такой потолок равнялся верхнему весу и ничего не ограничивал, поэтому правило перенесено в проверку
 *  порядка (`EXECUTION_MISSING` → `PRINCIPLES_ORDER_INVALID`), где его нельзя обойти. */
export function weightsOf(order: PrinciplesOrder, catalog: PrinciplesCatalog): Weights {
  const m = order.length;
  const byId = new Map<PrincipleId, number>(catalog.items.map((p) => [p.id, 0]));
  order.forEach((id, i) => byId.set(id, weightAt(i + 1, m)));

  const executionId = byRole(catalog, "execution")?.id ?? null;
  const priceId = byRole(catalog, "price")?.id ?? null;
  if (priceId === null || executionId === null || !order.includes(priceId) || !order.includes(executionId))
    return { byId, article19: { applied: false, ceiling: null } };

  const ceiling = byId.get(executionId) ?? 0;
  const price = byId.get(priceId) ?? 0;
  const applied = price > ceiling;
  if (applied) byId.set(priceId, ceiling);
  return { byId, article19: { applied, ceiling } };
}
